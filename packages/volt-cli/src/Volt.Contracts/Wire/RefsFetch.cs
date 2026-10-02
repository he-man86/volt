using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Volt.Contracts;

/// <summary>The <c>refs</c> request — the bound identity, and optionally the client's baseline. The whole BODY is
/// optional: a body-less <c>refs</c> (discovery, the e2e harness, an older client) runs only the connected check
/// and reports no removals.</summary>
public class RefsRequest : BoundRequest
{
    /// <summary>The client's baseline {name → version}, so the response can name what of it is gone
    /// (<see cref="ReadResponse.Removed"/>) by the same rule a <c>fetch</c> uses. Versions are not compared here —
    /// <c>refs</c> ships the live map and the client diffs it — only the names are judged.</summary>
    [JsonPropertyName("knownItems")]
    public Dictionary<string, string>? KnownItems { get; set; }

    /// <summary>The folder each known item last sat in — see <see cref="FetchRequest.KnownFolders"/>.</summary>
    [JsonPropertyName("knownFolders")]
    public Dictionary<string, string>? KnownFolders { get; set; }
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

    /// <summary>The folder each known item last sat in {name → folder}. It is what lets a PARTIAL walk still
    /// name removals: a known name absent from a folder the walk DID enumerate is gone, and one under a folder it
    /// could not read is merely unseen. A known name with no folder here is never removed by a partial walk (it
    /// may sit under the unread folder); a complete walk does not need it.</summary>
    [JsonPropertyName("knownFolders")]
    public Dictionary<string, string>? KnownFolders { get; set; }

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
    /// <summary>Full workspace filename including its KIND extension (e.g. "PLC_PRG.prg", "Foo.fb") — see
    /// <c>Volt.Engine.Sync.Materializer.FullWireName</c> for a project item, and <c>Volt.Engine.Library.LibraryFetch</c>
    /// for a library element (its extension from <c>LibSignatureRenderer</c>). A DUT is named by the subtype its VENDOR
    /// states ("E_Mode.enum", "ST_Axis.struct", ".union", ".alias"), or "E_Mode.dut" when the vendor states none, so
    /// the file a client writes is this name as given. A graphical FBD/LD body keeps its kind extension (language rides in the content), not a
    /// distinct one.</summary>
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("folder")]
    public string? Folder { get; set; }

    [JsonPropertyName("sourceText")]
    public string SourceText { get; set; } = "";

    [JsonPropertyName("version")]
    public string Version { get; set; } = "";

    /// <summary>Every body of this item that reads as <c>IMPLEMENTATION LD|FBD UNSUPPORTED</c>, with WHY — or null
    /// when it has none. The file states only that such a body is read-only; the reason used to be written into it
    /// as a comment and is now this, for the pull message to name (openspec <c>implementation-keyword</c> 2b).</summary>
    [JsonPropertyName("unsupported")]
    public List<UnsupportedBody>? Unsupported { get; set; }
}

/// <summary>One body network text cannot represent — its place in the item, its language, and the fact the text has
/// no spelling for.</summary>
public class UnsupportedBody
{
    /// <summary>The member whose body it is — <c>Reset</c>, or <c>Ready GET</c> for a property's accessor — and null
    /// for the item's own body.</summary>
    [JsonPropertyName("member")]
    public string? Member { get; set; }

    /// <summary><c>LD</c> or <c>FBD</c>.</summary>
    [JsonPropertyName("language")]
    public string Language { get; set; } = "";

    /// <summary>What network text has no spelling for, in a few words — e.g. <c>a vendor split point</c>.</summary>
    [JsonPropertyName("reason")]
    public string Reason { get; set; } = "";
}

public class FetchResponse : ReadResponse
{
    [JsonPropertyName("changed")]
    public List<FetchedItem> Changed { get; set; } = new();

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
