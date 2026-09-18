use std::collections::{BTreeMap, HashSet};

use num_bigint::BigUint;
use serde::{Deserialize, Serialize};

/// keccak256 of `CoinMarketRewardsV4(address,address,address,address,address,address,address,(uint256×10))`.
pub const TOPIC_MARKET_REWARDS_V4: &str = "0x35b5031218696db1dfd903223a47f38e66a1998e14a942a5d60fddaa49a685fc";
/// keccak256 of `CoinTradeRewards(address,address,address,address,uint256,uint256,uint256,uint256,address)`.
pub const TOPIC_TRADE_REWARDS_V3: &str = "0x6b67f906562afcdc3afeeeb6754e906cc24d9ce090e9db1b7b68e6462682d966";
/// "Nobody" in a recipient field; native ETH as a currency.
pub const ZERO_ADDRESS: &str = "0x0000000000000000000000000000000000000000";
/// Base makes a block exactly every 2 seconds from this Unix time, so a block's time needs no RPC.
pub const BASE_GENESIS_TIMESTAMP: i64 = 1_686_789_347;

/// Who a payout goes to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    /// The coin's payout recipient.
    Creator,
    /// The app that launched the coin.
    PlatformReferrer,
    /// The interface that routed the trade.
    TradeReferrer,
    /// Zora's protocol fee.
    Protocol,
    /// Doppler's share.
    Doppler,
}

impl Role {
    /// Every role, in report order.
    pub const ALL: [Role; 5] = [Role::Creator, Role::PlatformReferrer, Role::TradeReferrer, Role::Protocol, Role::Doppler];

    /// Human name.
    pub fn label(self) -> &'static str {
        match self {
            Role::Creator => "Creator payouts",
            Role::PlatformReferrer => "Platform referral",
            Role::TradeReferrer => "Trade referral",
            Role::Protocol => "Protocol",
            Role::Doppler => "Doppler",
        }
    }
}

/// What one role received in one event. `currency` is paid in [`Event::currency`] (ZORA, ETH, USDC
/// or a creator coin); `coin` is paid in the traded coin itself (V4 only).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Payout {
    /// Who was paid.
    pub recipient: String,
    /// Amount in the event's currency, in its smallest unit.
    pub currency: BigUint,
    /// Amount in the coin, in its smallest unit.
    pub coin: BigUint,
}

/// One reward distribution. Amounts are exact integers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Event {
    /// Block number.
    pub block: u64,
    /// Transaction hash.
    pub tx_hash: String,
    /// Log index within the block.
    pub log_index: u64,
    /// Contract that emitted the event.
    pub emitter: String,
    /// 4 or 3.
    pub version: u8,
    /// The traded coin.
    pub coin: String,
    /// The currency the `currency` amounts are in.
    pub currency: String,
    /// What each role received.
    pub payouts: BTreeMap<Role, Payout>,
}

impl Event {
    /// Unix time of the event's block.
    pub fn timestamp(&self) -> i64 {
        BASE_GENESIS_TIMESTAMP + 2 * self.block as i64
    }

    /// Whether any of `addresses` (lowercase) received a payout.
    pub fn pays(&self, addresses: &HashSet<String>) -> bool {
        self.payouts.values().any(|p| p.recipient != ZERO_ADDRESS && addresses.contains(&p.recipient))
    }

    pub(crate) fn key(&self) -> String {
        format!("{}:{}", self.tx_hash, self.log_index)
    }
}

/// An `eth_getLogs` entry, as JSON-RPC returns it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Log {
    /// Emitting contract.
    pub address: String,
    /// Indexed topics; the first is the event signature.
    pub topics: Vec<String>,
    /// Non-indexed data (0x hex).
    pub data: String,
    /// Block number (0x hex).
    pub block_number: String,
    /// Transaction hash.
    pub transaction_hash: String,
    /// Log index (0x hex).
    pub log_index: String,
}

fn hex_u64(s: &str) -> u64 {
    u64::from_str_radix(s.trim_start_matches("0x"), 16).unwrap_or(0)
}

fn words(data: &str) -> Vec<Vec<u8>> {
    hex::decode(data.trim_start_matches("0x")).map(|b| b.chunks_exact(32).map(<[u8]>::to_vec).collect()).unwrap_or_default()
}

fn addr(word: &[u8]) -> String {
    if word.len() < 20 {
        return ZERO_ADDRESS.to_owned();
    }
    format!("0x{}", hex::encode(&word[word.len() - 20..]))
}

fn topic_addr(topic: &str) -> String {
    addr(&hex::decode(topic.trim_start_matches("0x")).unwrap_or_default())
}

fn uint(word: &[u8]) -> BigUint {
    BigUint::from_bytes_be(word)
}

/// Decode a log into an [`Event`], or `None` if it isn't a Zora reward event.
pub fn decode_log(l: &Log) -> Option<Event> {
    let topic0 = l.topics.first()?.to_lowercase();
    let w = words(&l.data);
    let mut e = Event {
        block: hex_u64(&l.block_number),
        tx_hash: l.transaction_hash.to_lowercase(),
        log_index: hex_u64(&l.log_index),
        emitter: l.address.to_lowercase(),
        version: 0,
        coin: String::new(),
        currency: String::new(),
        payouts: BTreeMap::new(),
    };
    let payout = |r: String, c: BigUint, k: BigUint| Payout { recipient: r, currency: c, coin: k };
    if topic0 == TOPIC_MARKET_REWARDS_V4 && w.len() >= 17 {
        e.version = 4;
        e.coin = addr(&w[0]);
        e.currency = addr(&w[1]);
        let roles = [Role::Creator, Role::PlatformReferrer, Role::TradeReferrer, Role::Protocol, Role::Doppler];
        for (i, role) in roles.into_iter().enumerate() {
            e.payouts.insert(role, payout(addr(&w[2 + i]), uint(&w[7 + 2 * i]), uint(&w[8 + 2 * i])));
        }
        return Some(e);
    }
    if topic0 == TOPIC_TRADE_REWARDS_V3 && l.topics.len() >= 4 && w.len() >= 6 {
        // indexed: payoutRecipient, platformReferrer, tradeReferrer; the coin is the emitter
        e.version = 3;
        e.coin = e.emitter.clone();
        e.currency = addr(&w[5]);
        let zero = BigUint::default;
        e.payouts.insert(Role::Creator, payout(topic_addr(&l.topics[1]), uint(&w[1]), zero()));
        e.payouts.insert(Role::PlatformReferrer, payout(topic_addr(&l.topics[2]), uint(&w[2]), zero()));
        e.payouts.insert(Role::TradeReferrer, payout(topic_addr(&l.topics[3]), uint(&w[3]), zero()));
        e.payouts.insert(Role::Protocol, payout(addr(&w[0]), uint(&w[4]), zero()));
        e.payouts.insert(Role::Doppler, payout(ZERO_ADDRESS.to_owned(), zero(), zero()));
        return Some(e);
    }
    None
}

/// Left-pad an address to a 32-byte topic, for filtering indexed V3 fields.
pub fn address_topic(address: &str) -> String {
    format!("0x{}{}", "0".repeat(24), address.trim_start_matches("0x").to_lowercase())
}
