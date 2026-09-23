using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Volt.Contracts;

/// <summary>The <c>refs</c> request — the bound identity, and nothing else. The whole BODY is optional: a
/// body-less <c>refs</c> (discovery, the e2e harness, an older client) runs only the connected check.</summary>
public class RefsRequest : BoundRequest
{
}

/// <summary>The version map with no content — what a client compares against to decide what to fetch.</summary>
public class RefsResponse : ReadResponse
{
}

public class FetchRequest : BoundRequest
{
    /// <summary>Client's currently-known {name → version} map. Omit/empty or unset on the wire = fetch all.
    /// When <see cref="Init"/> is true this field is ignored — init always returns everything.</summary>
    [JsonPropertyName("knownItems")]
    public Dictionary<string, string>? KnownItems { get; set; }

    [JsonPropertyName("onlyItems")]
    public List<string>? OnlyItems { get; set; }

    /// <summary>Bootstrap mode: return every item regardless of knownItems. This is how <c>volt init</c> seeds
    /// the first workspace. A <c>fetch</c> with neither <c>knownItems</c> nor <c>onlyItems</c> nor this flag is
    /// NO_SIDECAR: "everything" and "a client that forgot its baseline" are indistinguishable otherwise.</summary>
    [JsonPropertyName("init")]
    public bool Init { get; set; }
}

public class FetchedItem
{
    /// <summary>Full workspace filename including its KIND extension (e.g. "PLC_PRG.prg", "Foo.fb",
    /// "MyDut.dut") — see <c>Volt.Engine.Item.ItemKind.ExtFor</c>. A graphical FBD/LD
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

public class FetchResponse : ReadResponse
{
    [JsonPropertyName("changed")]
    public List<FetchedItem> Changed { get; set; } = new();

    /// <summary>Items in the client's <c>knownItems</c> that the walk did not find — deliberately EMPTY when
    /// <see cref="ReadResponse.UnwalkedFolders"/> is non-empty, or when the request narrowed the walk, because a
    /// deletion is derived from absence and neither of those absences means anything.</summary>
    [JsonPropertyName("removed")]
    public List<string> Removed { get; set; } = new();

    /// <summary>True when this fetch RE-RENDERED the referenced-library signatures (the precompile ran), so
    /// <see cref="Changed"/> carries the COMPLETE signature set for every library folder.
    /// <para>It is the only removal signal those files have. A signature is PATH-identified, not name-identified
    /// (two libraries legitimately export the same short name), so it is absent from <c>items</c> and
    /// <see cref="Removed"/> can never name one — meaning a signature whose element disappeared (library
    /// upgraded, or the reference deleted) stayed in the workspace forever and kept resolving in the LSP. When
    /// this is set the client replaces the library folders wholesale; when it is not, it leaves them alone,
    /// because the fetch skipped the precompile and carries no signatures at all.</para></summary>
    [JsonPropertyName("librariesRefreshed")]
    public bool LibrariesRefreshed { get; set; }
}
