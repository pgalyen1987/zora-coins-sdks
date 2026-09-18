//! Live checks against Zora's production API. Ignored by default:
//!
//!     cargo test --test live -- --ignored --nocapture

use futures_util::{StreamExt, TryStreamExt};
use serde_json::Value;
use zora_coins::*;

const FAT_VANCE: &str = "0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b";

async fn pace() {
    tokio::time::sleep(std::time::Duration::from_millis(350)).await;
}

#[tokio::test]
#[ignore]
async fn every_endpoint() {
    let c = Client::new();
    let coin = c.coin(FAT_VANCE, None).await.unwrap().expect("Fat Vance exists");
    println!("coin: {:?}", coin.name);
    pace().await;
    assert_eq!(c.coins_by_address(&[FAT_VANCE]).await.unwrap().len(), 1);
    pace().await;
    c.coin_holders(FAT_VANCE, CoinHoldersParams::default().page_size(3)).await.unwrap();
    pace().await;
    c.coin_swaps(FAT_VANCE, CoinSwapsParams::default().page_size(3)).await.unwrap();
    pace().await;
    c.coin_comments(FAT_VANCE, None).await.unwrap();
    pace().await;
    c.coin_merged_comments(FAT_VANCE, None).await.unwrap();
    pace().await;
    c.coin_price_history(FAT_VANCE, None).await.unwrap();
    pace().await;
    assert!(c.coins_list(CoinsListParams::default().page_size(3)).await.unwrap().nodes().count() > 0);
    pace().await;
    assert!(c.token_info(USDC_ADDRESS, None).await.unwrap().is_some());
    for lt in [ListType::TopGainers, ListType::New, ListType::MostValuableCreators] {
        pace().await;
        assert!(c.explore(lt, ExploreParams::default().page_size(3)).await.unwrap().nodes().count() > 0, "{lt}");
    }
    pace().await;
    let five: Vec<Zora20Token> = c.iter_explore(ListType::TopVolume24h, ExploreParams::default().page_size(2)).take(5).try_collect().await.unwrap();
    assert_eq!(five.len(), 5, "streamed across three pages");
    pace().await;
    assert!(c.search("zora", SearchParams::default().page_size(3)).await.unwrap().nodes().count() > 0);
    pace().await;
    c.trends_by_name("base", None).await.unwrap();
    pace().await;
    c.trader_leaderboard(None).await.unwrap();
    pace().await;
    c.featured_creators(None).await.unwrap();
    pace().await;
    c.latest_live_streams(None).await.unwrap();
    pace().await;
    c.top_live_streams(None).await.unwrap();
    pace().await;
    c.creator_livestream_comments(FAT_VANCE, None).await.unwrap();
    pace().await;
    assert_eq!(c.profile("rebelstudios").await.unwrap().and_then(|p| p.handle).as_deref(), Some("rebelstudios"));
    pace().await;
    c.profile_coins("rebelstudios", None).await.unwrap();
    pace().await;
    c.profile_balances("rebelstudios", None).await.unwrap();
    pace().await;
    c.profile_social("rebelstudios").await.unwrap();
    pace().await;
    c.wallet_trade_activity("rebelstudios", None).await.unwrap();
    pace().await;
    c.creator_coin_pool_config(None).await.unwrap();
    pace().await;
    c.content_coin_pool_config(CurrencyType::Zora, None).await.unwrap();
    pace().await;
    let q = c.quote_trade(eth(), erc20(FAT_VANCE), "1000000000000", "0x8E57BFDE053dBb6862991759c19affC5F383d5D0", None).await.unwrap();
    assert_eq!(q.success, Some(true));
    pace().await;
    assert!(c.coin("0x000000000000000000000000000000000000dead", None).await.unwrap().is_none());
}

/// Decode, re-encode and compare: any field the API sends that the SDK doesn't model would be
/// dropped and show up here. A failure means the spec moved; regenerate and release.
#[tokio::test]
#[ignore]
async fn nothing_is_dropped() {
    let c = Client::new();
    macro_rules! same {
        ($path:literal, $q:expr, $ty:ty) => {{
            pace().await;
            let raw: Value = c.request("GET", $path, &$q, None).await.unwrap();
            let typed: $ty = serde_json::from_value(raw.clone()).unwrap();
            assert_eq!(strip(serde_json::to_value(&typed).unwrap()), strip(raw), "{} lost data", $path);
            println!("ok {}", $path);
        }};
    }
    let a = || ("address", FAT_VANCE.to_string());
    same!("/coin", [a(), ("chain", "8453".into())], CoinResponse);
    same!("/explore", [("listType", "TOP_GAINERS".to_string()), ("count", "5".into())], ExploreResponse);
    same!("/explore", [("listType", "MOST_VALUABLE_CREATORS".to_string()), ("count", "5".into())], ExploreResponse);
    same!("/profile", [("identifier", "jacob".to_string())], ProfileResponse);
    same!("/profileBalances", [("identifier", "jacob".to_string()), ("count", "5".into())], ProfileBalancesResponse);
    same!("/search", [("text", "zora".to_string()), ("first", "5".into())], SearchResponse);
    same!("/traderLeaderboard", [("first", "5".to_string())], TraderLeaderboardResponse);
    same!("/creatorCoinPoolConfig", Vec::<(&str, String)>::new(), CreatorCoinPoolConfigResponse);
}

fn strip(v: Value) -> Value {
    match v {
        Value::Object(m) => Value::Object(m.into_iter().filter(|(_, v)| !v.is_null()).map(|(k, v)| (k, strip(v))).collect()),
        Value::Array(a) => Value::Array(a.into_iter().map(strip).collect()),
        // numbers can come back as 1 vs 1.0; compare them as f64
        Value::Number(n) => serde_json::json!(n.as_f64()),
        other => other,
    }
}
