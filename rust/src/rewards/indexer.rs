use std::collections::HashSet;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::de::DeserializeOwned;
use serde_json::json;

use super::events::{address_topic, decode_log, Event, Log, BASE_GENESIS_TIMESTAMP, TOPIC_MARKET_REWARDS_V4, TOPIC_TRADE_REWARDS_V3};
use super::store::{merge, missing, Store};
use crate::error::{Error, Result};

/// Base's public JSON-RPC endpoint. A private RPC is much faster for long histories.
pub const DEFAULT_RPC: &str = "https://mainnet.base.org";
/// No `CoinMarketRewardsV4` events exist before this block (2025-06-01), so full scans start here.
pub const V4_FIRST_BLOCK: u64 = 31_000_000;
/// Where legacy V3 scans start.
pub const V3_FIRST_BLOCK: u64 = 27_000_000;

/// Which blocks to scan. With nothing set, the scan covers all of V4 history.
#[derive(Debug, Clone, Default)]
pub struct ScanOptions {
    /// Scan back this many days from now.
    pub days: Option<f64>,
    /// Scan from this block (overrides `days`).
    pub from_block: Option<u64>,
    /// Stop at this block (default: the chain head).
    pub to_block: Option<u64>,
    /// Also scan legacy V3 coins (`CoinTradeRewards`).
    pub include_v3: bool,
}

type ProgressFn = Box<dyn FnMut(u64, u64, usize) + Send>;

/// Finds reward events paying a set of addresses and saves them in a [`Store`].
pub struct Indexer<S: Store> {
    store: S,
    rpc_url: String,
    http: reqwest::Client,
    /// Blocks per `eth_getLogs` for V4 (default 2,000; halved automatically when a node refuses).
    pub step: u64,
    /// Retries per RPC call (default 5).
    pub max_retries: u32,
    progress: Option<ProgressFn>,
}

/// The Base block produced at Unix time `t` (Base makes one every 2 seconds).
pub fn block_at(t: i64) -> u64 {
    ((t - BASE_GENESIS_TIMESTAMP).max(0) / 2) as u64
}

impl<S: Store> Indexer<S> {
    /// An indexer reading `rpc_url` (default [`DEFAULT_RPC`]) into `store`.
    pub fn new(store: S, rpc_url: Option<&str>) -> Self {
        Self {
            store,
            rpc_url: rpc_url.unwrap_or(DEFAULT_RPC).to_owned(),
            http: reqwest::Client::builder().timeout(Duration::from_secs(60)).build().expect("reqwest client"),
            step: 2000,
            max_retries: 5,
            progress: None,
        }
    }

    /// Call `f(blocks_done, blocks_total, events_found)` after every chunk.
    pub fn on_progress(mut self, f: impl FnMut(u64, u64, usize) + Send + 'static) -> Self {
        self.progress = Some(Box::new(f));
        self
    }

    /// The store, to read events back.
    pub fn store(&self) -> &S {
        &self.store
    }

    /// Index rewards paid to `addresses` and return how many new matching events were stored.
    /// Ranges already scanned for every address are skipped.
    pub async fn scan<A: AsRef<str>>(&mut self, addresses: &[A], opt: ScanOptions) -> Result<usize> {
        let addrs = normalise(addresses)?;
        let head = match opt.to_block {
            Some(b) => b,
            None => self.head().await?,
        };
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
        let start = opt.from_block.or(opt.days.map(|d| block_at(now - (d * 86_400.0) as i64))).unwrap_or(0);
        let mut plan: Vec<(u8, u64, u64)> = Vec::new();
        let mut versions = vec![(4u8, V4_FIRST_BLOCK)];
        if opt.include_v3 {
            versions.push((3, V3_FIRST_BLOCK));
        }
        for (v, floor) in versions {
            let lo = start.max(floor);
            if lo > head {
                continue;
            }
            let mut gaps = Vec::new();
            for a in &addrs {
                gaps.extend(missing(lo, head, &self.store.scanned(a, v)?));
            }
            plan.extend(merge(gaps).into_iter().map(|(a, b)| (v, a, b)));
        }
        let total: u64 = plan.iter().map(|(_, a, b)| b - a + 1).sum();
        let watch: HashSet<String> = addrs.iter().cloned().collect();
        let (mut done, mut found) = (0u64, 0usize);
        for (version, lo, hi) in plan {
            let mut step = if version == 3 { self.step * 5 } else { self.step };
            let mut from = lo;
            while from <= hi {
                let to = (from + step - 1).min(hi);
                let events = match self.fetch(version, from, to, &addrs).await {
                    Err(Error::Rpc { ref message, .. }) if range_too_large(message) && step > 50 => {
                        step /= 2; // this node caps log ranges or result sizes: retry the chunk smaller
                        continue;
                    }
                    other => other?,
                };
                let mine: Vec<Event> = events.into_iter().filter(|e| e.pays(&watch)).collect();
                found += mine.len();
                self.store.save(mine, &addrs, version, from, to)?;
                done += to - from + 1;
                if let Some(p) = self.progress.as_mut() {
                    p(done, total, found);
                }
                from = to + 1;
            }
        }
        Ok(found)
    }

    /// The latest block number.
    pub async fn head(&self) -> Result<u64> {
        let h: String = self.call("eth_blockNumber", json!([])).await?;
        Ok(u64::from_str_radix(h.trim_start_matches("0x"), 16).unwrap_or(0))
    }

    async fn fetch(&self, version: u8, lo: u64, hi: u64, addrs: &[String]) -> Result<Vec<Event>> {
        let (from, to) = (format!("0x{lo:x}"), format!("0x{hi:x}"));
        let mut logs: Vec<Log> = Vec::new();
        if version == 4 {
            logs = self.call("eth_getLogs", json!([{ "fromBlock": from, "toBlock": to, "topics": [TOPIC_MARKET_REWARDS_V4] }])).await?;
        } else {
            let topics: Vec<String> = addrs.iter().map(|a| address_topic(a)).collect();
            for pos in 1..=3 {
                // payoutRecipient, platformReferrer, tradeReferrer
                let mut filter = vec![json!(TOPIC_TRADE_REWARDS_V3), json!(null), json!(null), json!(null)];
                filter[pos] = json!(topics);
                let part: Vec<Log> = self.call("eth_getLogs", json!([{ "fromBlock": from, "toBlock": to, "topics": filter }])).await?;
                logs.extend(part);
            }
        }
        let mut seen = HashSet::new();
        let mut out: Vec<Event> = logs.iter().filter_map(decode_log).filter(|e| seen.insert(e.key())).collect();
        out.sort_by_key(|e| (e.block, e.log_index));
        Ok(out)
    }

    async fn call<T: DeserializeOwned>(&self, method: &str, params: serde_json::Value) -> Result<T> {
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
        let mut last: Option<Error> = None;
        for attempt in 0..=self.max_retries {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_secs((1u64 << attempt).min(20))).await;
            }
            let resp = match self.http.post(&self.rpc_url).json(&body).send().await {
                Ok(r) => r,
                Err(e) => {
                    last = Some(Error::Http(e));
                    continue;
                }
            };
            let status = resp.status().as_u16();
            if status == 429 || status >= 500 {
                last = Some(Error::Rpc { method: method.to_owned(), code: status as i64, message: format!("HTTP {status}") });
                continue;
            }
            let v: serde_json::Value = resp.json().await.map_err(Error::Http)?;
            if let Some(err) = v.get("error") {
                let message = err.get("message").and_then(|m| m.as_str()).unwrap_or("").to_owned();
                let e = Error::Rpc { method: method.to_owned(), code: err.get("code").and_then(|c| c.as_i64()).unwrap_or(0), message: message.clone() };
                let m = message.to_lowercase();
                if m.contains("rate") || m.contains("timeout") || m.contains("busy") {
                    last = Some(e);
                    continue;
                }
                return Err(e);
            }
            return serde_json::from_value(v.get("result").cloned().unwrap_or_default()).map_err(Error::from);
        }
        Err(last.unwrap_or_else(|| Error::Other(format!("rpc {method}: no answer"))))
    }
}

fn range_too_large(message: &str) -> bool {
    let m = message.to_lowercase();
    !m.contains("rate") && ["range", "too many", "limit exceeded", "10000 results", "response size"].iter().any(|s| m.contains(s))
}

fn normalise<A: AsRef<str>>(addresses: &[A]) -> Result<Vec<String>> {
    let mut out: Vec<String> = addresses.iter().map(|a| a.as_ref().to_lowercase()).collect();
    out.sort();
    out.dedup();
    if out.is_empty() {
        return Err(Error::Other("no addresses to scan".into()));
    }
    if let Some(bad) = out.iter().find(|a| a.len() != 42 || !a.starts_with("0x")) {
        return Err(Error::Other(format!("{bad:?} is not an address")));
    }
    Ok(out)
}
