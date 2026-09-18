//! What Zora pays creators and referrers, read straight from Base.
//!
//! Every trade of a Zora coin splits its fee between the coin's creator (the payout recipient), the
//! platform that launched the coin, the interface that routed the trade, the protocol, and Doppler.
//! On V4 coins those payouts are `CoinMarketRewardsV4` events, and none of their fields are
//! indexed: no node can answer "rewards paid to this address". This module reads every reward event
//! in a block range, keeps the ones paying the addresses you watch, and remembers what it scanned,
//! so running it again only fetches new blocks.
//!
//! ```no_run
//! # async fn run() -> zora_coins::Result<()> {
//! use zora_coins::rewards::{build_report, Indexer, MemoryStore, ScanOptions, Store};
//!
//! let who = ["0xYourPayoutOrReferrerAddress"];
//! let mut idx = Indexer::new(MemoryStore::default(), None);
//! idx.scan(&who, ScanOptions { days: Some(7.0), ..Default::default() }).await?;
//! let events = idx.store().events_for(&who, 0)?;
//! let report = build_report(&events, &who, Some(&zora_coins::Client::new())).await;
//! println!("{}", report.to_text());
//! # Ok(()) }
//! ```

mod events;
mod indexer;
mod report;
mod store;

pub use events::{address_topic, decode_log, Event, Log, Payout, Role, BASE_GENESIS_TIMESTAMP, TOPIC_MARKET_REWARDS_V4, TOPIC_TRADE_REWARDS_V3, ZERO_ADDRESS};
pub use indexer::{block_at, Indexer, ScanOptions, DEFAULT_RPC, V3_FIRST_BLOCK, V4_FIRST_BLOCK};
pub use report::{build_report, format_usd, Line, Report, Token};
pub use store::{FileStore, MemoryStore, Store};
