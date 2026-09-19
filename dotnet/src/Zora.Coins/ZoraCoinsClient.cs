#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Zora.Coins;

/// <summary>Options for <see cref="ZoraCoinsClient"/> and <see cref="ZoraGraphQLClient"/>.</summary>
public sealed class ZoraCoinsClientOptions
{
    /// <summary>
    /// API key sent as the <c>api-key</c> header. Without one Zora's rate limits are much lower. Create one at
    /// https://zora.co/settings/developer. Defaults to the ZORA_API_KEY environment variable.
    /// </summary>
    public string? ApiKey { get; set; }

    /// <summary>Another deployment (staging, a mock server in tests). Default: Zora's production API.</summary>
    public Uri BaseUri { get; set; } = new(ZoraCoinsClient.DefaultBaseUrl);

    /// <summary>Retries for rate limits (429) and server errors (5xx). Default 3.</summary>
    public int MaxRetries { get; set; } = 3;

    /// <summary>Prefix for the User-Agent header, so Zora can tell your app's traffic apart.</summary>
    public string? UserAgent { get; set; }

    /// <summary>Your own HttpClient (proxies, handlers, timeouts). The client does not dispose it.</summary>
    public HttpClient? HttpClient { get; set; }
}

/// <summary>
/// Client for the Zora Coins API: one method per endpoint (GetCoinAsync, GetCoinHoldersAsync, ExploreAsync, …) and an
/// Enumerate…Async for every paginated one. Thread-safe; create one and reuse it.
/// </summary>
/// <remarks>
/// Rate limits and server errors are retried with backoff, honouring Retry-After. What's left throws a
/// <see cref="ZoraApiException"/>. Lookups that find nothing return null. Unofficial; not affiliated with Zora.
/// </remarks>
public sealed partial class ZoraCoinsClient : IDisposable
{
    /// <summary>Zora's production REST API.</summary>
    public const string DefaultBaseUrl = "https://api-sdk.zora.engineering";

    /// <summary>Base mainnet, where Zora coins live. Every call defaults to it.</summary>
    public const long BaseChainId = 8453;

    /// <summary>WETH on Base.</summary>
    public const string WethAddress = "0x4200000000000000000000000000000000000006";

    /// <summary>USDC on Base.</summary>
    public const string UsdcAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

    /// <summary>The ZORA token on Base.</summary>
    public const string ZoraAddress = "0x1111111111166b7fe7bd91427724b487980afc69";

    internal const string Version = "0.1.1";

    private static readonly Random Jitter = new();
    private readonly HttpClient _http;
    private readonly bool _ownsHttp;
    private readonly string _baseUrl;
    private readonly string? _apiKey;
    private readonly int _maxRetries;
    private readonly string _userAgent;

    /// <summary>A client with default options (reads ZORA_API_KEY).</summary>
    public ZoraCoinsClient() : this(new ZoraCoinsClientOptions()) { }

    /// <summary>A client with the given options.</summary>
    public ZoraCoinsClient(ZoraCoinsClientOptions options)
    {
        _ownsHttp = options.HttpClient is null;
        _http = options.HttpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        _baseUrl = options.BaseUri.ToString().TrimEnd('/');
        _apiKey = options.ApiKey ?? Environment.GetEnvironmentVariable("ZORA_API_KEY");
        _maxRetries = options.MaxRetries;
        _userAgent = (options.UserAgent is null ? "" : options.UserAgent + " ") + "zora-coins-dotnet/" + Version;
    }

    /// <summary>Native ETH as a trade input or output.</summary>
    public static TokenSpecInput Eth() => new() { Type = TokenType.Eth };

    /// <summary>An ERC-20 (a Zora coin, ZORA, USDC…) as a trade input or output.</summary>
    public static TokenSpecInput Erc20(string address) => new() { Type = TokenType.Erc20, Address = address };

    /// <summary>Several coins on Base by contract address, in one request.</summary>
    public Task<IReadOnlyList<Zora20Token>> GetCoinsByAddressAsync(IEnumerable<string> addresses, CancellationToken cancellationToken = default) =>
        GetCoinsAsync(addresses.Select(a => new CoinRefInput { ChainId = BaseChainId, CollectionAddress = a.ToLowerInvariant() }), cancellationToken);

    /// <summary>
    /// <see cref="QuoteAsync"/> with the usual defaults: the recipient is the sender, slippage 5%, chain Base.
    /// <paramref name="amountIn"/> is in the input token's smallest unit (wei for ETH). Nothing is signed or sent: give
    /// the result's Call (Target, Data, Value) to your wallet.
    /// </summary>
    public Task<QuoteResponse> QuoteTradeAsync(TokenSpecInput tokenIn, TokenSpecInput tokenOut, string amountIn, string sender,
        string? referrer = null, double slippage = 0.05, CancellationToken cancellationToken = default) =>
        QuoteAsync(new QuoteRequest
        {
            TokenIn = tokenIn, TokenOut = tokenOut, AmountIn = amountIn, Sender = sender, Recipient = sender,
            Slippage = slippage, ChainId = BaseChainId, Referrer = referrer,
        }, cancellationToken);

    /// <summary>
    /// Send one request and deserialize the JSON response. The generated methods are built on this; call it directly
    /// only for an endpoint the SDK doesn't wrap yet.
    /// </summary>
    public async Task<T?> SendAsync<T>(string method, string path, IEnumerable<KeyValuePair<string, string>> query, object? body,
        CancellationToken cancellationToken = default)
    {
        var qs = string.Join("&", query.Select(kv => Uri.EscapeDataString(kv.Key) + "=" + Uri.EscapeDataString(kv.Value)));
        var url = _baseUrl + path + (qs.Length > 0 ? "?" + qs : "");
        var payload = body is null ? null : JsonSerializer.Serialize(body, body.GetType(), Json.Options);
        for (var attempt = 0; ; attempt++)
        {
            using var req = new HttpRequestMessage(new HttpMethod(method), url);
            req.Headers.TryAddWithoutValidation("accept", "application/json");
            req.Headers.TryAddWithoutValidation("user-agent", _userAgent);
            if (!string.IsNullOrEmpty(_apiKey)) req.Headers.TryAddWithoutValidation("api-key", _apiKey);
            if (payload is not null) req.Content = new StringContent(payload, Encoding.UTF8, "application/json");
            HttpResponseMessage resp;
            try
            {
                resp = await _http.SendAsync(req, cancellationToken).ConfigureAwait(false);
            }
            catch (HttpRequestException) when (attempt < _maxRetries && !cancellationToken.IsCancellationRequested)
            {
                await Task.Delay(Backoff(attempt, null), cancellationToken).ConfigureAwait(false);
                continue;
            }
            using (resp)
            {
                var status = (int)resp.StatusCode;
                if ((status == 429 || status >= 500 && status != 501) && attempt < _maxRetries)
                {
                    await Task.Delay(Backoff(attempt, resp.Headers.RetryAfter?.Delta), cancellationToken).ConfigureAwait(false);
                    continue;
                }
                var text = await resp.Content.ReadAsStringAsync().ConfigureAwait(false);
                if (status >= 400) throw ApiError(resp.StatusCode, path, text);
                return string.IsNullOrEmpty(text) ? default : JsonSerializer.Deserialize<T>(text, Json.Options);
            }
        }
    }

    private static TimeSpan Backoff(int attempt, TimeSpan? retryAfter)
    {
        if (retryAfter is { } ra) return ra > TimeSpan.FromSeconds(30) ? TimeSpan.FromSeconds(30) : ra;
        int jitter;
        lock (Jitter) jitter = Jitter.Next(250);
        return TimeSpan.FromMilliseconds(Math.Min(1 << attempt, 16) * 500 + jitter);
    }

    private static ZoraApiException ApiError(HttpStatusCode status, string path, string body)
    {
        string message = status.ToString();
        string? errorType = null;
        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            if (root.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String) message = m.GetString()!;
            else if (root.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.String) message = e.GetString()!;
            if (root.TryGetProperty("errorType", out var t) && t.ValueKind == JsonValueKind.String) errorType = t.GetString();
        }
        catch (JsonException)
        {
            if (body.Length > 0) message = body.Length > 300 ? body.Substring(0, 300) : body;
        }
        return new ZoraApiException(status, message, path, errorType, body);
    }

    private static string Format(object? v) => v switch
    {
        null => "",
        bool b => b ? "true" : "false",
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        IExtensibleEnum e => e.Value,
        _ => v.ToString() ?? "",
    };

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_ownsHttp) _http.Dispose();
    }
}
