using Volt.Cli.Transport;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// The attach reference a <see cref="IProjectSource"/> needs to bind a project: its NAME. A project is identified
    /// by name (with the vendor) on both vendors — the `connect` wire op re-resolves it on the live instance that has
    /// it open (the source targets that instance's own pipe).
    /// Only the owning source reads it back — the UI never does. Identity-only: no PLC-application coordinate — which
    /// PLC app to sync is a content concern, not connect.
    /// </summary>
    public sealed record ProjectRef(string Project);

    /// <summary>
    /// A project the connector detected and can connect to — the ONE shape the UI knows about. The vendor is a
    /// field (for the platform prefix/logo and to route a connect to the right source), never a branch in the
    /// UI: the selector shows one list of these across all vendors and the user just picks one.
    /// </summary>
    public sealed record DetectedProject(
        string Id,           // stable selection id, unique across vendors ("codesys:…" / "twincat:…")
        string DisplayName,  // what the user sees — the project name ("MyMachine")
        string Vendor,       // "codesys" | "twincat" — drives the prefix/logo + connect routing
        bool Dirty,          // unsaved-changes indicator (shown as a dot/asterisk)
        ProjectRef Attach,   // the owning source's bind payload (opaque to the UI)
        string? Pipe = null, // the bridge pipe that serves this project (per-pid for CODESYS, the worker pipe for
                             // TwinCAT) — the source targets it, and the CLI/shells read it (VOLT_PIPE for init)
        string? IdeVersion = null, // for the label when a vendor has >1 live instance
        string Status = HealthStatus.Idle) // the wire row's full connection state — idle | healthy | degraded. The
                                   // ONE self-describing field carried straight through: the UI reads serving + the
                                   // degraded distinction off it, with no separate per-vendor bridge-health view.
    {
        /// <summary>GROUND TRUTH: is this project's bridge serving it right now (pull/push work) — a non-idle row.
        /// Derived from <see cref="Status"/>, not stored: the host stamps exactly one non-idle row per bridge and
        /// forces all to idle while paused.</summary>
        public bool Serving => Status != HealthStatus.Idle;

        /// <summary>Build the stable id from the vendor + project name, so the same open project keeps the same id
        /// across refreshes (selection survives re-enumeration). Identity is vendor+name: two projects opened under
        /// the same name at once share an id (the connector collapses them — the accepted name-identity limit).</summary>
        public static string MakeId(string vendor, ProjectRef a) =>
            string.Join(":", vendor, a.Project);
    }
}
