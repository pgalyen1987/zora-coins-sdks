#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Numerics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace Zora.Coins.Rewards;

/// <summary>Who a payout goes to.</summary>
public enum Role
{
    /// <summary>The coin's payout recipient.</summary>
    Creator,
    /// <summary>The app that launched the coin.</summary>
    PlatformReferrer,
    /// <summary>The interface that routed the trade.</summary>
    TradeReferrer,
    /// <summary>Zora's protocol fee.</summary>
    Protocol,
    /// <summary>Doppler's share.</summary>
    Doppler,
}

/// <summary>What one role received in one event: Currency in the event's currency, Coin in the traded coin.</summary>
public sealed record Payout(string Recipient, BigInteger Currency, BigInteger Coin);

/// <summary>One reward distribution. Amounts are exact integers in the token's smallest unit.</summary>
public sealed record RewardEvent(long Block, string TxHash, long LogIndex, string Emitter, int Version, string Coin, string Currency,
    IReadOnlyDictionary<Role, Payout> Payouts)
{
    /// <summary>Unix time of the event's block (Base makes a block every 2 seconds).</summary>
    public long Timestamp => RewardsDecoder.BaseGenesisTimestamp + 2 * Block;

    internal string Key => TxHash + ":" + LogIndex.ToString(CultureInfo.InvariantCulture);

    internal bool Pays(ISet<string> addresses) => Payouts.Values.Any(p => p.Recipient != RewardsDecoder.ZeroAddress && addresses.Contains(p.Recipient));
}

/// <summary>An eth_getLogs entry, as JSON-RPC returns it.</summary>
public sealed class RpcLog
{
    /// <summary>Emitting contract.</summary>
    [JsonPropertyName("address")] public string Address { get; set; } = "";
    /// <summary>Indexed topics; the first is the event signature.</summary>
    [JsonPropertyName("topics")] public List<string> Topics { get; set; } = new();
    /// <summary>Non-indexed data (0x hex).</summary>
    [JsonPropertyName("data")] public string Data { get; set; } = "0x";
    /// <summary>Block number (0x hex).</summary>
    [JsonPropertyName("blockNumber")] public string BlockNumber { get; set; } = "0x0";
    /// <summary>Transaction hash.</summary>
    [JsonPropertyName("transactionHash")] public string TransactionHash { get; set; } = "";
    /// <summary>Log index (0x hex).</summary>
    [JsonPropertyName("logIndex")] public string LogIndex { get; set; } = "0x0";
}

/// <summary>Decodes Zora reward events. No web3 dependency.</summary>
public static class RewardsDecoder
{
    /// <summary>keccak256 of CoinMarketRewardsV4(address,address,address,address,address,address,address,(uint256×10)).</summary>
    public const string TopicMarketRewardsV4 = "0x35b5031218696db1dfd903223a47f38e66a1998e14a942a5d60fddaa49a685fc";
    /// <summary>keccak256 of CoinTradeRewards(address,address,address,address,uint256,uint256,uint256,uint256,address).</summary>
    public const string TopicTradeRewardsV3 = "0x6b67f906562afcdc3afeeeb6754e906cc24d9ce090e9db1b7b68e6462682d966";
    /// <summary>"Nobody" in a recipient field; native ETH as a currency.</summary>
    public const string ZeroAddress = "0x0000000000000000000000000000000000000000";
    /// <summary>Unix time of Base's genesis block.</summary>
    public const long BaseGenesisTimestamp = 1686789347;

    private static string Word(string data, int i) => data.Length >= 2 + (i + 1) * 64 ? data.Substring(2 + i * 64, 64) : "";
    private static string Addr(string word) => word.Length >= 40 ? "0x" + word.Substring(word.Length - 40).ToLowerInvariant() : ZeroAddress;
    private static BigInteger Uint(string word) => word.Length == 0 ? BigInteger.Zero : BigInteger.Parse("0" + word, NumberStyles.HexNumber, CultureInfo.InvariantCulture);
    internal static long Hex(string s) => long.Parse(s.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ? s.Substring(2) : s, NumberStyles.HexNumber, CultureInfo.InvariantCulture);

    /// <summary>Left-pad an address to a 32-byte topic, for filtering indexed V3 fields.</summary>
    public static string AddressTopic(string address) => "0x" + new string('0', 24) + address.ToLowerInvariant().Replace("0x", "");

    /// <summary>Decode a log, or null if it isn't a Zora reward event.</summary>
    public static RewardEvent? Decode(RpcLog log)
    {
        if (log.Topics.Count == 0) return null;
        var t0 = log.Topics[0].ToLowerInvariant();
        var words = (log.Data.Length - 2) / 64;
        var block = Hex(log.BlockNumber);
        var index = Hex(log.LogIndex);
        var emitter = log.Address.ToLowerInvariant();
        string W(int i) => Word(log.Data, i);
        if (t0 == TopicMarketRewardsV4 && words >= 17)
        {
            Payout P(int r, int c) => new(Addr(W(r)), Uint(W(c)), Uint(W(c + 1)));
            return new RewardEvent(block, log.TransactionHash.ToLowerInvariant(), index, emitter, 4, Addr(W(0)), Addr(W(1)),
                new Dictionary<Role, Payout>
                {
                    [Role.Creator] = P(2, 7), [Role.PlatformReferrer] = P(3, 9), [Role.TradeReferrer] = P(4, 11),
                    [Role.Protocol] = P(5, 13), [Role.Doppler] = P(6, 15),
                });
        }
        if (t0 == TopicTradeRewardsV3 && log.Topics.Count >= 4 && words >= 6)
        {
            string T(int i) => Addr(log.Topics[i].Replace("0x", ""));
            return new RewardEvent(block, log.TransactionHash.ToLowerInvariant(), index, emitter, 3, emitter, Addr(W(5)),
                new Dictionary<Role, Payout>
                {
                    [Role.Creator] = new(T(1), Uint(W(1)), 0), [Role.PlatformReferrer] = new(T(2), Uint(W(2)), 0),
                    [Role.TradeReferrer] = new(T(3), Uint(W(3)), 0), [Role.Protocol] = new(Addr(W(0)), Uint(W(4)), 0),
                    [Role.Doppler] = new(ZeroAddress, 0, 0),
                });
        }
        return null;
    }
}

/// <summary>Keeps indexed events and the block ranges scanned per address, in memory. Thread-safe.</summary>
public sealed class MemoryStore
{
    private readonly Dictionary<string, RewardEvent> _events = new();
    private readonly Dictionary<string, List<(long From, long To)>> _scans = new();

    /// <summary>Store events and record that [from, to] was scanned for the addresses.</summary>
    public void Save(IEnumerable<RewardEvent> events, IEnumerable<string> addresses, int version, long from, long to)
    {
        lock (_events)
        {
            foreach (var e in events) _events[e.Key] = e;
            foreach (var a in addresses)
            {
                var k = a.ToLowerInvariant() + "@v" + version;
                if (!_scans.TryGetValue(k, out var list)) _scans[k] = list = new();
                list.Add((from, to));
                _scans[k] = Ranges.Merge(list);
            }
        }
    }

    /// <summary>Merged ranges already scanned for an address.</summary>
    public IReadOnlyList<(long From, long To)> Scanned(string address, int version)
    {
        lock (_events) return _scans.TryGetValue(address.ToLowerInvariant() + "@v" + version, out var l) ? l.ToList() : new List<(long, long)>();
    }

    /// <summary>Stored events paying any of the addresses, from <paramref name="sinceBlock"/>, oldest first.</summary>
    public IReadOnlyList<RewardEvent> EventsFor(IEnumerable<string> addresses, long sinceBlock = 0)
    {
        var watch = new HashSet<string>(addresses.Select(a => a.ToLowerInvariant()));
        lock (_events) return _events.Values.Where(e => e.Block >= sinceBlock && e.Pays(watch)).OrderBy(e => e.Block).ThenBy(e => e.LogIndex).ToList();
    }
}

internal static class Ranges
{
    public static List<(long, long)> Merge(IEnumerable<(long From, long To)> ranges)
    {
        var outList = new List<(long From, long To)>();
        foreach (var r in ranges.OrderBy(r => r.From))
        {
            if (outList.Count > 0 && r.From <= outList[outList.Count - 1].To + 1)
                outList[outList.Count - 1] = (outList[outList.Count - 1].From, Math.Max(outList[outList.Count - 1].To, r.To));
            else outList.Add(r);
        }
        return outList.Select(x => (x.From, x.To)).ToList();
    }

    public static List<(long, long)> Missing(long lo, long hi, IEnumerable<(long From, long To)> have)
    {
        var gaps = new List<(long, long)>();
        var cur = lo;
        foreach (var (a, b) in Merge(have))
        {
            if (b < cur || a > hi) continue;
            if (a > cur) gaps.Add((cur, a - 1));
            cur = Math.Max(cur, b + 1);
        }
        if (cur <= hi) gaps.Add((cur, hi));
        return gaps;
    }
}

/// <summary>A JSON-RPC node refused a call.</summary>
public sealed class RpcException : Exception
{
    /// <summary>JSON-RPC error code (or HTTP status).</summary>
    public long Code { get; }

    internal RpcException(string method, long code, string message) : base($"rpc {method}: {code} {message}") => Code = code;
}

/// <summary>
/// Finds the rewards Zora paid to a set of addresses, straight from Base. V4 reward events aren't indexed by
/// recipient, so every event in a block range is read and filtered; ranges already scanned are skipped.
/// </summary>
public sealed class RewardsIndexer
{
    /// <summary>Base's public JSON-RPC endpoint. A private RPC is much faster for long histories.</summary>
    public const string DefaultRpc = "https://mainnet.base.org";
    /// <summary>No CoinMarketRewardsV4 events exist before this block (2025-06-01).</summary>
    public const long V4FirstBlock = 31_000_000;

    private readonly HttpClient _http;
    private readonly Uri _rpc;

    /// <summary>Where events go.</summary>
    public MemoryStore Store { get; }

    /// <summary>Blocks per eth_getLogs (halved automatically when a node refuses a range).</summary>
    public long Step { get; set; } = 2000;

    /// <summary>An indexer reading <paramref name="rpc"/> (Base's public RPC by default).</summary>
    public RewardsIndexer(MemoryStore store, Uri? rpc = null, HttpClient? http = null)
    {
        Store = store;
        _rpc = rpc ?? new Uri(DefaultRpc);
        _http = http ?? new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
    }

    /// <summary>Index rewards paid to <paramref name="addresses"/>; returns how many new matching events were stored.</summary>
    public async Task<int> ScanAsync(IEnumerable<string> addresses, long? fromBlock = null, double? days = null, long? toBlock = null,
        IProgress<(long Done, long Total, int Found)>? progress = null, CancellationToken cancellationToken = default)
    {
        var addrs = addresses.Select(a => a.ToLowerInvariant()).Distinct().OrderBy(a => a, StringComparer.Ordinal).ToList();
        if (addrs.Count == 0) throw new ArgumentException("no addresses to scan", nameof(addresses));
        foreach (var a in addrs) if (a.Length != 42 || !a.StartsWith("0x", StringComparison.Ordinal)) throw new ArgumentException($"{a} is not an address", nameof(addresses));
        var head = toBlock ?? await HeadAsync(cancellationToken).ConfigureAwait(false);
        var start = fromBlock ?? (days is { } d ? Math.Max(0, (DateTimeOffset.UtcNow.ToUnixTimeSeconds() - (long)(d * 86400) - RewardsDecoder.BaseGenesisTimestamp) / 2) : 0);
        var lo = Math.Max(start, V4FirstBlock);
        var plan = lo > head ? new List<(long, long)>() : Ranges.Merge(addrs.SelectMany(a => Ranges.Missing(lo, head, Store.Scanned(a, 4))));
        long total = plan.Sum(p => p.Item2 - p.Item1 + 1), done = 0;
        var found = 0;
        var watch = new HashSet<string>(addrs);
        foreach (var (a, b) in plan)
        {
            var step = Step;
            for (var from = a; from <= b;)
            {
                var to = Math.Min(from + step - 1, b);
                List<RewardEvent> events;
                try
                {
                    events = await FetchAsync(from, to, cancellationToken).ConfigureAwait(false);
                }
                catch (RpcException ex) when (TooLarge(ex.Message) && step > 50)
                {
                    step /= 2; // this node caps log ranges or result sizes: retry the chunk smaller
                    continue;
                }
                var mine = events.Where(e => e.Pays(watch)).ToList();
                Store.Save(mine, addrs, 4, from, to);
                found += mine.Count;
                done += to - from + 1;
                progress?.Report((done, total, found));
                from = to + 1;
            }
        }
        return found;
    }

    private static bool TooLarge(string message)
    {
        var m = message.ToLowerInvariant();
        return !m.Contains("rate") && new[] { "range", "too many", "limit exceeded", "10000 results", "response size" }.Any(m.Contains);
    }

    /// <summary>The latest block number.</summary>
    public async Task<long> HeadAsync(CancellationToken cancellationToken = default) =>
        RewardsDecoder.Hex((await CallAsync("eth_blockNumber", Array.Empty<object>(), cancellationToken).ConfigureAwait(false)).GetString()!);

    private async Task<List<RewardEvent>> FetchAsync(long lo, long hi, CancellationToken ct)
    {
        var filter = new Dictionary<string, object> { ["fromBlock"] = "0x" + lo.ToString("x", CultureInfo.InvariantCulture), ["toBlock"] = "0x" + hi.ToString("x", CultureInfo.InvariantCulture), ["topics"] = new[] { RewardsDecoder.TopicMarketRewardsV4 } };
        var result = await CallAsync("eth_getLogs", new object[] { filter }, ct).ConfigureAwait(false);
        var logs = result.Deserialize<List<RpcLog>>() ?? new List<RpcLog>();
        return logs.Select(RewardsDecoder.Decode).Where(e => e is not null).Select(e => e!).GroupBy(e => e.Key).Select(g => g.First()).ToList();
    }

    private async Task<JsonElement> CallAsync(string method, object[] parameters, CancellationToken ct)
    {
        var body = JsonSerializer.Serialize(new { jsonrpc = "2.0", id = 1, method, @params = parameters });
        Exception? last = null;
        for (var attempt = 0; attempt <= 5; attempt++)
        {
            if (attempt > 0) await Task.Delay(TimeSpan.FromSeconds(Math.Min(1 << attempt, 20)), ct).ConfigureAwait(false);
            HttpResponseMessage resp;
            try
            {
                resp = await _http.PostAsync(_rpc, new StringContent(body, Encoding.UTF8, "application/json"), ct).ConfigureAwait(false);
            }
            catch (HttpRequestException ex)
            {
                last = ex;
                continue;
            }
            using (resp)
            {
                var status = (int)resp.StatusCode;
                if (status == 429 || status >= 500)
                {
                    last = new RpcException(method, status, "HTTP " + status);
                    continue;
                }
                using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync().ConfigureAwait(false));
                if (doc.RootElement.TryGetProperty("error", out var err))
                {
                    var msg = err.TryGetProperty("message", out var m) ? m.GetString() ?? "" : "";
                    var ex = new RpcException(method, err.TryGetProperty("code", out var c) ? c.GetInt64() : 0, msg);
                    if (msg.IndexOf("rate", StringComparison.OrdinalIgnoreCase) >= 0 || msg.IndexOf("timeout", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        last = ex;
                        continue;
                    }
                    throw ex;
                }
                return doc.RootElement.GetProperty("result").Clone();
            }
        }
        throw last ?? new RpcException(method, 0, "no answer");
    }
}

/// <summary>What one role earned in one token.</summary>
public sealed record RewardLine(Role Role, string Token, string Symbol, BigInteger Raw, double Amount, double? Usd, int Payouts);

/// <summary>What a set of addresses earned. USD uses current prices from the Zora API, not prices at payout time.</summary>
public sealed record RewardsReport(IReadOnlyList<string> Addresses, int Events, long? FirstBlock, long? LastBlock, IReadOnlyList<RewardLine> Lines)
{
    /// <summary>Sum of every priced line, in USD.</summary>
    public double TotalUsd => Lines.Sum(l => l.Usd ?? 0);

    private static readonly Dictionary<Role, string> Labels = new()
    {
        [Role.Creator] = "Creator payouts", [Role.PlatformReferrer] = "Platform referral", [Role.TradeReferrer] = "Trade referral",
        [Role.Protocol] = "Protocol", [Role.Doppler] = "Doppler",
    };

    /// <summary>$1,234.56, or $0.0042 below a cent.</summary>
    public static string FormatUsd(double x) =>
        Math.Abs(x) >= 0.01 || x == 0 ? "$" + x.ToString("N2", CultureInfo.InvariantCulture) : "$" + x.ToString("G4", CultureInfo.InvariantCulture);

    /// <summary>A plain-text table.</summary>
    public string ToText()
    {
        var sb = new StringBuilder();
        sb.Append("Zora rewards for ").AppendLine(string.Join(", ", Addresses));
        sb.Append(Events).Append(" reward events");
        if (FirstBlock is { } a && LastBlock is { } b) sb.Append(", blocks ").Append(a).Append('–').Append(b);
        sb.AppendLine();
        foreach (var l in Lines)
        {
            var amount = Math.Abs(l.Amount) >= 1 ? l.Amount.ToString("N4", CultureInfo.InvariantCulture)
                : l.Amount.ToString("G6", CultureInfo.InvariantCulture).Replace("E", "e"); // 9.38878e-09, as the other SDKs print
            sb.AppendLine($"  {Labels[l.Role],-18} {amount,16} {l.Symbol,-12} {(l.Usd is { } u ? FormatUsd(u) : "—"),12}  ({l.Payouts} payouts)");
        }
        sb.AppendLine($"  {"Total (current prices)",-18} {"",16} {"",-12} {FormatUsd(TotalUsd),12}");
        return sb.ToString();
    }

    /// <summary>Sum what <paramref name="addresses"/> earned in <paramref name="events"/>, priced with <paramref name="client"/> (null skips pricing).</summary>
    public static async Task<RewardsReport> BuildAsync(IReadOnlyList<RewardEvent> events, IEnumerable<string> addresses, ZoraCoinsClient? client,
        CancellationToken cancellationToken = default)
    {
        var watch = new HashSet<string>(addresses.Select(a => a.ToLowerInvariant()));
        var sums = new SortedDictionary<(Role, string), (BigInteger Raw, int N)>();
        foreach (var e in events)
            foreach (var (role, p) in e.Payouts)
            {
                if (!watch.Contains(p.Recipient)) continue;
                foreach (var (token, raw) in new[] { (e.Currency, p.Currency), (string.IsNullOrEmpty(e.Coin) ? RewardsDecoder.ZeroAddress : e.Coin, p.Coin) })
                {
                    if (raw <= 0) continue;
                    sums.TryGetValue((role, token), out var cur);
                    sums[(role, token)] = (cur.Raw + raw, cur.N + 1);
                }
            }
        var meta = new Dictionary<string, (string Symbol, int Decimals, double? Price)>();
        foreach (var token in sums.Keys.Select(k => k.Item2).Distinct())
            meta[token] = await TokenMetaAsync(client, token, cancellationToken).ConfigureAwait(false);
        var lines = sums.Select(kv =>
        {
            var (sym, dec, price) = meta[kv.Key.Item2];
            var amount = (double)kv.Value.Raw / Math.Pow(10, dec);
            return new RewardLine(kv.Key.Item1, kv.Key.Item2, sym, kv.Value.Raw, amount, price * amount, kv.Value.N);
        }).ToList();
        var blocks = events.Select(e => e.Block).ToList();
        return new RewardsReport(watch.OrderBy(a => a, StringComparer.Ordinal).ToList(), events.Count,
            blocks.Count > 0 ? blocks.Min() : null, blocks.Count > 0 ? blocks.Max() : null, lines);
    }

    private static async Task<(string, int, double?)> TokenMetaAsync(ZoraCoinsClient? client, string address, CancellationToken ct)
    {
        var isEth = address == RewardsDecoder.ZeroAddress;
        (string, int, double?) fallback = isEth ? ("ETH", 18, null) : address == ZoraCoinsClient.UsdcAddress ? ("USDC", 6, 1.0) : (address.Substring(0, 8) + "…", 18, null);
        if (client is null) return fallback;
        try
        {
            var cur = (await client.GetTokenInfoAsync(isEth ? ZoraCoinsClient.WethAddress : address, null, ct).ConfigureAwait(false))?.Currency;
            if (cur is null) return fallback;
            double? price = double.TryParse(cur.PriceUsd, NumberStyles.Float, CultureInfo.InvariantCulture, out var p) ? p : null;
            return (isEth ? "ETH" : cur.Symbol ?? fallback.Item1, (int)(cur.Decimals ?? 18), price);
        }
        catch (ZoraApiException)
        {
            return fallback;
        }
    }
}
