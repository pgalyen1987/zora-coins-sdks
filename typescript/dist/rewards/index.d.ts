import { ZoraCoins } from '../index.js';

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

declare const TOPIC_MARKET_REWARDS_V4 = "0x35b5031218696db1dfd903223a47f38e66a1998e14a942a5d60fddaa49a685fc";
declare const TOPIC_TRADE_REWARDS_V3 = "0x6b67f906562afcdc3afeeeb6754e906cc24d9ce090e9db1b7b68e6462682d966";
declare const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
/** Base makes a block exactly every 2 seconds from this Unix time, so a block's time needs no RPC. */
declare const BASE_GENESIS_TIMESTAMP = 1686789347;
/** Base's public JSON-RPC endpoint. A private RPC is much faster for long histories. */
declare const DEFAULT_RPC = "https://mainnet.base.org";
/** No CoinMarketRewardsV4 events exist before this block (2025-06-01), so full scans start here. */
declare const V4_FIRST_BLOCK = 31000000;
declare const V3_FIRST_BLOCK = 27000000;
/** Who a payout goes to, in report order. */
declare const ROLES: readonly ["creator", "platform_referrer", "trade_referrer", "protocol", "doppler"];
type Role = (typeof ROLES)[number];
declare const ROLE_LABELS: Record<Role, string>;
/** What one role received in one event: `currency` in {@link RewardEvent.currency}, `coin` in the traded coin. */
interface Payout {
    recipient: string;
    currency: bigint;
    coin: bigint;
}
/** One reward distribution. */
interface RewardEvent {
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
interface Log {
    address: string;
    topics: string[];
    data: string;
    blockNumber: string;
    transactionHash: string;
    logIndex: string;
}
declare const eventTime: (e: RewardEvent) => number;
declare const blockAt: (unixSeconds: number) => number;
declare const addressTopic: (a: string) => string;
/** Decode a log into a {@link RewardEvent}, or `null` if it isn't a Zora reward event. */
declare function decodeLog(l: Log): RewardEvent | null;
/** Keeps indexed events and the block ranges scanned per address. Implement it for your own database. */
interface Store {
    save(events: RewardEvent[], addresses: string[], version: 3 | 4, from: number, to: number): void | Promise<void>;
    scanned(address: string, version: 3 | 4): Array<[number, number]> | Promise<Array<[number, number]>>;
}
declare function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]>;
declare function missingRanges(lo: number, hi: number, have: Array<[number, number]>): Array<[number, number]>;
/**
 * Everything in memory. `toJSON()` / `MemoryStore.fromJSON()` persist it anywhere — a file on Node,
 * localStorage in a browser — so scans resume across runs.
 */
declare class MemoryStore implements Store {
    private events;
    private scans;
    save(events: RewardEvent[], addresses: string[], version: 3 | 4, from: number, to: number): void;
    scanned(address: string, version: 3 | 4): Array<[number, number]>;
    /** Stored events paying any of `addresses`, from `sinceBlock`, oldest first. */
    eventsFor(addresses: string[], sinceBlock?: number): RewardEvent[];
    /** A JSON string of everything stored (amounts as decimal strings). */
    toJSON(): string;
    /** Restore a store saved with {@link MemoryStore.toJSON}. */
    static fromJSON(json: string): MemoryStore;
}
declare class RpcError extends Error {
    readonly method: string;
    readonly code: number;
    constructor(method: string, code: number, message: string);
}
interface ScanOptions {
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
/** Finds reward events paying a set of addresses and saves them in a {@link Store}. */
declare class Indexer<S extends Store = MemoryStore> {
    readonly store: S;
    readonly rpcUrl: string;
    private readonly fetchImpl;
    /** Blocks per eth_getLogs for V4 (halved automatically when a node refuses). */
    step: number;
    maxRetries: number;
    constructor(store: S, rpcUrl?: string, fetchImpl?: typeof fetch);
    /** Index rewards paid to `addresses`; resolves to how many new matching events were stored. */
    scan(addresses: string[], opt?: ScanOptions): Promise<number>;
    /** The latest block number. */
    head(signal?: AbortSignal): Promise<number>;
    private fetchRange;
    private call;
}
interface Token {
    address: string;
    symbol: string;
    decimals: number;
    priceUsd: number | null;
}
interface Line {
    role: Role;
    token: string;
    raw: bigint;
    payouts: number;
}
/** `$1,234.56`, or `$0.0042` below a cent. */
declare function formatUsd(x: number): string;
/** What a set of addresses earned. USD uses current prices, not prices at payout time. */
declare class Report {
    readonly addresses: string[];
    readonly events: number;
    readonly firstBlock: number | null;
    readonly lastBlock: number | null;
    readonly lines: Line[];
    readonly tokens: Map<string, Token>;
    readonly byCoinUsd: Map<string, number>;
    readonly byTimeUsd: Map<string, number>;
    readonly coinNames: Map<string, string>;
    constructor(addresses: string[], events: number, firstBlock: number | null, lastBlock: number | null, lines: Line[], tokens: Map<string, Token>, byCoinUsd: Map<string, number>, byTimeUsd: Map<string, number>, coinNames: Map<string, string>);
    amount(l: Line): number;
    usd(l: Line): number | null;
    get totalUsd(): number;
    byRoleUsd(): Map<Role, number>;
    /** A plain-text table. */
    toText(): string;
    /** A self-contained HTML page (no external assets; light and dark themes). */
    toHtml(title?: string): string;
}
/** Sum what `addresses` earned in `events`, per role and token, valued with current prices from `client`. */
declare function buildReport(events: RewardEvent[], addresses: string[], client?: ZoraCoins | null): Promise<Report>;

export { BASE_GENESIS_TIMESTAMP, DEFAULT_RPC, Indexer, type Line, type Log, MemoryStore, type Payout, ROLES, ROLE_LABELS, Report, type RewardEvent, type Role, RpcError, type ScanOptions, type Store, TOPIC_MARKET_REWARDS_V4, TOPIC_TRADE_REWARDS_V3, type Token, V3_FIRST_BLOCK, V4_FIRST_BLOCK, ZERO_ADDRESS, addressTopic, blockAt, buildReport, decodeLog, eventTime, formatUsd, mergeRanges, missingRanges };
