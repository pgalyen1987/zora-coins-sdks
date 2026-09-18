//! zora-rewards: what addresses earned from Zora coin trading fees, read from Base.
//!
//! ```sh
//! cargo install zora-coins --features cli
//! zora-rewards 0xYourAddress                     # last 30 days: scan, then print the report
//! zora-rewards --days 7 --html rewards.html 0xA 0xB
//! zora-rewards --json 0xA > rewards.json
//! ```

use std::io::Write;
use std::process::ExitCode;

use zora_coins::rewards::{build_report, FileStore, Indexer, ScanOptions, Store, DEFAULT_RPC};

const USAGE: &str = "usage: zora-rewards [options] ADDRESS...

Reports the Zora creator and referral rewards paid to addresses on Base.

options:
  --days N         how far back to scan (default 30)
  --from-block N   scan from this block instead
  --v3             also scan legacy V3 coins
  --rpc URL        Base JSON-RPC URL (default https://mainnet.base.org; a private RPC is faster)
  --db FILE        where scanned events are kept between runs (default zora-rewards.json)
  --html FILE      also write an HTML report
  --json           print the report as JSON
  --no-scan        report from what is stored, without scanning";

struct Args {
    days: f64,
    from_block: Option<u64>,
    v3: bool,
    rpc: String,
    db: String,
    html: Option<String>,
    json: bool,
    scan: bool,
    addresses: Vec<String>,
}

fn parse() -> Result<Args, String> {
    let mut a = Args { days: 30.0, from_block: None, v3: false, rpc: DEFAULT_RPC.into(), db: "zora-rewards.json".into(), html: None, json: false, scan: true, addresses: vec![] };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        let mut value = |name: &str| it.next().ok_or(format!("{name} needs a value"));
        match arg.as_str() {
            "-h" | "--help" => return Err(String::new()),
            "--days" => a.days = value("--days")?.parse().map_err(|_| "--days must be a number")?,
            "--from-block" => a.from_block = Some(value("--from-block")?.parse().map_err(|_| "--from-block must be a number")?),
            "--v3" => a.v3 = true,
            "--rpc" => a.rpc = value("--rpc")?,
            "--db" => a.db = value("--db")?,
            "--html" => a.html = Some(value("--html")?),
            "--json" => a.json = true,
            "--no-scan" => a.scan = false,
            s if s.starts_with("--") => return Err(format!("unknown option {s}")),
            s => a.addresses.push(s.to_owned()),
        }
    }
    if a.addresses.is_empty() {
        return Err("give at least one address".into());
    }
    Ok(a)
}

#[tokio::main]
async fn main() -> ExitCode {
    let args = match parse() {
        Ok(a) => a,
        Err(msg) => {
            if !msg.is_empty() {
                eprintln!("zora-rewards: {msg}\n");
            }
            eprintln!("{USAGE}");
            return ExitCode::from(2);
        }
    };
    match run(args).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("zora-rewards: {e}");
            ExitCode::FAILURE
        }
    }
}

async fn run(args: Args) -> zora_coins::Result<()> {
    let store = FileStore::open(&args.db)?;
    let mut idx = Indexer::new(store, Some(&args.rpc)).on_progress(|done, total, found| {
        let pct = if total > 0 { 100.0 * done as f64 / total as f64 } else { 100.0 };
        eprint!("\r  scanned {done}/{total} blocks ({pct:.0}%) · {found} matching reward events");
        let _ = std::io::stderr().flush();
    });
    if args.scan {
        let opt = ScanOptions { days: args.from_block.is_none().then_some(args.days), from_block: args.from_block, include_v3: args.v3, ..Default::default() };
        let n = idx.scan(&args.addresses, opt).await?;
        eprintln!("\n  {n} new reward events saved to {}", args.db);
    }
    let who: Vec<&str> = args.addresses.iter().map(String::as_str).collect();
    let events = idx.store().events_for(&who, 0)?;
    let client = zora_coins::Client::new();
    let report = build_report(&events, &who, Some(&client)).await;
    if args.json {
        let mut v = serde_json::to_value(&report)?;
        v["total_usd"] = serde_json::json!(report.total_usd());
        println!("{}", serde_json::to_string_pretty(&v)?);
    } else {
        print!("{}", report.to_text());
    }
    if let Some(path) = args.html {
        std::fs::write(&path, report.to_html("Zora rewards")).map_err(|e| zora_coins::Error::Other(format!("writing {path}: {e}")))?;
        eprintln!("  wrote {path}");
    }
    Ok(())
}
