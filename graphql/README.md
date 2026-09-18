# Zora Coins GraphQL gateway

The whole [Zora Coins API](https://docs.zora.co/coins) as one GraphQL schema, plus a `rewards` query that reads creator and referral earnings straight from Base, which the REST API can't do.

> Unofficial and community-maintained. Not affiliated with Zora.

```sh
go run github.com/pgalyen1987/zora-coins-sdks/graphql/cmd/zora-graphql@latest -addr :8080
open http://localhost:8080           # GraphiQL, with the schema's docs
```

Or with Docker, from the repository root: `docker build -f graphql/Dockerfile -t zora-graphql . && docker run -p 8080:8080 zora-graphql`.

## Why

A screen usually needs several things: a coin, its holders, the creator's profile, what's trending. Over REST that's several round trips, each returning everything. Here it's one request that selects only the fields it uses:

```graphql
query Screen($coin: String!, $me: [String!]!) {
  coin(address: $coin) { name symbol marketCap uniqueHolders creatorProfile { handle avatar { medium } } }
  coinHolders(address: $coin, pageSize: 10) { edges { node { ownerAddress balance } } pageInfo { endCursor hasNextPage } }
  explore(listType: TOP_GAINERS, pageSize: 5) { edges { node { symbol marketCapDelta24h } } }
  rewards(addresses: $me, hours: 6) { totalUsd lines { role symbol amount usd } }
}
```

The schema is generated from Zora's OpenAPI spec by the same code that generates the SDKs ([`schema.graphql`](schema.graphql), every field documented, units included), so results decode into the SDKs' types in every language. Root fields mirror the SDK methods, and list fields take `pageSize` and `after`.

## Your key, not ours

The gateway forwards each caller's Zora API key (the `api-key` header, or `Authorization: Bearer …`) and stores nothing. Zora's terms don't allow redistributing their data commercially without permission, so a public deployment should act only with its callers' own keys. Set `ZORA_API_KEY` only on a private deployment that should use your key by default.

## Limits

- Up to 10 top-level fields per request, since each is one call to Zora.
- A 64 KB body limit and a 60-second timeout.
- `rewards` scans at most 24 hours live.
- Zora's 429s come back as GraphQL errors that say to send a key.

`/health` for probes, `/schema.graphql` for codegen tools.

```sh
go test ./...        # schema, resolvers and limits, against a fake Zora API serving recorded responses
```

MIT © Rebel Studios Software
