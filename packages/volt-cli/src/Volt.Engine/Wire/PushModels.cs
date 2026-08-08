using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Volt.Engine.Wire;

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

    /// <summary>Stable diagnostic code for a thrown-op error (e.g. NETWORK_NESTED_EXPR, NETWORK_NOT_CANONICAL) — null for
    /// a plain version conflict. Omitted from JSON when null (WhenWritingNull).</summary>
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
