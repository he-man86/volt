using System.Text.Json.Serialization;

namespace Volt.Cli.Sync;

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
/// outgoing, pathByName, projectMismatch, summary} matches @volt/control's StatusJson; online/detail/recommend
/// are extras the CLI's pretty output uses.</summary>
public sealed class StatusData
{
    public bool Initialized { get; set; }
    public Merging? Merging { get; set; }
    public ChangeSet Incoming { get; set; } = new();
    public ChangeSet Outgoing { get; set; } = new();
    public Dictionary<string, string> PathByName { get; set; } = new();
    public ProjectMismatch? ProjectMismatch { get; set; }
    public string Summary { get; set; } = "";
    public bool Online { get; set; }
    public string Detail { get; set; } = "";
    public string? Recommend { get; set; }
    /// <summary>TRUE when this status skipped the IDE walk (`volt status --local`), so <see cref="Incoming"/> was
    /// not computed. An empty Incoming then means "we didn't ask", NOT "the IDE has nothing for you" — a client
    /// must keep showing the last known incoming rather than clearing it.</summary>
    public bool IncomingStale { get; set; }
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
        new() { Kind = "ok", Synced = synced, Status = status, Message = message };
    public static PullResult Refused(string reason) => new() { Kind = "refused", Reason = reason };
    public static PullResult Conflict(List<string> paths, StatusData? status) =>
        new() { Kind = "conflict", Paths = paths, Status = status };
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
        new() { Kind = "ok", Items = items, Status = status, Message = message };
    public static PushResult Rejected(string reason) => new() { Kind = "rejected", Reason = reason };
}

/// <summary>The init outcome: ok{project, gitCreated, pulled, scaffold, corpus, note?} | error{reason}.</summary>
public sealed class InitResult
{
    public string Kind { get; set; } = "";
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Project { get; set; }
    public bool GitCreated { get; set; }
    public int Pulled { get; set; }
    public int Scaffold { get; set; }
    public int Corpus { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Note { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Reason { get; set; }

    public static InitResult Ok(string project, bool gitCreated, int pulled, int scaffold, int corpus, string? note = null) =>
        new() { Kind = "ok", Project = project, GitCreated = gitCreated, Pulled = pulled, Scaffold = scaffold, Corpus = corpus, Note = note };
    public static InitResult Error(string reason) => new() { Kind = "error", Reason = reason };
}

/// <summary>The build outcome — success + duration + normalized diagnostics (reuses Core's BridgeDiagnostic).</summary>
public sealed class BuildResult
{
    public bool Success { get; set; }
    public double Duration { get; set; }
    public List<Volt.Engine.Wire.BridgeDiagnostic> Diagnostics { get; set; } = new();

    public static BuildResult Refuse(string message) => new()
    {
        Success = false,
        Diagnostics = new() { new() { Severity = "error", Message = message } },
    };
}
