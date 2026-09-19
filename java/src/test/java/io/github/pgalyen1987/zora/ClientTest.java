package io.github.pgalyen1987.zora;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.github.pgalyen1987.zora.internal.Json;
import io.github.pgalyen1987.zora.model.*;
import io.github.pgalyen1987.zora.rewards.Rewards;
import java.io.IOException;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.function.BiFunction;
import org.junit.jupiter.api.Test;

class ClientTest {
    static byte[] fixture(String name) throws IOException {
        return Files.readAllBytes(Path.of("..", "fixtures", name + ".json"));
    }

    /** A transport answering from a function, recording requests. */
    static final class Fake implements Transport {
        final List<String[]> calls = new ArrayList<>(); // {method, url, body, api-key}
        final BiFunction<String, String, Transport.Response> respond;

        Fake(BiFunction<String, String, Transport.Response> respond) {
            this.respond = respond;
        }

        @Override
        public Transport.Response send(String method, String url, Map<String, String> headers, byte[] body, java.time.Duration timeout) {
            calls.add(new String[] {method, url, body == null ? null : new String(body, StandardCharsets.UTF_8), headers.get("api-key")});
            return respond.apply(url, body == null ? null : new String(body, StandardCharsets.UTF_8));
        }
    }

    static Transport.Response ok(byte[] body) {
        return new Transport.Response(200, Map.of(), body);
    }

    static Transport.Response status(int code, String body, String retryAfter) {
        return new Transport.Response(code, retryAfter == null ? Map.of() : Map.of("Retry-After", List.of(retryAfter)), body.getBytes(StandardCharsets.UTF_8));
    }

    static ZoraCoins client(Fake f) {
        return ZoraCoins.builder().apiKey("k").baseUrl("http://zora.test").transport(f).maxRetries(2).build();
    }

    static Map<String, List<String>> query(String url) {
        Map<String, List<String>> out = new LinkedHashMap<>();
        String q = URI.create(url).getRawQuery();
        if (q != null) for (String p : q.split("&")) {
            String[] kv = p.split("=", 2);
            out.computeIfAbsent(URLDecoder.decode(kv[0], StandardCharsets.UTF_8), k -> new ArrayList<>()).add(URLDecoder.decode(kv[1], StandardCharsets.UTF_8));
        }
        return out;
    }

    @Test
    void coinDecodesARealResponse() throws IOException {
        byte[] body = fixture("coin");
        Fake f = new Fake((u, b) -> ok(body));
        Zora20Token coin = client(f).getCoin("0xabc", null).orElseThrow();
        assertNotNull(coin.getName());
        assertTrue(coin.getTypename().startsWith("GraphQL"));
        assertNotNull(coin.getCreatorProfile().getHandle());
        assertEquals("8453", query(f.calls.get(0)[1]).get("chain").get(0));
        assertEquals("k", f.calls.get(0)[3]);
    }

    @Test
    void missingCoinIsEmpty() throws IOException {
        byte[] body = fixture("coin_missing");
        assertTrue(client(new Fake((u, b) -> ok(body))).getCoin("0xdead", null).isEmpty());
    }

    @Test
    void iterateFollowsCursorsAndStopsOnLastPage() throws IOException {
        byte[] p1 = fixture("explore_page1");
        ObjectNode p2 = (ObjectNode) Json.read(fixture("explore_page2"), JsonNode.class);
        ((ObjectNode) p2.get("exploreList")).putObject("pageInfo").put("hasNextPage", false);
        byte[] p2b = Json.write(p2).getBytes(StandardCharsets.UTF_8);
        Fake f = new Fake((u, b) -> ok(query(u).containsKey("after") ? p2b : p1));
        List<Zora20Token> all = new ArrayList<>();
        for (Zora20Token c : client(f).iterateExplore(ListType.TOP_VOLUME_24H, new ExploreParams().pageSize(2))) all.add(c);
        assertEquals(4, all.size());
        assertEquals(2, f.calls.size());
        assertEquals("2", query(f.calls.get(1)[1]).get("count").get(0));
    }

    @Test
    void iterateStopsOnRepeatedCursorAndOnBreak() throws IOException {
        byte[] p1 = fixture("explore_page1");
        Fake f = new Fake((u, b) -> ok(p1));
        int n = 0;
        for (Zora20Token ignored : client(f).iterateExplore(ListType.NEW, null)) n++;
        assertEquals(2, f.calls.size());
        assertEquals(4, n);
        Fake g = new Fake((u, b) -> ok(p1));
        for (Zora20Token ignored : client(g).iterateExplore(ListType.NEW, null)) break;
        assertEquals(1, g.calls.size());
    }

    @Test
    void retriesRateLimitThenSucceeds() throws IOException {
        byte[] info = fixture("token_info");
        int[] i = {0};
        Fake f = new Fake((u, b) -> ++i[0] < 3 ? status(429, "{}", "0") : ok(info));
        assertTrue(client(f).getTokenInfo(ZoraCoins.USDC_ADDRESS, null).isPresent());
        assertEquals(3, f.calls.size());
    }

    @Test
    void errorsCarryMessageRateLimitAndLiquidity() {
        ZoraApiException limited = assertThrows(ZoraApiException.class,
                () -> client(new Fake((u, b) -> status(429, "{\"error\":\"slow down\"}", "0"))).getProfile("x"));
        assertTrue(limited.isRateLimited());
        assertTrue(limited.getMessage().contains("slow down"));
        Fake thin = new Fake((u, b) -> status(422, "{\"success\":\"false\",\"error\":\"not enough liquidity\",\"errorType\":\"LIQUIDITY\"}", null));
        ZoraApiException q = assertThrows(ZoraApiException.class, () -> client(thin).quoteTrade(ZoraCoins.eth(), ZoraCoins.erc20("0xc"), "1", "0xme", null));
        assertTrue(q.isInsufficientLiquidity());
        assertEquals(1, thin.calls.size());
    }

    @Test
    void queryEncoding() throws IOException {
        byte[] body = fixture("profile_balances");
        Fake f = new Fake((u, b) -> ok(body));
        CoinBalanceConnection page = client(f).getProfileBalances("jacob",
                new ProfileBalancesParams().pageSize(7).sortOption(SortOption.USD_VALUE).excludeHidden(false).chainIds(List.of(8453L, 7777777L)));
        Map<String, List<String>> q = query(f.calls.get(0)[1]);
        assertEquals(List.of("8453", "7777777"), q.get("chainIds"));
        assertEquals("false", q.get("excludeHidden").get(0));
        assertEquals("USD_VALUE", q.get("sortOption").get(0));
        assertFalse(page.nodes().isEmpty());
        assertNotNull(page.nextCursor());
    }

    @Test
    void coinsSendsOneJsonParamPerCoin() throws IOException {
        byte[] body = fixture("coins");
        Fake f = new Fake((u, b) -> ok(body));
        assertEquals(2, client(f).getCoinsByAddress("0xAAA", "0xbbb").size());
        assertEquals("{\"chainId\":8453,\"collectionAddress\":\"0xaaa\"}", query(f.calls.get(0)[1]).get("coins").get(0));
    }

    @Test
    void quoteFillsDefaultsAndReadsStringBoolean() throws IOException {
        byte[] body = fixture("quote");
        Fake f = new Fake((u, b) -> ok(body));
        QuoteResponse q = client(f).quoteTrade(ZoraCoins.eth(), ZoraCoins.erc20("0xc0"), "1000", "0xme", "0xapp");
        JsonNode sent = Json.read(f.calls.get(0)[2].getBytes(StandardCharsets.UTF_8), JsonNode.class);
        assertEquals("0xme", sent.get("recipient").asText());
        assertEquals(8453, sent.get("chainId").asLong());
        assertEquals("eth", sent.get("tokenIn").get("type").asText());
        assertFalse(sent.get("tokenIn").has("address"));
        assertEquals("0xapp", sent.get("referrer").asText());
        assertTrue(q.getSuccess());
        assertTrue(q.getCall().getData().startsWith("0x"));
    }

    @Test
    void unknownEnumValuesSurvive() {
        Zora20Token coin = Json.read("{\"coinType\":\"SOMETHING_NEW\"}".getBytes(StandardCharsets.UTF_8), Zora20Token.class);
        assertEquals("SOMETHING_NEW", coin.getCoinType().value());
        assertSame(ListType.TOP_GAINERS, ListType.of("TOP_GAINERS"));
    }

    @Test
    void everyFixtureDecodes() throws IOException {
        Map<String, Class<?>> cases = Map.of("coin", CoinResponse.class, "coin_holders", CoinHoldersResponse.class, "coin_swaps", CoinSwapsResponse.class,
                "price_history", CoinPriceHistoryResponse.class, "explore_page1", ExploreResponse.class, "profile", ProfileResponse.class,
                "profile_balances", ProfileBalancesResponse.class, "search", SearchResponse.class, "coins", CoinsResponse.class, "quote", QuoteResponse.class);
        for (Map.Entry<String, Class<?>> c : cases.entrySet()) {
            Object parsed = Json.MAPPER.copy().configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true)
                    .readValue(fixture(c.getKey()), c.getValue());
            assertNotNull(parsed, c.getKey());
        }
    }

    @Test
    void graphqlReturnsDataAndThrowsOnErrors() throws IOException {
        JsonNode coin = Json.read(fixture("coin"), JsonNode.class).get("zora20Token");
        boolean[] fail = {false};
        Fake f = new Fake((u, b) -> ok((fail[0] ? "{\"data\":null,\"errors\":[{\"message\":\"boom\"}]}" : "{\"data\":{\"coin\":" + Json.write(coin) + "}}").getBytes(StandardCharsets.UTF_8)));
        ZoraGraphQL gql = new ZoraGraphQL("http://gw/graphql", null, f);
        JsonNode data = gql.query("{ coin { name } }", null);
        assertNotNull(gql.convert(data.get("coin"), Zora20Token.class).getName());
        assertEquals("{ coin { name } }", Json.read(f.calls.get(0)[2].getBytes(StandardCharsets.UTF_8), JsonNode.class).get("query").asText());
        fail[0] = true;
        ZoraGraphQL.GraphQLException e = assertThrows(ZoraGraphQL.GraphQLException.class, () -> gql.query("{ x }", null));
        assertEquals(List.of("boom"), e.messages());
    }

    @Test
    void rewardsDecodeScanAndReport() throws IOException {
        List<Rewards.Log> logs = Arrays.asList(Json.read(fixture("rewards_v4_logs"), Rewards.Log[].class));
        Rewards.Event first = Rewards.decode(logs.get(0)).orElseThrow();
        String who = first.payouts.get(Rewards.Role.CREATOR).recipient;
        assertEquals(4, first.version);
        int[] calls = {0};
        Fake node = new Fake((u, b) -> {
            calls[0]++;
            JsonNode req = Json.read(b.getBytes(StandardCharsets.UTF_8), JsonNode.class);
            if (req.get("method").asText().equals("eth_blockNumber")) return ok(("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":\"0x" + Long.toHexString(first.block + 500) + "\"}").getBytes(StandardCharsets.UTF_8));
            JsonNode f = req.get("params").get(0);
            long lo = Long.parseLong(f.get("fromBlock").asText().substring(2), 16), hi = Long.parseLong(f.get("toBlock").asText().substring(2), 16);
            if (hi - lo + 1 > 700) return ok("{\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32600,\"message\":\"block range too large\"}}".getBytes(StandardCharsets.UTF_8));
            List<Rewards.Log> in = new ArrayList<>();
            for (Rewards.Log l : logs) {
                long blk = Long.parseLong(l.blockNumber.substring(2), 16);
                if (blk >= lo && blk <= hi) in.add(l);
            }
            return ok(("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":" + Json.write(in) + "}").getBytes(StandardCharsets.UTF_8));
        });
        Rewards.Indexer idx = new Rewards.Indexer(new Rewards.MemoryStore(), "http://node", node);
        int n = idx.scan(List.of(who.toUpperCase(Locale.ROOT).replace("0X", "0x")), first.block - 1000, null, null, null);
        assertTrue(n > 0);
        int before = calls[0];
        assertEquals(0, idx.scan(List.of(who), first.block - 1000, null, null, null));
        assertEquals(1, calls[0] - before);
        Rewards.Report r = Rewards.Report.build(idx.store().eventsFor(List.of(who), 0), List.of(who), null);
        assertTrue(r.toText().contains("Creator payouts"));
        assertEquals("$0.0042", Rewards.Report.formatUsd(0.0042));
        assertEquals("$1,234.50", Rewards.Report.formatUsd(1234.5));
    }

    // Two real logs from one Base trade (tx 0x53f27c…f195): a CreatorCoinRewards payout for a creator coin and a
    // CoinMarketRewardsV4 payout for a content coin, both to the same creator.
    static final String CC_CREATOR = "0xf4acf3edc65df843630976459ab1349a88258e6d";

    @Test
    void rewardsCreatorCoinRewardsDecodeAndScan() throws IOException {
        List<Rewards.Log> logs = Arrays.asList(Json.read(fixture("creator_coin_rewards_logs"), Rewards.Log[].class));
        assertEquals(Rewards.TOPIC_CREATOR_COIN_REWARDS, logs.get(0).topics.get(0));
        Rewards.Event e = Rewards.decode(logs.get(0)).orElseThrow();
        assertEquals(4, e.version);
        assertEquals("0x3177fa60b8a342cd044badf34bf820c536094656", e.coin);
        assertEquals("0x1111111111166b7fe7bd91427724b487980afc69", e.currency);
        assertEquals(CC_CREATOR, e.payouts.get(Rewards.Role.CREATOR).recipient);
        assertEquals(new java.math.BigInteger("11879451646867555805"), e.payouts.get(Rewards.Role.CREATOR).currency);
        assertEquals(e.payouts.get(Rewards.Role.CREATOR).currency, e.payouts.get(Rewards.Role.PROTOCOL).currency);
        assertEquals(Rewards.ZERO_ADDRESS, e.payouts.get(Rewards.Role.PLATFORM_REFERRER).recipient);

        long block = Long.parseLong(logs.get(0).blockNumber.substring(2), 16);
        List<String> asked = new ArrayList<>();
        Fake node = new Fake((u, b) -> {
            JsonNode req = Json.read(b.getBytes(StandardCharsets.UTF_8), JsonNode.class);
            if (req.get("method").asText().equals("eth_blockNumber")) return ok(("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":\"0x" + Long.toHexString(block + 10) + "\"}").getBytes(StandardCharsets.UTF_8));
            JsonNode f = req.get("params").get(0);
            asked.add(f.get("topics").toString());
            long lo = Long.parseLong(f.get("fromBlock").asText().substring(2), 16), hi = Long.parseLong(f.get("toBlock").asText().substring(2), 16);
            List<Rewards.Log> in = new ArrayList<>();
            for (Rewards.Log l : logs) {
                long blk = Long.parseLong(l.blockNumber.substring(2), 16);
                if (blk >= lo && blk <= hi) in.add(l);
            }
            return ok(("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":" + Json.write(in) + "}").getBytes(StandardCharsets.UTF_8));
        });
        Rewards.Indexer idx = new Rewards.Indexer(new Rewards.MemoryStore(), "http://node", node);
        assertEquals(2, idx.scan(List.of(CC_CREATOR), block - 5, null, null, null));
        String want = "[[\"" + Rewards.TOPIC_MARKET_REWARDS_V4 + "\",\"" + Rewards.TOPIC_CREATOR_COIN_REWARDS + "\"]]";
        for (String t : asked) assertEquals(want, t);
    }
}
