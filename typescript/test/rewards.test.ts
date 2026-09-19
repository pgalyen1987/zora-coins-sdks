import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { Indexer, MemoryStore, TOPIC_CREATOR_COIN_REWARDS, TOPIC_MARKET_REWARDS_V4, TOPIC_TRADE_REWARDS_V3, addressTopic, buildReport, decodeLog, formatUsd, missingRanges, type Log } from "../src/rewards/index.js";

const logs: Log[] = JSON.parse(readFileSync(new URL("../../fixtures/rewards_v4_logs.json", import.meta.url), "utf8"));
const w = (n: number) => n.toString(16).padStart(64, "0");
// Two real logs from one Base trade (tx 0x53f27c…f195): a CreatorCoinRewards payout for a creator coin and a
// CoinMarketRewardsV4 payout for a content coin, both to the same creator.
const cc: Log[] = JSON.parse(readFileSync(new URL("../../fixtures/creator_coin_rewards_logs.json", import.meta.url), "utf8"));
const CREATOR = "0xf4acf3edc65df843630976459ab1349a88258e6d";

describe("rewards", () => {
  it("decodes a real V4 log", () => {
    const e = decodeLog(logs[0]!)!;
    expect(e.version).toBe(4);
    expect(e.block).toBe(Number(BigInt(logs[0]!.blockNumber)));
    expect(e.payouts.creator.recipient).toBe("0x" + logs[0]!.data.slice(2 + 2 * 64 + 24, 2 + 3 * 64));
    expect(e.payouts.creator.currency).toBe(BigInt("0x" + logs[0]!.data.slice(2 + 7 * 64, 2 + 8 * 64)));
  });

  it("decodes V3 and ignores other events", () => {
    const [p, pl, t] = ["11", "22", "33"].map((b) => "0x" + b.repeat(20)) as [string, string, string];
    const e = decodeLog({ address: "0x" + "ab".repeat(20), blockNumber: "0x1c9c380", transactionHash: "0x" + "cd".repeat(32), logIndex: "0x5",
      topics: [TOPIC_TRADE_REWARDS_V3, addressTopic(p), addressTopic(pl), addressTopic(t)],
      data: "0x" + "0".repeat(24) + "44".repeat(20) + w(100) + w(25) + w(4) + w(20) + "0".repeat(24) + "55".repeat(20) })!;
    expect([e.version, e.payouts.platform_referrer.recipient, e.payouts.trade_referrer.currency]).toEqual([3, pl, 4n]);
    expect(decodeLog({ ...logs[0]!, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"] })).toBeNull();
  });

  it("computes missing ranges", () => {
    expect(missingRanges(100, 200, [[120, 130], [125, 150], [190, 250]])).toEqual([[100, 119], [151, 189]]);
  });

  it("scans, resumes, and shrinks chunks a node refuses", async () => {
    const first = decodeLog(logs[0]!)!;
    const who = first.payouts.creator.recipient;
    let calls = 0;
    const node = (async (_: unknown, init: RequestInit) => {
      calls++;
      const req = JSON.parse(String(init.body));
      if (req.method === "eth_blockNumber") return Response.json({ jsonrpc: "2.0", id: 1, result: "0x" + (first.block + 500).toString(16) });
      const lo = Number(BigInt(req.params[0].fromBlock)), hi = Number(BigInt(req.params[0].toBlock));
      if (hi - lo + 1 > 700) return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32600, message: "block range too large" } });
      return Response.json({ jsonrpc: "2.0", id: 1, result: logs.filter((l) => { const b = Number(BigInt(l.blockNumber)); return b >= lo && b <= hi; }) });
    }) as typeof fetch;
    const store = new MemoryStore();
    const idx = new Indexer(store, "http://node", node);
    const n = await idx.scan([who.toUpperCase().replace("0X", "0x")], { fromBlock: first.block - 1000 });
    expect(n).toBeGreaterThan(0);
    expect(store.eventsFor([who])).toHaveLength(n);
    const before = calls;
    expect(await idx.scan([who], { fromBlock: first.block - 1000 })).toBe(0);
    expect(calls - before).toBe(1);
    const restored = MemoryStore.fromJSON(store.toJSON());
    expect(restored.eventsFor([who])[0]!.payouts.creator.currency).toBe(store.eventsFor([who])[0]!.payouts.creator.currency);
  });

  it("builds text and HTML reports without pricing", async () => {
    const events = logs.map(decodeLog).filter((e) => e !== null);
    const who = events[0]!.payouts.platform_referrer.recipient;
    const r = await buildReport(events, [who]);
    expect(r.lines[0]!.role).toBe("platform_referrer");
    expect(r.toText()).toContain("Platform referral");
    expect(r.toHtml()).toContain("<svg");
    expect([formatUsd(0), formatUsd(1234.5), formatUsd(0.0042)]).toEqual(["$0.00", "$1,234.50", "$0.0042"]);
  });

  it("decodes a real CreatorCoinRewards log (the creator's and protocol's shares on a creator-coin trade)", () => {
    expect(cc[0]!.topics[0]).toBe(TOPIC_CREATOR_COIN_REWARDS);
    const e = decodeLog(cc[0]!)!;
    expect([e.version, e.coin, e.currency]).toEqual([4, "0x3177fa60b8a342cd044badf34bf820c536094656", "0x1111111111166b7fe7bd91427724b487980afc69"]);
    expect(e.payouts.creator).toEqual({ recipient: CREATOR, currency: 11879451646867555805n, coin: 0n });
    expect(e.payouts.protocol.currency).toBe(11879451646867555805n);
    expect(e.payouts.platform_referrer.currency + e.payouts.trade_referrer.currency + e.payouts.doppler.currency).toBe(0n);
  });

  it("scans both V4 payout events, and a store saved before that rescans its V4 blocks once", async () => {
    const block = Number(BigInt(cc[0]!.blockNumber));
    const topicsAsked: unknown[] = [];
    let calls = 0;
    const node = (async (_: unknown, init: RequestInit) => {
      calls++;
      const req = JSON.parse(String(init.body));
      if (req.method === "eth_blockNumber") return Response.json({ jsonrpc: "2.0", id: 1, result: "0x" + (block + 10).toString(16) });
      topicsAsked.push(req.params[0].topics);
      const lo = Number(BigInt(req.params[0].fromBlock)), hi = Number(BigInt(req.params[0].toBlock));
      return Response.json({ jsonrpc: "2.0", id: 1, result: cc.filter((l) => { const b = Number(BigInt(l.blockNumber)); return b >= lo && b <= hi; }) });
    }) as typeof fetch;
    // what an earlier version saved: these blocks scanned for CoinMarketRewardsV4 only (no format field)
    const old = JSON.stringify({ events: [], scans: { [`${CREATOR}@v4`]: [[block - 5, block + 10]] } });
    const store = MemoryStore.fromJSON(old);
    const idx = new Indexer(store, "http://node", node);
    expect(await idx.scan([CREATOR], { fromBlock: block - 5 })).toBe(2);
    expect(topicsAsked.every((t) => JSON.stringify(t) === JSON.stringify([[TOPIC_MARKET_REWARDS_V4, TOPIC_CREATOR_COIN_REWARDS]]))).toBe(true);
    const again = MemoryStore.fromJSON(store.toJSON()); // saved now: its ranges count
    const before = calls;
    expect(await new Indexer(again, "http://node", node).scan([CREATOR], { fromBlock: block - 5 })).toBe(0);
    expect(calls - before).toBe(1); // only eth_blockNumber
  });
});
