#!/usr/bin/env node
import {
  DEFAULT_RPC,
  Indexer,
  MemoryStore,
  ROLE_LABELS,
  buildReport
} from "./chunk-EREPJF44.js";
import {
  ZoraCoins
} from "./chunk-MC5X4F4G.js";

// src/cli.ts
import { existsSync, readFileSync, writeFileSync } from "fs";
import { parseArgs } from "util";
var USAGE = `usage: zora-rewards [options] ADDRESS...

Reports the Zora creator and referral rewards paid to addresses on Base.

options:
  --days N         how far back to scan (default 30)
  --from-block N   scan from this block instead
  --v3             also scan legacy V3 coins
  --rpc URL        Base JSON-RPC URL (default ${DEFAULT_RPC}; a private RPC is faster)
  --db FILE        where scanned events are kept between runs (default zora-rewards.json)
  --html FILE      also write an HTML report
  --json           print the report as JSON
  --no-scan        report from what is stored, without scanning`;
async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        days: { type: "string", default: "30" },
        "from-block": { type: "string" },
        v3: { type: "boolean", default: false },
        rpc: { type: "string", default: DEFAULT_RPC },
        db: { type: "string", default: "zora-rewards.json" },
        html: { type: "string" },
        json: { type: "boolean", default: false },
        "no-scan": { type: "boolean", default: false },
        help: { type: "boolean", short: "h" }
      }
    });
  } catch (e) {
    console.error(`zora-rewards: ${e.message}

${USAGE}`);
    return 2;
  }
  const { values: o, positionals: addrs } = parsed;
  if (o.help || !addrs.length) {
    console.error(USAGE);
    return o.help ? 0 : 2;
  }
  const store = existsSync(o.db) ? MemoryStore.fromJSON(readFileSync(o.db, "utf8")) : new MemoryStore();
  const idx = new Indexer(store, o.rpc);
  if (!o["no-scan"]) {
    const fromBlock = o["from-block"] ? Number(o["from-block"]) : void 0;
    const n = await idx.scan(addrs, {
      ...fromBlock === void 0 ? { days: Number(o.days) } : { fromBlock },
      includeV3: o.v3,
      onProgress: (done, total, found) => {
        writeFileSync(o.db, store.toJSON());
        process.stderr.write(`\r  scanned ${done}/${total} blocks (${total ? Math.round(100 * done / total) : 100}%) \xB7 ${found} matching reward events`);
      }
    });
    writeFileSync(o.db, store.toJSON());
    process.stderr.write(`
  ${n} new reward events saved to ${o.db}
`);
  }
  const report = await buildReport(store.eventsFor(addrs), addrs, new ZoraCoins());
  if (o.json) {
    console.log(JSON.stringify({
      addresses: report.addresses,
      events: report.events,
      firstBlock: report.firstBlock,
      lastBlock: report.lastBlock,
      totalUsd: report.totalUsd,
      lines: report.lines.map((l) => ({
        role: l.role,
        label: ROLE_LABELS[l.role],
        token: l.token,
        symbol: report.tokens.get(l.token)?.symbol,
        raw: l.raw.toString(),
        amount: report.amount(l),
        usd: report.usd(l),
        payouts: l.payouts
      }))
    }, null, 1));
  } else {
    process.stdout.write(report.toText());
  }
  if (o.html) {
    writeFileSync(o.html, report.toHtml());
    process.stderr.write(`  wrote ${o.html}
`);
  }
  return 0;
}
main().then((code) => process.exit(code), (err) => {
  console.error(`zora-rewards: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
//# sourceMappingURL=cli.js.map