/**
 * What Zora pays creators and referrers, read straight from Base.
 *
 * Every trade of a Zora coin splits its fee between the coin's creator (the payout recipient), the
 * platform that launched it, the interface that routed the trade, the protocol, and Doppler. On V4
 * coins those payouts are `CoinMarketRewardsV4` events, and none of their fields are indexed: no node
 * can answer "rewards paid to this address". This module reads every reward event in a block range,
 * keeps the ones paying the addresses you watch, and remembers what it scanned so a re-run only
 * fetches new blocks. Amounts are exact `bigint`s.
 *
 * ```ts
 * import { Indexer, MemoryStore, buildReport } from "zora-coins/rewards";
 * import { ZoraCoins } from "zora-coins";
 *
 * const idx = new Indexer(new MemoryStore());
 * await idx.scan(["0xYourAddress"], { days: 7 });
 * const report = await buildReport(idx.store.eventsFor(["0xYourAddress"]), ["0xYourAddress"], new ZoraCoins());
 * console.log(report.toText());
 * ```
 * @module
 */
import { USDC_ADDRESS, WETH_ADDRESS, type ZoraCoins } from "../index.js";

export const TOPIC_MARKET_REWARDS_V4 = "0x35b5031218696db1dfd903223a47f38e66a1998e14a942a5d60fddaa49a685fc";
export const TOPIC_TRADE_REWARDS_V3 = "0x6b67f906562afcdc3afeeeb6754e906cc24d9ce090e9db1b7b68e6462682d966";
/**
 * keccak256("CreatorCoinRewards(address,address,address,address,uint256,uint256)"): the V4 hooks' payout
 * on creator-coin trades, creator and protocol shares only. The coin is indexed, the recipients are not.
 * In a sample day on Base it carried about a third of all payouts and nearly half of what creators earned.
 */
export const TOPIC_CREATOR_COIN_REWARDS = "0xea92473287be4e55f8279d0b8395a45960a217ae2f1a76ac9cae84af58a751ed";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
/** Base makes a block exactly every 2 seconds from this Unix time, so a block's time needs no RPC. */
export const BASE_GENESIS_TIMESTAMP = 1686789347;
/** Base's public JSON-RPC endpoint. A private RPC is much faster for long histories. */
export const DEFAULT_RPC = "https://mainnet.base.org";
/** No CoinMarketRewardsV4 events exist before this block (2025-06-01), so full scans start here. */
export const V4_FIRST_BLOCK = 31_000_000;
export const V3_FIRST_BLOCK = 27_000_000;

/** Who a payout goes to, in report order. */
export const ROLES = ["creator", "platform_referrer", "trade_referrer", "protocol", "doppler"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  creator: "Creator payouts", platform_referrer: "Platform referral", trade_referrer: "Trade referral", protocol: "Protocol", doppler: "Doppler",
};

/** What one role received in one event: `currency` in {@link RewardEvent.currency}, `coin` in the traded coin. */
export interface Payout {
  recipient: string;
  currency: bigint;
  coin: bigint;
}

/** One reward distribution. */
export interface RewardEvent {
  block: number;
  txHash: string;
  logIndex: number;
  emitter: string;
  version: 3 | 4;
  coin: string;
  currency: string;
  payouts: Record<Role, Payout>;
}

/** An `eth_getLogs` entry, as JSON-RPC returns it. */
export interface Log {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}

export const eventTime = (e: RewardEvent): number => BASE_GENESIS_TIMESTAMP + 2 * e.block;
export const blockAt = (unixSeconds: number): number => Math.max(0, Math.floor((unixSeconds - BASE_GENESIS_TIMESTAMP) / 2));
export const addressTopic = (a: string): string => "0x" + "0".repeat(24) + a.toLowerCase().replace(/^0x/, "");

const word = (data: string, i: number) => data.slice(2 + i * 64, 2 + (i + 1) * 64);
const addr = (w: string) => (w.length >= 40 ? "0x" + w.slice(-40).toLowerCase() : ZERO_ADDRESS);
const uint = (w: string) => (w ? BigInt("0x" + w) : 0n);

/** Decode a log into a {@link RewardEvent}, or `null` if it isn't a Zora reward event. */
export function decodeLog(l: Log): RewardEvent | null {
  const t0 = l.topics[0]?.toLowerCase();
  const n = Math.floor((l.data.length - 2) / 64);
  const base = { block: Number(BigInt(l.blockNumber)), txHash: l.transactionHash.toLowerCase(), logIndex: Number(BigInt(l.logIndex)), emitter: l.address.toLowerCase() };
  if (t0 === TOPIC_MARKET_REWARDS_V4 && n >= 17) {
    const w = (i: number) => word(l.data, i);
    const p = (r: number, c: number) => ({ recipient: addr(w(r)), currency: uint(w(c)), coin: uint(w(c + 1)) });
    return { ...base, version: 4, coin: addr(w(0)), currency: addr(w(1)),
      payouts: { creator: p(2, 7), platform_referrer: p(3, 9), trade_referrer: p(4, 11), protocol: p(5, 13), doppler: p(6, 15) } };
  }
  if (t0 === TOPIC_CREATOR_COIN_REWARDS && l.topics.length >= 2 && n >= 5) {
    const w = (i: number) => word(l.data, i);
    const none = { recipient: ZERO_ADDRESS, currency: 0n, coin: 0n };
    return { ...base, version: 4, coin: addr((l.topics[1] ?? "").replace(/^0x/, "")), currency: addr(w(0)),
      payouts: {
        creator: { recipient: addr(w(1)), currency: uint(w(3)), coin: 0n },
        platform_referrer: { ...none }, trade_referrer: { ...none },
        protocol: { recipient: addr(w(2)), currency: uint(w(4)), coin: 0n },
        doppler: { ...none },
      } };
  }
  if (t0 === TOPIC_TRADE_REWARDS_V3 && l.topics.length >= 4 && n >= 6) {
    const w = (i: number) => word(l.data, i);
    const topic = (i: number) => addr((l.topics[i] ?? "").replace(/^0x/, ""));
    return { ...base, version: 3, coin: base.emitter, currency: addr(w(5)),
      payouts: {
        creator: { recipient: topic(1), currency: uint(w(1)), coin: 0n },
        platform_referrer: { recipient: topic(2), currency: uint(w(2)), coin: 0n },
        trade_referrer: { recipient: topic(3), currency: uint(w(3)), coin: 0n },
        protocol: { recipient: addr(w(0)), currency: uint(w(4)), coin: 0n },
        doppler: { recipient: ZERO_ADDRESS, currency: 0n, coin: 0n },
      } };
  }
  return null;
}

const pays = (e: RewardEvent, watch: Set<string>) => ROLES.some((r) => e.payouts[r].recipient !== ZERO_ADDRESS && watch.has(e.payouts[r].recipient));
const keyOf = (e: RewardEvent) => `${e.txHash}:${e.logIndex}`;

// ---- storage ---------------------------------------------------------------------------------

/**
 * Keeps indexed events and the block ranges scanned per address. Implement it for your own database.
 * Upgrading from a version that didn't read CreatorCoinRewards: clear your stored V4 ranges once, so
 * those blocks are scanned again for it ({@link MemoryStore} does this itself).
 */
export interface Store {
  save(events: RewardEvent[], addresses: string[], version: 3 | 4, from: number, to: number): void | Promise<void>;
  scanned(address: string, version: 3 | 4): Array<[number, number]> | Promise<Array<[number, number]>>;
}

export function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [lo, hi] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

export function missingRanges(lo: number, hi: number, have: Array<[number, number]>): Array<[number, number]> {
  const gaps: Array<[number, number]> = [];
  let cur = lo;
  for (const [a, b] of mergeRanges(have)) {
    if (b < cur || a > hi) continue;
    if (a > cur) gaps.push([cur, a - 1]);
    cur = Math.max(cur, b + 1);
  }
  if (cur <= hi) gaps.push([cur, hi]);
  return gaps;
}

/** 2: V4 scans cover CreatorCoinRewards as well as CoinMarketRewardsV4. */
const STORE_FORMAT = 2;

/**
 * Everything in memory. `toJSON()` / `MemoryStore.fromJSON()` persist it anywhere — a file on Node,
 * localStorage in a browser — so scans resume across runs.
 */
export class MemoryStore implements Store {
  private events = new Map<string, RewardEvent>();
  private scans = new Map<string, Array<[number, number]>>();

  save(events: RewardEvent[], addresses: string[], version: 3 | 4, from: number, to: number): void {
    for (const e of events) this.events.set(keyOf(e), e);
    for (const a of addresses) {
      const k = `${a.toLowerCase()}@v${version}`;
      this.scans.set(k, mergeRanges([...(this.scans.get(k) ?? []), [from, to]]));
    }
  }

  scanned(address: string, version: 3 | 4): Array<[number, number]> {
    return [...(this.scans.get(`${address.toLowerCase()}@v${version}`) ?? [])];
  }

  /** Stored events paying any of `addresses`, from `sinceBlock`, oldest first. */
  eventsFor(addresses: string[], sinceBlock = 0): RewardEvent[] {
    const watch = new Set(addresses.map((a) => a.toLowerCase()));
    return [...this.events.values()].filter((e) => e.block >= sinceBlock && pays(e, watch))
      .sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  }

  /** A JSON string of everything stored (amounts as decimal strings). */
  toJSON(): string {
    return JSON.stringify({ format: STORE_FORMAT, events: [...this.events.values()], scans: Object.fromEntries(this.scans) }, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  }

  /** Restore a store saved with {@link MemoryStore.toJSON}. */
  static fromJSON(json: string): MemoryStore {
    const s = new MemoryStore();
    const d = JSON.parse(json) as { format?: number; events: RewardEvent[]; scans: Record<string, Array<[number, number]>> };
    for (const e of d.events) {
      for (const r of ROLES) {
        const p = e.payouts[r];
        p.currency = BigInt(p.currency);
        p.coin = BigInt(p.coin);
      }
      s.events.set(keyOf(e), e);
    }
    for (const [k, v] of Object.entries(d.scans)) {
      // V4 ranges saved before CreatorCoinRewards was read were scanned for one event: scan them again
      if ((d.format ?? 1) < STORE_FORMAT && k.endsWith("@v4")) continue;
      s.scans.set(k, v);
    }
    return s;
  }
}

// ---- scanning --------------------------------------------------------------------------------

export class RpcError extends Error {
  constructor(readonly method: string, readonly code: number, message: string) {
    super(`rpc ${method}: ${code} ${message}`);
    this.name = "RpcError";
  }
}

export interface ScanOptions {
  /** Scan back this many days from now. */
  days?: number;
  /** Scan from this block (overrides `days`). With neither, all of V4 history. */
  fromBlock?: number;
  /** Stop here (default: the chain head). */
  toBlock?: number;
  /** Also scan legacy V3 coins. */
  includeV3?: boolean;
  /** Called after every chunk. */
  onProgress?: (done: number, total: number, found: number) => void;
  signal?: AbortSignal;
}

const tooLarge = (msg: string) => {
  const m = msg.toLowerCase();
  return !m.includes("rate") && ["range", "too many", "limit exceeded", "10000 results", "response size"].some((s) => m.includes(s));
};

/** Finds reward events paying a set of addresses and saves them in a {@link Store}. */
export class Indexer<S extends Store = MemoryStore> {
  /** Blocks per eth_getLogs for V4 (halved automatically when a node refuses). */
  step = 2000;
  maxRetries = 5;

  constructor(readonly store: S, readonly rpcUrl: string = DEFAULT_RPC, private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {}

  /** Index rewards paid to `addresses`; resolves to how many new matching events were stored. */
  async scan(addresses: string[], opt: ScanOptions = {}): Promise<number> {
    const addrs = [...new Set(addresses.map((a) => a.toLowerCase()))].sort();
    if (!addrs.length) throw new Error("rewards: no addresses to scan");
    for (const a of addrs) if (!/^0x[0-9a-f]{40}$/.test(a)) throw new Error(`rewards: ${a} is not an address`);
    const head = opt.toBlock ?? (await this.head(opt.signal));
    const start = opt.fromBlock ?? (opt.days !== undefined ? blockAt(Date.now() / 1000 - opt.days * 86400) : 0);
    const plan: Array<[3 | 4, number, number]> = [];
    for (const [v, floor] of [[4, V4_FIRST_BLOCK], ...(opt.includeV3 ? [[3, V3_FIRST_BLOCK]] : [])] as Array<[3 | 4, number]>) {
      const lo = Math.max(start, floor);
      if (lo > head) continue;
      const gaps: Array<[number, number]> = [];
      for (const a of addrs) gaps.push(...missingRanges(lo, head, await this.store.scanned(a, v)));
      for (const [a, b] of mergeRanges(gaps)) plan.push([v, a, b]);
    }
    const total = plan.reduce((n, [, a, b]) => n + b - a + 1, 0);
    const watch = new Set(addrs);
    let done = 0, found = 0;
    for (const [version, lo, hi] of plan) {
      let step = version === 3 ? this.step * 5 : this.step;
      for (let from = lo; from <= hi;) {
        const to = Math.min(from + step - 1, hi);
        let events: RewardEvent[];
        try {
          events = await this.fetchRange(version, from, to, addrs, opt.signal);
        } catch (err) {
          if (err instanceof RpcError && tooLarge(err.message) && step > 50) {
            step = Math.floor(step / 2); // this node caps log ranges or result sizes: retry smaller
            continue;
          }
          throw err;
        }
        const mine = events.filter((e) => pays(e, watch));
        await this.store.save(mine, addrs, version, from, to);
        found += mine.length;
        done += to - from + 1;
        opt.onProgress?.(done, total, found);
        from = to + 1;
      }
    }
    return found;
  }

  /** The latest block number. */
  async head(signal?: AbortSignal): Promise<number> {
    return Number(BigInt(await this.call<string>("eth_blockNumber", [], signal)));
  }

  private async fetchRange(version: 3 | 4, lo: number, hi: number, addrs: string[], signal?: AbortSignal): Promise<RewardEvent[]> {
    const span = { fromBlock: "0x" + lo.toString(16), toBlock: "0x" + hi.toString(16) };
    let logs: Log[] = [];
    if (version === 4) {
      // both V4 payout events in one call: topic0 is either
      logs = await this.call<Log[]>("eth_getLogs", [{ ...span, topics: [[TOPIC_MARKET_REWARDS_V4, TOPIC_CREATOR_COIN_REWARDS]] }], signal);
    } else {
      const topics = addrs.map(addressTopic);
      for (const pos of [1, 2, 3]) { // payoutRecipient, platformReferrer, tradeReferrer
        const filter: Array<string | string[] | null> = [TOPIC_TRADE_REWARDS_V3, null, null, null];
        filter[pos] = topics;
        logs.push(...(await this.call<Log[]>("eth_getLogs", [{ ...span, topics: filter }], signal)));
      }
    }
    const seen = new Set<string>();
    return logs.map(decodeLog).filter((e): e is RewardEvent => e !== null && !seen.has(keyOf(e)) && seen.add(keyOf(e)) !== undefined)
      .sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  }

  private async call<T>(method: string, params: unknown[], signal?: AbortSignal): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, Math.min(2 ** attempt, 20) * 1000));
      let resp: Response;
      try {
        resp = await this.fetchImpl(this.rpcUrl, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: signal ?? null });
      } catch (err) {
        if (signal?.aborted) throw err;
        last = err;
        continue;
      }
      if (resp.status === 429 || resp.status >= 500) {
        last = new RpcError(method, resp.status, `HTTP ${resp.status}`);
        continue;
      }
      const body = (await resp.json()) as { result?: T; error?: { code?: number; message?: string } };
      if (body.error) {
        const e = new RpcError(method, body.error.code ?? 0, body.error.message ?? "");
        if (/rate|timeout|busy/i.test(e.message)) {
          last = e;
          continue;
        }
        throw e;
      }
      return body.result as T;
    }
    throw last;
  }
}

// ---- reports ---------------------------------------------------------------------------------

export interface Token {
  address: string;
  symbol: string;
  decimals: number;
  priceUsd: number | null;
}

export interface Line {
  role: Role;
  token: string;
  raw: bigint;
  payouts: number;
}

const toNumber = (raw: bigint, decimals: number) => Number(raw) / 10 ** decimals;

/** `$1,234.56`, or `$0.0042` below a cent. */
export function formatUsd(x: number): string {
  if (Math.abs(x) >= 0.01 || x === 0) return "$" + x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return "$" + Number(x.toPrecision(4)).toString();
}

// Like C's %.6g, as the other SDKs print: 0.000199321, 9.38878e-09.
const fmtAmount = (x: number) => (Math.abs(x) >= 1
  ? x.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })
  : String(Number(x.toPrecision(6))).replace(/e([+-])(\d)$/, "e$10$2"));

/** What a set of addresses earned. USD uses current prices, not prices at payout time. */
export class Report {
  constructor(
    readonly addresses: string[],
    readonly events: number,
    readonly firstBlock: number | null,
    readonly lastBlock: number | null,
    readonly lines: Line[],
    readonly tokens: Map<string, Token>,
    readonly byCoinUsd: Map<string, number>,
    readonly byTimeUsd: Map<string, number>,
    readonly coinNames: Map<string, string>,
  ) {}

  amount(l: Line): number {
    return toNumber(l.raw, this.tokens.get(l.token)?.decimals ?? 18);
  }

  usd(l: Line): number | null {
    const p = this.tokens.get(l.token)?.priceUsd;
    return p == null ? null : this.amount(l) * p;
  }

  get totalUsd(): number {
    return this.lines.reduce((s, l) => s + (this.usd(l) ?? 0), 0);
  }

  byRoleUsd(): Map<Role, number> {
    const out = new Map<Role, number>();
    for (const l of this.lines) out.set(l.role, (out.get(l.role) ?? 0) + (this.usd(l) ?? 0));
    return out;
  }

  /** A plain-text table. */
  toText(): string {
    const rows = [`Zora rewards for ${this.addresses.join(", ")}`, `${this.events} reward events` + (this.firstBlock !== null ? `, blocks ${this.firstBlock}–${this.lastBlock}` : "")];
    for (const l of this.lines) {
      const sym = this.tokens.get(l.token)?.symbol ?? l.token;
      const usd = this.usd(l);
      rows.push(`  ${ROLE_LABELS[l.role].padEnd(18)} ${fmtAmount(this.amount(l)).padStart(16)} ${sym.padEnd(12)} ${(usd === null ? "—" : formatUsd(usd)).padStart(12)}  (${l.payouts} payouts)`);
    }
    rows.push(`  ${"Total (current prices)".padEnd(18)} ${"".padStart(16)} ${"".padEnd(12)} ${formatUsd(this.totalUsd).padStart(12)}`);
    return rows.join("\n") + "\n";
  }

  /** A self-contained HTML page (no external assets; light and dark themes). */
  toHtml(title = "Zora rewards"): string {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const days = [...this.byTimeUsd.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-60);
    const peak = Math.max(...days.map(([, v]) => v), Number.MIN_VALUE);
    const [barW, gap] = [12, 3];
    const bars = days.map(([d, v], i) => `<rect x="${i * (barW + gap)}" y="${(120 - (v / peak) * 110).toFixed(1)}" width="${barW}" height="${Math.max((v / peak) * 110, 1).toFixed(1)}" rx="2"><title>${esc(d)} UTC: ${formatUsd(v)}</title></rect>`).join("");
    const unit = days[0] && days[0][0].length > 10 ? "hour" : "day";
    const rows = this.lines.map((l) => `<tr><td>${esc(ROLE_LABELS[l.role])}</td><td class=n>${fmtAmount(this.amount(l))}</td><td>${esc(this.tokens.get(l.token)?.symbol ?? l.token)}</td><td class=n>${this.usd(l) === null ? "—" : formatUsd(this.usd(l)!)}</td><td class=n>${l.payouts}</td></tr>`).join("");
    const coins = [...this.byCoinUsd.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
      .map(([c, v]) => `<tr><td><a href="https://zora.co/coin/base:${esc(c)}">${esc(this.coinNames.get(c) ?? c)}</a></td><td class=n>${formatUsd(v)}</td></tr>`).join("");
    const kpis = [...this.byRoleUsd().entries()].filter(([, v]) => v > 0).map(([r, v]) => `<div class=kpi><span>${esc(ROLE_LABELS[r])}</span><b>${formatUsd(v)}</b></div>`).join("");
    return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--line:#e7e5e4;--accent:#4f46e5}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#f5f5f4;--muted:#a8a29e;--line:#292524;--accent:#818cf8}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}main{max-width:880px;margin:0 auto;padding:32px 16px}
h1{font-size:24px;margin:0 0 4px}.muted{color:var(--muted);font-size:13px;word-break:break-all}
.kpis{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0}.kpi{border:1px solid var(--line);border-radius:10px;padding:12px 16px;min-width:150px}
.kpi span{display:block;color:var(--muted);font-size:12px}.kpi b{font-size:20px}
table{width:100%;border-collapse:collapse;margin:8px 0 24px}td,th{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left}.n{text-align:right;font-variant-numeric:tabular-nums}
svg rect{fill:var(--accent)}a{color:var(--accent)}h2{font-size:16px;margin:24px 0 4px}
</style></head><body><main>
<h1>${esc(title)}</h1><div class=muted>${esc(this.addresses.join(", "))}</div>
<div class=kpis><div class=kpi><span>Total earned (current prices)</span><b>${formatUsd(this.totalUsd)}</b></div>${kpis}<div class=kpi><span>Reward events</span><b>${this.events}</b></div></div>
<h2>Earnings per ${unit} (USD, UTC)</h2><svg viewBox="0 0 ${Math.max(days.length, 24) * (barW + gap)} 122" width="100%" height="140" role="img" aria-label="Earnings per ${unit}">${bars}</svg>
<h2>By role and token</h2><table><tr><th>Role</th><th class=n>Amount</th><th>Token</th><th class=n>USD now</th><th class=n>Payouts</th></tr>${rows}</table>
<h2>Top coins</h2><table><tr><th>Coin</th><th class=n>USD now</th></tr>${coins}</table>
<p class=muted>USD values use current token prices from the Zora API, not prices at the time of each payout. Source: CoinMarketRewardsV4 / CoinTradeRewards events on Base. Generated by zora-coins (TypeScript).</p>
</main></body></html>`;
  }
}

async function tokenMeta(client: ZoraCoins | null, address: string): Promise<Token> {
  const isEth = address === ZERO_ADDRESS;
  const fallback: Token = isEth ? { address, symbol: "ETH", decimals: 18, priceUsd: null }
    : address === USDC_ADDRESS ? { address, symbol: "USDC", decimals: 6, priceUsd: 1 }
    : { address, symbol: address.slice(0, 8) + "…", decimals: 18, priceUsd: null };
  if (!client) return fallback;
  try {
    const cur = (await client.tokenInfo(isEth ? WETH_ADDRESS : address))?.currency; // ETH is priced as WETH
    if (!cur) return fallback;
    const price = cur.priceUsd ? Number(cur.priceUsd) : NaN;
    return { address, symbol: isEth ? "ETH" : (cur.symbol ?? fallback.symbol), decimals: cur.decimals ?? 18, priceUsd: Number.isFinite(price) ? price : null };
  } catch {
    return fallback;
  }
}

const bucket = (unix: number, hourly: boolean) => new Date(unix * 1000).toISOString().slice(0, hourly ? 13 : 10).replace("T", " ") + (hourly ? ":00" : "");

/** Sum what `addresses` earned in `events`, per role and token, valued with current prices from `client`. */
export async function buildReport(events: RewardEvent[], addresses: string[], client: ZoraCoins | null = null): Promise<Report> {
  const watch = new Set(addresses.map((a) => a.toLowerCase()));
  const lines = new Map<string, Line>();
  const credits: Array<[RewardEvent, string, bigint]> = [];
  for (const e of events) {
    for (const role of ROLES) {
      const p = e.payouts[role];
      if (!watch.has(p.recipient)) continue;
      for (const [token, raw] of [[e.currency, p.currency], [e.coin || ZERO_ADDRESS, p.coin]] as Array<[string, bigint]>) {
        if (raw <= 0n) continue;
        const k = `${role}|${token}`;
        const line = lines.get(k) ?? { role, token, raw: 0n, payouts: 0 };
        line.raw += raw;
        line.payouts++;
        lines.set(k, line);
        credits.push([e, token, raw]);
      }
    }
  }
  const tokens = new Map<string, Token>();
  for (const l of lines.values()) if (!tokens.has(l.token)) tokens.set(l.token, await tokenMeta(client, l.token));
  const sorted = [...lines.values()].sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.token.localeCompare(b.token));
  const span = events.length ? eventTime(events[events.length - 1]!) - eventTime(events[0]!) : 0;
  const byCoin = new Map<string, number>();
  const byTime = new Map<string, number>();
  for (const [e, token, raw] of credits) {
    const t = tokens.get(token);
    if (!t || t.priceUsd === null) continue;
    const usd = toNumber(raw, t.decimals) * t.priceUsd;
    if (e.coin) byCoin.set(e.coin, (byCoin.get(e.coin) ?? 0) + usd);
    const b = bucket(eventTime(e), span <= 3 * 86400);
    byTime.set(b, (byTime.get(b) ?? 0) + usd);
  }
  const names = new Map<string, string>();
  if (client) {
    for (const [coin] of [...byCoin.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      try {
        names.set(coin, (await client.coin(coin))?.symbol ?? coin);
      } catch {
        names.set(coin, coin);
      }
    }
  }
  const blocks = events.map((e) => e.block);
  return new Report([...watch].sort(), events.length, blocks.length ? Math.min(...blocks) : null, blocks.length ? Math.max(...blocks) : null,
    sorted, tokens, byCoin, byTime, names);
}
