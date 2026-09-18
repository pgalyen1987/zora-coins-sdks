//! Offline tests against a mock server answering with real recorded responses (../fixtures).

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use futures_util::TryStreamExt;
use serde_json::Value;
use wiremock::matchers::{header, method, path, query_param};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};
use zora_coins::*;

fn fixture(name: &str) -> Value {
    let p = format!("{}/../fixtures/{name}.json", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{p}: {e}"))).unwrap()
}

async fn setup() -> (MockServer, Client) {
    let server = MockServer::start().await;
    let client = Client::builder().base_url(server.uri()).api_key("test-key").max_retries(2).build();
    (server, client)
}

#[tokio::test]
async fn coin_decodes_a_real_response() {
    let (server, client) = setup().await;
    Mock::given(method("GET"))
        .and(path("/coin"))
        .and(query_param("address", "0xabc"))
        .and(query_param("chain", "8453"))
        .and(header("api-key", "test-key"))
        .respond_with(ResponseTemplate::new(200).set_body_json(fixture("coin")))
        .mount(&server)
        .await;
    let coin = client.coin("0xabc", None).await.unwrap().expect("a coin");
    assert!(coin.name.is_some() && coin.market_cap.is_some() && coin.unique_holders.is_some());
    assert!(coin.typename.as_deref().unwrap_or("").starts_with("GraphQL"));
    assert!(coin.creator_profile.as_ref().and_then(|p| p.handle.as_ref()).is_some());
}

#[tokio::test]
async fn missing_coin_is_none() {
    let (server, client) = setup().await;
    Mock::given(path("/coin")).respond_with(ResponseTemplate::new(200).set_body_json(fixture("coin_missing"))).mount(&server).await;
    assert!(client.coin("0xdead", None).await.unwrap().is_none());
}

#[tokio::test]
async fn stream_follows_cursors_and_stops_on_last_page() {
    let (server, client) = setup().await;
    let p1 = fixture("explore_page1");
    let cursor = p1["exploreList"]["pageInfo"]["endCursor"].as_str().unwrap().to_owned();
    let mut p2 = fixture("explore_page2");
    p2["exploreList"]["pageInfo"] = serde_json::json!({ "hasNextPage": false });
    Mock::given(path("/explore")).and(query_param("after", cursor.as_str())).respond_with(ResponseTemplate::new(200).set_body_json(p2)).mount(&server).await;
    Mock::given(path("/explore")).and(query_param("listType", "TOP_VOLUME_24H")).respond_with(ResponseTemplate::new(200).set_body_json(p1)).mount(&server).await;
    let all: Vec<Zora20Token> = client.iter_explore(ListType::TopVolume24h, ExploreParams::default().page_size(2)).try_collect().await.unwrap();
    assert_eq!(all.len(), 4);
    assert!(all.iter().all(|c| c.address.is_some()));
}

struct Counting(Arc<AtomicUsize>, Value);
impl Respond for Counting {
    fn respond(&self, _: &Request) -> ResponseTemplate {
        self.0.fetch_add(1, Ordering::SeqCst);
        ResponseTemplate::new(200).set_body_json(self.1.clone())
    }
}

#[tokio::test]
async fn stream_stops_on_a_repeated_cursor() {
    let (server, client) = setup().await;
    let calls = Arc::new(AtomicUsize::new(0));
    Mock::given(path("/explore")).respond_with(Counting(calls.clone(), fixture("explore_page1"))).mount(&server).await;
    let all: Vec<Zora20Token> = client.iter_explore(ListType::New, None).try_collect().await.unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 2, "the second page repeats the cursor, so it must stop there");
    assert_eq!(all.len(), 4);
}

#[tokio::test]
async fn dropping_a_stream_stops_fetching() {
    let (server, client) = setup().await;
    let calls = Arc::new(AtomicUsize::new(0));
    Mock::given(path("/explore")).respond_with(Counting(calls.clone(), fixture("explore_page1"))).mount(&server).await;
    {
        let mut s = std::pin::pin!(client.iter_explore(ListType::New, None));
        s.try_next().await.unwrap();
    }
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn retries_rate_limits_then_succeeds() {
    let (server, client) = setup().await;
    Mock::given(path("/tokenInfo")).respond_with(ResponseTemplate::new(429).insert_header("retry-after", "0")).up_to_n_times(2).mount(&server).await;
    Mock::given(path("/tokenInfo")).respond_with(ResponseTemplate::new(200).set_body_json(fixture("token_info"))).mount(&server).await;
    let info = client.token_info(USDC_ADDRESS, None).await.unwrap();
    assert!(info.and_then(|t| t.currency).is_some());
}

#[tokio::test]
async fn rate_limit_error_after_retries() {
    let (server, client) = setup().await;
    Mock::given(path("/profile"))
        .respond_with(ResponseTemplate::new(429).insert_header("retry-after", "0").set_body_json(serde_json::json!({ "error": "slow down" })))
        .mount(&server)
        .await;
    let err = client.profile("jacob").await.unwrap_err();
    assert!(err.is_rate_limited(), "{err}");
    assert!(err.to_string().contains("slow down"));
}

#[tokio::test]
async fn client_errors_are_not_retried() {
    let (server, client) = setup().await;
    let calls = Arc::new(AtomicUsize::new(0));
    struct Bad(Arc<AtomicUsize>);
    impl Respond for Bad {
        fn respond(&self, _: &Request) -> ResponseTemplate {
            self.0.fetch_add(1, Ordering::SeqCst);
            ResponseTemplate::new(400).set_body_json(serde_json::json!({ "message": "text is required" }))
        }
    }
    Mock::given(path("/search")).respond_with(Bad(calls.clone())).mount(&server).await;
    let err = client.search("", None).await.unwrap_err();
    assert_eq!(err.status(), Some(400));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn query_encoding() {
    let (server, client) = setup().await;
    Mock::given(path("/profileBalances"))
        .and(query_param("identifier", "jacob"))
        .and(query_param("count", "7"))
        .and(query_param("sortOption", "USD_VALUE"))
        .and(query_param("excludeHidden", "false"))
        .respond_with(move |req: &Request| {
            let ids: Vec<String> = req.url.query_pairs().filter(|(k, _)| k == "chainIds").map(|(_, v)| v.into_owned()).collect();
            assert_eq!(ids, ["8453", "7777777"], "chainIds must repeat the key");
            ResponseTemplate::new(200).set_body_json(fixture("profile_balances"))
        })
        .mount(&server)
        .await;
    let params = ProfileBalancesParams::default().page_size(7).sort_option(SortOption::UsdValue).exclude_hidden(false).chain_ids(vec![8453, 7777777]);
    let page = client.profile_balances("jacob", params).await.unwrap();
    assert!(page.nodes().count() > 0);
}

#[tokio::test]
async fn coins_by_address_sends_one_json_param_per_coin() {
    let (server, client) = setup().await;
    Mock::given(path("/coins"))
        .respond_with(|req: &Request| {
            let coins: Vec<String> = req.url.query_pairs().filter(|(k, _)| k == "coins").map(|(_, v)| v.into_owned()).collect();
            assert_eq!(coins[0], r#"{"chainId":8453,"collectionAddress":"0xaaa"}"#);
            ResponseTemplate::new(200).set_body_json(fixture("coins"))
        })
        .mount(&server)
        .await;
    assert_eq!(client.coins_by_address(&["0xAAA", "0xbbb"]).await.unwrap().len(), 2);
}

#[tokio::test]
async fn quote_trade_fills_defaults_and_reads_the_string_boolean() {
    let (server, client) = setup().await;
    Mock::given(method("POST"))
        .and(path("/quote"))
        .respond_with(|req: &Request| {
            let body: Value = serde_json::from_slice(&req.body).unwrap();
            assert_eq!(body["recipient"], "0xme");
            assert_eq!(body["slippage"], 0.05);
            assert_eq!(body["chainId"], 8453);
            assert_eq!(body["tokenIn"], serde_json::json!({ "type": "eth" }));
            ResponseTemplate::new(200).set_body_json(fixture("quote"))
        })
        .mount(&server)
        .await;
    let q = client.quote_trade(eth(), erc20("0xc0"), "1000", "0xme", None).await.unwrap();
    assert_eq!(q.success, Some(true));
    assert!(q.call.and_then(|c| c.data).is_some());
}

#[tokio::test]
async fn graphql_client_decodes_into_rest_types_and_surfaces_errors() {
    let server = MockServer::start().await;
    let coin = fixture("coin")["zora20Token"].clone();
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({ "data": { "coin": coin } })))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/graphql"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({ "data": null, "errors": [{ "message": "boom" }] })))
        .mount(&server)
        .await;
    #[derive(Debug, serde::Deserialize)]
    struct Data {
        coin: Option<Zora20Token>,
    }
    let gql = GraphQLClient::new(format!("{}/graphql", server.uri()));
    let d: Data = gql.query("{ coin(address: \"0x\") { name } }", serde_json::json!({})).await.unwrap();
    assert!(d.coin.and_then(|c| c.name).is_some());
    let err = gql.query::<Data>("{ x }", serde_json::json!({})).await.unwrap_err();
    assert!(matches!(err, Error::GraphQL(ref e) if e[0].message == "boom"));
}

#[test]
fn every_fixture_decodes() {
    macro_rules! check {
        ($($name:literal => $ty:ty),* $(,)?) => {$(
            let v = fixture($name);
            let parsed: $ty = serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("{}: {e}", $name));
            // round trip: nothing the API sent is lost
            assert_eq!(serde_json::to_value(&parsed).unwrap(), strip_nulls(v), "{} changed on a round trip", $name);
        )*};
    }
    check!(
        "coin" => CoinResponse, "coin_holders" => CoinHoldersResponse, "coin_swaps" => CoinSwapsResponse,
        "price_history" => CoinPriceHistoryResponse, "explore_page1" => ExploreResponse, "explore_page2" => ExploreResponse,
        "profile" => ProfileResponse, "profile_balances" => ProfileBalancesResponse, "search" => SearchResponse,
        "token_info" => TokenInfoResponse, "coins" => CoinsResponse,
    );
    let q: QuoteResponse = serde_json::from_value(fixture("quote")).unwrap();
    assert_eq!(q.success, Some(true));
}

/// The SDK skips absent fields when serializing, so compare against the input without its nulls.
fn strip_nulls(v: Value) -> Value {
    match v {
        Value::Object(m) => Value::Object(m.into_iter().filter(|(_, v)| !v.is_null()).map(|(k, v)| (k, strip_nulls(v))).collect()),
        Value::Array(a) => Value::Array(a.into_iter().map(strip_nulls).collect()),
        other => other,
    }
}

#[test]
fn enums_tolerate_values_added_later() {
    let t: CoinType = serde_json::from_str("\"SOMETHING_NEW\"").unwrap();
    assert_eq!(t, CoinType::Unknown);
    assert_eq!(ListType::TopGainers.to_string(), "TOP_GAINERS");
}
