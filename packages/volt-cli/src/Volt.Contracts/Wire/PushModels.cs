using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Volt.Contracts;

public class PushRequest : BoundRequest
{
    [JsonPropertyName("ops")]
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

    /// <summary>Opt-in: <c>true</c> asks an ACCEPTED push to answer <see cref="PushResponse.NewSources"/> — the stored
    /// text of every item the push changed, exactly as a fetch returns it (openspec
    /// <c>st-roundtrip-fixed-point</c>, route A). A client that patches its own text then holds what a read would give
    /// (volt's canonical form: one blank line before the END line, members METHOD, ACTION, PROPERTY then by name) without
    /// a second call. Absent or <c>false</c>: the answer is unchanged. Additive: an older bridge ignores it and answers
    /// without <c>newSources</c>, which a client reads as "re-read".</summary>
    [JsonPropertyName("returnSources")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? ReturnSources { get; set; }
}

[JsonPolymorphic(TypeDiscriminatorPropertyName = "op")]
[JsonDerivedType(typeof(SetItemOp), "set")]
[JsonDerivedType(typeof(DeleteItemOp), "deleteItem")]
public class PushOp
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("ifVersion")]
    public string? IfVersion { get; set; }
}

/// <summary>Unified declarative item change: the item named <c>Name</c> should end up as
/// <c>ToName ?? Name</c>, in <c>ToFolder ?? (current folder)</c>, with <c>SourceText ?? (current content)</c>.
/// Each field absent = that facet unchanged. One op expresses create / update / rename / move and any
/// combination, applied atomically — a rename uses the IDE's native rename (so call-sites update); a move
/// recreates (names are globally unique, so name-based references survive).</summary>
public class SetItemOp : PushOp
{
    [JsonPropertyName("toName")]
    public string? ToName { get; set; }

    /// <summary>Where the item should end up: the FULL path from the tree root, exactly as the walk emits it.
    ///
    /// <para><b>Absent and empty are different, and treating them as the same lost a move.</b> <c>null</c> is
    /// "keep the current folder" — what an in-place edit sends. The EMPTY STRING is a destination: the tree
    /// root, which on CODESYS is the project's own POU pool. The engine read empty as absent for a while, so
    /// dragging an item out of the Application and into the pool sent <c>ToFolder = ""</c>, the push reported
    /// ACCEPTED, nothing moved, and the next pull put the file back where it started.</para></summary>
    [JsonPropertyName("toFolder")]
    public string? ToFolder { get; set; }

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

    /// <summary>The stable code for this conflict. <b>Never null</b> — every conflict the push can produce
    /// carries one, so a caller branches on the code and never on the prose.
    ///
    /// <para><b>Three vocabularies share this field, and that is deliberate.</b></para>
    /// <list type="bullet">
    /// <item><see cref="ConflictCodes.Gate"/> — the optimistic-concurrency gate: a stale lease, a stale item
    /// version, a create that collided, a version quoted for an item that is gone.</item>
    /// <item><see cref="ConflictCodes.Network"/> — a graphical body the FBD/LD format refuses. These carry a
    /// <see cref="Line"/> too.</item>
    /// <item><see cref="ConflictCodes.FromBridge"/> — everything else the push itself refuses.</item>
    /// </list>
    /// <para>They cannot collide: the network-text exception carries its own code and is NOT an
    /// <c>ICodedError</c>, precisely so a <c>NETWORK_*</c> value can never escape into an error FRAME, whose
    /// vocabulary is documented as BridgeErrorCodes alone.</para>
    ///
    /// <para>This used to carry the network-text code and nothing else, so every coded refusal a push raised —
    /// NOT_FOUND, UNSUPPORTED, DUPLICATE_CHILD, BAD_REQUEST, INVALID_ST (and INVALID_CODE_HEADER, deleted once a push
    /// stopped reading a top-level item's header) — arrived as a
    /// message with no code. Since a push answers refusals as CONFLICTS rather than error frames, those six
    /// were unobservable anywhere on the wire, and callers matched the English instead: the e2e suite asserted
    /// on an exact sentence and the CLI printed the prose unbranched.</para>
    ///
    /// <para>The GATE family is the second half of that. Its four outcomes were all `code: null`, told apart
    /// only by which version field happened to be null and by a synthetic item named <c>&lt;project&gt;</c> —
    /// so "your lease is stale, pull and retry", "that name is taken, pick another" and "the item you hold a
    /// version for is gone, there is nothing to merge with" were one undifferentiated answer. They are three
    /// different next steps for the engineer.</para>
    ///
    /// <para>The property stays nullable because deserializing an older bridge's response must not throw; a
    /// client reading null is talking to a bridge that predates this.</para></summary>
    [JsonPropertyName("code")]
    public string? Code { get; set; }

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
    /// <c>push-partially-applied-flag</c>). Additive: an older bridge never sends it.</summary>
    [JsonPropertyName("partiallyApplied")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? PartiallyApplied { get; set; }

    /// <summary>The FULL wire name (<c>name.kind</c>) the item has NOW, when a native rename ran before the op was refused
    /// and stays: the item is no longer under <see cref="Name"/>. Absent otherwise.</summary>
    [JsonPropertyName("renamedTo")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? RenamedTo { get; set; }

    /// <summary><c>true</c> when this op CREATED the item and the rollback of that create failed: the object stays in the
    /// project under the name the op created it with — the op's <c>toName</c> when it carries one (a forced replace that
    /// also renames creates under <c>toName</c>, and the original under <see cref="Name"/> is gone), else
    /// <see cref="Name"/> — so a re-sent create would collide with it. Absent otherwise (a rolled-back create leaves
    /// nothing).</summary>
    [JsonPropertyName("remains")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? Remains { get; set; }
}

public class PushResponse
{
    [JsonPropertyName("accepted")]
    public bool Accepted { get; set; }

    [JsonPropertyName("newProjectVersion")]
    public string? NewProjectVersion { get; set; }

    [JsonPropertyName("newItems")]
    public Dictionary<string, string>? NewItems { get; set; }

    /// <summary>Full name → folder path for the post-apply state, so the client refreshes its sidecar
    /// folder map from the push receipt instead of a follow-up <c>refs</c>. Additive (nullable): an older client
    /// ignores it, so this needs no wire-version bump. Populated only on an accepted push.</summary>
    [JsonPropertyName("newFolders")]
    public Dictionary<string, string>? NewFolders { get; set; }

    /// <summary>Folders the RECEIPT walk could not enumerate — normally empty, same meaning as on a read.
    ///
    /// <para>The receipt is a full re-walk, so it can be short for exactly the reasons a read can. Without this
    /// the client had no way to know: it replaced its baseline item map with <see cref="NewItems"/>, so every
    /// item under an unenumerable folder left the sidecar — undoing, in one push, the overlay the pull path
    /// installs for precisely this case. The damage lands on the NEXT push: an edit to such a file has no known
    /// version and goes up as a create (ITEM_EXISTS), a delete is skipped and reported as "nothing to push", and
    /// a rename throws "has no known IDE version".</para></summary>
    [JsonPropertyName("unwalkedFolders")]
    public List<string> UnwalkedFolders { get; set; } = new();

    /// <summary>On a REJECTED push (<c>accepted:false</c>): every op refused, and nothing of the batch was applied in
    /// full — a refusal decided before the first write names EVERY refused op; a refusal by the live IDE of the first op
    /// applied states in its reason whatever of that op the IDE kept.
    ///
    /// <para>On an ACCEPTED push it may be non-empty too (openspec <c>push-keeps-what-landed</c>): the live IDE refused
    /// an op after earlier ops had landed, the push stopped there, and each op that did NOT land has one conflict — the
    /// refused op with its own code, every op after it in apply order with <see cref="ConflictCodes.NotAttempted"/>.
    /// Every op this list does not name landed, and the receipt (<see cref="NewItems"/>) is the project as it now is.</para></summary>
    [JsonPropertyName("conflicts")]
    public List<PushConflict>? Conflicts { get; set; }

    [JsonPropertyName("currentProjectVersion")]
    public string? CurrentProjectVersion { get; set; }

    /// <summary>Only when the request set <see cref="PushRequest.ReturnSources"/> and the push was ACCEPTED: full wire
    /// name (<c>name.kind</c>, the <see cref="NewItems"/> key, in the IDE's spelling — a renamed item under its NEW name,
    /// an op named in another case under the IDE's case) → that item's stored text exactly as a fetch returns it, for
    /// every item the push changed: each item a landed <c>set</c> op left in the project, and each item whose version the
    /// push changed though no op names it (the call sites a native rename rewrote). The text is the receipt walk's own
    /// materialization, so it is the text <see cref="NewItems"/>' version hashes.
    ///
    /// <para>No entry, by name, for: a <c>delete</c>; an op in <see cref="Conflicts"/> (refused or
    /// <c>NOT_ATTEMPTED</c> — a <c>partiallyApplied</c> one is re-read); a changed item the receipt could not
    /// materialize (it is equally absent from <see cref="NewItems"/>: these keys are always a subset of those). Absent on a
    /// rejected push and when the flag was not set. A client missing a pushed name re-reads it.</para></summary>
    [JsonPropertyName("newSources")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public Dictionary<string, string>? NewSources { get; set; }

    public static PushResponse AcceptedResult(string newProjectVersion, Dictionary<string, string> newItems, Dictionary<string, string> newFolders) =>
        new() { Accepted = true, NewProjectVersion = newProjectVersion, NewItems = newItems, NewFolders = newFolders };

    public static PushResponse AcceptedResult(string newProjectVersion, Dictionary<string, string> newItems,
                                              Dictionary<string, string> newFolders, List<string> unwalkedFolders) =>
        new() { Accepted = true, NewProjectVersion = newProjectVersion, NewItems = newItems, NewFolders = newFolders,
                UnwalkedFolders = unwalkedFolders };

    /// <summary>An accepted push that did not land in full: the receipt, plus one conflict per op that did not land.</summary>
    public static PushResponse PartialResult(string newProjectVersion, Dictionary<string, string> newItems,
                                             Dictionary<string, string> newFolders, List<string> unwalkedFolders,
                                             List<PushConflict> notLanded) =>
        new() { Accepted = true, NewProjectVersion = newProjectVersion, NewItems = newItems, NewFolders = newFolders,
                UnwalkedFolders = unwalkedFolders, Conflicts = notLanded };

    public static PushResponse RejectedResult(List<PushConflict> conflicts, string currentProjectVersion) =>
        new() { Accepted = false, Conflicts = conflicts, CurrentProjectVersion = currentProjectVersion };
}
