# Zora.Coins for .NET and Unity

Typed async client for the [Zora Coins API](https://docs.zora.co/coins): all 30 endpoints, `IAsyncEnumerable` pagination, retries, a GraphQL client, and an onchain indexer for the creator and referral rewards Zora pays on Base. Targets **.NET Standard 2.1 (Unity 2021+)** and **.NET 8+**.

> Unofficial and community-maintained. Not affiliated with Zora.

```sh
dotnet add package Zora.Coins
```

## Quick start

```csharp
using Zora.Coins;

using var zora = new ZoraCoinsClient(); // reads ZORA_API_KEY; or new ZoraCoinsClient(new() { ApiKey = "…" })

var coin = await zora.GetCoinAsync("0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b"); // null if there's no such coin
Console.WriteLine($"{coin?.Name} {coin?.MarketCap} {coin?.CreatorProfile?.Handle}");
```

Every response property is nullable, because the API leaves fields out. Enums are *extensible* (string-backed structs, as in the Azure SDKs), so a value Zora adds later doesn't break deserialization.

## Pagination

```csharp
var page = await zora.GetCoinHoldersAsync(addr, new CoinHoldersParams { PageSize = 50 });
foreach (var h in page.Nodes()) { /* … */ }
var next = page.NextCursor(); // null on the last page

await foreach (var holder in zora.EnumerateCoinHoldersAsync(addr))
    Console.WriteLine($"{holder.OwnerAddress} {holder.Balance}"); // Balance: 18-decimal integer string
```

Every method takes a `CancellationToken`.

## Errors, trading, GraphQL

```csharp
try
{
    var q = await zora.QuoteTradeAsync(ZoraCoinsClient.Eth(), ZoraCoinsClient.Erc20(coin), "1000000000000000", wallet, referrer: myApp);
    // q.Call.Target / Data / Value: sign with your wallet (Nethereum, a Unity wallet SDK…)
}
catch (ZoraApiException e) when (e.IsInsufficientLiquidity) { /* the pool can't fill that size */ }

var gql = new ZoraGraphQLClient(new Uri("http://localhost:8080/graphql"));
var data = await gql.QueryAsync<MyData>("query($a: String!) { coin(address: $a) { name marketCap } }", new { a = addr });
```

Rate limits and server errors are retried with backoff, honouring `Retry-After`. This package never holds keys or sends transactions.

## Rewards

```csharp
using Zora.Coins.Rewards;

var idx = new RewardsIndexer(new MemoryStore());       // Base's public RPC by default
await idx.ScanAsync(new[] { addr }, days: 7);
var report = await RewardsReport.BuildAsync(idx.Store.EventsFor(new[] { addr }), new[] { addr }, zora);
Console.Write(report.ToText());
```

Amounts are exact `BigInteger`s.

## Reference

[Every endpoint and its method](../docs/ENDPOINTS.md), including the units of the numeric fields. XML docs on every public member.

```sh
dotnet test tests/Zora.Coins.Tests                                       # offline
LIVE=1 dotnet test tests/Zora.Coins.Tests --filter LiveTests            # every endpoint against production
```

MIT © Rebel Studios Software
