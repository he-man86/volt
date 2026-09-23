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

/// <summary>What both READ ops answer with: the project's version map, its folder map, the two "this view is
/// short" lists, and the identity the bridge actually walked.
///
/// <para><c>RefsResponse</c> and <c>FetchResponse</c> carried these six members as two copies, doc comments
/// included, and the copies had already diverged: only <c>fetch</c> echoed <see cref="Platform"/>/
/// <see cref="ProjectName"/>, so a <c>refs</c> caller could confirm nothing about what it had just been handed.
/// `volt status` walks through <c>refs</c>.</para></summary>
public abstract class ReadResponse
{
    /// <summary>Aggregate over every tracked item's NAME and VERSION — the lease a push quotes back as
    /// <c>expectedProjectVersion</c>. Content-sensitive: any edit, move, add or delete changes it.</summary>
    [JsonPropertyName("projectVersion")]
    public string ProjectVersion { get; set; } = "";

    /// <summary>Full wire name → content version, for every item the walk could materialize.</summary>
    [JsonPropertyName("items")]
    public Dictionary<string, string> Items { get; set; } = new();

    /// <summary>Full wire name → folder path, so a client can reconstruct the tree from one response.</summary>
    [JsonPropertyName("folders")]
    public Dictionary<string, string> Folders { get; set; } = new();

    /// <summary>Items the walk FOUND but could not materialize, by bare name — normally empty.
    ///
    /// <para><b>An unreadable item is the one failure a client cannot otherwise see.</b> It still exists, and it
    /// still counts toward <see cref="ProjectVersion"/> (tracked with the Unreadable sentinel so a pull does not
    /// mistake it for deleted), but it has no entry in <see cref="Items"/> and no file in the workspace — so the
    /// POU is simply ABSENT, with no error anywhere. That happened to a real project: one box whose <c>En</c> pin
    /// read as a boolean made a body unreadable, and the whole POU vanished from git silently (DIALECT C7).</para></summary>
    [JsonPropertyName("unreadable")]
    public List<string> Unreadable { get; set; } = new();

    /// <summary>Folders the driver could not ENUMERATE — normally empty.
    ///
    /// <para><b>A partial walk is not a smaller project.</b> Absence is how a client derives a deletion, so a
    /// folder that could not be read makes absence meaningless for everything beneath it. A client that sees this
    /// non-empty must not report deletions and should not advance its baseline; <c>fetch</c> suppresses its own
    /// <c>removed</c> list for the same reason. It is a caveat on a SUCCESSFUL response, not a failure — a
    /// partial pull is still useful.</para></summary>
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
