# zora-coins for Rust

Typed async client for the [Zora Coins API](https://docs.zora.co/coins): all 30 endpoints, `Stream` pagination, retries, a GraphQL client, and an onchain indexer for the creator and referral rewards Zora pays on Base.

> Unofficial and community-maintained. Not affiliated with Zora.

```sh
cargo add zora-coins
```

Async on `reqwest` + `tokio`, rustls by default (no OpenSSL). MSRV 1.75. [API docs on docs.rs](https://docs.rs/zora-coins).

## Quick start

```rust
use zora_coins::{Client, ExploreParams, ListType};

let client = Client::new(); // reads ZORA_API_KEY; or Client::builder().api_key("…").build()

if let Some(coin) = client.coin("0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b", None).await? {
    println!("{:?} {:?} holders={:?}", coin.name, coin.market_cap, coin.unique_holders);
}
```

Every field is an `Option`, because the API leaves fields out: each endpoint returns a different selection of a coin's fields. Enums have an `Unknown` variant, so a value Zora adds later doesn't break decoding. Lookups that find nothing return `Ok(None)`.

## Pagination

```rust
use futures_util::TryStreamExt;

let page = client.coin_holders(addr, CoinHoldersParams::default().page_size(50)).await?;
for holder in page.nodes() { /* … */ }
let next = page.next_cursor(); // None on the last page

let mut all = std::pin::pin!(client.iter_coin_holders(addr, None));
while let Some(holder) = all.try_next().await? {
    println!("{:?} {:?}", holder.owner_address, holder.balance); // balance: 18-decimal integer string
}
```

Streams fetch the next page only when polled. Drop the stream to stop.

## Errors and retries

Rate limits (429) and server errors (5xx) are retried with backoff, honouring `Retry-After` (default 3 retries). What's left is an `Error`:

```rust
match client.quote_trade(eth(), erc20(coin), "10000000000000000000", wallet, None).await {
    Err(e) if e.is_insufficient_liquidity() => { /* the pool can't fill that size */ }
    Err(e) if e.is_rate_limited() => { /* add an API key */ }
    other => { /* … */ }
}
```

## Trading and creating coins

```rust
use zora_coins::{erc20, eth, QuoteRequest};

let extra = QuoteRequest { referrer: Some(my_app.into()), ..Default::default() }; // earns the trade referral reward
let q = client.quote_trade(eth(), erc20(coin), "1000000000000000", wallet, Some(extra)).await?;
let call = q.call.expect("a quote carries a call"); // target, data, value: sign with your wallet
```

`create_content_coin` builds the transaction that creates a coin. Set `platform_referrer` to earn the platform share of its trading fees for good. This crate never holds keys or sends transactions.

## GraphQL

```rust
#[derive(serde::Deserialize)]
struct Data { coin: Option<zora_coins::Zora20Token> }

let gql = zora_coins::GraphQLClient::new("http://localhost:8080/graphql");
let data: Data = gql.query("query($a: String!) { coin(address: $a) { name marketCap } }", serde_json::json!({ "a": addr })).await?;
```

Results deserialize into the same types as REST. The gateway is in [`../graphql`](../graphql).

## Rewards

With the `rewards` feature (on by default):

```rust
use zora_coins::rewards::{build_report, FileStore, Indexer, ScanOptions, Store};

let mut idx = Indexer::new(FileStore::open("rewards.json")?, None); // None = Base's public RPC
idx.scan(&[addr], ScanOptions { days: Some(7.0), ..Default::default() }).await?;
let events = idx.store().events_for(&[addr], 0)?;
let report = build_report(&events, &[addr], Some(&client)).await;
println!("{}", report.to_text()); // or report.to_html("My rewards")
```

Amounts are exact `BigUint`s. For the CLI, run `cargo install zora-coins --features cli`, then `zora-rewards --days 7 --html rewards.html 0xYourAddress`.

## Features

| Feature | |
|---|---|
| `rustls` (default) / `native-tls` | TLS backend |
| `rewards` (default) | the onchain rewards indexer |
| `cli` | the `zora-rewards` binary |

## Reference

[Every endpoint and its method](../docs/ENDPOINTS.md), including the units of the numeric fields. Generated from Zora's OpenAPI spec by [`../codegen`](../codegen).

```sh
cargo test                                   # offline, against recorded responses
cargo test --test live -- --ignored          # every endpoint against production
```

MIT © Rebel Studios Software
