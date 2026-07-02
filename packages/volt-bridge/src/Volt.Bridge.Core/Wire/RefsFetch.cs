using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Volt.Bridge.Core.Wire;

public class RefsResponse
{
    [JsonPropertyName("projectVersion")]
    public string ProjectVersion { get; set; } = "";

    [JsonPropertyName("structureVersion")]
    public string StructureVersion { get; set; } = "";

    [JsonPropertyName("items")]
    public Dictionary<string, string> Items { get; set; } = new();

    [JsonPropertyName("folders")]
    public Dictionary<string, string> Folders { get; set; } = new();

    /// <summary>Full-name → true for items EFFECTIVELY excluded from build (the IDE won't compile them,
    /// so clients skip diagnostics). Only excluded items are listed — absent ⇒ false.</summary>
    [JsonPropertyName("excludeFromBuild")]
    public Dictionary<string, bool> ExcludeFromBuild { get; set; } = new();
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
    /// <summary>Full workspace filename including extension (e.g. "PLC_PRG.st"; graphical FBD/LD POUs
    /// are ".st" too, only read-only "Foo.cfc"/reference manifests carry a distinct extension).</summary>
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

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

    /// <summary>Full-name → true for items EFFECTIVELY excluded from build (all items, not just changed),
    /// so the client can keep a complete exclusion manifest. Only excluded items are listed — absent ⇒ false.</summary>
    [JsonPropertyName("excludeFromBuild")]
    public Dictionary<string, bool> ExcludeFromBuild { get; set; } = new();
}
