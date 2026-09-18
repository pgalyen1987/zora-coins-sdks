#!/usr/bin/env node
"use strict";

// src/cli.ts
var import_node_fs = require("fs");
var import_node_util = require("util");

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

// src/index.ts
var WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
var USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
function nodes(page) {
  return (page?.edges ?? []).flatMap((e) => e?.node ? [e.node] : []);
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

// src/rewards/index.ts
var TOPIC_MARKET_REWARDS_V4 = "0x35b5031218696db1dfd903223a47f38e66a1998e14a942a5d60fddaa49a685fc";
var TOPIC_TRADE_REWARDS_V3 = "0x6b67f906562afcdc3afeeeb6754e906cc24d9ce090e9db1b7b68e6462682d966";
var ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
var BASE_GENESIS_TIMESTAMP = 1686789347;
var DEFAULT_RPC = "https://mainnet.base.org";
var V4_FIRST_BLOCK = 31e6;
var V3_FIRST_BLOCK = 27e6;
var ROLES = ["creator", "platform_referrer", "trade_referrer", "protocol", "doppler"];
var ROLE_LABELS = {
  creator: "Creator payouts",
  platform_referrer: "Platform referral",
  trade_referrer: "Trade referral",
  protocol: "Protocol",
  doppler: "Doppler"
};
var eventTime = (e) => BASE_GENESIS_TIMESTAMP + 2 * e.block;
var blockAt = (unixSeconds) => Math.max(0, Math.floor((unixSeconds - BASE_GENESIS_TIMESTAMP) / 2));
var addressTopic = (a) => "0x" + "0".repeat(24) + a.toLowerCase().replace(/^0x/, "");
var word = (data, i) => data.slice(2 + i * 64, 2 + (i + 1) * 64);
var addr = (w) => w.length >= 40 ? "0x" + w.slice(-40).toLowerCase() : ZERO_ADDRESS;
var uint = (w) => w ? BigInt("0x" + w) : 0n;
function decodeLog(l) {
  const t0 = l.topics[0]?.toLowerCase();
  const n = Math.floor((l.data.length - 2) / 64);
  const base = { block: Number(BigInt(l.blockNumber)), txHash: l.transactionHash.toLowerCase(), logIndex: Number(BigInt(l.logIndex)), emitter: l.address.toLowerCase() };
  if (t0 === TOPIC_MARKET_REWARDS_V4 && n >= 17) {
    const w = (i) => word(l.data, i);
    const p = (r, c) => ({ recipient: addr(w(r)), currency: uint(w(c)), coin: uint(w(c + 1)) });
    return {
      ...base,
      version: 4,
      coin: addr(w(0)),
      currency: addr(w(1)),
      payouts: { creator: p(2, 7), platform_referrer: p(3, 9), trade_referrer: p(4, 11), protocol: p(5, 13), doppler: p(6, 15) }
    };
  }
  if (t0 === TOPIC_TRADE_REWARDS_V3 && l.topics.length >= 4 && n >= 6) {
    const w = (i) => word(l.data, i);
    const topic = (i) => addr((l.topics[i] ?? "").replace(/^0x/, ""));
    return {
      ...base,
      version: 3,
      coin: base.emitter,
      currency: addr(w(5)),
      payouts: {
        creator: { recipient: topic(1), currency: uint(w(1)), coin: 0n },
        platform_referrer: { recipient: topic(2), currency: uint(w(2)), coin: 0n },
        trade_referrer: { recipient: topic(3), currency: uint(w(3)), coin: 0n },
        protocol: { recipient: addr(w(0)), currency: uint(w(4)), coin: 0n },
        doppler: { recipient: ZERO_ADDRESS, currency: 0n, coin: 0n }
      }
    };
  }
  return null;
}
var pays = (e, watch) => ROLES.some((r) => e.payouts[r].recipient !== ZERO_ADDRESS && watch.has(e.payouts[r].recipient));
var keyOf = (e) => `${e.txHash}:${e.logIndex}`;
function mergeRanges(ranges) {
  const out = [];
  for (const [lo, hi] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}
function missingRanges(lo, hi, have) {
  const gaps = [];
  let cur = lo;
  for (const [a, b] of mergeRanges(have)) {
    if (b < cur || a > hi) continue;
    if (a > cur) gaps.push([cur, a - 1]);
    cur = Math.max(cur, b + 1);
  }
  if (cur <= hi) gaps.push([cur, hi]);
  return gaps;
}
var MemoryStore = class _MemoryStore {
  events = /* @__PURE__ */ new Map();
  scans = /* @__PURE__ */ new Map();
  save(events, addresses, version, from, to) {
    for (const e of events) this.events.set(keyOf(e), e);
    for (const a of addresses) {
      const k = `${a.toLowerCase()}@v${version}`;
      this.scans.set(k, mergeRanges([...this.scans.get(k) ?? [], [from, to]]));
    }
  }
  scanned(address, version) {
    return [...this.scans.get(`${address.toLowerCase()}@v${version}`) ?? []];
  }
  /** Stored events paying any of `addresses`, from `sinceBlock`, oldest first. */
  eventsFor(addresses, sinceBlock = 0) {
    const watch = new Set(addresses.map((a) => a.toLowerCase()));
    return [...this.events.values()].filter((e) => e.block >= sinceBlock && pays(e, watch)).sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  }
  /** A JSON string of everything stored (amounts as decimal strings). */
  toJSON() {
    return JSON.stringify({ events: [...this.events.values()], scans: Object.fromEntries(this.scans) }, (_k, v) => typeof v === "bigint" ? v.toString() : v);
  }
  /** Restore a store saved with {@link MemoryStore.toJSON}. */
  static fromJSON(json) {
    const s = new _MemoryStore();
    const d = JSON.parse(json);
    for (const e of d.events) {
      for (const r of ROLES) {
        const p = e.payouts[r];
        p.currency = BigInt(p.currency);
        p.coin = BigInt(p.coin);
      }
      s.events.set(keyOf(e), e);
    }
    for (const [k, v] of Object.entries(d.scans)) s.scans.set(k, v);
    return s;
  }
};
var RpcError = class extends Error {
  constructor(method, code, message) {
    super(`rpc ${method}: ${code} ${message}`);
    this.method = method;
    this.code = code;
    this.name = "RpcError";
  }
  method;
  code;
};
var tooLarge = (msg) => {
  const m = msg.toLowerCase();
  return !m.includes("rate") && ["range", "too many", "limit exceeded", "10000 results", "response size"].some((s) => m.includes(s));
};
var Indexer = class {
  constructor(store, rpcUrl = DEFAULT_RPC, fetchImpl = globalThis.fetch.bind(globalThis)) {
    this.store = store;
    this.rpcUrl = rpcUrl;
    this.fetchImpl = fetchImpl;
  }
  store;
  rpcUrl;
  fetchImpl;
  /** Blocks per eth_getLogs for V4 (halved automatically when a node refuses). */
  step = 2e3;
  maxRetries = 5;
  /** Index rewards paid to `addresses`; resolves to how many new matching events were stored. */
  async scan(addresses, opt = {}) {
    const addrs = [...new Set(addresses.map((a) => a.toLowerCase()))].sort();
    if (!addrs.length) throw new Error("rewards: no addresses to scan");
    for (const a of addrs) if (!/^0x[0-9a-f]{40}$/.test(a)) throw new Error(`rewards: ${a} is not an address`);
    const head = opt.toBlock ?? await this.head(opt.signal);
    const start = opt.fromBlock ?? (opt.days !== void 0 ? blockAt(Date.now() / 1e3 - opt.days * 86400) : 0);
    const plan = [];
    for (const [v, floor] of [[4, V4_FIRST_BLOCK], ...opt.includeV3 ? [[3, V3_FIRST_BLOCK]] : []]) {
      const lo = Math.max(start, floor);
      if (lo > head) continue;
      const gaps = [];
      for (const a of addrs) gaps.push(...missingRanges(lo, head, await this.store.scanned(a, v)));
      for (const [a, b] of mergeRanges(gaps)) plan.push([v, a, b]);
    }
    const total = plan.reduce((n, [, a, b]) => n + b - a + 1, 0);
    const watch = new Set(addrs);
    let done = 0, found = 0;
    for (const [version, lo, hi] of plan) {
      let step = version === 3 ? this.step * 5 : this.step;
      for (let from = lo; from <= hi; ) {
        const to = Math.min(from + step - 1, hi);
        let events;
        try {
          events = await this.fetchRange(version, from, to, addrs, opt.signal);
        } catch (err) {
          if (err instanceof RpcError && tooLarge(err.message) && step > 50) {
            step = Math.floor(step / 2);
            continue;
          }
          throw err;
        }
        const mine = events.filter((e) => pays(e, watch));
        await this.store.save(mine, addrs, version, from, to);
        found += mine.length;
        done += to - from + 1;
        opt.onProgress?.(done, total, found);
        from = to + 1;
      }
    }
    return found;
  }
  /** The latest block number. */
  async head(signal) {
    return Number(BigInt(await this.call("eth_blockNumber", [], signal)));
  }
  async fetchRange(version, lo, hi, addrs, signal) {
    const span = { fromBlock: "0x" + lo.toString(16), toBlock: "0x" + hi.toString(16) };
    let logs = [];
    if (version === 4) {
      logs = await this.call("eth_getLogs", [{ ...span, topics: [TOPIC_MARKET_REWARDS_V4] }], signal);
    } else {
      const topics = addrs.map(addressTopic);
      for (const pos of [1, 2, 3]) {
        const filter = [TOPIC_TRADE_REWARDS_V3, null, null, null];
        filter[pos] = topics;
        logs.push(...await this.call("eth_getLogs", [{ ...span, topics: filter }], signal));
      }
    }
    const seen = /* @__PURE__ */ new Set();
    return logs.map(decodeLog).filter((e) => e !== null && !seen.has(keyOf(e)) && seen.add(keyOf(e)) !== void 0).sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  }
  async call(method, params, signal) {
    let last;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, Math.min(2 ** attempt, 20) * 1e3));
      let resp;
      try {
        resp = await this.fetchImpl(this.rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: signal ?? null
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        last = err;
        continue;
      }
      if (resp.status === 429 || resp.status >= 500) {
        last = new RpcError(method, resp.status, `HTTP ${resp.status}`);
        continue;
      }
      const body = await resp.json();
      if (body.error) {
        const e = new RpcError(method, body.error.code ?? 0, body.error.message ?? "");
        if (/rate|timeout|busy/i.test(e.message)) {
          last = e;
          continue;
        }
        throw e;
      }
      return body.result;
    }
    throw last;
  }
};
var toNumber = (raw, decimals) => Number(raw) / 10 ** decimals;
function formatUsd(x) {
  if (Math.abs(x) >= 0.01 || x === 0) return "$" + x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return "$" + Number(x.toPrecision(4)).toString();
}
var fmtAmount = (x) => Math.abs(x) >= 1 ? x.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : String(Number(x.toPrecision(6)));
var Report = class {
  constructor(addresses, events, firstBlock, lastBlock, lines, tokens, byCoinUsd, byTimeUsd, coinNames) {
    this.addresses = addresses;
    this.events = events;
    this.firstBlock = firstBlock;
    this.lastBlock = lastBlock;
    this.lines = lines;
    this.tokens = tokens;
    this.byCoinUsd = byCoinUsd;
    this.byTimeUsd = byTimeUsd;
    this.coinNames = coinNames;
  }
  addresses;
  events;
  firstBlock;
  lastBlock;
  lines;
  tokens;
  byCoinUsd;
  byTimeUsd;
  coinNames;
  amount(l) {
    return toNumber(l.raw, this.tokens.get(l.token)?.decimals ?? 18);
  }
  usd(l) {
    const p = this.tokens.get(l.token)?.priceUsd;
    return p == null ? null : this.amount(l) * p;
  }
  get totalUsd() {
    return this.lines.reduce((s, l) => s + (this.usd(l) ?? 0), 0);
  }
  byRoleUsd() {
    const out = /* @__PURE__ */ new Map();
    for (const l of this.lines) out.set(l.role, (out.get(l.role) ?? 0) + (this.usd(l) ?? 0));
    return out;
  }
  /** A plain-text table. */
  toText() {
    const rows = [`Zora rewards for ${this.addresses.join(", ")}`, `${this.events} reward events` + (this.firstBlock !== null ? `, blocks ${this.firstBlock}\u2013${this.lastBlock}` : "")];
    for (const l of this.lines) {
      const sym = this.tokens.get(l.token)?.symbol ?? l.token;
      const usd = this.usd(l);
      rows.push(`  ${ROLE_LABELS[l.role].padEnd(18)} ${fmtAmount(this.amount(l)).padStart(16)} ${sym.padEnd(12)} ${(usd === null ? "\u2014" : formatUsd(usd)).padStart(12)}  (${l.payouts} payouts)`);
    }
    rows.push(`  ${"Total (current prices)".padEnd(18)} ${"".padStart(16)} ${"".padEnd(12)} ${formatUsd(this.totalUsd).padStart(12)}`);
    return rows.join("\n") + "\n";
  }
  /** A self-contained HTML page (no external assets; light and dark themes). */
  toHtml(title = "Zora rewards") {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const days = [...this.byTimeUsd.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-60);
    const peak = Math.max(...days.map(([, v]) => v), Number.MIN_VALUE);
    const [barW, gap] = [12, 3];
    const bars = days.map(([d, v], i) => `<rect x="${i * (barW + gap)}" y="${(120 - v / peak * 110).toFixed(1)}" width="${barW}" height="${Math.max(v / peak * 110, 1).toFixed(1)}" rx="2"><title>${esc(d)} UTC: ${formatUsd(v)}</title></rect>`).join("");
    const unit = days[0] && days[0][0].length > 10 ? "hour" : "day";
    const rows = this.lines.map((l) => `<tr><td>${esc(ROLE_LABELS[l.role])}</td><td class=n>${fmtAmount(this.amount(l))}</td><td>${esc(this.tokens.get(l.token)?.symbol ?? l.token)}</td><td class=n>${this.usd(l) === null ? "\u2014" : formatUsd(this.usd(l))}</td><td class=n>${l.payouts}</td></tr>`).join("");
    const coins = [...this.byCoinUsd.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([c, v]) => `<tr><td><a href="https://zora.co/coin/base:${esc(c)}">${esc(this.coinNames.get(c) ?? c)}</a></td><td class=n>${formatUsd(v)}</td></tr>`).join("");
    const kpis = [...this.byRoleUsd().entries()].filter(([, v]) => v > 0).map(([r, v]) => `<div class=kpi><span>${esc(ROLE_LABELS[r])}</span><b>${formatUsd(v)}</b></div>`).join("");
    return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--line:#e7e5e4;--accent:#4f46e5}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#f5f5f4;--muted:#a8a29e;--line:#292524;--accent:#818cf8}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}main{max-width:880px;margin:0 auto;padding:32px 16px}
h1{font-size:24px;margin:0 0 4px}.muted{color:var(--muted);font-size:13px;word-break:break-all}
.kpis{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0}.kpi{border:1px solid var(--line);border-radius:10px;padding:12px 16px;min-width:150px}
.kpi span{display:block;color:var(--muted);font-size:12px}.kpi b{font-size:20px}
table{width:100%;border-collapse:collapse;margin:8px 0 24px}td,th{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left}.n{text-align:right;font-variant-numeric:tabular-nums}
svg rect{fill:var(--accent)}a{color:var(--accent)}h2{font-size:16px;margin:24px 0 4px}
</style></head><body><main>
<h1>${esc(title)}</h1><div class=muted>${esc(this.addresses.join(", "))}</div>
<div class=kpis><div class=kpi><span>Total earned (current prices)</span><b>${formatUsd(this.totalUsd)}</b></div>${kpis}<div class=kpi><span>Reward events</span><b>${this.events}</b></div></div>
<h2>Earnings per ${unit} (USD, UTC)</h2><svg viewBox="0 0 ${Math.max(days.length, 24) * (barW + gap)} 122" width="100%" height="140" role="img" aria-label="Earnings per ${unit}">${bars}</svg>
<h2>By role and token</h2><table><tr><th>Role</th><th class=n>Amount</th><th>Token</th><th class=n>USD now</th><th class=n>Payouts</th></tr>${rows}</table>
<h2>Top coins</h2><table><tr><th>Coin</th><th class=n>USD now</th></tr>${coins}</table>
<p class=muted>USD values use current token prices from the Zora API, not prices at the time of each payout. Source: CoinMarketRewardsV4 / CoinTradeRewards events on Base. Generated by zora-coins (TypeScript).</p>
</main></body></html>`;
  }
};
async function tokenMeta(client, address) {
  const isEth = address === ZERO_ADDRESS;
  const fallback = isEth ? { address, symbol: "ETH", decimals: 18, priceUsd: null } : address === USDC_ADDRESS ? { address, symbol: "USDC", decimals: 6, priceUsd: 1 } : { address, symbol: address.slice(0, 8) + "\u2026", decimals: 18, priceUsd: null };
  if (!client) return fallback;
  try {
    const cur = (await client.tokenInfo(isEth ? WETH_ADDRESS : address))?.currency;
    if (!cur) return fallback;
    const price = cur.priceUsd ? Number(cur.priceUsd) : NaN;
    return { address, symbol: isEth ? "ETH" : cur.symbol ?? fallback.symbol, decimals: cur.decimals ?? 18, priceUsd: Number.isFinite(price) ? price : null };
  } catch {
    return fallback;
  }
}
var bucket = (unix, hourly) => new Date(unix * 1e3).toISOString().slice(0, hourly ? 13 : 10).replace("T", " ") + (hourly ? ":00" : "");
async function buildReport(events, addresses, client = null) {
  const watch = new Set(addresses.map((a) => a.toLowerCase()));
  const lines = /* @__PURE__ */ new Map();
  const credits = [];
  for (const e of events) {
    for (const role of ROLES) {
      const p = e.payouts[role];
      if (!watch.has(p.recipient)) continue;
      for (const [token, raw] of [[e.currency, p.currency], [e.coin || ZERO_ADDRESS, p.coin]]) {
        if (raw <= 0n) continue;
        const k = `${role}|${token}`;
        const line = lines.get(k) ?? { role, token, raw: 0n, payouts: 0 };
        line.raw += raw;
        line.payouts++;
        lines.set(k, line);
        credits.push([e, token, raw]);
      }
    }
  }
  const tokens = /* @__PURE__ */ new Map();
  for (const l of lines.values()) if (!tokens.has(l.token)) tokens.set(l.token, await tokenMeta(client, l.token));
  const sorted = [...lines.values()].sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.token.localeCompare(b.token));
  const span = events.length ? eventTime(events[events.length - 1]) - eventTime(events[0]) : 0;
  const byCoin = /* @__PURE__ */ new Map();
  const byTime = /* @__PURE__ */ new Map();
  for (const [e, token, raw] of credits) {
    const t = tokens.get(token);
    if (!t || t.priceUsd === null) continue;
    const usd = toNumber(raw, t.decimals) * t.priceUsd;
    if (e.coin) byCoin.set(e.coin, (byCoin.get(e.coin) ?? 0) + usd);
    const b = bucket(eventTime(e), span <= 3 * 86400);
    byTime.set(b, (byTime.get(b) ?? 0) + usd);
  }
  const names = /* @__PURE__ */ new Map();
  if (client) {
    for (const [coin] of [...byCoin.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      try {
        names.set(coin, (await client.coin(coin))?.symbol ?? coin);
      } catch {
        names.set(coin, coin);
      }
    }
  }
  const blocks = events.map((e) => e.block);
  return new Report(
    [...watch].sort(),
    events.length,
    blocks.length ? Math.min(...blocks) : null,
    blocks.length ? Math.max(...blocks) : null,
    sorted,
    tokens,
    byCoin,
    byTime,
    names
  );
}

// src/cli.ts
var USAGE = `usage: zora-rewards [options] ADDRESS...

Reports the Zora creator and referral rewards paid to addresses on Base.

options:
  --days N         how far back to scan (default 30)
  --from-block N   scan from this block instead
  --v3             also scan legacy V3 coins
  --rpc URL        Base JSON-RPC URL (default ${DEFAULT_RPC}; a private RPC is faster)
  --db FILE        where scanned events are kept between runs (default zora-rewards.json)
  --html FILE      also write an HTML report
  --json           print the report as JSON
  --no-scan        report from what is stored, without scanning`;
async function main() {
  let parsed;
  try {
    parsed = (0, import_node_util.parseArgs)({
      allowPositionals: true,
      options: {
        days: { type: "string", default: "30" },
        "from-block": { type: "string" },
        v3: { type: "boolean", default: false },
        rpc: { type: "string", default: DEFAULT_RPC },
        db: { type: "string", default: "zora-rewards.json" },
        html: { type: "string" },
        json: { type: "boolean", default: false },
        "no-scan": { type: "boolean", default: false },
        help: { type: "boolean", short: "h" }
      }
    });
  } catch (e) {
    console.error(`zora-rewards: ${e.message}

${USAGE}`);
    return 2;
  }
  const { values: o, positionals: addrs } = parsed;
  if (o.help || !addrs.length) {
    console.error(USAGE);
    return o.help ? 0 : 2;
  }
  const store = (0, import_node_fs.existsSync)(o.db) ? MemoryStore.fromJSON((0, import_node_fs.readFileSync)(o.db, "utf8")) : new MemoryStore();
  const idx = new Indexer(store, o.rpc);
  if (!o["no-scan"]) {
    const fromBlock = o["from-block"] ? Number(o["from-block"]) : void 0;
    const n = await idx.scan(addrs, {
      ...fromBlock === void 0 ? { days: Number(o.days) } : { fromBlock },
      includeV3: o.v3,
      onProgress: (done, total, found) => {
        (0, import_node_fs.writeFileSync)(o.db, store.toJSON());
        process.stderr.write(`\r  scanned ${done}/${total} blocks (${total ? Math.round(100 * done / total) : 100}%) \xB7 ${found} matching reward events`);
      }
    });
    (0, import_node_fs.writeFileSync)(o.db, store.toJSON());
    process.stderr.write(`
  ${n} new reward events saved to ${o.db}
`);
  }
  const report = await buildReport(store.eventsFor(addrs), addrs, new ZoraCoins());
  if (o.json) {
    console.log(JSON.stringify({
      addresses: report.addresses,
      events: report.events,
      firstBlock: report.firstBlock,
      lastBlock: report.lastBlock,
      totalUsd: report.totalUsd,
      lines: report.lines.map((l) => ({
        role: l.role,
        label: ROLE_LABELS[l.role],
        token: l.token,
        symbol: report.tokens.get(l.token)?.symbol,
        raw: l.raw.toString(),
        amount: report.amount(l),
        usd: report.usd(l),
        payouts: l.payouts
      }))
    }, null, 1));
  } else {
    process.stdout.write(report.toText());
  }
  if (o.html) {
    (0, import_node_fs.writeFileSync)(o.html, report.toHtml());
    process.stderr.write(`  wrote ${o.html}
`);
  }
  return 0;
}
main().then((code) => process.exit(code), (err) => {
  console.error(`zora-rewards: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
//# sourceMappingURL=cli.cjs.map