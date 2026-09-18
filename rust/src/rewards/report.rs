use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt::Write;

use num_bigint::BigUint;
use serde::Serialize;

use super::events::{Event, Role, ZERO_ADDRESS};
use crate::helpers::{USDC_ADDRESS, WETH_ADDRESS};
use crate::Client;

/// What a report knows about a token: symbol, decimals, and today's USD price.
#[derive(Debug, Clone, Serialize)]
pub struct Token {
    /// Token address (the zero address for native ETH).
    pub address: String,
    /// Ticker.
    pub symbol: String,
    /// Decimals.
    pub decimals: u32,
    /// Current USD price, if the API has one.
    pub price_usd: Option<f64>,
}

/// What one role earned in one token.
#[derive(Debug, Clone, Serialize)]
pub struct Line {
    /// Who earned it.
    pub role: Role,
    /// Token address.
    pub token: String,
    /// Total in the token's smallest unit.
    pub raw: BigUint,
    /// Number of payouts summed.
    pub payouts: usize,
}

/// What a set of addresses earned. USD values use current prices from the Zora API, not prices at
/// the time of each payout.
#[derive(Debug, Clone, Serialize)]
pub struct Report {
    /// The addresses, lowercase.
    pub addresses: Vec<String>,
    /// Events summed.
    pub events: usize,
    /// First block with an event.
    pub first_block: Option<u64>,
    /// Last block with an event.
    pub last_block: Option<u64>,
    /// Totals per role and token, in report order.
    pub lines: Vec<Line>,
    /// Token metadata, by address.
    pub tokens: HashMap<String, Token>,
    /// USD earned per coin.
    pub by_coin_usd: HashMap<String, f64>,
    /// USD earned per hour (spans up to 3 days) or per day, UTC, oldest first.
    pub by_time_usd: BTreeMap<String, f64>,
    /// Ticker of the top coins.
    pub coin_names: HashMap<String, String>,
}

fn to_f64(raw: &BigUint, decimals: u32) -> f64 {
    raw.to_string().parse::<f64>().unwrap_or(0.0) / 10f64.powi(decimals as i32)
}

impl Report {
    /// A line's total in whole tokens.
    pub fn amount(&self, l: &Line) -> f64 {
        to_f64(&l.raw, self.tokens.get(&l.token).map_or(18, |t| t.decimals))
    }

    /// A line's value at current prices, or `None` if the token has no price.
    pub fn usd(&self, l: &Line) -> Option<f64> {
        let t = self.tokens.get(&l.token)?;
        Some(self.amount(l) * t.price_usd?)
    }

    /// Sum of every priced line.
    pub fn total_usd(&self) -> f64 {
        self.lines.iter().filter_map(|l| self.usd(l)).sum()
    }

    /// USD per role.
    pub fn by_role_usd(&self) -> BTreeMap<Role, f64> {
        let mut out = BTreeMap::new();
        for l in &self.lines {
            *out.entry(l.role).or_insert(0.0) += self.usd(l).unwrap_or(0.0);
        }
        out
    }

    /// A plain-text table.
    pub fn to_text(&self) -> String {
        let mut s = format!("Zora rewards for {}\n{} reward events", self.addresses.join(", "), self.events);
        if let (Some(a), Some(b)) = (self.first_block, self.last_block) {
            let _ = write!(s, ", blocks {a}–{b}");
        }
        s.push('\n');
        for l in &self.lines {
            let sym = self.tokens.get(&l.token).map_or(l.token.as_str(), |t| t.symbol.as_str());
            let usd = self.usd(l).map_or("—".to_owned(), format_usd);
            let _ = writeln!(s, "  {:<18} {:>16} {:<12} {:>12}  ({} payouts)", l.role.label(), fmt_amount(self.amount(l)), sym, usd, l.payouts);
        }
        let _ = writeln!(s, "  {:<18} {:>16} {:<12} {:>12}", "Total (current prices)", "", "", format_usd(self.total_usd()));
        s
    }

    /// A self-contained HTML page (no external assets; light and dark themes).
    pub fn to_html(&self, title: &str) -> String {
        let esc = |s: &str| s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;");
        let days: Vec<(&String, &f64)> = self.by_time_usd.iter().rev().take(60).collect::<Vec<_>>().into_iter().rev().collect();
        let peak = days.iter().map(|(_, v)| **v).fold(0.0, f64::max).max(f64::MIN_POSITIVE);
        let (bar_w, gap) = (12usize, 3usize);
        let mut bars = String::new();
        for (i, (d, v)) in days.iter().enumerate() {
            let h = (**v / peak * 110.0).max(1.0);
            let _ = write!(bars, r#"<rect x="{}" y="{:.1}" width="{bar_w}" height="{h:.1}" rx="2"><title>{} UTC: {}</title></rect>"#,
                i * (bar_w + gap), 120.0 - **v / peak * 110.0, esc(d), format_usd(**v));
        }
        let unit = if days.first().is_some_and(|(d, _)| d.len() > 10) { "hour" } else { "day" };
        let mut rows = String::new();
        for l in &self.lines {
            let sym = self.tokens.get(&l.token).map_or(l.token.clone(), |t| t.symbol.clone());
            let _ = write!(rows, "<tr><td>{}</td><td class=n>{}</td><td>{}</td><td class=n>{}</td><td class=n>{}</td></tr>",
                esc(l.role.label()), fmt_amount(self.amount(l)), esc(&sym), self.usd(l).map_or("—".to_owned(), format_usd), l.payouts);
        }
        let mut coins: Vec<(&String, &f64)> = self.by_coin_usd.iter().collect();
        coins.sort_by(|a, b| b.1.partial_cmp(a.1).unwrap_or(std::cmp::Ordering::Equal));
        let mut coin_rows = String::new();
        for (c, v) in coins.into_iter().take(15) {
            let _ = write!(coin_rows, r#"<tr><td><a href="https://zora.co/coin/base:{}">{}</a></td><td class=n>{}</td></tr>"#,
                esc(c), esc(self.coin_names.get(c).unwrap_or(c)), format_usd(*v));
        }
        let mut kpis = String::new();
        for (role, v) in self.by_role_usd() {
            if v > 0.0 {
                let _ = write!(kpis, "<div class=kpi><span>{}</span><b>{}</b></div>", esc(role.label()), format_usd(v));
            }
        }
        format!(r#"<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>{t}</title><style>
:root{{--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--line:#e7e5e4;--accent:#4f46e5}}
@media (prefers-color-scheme:dark){{:root{{--bg:#0c0a09;--fg:#f5f5f4;--muted:#a8a29e;--line:#292524;--accent:#818cf8}}}}
body{{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}}main{{max-width:880px;margin:0 auto;padding:32px 16px}}
h1{{font-size:24px;margin:0 0 4px}}.muted{{color:var(--muted);font-size:13px;word-break:break-all}}
.kpis{{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0}}.kpi{{border:1px solid var(--line);border-radius:10px;padding:12px 16px;min-width:150px}}
.kpi span{{display:block;color:var(--muted);font-size:12px}}.kpi b{{font-size:20px}}
table{{width:100%;border-collapse:collapse;margin:8px 0 24px}}td,th{{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left}}.n{{text-align:right;font-variant-numeric:tabular-nums}}
svg rect{{fill:var(--accent)}}a{{color:var(--accent)}}h2{{font-size:16px;margin:24px 0 4px}}
</style></head><body><main>
<h1>{t}</h1><div class=muted>{addrs}</div>
<div class=kpis><div class=kpi><span>Total earned (current prices)</span><b>{total}</b></div>{kpis}<div class=kpi><span>Reward events</span><b>{events}</b></div></div>
<h2>Earnings per {unit} (USD, UTC)</h2><svg viewBox="0 0 {vw} 122" width="100%" height="140" role="img" aria-label="Earnings per {unit}">{bars}</svg>
<h2>By role and token</h2><table><tr><th>Role</th><th class=n>Amount</th><th>Token</th><th class=n>USD now</th><th class=n>Payouts</th></tr>{rows}</table>
<h2>Top coins</h2><table><tr><th>Coin</th><th class=n>USD now</th></tr>{coin_rows}</table>
<p class=muted>USD values use current token prices from the Zora API, not prices at the time of each payout. Source: CoinMarketRewardsV4 / CoinTradeRewards events on Base. Generated by zora-coins (Rust).</p>
</main></body></html>"#,
            t = esc(title), addrs = esc(&self.addresses.join(", ")), total = format_usd(self.total_usd()), events = self.events,
            vw = days.len().max(24) * (bar_w + gap))
    }
}

/// `$1,234.56`, or `$0.0042` below a cent.
pub fn format_usd(x: f64) -> String {
    if x.abs() >= 0.01 || x == 0.0 {
        format!("${}", commas(&format!("{x:.2}")))
    } else {
        format!("${}", sig(x, 4))
    }
}

/// `x` to `n` significant digits, without trailing zeros (like Go's %g for small numbers).
fn sig(x: f64, n: i32) -> String {
    if x == 0.0 {
        return "0".into();
    }
    let decimals = (n - 1 - x.abs().log10().floor() as i32).clamp(0, 30) as usize;
    let s = format!("{x:.decimals$}");
    if s.contains('.') {
        s.trim_end_matches('0').trim_end_matches('.').to_owned()
    } else {
        s
    }
}

fn fmt_amount(x: f64) -> String {
    if x.abs() >= 1.0 {
        commas(&format!("{x:.4}"))
    } else {
        g6(x)
    }
}

/// Like C's %.6g, as the Go, Python and Java reports print: 0.000199321, 9.38878e-09.
fn g6(x: f64) -> String {
    if x == 0.0 {
        return "0".into();
    }
    let exp = x.abs().log10().floor() as i32;
    if (-4..6).contains(&exp) {
        return sig(x, 6);
    }
    let m = x / 10f64.powi(exp);
    let mant = format!("{m:.5}");
    let mant = mant.trim_end_matches('0').trim_end_matches('.');
    format!("{mant}e{}{:02}", if exp < 0 { '-' } else { '+' }, exp.abs())
}

fn commas(s: &str) -> String {
    let (neg, s) = s.strip_prefix('-').map_or((false, s), |r| (true, r));
    let (whole, frac) = s.split_once('.').unwrap_or((s, ""));
    let mut out = String::new();
    for (i, c) in whole.chars().enumerate() {
        if i > 0 && (whole.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    if !frac.is_empty() {
        out.push('.');
        out.push_str(frac);
    }
    if neg {
        format!("-{out}")
    } else {
        out
    }
}

async fn token_meta(client: Option<&Client>, address: &str) -> Token {
    let is_eth = address == ZERO_ADDRESS;
    let mut fallback = Token { address: address.to_owned(), symbol: format!("{}…", &address[..address.len().min(8)]), decimals: 18, price_usd: None };
    if is_eth {
        fallback.symbol = "ETH".into();
    } else if address == USDC_ADDRESS {
        fallback = Token { address: address.to_owned(), symbol: "USDC".into(), decimals: 6, price_usd: Some(1.0) };
    }
    let Some(client) = client else { return fallback };
    let lookup = if is_eth { WETH_ADDRESS } else { address }; // ETH is priced as WETH
    match client.token_info(lookup, None).await {
        Ok(Some(info)) => match info.currency {
            Some(cur) => Token {
                address: address.to_owned(),
                symbol: if is_eth { "ETH".into() } else { cur.symbol.unwrap_or(fallback.symbol) },
                decimals: cur.decimals.map_or(18, |d| d as u32),
                price_usd: cur.price_usd.and_then(|p| p.parse().ok()),
            },
            None => fallback,
        },
        _ => fallback,
    }
}

/// Sum what `addresses` earned in `events`, per role and token, valued with current prices from
/// `client` (pass `None` to skip pricing and name lookups).
pub async fn build_report<A: AsRef<str>>(events: &[Event], addresses: &[A], client: Option<&Client>) -> Report {
    let watch: HashSet<String> = addresses.iter().map(|a| a.as_ref().to_lowercase()).collect();
    let mut sorted_addrs: Vec<String> = watch.iter().cloned().collect();
    sorted_addrs.sort();
    let mut lines: BTreeMap<(Role, String), Line> = BTreeMap::new();
    let mut credits: Vec<(&Event, String, BigUint)> = Vec::new();
    for e in events {
        for (role, p) in &e.payouts {
            if !watch.contains(&p.recipient) {
                continue;
            }
            let coin = if e.coin.is_empty() { ZERO_ADDRESS.to_owned() } else { e.coin.clone() };
            for (token, amt) in [(e.currency.clone(), &p.currency), (coin, &p.coin)] {
                if *amt == BigUint::default() {
                    continue;
                }
                let line = lines.entry((*role, token.clone())).or_insert_with(|| Line { role: *role, token: token.clone(), raw: BigUint::default(), payouts: 0 });
                line.raw += amt;
                line.payouts += 1;
                credits.push((e, token, amt.clone()));
            }
        }
    }
    let mut tokens = HashMap::new();
    for (_, token) in lines.keys() {
        if !tokens.contains_key(token) {
            tokens.insert(token.clone(), token_meta(client, token).await);
        }
    }
    let span = match (events.first(), events.last()) {
        (Some(a), Some(b)) => b.timestamp() - a.timestamp(),
        _ => 0,
    };
    let (mut by_coin_usd, mut by_time_usd) = (HashMap::new(), BTreeMap::new());
    for (e, token, raw) in &credits {
        let Some(t) = tokens.get(token) else { continue };
        let Some(price) = t.price_usd else { continue };
        let usd = to_f64(raw, t.decimals) * price;
        if !e.coin.is_empty() {
            *by_coin_usd.entry(e.coin.clone()).or_insert(0.0) += usd;
        }
        *by_time_usd.entry(bucket(e.timestamp(), span <= 3 * 86_400)).or_insert(0.0) += usd;
    }
    let mut coin_names = HashMap::new();
    if let Some(client) = client {
        let mut top: Vec<(&String, &f64)> = by_coin_usd.iter().collect();
        top.sort_by(|a, b| b.1.partial_cmp(a.1).unwrap_or(std::cmp::Ordering::Equal));
        for (coin, _) in top.into_iter().take(15) {
            let name = match client.coin(coin, None).await {
                Ok(Some(c)) => c.symbol.unwrap_or_else(|| coin.clone()),
                _ => coin.clone(),
            };
            coin_names.insert(coin.clone(), name);
        }
    }
    Report {
        addresses: sorted_addrs,
        events: events.len(),
        first_block: events.iter().map(|e| e.block).min(),
        last_block: events.iter().map(|e| e.block).max(),
        lines: lines.into_values().collect(),
        tokens,
        by_coin_usd,
        by_time_usd,
        coin_names,
    }
}

/// "2026-09-18 14:00" or "2026-09-18", UTC, without a date library.
fn bucket(ts: i64, hourly: bool) -> String {
    let days = ts.div_euclid(86_400);
    let secs = ts.rem_euclid(86_400);
    // civil-from-days (Howard Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    if hourly {
        format!("{y:04}-{m:02}-{d:02} {:02}:00", secs / 3600)
    } else {
        format!("{y:04}-{m:02}-{d:02}")
    }
}
