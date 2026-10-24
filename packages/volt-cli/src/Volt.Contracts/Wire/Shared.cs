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
/// <para>On a READ (<c>refs</c>, <c>fetch</c>) null means NO identity check — discovery, or a first <c>init</c> that
/// has nothing to be bound to yet; the read echoes what it walked. A WRITE (<c>push</c>, <c>build</c>) requires both: one
/// absent or empty is <c>BAD_REQUEST</c> naming it (openspec <c>push-requires-project-identity</c>). They stay nullable
/// so the bridge can tell an absent member from a sent one.</para>
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
/// <para>One base, so <c>RefsResponse</c> and <c>FetchResponse</c> cannot diverge: a <c>refs</c> caller (`volt status`)
/// confirms <see cref="Platform"/>/<see cref="ProjectName"/> exactly as a <c>fetch</c> caller does.</para></summary>
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
    /// <para>Each entry carries its CODE and its REASON: an object in a folder excluded from build, one holding a vendor
    /// member no text spells, a read that failed.</para></summary>
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

    public UnreadableItem(string name, string code, string reason) { Name = name; Code = code; Reason = reason; }

    [JsonPropertyName("name")]
    public string Name { get; init; } = "";

    /// <summary>Why, as a code a client matches (<see cref="BridgeErrorCodes"/>): <c>UNREADABLE</c> — the IDE did not
    /// give what Volt asked of the object; <c>UNSUPPORTED</c> — the object holds what Volt's text has no spelling for, or
    /// sits where Volt does not read (a folder excluded from build); another code when the read that failed raised one.</summary>
    [JsonPropertyName("code")]
    public string Code { get; init; } = "";

    [JsonPropertyName("reason")]
    public string Reason { get; init; } = "";

    public override string ToString() => $"{Name} — {Reason}";
}

/// <summary>A tree node with no file that holds what the walk did not read: its node path, <c>&lt;folder&gt;/&lt;name&gt;</c>,
/// and why.</summary>
public sealed record UnreadableNode
{
    public UnreadableNode() { }

    public UnreadableNode(string name, string code, string reason) { Name = name; Code = code; Reason = reason; }

    [JsonPropertyName("name")]
    public string Name { get; init; } = "";

    /// <summary>Why, as a code a client matches (<see cref="BridgeErrorCodes"/>): <c>UNREADABLE</c> — the IDE did not
    /// give what Volt asked of the object; <c>UNSUPPORTED</c> — the object holds what Volt's text has no spelling for, or
    /// sits where Volt does not read (a folder excluded from build); another code when the read that failed raised one.</summary>
    [JsonPropertyName("code")]
    public string Code { get; init; } = "";

    [JsonPropertyName("reason")]
    public string Reason { get; init; } = "";

    public override string ToString() => $"{Name} — {Reason}";
}
