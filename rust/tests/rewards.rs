//! Rewards indexer tests: real reward logs (../fixtures) served by a fake JSON-RPC node.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use num_bigint::BigUint;
use serde_json::{json, Value};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};
use zora_coins::rewards::*;

fn logs() -> Vec<Log> {
    let p = format!("{}/../fixtures/rewards_v4_logs.json", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

fn hex_u64(s: &str) -> u64 {
    u64::from_str_radix(s.trim_start_matches("0x"), 16).unwrap()
}

#[test]
fn decodes_a_real_v4_log() {
    let l = &logs()[0];
    let e = decode_log(l).expect("a reward event");
    assert_eq!(e.version, 4);
    assert_eq!(e.block, hex_u64(&l.block_number));
    let data = hex::decode(l.data.trim_start_matches("0x")).unwrap();
    assert_eq!(e.payouts[&Role::Creator].recipient, format!("0x{}", hex::encode(&data[3 * 32 - 20..3 * 32])));
    assert_eq!(e.payouts[&Role::Creator].currency, BigUint::from_bytes_be(&data[7 * 32..8 * 32]));
}

#[test]
fn decodes_v3_and_ignores_other_events() {
    let w = |n: u64| format!("{n:064x}");
    let (payout, plat, trade) = ("0x".to_owned() + &"11".repeat(20), "0x".to_owned() + &"22".repeat(20), "0x".to_owned() + &"33".repeat(20));
    let l = Log {
        address: "0x".to_owned() + &"ab".repeat(20),
        topics: vec![TOPIC_TRADE_REWARDS_V3.into(), address_topic(&payout), address_topic(&plat), address_topic(&trade)],
        data: format!("0x{}{}{}{}{}{}", "0".repeat(24) + &"44".repeat(20), w(100), w(25), w(4), w(20), "0".repeat(24) + &"55".repeat(20)),
        block_number: "0x1c9c380".into(),
        transaction_hash: "0x".to_owned() + &"cd".repeat(32),
        log_index: "0x5".into(),
    };
    let e = decode_log(&l).unwrap();
    assert_eq!((e.version, e.coin.as_str()), (3, l.address.as_str()));
    assert_eq!(e.payouts[&Role::PlatformReferrer].recipient, plat);
    assert_eq!(e.payouts[&Role::TradeReferrer].currency, BigUint::from(4u32));
    let transfer = Log { topics: vec!["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef".into()], ..Default::default() };
    assert!(decode_log(&transfer).is_none());
}

/// Answers eth_blockNumber and eth_getLogs from the fixture, refusing ranges over `max_range`.
struct Node {
    logs: Vec<Log>,
    head: u64,
    max_range: u64,
    calls: Arc<AtomicUsize>,
}

impl Respond for Node {
    fn respond(&self, req: &Request) -> ResponseTemplate {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let body: Value = serde_json::from_slice(&req.body).unwrap();
        let result = match body["method"].as_str().unwrap() {
            "eth_blockNumber" => json!(format!("0x{:x}", self.head)),
            _ => {
                let f = &body["params"][0];
                let (lo, hi) = (hex_u64(f["fromBlock"].as_str().unwrap()), hex_u64(f["toBlock"].as_str().unwrap()));
                if hi - lo + 1 > self.max_range {
                    return ResponseTemplate::new(200).set_body_json(json!({"jsonrpc": "2.0", "id": 1, "error": {"code": -32600, "message": "block range too large"}}));
                }
                json!(self.logs.iter().filter(|l| (lo..=hi).contains(&hex_u64(&l.block_number))).collect::<Vec<_>>())
            }
        };
        ResponseTemplate::new(200).set_body_json(json!({"jsonrpc": "2.0", "id": 1, "result": result}))
    }
}

#[tokio::test]
async fn scan_finds_resumes_and_shrinks_chunks() {
    let logs = logs();
    let first = decode_log(&logs[0]).unwrap();
    let who = first.payouts[&Role::Creator].recipient.clone();
    let calls = Arc::new(AtomicUsize::new(0));
    let server = MockServer::start().await;
    Mock::given(wiremock::matchers::method("POST"))
        .respond_with(Node { logs, head: first.block + 500, max_range: 700, calls: calls.clone() })
        .mount(&server)
        .await;
    let mut idx = Indexer::new(MemoryStore::default(), Some(&server.uri()));
    let upper = format!("0x{}", who[2..].to_uppercase());
    let n = idx.scan(&[upper], ScanOptions { from_block: Some(first.block - 1000), ..Default::default() }).await.unwrap();
    assert!(n > 0, "found nothing for the creator of a real reward log");
    assert_eq!(idx.store().events_for(&[who.as_str()], 0).unwrap().len(), n);
    let before = calls.load(Ordering::SeqCst);
    let again = idx.scan(&[who.as_str()], ScanOptions { from_block: Some(first.block - 1000), ..Default::default() }).await.unwrap();
    assert_eq!(again, 0);
    assert_eq!(calls.load(Ordering::SeqCst) - before, 1, "a rescan should only ask for the head");
}

#[tokio::test]
async fn file_store_round_trips_and_report_renders() {
    let dir = std::env::temp_dir().join(format!("zora-rewards-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("r.json");
    let events: Vec<Event> = logs().iter().filter_map(decode_log).collect();
    let who = events[0].payouts[&Role::PlatformReferrer].recipient.clone();
    {
        let mut st = FileStore::open(&path).unwrap();
        st.save(events.clone(), std::slice::from_ref(&who), 4, 10, 20).unwrap();
    }
    let st = FileStore::open(&path).unwrap();
    let got = st.events_for(&[who.as_str()], 0).unwrap();
    assert!(!got.is_empty());
    assert_eq!(st.scanned(&who, 4).unwrap(), vec![(10, 20)]);
    let report = build_report(&got, &[who.as_str()], None).await;
    assert_eq!(report.lines[0].role, Role::PlatformReferrer);
    assert!(report.to_text().contains("Platform referral"));
    assert!(report.to_html("t").contains("<svg"));
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn usd_formatting() {
    assert_eq!(format_usd(0.0), "$0.00");
    assert_eq!(format_usd(1234.5), "$1,234.50");
    assert_eq!(format_usd(0.0042), "$0.0042");
}

// Two real logs from one Base trade (tx 0x53f27c…f195): a CreatorCoinRewards payout for a creator coin and a
// CoinMarketRewardsV4 payout for a content coin, both to the same creator.
const CC_CREATOR: &str = "0xf4acf3edc65df843630976459ab1349a88258e6d";

fn creator_coin_logs() -> Vec<Log> {
    let p = format!("{}/../fixtures/creator_coin_rewards_logs.json", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

#[test]
fn decodes_a_real_creator_coin_rewards_log() {
    let l = &creator_coin_logs()[0];
    assert_eq!(l.topics[0], TOPIC_CREATOR_COIN_REWARDS);
    let e = decode_log(l).unwrap();
    assert_eq!(e.version, 4);
    assert_eq!(e.coin, "0x3177fa60b8a342cd044badf34bf820c536094656");
    assert_eq!(e.currency, "0x1111111111166b7fe7bd91427724b487980afc69");
    let creator = &e.payouts[&Role::Creator];
    assert_eq!(creator.recipient, CC_CREATOR);
    assert_eq!(creator.currency, "11879451646867555805".parse::<BigUint>().unwrap());
    assert_eq!(e.payouts[&Role::Protocol].currency, creator.currency);
    assert_eq!(e.payouts[&Role::PlatformReferrer].recipient, ZERO_ADDRESS);
}

/// Serves the creator-coin fixture and records the topics each eth_getLogs asked for.
struct TopicNode {
    logs: Vec<Log>,
    head: u64,
    calls: Arc<AtomicUsize>,
    asked: Arc<std::sync::Mutex<Vec<String>>>,
}

impl Respond for TopicNode {
    fn respond(&self, req: &Request) -> ResponseTemplate {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let body: Value = serde_json::from_slice(&req.body).unwrap();
        let result = match body["method"].as_str().unwrap() {
            "eth_blockNumber" => json!(format!("0x{:x}", self.head)),
            _ => {
                let f = &body["params"][0];
                self.asked.lock().unwrap().push(f["topics"].to_string());
                let (lo, hi) = (hex_u64(f["fromBlock"].as_str().unwrap()), hex_u64(f["toBlock"].as_str().unwrap()));
                json!(self.logs.iter().filter(|l| (lo..=hi).contains(&hex_u64(&l.block_number))).collect::<Vec<_>>())
            }
        };
        ResponseTemplate::new(200).set_body_json(json!({"jsonrpc": "2.0", "id": 1, "result": result}))
    }
}

#[tokio::test]
async fn scans_both_v4_events_and_rescans_old_ranges_once() {
    let logs = creator_coin_logs();
    let block = hex_u64(&logs[0].block_number);
    let calls = Arc::new(AtomicUsize::new(0));
    let asked = Arc::new(std::sync::Mutex::new(Vec::new()));
    let server = MockServer::start().await;
    Mock::given(wiremock::matchers::method("POST"))
        .respond_with(TopicNode { logs, head: block + 10, calls: calls.clone(), asked: asked.clone() })
        .mount(&server)
        .await;
    let mut store = MemoryStore::default();
    // what an earlier version recorded: these blocks scanned for CoinMarketRewardsV4 only
    store.save(vec![], &[CC_CREATOR.to_owned()], 4, block - 5, block + 10).unwrap();
    let mut idx = Indexer::new(store, Some(&server.uri()));
    let n = idx.scan(&[CC_CREATOR], ScanOptions { from_block: Some(block - 5), ..Default::default() }).await.unwrap();
    assert_eq!(n, 2, "both payouts to this creator");
    let want = json!([[TOPIC_MARKET_REWARDS_V4, TOPIC_CREATOR_COIN_REWARDS]]).to_string();
    assert!(asked.lock().unwrap().iter().all(|t| *t == want), "asked for {:?}", asked.lock().unwrap());
    let before = calls.load(Ordering::SeqCst);
    let again = idx.scan(&[CC_CREATOR], ScanOptions { from_block: Some(block - 5), ..Default::default() }).await.unwrap();
    assert_eq!(again, 0);
    assert_eq!(calls.load(Ordering::SeqCst) - before, 1, "a rescan should only ask for the head");
}
