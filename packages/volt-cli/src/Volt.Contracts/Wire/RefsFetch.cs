using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Volt.Contracts;

/// <summary>The <c>refs</c> request — the bound identity, and nothing else. Both fields are OPTIONAL and the whole
/// BODY is optional: a body-less <c>refs</c> (discovery, the e2e harness, an older client) behaves exactly as it
/// always has, with only the connected check running. When they ARE set, <c>refs</c> guards identity in-op through
/// <see cref="Volt.Engine.Sync.OpGuard"/> like every other project-touching op, instead of the CLI compensating
/// with a pre-op read of the throttled health cache.</summary>
public class RefsRequest
{
    /// <summary>The project this workspace is bound to. When set, the op refuses (WRONG_PROJECT) unless the live
    /// bridge is serving it — the in-op, race-free replacement for a pre-op health check. Null = no identity check
    /// (discovery, or an older client). Same pair of fields, same meaning, as <see cref="FetchRequest"/>.</summary>
    [JsonPropertyName("expectedPlatform")]
    public string? ExpectedPlatform { get; set; }

    [JsonPropertyName("expectedProjectName")]
    public string? ExpectedProjectName { get; set; }
}

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

    /// <summary>Items the walk FOUND but could not materialize, by bare name — normally empty.
    ///
    /// <para><b>An unreadable item is the one failure a client cannot otherwise see.</b> It still exists, and it
    /// still counts toward <c>projectVersion</c> (it is tracked with the Unreadable sentinel so a pull does not
    /// mistake it for deleted), but it has no entry in <c>items</c> and no file in the workspace — so the POU is
    /// simply ABSENT, with no error anywhere. That happened to a real project: one box whose <c>En</c> pin read
    /// as a boolean made a body unreadable, and the whole POU vanished from git silently (DIALECT C7).</para>
    ///
    /// <para>The count was already computed and written to the debug log. Putting the NAMES on the wire is what
    /// makes it observable: a client can show which items did not come through, and a test can assert the list
    /// is empty instead of trusting that a project fully materialized.</para></summary>
    [JsonPropertyName("unreadable")]
    public List<string> Unreadable { get; set; } = new();
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
    /// seed the first workspace. A normal <c>fetch</c> without knownItems AND without init=true is an error.</summary>
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

    /// <summary>Full name → folder path map. Populated by <c>init</c> and <c>fetch</c> so the client
    /// can reconstruct the tree without a separate <c>refs</c> call.</summary>
    [JsonPropertyName("folders")]
    public Dictionary<string, string> Folders { get; set; } = new();

    /// <summary>Items the walk FOUND but could not materialize, by bare name — normally empty.
    ///
    /// <para><b>An unreadable item is the one failure a client cannot otherwise see.</b> It still exists, and it
    /// still counts toward <c>projectVersion</c> (it is tracked with the Unreadable sentinel so a pull does not
    /// mistake it for deleted), but it has no entry in <c>items</c> and no file in the workspace — so the POU is
    /// simply ABSENT, with no error anywhere. That happened to a real project: one box whose <c>En</c> pin read
    /// as a boolean made a body unreadable, and the whole POU vanished from git silently (DIALECT C7).</para>
    ///
    /// <para>The count was already computed and written to the debug log. Putting the NAMES on the wire is what
    /// makes it observable: a client can show which items did not come through, and a test can assert the list
    /// is empty instead of trusting that a project fully materialized.</para></summary>
    [JsonPropertyName("unreadable")]
    public List<string> Unreadable { get; set; } = new();

    /// <summary>True when this fetch RE-RENDERED the referenced-library signatures (the precompile ran), so
    /// <c>Changed</c> carries the COMPLETE signature set for every library folder.
    /// <para>It is the only removal signal those files have. A signature is PATH-identified, not name-identified
    /// (two libraries legitimately export the same short name), so it is absent from <c>Items</c> and
    /// <c>Removed</c> can never name one — meaning a signature whose element disappeared (library upgraded, or
    /// the reference deleted) stayed in the workspace forever and kept resolving in the LSP. When this is set the
    /// client replaces the library folders wholesale; when it is not, it leaves them alone, because the fetch
    /// skipped the precompile and carries no signatures at all.</para></summary>
    [JsonPropertyName("librariesRefreshed")]
    public bool LibrariesRefreshed { get; set; }

    /// <summary>The project the bridge actually walked, echoed back so the client can confirm — before it MERGES —
    /// that it fetched the project it is bound to. An older bridge omits these (null) → the client refuses rather
    /// than merge an unverifiable tree. (Push guards this server-side; a read verifies it here.)</summary>
    [JsonPropertyName("platform")]
    public string? Platform { get; set; }

    [JsonPropertyName("projectName")]
    public string? ProjectName { get; set; }
}
