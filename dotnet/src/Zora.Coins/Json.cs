#nullable enable
using System;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Zora.Coins;

/// <summary>A string-backed enum that keeps values this SDK doesn't know yet.</summary>
public interface IExtensibleEnum
{
    /// <summary>The value as the API spells it.</summary>
    string Value { get; }
}

/// <summary>Reads and writes extensible enums as JSON strings.</summary>
public sealed class ExtensibleEnumConverter<T> : JsonConverter<T> where T : struct, IExtensibleEnum
{
    /// <inheritdoc/>
    public override T Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        (T)Activator.CreateInstance(typeof(T), reader.GetString() ?? string.Empty)!;

    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, T value, JsonSerializerOptions options)
    {
        if (value.Value is null) writer.WriteNullValue();
        else writer.WriteStringValue(value.Value);
    }
}

/// <summary>A boolean the API may send as a string: /quote returns "success": "true".</summary>
public sealed class FlexBoolConverter : JsonConverter<bool?>
{
    /// <inheritdoc/>
    public override bool? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) => reader.TokenType switch
    {
        JsonTokenType.True => true,
        JsonTokenType.False => false,
        JsonTokenType.Null => null,
        JsonTokenType.String => bool.TryParse(reader.GetString(), out var b) ? b : throw new JsonException($"'{reader.GetString()}' is not a boolean"),
        _ => throw new JsonException("expected a boolean"),
    };

    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, bool? value, JsonSerializerOptions options)
    {
        if (value is null) writer.WriteNullValue();
        else writer.WriteBooleanValue(value.Value);
    }
}

internal static class Json
{
    public static readonly JsonSerializerOptions Options = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNameCaseInsensitive = false,
    };
}
