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

    /// <summary>Opt-in: also return referenced-library element SIGNATURES (declaration-only), materialized under
    /// each library's folder in the Library Manager. Off by default — a normal pull stays lightweight; the harvest
    /// (corpus build) sets it. Extraction is build-free (AllPrecompiledSignatures), so this adds no build cost.</summary>
    [JsonPropertyName("verbose")]
    public bool Verbose { get; set; }
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

    /// <summary>Referenced-library element signatures (declaration-only), each a workspace-relative path (under the
    /// owning library's folder in the Library Manager) + its ST text. Populated only when the request set
    /// <c>verbose</c>; the client writes each verbatim, like a fetched item.</summary>
    [JsonPropertyName("librarySignatures")]
    public List<LibSymbolItem> LibrarySignatures { get; set; } = new();

    /// <summary>Full-name → true for project POUs CODESYS did NOT compile (dead/uncalled code) — no compiler
    /// ground truth for their diagnostics. Distinct from <see cref="ExcludeFromBuild"/> (an explicit IDE
    /// property): dead code is still real, pushable source. Populated only on a <c>verbose</c> fetch.</summary>
    [JsonPropertyName("deadCode")]
    public Dictionary<string, bool> DeadCode { get; set; } = new();
}
