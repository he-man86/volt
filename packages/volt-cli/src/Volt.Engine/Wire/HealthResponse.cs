using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Serialization;

using Volt.Cli.Transport;

namespace Volt.Engine.Wire;

/// <summary>
/// The ambient-poll response, and it is nothing but a FLAT array of the projects this bridge can serve — one
/// self-describing <see cref="ProjectEntry"/> per project (no nesting, no root fields). `health` is what the
/// connector polls every ~4s (plus every control-plane `/status`); the connector concatenates every bridge's array
/// into the ONE cross-vendor list it shows, and a frontend finds its own row by id. Everything is per-row because
/// the merged list mixes vendors and states. Served from a CACHED snapshot, never a live walk on the request — a
/// long op holds the single IDE thread, so a poll that marshalled onto it would stall the connector and read as a
/// lost connection. Per-op results (refs/fetch/push/build) come back from those ops, not here.
/// <para>The wire carries only <see cref="Projects"/>. The properties below are C#-only conveniences (never
/// serialized) so CLI callers read one intention-revealing value off the SERVING row instead of scanning the list —
/// they cannot drift from it.</para>
/// </summary>
public class HealthResponse
{
    [JsonPropertyName("projects")]
    public List<ProjectEntry> Projects { get; set; } = new();

    /// <summary>The one project this bridge is serving right now, or null (paused / nothing attached). "Serving" is a
    /// non-idle row — the status field carries it (there is no separate serving flag).</summary>
    [JsonIgnore]
    public ProjectEntry? ServingProject => Projects.FirstOrDefault(p => p.Status != HealthStatus.Idle);

    /// <summary>Is this bridge serving a project (pull/push work).</summary>
    [JsonIgnore]
    public bool Connected => ServingProject != null;

    /// <summary>The served project's name, or null.</summary>
    [JsonIgnore]
    public string? ProjectName => ServingProject?.Project;

    /// <summary>The served project's unsaved-changes flag.</summary>
    [JsonIgnore]
    public bool ProjectDirty => ServingProject?.Dirty ?? false;

    /// <summary>The bridge's vendor. A bridge is one vendor, so any row's vendor answers — "" when empty.</summary>
    [JsonIgnore]
    public string Platform => Projects.Count > 0 ? Projects[0].Vendor : "";

    /// <summary>The bridge's overall liveness word: the served row's status, or "unavailable" when nothing serves.</summary>
    [JsonIgnore]
    public string Status => ServingProject?.Status ?? HealthStatus.Unavailable;
}
