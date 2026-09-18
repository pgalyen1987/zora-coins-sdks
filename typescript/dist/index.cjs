"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  BASE_CHAIN_ID: () => BASE_CHAIN_ID,
  CoinType: () => CoinType,
  ContentCoinCurrency: () => ContentCoinCurrency,
  CurrencyType: () => CurrencyType,
  DEFAULT_BASE_URL: () => DEFAULT_BASE_URL,
  EntityType: () => EntityType,
  EventType: () => EventType,
  ListType: () => ListType,
  MetadataType: () => MetadataType,
  Platform: () => Platform,
  SortOption: () => SortOption,
  StartingMarketCap: () => StartingMarketCap,
  SwapType: () => SwapType,
  TokenType: () => TokenType,
  USDC_ADDRESS: () => USDC_ADDRESS,
  VERSION: () => VERSION,
  WETH_ADDRESS: () => WETH_ADDRESS,
  WalletType: () => WalletType,
  ZORA_ADDRESS: () => ZORA_ADDRESS,
  ZoraApiError: () => ZoraApiError,
  ZoraCoins: () => ZoraCoins,
  ZoraGraphQL: () => ZoraGraphQL,
  ZoraGraphQLError: () => ZoraGraphQLError,
  erc20: () => erc20,
  eth: () => eth,
  nextCursor: () => nextCursor,
  nodes: () => nodes
});
module.exports = __toCommonJS(src_exports);

// src/base.ts
var DEFAULT_BASE_URL = "https://api-sdk.zora.engineering";
var BASE_CHAIN_ID = 8453;
var VERSION = "0.1.0";
var ZoraApiError = class extends Error {
  /** HTTP status. */
  status;
  /** The endpoint, e.g. `/coin`. */
  path;
  /** The API's machine-readable reason, where it gives one: `/quote` answers 422 with `LIQUIDITY`. */
  errorType;
  /** The response body (parsed JSON, or text). */
  body;
  constructor(status, message, path, body) {
    super(`zora ${path}: ${status} ${message}`);
    this.name = "ZoraApiError";
    this.status = status;
    this.path = path;
    this.body = body;
    const t = body?.errorType;
    this.errorType = typeof t === "string" ? t : void 0;
  }
  /** Whether Zora refused the request for exceeding its rate limit. An API key raises it. */
  get isRateLimited() {
    return this.status === 429;
  }
  /** Whether a quote failed because the pool can't fill a trade that size. Try a smaller amount. */
  get isInsufficientLiquidity() {
    return this.errorType === "LIQUIDITY";
  }
};
var RETRY = /* @__PURE__ */ new Set([429, 500, 502, 503, 504]);
function envKey() {
  const p = globalThis.process;
  return p?.env?.ZORA_API_KEY || void 0;
}
function backoffMs(attempt, retryAfter) {
  const s = retryAfter === null ? NaN : Number(retryAfter);
  if (!Number.isNaN(s) && s >= 0) return Math.min(s, 30) * 1e3;
  return Math.min(2 ** attempt, 16) * 500 + Math.random() * 250;
}
var sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => {
    clearTimeout(t);
    reject(signal.reason);
  }, { once: true });
});
var BaseClient = class {
  baseUrl;
  key;
  maxRetries;
  timeoutMs;
  fetchImpl;
  userAgent;
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.key = options.apiKey ?? envKey();
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 3e4;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.userAgent = `${options.userAgent ? options.userAgent + " " : ""}zora-coins-ts/${VERSION}`;
  }
  /**
   * Send one request and parse the JSON response. The generated methods are built on this; call it
   * directly only for an endpoint the SDK doesn't wrap yet.
   */
  async request(method, path, query = [], body, signal) {
    const qs = query.length ? "?" + new URLSearchParams(query).toString() : "";
    const url = this.baseUrl + path + qs;
    const headers = { accept: "application/json", "user-agent": this.userAgent };
    if (this.key) headers["api-key"] = this.key;
    if (body !== void 0) headers["content-type"] = "application/json";
    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let resp;
      try {
        resp = await this.fetchImpl(url, { method, headers, body: body === void 0 ? void 0 : JSON.stringify(body), signal: sig });
      } catch (err) {
        if (signal?.aborted || attempt >= this.maxRetries) throw err;
        await sleep(backoffMs(attempt, null), signal);
        continue;
      }
      if (RETRY.has(resp.status) && attempt < this.maxRetries) {
        await resp.body?.cancel();
        await sleep(backoffMs(attempt, resp.headers.get("retry-after")), signal);
        continue;
      }
      const text = await resp.text();
      let parsed = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
      }
      if (resp.status >= 400) {
        const p = parsed;
        const msg = typeof p?.message === "string" ? p.message : typeof p?.error === "string" ? p.error : text.slice(0, 300) || resp.statusText;
        throw new ZoraApiError(resp.status, msg, path, parsed);
      }
      return parsed;
    }
  }
};
async function* paginate(params, fetchPage) {
  const seen = /* @__PURE__ */ new Set();
  let p = { ...params };
  for (; ; ) {
    const [items, next] = await fetchPage(p);
    yield* items;
    if (!next || seen.has(next)) return;
    seen.add(next);
    p = { ...p, after: next };
  }
}

// src/client.ts
var GeneratedClient = class extends BaseClient {
  /** Look up an API key: whether it exists and is active. `GET /apiKey` */
  async apiKey(apiKey) {
    const q = [];
    q.push(["apiKey", String(apiKey)]);
    const resp = await this.request("GET", "/apiKey", q);
    return resp.apiKey ?? null;
  }
  /**
   * One coin by contract address: market data, creator profile, media, pool key and creator
   * earnings. Resolves to `null` if there is no such coin. `GET /coin`
   */
  async coin(address, params = {}) {
    const q = [];
    q.push(["address", String(address)]);
    q.push(["chain", String(params.chainId ?? BASE_CHAIN_ID)]);
    const resp = await this.request("GET", "/coin", q);
    return resp.zora20Token ?? null;
  }
  /**
   * Comments posted on a coin, newest first. Returns one page; `iterCoinComments` walks every
   * page. `GET /coinComments`
   */
  async coinComments(address, params = {}) {
    const q = [];
    q.push(["address", String(address)]);
    q.push(["chain", String(params.chainId ?? BASE_CHAIN_ID)]);
    if (params.after !== void 0) q.push(["after", String(params.after)]);
    if (params.pageSize !== void 0) q.push(["count", String(params.pageSize)]);
    const resp = await this.request("GET", "/coinComments", q);
    return resp?.zora20Token?.zoraComments ?? {};
  }
  /**
   * Every ZoraComment across all pages, fetched as the loop reaches them. `break` stops early;
   * `params.after` picks the starting point.
   */
  iterCoinComments(address, params = {}) {
    return paginate(params, async (p) => {
      const page = await this.coinComments(address, p);
      const nodes2 = (page.edges ?? []).flatMap((e) => e?.node ? [e.node] : []);
      return [nodes2, page.pageInfo?.hasNextPage ? page.pageInfo.endCursor ?? void 0 : void 0];
    });
  }
  /**
   * Holders of a coin and their balances, largest first. Returns one page; `iterCoinHolders` walks
   * every page. `GET /coinHolders`
   */
  async coinHolders(address, params = {}) {
    const q = [];
    q.push(["chainId", String(params.chainId ?? BASE_CHAIN_ID)]);
    q.push(["address", String(address)]);
    if (params.after !== void 0) q.push(["after", String(params.after)]);
    if (params.pageSize !== void 0) q.push(["count", String(params.pageSize)]);
    const resp = await this.request("GET", "/coinHolders", q);
    return resp?.zora20Token?.tokenBalances ?? {};
  }
  /**
   * Every TokenBalance across all pages, fetched as the loop reaches them. `break` stops early;
   * `params.after` picks the starting point.
   */
  iterCoinHolders(address, params = {}) {
    return paginate(params, async (p) => {
      const page = await this.coinHolders(address, p);
      const nodes2 = (page.edges ?? []).flatMap((e) => e?.node ? [e.node] : []);
      return [nodes2, page.pageInfo?.hasNextPage ? page.pageInfo.endCursor ?? void 0 : void 0];
    });
  }
  /**
   * A coin's comment feed with replies threaded in, newest first. Returns one page;
   * `iterCoinMergedComments` walks every page. `GET /coinMergedComments`
   */
  async coinMergedComments(address, params = {}) {
    const q = [];
    q.push(["address", String(address)]);
    q.push(["chain", String(params.chainId ?? BASE_CHAIN_ID)]);
    if (params.after !== void 0) q.push(["after", String(params.after)]);
    if (params.pageSize !== void 0) q.push(["count", String(params.pageSize)]);
    const resp = await this.request("GET", "/coinMergedComments", q);
    return resp?.zora20Token?.comments ?? {};
  }
  /**
   * Every Comment across all pages, fetched as the loop reaches them. `break` stops early;
   * `params.after` picks the starting point.
   */
  iterCoinMergedComments(address, params = {}) {
    return paginate(params, async (p) => {
      const page = await this.coinMergedComments(address, p);
      const nodes2 = (page.edges ?? []).flatMap((e) => e?.node ? [e.node] : []);
      return [nodes2, page.pageInfo?.hasNextPage ? page.pageInfo.endCursor ?? void 0 : void 0];
    });
  }
  /**
   * A coin's price history at five resolutions: the last hour, day, week, month, and all time.
   * Resolves to `null` if there is no such coin. `GET /coinPriceHistory`
   */
  async coinPriceHistory(address, params = {}) {
    const q = [];
    q.push(["address", String(address)]);
    q.push(["chain", String(params.chainId ?? BASE_CHAIN_ID)]);
    const resp = await this.request("GET", "/coinPriceHistory", q);
    return resp.zora20Token ?? null;
  }
  /**
   * Buys and sells of a coin, newest first. Returns one page; `iterCoinSwaps` walks every page.
   * `GET /coinSwaps`
   */
  async coinSwaps(address, params = {}) {
    const q = [];
    q.push(["address", String(address)]);
    q.push(["chain", String(params.chainId ?? BASE_CHAIN_ID)]);
    if (params.after !== void 0) q.push(["after", String(params.after)]);
    if (params.pageSize !== void 0) q.push(["first", String(params.pageSize)]);
    const resp = await this.request("GET", "/coinSwaps", q);
    return resp?.zora20Token?.swapActivities ?? {};
  }
  /**
   * Every SwapActivity across all pages, fetched as the loop reaches them. `break` stops early;
   * `params.after` picks the starting point.
   */
  iterCoinSwaps(address, params = {}) {
    return paginate(params, async (p) => {
      const page = await this.coinSwaps(address, p);
      const nodes2 = (page.edges ?? []).flatMap((e) => e?.node ? [e.node] : []);
      return [nodes2, page.pageInfo?.hasNextPage ? page.pageInfo.endCursor ?? void 0 : void 0];
    });
  }
  /** Several coins in one request. Missing coins are left out of the result. `GET /coins` */
  async coins(coins) {
    const q = [];
    for (const item of coins) q.push(["coins", JSON.stringify(item)]);
    const resp = await this.request("GET", "/coins", q);
    return resp.zora20Tokens ?? [];
  }
  /**
   * Basic information (address, name, symbol, price) for every coin, in pages of up to 1,000.
   * Returns one page; `iterCoinsList` walks every page. `GET /coinsList`
   */
  async coinsList(params = {}) {
    const q = [];
    if (params.pageSize !== void 0) q.push(["first", String(params.pageSize)]);
    if (params.after !== void 0) q.push(["after", String(params.after)]);
    if (params.includeUSDCPrice !== void 0) q.push(["includeUSDCPrice", String(params.includeUSDCPrice)]);
    const resp = await this.request("GET", "/coinsList", q);
    return resp?.coinsBasicInfo ?? {};
  }
  /**
   * Every CoinBasicInfo across all pages, fetched as the loop reaches them. `break` stops early;
   * `params.after` picks the starting point.
   */
  iterCoinsList(params = {}) {
    return paginate(params, async (p) => {
      const page = await this.coinsList(p);
      const nodes2 = (page.edges ?? []).flatMap((e) => e?.node ? [e.node] : []);
      return [nodes2, page.pageInfo?.hasNextPage ? page.pageInfo.endCursor ?? void 0 : void 0];
    });
  }
  /**
   * The Uniswap V4 pool configuration Zora uses to launch a content coin paired with the given
   * currency. `GET /contentCoinPoolConfig`
   */
  async contentCoinPoolConfig(currencyType, params = {}) {
    const q = [];
    if (params.creatorIdentifier !== void 0) q.push(["creatorIdentifier", String(params.creatorIdentifier)]);
    q.push(["currencyType", String(currencyType)]);
    const resp = await this.request("GET", "/contentCoinPoolConfig", q);
    return resp.contentCoinPoolConfig ?? null;
  }
  /**
   * Create a short-lived token for uploading coin media and metadata to Zora's uploader. Requires
   * an API key. `POST /createUploadJWT`
   */
  async createUploadJwt(req) {
    const q = [];
    const resp = await this.request("POST", "/createUploadJWT", q, req);
    return resp.createUploadJwtFromApiKey ?? null;
  }
  /**
   * The Uniswap V4 pool configuration Zora uses to launch a creator coin, optionally sized for a
   * starting market cap in USD. `GET /creatorCoinPoolConfig`
   */
  async creatorCoinPoolConfig(params = {}) {
    const q = [];
    if (params.targetMarketCapUsd !== void 0) q.push(["targetMarketCapUsd", String(params.targetMarketCapUsd)]);
    const resp = await this.request("GET", "/creatorCoinPoolConfig", q);
    return resp.creatorCoinPoolConfig ?? null;
  }
  /**
   * Comments on the live stream of the creator behind a coin. Returns one page;
   * `iterCreatorLivestreamComments` walks every page. `GET /creatorLivestreamComments`
   */
  async creatorLivestreamComments(address, params = {}) {
    const q = [];
    q.push(["address", String(address)]);
    q.push(["chain", String(params.chainId ?? BASE_CHAIN_ID)]);
    if (params.after !== void 0) q.push(["after", String(params.after)]);
    if (params.pageSize !== void 0) q.push(["count", String(params.pageSize)]);
    const resp = await this.request("GET", "/creatorLivestreamComments", q);
    return resp?.zora20Token?.creatorProfile?.liveStream?.comments ?? {};
  }
  /**
   * Every Comment across all pages, fetched as the loop reaches them. `break` stops early;
   * `params.after` picks the starting point.
   */
  iterCreatorLivestreamComments(address, params = {}) {
    return paginate(params, async (p) => {
      const page = await this.creatorLivestreamComments(address, p);
      const nodes2 = (page.edges ?? []).flatMap((e) => e?.node ? [e.node] : []);
      return [nodes2, page.pageInfo?.hasNextPage ? page.pageInfo.endCursor ?? void 0 : void 0];
    });
  }
  /**
   * A Zora Explore list: top gainers, 24h volume, newest, most valuable creators and more. See
   * ListType for all 25. Returns one page; `iterExplore` walks every page. `GET /explore`
   */
  async explore(listType, params = {}) {
    const q = [];
    q.push(["listType", String(listType)]);
    if (params.pageSize !== void 0) q.push(["count", String(params.pageSize)]);
    if (params.after !== void 0) q.push(["after", String(params.after)]);
    const resp = await this.request("GET", "/explore", q);
    return resp?.exploreList ?? {};
  }
  /**
   * Every Zora20Token across all pages, fetched as the loop reaches them. `break` stops early;
   * `params.after` picks the starting point.
   */
  iterExplore(listType, params = {}) {
    return paginate(params, async (p) => {
      const page = await this.explore(listType, p);
      const nodes2 = (page.edges ?? []).flatMap((e) => e?.node ? [e.node] : []);
      return [nodes2, page.pageInfo?.hasNextPage ? page.pageInfo.endCursor ?? void 0 : void 0];
    });
  }
  /**
   * Creators featured on the weekly leaderboard. Defaults to the current week. Returns one page;
   * `iterFeaturedCreators` walks every page. `GET /featuredCreators`
   */
  async featuredCreators(params = {}) {
    const q = [];
    if (params.year !== void 0) q.push(["year", String(params.year)]);
    if (params.week !== void 0) q.push(["week", String(params.week)]);
    if (params.pageSize !== void 0) q.push(["first", String(params.pageSize)]);
    if (params.after !== void 0) q.push(["after", String(params.after)]);
    const resp = await this.request("GET", "/featuredCreators", q);
    return resp?.traderLeaderboardFeaturedCreators ?? {};
  }
  /**
   * Every FeaturedCreator across all pages, fetched as the loop reaches them. `break` stops early;
   * `params.after` picks the starting point.
   */
  iterFeaturedCreators(params = {}) {
    return paginate(params, async (p) => {
      const page = await this.featuredCreators(p);
      const nodes2 = (page.edges ?? []).flatMap((e) => e?.node ? [e.node] : []);
      return [nodes2, page.pageInfo?.hasNextPage ? page.pageInfo.endCursor ?? void 0 : void 0];
    });
  }
  /**
   * Live streams, most recently started first. Returns one page; `iterLatestLiveStreams` walks
   * every page. `GET /latestLiveStreams`
   */
  async latestLiveStreams(params = {}) {
    const q = [];
    if (params.pageSize !== void 0) q.push(["first", String(params.pageSize)]);
    if (params.after !== void 0) q.push(["after", String(params.after)]);
    const resp = await this.request("GET", "/latestLiveStreams", q);
    return resp?.latestLiveStreams ?? {};
  }
  /**
   * Every LiveStream across all pages, fetched as the loop reaches them. `break` stops early;
   * `params.after` picks the starting point.
   */
  iterLatestLiveStreams(params = {}) {
    return paginate(params, async (p) => {
      const page = await this.latestLiveStreams(p);
      const nodes2 = (page.edges ?? []).flatMap((e) => e?.node ? [e.node] : []);
      return [nodes2, page.pageInfo?.hasNextPage ? page.pageInfo.endCursor ?? void 0 : void 0];
    });
  }
  /**
   * A profile by handle or wallet address, with its linked wallets and creator coin. Resolves to
   * `null` if there is no such profile. `GET /profile`
   */
  async profile(identifier) {
    const q = [];
    q.push(["identifier", String(identifier)]);
    const resp = await this.request("GET", "/profile", q);
    return resp.profile ?? null;
  }
  /**
   * Coins a profile holds, with balances and current values. Returns one page;
   * `iterProfileBalances` walks every page. `GET /profileBalances`
   */
  async profileBalances(identifier, params = {}) {
    const q = [];
    q.push(["identifier", String(identifier)]);
    if (params.pageSize !== void 0) q.push(["count", String(params.pageSize)]);
    if (params.after !== void 0) q.push(["after", String(params.after)]);
    if (params.sortOption !== void 0) q.push(["sortOption", String(params.sortOption)]);
    if (params.excludeHidden !== void 0) q.push(["excludeHidden", String(params.excludeHidden)]);
    for (const v of params.chainIds ?? []) q.push(["chainIds", String(v)]);
    const resp = await this.request("GET", "/profileBalances", q);
    return resp?.profile?.coinBalances ?? {};
  }
  /**
   * Every CoinBalance across all pages, fetched as the loop reaches them. `break` stops early;
   * `params.after` picks the starting point.
   */
  iterProfileBalances(identifier, params = {}) {
    return paginate(params, async (p) => {
      const page = await this.profileBalances(identifier, p);
      const nodes2 = (page.edges ?? []).flatMap((e) => e?.node ? [e.node] : []);
      return [nodes2, page.pageInfo?.hasNextPage ? page.pageInfo.endCursor ?? void 0 : void 0];
    });
  }
  /**
   * Find a Zora profile from its handle on X, TikTok, Farcaster or Instagram. Resolves to `null`
   * if there is no such profile. `GET /profileBySocialHandle`
   */
  async profileBySocialHandle(platform, handle) {
    const q = [];
    q.push(["platform", String(platform)]);
    q.push(["handle", String(handle)]);
    const resp = await this.request("GET", "/profileBySocialHandle", q);
    return resp.profileBySocialHandle ?? null;
  }
  /**
   * Coins a profile created. Filter by platform referrer to list only coins launched through a
   * given app. Returns one page; `iterProfileCoins` walks every page. `GET /profileCoins`
   */
  async profileCoins(identifier, params = {}) {
    const q = [];
    q.push(["identifier", String(identifier)]);
    if (params.pageSize !== void 0) q.push(["count", String(params.pageSize)]);
    if (params.after !== void 0) q.push(["after", String(params.after)]);
    for (const v of params.chainIds ?? []) q.push(["chainIds", String(v)]);
    for (const v of params.platformReferrerAddress ?? []) q.push(["platformReferrerAddress", String(v)]);
    const resp = await this.request("GET", "/profileCoins", q);
    return resp?.profile?.createdCoins ?? {};
  }
  /**
   * Every Zora20Token across all pages, fetched as the loop reaches them. `break` stops early;
   * `params.after` picks the starting point.
   */
  iterProfileCoins(identifier, params = {}) {
    return paginate(params, async (p) => {
      const page = await this.profileCoins(identifier, p);
      const nodes2 = (page.edges ?? []).flatMap((e) => e?.node ? [e.node] : []);
      return [nodes2, page.pageInfo?.hasNextPage ? page.pageInfo.endCursor ?? void 0 : void 0];
    });
  }
  /**
   * A profile's linked social accounts (X, TikTok, Instagram, Farcaster) and follower counts.
   * Resolves to `null` if there is no such profile. `GET /profileSocial`
   */
  async profileSocial(identifier) {
    const q = [];
    q.push(["identifier", String(identifier)]);
    const resp = await this.request("GET", "/profileSocial", q);
    return resp.profile ?? null;
  }
  /**
   * Search coins, profiles, content and trends by text. Returns one page; `iterSearch` walks every
   * page. `GET /search`
   */
  async search(text, params = {}) {
    const q = [];
    q.push(["text", String(text)]);
    if (params.entityType !== void 0) q.push(["entityType", String(params.entityType)]);
    if (params.pageSize !== void 0) q.push(["first", String(params.pageSize)]);
    if (params.after !== void 0) q.push(["after", String(params.after)]);
    const resp = await this.request("GET", "/search", q);
    return resp?.globalSearch ?? {};
  }
  /**
   * Every SearchResult across all pages, fetched as the loop reaches them. `break` stops early;
   * `params.after` picks the starting point.
   */
  iterSearch(text, params = {}) {
    return paginate(params, async (p) => {
      const page = await this.search(text, p);
      const nodes2 = (page.edges ?? []).flatMap((e) => e?.node ? [e.node] : []);
      return [nodes2, page.pageInfo?.hasNextPage ? page.pageInfo.endCursor ?? void 0 : void 0];
    });
  }
  /**
   * Symbol, decimals and current USD price of any ERC-20 on the chain: ZORA, USDC, WETH, or a
   * coin. Resolves to `null` if there is no such coin. `GET /tokenInfo`
   */
  async tokenInfo(address, params = {}) {
    const q = [];
    q.push(["address", String(address)]);
    q.push(["chainId", String(params.chainId ?? BASE_CHAIN_ID)]);
    const resp = await this.request("GET", "/tokenInfo", q);
    return resp.erc20Token ?? null;
  }
  /**
   * Live streams with the most viewers right now. Returns one page; `iterTopLiveStreams` walks
   * every page. `GET /topLiveStreams`
   */
  async topLiveStreams(params = {}) {
    const q = [];
    if (params.pageSize !== void 0) q.push(["first", String(params.pageSize)]);
    if (params.after !== void 0) q.push(["after", String(params.after)]);
    const resp = await this.request("GET", "/topLiveStreams", q);
    return resp?.topLiveStreams ?? {};
  }
  /**
   * Every LiveStream across all pages, fetched as the loop reaches them. `break` stops early;
   * `params.after` picks the starting point.
   */
  iterTopLiveStreams(params = {}) {
    return paginate(params, async (p) => {
      const page = await this.topLiveStreams(p);
      const nodes2 = (page.edges ?? []).flatMap((e) => e?.node ? [e.node] : []);
      return [nodes2, page.pageInfo?.hasNextPage ? page.pageInfo.endCursor ?? void 0 : void 0];
    });
  }
  /**
   * The weekly trader leaderboard. Defaults to the current week. Returns one page;
   * `iterTraderLeaderboard` walks every page. `GET /traderLeaderboard`
   */
  async traderLeaderboard(params = {}) {
    const q = [];
    if (params.week !== void 0) q.push(["week", String(params.week)]);
    if (params.year !== void 0) q.push(["year", String(params.year)]);
    if (params.pageSize !== void 0) q.push(["first", String(params.pageSize)]);
    if (params.after !== void 0) q.push(["after", String(params.after)]);
    const resp = await this.request("GET", "/traderLeaderboard", q);
    return resp?.exploreTraderLeaderboard ?? {};
  }
  /**
   * Every TraderLeaderboardEntry across all pages, fetched as the loop reaches them. `break` stops
   * early; `params.after` picks the starting point.
   */
  iterTraderLeaderboard(params = {}) {
    return paginate(params, async (p) => {
      const page = await this.traderLeaderboard(p);
      const nodes2 = (page.edges ?? []).flatMap((e) => e?.node ? [e.node] : []);
      return [nodes2, page.pageInfo?.hasNextPage ? page.pageInfo.endCursor ?? void 0 : void 0];
    });
  }
  /** A trend coin by its ticker. Resolves to `null` if there is no such coin. `GET /trendCoin` */
  async trendCoin(ticker, params = {}) {
    const q = [];
    q.push(["ticker", String(ticker)]);
    q.push(["chainId", String(params.chainId ?? BASE_CHAIN_ID)]);
    const resp = await this.request("GET", "/trendCoin", q);
    return resp.trendCoin ?? null;
  }
  /**
   * Trend coins whose name matches, best match first. Returns one page; `iterTrendsByName` walks
   * every page. `GET /trendsByName`
   */
  async trendsByName(name, params = {}) {
    const q = [];
    q.push(["name", String(name)]);
    if (params.pageSize !== void 0) q.push(["first", String(params.pageSize)]);
    if (params.after !== void 0) q.push(["after", String(params.after)]);
    const resp = await this.request("GET", "/trendsByName", q);
    return resp?.trendsByName ?? {};
  }
  /**
   * Every Zora20Token across all pages, fetched as the loop reaches them. `break` stops early;
   * `params.after` picks the starting point.
   */
  iterTrendsByName(name, params = {}) {
    return paginate(params, async (p) => {
      const page = await this.trendsByName(name, p);
      const nodes2 = (page.edges ?? []).flatMap((e) => e?.node ? [e.node] : []);
      return [nodes2, page.pageInfo?.hasNextPage ? page.pageInfo.endCursor ?? void 0 : void 0];
    });
  }
  /**
   * Trades made by a wallet or profile, newest first. Returns one page; `iterWalletTradeActivity`
   * walks every page. `GET /walletTradeActivity`
   */
  async walletTradeActivity(identifier, params = {}) {
    const q = [];
    q.push(["identifier", String(identifier)]);
    if (params.after !== void 0) q.push(["after", String(params.after)]);
    if (params.pageSize !== void 0) q.push(["first", String(params.pageSize)]);
    const resp = await this.request("GET", "/walletTradeActivity", q);
    return resp?.walletAddressTradeActivity ?? {};
  }
  /**
   * Every TradeActivity across all pages, fetched as the loop reaches them. `break` stops early;
   * `params.after` picks the starting point.
   */
  iterWalletTradeActivity(identifier, params = {}) {
    return paginate(params, async (p) => {
      const page = await this.walletTradeActivity(identifier, p);
      const nodes2 = (page.edges ?? []).flatMap((e) => e?.node ? [e.node] : []);
      return [nodes2, page.pageInfo?.hasNextPage ? page.pageInfo.endCursor ?? void 0 : void 0];
    });
  }
  /**
   * Quote a trade. The result holds the transaction that executes it. Amounts are in the input
   * token's smallest unit (wei for ETH). Set Referrer to earn the trade referral reward. Nothing
   * is signed or sent: pass the returned call to your wallet. `POST /quote`
   */
  async quote(req) {
    const q = [];
    const resp = await this.request("POST", "/quote", q, req);
    return resp;
  }
  /**
   * Build the transaction that creates a content coin. The result also holds the coin's predicted
   * address. Set PlatformReferrer to earn the platform referral share of the coin's trading fees
   * for its whole life. Nothing is signed or sent. `POST /create/content`
   */
  async createContentCoin(req) {
    const q = [];
    const resp = await this.request("POST", "/create/content", q, req);
    return resp;
  }
};

// src/models.ts
var CoinType = {
  Creator: "CREATOR",
  Content: "CONTENT",
  Trend: "TREND"
};
var ContentCoinCurrency = {
  CreatorCoin: "CREATOR_COIN",
  Zora: "ZORA",
  Eth: "ETH",
  CreatorCoinOrZora: "CREATOR_COIN_OR_ZORA"
};
var CurrencyType = {
  Eth: "ETH",
  Zora: "ZORA",
  CreatorCoin: "CREATOR_COIN",
  CreatorCoinOrZora: "CREATOR_COIN_OR_ZORA",
  CustomCoin: "CUSTOM_COIN"
};
var EntityType = {
  UserProfile: "USER_PROFILE",
  Content: "CONTENT",
  Trend: "TREND",
  Coin: "COIN"
};
var EventType = {
  Link: "LINK",
  Unlink: "UNLINK"
};
var ListType = {
  TopGainers: "TOP_GAINERS",
  TopVolume24h: "TOP_VOLUME_24H",
  MostValuable: "MOST_VALUABLE",
  MostValuableTrends: "MOST_VALUABLE_TRENDS",
  New: "NEW",
  NewTrends: "NEW_TRENDS",
  Old: "OLD",
  LastTraded: "LAST_TRADED",
  LastTradedUnique: "LAST_TRADED_UNIQUE",
  Featured: "FEATURED",
  FeaturedVideos: "FEATURED_VIDEOS",
  NewCreators: "NEW_CREATORS",
  MostValuableCreators: "MOST_VALUABLE_CREATORS",
  FeaturedCreators: "FEATURED_CREATORS",
  TopVolumeCreators24h: "TOP_VOLUME_CREATORS_24H",
  TopVolumeAll24h: "TOP_VOLUME_ALL_24H",
  NewAll: "NEW_ALL",
  TrendingPosts: "TRENDING_POSTS",
  TrendingTrends: "TRENDING_TRENDS",
  TrendingCreators: "TRENDING_CREATORS",
  TrendingAll: "TRENDING_ALL",
  TopVolumeTrends24h: "TOP_VOLUME_TRENDS_24H",
  MostValuableAll: "MOST_VALUABLE_ALL",
  TrendingAgents: "TRENDING_AGENTS",
  MostValuableAgents: "MOST_VALUABLE_AGENTS"
};
var MetadataType = {
  RawUri: "RAW_URI"
};
var Platform = {
  Twitter: "TWITTER",
  Tiktok: "TIKTOK",
  Farcaster: "FARCASTER",
  Instagram: "INSTAGRAM"
};
var SortOption = {
  Balance: "BALANCE",
  MarketCap: "MARKET_CAP",
  UsdValue: "USD_VALUE",
  PriceChange: "PRICE_CHANGE",
  MarketValueUsd: "MARKET_VALUE_USD"
};
var StartingMarketCap = {
  Low: "LOW",
  High: "HIGH"
};
var SwapType = {
  Buy: "BUY",
  Sell: "SELL"
};
var TokenType = {
  Eth: "eth",
  Erc20: "erc20"
};
var WalletType = {
  Privy: "PRIVY",
  External: "EXTERNAL",
  SmartWallet: "SMART_WALLET"
};

// src/graphql.ts
var ZoraGraphQLError = class extends Error {
  errors;
  data;
  constructor(errors, data) {
    super("zora graphql: " + errors.map((e) => e.message).join("; "));
    this.name = "ZoraGraphQLError";
    this.errors = errors;
    this.data = data;
  }
};
var ZoraGraphQL = class extends BaseClient {
  constructor(endpoint, options = {}) {
    super({ ...options, baseUrl: endpoint });
  }
  /** Run a query and return its `data`. Throws {@link ZoraGraphQLError} if the gateway reports errors. */
  async query(query, variables = {}, signal) {
    const res = await this.request("POST", "", [], { query, variables }, signal);
    if (res?.errors?.length) throw new ZoraGraphQLError(res.errors, res.data);
    return res?.data ?? {};
  }
};

// src/index.ts
var WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
var USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
var ZORA_ADDRESS = "0x1111111111166b7fe7bd91427724b487980afc69";
var eth = () => ({ type: "eth" });
var erc20 = (address) => ({ type: "erc20", address });
function nodes(page) {
  return (page?.edges ?? []).flatMap((e) => e?.node ? [e.node] : []);
}
function nextCursor(page) {
  return page?.pageInfo?.hasNextPage ? page.pageInfo.endCursor ?? void 0 : void 0;
}
var ZoraCoins = class extends GeneratedClient {
  /** Several coins on Base by contract address, in one request. */
  coinsByAddress(...addresses) {
    return this.coins(addresses.map((a) => ({ chainId: BASE_CHAIN_ID, collectionAddress: a.toLowerCase() })));
  }
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
  quoteTrade(tokenIn, tokenOut, amountIn, sender, extra = {}) {
    return this.quote({
      slippage: 0.05,
      chainId: BASE_CHAIN_ID,
      recipient: sender,
      ...extra,
      tokenIn,
      tokenOut,
      amountIn: String(amountIn),
      sender
    });
  }
  /** Every coin on one Explore page, e.g. `zora.explorePage(ListType.New)` — shorthand for `nodes(await zora.explore(...))`. */
  async explorePage(...args) {
    return nodes(await this.explore(...args));
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BASE_CHAIN_ID,
  CoinType,
  ContentCoinCurrency,
  CurrencyType,
  DEFAULT_BASE_URL,
  EntityType,
  EventType,
  ListType,
  MetadataType,
  Platform,
  SortOption,
  StartingMarketCap,
  SwapType,
  TokenType,
  USDC_ADDRESS,
  VERSION,
  WETH_ADDRESS,
  WalletType,
  ZORA_ADDRESS,
  ZoraApiError,
  ZoraCoins,
  ZoraGraphQL,
  ZoraGraphQLError,
  erc20,
  eth,
  nextCursor,
  nodes
});
//# sourceMappingURL=index.cjs.map