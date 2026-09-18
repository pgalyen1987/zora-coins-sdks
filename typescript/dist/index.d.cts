/** Zora's production REST API. */
declare const DEFAULT_BASE_URL = "https://api-sdk.zora.engineering";
/** Base mainnet, where Zora coins live. Every call defaults to it. */
declare const BASE_CHAIN_ID = 8453;
/** SDK version, sent in the User-Agent header where the runtime allows it. */
declare const VERSION = "0.1.0";
/** Options for {@link ZoraCoins} and {@link ZoraGraphQL}. */
interface ClientOptions {
    /**
     * API key sent as the `api-key` header. Without one Zora's rate limits are much lower. Create one
     * at https://zora.co/settings/developer. Defaults to `process.env.ZORA_API_KEY` on Node.
     */
    apiKey?: string;
    /** Another deployment (staging, a mock server in tests). */
    baseUrl?: string;
    /** Retries for rate limits (429) and server errors (5xx). Default 3. */
    maxRetries?: number;
    /** Per-request timeout in milliseconds. Default 30000. */
    timeoutMs?: number;
    /** A `fetch` implementation, e.g. to add tracing. Defaults to the global `fetch`. */
    fetch?: typeof fetch;
    /** Prefix for the User-Agent header, so Zora can tell your app's traffic apart. */
    userAgent?: string;
}
/** The Zora API answered with an HTTP error after retries were used up. */
declare class ZoraApiError extends Error {
    /** HTTP status. */
    readonly status: number;
    /** The endpoint, e.g. `/coin`. */
    readonly path: string;
    /** The API's machine-readable reason, where it gives one: `/quote` answers 422 with `LIQUIDITY`. */
    readonly errorType: string | undefined;
    /** The response body (parsed JSON, or text). */
    readonly body: unknown;
    constructor(status: number, message: string, path: string, body: unknown);
    /** Whether Zora refused the request for exceeding its rate limit. An API key raises it. */
    get isRateLimited(): boolean;
    /** Whether a quote failed because the pool can't fill a trade that size. Try a smaller amount. */
    get isInsufficientLiquidity(): boolean;
}
/** HTTP plumbing shared by every endpoint: headers, retries with backoff, errors. */
declare class BaseClient {
    protected readonly baseUrl: string;
    protected readonly key: string | undefined;
    protected readonly maxRetries: number;
    protected readonly timeoutMs: number;
    protected readonly fetchImpl: typeof fetch;
    protected readonly userAgent: string;
    constructor(options?: ClientOptions);
    /**
     * Send one request and parse the JSON response. The generated methods are built on this; call it
     * directly only for an endpoint the SDK doesn't wrap yet.
     */
    request<T>(method: string, path: string, query?: Array<[string, string]>, body?: unknown, signal?: AbortSignal): Promise<T>;
}

/**
 * Every type the Zora Coins API returns or accepts. Response fields are all optional: the API returns
 * a different selection of a coin's fields from each endpoint, and leaves out some its own spec marks
 * required. Enum types also accept any string, so a value Zora adds later still type-checks.
 * @module
 */
/** What a coin represents: a creator, a piece of content, or a trend. */
declare const CoinType: {
    readonly Creator: "CREATOR";
    readonly Content: "CONTENT";
    readonly Trend: "TREND";
};
/** What a coin represents: a creator, a piece of content, or a trend. */
type CoinType = (typeof CoinType)[keyof typeof CoinType] | (string & {});
/** What a new content coin trades against. */
declare const ContentCoinCurrency: {
    readonly CreatorCoin: "CREATOR_COIN";
    readonly Zora: "ZORA";
    readonly Eth: "ETH";
    readonly CreatorCoinOrZora: "CREATOR_COIN_OR_ZORA";
};
/** What a new content coin trades against. */
type ContentCoinCurrency = (typeof ContentCoinCurrency)[keyof typeof ContentCoinCurrency] | (string & {});
/** What a new coin's pool trades against. */
declare const CurrencyType: {
    readonly Eth: "ETH";
    readonly Zora: "ZORA";
    readonly CreatorCoin: "CREATOR_COIN";
    readonly CreatorCoinOrZora: "CREATOR_COIN_OR_ZORA";
    readonly CustomCoin: "CUSTOM_COIN";
};
/** What a new coin's pool trades against. */
type CurrencyType = (typeof CurrencyType)[keyof typeof CurrencyType] | (string & {});
/** What kind of thing a search result is. */
declare const EntityType: {
    readonly UserProfile: "USER_PROFILE";
    readonly Content: "CONTENT";
    readonly Trend: "TREND";
    readonly Coin: "COIN";
};
/** What kind of thing a search result is. */
type EntityType = (typeof EntityType)[keyof typeof EntityType] | (string & {});
/** Whether a social account was linked or unlinked. */
declare const EventType: {
    readonly Link: "LINK";
    readonly Unlink: "UNLINK";
};
/** Whether a social account was linked or unlinked. */
type EventType = (typeof EventType)[keyof typeof EventType] | (string & {});
/** Which Zora Explore list to fetch. */
declare const ListType: {
    readonly TopGainers: "TOP_GAINERS";
    readonly TopVolume24h: "TOP_VOLUME_24H";
    readonly MostValuable: "MOST_VALUABLE";
    readonly MostValuableTrends: "MOST_VALUABLE_TRENDS";
    readonly New: "NEW";
    readonly NewTrends: "NEW_TRENDS";
    readonly Old: "OLD";
    readonly LastTraded: "LAST_TRADED";
    readonly LastTradedUnique: "LAST_TRADED_UNIQUE";
    readonly Featured: "FEATURED";
    readonly FeaturedVideos: "FEATURED_VIDEOS";
    readonly NewCreators: "NEW_CREATORS";
    readonly MostValuableCreators: "MOST_VALUABLE_CREATORS";
    readonly FeaturedCreators: "FEATURED_CREATORS";
    readonly TopVolumeCreators24h: "TOP_VOLUME_CREATORS_24H";
    readonly TopVolumeAll24h: "TOP_VOLUME_ALL_24H";
    readonly NewAll: "NEW_ALL";
    readonly TrendingPosts: "TRENDING_POSTS";
    readonly TrendingTrends: "TRENDING_TRENDS";
    readonly TrendingCreators: "TRENDING_CREATORS";
    readonly TrendingAll: "TRENDING_ALL";
    readonly TopVolumeTrends24h: "TOP_VOLUME_TRENDS_24H";
    readonly MostValuableAll: "MOST_VALUABLE_ALL";
    readonly TrendingAgents: "TRENDING_AGENTS";
    readonly MostValuableAgents: "MOST_VALUABLE_AGENTS";
};
/** Which Zora Explore list to fetch. */
type ListType = (typeof ListType)[keyof typeof ListType] | (string & {});
/** How coin metadata is supplied. Only RAW_URI is supported. */
declare const MetadataType: {
    readonly RawUri: "RAW_URI";
};
/** How coin metadata is supplied. Only RAW_URI is supported. */
type MetadataType = (typeof MetadataType)[keyof typeof MetadataType] | (string & {});
/** A social network Zora profiles link to. */
declare const Platform: {
    readonly Twitter: "TWITTER";
    readonly Tiktok: "TIKTOK";
    readonly Farcaster: "FARCASTER";
    readonly Instagram: "INSTAGRAM";
};
/** A social network Zora profiles link to. */
type Platform = (typeof Platform)[keyof typeof Platform] | (string & {});
/** How to order a profile's balances. */
declare const SortOption: {
    readonly Balance: "BALANCE";
    readonly MarketCap: "MARKET_CAP";
    readonly UsdValue: "USD_VALUE";
    readonly PriceChange: "PRICE_CHANGE";
    readonly MarketValueUsd: "MARKET_VALUE_USD";
};
/** How to order a profile's balances. */
type SortOption = (typeof SortOption)[keyof typeof SortOption] | (string & {});
/** The starting market cap tier for a new coin. */
declare const StartingMarketCap: {
    readonly Low: "LOW";
    readonly High: "HIGH";
};
/** The starting market cap tier for a new coin. */
type StartingMarketCap = (typeof StartingMarketCap)[keyof typeof StartingMarketCap] | (string & {});
/** Whether a trade was a buy or a sell. */
declare const SwapType: {
    readonly Buy: "BUY";
    readonly Sell: "SELL";
};
/** Whether a trade was a buy or a sell. */
type SwapType = (typeof SwapType)[keyof typeof SwapType] | (string & {});
/** Native ETH or an ERC-20. */
declare const TokenType: {
    readonly Eth: "eth";
    readonly Erc20: "erc20";
};
/** Native ETH or an ERC-20. */
type TokenType = (typeof TokenType)[keyof typeof TokenType] | (string & {});
/** How a wallet linked to a profile is held. */
declare const WalletType: {
    readonly Privy: "PRIVY";
    readonly External: "EXTERNAL";
    readonly SmartWallet: "SMART_WALLET";
};
/** How a wallet linked to a profile is held. */
type WalletType = (typeof WalletType)[keyof typeof WalletType] | (string & {});
/** A Zora API object. */
interface Amount {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** The currency (WETH, ZORA, USDC or a creator coin). */
    currencyAddress?: string | null;
    /** Amount in the currency's smallest unit, as an integer string. */
    amountRaw?: string | null;
    /** Amount in whole units of the currency. */
    amountDecimal?: number | null;
}
/** Whether an API key exists and is active. */
interface ApiKey {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** The API key. */
    apiKey?: string | null;
    /** Whether the key is active. */
    isActive?: boolean | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface ApiKeyResponse {
    /** The API key. */
    apiKey?: ApiKey | null;
}
/** A Zora API object. */
interface Avatar {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Resized preview of the image. */
    previewImage?: PreviewImage | null;
    /** Small avatar image URL. */
    small?: string | null;
    /** Medium avatar image URL. */
    medium?: string | null;
    /** BlurHash placeholder to show while the image loads. */
    blurhash?: string | null;
}
/** A transaction to send from the user's wallet: target (to), calldata and ETH value. */
interface Call {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Calldata (0x hex). */
    data?: string | null;
    /** ETH to send with the transaction, in wei, as an integer string. */
    value?: string | null;
    /** Contract to send the transaction to. */
    target?: string | null;
    /** Same as target. */
    to?: string | null;
}
/** One coin a profile holds, with the balance and the coin itself. */
interface CoinBalance {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Amount held, in the coin's smallest unit (18 decimals). */
    balance?: string | null;
    /** Amount held in the profile's own wallets, in the smallest unit (18 decimals). */
    walletBalance?: string | null;
    /** Globally unique ID. */
    id?: string | null;
    /** What the holding is worth. */
    valuation?: Valuation | null;
    /** The coin. */
    coin?: Zora20Token | null;
}
/**
 * One page of CoinBalance results. `nodes(page)` lists them; PageInfo says how to get the next
 * page.
 */
interface CoinBalanceConnection {
    /** Total number of items, where the API reports it. */
    count?: number | null;
    /** The items on this page, each wrapped in an edge. */
    edges?: CoinBalanceEdge[] | null;
    /** How to fetch the next page. */
    pageInfo?: PageInfo | null;
}
/** Wraps one CoinBalance in a page of results. */
interface CoinBalanceEdge {
    /** The item. */
    node?: CoinBalance | null;
}
/** The compact form of a coin returned by the coins list. */
interface CoinBasicInfo {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Creator, content or trend coin. */
    coinType?: CoinType | null;
    /** Price in USDC (≈ USD), as a decimal string. */
    priceUsdc?: string | null;
    /** Name of the coin. */
    entityName?: string | null;
    /** Display name. */
    name?: string | null;
    /** Ticker symbol. */
    symbol?: string | null;
    /** Metadata URI. */
    uri?: string | null;
    /** Contract address of the coin. */
    coinAddress?: string | null;
    /** Wallet that created the coin. */
    createdUserAddress?: string | null;
    /** Date with time (isoformat) */
    createdTimestamp?: string | null;
    /** True if Zora hides this from its own app. */
    platformBlocked?: boolean | null;
}
/**
 * One page of CoinBasicInfo results. `nodes(page)` lists them; PageInfo says how to get the next
 * page.
 */
interface CoinBasicInfoConnection {
    /** How to fetch the next page. */
    pageInfo?: PageInfo | null;
    /** The items on this page, each wrapped in an edge. */
    edges?: CoinBasicInfoEdge[] | null;
}
/** Wraps one CoinBasicInfo in a page of results. */
interface CoinBasicInfoEdge {
    /** The item. */
    node?: CoinBasicInfo | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface CoinCommentsResponse {
    /** The result. Client methods return this field directly. */
    zora20Token?: Zora20Token | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface CoinHoldersResponse {
    /** The result. Client methods return this field directly. */
    zora20Token?: Zora20Token | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface CoinMergedCommentsResponse {
    /** The result. Client methods return this field directly. */
    zora20Token?: Zora20Token | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface CoinPriceHistoryResponse {
    /** The result. Client methods return this field directly. */
    zora20Token?: Zora20Token | null;
}
/** A coin to fetch with Coins: its chain and contract address. */
interface CoinRefInput {
    /** Chain ID (8453 = Base). */
    chainId: number;
    /** Contract address of the coin. */
    collectionAddress: string;
}
/** The raw response envelope. Client methods unwrap it. */
interface CoinResponse {
    /** The result. Client methods return this field directly. */
    zora20Token?: Zora20Token | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface CoinSwapsResponse {
    /** The result. Client methods return this field directly. */
    zora20Token?: Zora20Token | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface CoinsListResponse {
    /** The result. Client methods return this field directly. */
    coinsBasicInfo?: CoinBasicInfoConnection | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface CoinsResponse {
    /** The result. Client methods return this field directly. */
    zora20Tokens?: Zora20Token[] | null;
}
/** A comment in a coin's merged feed or on a live stream. */
interface Comment {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** ID of the comment. */
    commentId?: string | null;
    /** Nonce the comment was signed or posted with. */
    nonce?: string | null;
    /** Wallet of the user who posted it. */
    userAddress?: string | null;
    /** Hash of the transaction that posted it onchain, if it was posted onchain. */
    txHash?: string | null;
    /** The comment text. */
    comment?: string | null;
    /** When it happened (Unix seconds). */
    timestamp?: number | null;
    /** Profile of the user who posted it. */
    userProfile?: UserProfile | null;
    /** Replies to this comment. */
    replies?: Replies | null;
    /** Contract of the coin the comment is on. */
    contractAddress?: string | null;
    /** The comment text. */
    text?: string | null;
    /** Date with time (isoformat) */
    commentedAt?: string | null;
    /** Onchain ID of the comment this replies to, if any. */
    replyToOnChainId?: string | null;
    /** Offchain ID of the comment this replies to, if any. */
    replyToOffChainId?: string | null;
    /** Sparks (Zora's likes) the comment received. */
    sparkCount?: number | null;
    /** The profile. */
    profile?: Profile | null;
    /** Globally unique ID. */
    id?: string | null;
}
/** One page of Comment results. `nodes(page)` lists them; PageInfo says how to get the next page. */
interface CommentConnection {
    /** How to fetch the next page. */
    pageInfo?: PageInfo | null;
    /** Total number of items, where the API reports it. */
    count?: number | null;
    /** The items on this page, each wrapped in an edge. */
    edges?: CommentEdge[] | null;
}
/** Wraps one Comment in a page of results. */
interface CommentEdge {
    /** The item. */
    node?: Comment | null;
    /** Cursor pointing at this item. */
    cursor?: string | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface ContentCoinPoolConfigResponse {
    /** The result. Client methods return this field directly. */
    contentCoinPoolConfig?: PoolConfig | null;
}
/** A content coin to create. Metadata must point at EIP-7572 JSON (ipfs:// or https://). */
interface CreateContentCoinRequest {
    /** Wallet creating the coin. */
    creator: string;
    /** Display name. */
    name: string;
    /** Ticker symbol. */
    symbol: string;
    /** Where the coin's EIP-7572 metadata lives. */
    metadata: MetadataInput;
    /** The currency. */
    currency: ContentCoinCurrency;
    /** Chain ID (8453 = Base). */
    chainId?: number;
    /** Starting market cap tier. */
    startingMarketCap?: StartingMarketCap;
    /** Your app's address: it earns the platform referral share of this coin's trading fees for good. */
    platformReferrer?: string;
    /** More wallets allowed to manage the coin. */
    additionalOwners?: string[];
    /** Wallet to receive the creator's fee share instead of the creator. */
    payoutRecipientOverride?: string;
    /** Optional flag to enable smart wallet routing. Defaults to false if omitted. */
    enableSmartWalletRouting?: boolean;
}
/** The calls that create a content coin, and the address it will have. */
interface CreateContentCoinResponse {
    /** Transactions to send from the creator's wallet, in order. */
    calls?: Call[] | null;
    /** The address the coin will have once created. */
    predictedCoinAddress?: string | null;
    /** The result. Client methods return this field directly. */
    backingCurrency?: string | null;
    /** The result. Client methods return this field directly. */
    usedSmartWalletRouting?: boolean | null;
}
/** Who the upload token is for. */
interface CreateUploadJwtRequest {
    /** Wallet the upload token is for. */
    creatorAddress: string;
}
/** The raw response envelope. Client methods unwrap it. */
interface CreateUploadJwtResponse {
    /** The result. Client methods return this field directly. */
    createUploadJwtFromApiKey?: string | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface CreatorCoinPoolConfigResponse {
    /** The result. Client methods return this field directly. */
    creatorCoinPoolConfig?: PoolConfig | null;
}
/** What a coin's creator has earned from trading fees, in one currency. */
interface CreatorEarning {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** The amount. */
    amount?: Amount | null;
    /** The amount in USD. */
    amountUsd?: string | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface CreatorLivestreamCommentsResponse {
    /** The result. Client methods return this field directly. */
    zora20Token?: Zora20Token | null;
}
/** The profile of the creator behind a coin. */
interface CreatorProfile {
    /** The profile kind, e.g. GraphQLAccountProfile. */
    __typename?: string | null;
    /** Globally unique ID. */
    id?: string | null;
    /** Zora handle, without @. Wallet-only profiles get a shortened address (0x06d7...b1c6). */
    handle?: string | null;
    /** True if Zora hides this from its own app. */
    platformBlocked?: boolean | null;
    /** Profile picture. */
    avatar?: Avatar | null;
    /** Linked social accounts: X, TikTok, Instagram, Farcaster. */
    socialAccounts?: SocialAccounts | null;
    /** The creator's own creator coin. */
    creatorCoin?: Zora20Token | null;
    /** The creator's live stream, if any. */
    liveStream?: LiveStream | null;
}
/** A Zora API object. */
interface Currency {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Current USD price of one whole token, as a decimal string. */
    priceUsd?: string | null;
    /** Token decimals (18 for most, 6 for USDC). */
    decimals?: number | null;
    /** Display name. */
    name?: string | null;
    /** Ticker symbol. */
    symbol?: string | null;
    /** Token icon URL. */
    icon?: string | null;
}
/** A Zora API object. */
interface CurrencyAmountWithPrice {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** USD price of one unit of the currency at the time of the swap. */
    priceUsdc?: string | null;
    /** Amount paid or received, in the pool's currency. */
    currencyAmount?: Amount | null;
    /** The amount in USD. */
    amountUsd?: string | null;
    /** Change in the currency's price over the last 24 hours. */
    priceDelta24h?: string | null;
}
/** A Zora API object. */
interface Details {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Token address. */
    token?: string | null;
    /** The amount. */
    amount?: string | null;
    /** When the allowance expires (Unix seconds). */
    expiration?: number | null;
    /** Nonce the comment was signed or posted with. */
    nonce?: number | null;
}
/** A Zora API object. */
interface DetailsInput {
    /** Token address. */
    token: string;
    /** The amount. */
    amount: string;
    /** When the allowance expires (Unix seconds). */
    expiration: number;
    /** Nonce the comment was signed or posted with. */
    nonce: number;
}
/** ERC-20 metadata and price for any token. */
interface Erc20Token {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** The token's symbol, decimals and USD price. */
    currency?: Currency | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface ExploreResponse {
    /** The result. Client methods return this field directly. */
    exploreList?: Zora20TokenConnection | null;
}
/** A Zora API object. */
interface ExternalWallet {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** ENS name of the wallet, if it has one. */
    ensName?: string | null;
    /** Wallet address. */
    walletAddress?: string | null;
}
/** A creator featured on the weekly leaderboard. */
interface FeaturedCreator {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Globally unique ID. */
    id?: string | null;
    /** Zora handle, without @. Wallet-only profiles get a shortened address (0x06d7...b1c6). */
    handle?: string | null;
}
/**
 * One page of FeaturedCreator results. `nodes(page)` lists them; PageInfo says how to get the next
 * page.
 */
interface FeaturedCreatorConnection {
    /** Total number of items, where the API reports it. */
    count?: number | null;
    /** How to fetch the next page. */
    pageInfo?: PageInfo | null;
    /** The items on this page, each wrapped in an edge. */
    edges?: FeaturedCreatorEdge[] | null;
}
/** Wraps one FeaturedCreator in a page of results. */
interface FeaturedCreatorEdge {
    /** The item. */
    node?: FeaturedCreator | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface FeaturedCreatorsResponse {
    /** The result. Client methods return this field directly. */
    traderLeaderboardFeaturedCreators?: FeaturedCreatorConnection | null;
}
/** A Zora API object. */
interface Followers {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Total number of items, where the API reports it. */
    count?: number | null;
}
/** A Zora API object. */
interface Instagram {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Username on that network. */
    username?: string | null;
    /** Display name on that network. */
    displayName?: string | null;
    /** Followers on that network. */
    followerCount?: number | null;
    /** Globally unique ID. */
    id?: string | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface LatestLiveStreamsResponse {
    /** The result. Client methods return this field directly. */
    latestLiveStreams?: LiveStreamConnection | null;
}
/** Wraps one LinkedWallet in a page of results. */
interface LinkedWalletEdge {
    /** The item. */
    node?: PublicWallet | null;
}
/** A Zora API object. */
interface LinkedWallets {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** The items on this page, each wrapped in an edge. */
    edges?: LinkedWalletEdge[] | null;
}
/** A creator's live stream. */
interface LiveStream {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Comments. */
    comments?: CommentConnection | null;
    /** Globally unique ID. */
    id?: string | null;
    /** Whether the stream is live right now. */
    isOnline?: boolean | null;
    /** Whether the key is active. */
    isActive?: boolean | null;
    /** People watching right now. */
    concurrentViewers?: number | null;
    /** Still thumbnail image URL. */
    staticThumbnailUrl?: string | null;
    /** Animated thumbnail URL. */
    animatedThumbnailUrl?: string | null;
    /** Profile of the creator. */
    creatorProfile?: CreatorProfile | null;
}
/**
 * One page of LiveStream results. `nodes(page)` lists them; PageInfo says how to get the next
 * page.
 */
interface LiveStreamConnection {
    /** How to fetch the next page. */
    pageInfo?: PageInfo | null;
    /** The items on this page, each wrapped in an edge. */
    edges?: LiveStreamEdge[] | null;
}
/** Wraps one LiveStream in a page of results. */
interface LiveStreamEdge {
    /** The item. */
    node?: LiveStream | null;
}
/** A Zora API object. */
interface MaxSwappable {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Raw amount of the currency, in wei. Not formatted with decimals */
    amountRaw?: string | null;
    /** Amount of the currency, in float format accounting for currency decimals */
    amountDecimal?: number | null;
}
/** The image, video or other media attached to a coin. */
interface MediaContent {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** MIME type of the original media. */
    mimeType?: string | null;
    /** The original media file (often ipfs://). */
    originalUri?: string | null;
    /** Resized previews served over https. */
    previewImage?: PreviewImage | null;
    /** Short video preview URL. */
    videoPreviewUrl?: string | null;
    /** HLS stream URL of the video. */
    videoHlsUrl?: string | null;
}
/** A Zora API object. */
interface MetadataInput {
    /** eth for native ETH, erc20 for a token (which then needs an address). */
    type: MetadataType;
    /** Metadata URI. */
    uri: string;
}
/** A Zora API object. */
interface OwnerProfile {
    /** GraphQLAccountProfile for a Zora account, GraphQLWalletProfile for a bare wallet. */
    __typename?: string | null;
    /** Globally unique ID. */
    id?: string | null;
    /** Zora handle, without @. Wallet-only profiles get a shortened address (0x06d7...b1c6). */
    handle?: string | null;
    /** True if Zora hides this from its own app. */
    platformBlocked?: boolean | null;
    /** Profile picture. */
    avatar?: Avatar | null;
}
/**
 * Where a page sits in a paginated list. Pass EndCursor as After to get the next page while
 * HasNextPage is true.
 */
interface PageInfo {
    /** Cursor to pass as After for the next page. */
    endCursor?: string | null;
    /** Whether another page follows. */
    hasNextPage?: boolean | null;
    /** Cursor of the first item on this page. */
    startCursor?: string | null;
}
/** A Zora API object. */
interface Permit {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** When the signature stops being valid (Unix seconds). */
    sigDeadline?: string | null;
    /** Contract allowed to spend the tokens. */
    spender?: string | null;
    /** What the permit allows: token, amount, expiry, nonce. */
    details?: Details | null;
}
/** A Zora API object. */
interface PermitInput {
    /** What the permit allows: token, amount, expiry, nonce. */
    details: DetailsInput;
    /** Contract allowed to spend the tokens. */
    spender: string;
    /** When the signature stops being valid (Unix seconds). */
    sigDeadline: string;
}
/**
 * The pool configuration Zora uses to launch a coin: encoded config plus the currency it pairs
 * with.
 */
interface PoolConfig {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** The pool configuration, ABI-encoded as the coin factory expects it. */
    encodedConfig?: string | null;
    /** The currency. */
    currency?: string | null;
    /** Lower tick of each liquidity position the pool starts with. */
    lowerTicks?: number[] | null;
    /** Upper tick of each liquidity position the pool starts with. */
    upperTicks?: number[] | null;
    /** Number of price-discovery liquidity positions per range. */
    numDiscoveryPositions?: number[] | null;
    /** Share of supply placed in each discovery range, in 18-decimal fixed point. */
    maxDiscoverySupplyShares?: string[] | null;
}
/** The currency a coin's pool trades against (ZORA, ETH, USDC or a creator coin). */
interface PoolCurrencyToken {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Contract address (lowercase 0x hex). */
    address?: string | null;
    /** Display name. */
    name?: string | null;
    /** Token decimals (18 for most, 6 for USDC). */
    decimals?: number | null;
}
/** A Zora API object. */
interface PreviewImage {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** BlurHash placeholder to show while the image loads. */
    blurhash?: string | null;
    /** Medium preview image URL. */
    medium?: string | null;
    /** Small preview image URL. */
    small?: string | null;
}
/** The price of a coin at a moment in time. */
interface PricePoint {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Start of the interval (ISO 8601, UTC). */
    timestamp?: string | null;
    /** Price at the end of the interval, in USD. */
    closePrice?: string | null;
}
/**
 * A Zora profile: handle, avatar, linked wallets, creator coin, and (depending on the call) the
 * coins it created or holds.
 */
interface Profile {
    /** The profile kind, e.g. GraphQLAccountProfile. */
    __typename?: string | null;
    /** Globally unique ID. */
    id?: string | null;
    /** Zora handle, without @. Wallet-only profiles get a shortened address (0x06d7...b1c6). */
    handle?: string | null;
    /** Profile picture. */
    avatar?: Avatar | null;
    /** True if Zora hides this from its own app. */
    platformBlocked?: boolean | null;
    /** Linked social accounts: X, TikTok, Instagram, Farcaster. */
    socialAccounts?: SocialAccounts | null;
    /** The creator's own creator coin. */
    creatorCoin?: Zora20Token | null;
    /** Username on that network. */
    username?: string | null;
    /** When it was created (ISO 8601, UTC). */
    createdAt?: string | null;
    /** Display name on that network. */
    displayName?: string | null;
    /** Profile bio. */
    bio?: string | null;
    /** Website on the profile. */
    website?: string | null;
    /** The profile's primary public wallet. */
    publicWallet?: PublicWallet | null;
    /** Wallets linked to the profile. */
    linkedWallets?: LinkedWallets | null;
    /** Coins the profile holds (only filled by the profile-balances endpoint). */
    coinBalances?: CoinBalanceConnection | null;
    /** Coins the profile created (only filled by the profile-coins endpoint). */
    createdCoins?: Zora20TokenConnection | null;
    /** How many times the handle has been changed. */
    usernameChangesCount?: number | null;
    /** An external wallet linked to the profile. */
    externalWallet?: ExternalWallet | null;
    /** Who follows this profile. */
    followers?: Followers | null;
    /** Who this profile follows. */
    following?: Followers | null;
    /** History of social accounts being linked and unlinked. */
    socialAccountLinkedEvents?: SocialAccountLinkedEvents | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface ProfileBalancesResponse {
    /** The profile. */
    profile?: Profile | null;
}
/** A Zora API object. */
interface ProfileBySocialHandle {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Globally unique ID. */
    id?: string | null;
    /** Zora handle, without @. Wallet-only profiles get a shortened address (0x06d7...b1c6). */
    handle?: string | null;
    /** True if Zora hides this from its own app. */
    platformBlocked?: boolean | null;
    /** Profile picture. */
    avatar?: Avatar | null;
    /** Linked social accounts: X, TikTok, Instagram, Farcaster. */
    socialAccounts?: SocialAccounts | null;
    /** The creator's own creator coin. */
    creatorCoin?: Zora20Token | null;
    /** Username on that network. */
    username?: string | null;
    /** Display name on that network. */
    displayName?: string | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface ProfileBySocialHandleResponse {
    /** The result. Client methods return this field directly. */
    profileBySocialHandle?: ProfileBySocialHandle | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface ProfileCoinsResponse {
    /** The profile. */
    profile?: Profile | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface ProfileResponse {
    /** The profile. */
    profile?: Profile | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface ProfileSocialResponse {
    /** The profile. */
    profile?: Profile | null;
}
/** A Zora API object. */
interface PublicWallet {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Wallet address. */
    walletAddress?: string | null;
    /** How the wallet is held (Privy, external, smart wallet). */
    walletType?: WalletType | null;
}
/** What a trade is expected to return. */
interface Quote {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Expected output, in the output token's smallest unit. */
    amountOut?: string | null;
    /** Slippage tolerance the quote was built with (0.05 = 5%). */
    slippage?: number | null;
    /** The token being sold. */
    tokenIn?: TokenSpec | null;
}
/**
 * A trade to quote. TokenIn, TokenOut, AmountIn and Sender are required; Recipient defaults to
 * Sender and Slippage to 0.05.
 */
interface QuoteRequest {
    /** Address that earns the trade referral reward for routing this trade. */
    referrer?: string;
    /** Permit2 signatures, when selling an ERC-20 without a prior approval. */
    signatures?: SignatureInput[];
    /** How long a Permit2 signature stays valid, in seconds. */
    permitActiveSeconds?: number;
    /** Chain ID (8453 = Base). */
    chainId?: number;
    /** What to buy. Use ETH() or ERC20(address). */
    tokenOut: TokenSpecInput;
    /** What to sell. Use ETH() or ERC20(address). */
    tokenIn: TokenSpecInput;
    /** Amount to sell, in the input token's smallest unit (wei for ETH). */
    amountIn: string;
    /** Maximum slippage (0.05 = 5%). Defaults to 5% with QuoteTrade. */
    slippage?: number;
    /** Wallet that receives the output. Defaults to the sender with QuoteTrade. */
    recipient?: string;
    /** Wallet that will send the transaction. */
    sender: string;
}
/** A trade quote and the transaction that executes it. */
interface QuoteResponse {
    /** Whether a route was found. Sent by the API as a string; the SDKs read it as a boolean. */
    success?: boolean | null;
    /** The transaction to send from the sender's wallet. */
    call?: Call | null;
    /** Permit2 permits the sender must sign first, when selling an ERC-20. */
    permits?: SignedPermit[] | null;
    /** The Universal Router trade encoded in the call. */
    trade?: Trade | null;
    /** What the trade is expected to return. */
    quote?: Quote | null;
}
/** A Zora API object. */
interface Replies {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Total number of items, where the API reports it. */
    count?: number | null;
    /** The items on this page, each wrapped in an edge. */
    edges?: ReplyEdge[] | null;
}
/** A Zora API object. */
interface Reply {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** ID of the comment. */
    commentId?: string | null;
    /** Nonce the comment was signed or posted with. */
    nonce?: string | null;
    /** Wallet of the user who posted it. */
    userAddress?: string | null;
    /** Hash of the transaction that posted it onchain, if it was posted onchain. */
    txHash?: string | null;
    /** The comment text. */
    comment?: string | null;
    /** When it happened (Unix seconds). */
    timestamp?: number | null;
    /** Profile of the user who posted it. */
    userProfile?: UserProfile | null;
    /** Contract of the coin the comment is on. */
    contractAddress?: string | null;
    /** The comment text. */
    text?: string | null;
    /** Date with time (isoformat) */
    commentedAt?: string | null;
    /** Onchain ID of the comment this replies to, if any. */
    replyToOnChainId?: string | null;
    /** Offchain ID of the comment this replies to, if any. */
    replyToOffChainId?: string | null;
    /** Sparks (Zora's likes) the comment received. */
    sparkCount?: number | null;
    /** The profile. */
    profile?: Profile | null;
}
/** Wraps one Reply in a page of results. */
interface ReplyEdge {
    /** The item. */
    node?: Reply | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface SearchResponse {
    /** The result. Client methods return this field directly. */
    globalSearch?: SearchResultConnection | null;
}
/** One search hit: a profile, a coin, a piece of content or a trend. */
interface SearchResult {
    /**
     * What was found: GlobalSearchCoinResult, GlobalSearchTrendResult or
     * GlobalSearchUserProfileResult.
     */
    __typename?: string | null;
    /** What kind of thing this result is. */
    entityType?: EntityType | null;
    /** The profile. */
    profile?: Profile | null;
    /** The coin. */
    coin?: Zora20Token | null;
    /** The trend coin, for trend search results. */
    trend?: Zora20Token | null;
}
/**
 * One page of SearchResult results. `nodes(page)` lists them; PageInfo says how to get the next
 * page.
 */
interface SearchResultConnection {
    /** How to fetch the next page. */
    pageInfo?: PageInfo | null;
    /** The items on this page, each wrapped in an edge. */
    edges?: SearchResultEdge[] | null;
}
/** Wraps one SearchResult in a page of results. */
interface SearchResultEdge {
    /** Cursor pointing at this item. */
    cursor?: string | null;
    /** The item. */
    node?: SearchResult | null;
}
/** A Zora API object. */
interface SignatureInput {
    /** The Permit2 permit. */
    permit: PermitInput;
    /** The signature. */
    signature: string;
}
/** A Zora API object. */
interface SignedPermit {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** The signature. */
    signature?: string | null;
    /** The Permit2 permit. */
    permit?: Permit | null;
}
/** A Zora API object. */
interface SocialAccountLinkedEvent {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Globally unique ID. */
    id?: string | null;
    /** The social network. */
    platform?: Platform | null;
    /** Username on the social network. */
    socialAccountUsername?: string | null;
    /** Date with time (isoformat) */
    occurredAt?: string | null;
    /** Whether the account was linked or unlinked. */
    eventType?: EventType | null;
}
/** Wraps one SocialAccountLinkedEvent in a page of results. */
interface SocialAccountLinkedEventEdge {
    /** The item. */
    node?: SocialAccountLinkedEvent | null;
}
/** A Zora API object. */
interface SocialAccountLinkedEvents {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** The items on this page, each wrapped in an edge. */
    edges?: SocialAccountLinkedEventEdge[] | null;
}
/** A Zora API object. */
interface SocialAccounts {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Linked Instagram account. */
    instagram?: Instagram | null;
    /** Linked TikTok account. */
    tiktok?: Instagram | null;
    /** Linked X (Twitter) account. */
    twitter?: Instagram | null;
    /** Linked Farcaster account. */
    farcaster?: Instagram | null;
}
/** One buy or sell of a coin. */
interface SwapActivity {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Globally unique ID. */
    id?: string | null;
    /** Amount in the pool's currency, with the currency's USD price at the time. */
    currencyAmountWithPrice?: CurrencyAmountWithPrice | null;
    /** Wallet that sent the swap. */
    senderAddress?: string | null;
    /** Wallet that received the output. */
    recipientAddress?: string | null;
    /** Hash of the transaction it happened in. */
    transactionHash?: string | null;
    /** Coins bought or sold, in the smallest unit (18 decimals). */
    coinAmount?: string | null;
    /** Time of the block it happened in (ISO 8601, UTC). */
    blockTimestamp?: string | null;
    /** BUY or SELL. */
    activityType?: SwapType | null;
    /** Profile of the wallet that sent the trade. */
    senderProfile?: OwnerProfile | null;
}
/**
 * One page of SwapActivity results. `nodes(page)` lists them; PageInfo says how to get the next
 * page.
 */
interface SwapActivityConnection {
    /** Total number of items, where the API reports it. */
    count?: number | null;
    /** The items on this page, each wrapped in an edge. */
    edges?: SwapActivityEdge[] | null;
    /** How to fetch the next page. */
    pageInfo?: PageInfo | null;
}
/** Wraps one SwapActivity in a page of results. */
interface SwapActivityEdge {
    /** The item. */
    node?: SwapActivity | null;
    /** Cursor pointing at this item. */
    cursor?: string | null;
}
/** One holder of a coin and how much they hold. */
interface TokenBalance {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Amount held, in the coin's smallest unit (18 decimals) — divide by 1e18 for whole coins. */
    balance?: string | null;
    /** Wallet holding the coin. */
    ownerAddress?: string | null;
    /** Profile of the holder (a wallet profile if the holder has no Zora account). */
    ownerProfile?: OwnerProfile | null;
}
/**
 * One page of TokenBalance results. `nodes(page)` lists them; PageInfo says how to get the next
 * page.
 */
interface TokenBalanceConnection {
    /** How to fetch the next page. */
    pageInfo?: PageInfo | null;
    /** Total number of items, where the API reports it. */
    count?: number | null;
    /** The items on this page, each wrapped in an edge. */
    edges?: TokenBalanceEdge[] | null;
}
/** Wraps one TokenBalance in a page of results. */
interface TokenBalanceEdge {
    /** The item. */
    node?: TokenBalance | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface TokenInfoResponse {
    /** The result. Client methods return this field directly. */
    erc20Token?: Erc20Token | null;
}
/** A coin's current price, in the pool's currency and in USD. */
interface TokenPrice {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Price of one whole coin in USDC (≈ USD), as a decimal string. */
    priceInUsdc?: string | null;
    /** The coin the price is for. */
    currencyAddress?: string | null;
    /** Price of one whole coin in the pool's currency, as a decimal string. */
    priceInPoolToken?: string | null;
}
/** A token in a trade quote: native ETH or an ERC-20 address. */
interface TokenSpec {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** eth for native ETH, erc20 for a token (which then needs an address). */
    type?: string | null;
    /** Contract address (lowercase 0x hex). */
    address?: string | null;
}
/**
 * A token to trade: native ETH (type "eth") or an ERC-20 (type "erc20" plus address). Build one
 * with ETH() or ERC20(address).
 */
interface TokenSpecInput {
    /** eth for native ETH, erc20 for a token (which then needs an address). */
    type: TokenType;
    /** Contract address (lowercase 0x hex). */
    address?: string;
}
/** The raw response envelope. Client methods unwrap it. */
interface TopLiveStreamsResponse {
    /** The result. Client methods return this field directly. */
    topLiveStreams?: LiveStreamConnection | null;
}
/** A Zora API object. */
interface Trade {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Universal Router commands the trade executes (hex). */
    commands?: string[] | null;
    /** ETH to send, in wei. */
    value?: string | null;
    /** ABI-encoded input for each command. */
    inputs?: string[] | null;
}
/** One trade made by a wallet. */
interface TradeActivity {
    /** The activity kind, e.g. GraphQLCoinSwapActivity. */
    __typename?: string | null;
    /** Hash of the transaction it happened in. */
    transactionHash?: string | null;
    /** Index of the swap's log within its transaction. */
    transactionLogIndex?: number | null;
    /** Time of the block it happened in (ISO 8601, UTC). */
    blockTimestamp?: string | null;
    /** Coins traded, in the smallest unit (18 decimals). */
    coinAmount?: string | null;
    /** The coin. */
    coin?: Zora20Token | null;
    /** Globally unique ID. */
    id?: string | null;
    /** BUY or SELL. */
    swapActivityType?: SwapType | null;
    /** Amount in the pool's currency, with the currency's USD price at the time. */
    currencyAmountWithPrice?: CurrencyAmountWithPrice | null;
    /** Profile of the wallet that sent the trade. */
    senderProfile?: OwnerProfile | null;
    /** Zora's ID for the trade. */
    orderId?: string | null;
    /** For a coin launch, how much the creator bought at creation. */
    initialBuyAmount?: string | null;
    /** That initial buy in USD. */
    initialBuyAmountUsd?: number | null;
    /** How many times its value the trade has returned, where Zora computes it. */
    multiplier?: number | null;
    /** Profile of the wallet that made the trade. */
    makerProfile?: OwnerProfile | null;
}
/**
 * One page of TradeActivity results. `nodes(page)` lists them; PageInfo says how to get the next
 * page.
 */
interface TradeActivityConnection {
    /** Total number of items, where the API reports it. */
    count?: number | null;
    /** The items on this page, each wrapped in an edge. */
    edges?: TradeActivityEdge[] | null;
    /** How to fetch the next page. */
    pageInfo?: PageInfo | null;
}
/** Wraps one TradeActivity in a page of results. */
interface TradeActivityEdge {
    /** The item. */
    node?: TradeActivity | null;
    /** Cursor pointing at this item. */
    cursor?: string | null;
}
/** One trader's position on the weekly leaderboard. */
interface TraderLeaderboardEntry {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Name of the coin. */
    entityName?: string | null;
    /** Leaderboard score. */
    score?: number | null;
    /** Trading volume this week in USD. */
    weekVolumeUsd?: number | null;
    /** Trades made this week. */
    weekTradesCount?: number | null;
    /** Gross trading volume this week, in ZORA. */
    weekGrossVolumeZora?: number | null;
    /** Profile of the trader. */
    traderProfile?: FeaturedCreator | null;
}
/**
 * One page of TraderLeaderboardEntry results. `nodes(page)` lists them; PageInfo says how to get
 * the next page.
 */
interface TraderLeaderboardEntryConnection {
    /** Total number of items, where the API reports it. */
    count?: number | null;
    /** The items on this page, each wrapped in an edge. */
    edges?: TraderLeaderboardEntryEdge[] | null;
    /** How to fetch the next page. */
    pageInfo?: PageInfo | null;
}
/** Wraps one TraderLeaderboardEntry in a page of results. */
interface TraderLeaderboardEntryEdge {
    /** The item. */
    node?: TraderLeaderboardEntry | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface TraderLeaderboardResponse {
    /** The result. Client methods return this field directly. */
    exploreTraderLeaderboard?: TraderLeaderboardEntryConnection | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface TrendCoinResponse {
    /** The result. Client methods return this field directly. */
    trendCoin?: Zora20Token | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface TrendsByNameResponse {
    /** The result. Client methods return this field directly. */
    trendsByName?: Zora20TokenConnection | null;
}
/** The Uniswap V4 pool key of a coin's market. */
interface UniswapV4PoolKey {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** currency0 of the Uniswap V4 pool key. */
    token0Address?: string | null;
    /** currency1 of the Uniswap V4 pool key. */
    token1Address?: string | null;
    /** Pool fee, in hundredths of a basis point. */
    fee?: number | null;
    /** Tick spacing of the pool. */
    tickSpacing?: number | null;
    /** The pool's hook contract (Zora's coin hook). */
    hookAddress?: string | null;
}
/** A Zora API object. */
interface UserProfile {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** Globally unique ID. */
    id?: string | null;
    /** Zora handle, without @. Wallet-only profiles get a shortened address (0x06d7...b1c6). */
    handle?: string | null;
    /** Profile picture. */
    avatar?: Avatar | null;
}
/** A Zora API object. */
interface Valuation {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** What the holding would fetch at the current price, in USD. */
    marketValueUsd?: string | null;
    /** Balance × price, in USD, ignoring slippage. */
    faceValueUsd?: string | null;
    /** Block the valuation was computed at. */
    blockNumber?: number | null;
    /** The most of the holding that can be sold into the pool right now. */
    maxSwappable?: MaxSwappable | null;
    /** Amount paid or received, in the pool's currency. */
    currencyAmount?: Amount | null;
    /** Why the valuation couldn't be computed, when it couldn't. */
    error?: string | null;
}
/** The raw response envelope. Client methods unwrap it. */
interface WalletTradeActivityResponse {
    /** The result. Client methods return this field directly. */
    walletAddressTradeActivity?: TradeActivityConnection | null;
}
/**
 * A Zora coin: an ERC-20 with a Uniswap V4 market, created by a creator or for a piece of content
 * or a trend. Endpoints return different selections of its fields; anything not selected is empty.
 */
interface Zora20Token {
    /**
     * Which kind of coin this is: GraphQLZora20Token, GraphQLZora20V4Token,
     * GraphQLZora20CreatorToken or GraphQLZora20TrendToken.
     */
    __typename?: string | null;
    /** Globally unique ID. */
    id?: string | null;
    /** True if Zora hides this from its own app. */
    platformBlocked?: boolean | null;
    /** Display name. */
    name?: string | null;
    /** Description from the coin's metadata. */
    description?: string | null;
    /** Contract address (lowercase 0x hex). */
    address?: string | null;
    /** Whether this is a creator coin, a content coin or a trend. */
    coinType?: CoinType | null;
    /** Ticker symbol. */
    symbol?: string | null;
    /** Total supply in whole tokens, as a decimal string ("1000000000" = one billion). */
    totalSupply?: string | null;
    /** All-time trading volume in USD, as a decimal string. */
    totalVolume?: string | null;
    /** Trading volume over the last 24 hours in USD, as a decimal string. */
    volume24h?: string | null;
    /** When it was created (ISO 8601, UTC). */
    createdAt?: string | null;
    /** Wallet that created the coin. */
    creatorAddress?: string | null;
    /** What the coin's pool trades against. */
    poolCurrencyToken?: PoolCurrencyToken | null;
    /** Current price. */
    tokenPrice?: TokenPrice | null;
    /** Market cap in USD, as a decimal string. */
    marketCap?: string | null;
    /**
     * Change in market cap over the last 24 hours in USD (negative when it fell), as a decimal
     * string.
     */
    marketCapDelta24h?: string | null;
    /** Chain ID (8453 = Base). */
    chainId?: number | null;
    /** Metadata URI (EIP-7572 JSON, usually ipfs://). */
    tokenUri?: string | null;
    /** The app that launched the coin; it earns the platform referral share of every trade, for good. */
    platformReferrerAddress?: string | null;
    /** Wallet that receives the creator's share of trading fees. */
    payoutRecipientAddress?: string | null;
    /** Profile of the creator. */
    creatorProfile?: CreatorProfile | null;
    /** The image or video attached to the coin. */
    mediaContent?: MediaContent | null;
    /** Number of distinct wallets holding the coin. */
    uniqueHolders?: number | null;
    /** Pool key of a V4 coin's market. */
    uniswapV4PoolKey?: UniswapV4PoolKey | null;
    /** Pool of a legacy V3 coin. Empty for V4 coins, which use uniswapV4PoolKey. */
    uniswapV3PoolAddress?: string | null;
    /** Comments (only filled by the coin-comments endpoint). */
    zoraComments?: ZoraCommentConnection | null;
    /** What the creator has earned from trading fees, per currency. */
    creatorEarnings?: CreatorEarning[] | null;
    /** Holders (only filled by the coin-holders endpoint). */
    tokenBalances?: TokenBalanceConnection | null;
    /** Comments. */
    comments?: CommentConnection | null;
    /** Prices over the last hour (only filled by the price-history endpoint). */
    oneHour?: PricePoint[] | null;
    /** Prices over the last day. */
    oneDay?: PricePoint[] | null;
    /** Prices over the last week. */
    oneWeek?: PricePoint[] | null;
    /** Prices over the last month. */
    oneMonth?: PricePoint[] | null;
    /** Prices over the coin's whole life. */
    all?: PricePoint[] | null;
    /** Buys and sells (only filled by the coin-swaps endpoint). */
    swapActivities?: SwapActivityConnection | null;
    /** The coin's address on other chains, where Zora reports one. */
    multichainAddress?: string | null;
    /** The coin's Uniswap pool address, where the API reports one. */
    uniswapPoolAddress?: string | null;
}
/**
 * One page of Zora20Token results. `nodes(page)` lists them; PageInfo says how to get the next
 * page.
 */
interface Zora20TokenConnection {
    /** The items on this page, each wrapped in an edge. */
    edges?: Zora20TokenEdge[] | null;
    /** How to fetch the next page. */
    pageInfo?: PageInfo | null;
    /** Total number of items, where the API reports it. */
    count?: number | null;
}
/** Wraps one Zora20Token in a page of results. */
interface Zora20TokenEdge {
    /** The item. */
    node?: Zora20Token | null;
    /** Cursor pointing at this item. */
    cursor?: string | null;
}
/** A comment posted on a coin. */
interface ZoraComment {
    /** The type name Zora's GraphQL backend reports for this object, when it includes one. */
    __typename?: string | null;
    /** ID of the comment. */
    commentId?: string | null;
    /** Nonce the comment was signed or posted with. */
    nonce?: string | null;
    /** Wallet of the user who posted it. */
    userAddress?: string | null;
    /** Hash of the transaction that posted it onchain, if it was posted onchain. */
    txHash?: string | null;
    /** The comment text. */
    comment?: string | null;
    /** When it happened (Unix seconds). */
    timestamp?: number | null;
    /** Profile of the user who posted it. */
    userProfile?: UserProfile | null;
    /** Replies to this comment. */
    replies?: Replies | null;
}
/**
 * One page of ZoraComment results. `nodes(page)` lists them; PageInfo says how to get the next
 * page.
 */
interface ZoraCommentConnection {
    /** How to fetch the next page. */
    pageInfo?: PageInfo | null;
    /** Total number of items, where the API reports it. */
    count?: number | null;
    /** The items on this page, each wrapped in an edge. */
    edges?: ZoraCommentEdge[] | null;
}
/** Wraps one ZoraComment in a page of results. */
interface ZoraCommentEdge {
    /** The item. */
    node?: ZoraComment | null;
}

/** Optional parameters of `ZoraCoins.coin`. */
interface CoinParams {
    /** Chain ID. Defaults to Base (8453). */
    chainId?: number;
}
/** Optional parameters of `ZoraCoins.coinComments`. */
interface CoinCommentsParams {
    /** Chain ID. Defaults to Base (8453). */
    chainId?: number;
    /** Cursor to continue from: the previous page's pageInfo.endCursor. */
    after?: string;
    /** Page size. */
    pageSize?: number;
}
/** Optional parameters of `ZoraCoins.coinHolders`. */
interface CoinHoldersParams {
    /** Chain ID. Defaults to Base (8453). */
    chainId?: number;
    /** Cursor to continue from: the previous page's pageInfo.endCursor. */
    after?: string;
    /** Page size. */
    pageSize?: number;
}
/** Optional parameters of `ZoraCoins.coinMergedComments`. */
interface CoinMergedCommentsParams {
    /** Chain ID. Defaults to Base (8453). */
    chainId?: number;
    /** Cursor to continue from: the previous page's pageInfo.endCursor. */
    after?: string;
    /** Page size. */
    pageSize?: number;
}
/** Optional parameters of `ZoraCoins.coinPriceHistory`. */
interface CoinPriceHistoryParams {
    /** Chain ID. Defaults to Base (8453). */
    chainId?: number;
}
/** Optional parameters of `ZoraCoins.coinSwaps`. */
interface CoinSwapsParams {
    /** Chain ID. Defaults to Base (8453). */
    chainId?: number;
    /** Cursor to continue from: the previous page's pageInfo.endCursor. */
    after?: string;
    /** Page size. */
    pageSize?: number;
}
/** Optional parameters of `ZoraCoins.coinsList`. */
interface CoinsListParams {
    /** Page size. */
    pageSize?: number;
    /** Cursor to continue from: the previous page's pageInfo.endCursor. */
    after?: string;
    /** Include each coin's price in USDC. Defaults to true. */
    includeUSDCPrice?: boolean;
}
/** Optional parameters of `ZoraCoins.contentCoinPoolConfig`. */
interface ContentCoinPoolConfigParams {
    /** Profile handle or wallet of the creator, used to pair with their creator coin. */
    creatorIdentifier?: string;
}
/** Optional parameters of `ZoraCoins.creatorCoinPoolConfig`. */
interface CreatorCoinPoolConfigParams {
    /** Starting market cap to size the pool for, in USD. */
    targetMarketCapUsd?: number;
}
/** Optional parameters of `ZoraCoins.creatorLivestreamComments`. */
interface CreatorLivestreamCommentsParams {
    /** Chain ID. Defaults to Base (8453). */
    chainId?: number;
    /** Cursor to continue from: the previous page's pageInfo.endCursor. */
    after?: string;
    /** Page size. */
    pageSize?: number;
}
/** Optional parameters of `ZoraCoins.explore`. */
interface ExploreParams {
    /** Page size. */
    pageSize?: number;
    /** Cursor to continue from: the previous page's pageInfo.endCursor. */
    after?: string;
}
/** Optional parameters of `ZoraCoins.featuredCreators`. */
interface FeaturedCreatorsParams {
    /** Year of the ISO week. Defaults to the current year. */
    year?: number;
    /** ISO week number. Defaults to the current week. */
    week?: number;
    /** Page size. */
    pageSize?: number;
    /** Cursor to continue from: the previous page's pageInfo.endCursor. */
    after?: string;
}
/** Optional parameters of `ZoraCoins.latestLiveStreams`. */
interface LatestLiveStreamsParams {
    /** Page size. */
    pageSize?: number;
    /** Cursor to continue from: the previous page's pageInfo.endCursor. */
    after?: string;
}
/** Optional parameters of `ZoraCoins.profileBalances`. */
interface ProfileBalancesParams {
    /** Page size. */
    pageSize?: number;
    /** Cursor to continue from: the previous page's pageInfo.endCursor. */
    after?: string;
    /** How to order the balances. */
    sortOption?: SortOption;
    /** Leave out coins the profile has hidden. Defaults to true. */
    excludeHidden?: boolean;
    /** Only include these chains. Defaults to Base. */
    chainIds?: number[];
}
/** Optional parameters of `ZoraCoins.profileCoins`. */
interface ProfileCoinsParams {
    /** Page size. */
    pageSize?: number;
    /** Cursor to continue from: the previous page's pageInfo.endCursor. */
    after?: string;
    /** Only include these chains. Defaults to Base. */
    chainIds?: number[];
    /** Only coins created through one of these platform referrer addresses. */
    platformReferrerAddress?: string[];
}
/** Optional parameters of `ZoraCoins.search`. */
interface SearchParams {
    /** Only return results of this kind. */
    entityType?: EntityType;
    /** Page size. */
    pageSize?: number;
    /** Cursor to continue from: the previous page's pageInfo.endCursor. */
    after?: string;
}
/** Optional parameters of `ZoraCoins.tokenInfo`. */
interface TokenInfoParams {
    /** Chain ID. Defaults to Base (8453). */
    chainId?: number;
}
/** Optional parameters of `ZoraCoins.topLiveStreams`. */
interface TopLiveStreamsParams {
    /** Page size. */
    pageSize?: number;
    /** Cursor to continue from: the previous page's pageInfo.endCursor. */
    after?: string;
}
/** Optional parameters of `ZoraCoins.traderLeaderboard`. */
interface TraderLeaderboardParams {
    /** ISO week number. Defaults to the current week. */
    week?: number;
    /** Year of the ISO week. Defaults to the current year. */
    year?: number;
    /** Page size. */
    pageSize?: number;
    /** Cursor to continue from: the previous page's pageInfo.endCursor. */
    after?: string;
}
/** Optional parameters of `ZoraCoins.trendCoin`. */
interface TrendCoinParams {
    /** Chain ID. Defaults to Base (8453). */
    chainId?: number;
}
/** Optional parameters of `ZoraCoins.trendsByName`. */
interface TrendsByNameParams {
    /** Page size. */
    pageSize?: number;
    /** Cursor to continue from: the previous page's pageInfo.endCursor. */
    after?: string;
}
/** Optional parameters of `ZoraCoins.walletTradeActivity`. */
interface WalletTradeActivityParams {
    /** Cursor to continue from: the previous page's pageInfo.endCursor. */
    after?: string;
    /** Page size. */
    pageSize?: number;
}
/**
 * Client for the Zora Coins API: one method per endpoint, and an `iter…` async generator for every
 * paginated one. Use {@link ZoraCoins}, which adds conveniences on top.
 */
declare class GeneratedClient extends BaseClient {
    /** Look up an API key: whether it exists and is active. `GET /apiKey` */
    apiKey(apiKey: string): Promise<ApiKey | null>;
    /**
     * One coin by contract address: market data, creator profile, media, pool key and creator
     * earnings. Resolves to `null` if there is no such coin. `GET /coin`
     */
    coin(address: string, params?: CoinParams): Promise<Zora20Token | null>;
    /**
     * Comments posted on a coin, newest first. Returns one page; `iterCoinComments` walks every
     * page. `GET /coinComments`
     */
    coinComments(address: string, params?: CoinCommentsParams): Promise<ZoraCommentConnection>;
    /**
     * Every ZoraComment across all pages, fetched as the loop reaches them. `break` stops early;
     * `params.after` picks the starting point.
     */
    iterCoinComments(address: string, params?: CoinCommentsParams): AsyncGenerator<ZoraComment, void, undefined>;
    /**
     * Holders of a coin and their balances, largest first. Returns one page; `iterCoinHolders` walks
     * every page. `GET /coinHolders`
     */
    coinHolders(address: string, params?: CoinHoldersParams): Promise<TokenBalanceConnection>;
    /**
     * Every TokenBalance across all pages, fetched as the loop reaches them. `break` stops early;
     * `params.after` picks the starting point.
     */
    iterCoinHolders(address: string, params?: CoinHoldersParams): AsyncGenerator<TokenBalance, void, undefined>;
    /**
     * A coin's comment feed with replies threaded in, newest first. Returns one page;
     * `iterCoinMergedComments` walks every page. `GET /coinMergedComments`
     */
    coinMergedComments(address: string, params?: CoinMergedCommentsParams): Promise<CommentConnection>;
    /**
     * Every Comment across all pages, fetched as the loop reaches them. `break` stops early;
     * `params.after` picks the starting point.
     */
    iterCoinMergedComments(address: string, params?: CoinMergedCommentsParams): AsyncGenerator<Comment, void, undefined>;
    /**
     * A coin's price history at five resolutions: the last hour, day, week, month, and all time.
     * Resolves to `null` if there is no such coin. `GET /coinPriceHistory`
     */
    coinPriceHistory(address: string, params?: CoinPriceHistoryParams): Promise<Zora20Token | null>;
    /**
     * Buys and sells of a coin, newest first. Returns one page; `iterCoinSwaps` walks every page.
     * `GET /coinSwaps`
     */
    coinSwaps(address: string, params?: CoinSwapsParams): Promise<SwapActivityConnection>;
    /**
     * Every SwapActivity across all pages, fetched as the loop reaches them. `break` stops early;
     * `params.after` picks the starting point.
     */
    iterCoinSwaps(address: string, params?: CoinSwapsParams): AsyncGenerator<SwapActivity, void, undefined>;
    /** Several coins in one request. Missing coins are left out of the result. `GET /coins` */
    coins(coins: CoinRefInput[]): Promise<Zora20Token[]>;
    /**
     * Basic information (address, name, symbol, price) for every coin, in pages of up to 1,000.
     * Returns one page; `iterCoinsList` walks every page. `GET /coinsList`
     */
    coinsList(params?: CoinsListParams): Promise<CoinBasicInfoConnection>;
    /**
     * Every CoinBasicInfo across all pages, fetched as the loop reaches them. `break` stops early;
     * `params.after` picks the starting point.
     */
    iterCoinsList(params?: CoinsListParams): AsyncGenerator<CoinBasicInfo, void, undefined>;
    /**
     * The Uniswap V4 pool configuration Zora uses to launch a content coin paired with the given
     * currency. `GET /contentCoinPoolConfig`
     */
    contentCoinPoolConfig(currencyType: CurrencyType, params?: ContentCoinPoolConfigParams): Promise<PoolConfig | null>;
    /**
     * Create a short-lived token for uploading coin media and metadata to Zora's uploader. Requires
     * an API key. `POST /createUploadJWT`
     */
    createUploadJwt(req: CreateUploadJwtRequest): Promise<string | null>;
    /**
     * The Uniswap V4 pool configuration Zora uses to launch a creator coin, optionally sized for a
     * starting market cap in USD. `GET /creatorCoinPoolConfig`
     */
    creatorCoinPoolConfig(params?: CreatorCoinPoolConfigParams): Promise<PoolConfig | null>;
    /**
     * Comments on the live stream of the creator behind a coin. Returns one page;
     * `iterCreatorLivestreamComments` walks every page. `GET /creatorLivestreamComments`
     */
    creatorLivestreamComments(address: string, params?: CreatorLivestreamCommentsParams): Promise<CommentConnection>;
    /**
     * Every Comment across all pages, fetched as the loop reaches them. `break` stops early;
     * `params.after` picks the starting point.
     */
    iterCreatorLivestreamComments(address: string, params?: CreatorLivestreamCommentsParams): AsyncGenerator<Comment, void, undefined>;
    /**
     * A Zora Explore list: top gainers, 24h volume, newest, most valuable creators and more. See
     * ListType for all 25. Returns one page; `iterExplore` walks every page. `GET /explore`
     */
    explore(listType: ListType, params?: ExploreParams): Promise<Zora20TokenConnection>;
    /**
     * Every Zora20Token across all pages, fetched as the loop reaches them. `break` stops early;
     * `params.after` picks the starting point.
     */
    iterExplore(listType: ListType, params?: ExploreParams): AsyncGenerator<Zora20Token, void, undefined>;
    /**
     * Creators featured on the weekly leaderboard. Defaults to the current week. Returns one page;
     * `iterFeaturedCreators` walks every page. `GET /featuredCreators`
     */
    featuredCreators(params?: FeaturedCreatorsParams): Promise<FeaturedCreatorConnection>;
    /**
     * Every FeaturedCreator across all pages, fetched as the loop reaches them. `break` stops early;
     * `params.after` picks the starting point.
     */
    iterFeaturedCreators(params?: FeaturedCreatorsParams): AsyncGenerator<FeaturedCreator, void, undefined>;
    /**
     * Live streams, most recently started first. Returns one page; `iterLatestLiveStreams` walks
     * every page. `GET /latestLiveStreams`
     */
    latestLiveStreams(params?: LatestLiveStreamsParams): Promise<LiveStreamConnection>;
    /**
     * Every LiveStream across all pages, fetched as the loop reaches them. `break` stops early;
     * `params.after` picks the starting point.
     */
    iterLatestLiveStreams(params?: LatestLiveStreamsParams): AsyncGenerator<LiveStream, void, undefined>;
    /**
     * A profile by handle or wallet address, with its linked wallets and creator coin. Resolves to
     * `null` if there is no such profile. `GET /profile`
     */
    profile(identifier: string): Promise<Profile | null>;
    /**
     * Coins a profile holds, with balances and current values. Returns one page;
     * `iterProfileBalances` walks every page. `GET /profileBalances`
     */
    profileBalances(identifier: string, params?: ProfileBalancesParams): Promise<CoinBalanceConnection>;
    /**
     * Every CoinBalance across all pages, fetched as the loop reaches them. `break` stops early;
     * `params.after` picks the starting point.
     */
    iterProfileBalances(identifier: string, params?: ProfileBalancesParams): AsyncGenerator<CoinBalance, void, undefined>;
    /**
     * Find a Zora profile from its handle on X, TikTok, Farcaster or Instagram. Resolves to `null`
     * if there is no such profile. `GET /profileBySocialHandle`
     */
    profileBySocialHandle(platform: Platform, handle: string): Promise<ProfileBySocialHandle | null>;
    /**
     * Coins a profile created. Filter by platform referrer to list only coins launched through a
     * given app. Returns one page; `iterProfileCoins` walks every page. `GET /profileCoins`
     */
    profileCoins(identifier: string, params?: ProfileCoinsParams): Promise<Zora20TokenConnection>;
    /**
     * Every Zora20Token across all pages, fetched as the loop reaches them. `break` stops early;
     * `params.after` picks the starting point.
     */
    iterProfileCoins(identifier: string, params?: ProfileCoinsParams): AsyncGenerator<Zora20Token, void, undefined>;
    /**
     * A profile's linked social accounts (X, TikTok, Instagram, Farcaster) and follower counts.
     * Resolves to `null` if there is no such profile. `GET /profileSocial`
     */
    profileSocial(identifier: string): Promise<Profile | null>;
    /**
     * Search coins, profiles, content and trends by text. Returns one page; `iterSearch` walks every
     * page. `GET /search`
     */
    search(text: string, params?: SearchParams): Promise<SearchResultConnection>;
    /**
     * Every SearchResult across all pages, fetched as the loop reaches them. `break` stops early;
     * `params.after` picks the starting point.
     */
    iterSearch(text: string, params?: SearchParams): AsyncGenerator<SearchResult, void, undefined>;
    /**
     * Symbol, decimals and current USD price of any ERC-20 on the chain: ZORA, USDC, WETH, or a
     * coin. Resolves to `null` if there is no such coin. `GET /tokenInfo`
     */
    tokenInfo(address: string, params?: TokenInfoParams): Promise<Erc20Token | null>;
    /**
     * Live streams with the most viewers right now. Returns one page; `iterTopLiveStreams` walks
     * every page. `GET /topLiveStreams`
     */
    topLiveStreams(params?: TopLiveStreamsParams): Promise<LiveStreamConnection>;
    /**
     * Every LiveStream across all pages, fetched as the loop reaches them. `break` stops early;
     * `params.after` picks the starting point.
     */
    iterTopLiveStreams(params?: TopLiveStreamsParams): AsyncGenerator<LiveStream, void, undefined>;
    /**
     * The weekly trader leaderboard. Defaults to the current week. Returns one page;
     * `iterTraderLeaderboard` walks every page. `GET /traderLeaderboard`
     */
    traderLeaderboard(params?: TraderLeaderboardParams): Promise<TraderLeaderboardEntryConnection>;
    /**
     * Every TraderLeaderboardEntry across all pages, fetched as the loop reaches them. `break` stops
     * early; `params.after` picks the starting point.
     */
    iterTraderLeaderboard(params?: TraderLeaderboardParams): AsyncGenerator<TraderLeaderboardEntry, void, undefined>;
    /** A trend coin by its ticker. Resolves to `null` if there is no such coin. `GET /trendCoin` */
    trendCoin(ticker: string, params?: TrendCoinParams): Promise<Zora20Token | null>;
    /**
     * Trend coins whose name matches, best match first. Returns one page; `iterTrendsByName` walks
     * every page. `GET /trendsByName`
     */
    trendsByName(name: string, params?: TrendsByNameParams): Promise<Zora20TokenConnection>;
    /**
     * Every Zora20Token across all pages, fetched as the loop reaches them. `break` stops early;
     * `params.after` picks the starting point.
     */
    iterTrendsByName(name: string, params?: TrendsByNameParams): AsyncGenerator<Zora20Token, void, undefined>;
    /**
     * Trades made by a wallet or profile, newest first. Returns one page; `iterWalletTradeActivity`
     * walks every page. `GET /walletTradeActivity`
     */
    walletTradeActivity(identifier: string, params?: WalletTradeActivityParams): Promise<TradeActivityConnection>;
    /**
     * Every TradeActivity across all pages, fetched as the loop reaches them. `break` stops early;
     * `params.after` picks the starting point.
     */
    iterWalletTradeActivity(identifier: string, params?: WalletTradeActivityParams): AsyncGenerator<TradeActivity, void, undefined>;
    /**
     * Quote a trade. The result holds the transaction that executes it. Amounts are in the input
     * token's smallest unit (wei for ETH). Set Referrer to earn the trade referral reward. Nothing
     * is signed or sent: pass the returned call to your wallet. `POST /quote`
     */
    quote(req: QuoteRequest): Promise<QuoteResponse>;
    /**
     * Build the transaction that creates a content coin. The result also holds the coin's predicted
     * address. Set PlatformReferrer to earn the platform referral share of the coin's trading fees
     * for its whole life. Nothing is signed or sent. `POST /create/content`
     */
    createContentCoin(req: CreateContentCoinRequest): Promise<CreateContentCoinResponse>;
}

/** One entry of a GraphQL response's `errors` array. */
interface GraphQLErrorEntry {
    message: string;
    path?: Array<string | number>;
}
/** The gateway answered with GraphQL errors. `data` holds whatever did resolve. */
declare class ZoraGraphQLError extends Error {
    readonly errors: GraphQLErrorEntry[];
    readonly data: unknown;
    constructor(errors: GraphQLErrorEntry[], data: unknown);
}
/**
 * Client for the zora-coins GraphQL gateway: the whole Zora Coins API as one schema, so a screen's
 * worth of data is one request selecting exactly the fields it needs. Results use the same types as
 * the REST client.
 *
 * ```ts
 * const gql = new ZoraGraphQL("http://localhost:8080/graphql");
 * const { coin } = await gql.query<{ coin: Zora20Token | null }>(
 *   `query($a: String!) { coin(address: $a) { name symbol marketCap } }`, { a: "0x…" });
 * ```
 *
 * The gateway forwards your API key to Zora and keeps nothing.
 */
declare class ZoraGraphQL extends BaseClient {
    constructor(endpoint: string, options?: Omit<ClientOptions, "baseUrl">);
    /** Run a query and return its `data`. Throws {@link ZoraGraphQLError} if the gateway reports errors. */
    query<T = Record<string, unknown>>(query: string, variables?: Record<string, unknown>, signal?: AbortSignal): Promise<T>;
}

/** WETH on Base. */
declare const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
/** USDC on Base. */
declare const USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
/** The ZORA token on Base. */
declare const ZORA_ADDRESS = "0x1111111111166b7fe7bd91427724b487980afc69";
/** Native ETH as a trade input or output. */
declare const eth: () => TokenSpecInput;
/** An ERC-20 (a Zora coin, ZORA, USDC…) as a trade input or output. */
declare const erc20: (address: string) => TokenSpecInput;
/** The items on one page of results, skipping empty edges. */
declare function nodes<T>(page: {
    edges?: Array<{
        node?: T | null;
    } | null> | null;
} | null | undefined): T[];
/** The cursor for the next page, or undefined on the last page. */
declare function nextCursor(page: {
    pageInfo?: {
        hasNextPage?: boolean | null;
        endCursor?: string | null;
    } | null;
} | null | undefined): string | undefined;
/**
 * Client for the Zora Coins API: one method per endpoint (`coin`, `coinHolders`, `explore`, …), an
 * `iter…` async generator for every paginated one, and a few conveniences.
 *
 * Rate limits and server errors are retried with backoff, honouring `Retry-After`. What's left throws
 * a {@link ZoraApiError}. Lookups that find nothing resolve to `null`.
 */
declare class ZoraCoins extends GeneratedClient {
    /** Several coins on Base by contract address, in one request. */
    coinsByAddress(...addresses: string[]): Promise<Zora20Token[]>;
    /**
     * {@link GeneratedClient.quote} with the usual defaults: the recipient is the sender, slippage 5%,
     * chain Base. `amountIn` is in the input token's smallest unit (wei for ETH). Nothing is signed or
     * sent: pass `result.call` (`target`, `data`, `value`) to your wallet.
     *
     * ```ts
     * const q = await zora.quoteTrade(eth(), erc20(coin), 10n ** 15n, wallet, { referrer: myApp });
     * await walletClient.sendTransaction({ to: q.call!.target, data: q.call!.data, value: BigInt(q.call!.value!) });
     * ```
     */
    quoteTrade(tokenIn: TokenSpecInput, tokenOut: TokenSpecInput, amountIn: bigint | string, sender: string, extra?: Partial<QuoteRequest>): Promise<QuoteResponse>;
    /** Every coin on one Explore page, e.g. `zora.explorePage(ListType.New)` — shorthand for `nodes(await zora.explore(...))`. */
    explorePage(...args: Parameters<GeneratedClient["explore"]>): Promise<Zora20Token[]>;
}

export { type Amount, type ApiKey, type ApiKeyResponse, type Avatar, BASE_CHAIN_ID, type Call, type ClientOptions, type CoinBalance, type CoinBalanceConnection, type CoinBalanceEdge, type CoinBasicInfo, type CoinBasicInfoConnection, type CoinBasicInfoEdge, type CoinCommentsParams, type CoinCommentsResponse, type CoinHoldersParams, type CoinHoldersResponse, type CoinMergedCommentsParams, type CoinMergedCommentsResponse, type CoinParams, type CoinPriceHistoryParams, type CoinPriceHistoryResponse, type CoinRefInput, type CoinResponse, type CoinSwapsParams, type CoinSwapsResponse, CoinType, type CoinsListParams, type CoinsListResponse, type CoinsResponse, type Comment, type CommentConnection, type CommentEdge, ContentCoinCurrency, type ContentCoinPoolConfigParams, type ContentCoinPoolConfigResponse, type CreateContentCoinRequest, type CreateContentCoinResponse, type CreateUploadJwtRequest, type CreateUploadJwtResponse, type CreatorCoinPoolConfigParams, type CreatorCoinPoolConfigResponse, type CreatorEarning, type CreatorLivestreamCommentsParams, type CreatorLivestreamCommentsResponse, type CreatorProfile, type Currency, type CurrencyAmountWithPrice, CurrencyType, DEFAULT_BASE_URL, type Details, type DetailsInput, EntityType, type Erc20Token, EventType, type ExploreParams, type ExploreResponse, type ExternalWallet, type FeaturedCreator, type FeaturedCreatorConnection, type FeaturedCreatorEdge, type FeaturedCreatorsParams, type FeaturedCreatorsResponse, type Followers, GeneratedClient, type GraphQLErrorEntry, type Instagram, type LatestLiveStreamsParams, type LatestLiveStreamsResponse, type LinkedWalletEdge, type LinkedWallets, ListType, type LiveStream, type LiveStreamConnection, type LiveStreamEdge, type MaxSwappable, type MediaContent, type MetadataInput, MetadataType, type OwnerProfile, type PageInfo, type Permit, type PermitInput, Platform, type PoolConfig, type PoolCurrencyToken, type PreviewImage, type PricePoint, type Profile, type ProfileBalancesParams, type ProfileBalancesResponse, type ProfileBySocialHandle, type ProfileBySocialHandleResponse, type ProfileCoinsParams, type ProfileCoinsResponse, type ProfileResponse, type ProfileSocialResponse, type PublicWallet, type Quote, type QuoteRequest, type QuoteResponse, type Replies, type Reply, type ReplyEdge, type SearchParams, type SearchResponse, type SearchResult, type SearchResultConnection, type SearchResultEdge, type SignatureInput, type SignedPermit, type SocialAccountLinkedEvent, type SocialAccountLinkedEventEdge, type SocialAccountLinkedEvents, type SocialAccounts, SortOption, StartingMarketCap, type SwapActivity, type SwapActivityConnection, type SwapActivityEdge, SwapType, type TokenBalance, type TokenBalanceConnection, type TokenBalanceEdge, type TokenInfoParams, type TokenInfoResponse, type TokenPrice, type TokenSpec, type TokenSpecInput, TokenType, type TopLiveStreamsParams, type TopLiveStreamsResponse, type Trade, type TradeActivity, type TradeActivityConnection, type TradeActivityEdge, type TraderLeaderboardEntry, type TraderLeaderboardEntryConnection, type TraderLeaderboardEntryEdge, type TraderLeaderboardParams, type TraderLeaderboardResponse, type TrendCoinParams, type TrendCoinResponse, type TrendsByNameParams, type TrendsByNameResponse, USDC_ADDRESS, type UniswapV4PoolKey, type UserProfile, VERSION, type Valuation, WETH_ADDRESS, type WalletTradeActivityParams, type WalletTradeActivityResponse, WalletType, ZORA_ADDRESS, type Zora20Token, type Zora20TokenConnection, type Zora20TokenEdge, ZoraApiError, ZoraCoins, type ZoraComment, type ZoraCommentConnection, type ZoraCommentEdge, ZoraGraphQL, ZoraGraphQLError, erc20, eth, nextCursor, nodes };
