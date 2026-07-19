namespace Volt.Cli.Connector
{
    /// <summary>
    /// The opaque attach reference a <see cref="IProjectSource"/> needs to bind a project. Vendor-neutral fields
    /// that cover both mechanisms without the model knowing either: TwinCAT uses (DTE instance, TwinCAT project,
    /// PLC project); CODESYS uses just the project name (Instance/SubProject null). Only the owning source reads
    /// these back — the UI never does.
    /// </summary>
    public sealed record ProjectRef(string? Instance, string Project, string? SubProject = null);

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
        ProjectRef Attach)   // the owning source's bind payload (opaque to the UI)
    {
        /// <summary>Build the stable id from the vendor + attach coordinates, so the same open project keeps the
        /// same id across refreshes (selection survives re-enumeration).</summary>
        public static string MakeId(string vendor, ProjectRef a) =>
            string.Join(":", vendor, a.Instance ?? "", a.Project, a.SubProject ?? "");
    }
}
