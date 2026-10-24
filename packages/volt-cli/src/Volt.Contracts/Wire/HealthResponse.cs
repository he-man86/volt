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
/// not a row's: its catalog (<see cref="Languages"/>, <see cref="Kinds"/>, <see cref="Ops"/>), <see cref="Unsupported"/>,
/// and the identity (<see cref="ProductName"/>,
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

    /// <summary>Every body language this bridge SHOWS — writes as <c>IMPLEMENTATION &lt;LANG&gt;</c> and reads back on a
    /// push — in ordinal order: its host's declared shown set as this process's network-text switch leaves it (<c>ST</c>
    /// in the shipped build; <c>FBD</c>, <c>LD</c>, <c>ST</c> with network text switched on). A body of any other language
    /// is its <c>IMPLEMENTATION &lt;LANG&gt; UNSUPPORTED</c> line: read-only. A client shows a body as editable only if its
    /// language is listed.</summary>
    [JsonPropertyName("languages")]
    public List<string> Languages { get; set; } = new();

    /// <summary>Every item kind this bridge's host declares with a file extension, in ordinal order: the extension
    /// (without the dot) a path ends in, and whether a push writes it. A push op on a kind that is not writable is a
    /// <c>BAD_REQUEST</c> conflict.</summary>
    [JsonPropertyName("kinds")]
    public List<HealthKind> Kinds { get; set; } = new();

    /// <summary>The PLATFORM version under the product — CODESYS: the framework's own version (`3.5.21.40`, DIALECT V1;
    /// an OEM product's name or number is never in it); TwinCAT: the build the open solution's remote manager states
    /// (`3.1.4024.74`, DIALECT V5). A pure version a client may parse, shown before any call — in particular beside
    /// <see cref="Unsupported"/>. Null when its source does not answer — never derived from
    /// <see cref="ProductVersion"/>.</summary>
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
    /// (`0.1.17258`, what <c>volt --version</c> prints), or <c>(dev) &lt;commit&gt;</c> for an unstamped one. Absent only
    /// when the bridge's own file cannot be read.</summary>
    [JsonPropertyName("bridgeVersion")]
    public string? BridgeVersion { get; set; }

    /// <summary>The wire protocol this bridge speaks, <see cref="WireProtocol.Version"/> — the number every request
    /// states (<c>PipeRequest.protocol</c>); a request stating another is refused <c>PROTOCOL_MISMATCH</c>.</summary>
    [JsonPropertyName("protocol")]
    public int Protocol { get; set; }

    /// <summary>Every op this bridge answers (<c>health</c>, <c>refs</c>, <c>grep</c>, …), from its own dispatch table —
    /// how a client tells what it can ask for.</summary>
    [JsonPropertyName("ops")]
    public List<string> Ops { get; set; } = new();

    /// <summary>Why this bridge serves NOTHING: the IDE lacks something the bridge needs. The fixed English sentence every other op answers with under <c>IDE_UNSUPPORTED</c>. Absent when the
    /// bridge can serve. While it is set, every row is <c>idle</c>.</summary>
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

/// <summary>One item kind a bridge's host declares (<see cref="HealthResponse.Kinds"/>).</summary>
public sealed class HealthKind
{
    /// <summary>The extension a path of this kind ends in, without the dot (<c>pou</c>).</summary>
    [JsonPropertyName("extension")]
    public string Extension { get; set; } = "";

    /// <summary>True when a push writes an item of this kind; false when every push op on one is refused.</summary>
    [JsonPropertyName("writable")]
    public bool Writable { get; set; }
}
