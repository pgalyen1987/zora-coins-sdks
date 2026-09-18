import { describe, expect, it } from "vitest";

import { CurrencyType, ListType, USDC_ADDRESS, ZoraCoins, erc20, eth, nodes } from "../src/index.js";

const FV = "0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b";
const pace = () => new Promise((r) => setTimeout(r, 350));

describe.runIf(process.env.LIVE)("live Zora API", () => {
  it("answers every endpoint", async () => {
    const z = new ZoraCoins();
    const steps: Array<[string, () => Promise<unknown>]> = [
      ["coin", async () => expect((await z.coin(FV))?.name).toBe("FATVANCE64")],
      ["coins", async () => expect(await z.coinsByAddress(FV)).toHaveLength(1)],
      ["coinHolders", () => z.coinHolders(FV, { pageSize: 3 })],
      ["coinSwaps", () => z.coinSwaps(FV)],
      ["coinComments", () => z.coinComments(FV)],
      ["coinMergedComments", () => z.coinMergedComments(FV)],
      ["coinPriceHistory", () => z.coinPriceHistory(FV)],
      ["coinsList", async () => expect(nodes(await z.coinsList({ pageSize: 3 })).length).toBeGreaterThan(0)],
      ["tokenInfo", async () => expect(await z.tokenInfo(USDC_ADDRESS)).not.toBeNull()],
      ["explore", async () => expect(nodes(await z.explore(ListType.TopGainers, { pageSize: 3 })).length).toBeGreaterThan(0)],
      ["iterExplore", async () => {
        let n = 0;
        for await (const _ of z.iterExplore(ListType.TopVolume24h, { pageSize: 2 })) if (++n === 5) break;
        expect(n).toBe(5);
      }],
      ["search", () => z.search("zora", { pageSize: 3 })],
      ["trendsByName", () => z.trendsByName("base")],
      ["traderLeaderboard", () => z.traderLeaderboard()],
      ["featuredCreators", () => z.featuredCreators()],
      ["latestLiveStreams", () => z.latestLiveStreams()],
      ["topLiveStreams", () => z.topLiveStreams()],
      ["creatorLivestreamComments", () => z.creatorLivestreamComments(FV)],
      ["profile", async () => expect((await z.profile("rebelstudios"))?.handle).toBe("rebelstudios")],
      ["profileCoins", () => z.profileCoins("rebelstudios")],
      ["profileBalances", () => z.profileBalances("rebelstudios")],
      ["profileSocial", () => z.profileSocial("rebelstudios")],
      ["walletTradeActivity", () => z.walletTradeActivity("rebelstudios")],
      ["creatorCoinPoolConfig", () => z.creatorCoinPoolConfig()],
      ["contentCoinPoolConfig", () => z.contentCoinPoolConfig(CurrencyType.Zora)],
      ["quote", async () => expect((await z.quoteTrade(eth(), erc20(FV), 10n ** 12n, "0x8E57BFDE053dBb6862991759c19affC5F383d5D0")).success).toBe(true)],
      ["missing coin", async () => expect(await z.coin("0x000000000000000000000000000000000000dead")).toBeNull()],
    ];
    for (const [name, step] of steps) {
      await step().catch((e) => { throw new Error(`${name}: ${e}`); });
      await pace();
    }
  });
});
