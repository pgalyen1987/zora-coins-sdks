// Package zora is a typed Go client for the Zora Coins API (https://docs.zora.co/coins): coins,
// profiles, holders, swaps, comments, Explore lists, search, leaderboards, live streams, trade
// quotes and coin creation — every one of the API's 30 endpoints.
//
// Unofficial and community-maintained; not affiliated with Zora.
//
// # Getting started
//
//	client := zora.NewClient() // reads ZORA_API_KEY; or zora.NewClient(zora.WithAPIKey(key))
//
//	coin, err := client.Coin(ctx, "0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b", nil)
//	if errors.Is(err, zora.ErrNotFound) { ... }
//	fmt.Println(coin.GetName(), coin.GetMarketCap(), coin.GetCreatorProfile().GetHandle())
//
// # Optional fields and getters
//
// Every response field is a pointer, because the API leaves fields out: it returns a different
// selection of a coin's fields from each endpoint, and omits some its own spec marks required.
// Each field has a Get method that returns the zero value when the field — or anything before it in
// the chain — is nil, so deep reads never panic:
//
//	handle := coin.GetCreatorProfile().GetAvatar().GetPreviewImage().GetSmall()
//
// # Pagination
//
// List endpoints come in pairs. The plain method returns one page (a Connection with Nodes and
// NextCursor); the Iter method walks every page lazily and stops when you break:
//
//	for holder, err := range client.IterCoinHolders(ctx, addr, nil) {
//		if err != nil {
//			return err
//		}
//		fmt.Println(holder.GetOwnerAddress(), holder.GetBalance())
//	}
//
// # Errors, retries and rate limits
//
// Requests that hit a rate limit (429) or a server error (5xx) are retried with exponential
// backoff, honouring Retry-After, up to WithMaxRetries times (default 3). What's left comes back
// as an *APIError; RateLimited reports whether the limit was the cause. Lookups that find nothing
// return an error matching ErrNotFound. Every method stops promptly when its context is cancelled.
// Without an API key Zora's limits are much lower; create one at https://zora.co/settings/developer.
//
// # Trading and creating coins
//
// Quote (or QuoteTrade, with defaults) and CreateContentCoin return transactions for your wallet to
// sign; this package never holds keys or sends anything onchain. Set Referrer on a quote to earn
// the trade referral reward, and PlatformReferrer on a new coin to earn the platform share of its
// trading fees for good.
//
// # GraphQL
//
// GraphQLClient queries the zora-coins GraphQL gateway (graphql/ in this repository) and decodes
// results into the same types, so REST and GraphQL code share one model.
//
// # Rewards
//
// Package rewards (github.com/pgalyen1987/zora-coins-sdks/go/rewards) reads what an address has
// earned as a creator or referrer straight from Base — something neither the API nor Zora's own
// SDK offers — and the zora-rewards command prints or renders it.
package zora
