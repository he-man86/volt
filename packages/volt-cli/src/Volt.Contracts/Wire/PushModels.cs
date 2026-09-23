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
    /// NOT_FOUND, UNSUPPORTED, DUPLICATE_CHILD, BAD_REQUEST, INVALID_ST, INVALID_CODE_HEADER — arrived as a
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

    [JsonPropertyName("conflicts")]
    public List<PushConflict>? Conflicts { get; set; }

    [JsonPropertyName("currentProjectVersion")]
    public string? CurrentProjectVersion { get; set; }

    public static PushResponse AcceptedResult(string newProjectVersion, Dictionary<string, string> newItems, Dictionary<string, string> newFolders) =>
        new() { Accepted = true, NewProjectVersion = newProjectVersion, NewItems = newItems, NewFolders = newFolders };

    public static PushResponse RejectedResult(List<PushConflict> conflicts, string currentProjectVersion) =>
        new() { Accepted = false, Conflicts = conflicts, CurrentProjectVersion = currentProjectVersion };
}
