#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Zora.Coins;

/// <summary>One entry of a GraphQL response's errors array.</summary>
public sealed class GraphQLError
{
    /// <summary>What went wrong.</summary>
    [System.Text.Json.Serialization.JsonPropertyName("message")]
    public string Message { get; set; } = "";
}

/// <summary>The gateway answered with GraphQL errors.</summary>
public sealed class ZoraGraphQLException : Exception
{
    /// <summary>The errors.</summary>
    public IReadOnlyList<GraphQLError> Errors { get; }

    internal ZoraGraphQLException(IReadOnlyList<GraphQLError> errors)
        : base("zora graphql: " + string.Join("; ", errors.Select(e => e.Message))) => Errors = errors;
}

/// <summary>
/// Client for the zora-coins GraphQL gateway: the whole Zora Coins API as one schema, so a screen's worth of data is one
/// request selecting exactly the fields it needs. Results deserialize into the same types as the REST client.
/// </summary>
/// <example>
/// <code>
/// var gql = new ZoraGraphQLClient(new Uri("http://localhost:8080/graphql"));
/// var data = await gql.QueryAsync&lt;CoinData&gt;("query($a: String!) { coin(address: $a) { name marketCap } }", new { a = "0x…" });
/// record CoinData(Zora20Token? Coin);
/// </code>
/// </example>
public sealed class ZoraGraphQLClient : IDisposable
{
    private readonly ZoraCoinsClient _client;

    /// <summary>A client for the gateway at <paramref name="endpoint"/>. Reads ZORA_API_KEY; the gateway forwards it.</summary>
    public ZoraGraphQLClient(Uri endpoint, ZoraCoinsClientOptions? options = null)
    {
        options ??= new ZoraCoinsClientOptions();
        options.BaseUri = endpoint;
        _client = new ZoraCoinsClient(options);
    }

    private sealed class Envelope<T>
    {
        [System.Text.Json.Serialization.JsonPropertyName("data")]
        public T? Data { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("errors")]
        public List<GraphQLError>? Errors { get; set; }
    }

    /// <summary>Run a query and deserialize its data. Throws <see cref="ZoraGraphQLException"/> if the gateway reports errors.</summary>
    public async Task<T?> QueryAsync<T>(string query, object? variables = null, CancellationToken cancellationToken = default)
    {
        var env = await _client.SendAsync<Envelope<T>>("POST", "", Array.Empty<KeyValuePair<string, string>>(),
            new Dictionary<string, object?> { ["query"] = query, ["variables"] = variables ?? new Dictionary<string, object?>() }, cancellationToken).ConfigureAwait(false);
        if (env?.Errors is { Count: > 0 } errors) throw new ZoraGraphQLException(errors);
        return env is null ? default : env.Data;
    }

    /// <inheritdoc/>
    public void Dispose() => _client.Dispose();
}
