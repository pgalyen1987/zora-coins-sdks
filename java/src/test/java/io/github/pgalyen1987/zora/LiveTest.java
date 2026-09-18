package io.github.pgalyen1987.zora;

import static org.junit.jupiter.api.Assertions.*;

import io.github.pgalyen1987.zora.model.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/** Against Zora's production API: LIVE=1 ./gradlew test --tests '*LiveTest*' */
@EnabledIfEnvironmentVariable(named = "LIVE", matches = "1")
class LiveTest {
    static final String FV = "0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b";

    interface Step {
        void run() throws Exception;
    }

    static void step(String name, Step s) {
        try {
            s.run();
            Thread.sleep(350);
        } catch (Throwable t) {
            throw new AssertionError(name + ": " + t, t);
        }
    }

    @Test
    void everyEndpoint() {
        ZoraCoins z = ZoraCoins.builder().build();
        step("coin", () -> assertEquals("FATVANCE64", z.getCoin(FV, null).orElseThrow().getName()));
        step("coins", () -> assertEquals(1, z.getCoinsByAddress(FV).size()));
        step("coinHolders", () -> z.getCoinHolders(FV, new CoinHoldersParams().pageSize(3)));
        step("coinSwaps", () -> z.getCoinSwaps(FV, null));
        step("coinComments", () -> z.getCoinComments(FV, null));
        step("coinMergedComments", () -> z.getCoinMergedComments(FV, null));
        step("coinPriceHistory", () -> z.getCoinPriceHistory(FV, null));
        step("coinsList", () -> assertFalse(z.getCoinsList(new CoinsListParams().pageSize(3)).nodes().isEmpty()));
        step("tokenInfo", () -> assertTrue(z.getTokenInfo(ZoraCoins.USDC_ADDRESS, null).isPresent()));
        step("explore", () -> assertFalse(z.explore(ListType.TOP_GAINERS, new ExploreParams().pageSize(3)).nodes().isEmpty()));
        step("iterateExplore", () -> {
            int n = 0;
            for (Zora20Token ignored : z.iterateExplore(ListType.TOP_VOLUME_24H, new ExploreParams().pageSize(2))) if (++n == 5) break;
            assertEquals(5, n);
        });
        step("search", () -> z.search("zora", new SearchParams().pageSize(3)));
        step("trendsByName", () -> z.getTrendsByName("base", null));
        step("traderLeaderboard", () -> z.getTraderLeaderboard(null));
        step("featuredCreators", () -> z.getFeaturedCreators(null));
        step("latestLiveStreams", () -> z.getLatestLiveStreams(null));
        step("topLiveStreams", () -> z.getTopLiveStreams(null));
        step("creatorLivestreamComments", () -> z.getCreatorLivestreamComments(FV, null));
        step("profile", () -> assertEquals("rebelstudios", z.getProfile("rebelstudios").orElseThrow().getHandle()));
        step("profileCoins", () -> z.getProfileCoins("rebelstudios", null));
        step("profileBalances", () -> z.getProfileBalances("rebelstudios", null));
        step("profileSocial", () -> z.getProfileSocial("rebelstudios"));
        step("walletTradeActivity", () -> z.getWalletTradeActivity("rebelstudios", null));
        step("creatorCoinPoolConfig", () -> z.getCreatorCoinPoolConfig(null));
        step("contentCoinPoolConfig", () -> z.getContentCoinPoolConfig(CurrencyType.ZORA, null));
        step("quote", () -> assertTrue(z.quoteTrade(ZoraCoins.eth(), ZoraCoins.erc20(FV), "1000000000000", "0x8E57BFDE053dBb6862991759c19affC5F383d5D0", null).getSuccess()));
        step("missing coin", () -> assertTrue(z.getCoin("0x000000000000000000000000000000000000dead", null).isEmpty()));
    }
}
