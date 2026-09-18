# Endpoints

All 30 Zora Coins API endpoints and the method that calls each one, in every SDK. Generated from
Zora's OpenAPI spec by `codegen/emit_docs.py`, so it can't drift from the code.

Paginated endpoints have two methods: one page, and a second that walks every page (an iterator,
stream or callback, depending on the language).

| Endpoint | What it returns | Python | Go | Rust | TypeScript | C# | Java | C++ | GraphQL |
|---|---|---|---|---|---|---|---|---|---|
| `GET /apiKey` | Look up an API key: whether it exists and is active. | `get_api_key` | `APIKey` | `api_key` | `apiKey` | `GetApiKeyAsync` | `getApiKey` | `api_key` | `apiKey` |
| `GET /coin` | One coin by contract address: market data, creator profile, media, pool key and creator earnings. | `get_coin` | `Coin` | `coin` | `coin` | `GetCoinAsync` | `getCoin` | `coin` | `coin` |
| `GET /coinComments` | Comments posted on a coin, newest first. | `get_coin_comments`<br>`iter_coin_comments` | `CoinComments`<br>`IterCoinComments` | `coin_comments`<br>`iter_coin_comments` | `coinComments`<br>`iterCoinComments` | `GetCoinCommentsAsync`<br>`EnumerateCoinCommentsAsync` | `getCoinComments`<br>`iterateCoinComments` | `coin_comments`<br>`for_each_coin_comments` | `coinComments` |
| `GET /coinHolders` | Holders of a coin and their balances, largest first. | `get_coin_holders`<br>`iter_coin_holders` | `CoinHolders`<br>`IterCoinHolders` | `coin_holders`<br>`iter_coin_holders` | `coinHolders`<br>`iterCoinHolders` | `GetCoinHoldersAsync`<br>`EnumerateCoinHoldersAsync` | `getCoinHolders`<br>`iterateCoinHolders` | `coin_holders`<br>`for_each_coin_holders` | `coinHolders` |
| `GET /coinMergedComments` | A coin's comment feed with replies threaded in, newest first. | `get_coin_merged_comments`<br>`iter_coin_merged_comments` | `CoinMergedComments`<br>`IterCoinMergedComments` | `coin_merged_comments`<br>`iter_coin_merged_comments` | `coinMergedComments`<br>`iterCoinMergedComments` | `GetCoinMergedCommentsAsync`<br>`EnumerateCoinMergedCommentsAsync` | `getCoinMergedComments`<br>`iterateCoinMergedComments` | `coin_merged_comments`<br>`for_each_coin_merged_comments` | `coinMergedComments` |
| `GET /coinPriceHistory` | A coin's price history at five resolutions: the last hour, day, week, month, and all time. | `get_coin_price_history` | `CoinPriceHistory` | `coin_price_history` | `coinPriceHistory` | `GetCoinPriceHistoryAsync` | `getCoinPriceHistory` | `coin_price_history` | `coinPriceHistory` |
| `GET /coinSwaps` | Buys and sells of a coin, newest first. | `get_coin_swaps`<br>`iter_coin_swaps` | `CoinSwaps`<br>`IterCoinSwaps` | `coin_swaps`<br>`iter_coin_swaps` | `coinSwaps`<br>`iterCoinSwaps` | `GetCoinSwapsAsync`<br>`EnumerateCoinSwapsAsync` | `getCoinSwaps`<br>`iterateCoinSwaps` | `coin_swaps`<br>`for_each_coin_swaps` | `coinSwaps` |
| `GET /coins` | Several coins in one request. | `get_coins` | `Coins` | `coins` | `coins` | `GetCoinsAsync` | `getCoins` | `coins` | `coins` |
| `GET /coinsList` | Basic information (address, name, symbol, price) for every coin, in pages of up to 1,000. | `get_coins_list`<br>`iter_coins_list` | `CoinsList`<br>`IterCoinsList` | `coins_list`<br>`iter_coins_list` | `coinsList`<br>`iterCoinsList` | `GetCoinsListAsync`<br>`EnumerateCoinsListAsync` | `getCoinsList`<br>`iterateCoinsList` | `coins_list`<br>`for_each_coins_list` | `coinsList` |
| `GET /contentCoinPoolConfig` | The Uniswap V4 pool configuration Zora uses to launch a content coin paired with the given currency. | `get_content_coin_pool_config` | `ContentCoinPoolConfig` | `content_coin_pool_config` | `contentCoinPoolConfig` | `GetContentCoinPoolConfigAsync` | `getContentCoinPoolConfig` | `content_coin_pool_config` | `contentCoinPoolConfig` |
| `POST /createUploadJWT` | Create a short-lived token for uploading coin media and metadata to Zora's uploader. | `create_upload_jwt` | `CreateUploadJWT` | `create_upload_jwt` | `createUploadJwt` | `CreateUploadJwtAsync` | `createUploadJwt` | `create_upload_jwt` | `createUploadJwt` (mutation) |
| `GET /creatorCoinPoolConfig` | The Uniswap V4 pool configuration Zora uses to launch a creator coin, optionally sized for a starting market cap in USD. | `get_creator_coin_pool_config` | `CreatorCoinPoolConfig` | `creator_coin_pool_config` | `creatorCoinPoolConfig` | `GetCreatorCoinPoolConfigAsync` | `getCreatorCoinPoolConfig` | `creator_coin_pool_config` | `creatorCoinPoolConfig` |
| `GET /creatorLivestreamComments` | Comments on the live stream of the creator behind a coin. | `get_creator_livestream_comments`<br>`iter_creator_livestream_comments` | `CreatorLivestreamComments`<br>`IterCreatorLivestreamComments` | `creator_livestream_comments`<br>`iter_creator_livestream_comments` | `creatorLivestreamComments`<br>`iterCreatorLivestreamComments` | `GetCreatorLivestreamCommentsAsync`<br>`EnumerateCreatorLivestreamCommentsAsync` | `getCreatorLivestreamComments`<br>`iterateCreatorLivestreamComments` | `creator_livestream_comments`<br>`for_each_creator_livestream_comments` | `creatorLivestreamComments` |
| `GET /explore` | A Zora Explore list: top gainers, 24h volume, newest, most valuable creators and more. | `explore`<br>`iter_explore` | `Explore`<br>`IterExplore` | `explore`<br>`iter_explore` | `explore`<br>`iterExplore` | `ExploreAsync`<br>`EnumerateExploreAsync` | `explore`<br>`iterateExplore` | `explore`<br>`for_each_explore` | `explore` |
| `GET /featuredCreators` | Creators featured on the weekly leaderboard. | `get_featured_creators`<br>`iter_featured_creators` | `FeaturedCreators`<br>`IterFeaturedCreators` | `featured_creators`<br>`iter_featured_creators` | `featuredCreators`<br>`iterFeaturedCreators` | `GetFeaturedCreatorsAsync`<br>`EnumerateFeaturedCreatorsAsync` | `getFeaturedCreators`<br>`iterateFeaturedCreators` | `featured_creators`<br>`for_each_featured_creators` | `featuredCreators` |
| `GET /latestLiveStreams` | Live streams, most recently started first. | `get_latest_live_streams`<br>`iter_latest_live_streams` | `LatestLiveStreams`<br>`IterLatestLiveStreams` | `latest_live_streams`<br>`iter_latest_live_streams` | `latestLiveStreams`<br>`iterLatestLiveStreams` | `GetLatestLiveStreamsAsync`<br>`EnumerateLatestLiveStreamsAsync` | `getLatestLiveStreams`<br>`iterateLatestLiveStreams` | `latest_live_streams`<br>`for_each_latest_live_streams` | `latestLiveStreams` |
| `GET /profile` | A profile by handle or wallet address, with its linked wallets and creator coin. | `get_profile` | `Profile` | `profile` | `profile` | `GetProfileAsync` | `getProfile` | `profile` | `profile` |
| `GET /profileBalances` | Coins a profile holds, with balances and current values. | `get_profile_balances`<br>`iter_profile_balances` | `ProfileBalances`<br>`IterProfileBalances` | `profile_balances`<br>`iter_profile_balances` | `profileBalances`<br>`iterProfileBalances` | `GetProfileBalancesAsync`<br>`EnumerateProfileBalancesAsync` | `getProfileBalances`<br>`iterateProfileBalances` | `profile_balances`<br>`for_each_profile_balances` | `profileBalances` |
| `GET /profileBySocialHandle` | Find a Zora profile from its handle on X, TikTok, Farcaster or Instagram. | `get_profile_by_social_handle` | `ProfileBySocialHandle` | `profile_by_social_handle` | `profileBySocialHandle` | `GetProfileBySocialHandleAsync` | `getProfileBySocialHandle` | `profile_by_social_handle` | `profileBySocialHandle` |
| `GET /profileCoins` | Coins a profile created. | `get_profile_coins`<br>`iter_profile_coins` | `ProfileCoins`<br>`IterProfileCoins` | `profile_coins`<br>`iter_profile_coins` | `profileCoins`<br>`iterProfileCoins` | `GetProfileCoinsAsync`<br>`EnumerateProfileCoinsAsync` | `getProfileCoins`<br>`iterateProfileCoins` | `profile_coins`<br>`for_each_profile_coins` | `profileCoins` |
| `GET /profileSocial` | A profile's linked social accounts (X, TikTok, Instagram, Farcaster) and follower counts. | `get_profile_social` | `ProfileSocial` | `profile_social` | `profileSocial` | `GetProfileSocialAsync` | `getProfileSocial` | `profile_social` | `profileSocial` |
| `GET /search` | Search coins, profiles, content and trends by text. | `search`<br>`iter_search` | `Search`<br>`IterSearch` | `search`<br>`iter_search` | `search`<br>`iterSearch` | `SearchAsync`<br>`EnumerateSearchAsync` | `search`<br>`iterateSearch` | `search`<br>`for_each_search` | `search` |
| `GET /tokenInfo` | Symbol, decimals and current USD price of any ERC-20 on the chain: ZORA, USDC, WETH, or a coin. | `get_token_info` | `TokenInfo` | `token_info` | `tokenInfo` | `GetTokenInfoAsync` | `getTokenInfo` | `token_info` | `tokenInfo` |
| `GET /topLiveStreams` | Live streams with the most viewers right now. | `get_top_live_streams`<br>`iter_top_live_streams` | `TopLiveStreams`<br>`IterTopLiveStreams` | `top_live_streams`<br>`iter_top_live_streams` | `topLiveStreams`<br>`iterTopLiveStreams` | `GetTopLiveStreamsAsync`<br>`EnumerateTopLiveStreamsAsync` | `getTopLiveStreams`<br>`iterateTopLiveStreams` | `top_live_streams`<br>`for_each_top_live_streams` | `topLiveStreams` |
| `GET /traderLeaderboard` | The weekly trader leaderboard. | `get_trader_leaderboard`<br>`iter_trader_leaderboard` | `TraderLeaderboard`<br>`IterTraderLeaderboard` | `trader_leaderboard`<br>`iter_trader_leaderboard` | `traderLeaderboard`<br>`iterTraderLeaderboard` | `GetTraderLeaderboardAsync`<br>`EnumerateTraderLeaderboardAsync` | `getTraderLeaderboard`<br>`iterateTraderLeaderboard` | `trader_leaderboard`<br>`for_each_trader_leaderboard` | `traderLeaderboard` |
| `GET /trendCoin` | A trend coin by its ticker. | `get_trend_coin` | `TrendCoin` | `trend_coin` | `trendCoin` | `GetTrendCoinAsync` | `getTrendCoin` | `trend_coin` | `trendCoin` |
| `GET /trendsByName` | Trend coins whose name matches, best match first. | `get_trends_by_name`<br>`iter_trends_by_name` | `TrendsByName`<br>`IterTrendsByName` | `trends_by_name`<br>`iter_trends_by_name` | `trendsByName`<br>`iterTrendsByName` | `GetTrendsByNameAsync`<br>`EnumerateTrendsByNameAsync` | `getTrendsByName`<br>`iterateTrendsByName` | `trends_by_name`<br>`for_each_trends_by_name` | `trendsByName` |
| `GET /walletTradeActivity` | Trades made by a wallet or profile, newest first. | `get_wallet_trade_activity`<br>`iter_wallet_trade_activity` | `WalletTradeActivity`<br>`IterWalletTradeActivity` | `wallet_trade_activity`<br>`iter_wallet_trade_activity` | `walletTradeActivity`<br>`iterWalletTradeActivity` | `GetWalletTradeActivityAsync`<br>`EnumerateWalletTradeActivityAsync` | `getWalletTradeActivity`<br>`iterateWalletTradeActivity` | `wallet_trade_activity`<br>`for_each_wallet_trade_activity` | `walletTradeActivity` |
| `POST /quote` | Quote a trade. | `quote_trade` | `Quote` | `quote` | `quote` | `QuoteAsync` | `quote` | `quote` | `quote` |
| `POST /create/content` | Build the transaction that creates a content coin. | `create_content_coin` | `CreateContentCoin` | `create_content_coin` | `createContentCoin` | `CreateContentCoinAsync` | `createContentCoin` | `create_content_coin` | `createContentCoin` |

Plus, everywhere: `rewards` (what an address earned as a creator or referrer, read from Base — a
GraphQL query, and a module/package in each SDK), a GraphQL client, and helpers for the common cases:
`quote_trade` (defaults filled in), `coins_by_address`, `eth()` / `erc20(address)`.

## Types

117 types and 13 enums, the same names in every language. The ones you'll use most:

| Type | What it is |
|---|---|
| `Zora20Token` | A Zora coin: an ERC-20 with a Uniswap V4 market, created by a creator or for a piece of content or a trend. Endpoints return different selections of its fields; anything not selected is empty. |
| `Profile` | A Zora profile: handle, avatar, linked wallets, creator coin, and (depending on the call) the coins it created or holds. |
| `TokenBalance` | One holder of a coin and how much they hold. |
| `SwapActivity` | One buy or sell of a coin. |
| `CoinBalance` | One coin a profile holds, with the balance and the coin itself. |
| `TradeActivity` | One trade made by a wallet. |
| `SearchResult` | One search hit: a profile, a coin, a piece of content or a trend. |
| `PricePoint` | The price of a coin at a moment in time. |
| `PageInfo` | Where a page sits in a paginated list. Pass EndCursor as After to get the next page while HasNextPage is true. |
| `QuoteResponse` | A trade quote and the transaction that executes it. |
| `Call` | A transaction to send from the user's wallet: target (to), calldata and ETH value. |

### Units

The API returns every number that can be large as a string, and doesn't say what unit it's in. The SDKs' field docs do:

| Field | Unit |
|---|---|
| `Zora20Token.marketCap`, `volume24h`, `totalVolume`, `marketCapDelta24h` | USD, decimal string |
| `Zora20Token.totalSupply` | whole tokens, decimal string |
| `TokenBalance.balance`, `CoinBalance.balance`, `SwapActivity.coinAmount` | smallest unit, 18 decimals (divide by 10^18) |
| `TokenPrice.priceInUsdc`, `Currency.priceUsd` | USD per whole token, decimal string |
| `Call.value`, `QuoteRequest.amountIn` | smallest unit of the input token (wei for ETH) |
