using System.Text.Json.Serialization;

namespace Volt.Bridge.Core.Wire;

/// <summary>One materialized library-signature file: a workspace-relative path (with kind extension) and its ST
/// declaration text. Shipped in <see cref="FetchResponse.LibrarySignatures"/> when a fetch sets <c>verbose</c>;
/// the client writes it verbatim, exactly like a fetched item.</summary>
public sealed class LibSymbolItem
{
    [JsonPropertyName("path")] public string Path { get; set; } = "";
    [JsonPropertyName("content")] public string Content { get; set; } = "";
}
