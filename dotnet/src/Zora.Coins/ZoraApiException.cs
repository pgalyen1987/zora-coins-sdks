#nullable enable
using System;
using System.Net;

namespace Zora.Coins;

/// <summary>The Zora API answered with an HTTP error after retries were used up.</summary>
public sealed class ZoraApiException : Exception
{
    /// <summary>HTTP status.</summary>
    public HttpStatusCode StatusCode { get; }

    /// <summary>The endpoint, e.g. <c>/coin</c>.</summary>
    public string Path { get; }

    /// <summary>The API's machine-readable reason, where it gives one: /quote answers 422 with <c>LIQUIDITY</c>.</summary>
    public string? ErrorType { get; }

    /// <summary>The raw response body.</summary>
    public string Body { get; }

    /// <summary>Whether Zora refused the request for exceeding its rate limit. An API key raises it.</summary>
    public bool IsRateLimited => (int)StatusCode == 429;

    /// <summary>Whether a quote failed because the pool can't fill a trade that size. Try a smaller amount.</summary>
    public bool IsInsufficientLiquidity => ErrorType == "LIQUIDITY";

    internal ZoraApiException(HttpStatusCode status, string message, string path, string? errorType, string body)
        : base($"zora {path}: {(int)status} {message}")
    {
        StatusCode = status;
        Path = path;
        ErrorType = errorType;
        Body = body;
    }
}
