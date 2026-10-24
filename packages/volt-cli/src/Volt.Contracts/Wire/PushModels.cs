using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Volt.Contracts;

public class PushRequest : BoundRequest
{
    /// <summary>REQUIRED on the wire: a body without it is the request's error, never an empty push (<c>[]</c> is the push
    /// of nothing). <c>null</c> is refused by the push, by name.</summary>
    [JsonPropertyName("ops")]
    [JsonRequired]
    public List<PushOp> Ops { get; set; } = new();

    [JsonPropertyName("expectedProjectVersion")]
    public string? ExpectedProjectVersion { get; set; }

    /// <summary>Force: apply unconditionally — skip the per-item optimistic-concurrency (ifVersion) checks so
    /// `push --force` clobbers the live IDE in ONE call (no pre-push <c>refs</c>). The project-level
    /// <see cref="ExpectedProjectVersion"/> gate still runs when set (that IS the --force-with-lease check).
    ///
    /// <para>The IDENTITY guard (<see cref="BoundRequest.ExpectedPlatform"/>) runs regardless of this flag and
    /// before the apply, so `push --force` — which nulls the version gate — still cannot clobber the wrong
    /// IDE.</para></summary>
    [JsonPropertyName("force")]
    public bool Force { get; set; }

    /// <summary>Opt-in: <c>true</c> asks a push that landed to answer <see cref="PushResponse.NewSources"/> — the stored
    /// text of every item the push changed, exactly as a fetch returns it (openspec
    /// <c>st-roundtrip-fixed-point</c>, route A). A client that patches its own text then holds what a read would give
    /// (volt's canonical form: one blank line before the END line, members METHOD, ACTION, PROPERTY then by name) without
    /// a second call. Absent or <c>false</c>: the answer is unchanged.</summary>
    [JsonPropertyName("returnSources")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? ReturnSources { get; set; }
}

[JsonPolymorphic(TypeDiscriminatorPropertyName = "op")]
[JsonDerivedType(typeof(SetItemOp), "set")]
[JsonDerivedType(typeof(DeleteItemOp), "deleteItem")]
public abstract class PushOp
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("ifVersion")]
    public string? IfVersion { get; set; }
}

/// <summary>Unified declarative item change: the item at PATH <c>Name</c> should end up at <c>To ?? Name</c>, with
/// <c>SourceText ?? (current content)</c>. Each field absent = that facet unchanged. A path that names no existing item is
/// a create there. One op expresses create / update / rename / move and any combination, applied atomically — a rename
/// (the file name changes) uses the IDE's native rename and changes no item the push does not name (callers keep their
/// text unless the push sends them — DIALECT C2p); a move (the folder changes) relocates the object, within one
/// application only (openspec <c>multi-application-tree</c>: a move to another application is a delete and a create).</summary>
public class SetItemOp : PushOp
{
    /// <summary>The PATH the item should end up at, <c>&lt;folder&gt;/&lt;name&gt;.&lt;kind&gt;</c>, exactly as the walk
    /// publishes paths. Absent (<c>null</c>) keeps the item where and as it is — what an in-place edit sends. Its folder
    /// may be the tree root (a path with no <c>/</c>), which on CODESYS is the project's own POU pool.</summary>
    [JsonPropertyName("to")]
    public string? To { get; set; }

    [JsonPropertyName("sourceText")]
    public string? SourceText { get; set; }
}

public class DeleteItemOp : PushOp
{
}

public class PushConflict
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("yourVersion")]
    public string? YourVersion { get; set; }

    [JsonPropertyName("currentVersion")]
    public string? CurrentVersion { get; set; }

    [JsonPropertyName("reason")]
    public string Reason { get; set; } = "";

    /// <summary>The stable code for this conflict, always present, so a caller branches on the code and never on the
    /// prose. Three vocabularies share it and cannot collide: the optimistic-concurrency gate
    /// (<see cref="ConflictCodes.Gate"/>), a graphical body the FBD/LD format refuses (<see cref="ConflictCodes.Network"/>,
    /// with a <see cref="Line"/>), and everything else the push refuses (<see cref="ConflictCodes.FromBridge"/>) — plus
    /// <see cref="ConflictCodes.NotAttempted"/> for an op the push did not reach.</summary>
    [JsonPropertyName("code")]
    public string Code { get; set; } = "";

    /// <summary>On <see cref="ConflictCodes.ItemExists"/>: the path of the item the IDE already holds, when it is not
    /// <see cref="Name"/> — the item a rename or move's <c>to</c> lands on, or the item of another folder or kind that
    /// holds the name in the application. Absent when the colliding item is the one <see cref="Name"/> names;
    /// <see cref="CurrentVersion"/> is the version of the colliding item.</summary>
    [JsonPropertyName("existing")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Existing { get; set; }

    /// <summary>1-based source line within the pushed body, when the diagnostic knows it.</summary>
    [JsonPropertyName("line")]
    public int? Line { get; set; }

    /// <summary><c>true</c> when the live IDE refused this op AFTER part of it landed, and that part stays in the project:
    /// an update's declaration or a member it deleted, created or moved, part of a task's settings, a move+edit's text, a
    /// folder a create or a move made, a native rename that ran first (<see cref="RenamedTo"/>), the delete before a
    /// forced replace, a create whose rollback failed (<see cref="Remains"/>). <b>Absent</b> when nothing of the op stays — never <c>false</c>. A client re-reads the
    /// item before retrying exactly when this is set; re-sending the op unchanged is wrong then (its name may be gone,
    /// its version is stale). <see cref="Reason"/> says WHAT stays, in words (openspec <c>push-keeps-what-landed</c>);
    /// this is the same fact as a field, so a caller never parses the prose (openspec
    /// <c>push-partially-applied-flag</c>). What of the op stays is in the receipt (<see cref="PushResponse.NewItems"/>,
    /// <see cref="PushResponse.Removed"/>).</summary>
    [JsonPropertyName("partiallyApplied")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? PartiallyApplied { get; set; }

    /// <summary>The PATH the item has NOW, when a native rename ran before the op was refused and stays: the item is no
    /// longer under <see cref="Name"/>. Absent otherwise.</summary>
    [JsonPropertyName("renamedTo")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? RenamedTo { get; set; }

    /// <summary><c>true</c> when this op CREATED the item and the rollback of that create failed: the object stays in the
    /// project under the path the op created it at — the op's <c>to</c> when it carries one (a forced replace that
    /// also renames creates at <c>to</c>, and the original under <see cref="Name"/> is gone), else
    /// <see cref="Name"/> — so a re-sent create would collide with it. Absent otherwise (a rolled-back create leaves
    /// nothing).</summary>
    [JsonPropertyName("remains")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? Remains { get; set; }
}

/// <summary>
/// The answer to a push: what did not land, and the receipt of what did — enough to update a baseline without a
/// second <c>refs</c>.
/// <para><b>One rule.</b> Every op <see cref="Conflicts"/> does not name landed in full. A refusal decided before the
/// first write lands nothing: each refused op has its code, every other op <see cref="ConflictCodes.NotAttempted"/>. A
/// refusal by the live IDE lands the ops before it: the refused op has its code, every op after it
/// <see cref="ConflictCodes.NotAttempted"/>. A stale <c>expectedProjectVersion</c> is no conflict: it is the error frame
/// <see cref="BridgeErrorCodes.StaleProjectVersion"/>.</para>
/// </summary>
public class PushResponse
{
    /// <summary>The project's version after the push — the lease the next push quotes. Absent exactly when nothing
    /// landed.</summary>
    [JsonPropertyName("newProjectVersion")]
    public string? NewProjectVersion { get; set; }

    /// <summary>Path → new version of every item the push created or changed: each landed <c>set</c> op's item (under the
    /// path the IDE holds it at, in the IDE's spelling), what of a refused op stays (its <c>renamedTo</c>, a created item
    /// that <c>remains</c>, an item it <c>partiallyApplied</c>), and with <c>returnSources</c> every item whose text
    /// <see cref="NewSources"/> carries. Always present; empty when nothing landed.</summary>
    [JsonPropertyName("newItems")]
    public Dictionary<string, string> NewItems { get; set; } = new();

    /// <summary>Every path the push made disappear: a landed delete, the old path of a landed rename or move, and what of
    /// a refused op is gone (the old path of a rename that stays, an item a forced replace deleted). Always present.
    /// A baseline updated as <c>baseline − removed + newItems</c> is the IDE's state for every item the push named.</summary>
    [JsonPropertyName("removed")]
    public List<string> Removed { get; set; } = new();

    /// <summary>The folders the push's walks could not enumerate — normally empty: the walk before the apply (an op on an
    /// item under one is refused <see cref="ConflictCodes.ItemUnverified"/>: absence from a partial walk is not proof the
    /// item is gone) and the receipt walk after it (an item under one is missing from <see cref="NewItems"/> though the
    /// push may have changed it; a client re-reads it).</summary>
    [JsonPropertyName("unwalkedFolders")]
    public List<string> UnwalkedFolders { get; set; } = new();

    /// <summary>One conflict per op that did not land, in request order for a refusal before the first write and in
    /// apply order for a refusal by the IDE, each named by its op's <c>name</c>. Empty when every op landed.</summary>
    [JsonPropertyName("conflicts")]
    public List<PushConflict> Conflicts { get; set; } = new();

    /// <summary>Only when the request set <see cref="PushRequest.ReturnSources"/> and something landed: item path
    /// (the <see cref="NewItems"/> key, in the IDE's spelling — a renamed item under its NEW path,
    /// an op named in another case under the IDE's case) → that item's stored text exactly as a fetch returns it, for
    /// each item a landed <c>set</c> op left in the project. An item the IDE changed beside the push is the next read's, in
    /// this mode as without it. The text is the receipt walk's own materialization, so it is the text
    /// <see cref="NewItems"/>' version hashes.
    ///
    /// <para>No entry, by name, for: a <c>delete</c>; an op in <see cref="Conflicts"/> (refused or
    /// <c>NOT_ATTEMPTED</c> — a <c>partiallyApplied</c> one is re-read); a changed item the receipt could not
    /// materialize (it is equally absent from <see cref="NewItems"/>: these keys are always a subset of those). Absent when
    /// nothing landed and when the flag was not set. A client missing a pushed name re-reads it.</para></summary>
    [JsonPropertyName("newSources")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public Dictionary<string, string>? NewSources { get; set; }
}
