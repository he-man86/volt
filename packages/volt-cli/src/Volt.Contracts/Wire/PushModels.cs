using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Volt.Contracts;

public class PushRequest
{
    [JsonPropertyName("ops")]
    public List<PushOp> Ops { get; set; } = new();

    [JsonPropertyName("expectedProjectVersion")]
    public string? ExpectedProjectVersion { get; set; }

    /// <summary>Force: apply unconditionally — skip the per-item optimistic-concurrency (ifVersion) checks so
    /// `push --force` clobbers the live IDE in ONE call (no pre-push <c>refs</c>). The project-level
    /// <see cref="ExpectedProjectVersion"/> gate still runs when set (that IS the --force-with-lease check).</summary>
    [JsonPropertyName("force")]
    public bool Force { get; set; }

    /// <summary>The project this workspace is bound to. The op refuses (WRONG_PROJECT) unless the live bridge is
    /// serving it — checked BEFORE the apply and regardless of <see cref="Force"/>, so `push --force` (which nulls
    /// the version gate) still can't clobber the wrong IDE. Null = no identity check (older client).</summary>
    [JsonPropertyName("expectedPlatform")]
    public string? ExpectedPlatform { get; set; }

    [JsonPropertyName("expectedProjectName")]
    public string? ExpectedProjectName { get; set; }
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

    /// <summary>The stable code for a REFUSAL — null for a plain version conflict, which is not a refusal but
    /// the optimistic gate doing its job (it carries <see cref="YourVersion"/>/<see cref="CurrentVersion"/>
    /// instead). Omitted from JSON when null.
    ///
    /// <para><b>Two vocabularies share this field, and that is deliberate.</b> A body the format refuses
    /// answers with one of <see cref="ConflictCodes.Network"/> (and a <see cref="Line"/>) — e.g.
    /// <c>NETWORK_PARSE</c> or <c>NETWORK_NOT_CANONICAL</c>; everything else the push refuses answers with one
    /// of <see cref="ConflictCodes.FromBridge"/>. They cannot collide: the network-text exception
    /// carries its own code and is NOT an <c>ICodedError</c>, precisely so a <c>NETWORK_*</c> value can never
    /// escape into an error FRAME, whose vocabulary is documented as BridgeErrorCodes alone.</para>
    ///
    /// <para>This used to carry the network-text code and nothing else, so every coded refusal a push raised —
    /// NOT_FOUND, UNSUPPORTED, DUPLICATE_CHILD, BAD_REQUEST, INVALID_ST, INVALID_CODE_HEADER — arrived as a
    /// message with no code. Since a push answers refusals as CONFLICTS rather than error frames, those six
    /// were unobservable anywhere on the wire, and callers matched the English instead: the e2e suite asserted
    /// on an exact sentence and the CLI printed the prose unbranched. A caller could not separate "pull and
    /// retry" from "this shape can never be written".</para></summary>
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
