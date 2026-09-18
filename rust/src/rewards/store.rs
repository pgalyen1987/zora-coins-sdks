use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::events::Event;
use crate::error::{Error, Result};

/// Keeps indexed events and which block ranges were scanned for which address, so a second scan
/// only fetches new blocks. [`MemoryStore`] and [`FileStore`] are provided; implement it to keep
/// events in your own database.
pub trait Store {
    /// Store `events` and record that `[from, to]` was scanned for `addresses` at `version`.
    fn save(&mut self, events: Vec<Event>, addresses: &[String], version: u8, from: u64, to: u64) -> Result<()>;
    /// Merged ranges already scanned for `address` at `version`.
    fn scanned(&self, address: &str, version: u8) -> Result<Vec<(u64, u64)>>;
    /// Stored events paying any of `addresses`, from `since_block`, oldest first.
    fn events_for(&self, addresses: &[&str], since_block: u64) -> Result<Vec<Event>>;
}

/// Everything in memory.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct MemoryStore {
    events: BTreeMap<String, Event>,
    scans: HashMap<String, Vec<(u64, u64)>>,
}

fn scan_key(address: &str, version: u8) -> String {
    format!("{}@v{version}", address.to_lowercase())
}

impl Store for MemoryStore {
    fn save(&mut self, events: Vec<Event>, addresses: &[String], version: u8, from: u64, to: u64) -> Result<()> {
        for e in events {
            self.events.insert(e.key(), e);
        }
        for a in addresses {
            let ranges = self.scans.entry(scan_key(a, version)).or_default();
            ranges.push((from, to));
            *ranges = merge(std::mem::take(ranges));
        }
        Ok(())
    }

    fn scanned(&self, address: &str, version: u8) -> Result<Vec<(u64, u64)>> {
        Ok(self.scans.get(&scan_key(address, version)).cloned().unwrap_or_default())
    }

    fn events_for(&self, addresses: &[&str], since_block: u64) -> Result<Vec<Event>> {
        let watch: HashSet<String> = addresses.iter().map(|a| a.to_lowercase()).collect();
        let mut out: Vec<Event> = self.events.values().filter(|e| e.block >= since_block && e.pays(&watch)).cloned().collect();
        out.sort_by_key(|e| (e.block, e.log_index));
        Ok(out)
    }
}

/// A [`MemoryStore`] saved to one JSON file after every change, so scans resume across runs with no
/// database. Fine for thousands of events; implement [`Store`] for more.
#[derive(Debug)]
pub struct FileStore {
    inner: MemoryStore,
    path: PathBuf,
}

impl FileStore {
    /// Load `path` if it exists, or start empty.
    pub fn open(path: impl Into<PathBuf>) -> Result<Self> {
        let path = path.into();
        let inner = match std::fs::read(&path) {
            Ok(b) => serde_json::from_slice(&b)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => MemoryStore::default(),
            Err(e) => return Err(Error::Other(format!("reading {}: {e}", path.display()))),
        };
        Ok(Self { inner, path })
    }
}

impl Store for FileStore {
    fn save(&mut self, events: Vec<Event>, addresses: &[String], version: u8, from: u64, to: u64) -> Result<()> {
        self.inner.save(events, addresses, version, from, to)?;
        let tmp = self.path.with_extension("tmp");
        std::fs::write(&tmp, serde_json::to_vec(&self.inner)?).map_err(|e| Error::Other(format!("writing {}: {e}", tmp.display())))?;
        std::fs::rename(&tmp, &self.path).map_err(|e| Error::Other(format!("saving {}: {e}", self.path.display())))
    }

    fn scanned(&self, address: &str, version: u8) -> Result<Vec<(u64, u64)>> {
        self.inner.scanned(address, version)
    }

    fn events_for(&self, addresses: &[&str], since_block: u64) -> Result<Vec<Event>> {
        self.inner.events_for(addresses, since_block)
    }
}

pub(crate) fn merge(mut ranges: Vec<(u64, u64)>) -> Vec<(u64, u64)> {
    ranges.sort_unstable();
    let mut out: Vec<(u64, u64)> = Vec::new();
    for (lo, hi) in ranges {
        match out.last_mut() {
            Some(last) if lo <= last.1.saturating_add(1) => last.1 = last.1.max(hi),
            _ => out.push((lo, hi)),
        }
    }
    out
}

/// The parts of `[lo, hi]` not covered by `have`.
pub(crate) fn missing(lo: u64, hi: u64, have: &[(u64, u64)]) -> Vec<(u64, u64)> {
    let mut gaps = Vec::new();
    let mut cur = lo;
    for (a, b) in merge(have.to_vec()) {
        if b < cur || a > hi {
            continue;
        }
        if a > cur {
            gaps.push((cur, a - 1));
        }
        cur = cur.max(b + 1);
    }
    if cur <= hi {
        gaps.push((cur, hi));
    }
    gaps
}
