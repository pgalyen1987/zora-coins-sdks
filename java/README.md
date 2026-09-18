# zora-coins for Java, Kotlin and Android

Typed client for the [Zora Coins API](https://docs.zora.co/coins): all 30 endpoints, lazy `Iterable` pagination, retries, a GraphQL client, and an onchain indexer for the creator and referral rewards Zora pays on Base. **Java 11+ and Android.** The only dependency is Jackson; HTTP goes through `HttpURLConnection` by default, or plug in OkHttp.

> Unofficial and community-maintained. Not affiliated with Zora.

```kotlin
implementation("io.github.pgalyen1987:zora-coins:0.1.0")
```

## Quick start

```java
ZoraCoins zora = ZoraCoins.builder().build(); // reads ZORA_API_KEY; or .apiKey("…")

zora.getCoin("0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b", null)   // Optional: empty if there's no such coin
    .ifPresent(c -> System.out.println(c.getName() + " " + c.getMarketCap()));
```

Getters return null for fields the endpoint didn't select. Enums are extensible, so a value Zora adds later is kept rather than rejected.

## Pagination

```java
TokenBalanceConnection page = zora.getCoinHolders(addr, new CoinHoldersParams().pageSize(50));
page.nodes();       // List<TokenBalance>
page.nextCursor();  // null on the last page

for (TokenBalance holder : zora.iterateCoinHolders(addr, null)) {   // fetches pages lazily
    System.out.println(holder.getOwnerAddress() + " " + holder.getBalance()); // 18-decimal integer string
}
```

## Errors, trading, GraphQL

```java
try {
    QuoteResponse q = zora.quoteTrade(ZoraCoins.eth(), ZoraCoins.erc20(coin), "1000000000000000", wallet, myApp);
    // q.getCall(): target, data, value. Sign with your wallet (web3j…)
} catch (ZoraApiException e) {
    if (e.isInsufficientLiquidity()) { /* the pool can't fill that size */ }
}

ZoraGraphQL gql = new ZoraGraphQL("http://localhost:8080/graphql", null);
JsonNode data = gql.query("query($a: String!) { coin(address: $a) { name marketCap } }", Map.of("a", addr));
Zora20Token coin = gql.convert(data.get("coin"), Zora20Token.class);
```

Rate limits and server errors are retried with backoff, honouring `Retry-After`. On Android, implement `Transport` over OkHttp and pass it to `builder().transport(…)`. Call the client off the main thread.

## Rewards

```java
Rewards.Indexer idx = new Rewards.Indexer(new Rewards.MemoryStore(), null, null); // Base's public RPC
idx.scan(List.of(addr), null, 7.0, null, null);
Rewards.Report report = Rewards.Report.build(idx.store().eventsFor(List.of(addr), 0), List.of(addr), zora);
System.out.print(report.toText());
```

## Reference

[Every endpoint and its method](../docs/ENDPOINTS.md), including the units of the numeric fields. Javadoc on every public member.

```sh
./gradlew test                                   # offline
LIVE=1 ./gradlew test --tests '*LiveTest*'       # every endpoint against production
```

MIT © Rebel Studios Software
