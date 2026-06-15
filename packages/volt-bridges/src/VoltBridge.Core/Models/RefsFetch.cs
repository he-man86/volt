using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace VoltBridge.Core.Models;

public class RefsResponse
{
    [JsonPropertyName("projectVersion")]
    public string ProjectVersion { get; set; } = "";

    [JsonPropertyName("structureVersion")]
    public string StructureVersion { get; set; } = "";

    [JsonPropertyName("items")]
    public Dictionary<string, string> Items { get; set; } = new();

    [JsonPropertyName("kinds")]
    public Dictionary<string, string>? Kinds { get; set; }

    [JsonPropertyName("folders")]
    public Dictionary<string, string> Folders { get; set; } = new();
}

public class FetchRequest
{
    [JsonPropertyName("knownItems")]
    public Dictionary<string, string>? KnownItems { get; set; }

    [JsonPropertyName("onlyItems")]
    public List<string>? OnlyItems { get; set; }
}

public class FetchedItem
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("kind")]
    public string Kind { get; set; } = "";

    /// <summary>The POU's ROOT body language (ST/FBD/LD/CFC/SFC) — picks the workspace file
    /// extension on the CLI side. Null for non-POU kinds (DUTs, GVL, reference items).</summary>
    [JsonPropertyName("language")]
    public string? Language { get; set; }

    [JsonPropertyName("folder")]
    public string? Folder { get; set; }

    [JsonPropertyName("sourceText")]
    public string SourceText { get; set; } = "";

    [JsonPropertyName("version")]
    public string Version { get; set; } = "";
}

public class FetchResponse
{
    [JsonPropertyName("projectVersion")]
    public string ProjectVersion { get; set; } = "";

    [JsonPropertyName("structureVersion")]
    public string StructureVersion { get; set; } = "";

    [JsonPropertyName("changed")]
    public List<FetchedItem> Changed { get; set; } = new();

    [JsonPropertyName("removed")]
    public List<string> Removed { get; set; } = new();

    [JsonPropertyName("items")]
    public Dictionary<string, string> Items { get; set; } = new();
}
