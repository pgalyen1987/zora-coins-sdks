# zora-coins for Go

Typed Go client for the [Zora Coins API](https://docs.zora.co/coins): all 30 endpoints, nil-safe getters, `iter.Seq2` pagination, retries, a GraphQL client, and an onchain indexer for the creator and referral rewards Zora pays on Base. Zero dependencies beyond the standard library.

> Unofficial and community-maintained. Not affiliated with Zora.

```sh
go get github.com/pgalyen1987/zora-coins-sdks/go
```

Go 1.23+ (range-over-func iterators). [API reference on pkg.go.dev](https://pkg.go.dev/github.com/pgalyen1987/zora-coins-sdks/go/zora).

## Quick start

```go
import "github.com/pgalyen1987/zora-coins-sdks/go/zora"

client := zora.NewClient() // reads ZORA_API_KEY; or zora.NewClient(zora.WithAPIKey(key))

coin, err := client.Coin(ctx, "0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b", nil)
if errors.Is(err, zora.ErrNotFound) {
    // no such coin
}
fmt.Println(coin.GetName(), coin.GetMarketCap(), coin.GetCreatorProfile().GetHandle())
```

Every field is a pointer, because the API leaves fields out: each endpoint returns a different selection of a coin's fields. Every field also has a `Get…` method that returns the zero value when it, or anything before it in the chain, is nil. Deep reads never panic:

```go
avatar := coin.GetCreatorProfile().GetAvatar().GetPreviewImage().GetSmall()
```

## Pagination

List endpoints come in pairs: one page, or every page.

```go
page, err := client.CoinHolders(ctx, addr, &zora.CoinHoldersParams{PageSize: 50})
for _, h := range page.Nodes() { … }
next := page.NextCursor() // "" on the last page

for holder, err := range client.IterCoinHolders(ctx, addr, nil) {
    if err != nil {
        return err
    }
    fmt.Println(holder.GetOwnerAddress(), holder.GetBalance()) // balance: 18-decimal integer string
}
```

The iterator fetches each page only when the loop reaches it, and stops at `break`.

## Errors and retries

Rate limits (429) and server errors (5xx) are retried with exponential backoff, honouring `Retry-After`, up to `WithMaxRetries` (default 3). What's left is an `*APIError`:

```go
var apiErr *zora.APIError
if errors.As(err, &apiErr) {
    apiErr.RateLimited()           // 429 after retries: an API key raises the limit
    apiErr.InsufficientLiquidity() // a quote the pool can't fill
}
```

Every method stops promptly when its `context` is cancelled.

## Trading and creating coins

```go
q, err := client.QuoteTrade(ctx, zora.ETH(), zora.ERC20(coinAddr), "1000000000000000", wallet,
    &zora.QuoteRequest{Referrer: zora.Ptr(myAppAddress)}) // the referrer earns the trade referral reward
call := q.GetCall() // Target, Data, Value: sign and send with your wallet library
```

`CreateContentCoin` builds the transaction that creates a coin. Set `PlatformReferrer` to earn the platform share of its trading fees for good. This package never holds keys or sends transactions.

## GraphQL

```go
gql := zora.NewGraphQLClient("http://localhost:8080/graphql")
var out struct {
    Coin *zora.Zora20Token `json:"coin"`
}
err := gql.Query(ctx, `query($a: String!) { coin(address: $a) { name marketCap } }`, map[string]any{"a": addr}, &out)
```

Results decode into the same types as REST. The gateway is in [`../graphql`](../graphql).

## Rewards

```go
import "github.com/pgalyen1987/zora-coins-sdks/go/rewards"

store, _ := rewards.OpenFileStore("rewards.json") // or rewards.NewMemoryStore()
idx := rewards.NewIndexer(store, "")               // Base's public RPC; pass your own for speed
_, err := idx.Scan(ctx, []string{addr}, rewards.ScanOptions{Days: 7})
events, _ := store.EventsFor([]string{addr}, 0)
report, _ := rewards.BuildReport(ctx, events, []string{addr}, zora.NewClient())
fmt.Print(report.Text())                          // or report.HTML("My rewards")
```

Or the CLI: `go install github.com/pgalyen1987/zora-coins-sdks/go/cmd/zora-rewards@latest`, then `zora-rewards -days 7 -html rewards.html 0xYourAddress`.

## Configuration

| Option | Default |
|---|---|
| `WithAPIKey(key)` | `$ZORA_API_KEY` |
| `WithMaxRetries(n)` | 3 |
| `WithHTTPClient(c)` | `http.Client` with a 30s timeout |
| `WithBaseURL(u)` | `https://api-sdk.zora.engineering` |
| `WithUserAgent(ua)` | prefixes `zora-coins-go/<version>` |

## Reference

[Every endpoint and its method](../docs/ENDPOINTS.md), including the units of the numeric fields. Types and methods are generated from Zora's OpenAPI spec by [`../codegen`](../codegen); run `make generate` at the repo root after the spec changes.

```sh
go test -race ./...                          # offline, against recorded responses
go test -tags live -run Live -v ./zora       # every endpoint against production
```

MIT © Rebel Studios Software
