//! # zora-coins
//!
//! A typed async client for the [Zora Coins API](https://docs.zora.co/coins) — every one of its 30
//! endpoints: coins, holders, swaps, comments, price history, Explore lists, search, profiles,
//! leaderboards, live streams, trade quotes and coin creation — plus a client for the zora-coins
//! GraphQL gateway and an onchain indexer for the creator and referral rewards Zora pays on Base.
//!
//! Unofficial and community-maintained; not affiliated with Zora.
//!
//! ```no_run
//! use futures_util::TryStreamExt;
//! use zora_coins::{Client, ExploreParams, ListType};
//!
//! # async fn run() -> zora_coins::Result<()> {
//! let client = Client::new(); // reads ZORA_API_KEY; or Client::builder().api_key("…").build()
//!
//! // One coin. Ok(None) when there is no such coin.
//! if let Some(coin) = client.coin("0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b", None).await? {
//!     println!("{:?} {:?} holders={:?}", coin.name, coin.market_cap, coin.unique_holders);
//! }
//!
//! // One page…
//! let page = client.explore(ListType::TopGainers, ExploreParams::default().page_size(10)).await?;
//! for coin in page.nodes() {
//!     println!("{:?} {:?}", coin.symbol, coin.market_cap_delta24h);
//! }
//!
//! // …or every page, fetched as the stream is polled.
//! let mut all = std::pin::pin!(client.iter_explore(ListType::New, None));
//! while let Some(coin) = all.try_next().await? {
//!     println!("{:?}", coin.address);
//! }
//! # Ok(()) }
//! ```
//!
//! ## Optional fields
//!
//! Every response field is an `Option`: the API returns a different selection of a coin's fields
//! from each endpoint and omits some its own spec marks required, so strict types would reject real
//! responses. Enums have an `Unknown` variant so a value Zora adds later doesn't break decoding.
//!
//! ## Errors and retries
//!
//! Rate limits (429) and server errors (5xx) are retried with backoff, honouring `Retry-After`
//! (default 3 retries). What's left is an [`Error::Api`]; [`Error::is_rate_limited`] tells you if
//! the limit was the cause. An API key (<https://zora.co/settings/developer>) raises it.
//!
//! ## Trading and creating coins
//!
//! [`Client::quote_trade`] and [`Client::create_content_coin`] return transactions for your wallet
//! to sign; this crate never holds keys or sends anything onchain. Set a `referrer` on a quote to
//! earn the trade referral reward, and `platform_referrer` on a new coin to earn the platform share
//! of its trading fees for good.
//!
//! ## Features
//!
//! - `rustls` (default) or `native-tls`: TLS backend.
//! - `rewards` (default): [`rewards`], the onchain rewards indexer.
//! - `cli`: the `zora-rewards` binary.
#![cfg_attr(docsrs, feature(doc_auto_cfg))]
#![warn(missing_docs)]

mod client;
mod de;
mod endpoints;
mod error;
mod graphql;
mod helpers;
pub mod models;
#[cfg(feature = "rewards")]
pub mod rewards;

pub use client::{Client, ClientBuilder, BASE_CHAIN_ID, DEFAULT_BASE_URL};
pub use endpoints::*;
pub use error::{Error, Result};
pub use graphql::{GraphQLClient, GraphQLError};
pub use helpers::{erc20, eth, USDC_ADDRESS, WETH_ADDRESS, ZORA_ADDRESS};
pub use models::*;
