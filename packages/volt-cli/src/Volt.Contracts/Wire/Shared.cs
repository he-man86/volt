using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Volt.Contracts;

/// <summary>The bound identity every project-touching request carries — <c>refs</c>, <c>fetch</c>, <c>push</c>
/// and <c>build</c>.
///
/// <para>When both are set the op refuses with <c>WRONG_PROJECT</c> unless the live bridge is serving that
/// project. This is the IN-OP, race-free replacement for a pre-op health check: health is a per-vendor throttled
/// snapshot (~5s on TwinCAT) that, right after a rebind or reopen, still names the OLD project — and inside that
/// window a client checking health first would walk the wrong project and believe it.</para>
///
/// <para>Null means NO identity check — discovery, a first <c>init</c> that has nothing to be bound to yet, or an
/// older client. That carve-out is load-bearing, not laziness: the e2e harness and the <c>VOLT_PIPE</c> paths both
/// ask without a binding.</para>
///
/// <para>The pair lived on four request types with four copies of this paragraph. They were already required to
/// mean the same thing — <c>OpGuard.RequireBoundProject</c> is the single reader — so the duplication could only
/// ever drift away from the one implementation.</para></summary>
public abstract class BoundRequest
{
    [JsonPropertyName("expectedPlatform")]
    public string? ExpectedPlatform { get; set; }

    [JsonPropertyName("expectedProjectName")]
    public string? ExpectedProjectName { get; set; }
}

/// <summary>What both READ ops answer with: the project's version map, its applications, the two "this view is
/// short" lists, and the identity the bridge actually walked.
///
/// <para><c>RefsResponse</c> and <c>FetchResponse</c> carried these six members as two copies, doc comments
/// included, and the copies had already diverged: only <c>fetch</c> echoed <see cref="Platform"/>/
/// <see cref="ProjectName"/>, so a <c>refs</c> caller could confirm nothing about what it had just been handed.
/// `volt status` walks through <c>refs</c>.</para></summary>
public abstract class ReadResponse
{
    /// <summary>Aggregate over every tracked item's PATH and VERSION — the lease a push quotes back as
    /// <c>expectedProjectVersion</c>. Content-sensitive: any edit, move, add or delete changes it.</summary>
    [JsonPropertyName("projectVersion")]
    public string ProjectVersion { get; set; } = "";

    /// <summary>Item PATH → content version, for every item the walk could materialize. The path is the item's place
    /// in the IDE's own tree, <c>&lt;folder&gt;/&lt;name&gt;.&lt;kind&gt;</c> (<c>Device/Plc Logic/Application/PLC_PRG.pou</c>):
    /// it is the item's identity on the wire, so two <c>PLC_PRG.pou</c> in two applications are two items (openspec
    /// <c>multi-application-tree</c>). The folder is the path's own prefix; there is no separate folder map.</summary>
    [JsonPropertyName("items")]
    public Dictionary<string, string> Items { get; set; } = new();

    /// <summary>The root path of every application the project holds (CODESYS: each <c>IApplicationObject</c>,
    /// <c>Device/Plc Logic/Application</c>; TwinCAT: each PLC project's project node, <c>TwinCAT Project1/PLC/Untitled1/Untitled1 Project</c>). An item
    /// belongs to the application whose root is the longest prefix of its path; an item under none (the CODESYS POU pool)
    /// belongs to the pool. A client never parses a vendor segment such as <c>Plc Logic</c> to find one.</summary>
    [JsonPropertyName("applications")]
    public List<string> Applications { get; set; } = new();

    /// <summary>Items the walk FOUND and did not read — normally empty. Each is named by its PATH,
    /// <c>&lt;folder&gt;/&lt;name&gt;.&lt;kind&gt;</c>: exactly the path it has in <see cref="Items"/> while it reads, so a
    /// client can address it (a forced <c>deleteItem</c> of that name is the repair) and two items of one bare name are
    /// never one entry.
    ///
    /// <para><b>An unreadable item is the one failure a client cannot otherwise see.</b> It still exists, and it
    /// still counts toward <see cref="ProjectVersion"/> (tracked with the Unreadable sentinel so a pull does not
    /// mistake it for deleted), but it has no entry in <see cref="Items"/>, so nothing but this list says it is
    /// there: a client that never read it has no file for it and the POU is simply ABSENT, with no error anywhere
    /// (a client that read it before keeps its last file, held and stale). That happened to a real project: one box whose <c>En</c> pin
    /// read as a boolean made a body unreadable, and the whole POU vanished from git silently (DIALECT C7).</para>
    ///
    /// <para>Each entry carries its REASON: an object in a folder excluded from build, one holding a vendor member no
    /// text spells, a read that failed.</para></summary>
    [JsonPropertyName("unreadable")]
    public List<UnreadableItem> Unreadable { get; set; } = new();

    /// <summary>Tree nodes the walk FOUND that have no file and hold what it did not read — normally empty. Each is
    /// named by its node path, <c>&lt;folder&gt;/&lt;name&gt;</c>: a container holding a setting no text spells (a
    /// Library Manager, an application's compiler defines), or an object whose kind the IDE could not state — then
    /// its folder and its own subtree are in <see cref="UnwalkedFolders"/>.</summary>
    [JsonPropertyName("unreadableNodes")]
    public List<UnreadableNode> UnreadableNodes { get; set; } = new();

    /// <summary>Paths in the client's baseline (<c>knownItems</c>) that are GONE from the IDE — the one removal
    /// decision, made here in the engine for every read op, so no client derives a deletion from absence with a
    /// rule of its own. Gone means: not walked, and not in <see cref="Unreadable"/>; on a PARTIAL walk also sitting in a
    /// folder the walk read (the path's own folder). Empty when the request sent no baseline, on <c>init</c>, and for a directed
    /// (<c>onlyItems</c>) fetch.</summary>
    [JsonPropertyName("removed")]
    public List<string> Removed { get; set; } = new();

    /// <summary>Folders the driver could not ENUMERATE — normally empty.
    ///
    /// <para><b>A partial walk is not a smaller project.</b> A folder that could not be read makes absence
    /// meaningless for everything beneath it, so a client that sees this non-empty must not derive deletions from
    /// <see cref="Items"/> and must not shrink its baseline by the items it did not see. <see cref="Removed"/> is
    /// the bridge's own answer, which already accounts for it. It is a caveat on a SUCCESSFUL response, not a
    /// failure — a partial pull is still useful.</para></summary>
    [JsonPropertyName("unwalkedFolders")]
    public List<string> UnwalkedFolders { get; set; } = new();

    /// <summary>The project the bridge actually walked, echoed back so a client can confirm — before it MERGES —
    /// that it read the project it is bound to. The in-op guard already refused a mismatch; this is what lets a
    /// client that asked WITHOUT a binding find out what it got. An older bridge omits these (null), and a client
    /// that needs the guarantee refuses rather than trust an unverifiable tree.</summary>
    [JsonPropertyName("platform")]
    public string? Platform { get; set; }

    [JsonPropertyName("projectName")]
    public string? ProjectName { get; set; }
}

/// <summary>An item the walk found and did not read: its path, <c>&lt;folder&gt;/&lt;name&gt;.&lt;kind&gt;</c>, and why, in
/// the words of the refusal that left it out.</summary>
public sealed record UnreadableItem
{
    public UnreadableItem() { }

    public UnreadableItem(string name, string reason) { Name = name; Reason = reason; }

    [JsonPropertyName("name")]
    public string Name { get; init; } = "";

    [JsonPropertyName("reason")]
    public string Reason { get; init; } = "";

    public override string ToString() => $"{Name} — {Reason}";
}

/// <summary>A tree node with no file that holds what the walk did not read: its node path, <c>&lt;folder&gt;/&lt;name&gt;</c>,
/// and why.</summary>
public sealed record UnreadableNode
{
    public UnreadableNode() { }

    public UnreadableNode(string name, string reason) { Name = name; Reason = reason; }

    [JsonPropertyName("name")]
    public string Name { get; init; } = "";

    [JsonPropertyName("reason")]
    public string Reason { get; init; } = "";

    public override string ToString() => $"{Name} — {Reason}";
}
