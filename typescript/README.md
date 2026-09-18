# zora-coins for TypeScript and JavaScript

Typed client for the [Zora Coins API](https://docs.zora.co/coins): all 30 endpoints, `for await` pagination, retries, a GraphQL client, and an onchain indexer for the creator and referral rewards Zora pays on Base. **Zero dependencies**: Node 20+, Bun, Deno and browsers.

> Unofficial and community-maintained. Not affiliated with Zora. Works alongside Zora's official [`@zoralabs/coins-sdk`](https://www.npmjs.com/package/@zoralabs/coins-sdk). This package adds the rewards indexer, the GraphQL client, and types shared with the Go, Rust, Python, C#, Java and C++ SDKs.

```sh
npm install zora-coins
```

## Quick start

```ts
import { ZoraCoins, ListType } from "zora-coins";

const zora = new ZoraCoins(); // reads ZORA_API_KEY on Node; or new ZoraCoins({ apiKey })

const coin = await zora.coin("0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b"); // null if there's no such coin
console.log(coin?.name, coin?.marketCap, coin?.creatorProfile?.handle);
```

Every response field is optional, because the API leaves fields out. Enum types also accept any string, so a value Zora adds later still type-checks.

## Pagination

```ts
import { nodes, nextCursor } from "zora-coins";

const page = await zora.coinHolders(addr, { pageSize: 50 });
nodes(page);      // TokenBalance[]
nextCursor(page); // undefined on the last page

for await (const holder of zora.iterCoinHolders(addr)) {
  console.log(holder.ownerAddress, holder.balance); // balance: 18-decimal integer string
}
```

Each page is fetched only when the loop reaches it. `break` stops.

## Errors and retries

Rate limits (429) and server errors (5xx) are retried with backoff, honouring `Retry-After` (default 3 retries). What's left throws a `ZoraApiError` with `isRateLimited` and `isInsufficientLiquidity`.

## Trading and creating coins

```ts
import { eth, erc20 } from "zora-coins";

const q = await zora.quoteTrade(eth(), erc20(coin), 10n ** 15n, wallet, { referrer: myApp }); // referrer earns the trade referral reward
await walletClient.sendTransaction({ to: q.call!.target, data: q.call!.data, value: BigInt(q.call!.value!) });
```

`createContentCoin` builds the transaction that creates a coin. Set `platformReferrer` to earn the platform share of its trading fees for good. This package never holds keys or sends transactions.

## GraphQL

```ts
import { ZoraGraphQL, type Zora20Token } from "zora-coins";

const gql = new ZoraGraphQL("http://localhost:8080/graphql");
const { coin } = await gql.query<{ coin: Zora20Token | null }>(
  `query($a: String!) { coin(address: $a) { name marketCap } }`, { a: addr });
```

## Rewards

```ts
import { Indexer, MemoryStore, buildReport } from "zora-coins/rewards";

const store = new MemoryStore();                // store.toJSON() / MemoryStore.fromJSON() to persist
await new Indexer(store).scan([addr], { days: 7 });
const report = await buildReport(store.eventsFor([addr]), [addr], zora);
console.log(report.toText());                   // or report.toHtml()
```

Amounts are exact `bigint`s. CLI: `npx -p zora-coins zora-rewards --days 7 --html rewards.html 0xYourAddress`.

## Reference

[Every endpoint and its method](../docs/ENDPOINTS.md), including the units of the numeric fields. Generated from Zora's OpenAPI spec by [`../codegen`](../codegen).

```sh
npm test                 # offline, against recorded responses
npm run test:live        # every endpoint against production
```

MIT © Rebel Studios Software
