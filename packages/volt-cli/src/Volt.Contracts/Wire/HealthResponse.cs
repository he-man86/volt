using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Serialization;

namespace Volt.Contracts;

/// <summary>
/// The ambient-poll response, and it is nothing but a FLAT array of the projects this bridge can serve — one
/// self-describing <see cref="ProjectEntry"/> per project (no nesting, no root fields). `health` is what the
/// connector polls every ~4s (plus every control-plane `/status`); the connector concatenates every bridge's array
/// into the ONE cross-vendor list it shows, and a frontend finds its own row by vendor+name (the row carries no id —
/// the connector mints the id it keys on). Everything is per-row because
/// the merged list mixes vendors and states. Served from a CACHED snapshot, never a live walk on the request — a
/// long op holds the single IDE thread, so a poll that marshalled onto it would stall the connector and read as a
/// lost connection. Per-op results (refs/fetch/push/build) come back from those ops, not here.
/// <para>The wire carries <see cref="Projects"/> and ONE fact about the bridge process itself, <see cref="NetworkText"/>
/// — not a project's, so not a row's; the connector reads only <see cref="Projects"/> and ignores it. The properties below are C#-only conveniences (never
/// serialized) so CLI callers read one intention-revealing value off the SERVING row instead of scanning the list —
/// they cannot drift from it. They are for the CLI only: the connector has its own <c>DetectedProject</c> model and
/// must keep reading <see cref="Projects"/> with its own guards.</para>
/// </summary>
public class HealthResponse
{
    [JsonPropertyName("projects")]
    public List<ProjectEntry> Projects { get; set; } = new();

    /// <summary>Is LD and FBD network text on in this bridge's process (the engine's
    /// <c>NetworkTextSwitch</c>)? Off, every LD and FBD body pulls as its <c>IMPLEMENTATION LD|FBD UNSUPPORTED</c> line.
    /// On the wire because the switch lives in the BRIDGE's environment — in CODESYS itself, or the TwinCAT worker —
    /// which no client can set or see: a corpus refresh through a bridge the connector started (switch off) replaced
    /// every ladder in the corpus with that line, and the file count it checked still matched. A client that needs
    /// network text (<c>refresh:corpus</c>, <c>record:language</c>) asks here first. Absent reads as false: off.</summary>
    [JsonPropertyName("networkText")]
    public bool NetworkText { get; set; }

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

    /// <summary>The bridge's vendor. A bridge is one vendor, so any row's vendor answers — "" when empty.</summary>
    [JsonIgnore]
    public string Platform => Projects.Count > 0 ? Projects[0].Vendor : "";

    /// <summary>The bridge's overall liveness word: the served row's status, or "unavailable" when nothing serves.</summary>
    [JsonIgnore]
    public string Status => ServingProject?.Status ?? HealthStatus.Unavailable;
}
