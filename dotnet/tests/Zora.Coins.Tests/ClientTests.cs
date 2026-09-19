using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Xunit;
using Zora.Coins;
using Zora.Coins.Rewards;

namespace Zora.Coins.Tests;

/// <summary>Answers requests from a function, and records them.</summary>
sealed class FakeHandler : HttpMessageHandler
{
    private readonly Func<HttpRequestMessage, string?, HttpResponseMessage> _respond;
    public List<(HttpRequestMessage Request, string? Body)> Calls { get; } = new();
    public FakeHandler(Func<HttpRequestMessage, string?, HttpResponseMessage> respond) => _respond = respond;

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var body = request.Content is null ? null : await request.Content.ReadAsStringAsync(ct);
        Calls.Add((request, body));
        return _respond(request, body);
    }
}

public class ClientTests
{
    internal static string Fixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "..", "fixtures", name + ".json"));

    static HttpResponseMessage Json(string body, int status = 200, string? retryAfter = null)
    {
        var r = new HttpResponseMessage((HttpStatusCode)status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        if (retryAfter != null) r.Headers.TryAddWithoutValidation("Retry-After", retryAfter);
        return r;
    }

    static (ZoraCoinsClient, FakeHandler) Client(Func<HttpRequestMessage, string?, HttpResponseMessage> respond)
    {
        var h = new FakeHandler(respond);
        return (new ZoraCoinsClient(new ZoraCoinsClientOptions { ApiKey = "k", BaseUri = new Uri("http://zora.test"), HttpClient = new HttpClient(h), MaxRetries = 2 }), h);
    }

    static Dictionary<string, List<string>> Query(HttpRequestMessage r) =>
        (r.RequestUri!.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
            .Select(p => p.Split('=', 2)).GroupBy(p => Uri.UnescapeDataString(p[0]))
            .ToDictionary(g => g.Key, g => g.Select(p => Uri.UnescapeDataString(p[1])).ToList());

    [Fact]
    public async Task CoinDecodesARealResponse()
    {
        var (c, h) = Client((_, _) => Json(Fixture("coin")));
        var coin = await c.GetCoinAsync("0xabc");
        Assert.NotNull(coin?.Name);
        Assert.StartsWith("GraphQL", coin!.Typename);
        Assert.NotNull(coin.CreatorProfile?.Handle);
        Assert.Equal("8453", Query(h.Calls[0].Request)["chain"][0]);
        Assert.Equal("k", h.Calls[0].Request.Headers.GetValues("api-key").Single());
    }

    [Fact]
    public async Task MissingCoinIsNull()
    {
        var (c, _) = Client((_, _) => Json(Fixture("coin_missing")));
        Assert.Null(await c.GetCoinAsync("0xdead"));
    }

    [Fact]
    public async Task EnumerateFollowsCursorsAndStopsOnLastPage()
    {
        var p1 = Fixture("explore_page1");
        var p2 = JsonNode.Parse(Fixture("explore_page2"))!;
        p2["exploreList"]!["pageInfo"] = JsonNode.Parse("{\"hasNextPage\":false}");
        var (c, h) = Client((r, _) => Json(Query(r).ContainsKey("after") ? p2.ToJsonString() : p1));
        var all = new List<Zora20Token>();
        await foreach (var coin in c.EnumerateExploreAsync(ListType.TopVolume24h, new ExploreParams { PageSize = 2 })) all.Add(coin);
        Assert.Equal(4, all.Count);
        Assert.Equal(2, h.Calls.Count);
        Assert.Equal("2", Query(h.Calls[1].Request)["count"][0]);
    }

    [Fact]
    public async Task EnumerateStopsOnRepeatedCursorAndOnBreak()
    {
        var (c, h) = Client((_, _) => Json(Fixture("explore_page1")));
        var n = 0;
        await foreach (var _ in c.EnumerateExploreAsync(ListType.New)) n++;
        Assert.Equal(2, h.Calls.Count);
        var (c2, h2) = Client((_, _) => Json(Fixture("explore_page1")));
        await foreach (var _ in c2.EnumerateExploreAsync(ListType.New)) break;
        Assert.Single(h2.Calls);
    }

    [Fact]
    public async Task RetriesRateLimitThenSucceeds()
    {
        var i = 0;
        var (c, h) = Client((_, _) => ++i < 3 ? Json("{}", 429, "0") : Json(Fixture("token_info")));
        Assert.NotNull((await c.GetTokenInfoAsync(ZoraCoinsClient.UsdcAddress))?.Currency?.Symbol);
        Assert.Equal(3, h.Calls.Count);
    }

    [Fact]
    public async Task ErrorsCarryMessageRateLimitAndLiquidity()
    {
        var (limited, _) = Client((_, _) => Json("{\"error\":\"slow down\"}", 429, "0"));
        var e = await Assert.ThrowsAsync<ZoraApiException>(() => limited.GetProfileAsync("x"));
        Assert.True(e.IsRateLimited);
        Assert.Contains("slow down", e.Message);
        var (thin, h) = Client((_, _) => Json("{\"success\":\"false\",\"error\":\"not enough liquidity\",\"errorType\":\"LIQUIDITY\"}", 422));
        var q = await Assert.ThrowsAsync<ZoraApiException>(() => thin.QuoteTradeAsync(ZoraCoinsClient.Eth(), ZoraCoinsClient.Erc20("0xc"), "1", "0xme"));
        Assert.True(q.IsInsufficientLiquidity);
        Assert.Single(h.Calls);
    }

    [Fact]
    public async Task QueryEncoding()
    {
        var (c, h) = Client((_, _) => Json(Fixture("profile_balances")));
        var page = await c.GetProfileBalancesAsync("jacob", new ProfileBalancesParams
        {
            PageSize = 7, SortOption = SortOption.UsdValue, ExcludeHidden = false, ChainIds = new long[] { 8453, 7777777 },
        });
        var q = Query(h.Calls[0].Request);
        Assert.Equal(new[] { "8453", "7777777" }, q["chainIds"]);
        Assert.Equal("false", q["excludeHidden"][0]);
        Assert.Equal("USD_VALUE", q["sortOption"][0]);
        Assert.NotEmpty(page.Nodes());
        Assert.NotNull(page.NextCursor());
    }

    [Fact]
    public async Task CoinsSendsOneJsonParamPerCoin()
    {
        var (c, h) = Client((_, _) => Json(Fixture("coins")));
        Assert.Equal(2, (await c.GetCoinsByAddressAsync(new[] { "0xAAA", "0xbbb" })).Count);
        Assert.Equal("{\"chainId\":8453,\"collectionAddress\":\"0xaaa\"}", Query(h.Calls[0].Request)["coins"][0]);
    }

    [Fact]
    public async Task QuoteFillsDefaultsAndReadsStringBoolean()
    {
        var (c, h) = Client((_, _) => Json(Fixture("quote")));
        var q = await c.QuoteTradeAsync(ZoraCoinsClient.Eth(), ZoraCoinsClient.Erc20("0xc0"), "1000", "0xme", referrer: "0xapp");
        var body = JsonNode.Parse(h.Calls[0].Body!)!;
        Assert.Equal("0xme", (string?)body["recipient"]);
        Assert.Equal(8453, (long)body["chainId"]!);
        Assert.Equal("eth", (string?)body["tokenIn"]!["type"]);
        Assert.Null(body["tokenIn"]!["address"]);
        Assert.True(q.Success);
        Assert.StartsWith("0x", q.Call?.Data);
    }

    [Fact]
    public void UnknownEnumValuesSurvive()
    {
        var coin = JsonSerializer.Deserialize<Zora20Token>("{\"coinType\":\"SOMETHING_NEW\"}")!;
        Assert.Equal("SOMETHING_NEW", coin.CoinType?.Value);
        Assert.Equal("TOP_GAINERS", ListType.TopGainers.ToString());
    }

    [Fact]
    public async Task GraphQLReturnsDataAndThrowsOnErrors()
    {
        var coin = JsonNode.Parse(Fixture("coin"))!["zora20Token"]!.ToJsonString();
        var fail = false;
        var h = new FakeHandler((_, _) => Json(fail ? "{\"data\":null,\"errors\":[{\"message\":\"boom\"}]}" : "{\"data\":{\"coin\":" + coin + "}}"));
        var gql = new ZoraGraphQLClient(new Uri("http://gw/graphql"), new ZoraCoinsClientOptions { HttpClient = new HttpClient(h) });
        var data = await gql.QueryAsync<CoinData>("{ coin { name } }");
        Assert.NotNull(data?.Coin?.Name);
        fail = true;
        await Assert.ThrowsAsync<ZoraGraphQLException>(() => gql.QueryAsync<CoinData>("{ x }"));
    }

    sealed class CoinData
    {
        [System.Text.Json.Serialization.JsonPropertyName("coin")] public Zora20Token? Coin { get; set; }
    }
}

public class RewardsTests
{
    static List<RpcLog> Logs() => JsonSerializer.Deserialize<List<RpcLog>>(ClientTests.Fixture("rewards_v4_logs"))!;

    [Fact]
    public void DecodesARealV4Log()
    {
        var l = Logs()[0];
        var e = RewardsDecoder.Decode(l)!;
        Assert.Equal(4, e.Version);
        Assert.Equal("0x" + l.Data.Substring(2 + 2 * 64 + 24, 40), e.Payouts[Role.Creator].Recipient);
    }

    [Fact]
    public async Task ScansResumesAndShrinksChunks()
    {
        var logs = Logs();
        var first = RewardsDecoder.Decode(logs[0])!;
        var who = first.Payouts[Role.Creator].Recipient;
        var calls = 0;
        var node = new FakeHandler((_, body) =>
        {
            calls++;
            var req = JsonNode.Parse(body!)!;
            if ((string?)req["method"] == "eth_blockNumber") return Json("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":\"0x" + (first.Block + 500).ToString("x") + "\"}");
            var f = req["params"]![0]!;
            long lo = Convert.ToInt64((string)f["fromBlock"]!, 16), hi = Convert.ToInt64((string)f["toBlock"]!, 16);
            if (hi - lo + 1 > 700) return Json("{\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32600,\"message\":\"block range too large\"}}");
            var inRange = logs.Where(x => { var b = Convert.ToInt64(x.BlockNumber, 16); return b >= lo && b <= hi; });
            return Json("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":" + JsonSerializer.Serialize(inRange) + "}");
        });
        var idx = new RewardsIndexer(new MemoryStore(), new Uri("http://node"), new HttpClient(node));
        var n = await idx.ScanAsync(new[] { who.ToUpperInvariant().Replace("0X", "0x") }, fromBlock: first.Block - 1000);
        Assert.True(n > 0);
        Assert.Equal(n, idx.Store.EventsFor(new[] { who }).Count);
        var before = calls;
        Assert.Equal(0, await idx.ScanAsync(new[] { who }, fromBlock: first.Block - 1000));
        Assert.Equal(1, calls - before);
        var report = await RewardsReport.BuildAsync(idx.Store.EventsFor(new[] { who }), new[] { who }, null);
        Assert.Contains("Creator payouts", report.ToText());
        Assert.Equal("$0.0042", RewardsReport.FormatUsd(0.0042));
        Assert.Equal("$1,234.50", RewardsReport.FormatUsd(1234.5));
    }

    // Two real logs from one Base trade (tx 0x53f27c…f195): a CreatorCoinRewards payout for a creator coin and a
    // CoinMarketRewardsV4 payout for a content coin, both to the same creator.
    const string CcCreator = "0xf4acf3edc65df843630976459ab1349a88258e6d";
    static List<RpcLog> CreatorCoinLogs() => JsonSerializer.Deserialize<List<RpcLog>>(ClientTests.Fixture("creator_coin_rewards_logs"))!;

    [Fact]
    public void DecodesARealCreatorCoinRewardsLog()
    {
        var l = CreatorCoinLogs()[0];
        Assert.Equal(RewardsDecoder.TopicCreatorCoinRewards, l.Topics[0]);
        var e = RewardsDecoder.Decode(l)!;
        Assert.Equal(4, e.Version);
        Assert.Equal("0x3177fa60b8a342cd044badf34bf820c536094656", e.Coin);
        Assert.Equal("0x1111111111166b7fe7bd91427724b487980afc69", e.Currency);
        Assert.Equal(CcCreator, e.Payouts[Role.Creator].Recipient);
        Assert.Equal(System.Numerics.BigInteger.Parse("11879451646867555805"), e.Payouts[Role.Creator].Currency);
        Assert.Equal(e.Payouts[Role.Creator].Currency, e.Payouts[Role.Protocol].Currency);
        Assert.Equal(RewardsDecoder.ZeroAddress, e.Payouts[Role.PlatformReferrer].Recipient);
    }

    [Fact]
    public async Task ScansBothV4EventsAndRescansOldRangesOnce()
    {
        var logs = CreatorCoinLogs();
        var block = Convert.ToInt64(logs[0].BlockNumber, 16);
        var calls = 0;
        var asked = new List<string>();
        var node = new FakeHandler((_, body) =>
        {
            calls++;
            var req = JsonNode.Parse(body!)!;
            if ((string?)req["method"] == "eth_blockNumber") return Json("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":\"0x" + (block + 10).ToString("x") + "\"}");
            var f = req["params"]![0]!;
            asked.Add(f["topics"]!.ToJsonString());
            long lo = Convert.ToInt64((string)f["fromBlock"]!, 16), hi = Convert.ToInt64((string)f["toBlock"]!, 16);
            var inRange = logs.Where(x => { var b = Convert.ToInt64(x.BlockNumber, 16); return b >= lo && b <= hi; });
            return Json("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":" + JsonSerializer.Serialize(inRange) + "}");
        });
        var store = new MemoryStore();
        store.Save(new List<RewardEvent>(), new[] { CcCreator }, 4, block - 5, block + 10); // an earlier version's V4 scan
        var idx = new RewardsIndexer(store, new Uri("http://node"), new HttpClient(node));
        Assert.Equal(2, await idx.ScanAsync(new[] { CcCreator }, fromBlock: block - 5));
        Assert.All(asked, t => Assert.Equal($"[[\"{RewardsDecoder.TopicMarketRewardsV4}\",\"{RewardsDecoder.TopicCreatorCoinRewards}\"]]", t));
        var before = calls;
        Assert.Equal(0, await idx.ScanAsync(new[] { CcCreator }, fromBlock: block - 5));
        Assert.Equal(1, calls - before);
    }

    static HttpResponseMessage Json(string body) => new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
}

public class LiveTests
{
    const string FatVance = "0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b";
    static bool Live => Environment.GetEnvironmentVariable("LIVE") == "1";

    [Fact]
    public async Task EveryEndpointAgainstProduction()
    {
        if (!Live) return; // LIVE=1 dotnet test
        using var z = new ZoraCoinsClient();
        async Task Step(string name, Func<Task> f)
        {
            try { await f(); } catch (Exception e) { throw new Exception(name + ": " + e.Message, e); }
            await Task.Delay(350);
        }
        await Step("coin", async () => Assert.Equal("FATVANCE64", (await z.GetCoinAsync(FatVance))?.Name));
        await Step("coins", async () => Assert.Single(await z.GetCoinsByAddressAsync(new[] { FatVance })));
        await Step("coinHolders", () => z.GetCoinHoldersAsync(FatVance, new CoinHoldersParams { PageSize = 3 }));
        await Step("coinSwaps", () => z.GetCoinSwapsAsync(FatVance));
        await Step("coinComments", () => z.GetCoinCommentsAsync(FatVance));
        await Step("coinMergedComments", () => z.GetCoinMergedCommentsAsync(FatVance));
        await Step("coinPriceHistory", () => z.GetCoinPriceHistoryAsync(FatVance));
        await Step("coinsList", async () => Assert.NotEmpty((await z.GetCoinsListAsync(new CoinsListParams { PageSize = 3 })).Nodes()));
        await Step("tokenInfo", async () => Assert.NotNull(await z.GetTokenInfoAsync(ZoraCoinsClient.UsdcAddress)));
        await Step("explore", async () => Assert.NotEmpty((await z.ExploreAsync(ListType.TopGainers, new ExploreParams { PageSize = 3 })).Nodes()));
        await Step("enumerateExplore", async () =>
        {
            var n = 0;
            await foreach (var _ in z.EnumerateExploreAsync(ListType.TopVolume24h, new ExploreParams { PageSize = 2 })) if (++n == 5) break;
            Assert.Equal(5, n);
        });
        await Step("search", () => z.SearchAsync("zora", new SearchParams { PageSize = 3 }));
        await Step("trendsByName", () => z.GetTrendsByNameAsync("base"));
        await Step("traderLeaderboard", () => z.GetTraderLeaderboardAsync());
        await Step("featuredCreators", () => z.GetFeaturedCreatorsAsync());
        await Step("latestLiveStreams", () => z.GetLatestLiveStreamsAsync());
        await Step("topLiveStreams", () => z.GetTopLiveStreamsAsync());
        await Step("creatorLivestreamComments", () => z.GetCreatorLivestreamCommentsAsync(FatVance));
        await Step("profile", async () => Assert.Equal("rebelstudios", (await z.GetProfileAsync("rebelstudios"))?.Handle));
        await Step("profileCoins", () => z.GetProfileCoinsAsync("rebelstudios"));
        await Step("profileBalances", () => z.GetProfileBalancesAsync("rebelstudios"));
        await Step("profileSocial", () => z.GetProfileSocialAsync("rebelstudios"));
        await Step("walletTradeActivity", () => z.GetWalletTradeActivityAsync("rebelstudios"));
        await Step("creatorCoinPoolConfig", () => z.GetCreatorCoinPoolConfigAsync());
        await Step("contentCoinPoolConfig", () => z.GetContentCoinPoolConfigAsync(CurrencyType.Zora));
        await Step("quote", async () => Assert.True((await z.QuoteTradeAsync(ZoraCoinsClient.Eth(), ZoraCoinsClient.Erc20(FatVance), "1000000000000", "0x8E57BFDE053dBb6862991759c19affC5F383d5D0")).Success));
        await Step("missing coin", async () => Assert.Null(await z.GetCoinAsync("0x000000000000000000000000000000000000dead")));
    }
}
