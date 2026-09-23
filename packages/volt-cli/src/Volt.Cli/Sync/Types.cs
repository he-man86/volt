using System.Text.Json.Serialization;
using Volt.Contracts;

namespace Volt.Cli.Sync;

/// <summary>The <c>Kind</c> discriminator on a CLI result / merge outcome — the value the <c>--json</c> output
/// carries and volt-control parses (<c>actions.ts</c>, <c>status.ts</c>). Defined once: the factory methods set it,
/// <c>Program</c>/<c>Commands</c> compare it. A wire-visible lowercase string (NOT an enum — a client matches the
/// exact word, and an enum would serialize its PascalCase name and break the TS parser).</summary>
public static class ResultKinds
{
    public const string Ok = "ok";
    public const string Error = "error";
    public const string Refused = "refused";
    public const string Rejected = "rejected";
    public const string Conflict = "conflict";
    public const string Clean = "clean";
}

/// <summary>The <c>Kind</c> on a parsed git diff row — internal to the CLI's status model (produced by
/// <c>Git.ParseDiffRows</c>, consumed by <c>StatusModel</c>). Defined once; not serialized to TS.</summary>
public static class DiffKinds
{
    public const string Add = "add";
    public const string Delete = "delete";
    public const string Rename = "rename";
    public const string Modify = "modify";
}

/// <summary>An added/removed/modified set of item names — the shared drift shape. Mirrors @volt/control's
/// ChangeSet contract (serialized in <c>status --json</c>).</summary>
public sealed class ChangeSet
{
    public List<string> Added { get; set; } = new();
    public List<string> Removed { get; set; } = new();
    public List<string> Modified { get; set; } = new();

    public static ChangeSet Empty() => new();
    public int Count => Added.Count + Removed.Count + Modified.Count;
}

public sealed record ProjectId(string Platform, string ProjectName);

/// <summary>Structured platform/projectName mismatch between the workspace binding and the bridge's loaded
/// project, or null when they agree.</summary>
public sealed record ProjectMismatch(ProjectId ConfiguredAs, ProjectId BridgeReports, IReadOnlyList<string> DiffFields);

public sealed record Conflict(string Path, string Kind, string Reason);

public sealed class Merging
{
    public string ProjectVersion { get; set; } = "";
    public List<Conflict> Conflicts { get; set; } = new();
}

/// <summary>The status the text renderer + the --json contract use. The subset {initialized, merging, incoming,
/// outgoing, pathByName, projectMismatch, summary, incomingStale} matches @volt/control's StatusJson;
/// online/detail/recommend are extras the CLI's pretty output uses.</summary>
public sealed class StatusData
{
    public bool Initialized { get; set; }
    public Merging? Merging { get; set; }
    public ChangeSet Incoming { get; set; } = new();
    public ChangeSet Outgoing { get; set; } = new();
    public Dictionary<string, string> PathByName { get; set; } = new();
    public ProjectMismatch? ProjectMismatch { get; set; }

    /// <summary>Items the IDE holds that the bridge could not READ, by bare name — normally empty.
    ///
    /// <para>They have no file in the workspace and no version in <c>items</c>, so nothing else in this model
    /// mentions them: an unreadable POU is simply ABSENT, which is indistinguishable from one that was never
    /// there. It happened to a real project — one box whose <c>En</c> pin read as a boolean made a body
    /// unreadable and the whole POU vanished from git with no error anywhere (DIALECT C7). The bridge has
    /// published the names since; no client showed them until now.</para></summary>
    public List<string> Unreadable { get; set; } = new();

    /// <summary>Folders the bridge could not ENUMERATE — normally empty. Non-empty means the item list is a
    /// partial view, so <see cref="Incoming"/> reports no deletions and neither should anything downstream:
    /// absence proves nothing about a subtree nobody could read.</summary>
    public List<string> UnwalkedFolders { get; set; } = new();

    public string Summary { get; set; } = "";
    /// <summary>TRUE when this status skipped the IDE walk (`volt status --local`), so <see cref="Incoming"/> was
    /// not computed. An empty Incoming then means "we didn't ask", NOT "the IDE has nothing for you" — a client
    /// must keep showing the last known incoming rather than clearing it. ON the wire (@volt/control's
    /// <c>status.ts</c> depends on it) — it belongs ABOVE the JsonIgnore'd block below, not inside it.</summary>
    public bool IncomingStale { get; set; }
    // Pretty-output extras — NOT part of the --json contract (@volt/control's StatusJson doesn't carry them), so
    // JsonIgnore'd and `status --json`/`pull --json` serialize StatusData directly instead of a hand-kept subset.
    [JsonIgnore] public bool Online { get; set; }
    [JsonIgnore] public string Detail { get; set; } = "";
    [JsonIgnore] public string? Recommend { get; set; }
}

/// <summary>The pull outcome (mirrors the TS client's PullResult / @volt/control's PullOutcome). Nullable fields +
/// omit-when-null serialize each kind's exact shape: ok{synced,status}, refused{reason}, conflict{paths,status}.</summary>
public sealed class PullResult
{
    public string Kind { get; set; } = "";
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public List<string>? Synced { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Message { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public StatusData? Status { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Reason { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public List<string>? Paths { get; set; }

    public static PullResult Ok(List<string> synced, StatusData? status, string? message = null) =>
        new() { Kind = ResultKinds.Ok, Synced = synced, Status = status, Message = message };
    public static PullResult Refused(string reason) => new() { Kind = ResultKinds.Refused, Reason = reason };
    public static PullResult Conflict(List<string> paths, StatusData? status) =>
        new() { Kind = ResultKinds.Conflict, Paths = paths, Status = status };
}

/// <summary>The push outcome: ok{items,status} | rejected{reason}.</summary>
public sealed class PushResult
{
    public string Kind { get; set; } = "";
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public List<string>? Items { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Message { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public StatusData? Status { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Reason { get; set; }

    public static PushResult Ok(List<string> items, StatusData? status, string? message = null) =>
        new() { Kind = ResultKinds.Ok, Items = items, Status = status, Message = message };
    public static PushResult Rejected(string reason) => new() { Kind = ResultKinds.Rejected, Reason = reason };
}

/// <summary>The init outcome: ok{project, gitCreated, pulled, scaffold, corpus, note?} | error{reason}.</summary>
public sealed class InitResult
{
    public string Kind { get; set; } = "";
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Project { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Workspace { get; set; } // the folder init created/used (git-clone target)
    public bool GitCreated { get; set; }
    public int Pulled { get; set; }
    public int Scaffold { get; set; }
    public int Corpus { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Note { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Reason { get; set; }

    public static InitResult Ok(string project, string workspace, bool gitCreated, int pulled, int scaffold, int corpus, string? note = null) =>
        new() { Kind = ResultKinds.Ok, Project = project, Workspace = workspace, GitCreated = gitCreated, Pulled = pulled, Scaffold = scaffold, Corpus = corpus, Note = note };
    public static InitResult Error(string reason) => new() { Kind = ResultKinds.Error, Reason = reason };
}

/// <summary>The build outcome: ok{success, duration, diagnostics} | refused{reason}.
///
/// <para><b>A REFUSAL IS NOT A FAILED BUILD.</b> This was the one CLI result type with no discriminator, and
/// `Refuse` manufactured `success:false` plus a synthetic `BridgeDiagnostic` carrying the refusal text. Three
/// conditions went through it — no workspace binding, WRONG_PROJECT, PLC_DISCONNECTED — and came out
/// byte-for-byte the shape of a project that compiled and found one error: a severity, a message,
/// `success:false`, exit 2, with no code and no name to tell them apart. So "the wrong project is open" read as
/// "your code does not compile", and `volt build --json` handed an agent a fabricated compiler diagnostic.</para>
///
/// <para>It was inconsistent with its siblings too: `pull` and `push` map the same two precondition refusals to
/// exit 1 with the reason on stderr. Exit 2 now means what it means everywhere else — the op ran and the answer
/// was no.</para></summary>
public sealed class BuildResult
{
    public string Kind { get; set; } = ResultKinds.Ok;
    public bool Success { get; set; }
    public double Duration { get; set; }
    public List<Volt.Contracts.BridgeDiagnostic> Diagnostics { get; set; } = new();
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Reason { get; set; }

    public static BuildResult Refuse(string reason) => new() { Kind = ResultKinds.Refused, Success = false, Reason = reason };
}
