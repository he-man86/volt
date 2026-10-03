using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Serialization;

namespace Volt.Contracts;

/// <summary>
/// The ambient-poll response, and it is nothing but a FLAT array of the projects this bridge can serve — one
/// self-describing <see cref="ProjectEntry"/> per project (no nesting; the root carries only process facts, below). `health` is what the
/// connector polls every ~4s (plus every control-plane `/status`); the connector concatenates every bridge's array
/// into the ONE cross-vendor list it shows, and a frontend finds its own row by vendor+name (the row carries no id —
/// the connector mints the id it keys on). Everything is per-row because
/// the merged list mixes vendors and states. Served from a CACHED snapshot, never a live walk on the request — a
/// long op holds the single IDE thread, so a poll that marshalled onto it would stall the connector and read as a
/// lost connection. Per-op results (refs/fetch/push/build) come back from those ops, not here.
/// <para>The wire carries <see cref="Projects"/> and the facts about the bridge PROCESS itself — not a project's, so
/// not a row's: <see cref="NetworkText"/>, <see cref="Unsupported"/>, and the identity (<see cref="ProductName"/>,
/// <see cref="ProductVersion"/>, <see cref="ProductVendor"/>, <see cref="IdeVersion"/>, <see cref="BridgeVersion"/>).
/// A process fact sits at top level so a frame with no rows (no project open, an unsupported IDE) still carries it —
/// exactly when a support case needs it. The connector stamps <see cref="Unsupported"/> and the identity onto every
/// row it detects from this frame. Each identity field is null (absent) when its source does not answer — never
/// filled from another field, a path or a file name — and none of them decides whether the bridge serves (openspec
/// ide-identity-report). The properties below are C#-only conveniences (never
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

    /// <summary>The PLATFORM version under the product — CODESYS: the framework's own version (`3.5.21.40`, DIALECT V1;
    /// an OEM product's name or number is never in it); TwinCAT: the build the open solution's remote manager states
    /// (`3.1.4024.74`, DIALECT V5). A pure version a client may parse, shown before any call — in particular beside
    /// <see cref="Unsupported"/>. Null when its source does not answer — never derived from
    /// <see cref="ProductVersion"/>. Each row carries the same value as its <c>version</c>.</summary>
    [JsonPropertyName("ideVersion")]
    public string? IdeVersion { get; set; }

    /// <summary>What the user runs, as the IDE names itself — CODESYS: <c>OEMCustomization.ProductName</c>
    /// (`CODESYS`, or the OEM's own name); TwinCAT: the shell's <c>DTE.Name</c> (`TcXaeShell`).</summary>
    [JsonPropertyName("productName")]
    public string? ProductName { get; set; }

    /// <summary>That product's own version, verbatim — CODESYS: the IDE exe's <c>ProductVersion</c> (`3.5.21.40`, or an
    /// OEM's own number, DIALECT V4); TwinCAT: <c>DTE.Version</c> (`15.0`, DIALECT V5). Shown, never parsed.</summary>
    [JsonPropertyName("productVersion")]
    public string? ProductVersion { get; set; }

    /// <summary>The product's manufacturer as the IDE's exe states it (<c>CompanyName</c>) — `CODESYS Development GmbH`,
    /// `Beckhoff`, or an OEM's. Null when the exe states none; never inferred from a file name or path.</summary>
    [JsonPropertyName("productVendor")]
    public string? ProductVendor { get; set; }

    /// <summary>The bridge's release (<see cref="BridgeRelease"/>): the stamped file version of a release build
    /// (`0.1.17258`, what <c>volt --version</c> prints), or <c>(dev) &lt;commit&gt;</c> for an unstamped one. A new
    /// bridge always sends it when its own file is readable, so a frame without it is an older bridge.</summary>
    [JsonPropertyName("bridgeVersion")]
    public string? BridgeVersion { get; set; }

    /// <summary>Why this bridge serves NOTHING: the IDE lacks something the bridge needs. The fixed English sentence
    /// every other op answers with under <c>IDE_UNSUPPORTED</c>. Absent when the IDE has everything. While it is set,
    /// every row is <c>idle</c>.</summary>
    [JsonPropertyName("unsupported")]
    public string? Unsupported { get; set; }

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
