using Volt.Cli.Transport;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// The opaque attach reference a <see cref="IProjectSource"/> needs to bind a project. Vendor-neutral fields
    /// that cover both mechanisms without the model knowing either: TwinCAT uses (DTE instance, TwinCAT project);
    /// CODESYS uses just the project name (Instance null). Only the owning source reads these back — the UI never
    /// does. Identity-only: no PLC-application coordinate — which PLC app to sync is a content concern, not connect.
    /// </summary>
    public sealed record ProjectRef(string? Instance, string Project);

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
        bool Serving = false, // GROUND TRUTH off the wire row: this project's bridge is serving it right now (the
                              // host stamps exactly one serving row per bridge, and clears it while paused). The
                              // connector reads this straight through instead of re-probing each project's bridge.
        string Status = HealthStatus.Healthy) // the wire row's channel health — healthy | degraded (only on the
                                   // serving row). Carried so the ONE array is fully self-describing: the UI reads
                                   // degraded off the row, with no separate per-vendor bridge-health view.
    {
        /// <summary>Build the stable id from the vendor + attach coordinates, so the same open project keeps the
        /// same id across refreshes (selection survives re-enumeration). CODESYS's instance is its pid, so two
        /// same-named projects in two processes get distinct ids.</summary>
        public static string MakeId(string vendor, ProjectRef a) =>
            string.Join(":", vendor, a.Instance ?? "", a.Project);
    }
}
