# Zora Coins SDKs

Typed clients for the [Zora Coins API](https://docs.zora.co/coins) in **Python, TypeScript, Go, Rust, C#, Java and C++**, a **GraphQL gateway** over the whole API, and an **onchain indexer for the creator and referral rewards** Zora pays on Base.

> Unofficial and community-maintained. Not affiliated with Zora.

| | Package | Install |
|---|---|---|
| **Python** | [`zora-coins`](https://pypi.org/project/zora-coins/) | `pip install zora-coins` |
| **TypeScript / JavaScript** | [`zora-coins`](https://www.npmjs.com/package/zora-coins) | `npm install zora-coins` |
| **Go** | [`…/zora-coins-sdks/go`](https://pkg.go.dev/github.com/pgalyen1987/zora-coins-sdks/go/zora) | `go get github.com/pgalyen1987/zora-coins-sdks/go` |
| **Rust** | [`zora-coins`](https://crates.io/crates/zora-coins) | `cargo add zora-coins` |
| **C# / .NET / Unity** | [`Zora.Coins`](https://www.nuget.org/packages/Zora.Coins) | `dotnet add package Zora.Coins` |
| **Java / Kotlin / Android** | [`io.github.pgalyen1987:zora-coins`](https://central.sonatype.com/artifact/io.github.pgalyen1987/zora-coins) | `implementation("io.github.pgalyen1987:zora-coins:0.1.1")` |
| **C++** | [`cpp/`](cpp/) | CMake `FetchContent` |
| **GraphQL** | [`graphql/`](graphql/) | `go run github.com/pgalyen1987/zora-coins-sdks/graphql/cmd/zora-graphql@latest` |

Zora's official SDK is TypeScript only. These cover the same API in the languages people build games, bots, backends, indexers and mobile apps in, and share one set of types, names and docs, so switching languages doesn't mean relearning the API.

## What every SDK gives you

- **All 30 endpoints**: coins, holders, swaps, comments, price history, Explore lists, search, profiles, balances, trade activity, leaderboards, live streams, pool configs, trade quotes and coin creation. [Method names in every language →](docs/ENDPOINTS.md)
- **117 typed, documented models**, including the units the API leaves out. `marketCap` is a USD decimal string, but `balance` is an 18-decimal integer string. Every field says which.
- **Pagination** two ways: one page at a time, or an iterator, stream or callback that fetches every page as you reach it and stops when you do.
- **Retries** for rate limits and server errors, with backoff that honours `Retry-After`. Errors are typed: *rate limited*, and for quotes, *not enough liquidity*.
- **Trading and coin creation** return the transaction for your wallet to sign. Nothing here holds keys or sends anything onchain. Set a `referrer` on a quote to earn the trade referral reward, or a `platformReferrer` on a new coin to earn a share of its trading fees for the coin's whole life.
- **A GraphQL client** for the gateway below. Results decode into the same types as REST.
- **A rewards indexer**, covered below.

## Rewards: what did an address earn?

Every trade of a Zora coin pays the coin's creator, the platform that launched it, and the interface that routed the trade. On V4 coins those payouts are `CoinMarketRewardsV4` events, plus `CreatorCoinRewards` for the creator's and protocol's shares on creator-coin trades (in a sample day on Base, nearly half of what creators earned), and **none of their recipient fields are indexed**. You can't ask a node for "rewards paid to my address"; you have to read every reward event and filter them. Each SDK does that, remembers what it has scanned, and reports earnings per role and token at current prices:

```
$ zora-rewards --days 0.25 0x55c88bb05602da94fce8feadc1cbebf5b72c2453
Zora rewards for 0x55c88bb05602da94fce8feadc1cbebf5b72c2453
334 reward events, blocks 51460584–51471286
  Platform referral           81.2423 ZORA                $0.64  (14 payouts)
  Platform referral       0.000199321 WETH                $0.50  (50 payouts)
  Platform referral          0.589797 USDC                $0.59  (82 payouts)
  Trade referral              45.8290 ZORA                $0.36  (125 payouts)
  Trade referral          0.000167845 WETH                $0.42  (61 payouts)
  Total (current prices)                                      $2.58
```

The CLI ships with the Python, TypeScript, Go and Rust packages (`pip install zora-coins`, `npx -p zora-coins zora-rewards`, `go install github.com/pgalyen1987/zora-coins-sdks/go/cmd/zora-rewards@latest`, `cargo install zora-coins --features cli`), and the C++ build has one too.

## One request with GraphQL

[`graphql/`](graphql/) serves the whole API as one schema, plus a `rewards` query the REST API can't answer. A screen's worth of data becomes one request:

```graphql
{
  coin(address: "0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b") { name symbol marketCap uniqueHolders creatorProfile { handle } }
  explore(listType: TOP_GAINERS, pageSize: 5) { edges { node { symbol marketCapDelta24h } } }
  rewards(addresses: ["0x…"], hours: 6) { totalUsd lines { role symbol usd } }
}
```

It forwards each caller's own Zora API key and stores nothing.

## The same call in each language

```python
coin = ZoraCoins().get_coin("0x0b85…")                           # Python: None if missing
```
```ts
const coin = await new ZoraCoins().coin("0x0b85…");              // TypeScript: null if missing
```
```go
coin, err := zora.NewClient().Coin(ctx, "0x0b85…", nil)          // Go: errors.Is(err, zora.ErrNotFound)
```
```rust
let coin = Client::new().coin("0x0b85…", None).await?;           // Rust: Option<Zora20Token>
```
```csharp
var coin = await new ZoraCoinsClient().GetCoinAsync("0x0b85…");  // C#: null if missing
```
```java
Optional<Zora20Token> coin = ZoraCoins.builder().build().getCoin("0x0b85…", null);  // Java
```
```cpp
std::optional<zora::Zora20Token> coin = zora::Client().coin("0x0b85…");            // C++
```

Every SDK reads `ZORA_API_KEY` from the environment. Without a key Zora applies much lower rate limits; [create one](https://zora.co/settings/developer).

## How it's built

Zora's REST API is a thin layer over a GraphQL backend, and its [OpenAPI spec](https://api-sdk.zora.engineering/docs) writes every response out inline: 427 unnamed object schemas, up to 29 levels deep. [`codegen/`](codegen/) turns that into 117 named entity types. Every coin is one `Zora20Token`, whichever endpoint returned it. From that one model it emits all seven SDKs, the GraphQL schema and resolvers, and [`docs/ENDPOINTS.md`](docs/ENDPOINTS.md). The SDKs can't disagree about a name, a type or a doc string.

Where the live API and its spec disagree, the SDKs follow the API:

- **Required fields:** every response field is optional, because the API leaves out fields the spec marks required.
- **`success` on `/quote`:** it arrives as the string `"true"` and is read as a boolean.
- **`__typename`:** it's exposed, because it's the only way to tell a creator coin from a trend coin, or a profile hit from a coin hit.
- **Quote errors:** `/quote`'s 422 errors are typed.
- **Enums:** they accept values Zora adds later instead of failing.

Tests:

- [`fixtures/`](fixtures/) holds real responses recorded from the API, and every SDK's offline tests decode the same ones.
- Each SDK has a live suite that calls **all 30 endpoints** against production.
- Go and Rust also decode every response strictly, so a field Zora adds without updating the spec fails loudly instead of being dropped.

```sh
make spec generate   # pull Zora's current spec, regenerate every SDK
make test            # offline tests, all languages
make live            # every endpoint, every language, against production
```

## Repository

| Path | What |
|---|---|
| [`spec/`](spec/) | Zora's OpenAPI spec, as fetched |
| [`codegen/`](codegen/) | the generator: model (`ir.py`), shared docs (`docs.py`), one emitter per language |
| [`go/`](go/), [`rust/`](rust/), [`typescript/`](typescript/), [`dotnet/`](dotnet/), [`java/`](java/), [`cpp/`](cpp/) | the SDKs |
| [`graphql/`](graphql/) | the GraphQL gateway |
| [`fixtures/`](fixtures/) | recorded API responses shared by every test suite |
| [`docs/`](docs/) | the cross-language endpoint and type reference |

The Python SDK lives at [pgalyen1987/zora-coins-py](https://github.com/pgalyen1987/zora-coins-py) and is generated from the same model.

## License

MIT © Rebel Studios Software
