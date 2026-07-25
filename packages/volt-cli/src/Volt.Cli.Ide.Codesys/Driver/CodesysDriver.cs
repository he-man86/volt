using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Ide;
using Volt.Engine.Wire;

using Volt.Cli.Transport;

namespace Volt.Cli.Ide.Codesys;

/// <summary>
/// The CODESYS IDE driver: implements the Core <see cref="IIdeDriver"/> over the live project reached
/// in-process through the .NET object model (<see cref="CodesysObjectModel"/>, reflection-only — no
/// CODESYS assembly references). Every object-model touch is marshalled onto the CODESYS primary thread
/// via <see cref="RunOnStaThread{T}"/> (the HTTP server wraps each handler in it). Split across partial
/// files by interface facet: this file is the session; <c>.Tree</c> and <c>.Code</c> are the others.
/// </summary>
public sealed partial class CodesysDriver : DriverBase, IIdeDriver
{
    private readonly CodesysObjectModel _om;
    private readonly CodesysDispatcher? _dispatcher;

    private readonly object _cacheLock = new();
    private List<ProjectEntry> _projects = new(); // cached from the primary thread; served off-thread in the health response
    private volatile bool _hasProject; // cached from the primary thread (HasPrimaryProject); read off-thread by IsConnected

    public CodesysDriver(object? projects)
    {
        _om = new CodesysObjectModel(projects);
        _dispatcher = CodesysDispatcher.TryCreate();
    }

    // Keyed on whether a project is actually OPEN (cached _hasProject), not just the persistent projects
    // collection (HasProjects) — otherwise a closed project still reports "connected" with a null project name.
    // A reopen recovers on its own: the live PrimaryProject lookup makes the next probe flip _hasProject back.
    public override bool IsConnected => _dispatcher != null && _hasProject && _om.HasObjectManager;
    public override string? IdeVersion => "3.5";

    public override void Connect() => SnapshotHealth();   // on the primary thread at startup
    public override void Disconnect() { ClearDegraded(); }

    /// <summary>Refresh the cached health snapshot from the in-proc object model's TOP-LEVEL state (project
    /// name/dirty/open + the one-project instances list) — no tree walk. MUST run on the primary thread:
    /// <see cref="Connect"/> / <see cref="SelectProject"/> call it directly (already on it), the async probe via
    /// <see cref="RunOnStaThread{T}"/>. So a new binding shows in health at once. Parallels the TwinCAT driver's
    /// SnapshotHealth. Cheap here (the one in-proc primary project), so the instances list rides along with health;
    /// on TwinCAT the same snapshot carries the heavier ROT walk.</summary>
    private void SnapshotHealth()
    {
        bool has = _om.HasPrimaryProject;
        // `serving` must reflect THIS snapshot's freshly-read state, not the cached _hasProject (still the old value
        // until the lock below). Reading IsConnected inside BuildProjects would lag one cycle on the project-open
        // transition — reporting serving=false for ~4s after Connect and bouncing a pull/push with PLC_DISCONNECTED.
        bool connected = _dispatcher != null && has && _om.HasObjectManager;
        var projects = BuildProjects(connected);
        lock (_cacheLock) { _hasProject = has; _projects = projects; }
        if (has && IsDegraded) ClearDegraded();
    }

    public override T RunOnStaThread<T>(Func<T> fn) => _dispatcher == null ? fn() : _dispatcher.Run(fn);

    /// <summary>The in-proc host serves ONE CODESYS's PRIMARY project, so it reports a single project row (CODESYS has
    /// no sub-projects); nothing open → an empty list. This is the InIdeLoad analogue of TwinCAT's multi-instance ROT
    /// enumeration — the connector concatenates both into the same unified list. A project is identified by its NAME;
    /// two running CODESYS on the same-named project reach the same wire identity (the per-pid PIPE, not a row field,
    /// is what still routes each). The one project is always `serving` when connected (the in-proc host is bound to
    /// it); CODESYS never degrades (in-proc).</summary>
    private List<ProjectEntry> BuildProjects(bool serving)
    {
        var name = _om.ProjectName;
        if (string.IsNullOrEmpty(name)) return new List<ProjectEntry>();
        return new List<ProjectEntry>
        {
            new ProjectEntry(Vendors.Codesys, IdeVersion, name!, RowStatus(serving), _om.ProjectDirty),
        };
    }

    /// <summary>The in-proc host can only serve the primary project of the CODESYS it was loaded into (it can't
    /// switch to another process's project), so `select` confirms/refreshes that binding rather than switching —
    /// and the connector only ever offers this one CODESYS project. Selecting anything else is a no-op refresh.</summary>
    public override void SelectProject(ConnectRequest sel) => SnapshotHealth();   // confirm/refresh the one primary project

    // In-process: no transport that can die mid-call, so never auto-degrade.
    public override bool ShouldMarkDegraded(Exception ex) => false;

    public override HealthResponse BuildHealthResponse()
    {
        List<ProjectEntry> projects;
        lock (_cacheLock) { projects = _projects; }
        TriggerAsyncProbe();
        return new HealthResponse { Projects = projects };
    }

    public override void TriggerAsyncProbe() => RunProbeOnce(() => RunOnStaThread(() => { SnapshotHealth(); return 0; }));

    public override void FlushPendingWrites() { /* writes commit immediately via SetObject */ }

    public override bool Build() =>
        _om.Build(_om.FindApplication() ?? throw new InvalidOperationException("CODESYS: no Application to build"));

    // The precompile + read — FetchService calls this only when a .library version changed.
    public override IReadOnlyList<Volt.Engine.Library.LibSignature> ExtractLibrarySignatures() =>
        _om.ExtractLibrarySignatures();

    public override IReadOnlyList<System.Collections.Generic.IReadOnlyDictionary<string, string>> DebugLibrarySignatures(string? nameFilter) =>
        _om.DebugLibrarySignatures(nameFilter);

    // DEBUG (read-only): reflect the object model's change-detection surface (runs on the primary thread).
    public override string DebugReflect(string target) => _om.ReflectMembers(target);

    public override IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics() =>
        _om.GetBuildDiagnostics().Select(d =>
        {
            var m = (Dictionary<string, object?>)d;
            return new BridgeDiagnostic
            {
                Severity = m.TryGetValue("severity", out var s) ? s as string ?? "info" : "info",
                Message = m.TryGetValue("message", out var msg) ? msg as string ?? "" : "",
                Line = m.TryGetValue("line", out var l) && l is int li ? li : 0,
                Column = m.TryGetValue("column", out var c) && c is int ci ? ci : 0,
            };
        }).ToList();
}
