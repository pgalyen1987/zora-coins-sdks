import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ListType, SortOption, ZoraApiError, ZoraCoins, ZoraGraphQL, ZoraGraphQLError, erc20, eth, nextCursor, nodes } from "../src/index.js";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${name}.json`, import.meta.url), "utf8"));

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;
function mock(handler: Handler) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { calls, client: new ZoraCoins({ fetch: fetchImpl, apiKey: "k", maxRetries: 2, baseUrl: "http://zora.test" }) };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("ZoraCoins", () => {
  it("decodes a real coin and sends address, chain and key", async () => {
    const { calls, client } = mock(() => json(fixture("coin")));
    const coin = await client.coin("0xabc");
    expect(coin?.name).toBeTruthy();
    expect(coin?.__typename).toMatch(/^GraphQL/);
    expect(coin?.creatorProfile?.handle).toBeTruthy();
    expect(calls[0]!.url.pathname).toBe("/coin");
    expect(calls[0]!.url.searchParams.get("chain")).toBe("8453");
    expect((calls[0]!.init.headers as Record<string, string>)["api-key"]).toBe("k");
  });

  it("resolves a missing coin to null", async () => {
    const { client } = mock(() => json(fixture("coin_missing")));
    expect(await client.coin("0xdead")).toBeNull();
  });

  it("iterates every page and stops on the last", async () => {
    const p1 = fixture("explore_page1");
    const p2 = fixture("explore_page2");
    p2.exploreList.pageInfo = { hasNextPage: false };
    const { calls, client } = mock((url) => json(url.searchParams.get("after") ? p2 : p1));
    const all = [];
    for await (const c of client.iterExplore(ListType.TopVolume24h, { pageSize: 2 })) all.push(c);
    expect(all).toHaveLength(4);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url.searchParams.get("after")).toBe(p1.exploreList.pageInfo.endCursor);
    expect(calls[1]!.url.searchParams.get("count")).toBe("2");
  });

  it("stops on a repeated cursor and when the loop breaks", async () => {
    const { calls, client } = mock(() => json(fixture("explore_page1")));
    let n = 0;
    for await (const _ of client.iterExplore(ListType.New)) n++;
    expect(calls).toHaveLength(2);
    expect(n).toBe(4);
    const second = mock(() => json(fixture("explore_page1")));
    for await (const _ of second.client.iterExplore(ListType.New)) break;
    expect(second.calls).toHaveLength(1);
  });

  it("retries 429 with Retry-After, then succeeds", async () => {
    let i = 0;
    const { calls, client } = mock(() => (++i < 3 ? json({}, 429, { "retry-after": "0" }) : json(fixture("token_info"))));
    expect((await client.tokenInfo("0xusdc"))?.currency?.symbol).toBeTruthy();
    expect(calls).toHaveLength(3);
  });

  it("throws ZoraApiError with the API's message, rate limit and liquidity flags", async () => {
    const limited = mock(() => json({ error: "slow down" }, 429, { "retry-after": "0" }));
    await expect(limited.client.profile("x")).rejects.toMatchObject({ isRateLimited: true, message: expect.stringContaining("slow down") });
    const liquidity = mock(() => json({ success: "false", error: "not enough liquidity", errorType: "LIQUIDITY" }, 422));
    const err = await liquidity.client.quoteTrade(eth(), erc20("0xc"), 10n ** 30n, "0xme").catch((e) => e);
    expect(err).toBeInstanceOf(ZoraApiError);
    expect(err.isInsufficientLiquidity).toBe(true);
    expect(liquidity.calls).toHaveLength(1);
  });

  it("encodes repeated list params and explicit false", async () => {
    const { calls, client } = mock(() => json(fixture("profile_balances")));
    const page = await client.profileBalances("jacob", { pageSize: 7, sortOption: SortOption.UsdValue, excludeHidden: false, chainIds: [8453, 7777777] });
    const q = calls[0]!.url.searchParams;
    expect(q.getAll("chainIds")).toEqual(["8453", "7777777"]);
    expect([q.get("excludeHidden"), q.get("sortOption"), q.get("count")]).toEqual(["false", "USD_VALUE", "7"]);
    expect(nodes(page).length).toBeGreaterThan(0);
    expect(nextCursor(page)).toBeTruthy();
  });

  it("sends one JSON coins param per coin", async () => {
    const { calls, client } = mock(() => json(fixture("coins")));
    expect(await client.coinsByAddress("0xAAA", "0xbbb")).toHaveLength(2);
    expect(calls[0]!.url.searchParams.getAll("coins")[0]).toBe('{"chainId":8453,"collectionAddress":"0xaaa"}');
  });

  it("fills quote defaults and posts JSON", async () => {
    const { calls, client } = mock(() => json(fixture("quote")));
    const q = await client.quoteTrade(eth(), erc20("0xc0"), 1000n, "0xme", { referrer: "0xapp" });
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({ recipient: "0xme", slippage: 0.05, chainId: 8453, amountIn: "1000", referrer: "0xapp", tokenIn: { type: "eth" } });
    expect(calls[0]!.init.method).toBe("POST");
    expect(q.call?.data).toMatch(/^0x/);
    expect(q.success).toBe(true); // the API sends the string "true"
  });
});

describe("ZoraGraphQL", () => {
  it("returns data and throws on errors", async () => {
    const coin = fixture("coin").zora20Token;
    let fail = false;
    const fetchImpl = (async () => json(fail ? { data: null, errors: [{ message: "boom" }] } : { data: { coin } })) as typeof fetch;
    const gql = new ZoraGraphQL("http://gw/graphql", { fetch: fetchImpl });
    expect((await gql.query<{ coin: { name: string } }>("{ coin { name } }")).coin.name).toBe(coin.name);
    fail = true;
    await expect(gql.query("{ x }")).rejects.toBeInstanceOf(ZoraGraphQLError);
  });
});
