using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Volt.Engine.Wire;

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
}

public class FetchRequest
{
    /// <summary>Client's currently-known {name → version} map. Omit/empty or unset on the wire = fetch all.
    /// When <see cref="Init"/> is true this field is ignored — init always returns everything.</summary>
    [JsonPropertyName("knownItems")]
    public Dictionary<string, string>? KnownItems { get; set; }

    [JsonPropertyName("onlyItems")]
    public List<string>? OnlyItems { get; set; }

    /// <summary>Bootstrap mode: return every item regardless of knownItems. Used by <c>volt init</c> to
    /// seed the first workspace. A normal /fetch without knownItems AND without init=true is an error.</summary>
    [JsonPropertyName("init")]
    public bool Init { get; set; }

    /// <summary>The project this workspace is bound to. When set, the op refuses (WRONG_PROJECT) unless the live
    /// bridge is serving it — the in-op, race-free replacement for a pre-op health check. Null = no identity check
    /// (init/discovery, or an older client).</summary>
    [JsonPropertyName("expectedPlatform")]
    public string? ExpectedPlatform { get; set; }

    [JsonPropertyName("expectedProjectName")]
    public string? ExpectedProjectName { get; set; }
}

public class FetchedItem
{
    /// <summary>Full workspace filename including its KIND extension (e.g. "PLC_PRG.prg", "Foo.fb",
    /// "MyDut.struct") — see <see cref="Volt.Engine.Workspace.ItemKind.ExtFor"/>. A graphical FBD/LD
    /// body keeps its kind extension (language rides in the content), not a distinct one.</summary>
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

    /// <summary>Full name → folder path map. Populated by /init and /fetch so the client
    /// can reconstruct the tree without a separate /refs call.</summary>
    [JsonPropertyName("folders")]
    public Dictionary<string, string> Folders { get; set; } = new();

    /// <summary>The project the bridge actually walked, echoed back so the client can confirm — before it MERGES —
    /// that it fetched the project it is bound to. An older bridge omits these (null) → the client refuses rather
    /// than merge an unverifiable tree. (Push guards this server-side; a read verifies it here.)</summary>
    [JsonPropertyName("platform")]
    public string? Platform { get; set; }

    [JsonPropertyName("projectName")]
    public string? ProjectName { get; set; }
}
