using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Ide;
using Volt.Engine.Wire;

using Volt.Cli.Transport;
using Volt.Cli.Transport.Wire;

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
    public override string Vendor => Vendors.Codesys;
    // LIVE, not the cached row: reads the primary project's path off the object model, so it must only be called on
    // the primary thread — which is where the in-op guard runs. Same value BuildProjects() snapshots.
    public override string? ServedProjectName => IsConnected ? _om.ProjectName : null;
    public override string? IdeVersion => "3.5";

    /// <summary>CODESYS startup attach: snapshot health on the primary thread (called by its own PipeHost, not Core).</summary>
    public void Connect() => SnapshotHealth();
    public override void Disconnect() { ClearDegraded(); }

    /// <summary>Refresh the cached health snapshot from the in-proc object model's TOP-LEVEL state (project
    /// name/dirty/open + the one-project instances list) — no tree walk. MUST run on the primary thread:
    /// <see cref="Connect"/> / <see cref="SelectProject"/> call it directly (already on it), the async probe via
    /// <see cref="RunOnStaThread{T}"/>. So a new binding shows in health at once. Parallels the TwinCAT driver's
    /// SnapshotHealth. Cheap here (the one in-proc primary project), so the instances list rides along with health;
    /// on TwinCAT the same snapshot carries the heavier ROT walk.</summary>
    protected override void SnapshotHealth()
    {
        bool has = _om.HasPrimaryProject;
        // `serving` must reflect THIS snapshot's freshly-read state, not the cached _hasProject (still the old value
        // until the publication below). Reading IsConnected inside BuildProjects would lag one cycle on the
        // project-open transition — reporting serving=false for ~4s after Connect and bouncing a pull/push with
        // PLC_DISCONNECTED.
        bool connected = _dispatcher != null && has && _om.HasObjectManager;
        var projects = BuildProjects(connected);
        // _hasProject FIRST, THEN the rows. The row cache lives in DriverBase now, so these are two publication
        // instants where they used to be one lock scope — and the order is not free. Publishing rows first opens
        // exactly the window the comment above records: a row visible as `serving` while IsConnected still reads
        // false, i.e. OpGuard bouncing a pull/push with PLC_DISCONNECTED. This order can only make IsConnected
        // early, never late. (_hasProject is volatile, so the write is its own release.)
        _hasProject = has;
        PublishRows(projects);
        if (has && IsDegraded) ClearDegraded();
    }

    protected override T MarshalToIdeThread<T>(Func<T> fn) => _dispatcher == null ? fn() : _dispatcher.Run(fn);

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

    // No BuildHealthResponse/TriggerAsyncProbe/ProbeThrottleMs here: DriverBase composes the response and owns the
    // probe, and this driver takes Core's default floor (DriverBase.DefaultProbeThrottleMs) instead of overriding it.
    // The in-proc snapshot is cheap, but it still runs on the engineer's PRIMARY thread, and it used to run once per
    // poll per frontend — tray + every VS Code workspace + the desktop window, each on its own 4s clock. NB the floor
    // is well BELOW that 4s: _hasProject (the OpGuard precondition, written only by this probe) is refreshed by every
    // client poll exactly as before, so its staleness stays bounded by the slowest client's poll, not by the floor —
    // which is why the number is 1000 and not TwinCAT's 5000. Cached list, live verdict: CODESYS never marks degraded
    // (in-proc), but a hung/closed IDE stops responding to the probe, so staleness demotes it from a frozen "healthy"
    // — see DriverBase.OverlayLiveHealth.

    public override void FlushPendingWrites() { /* writes commit immediately via SetObject */ }

    public override bool Build() =>
        _om.Build(_om.FindApplication() ?? throw new InvalidOperationException("CODESYS: no Application to build"));

    // The precompile + read — FetchService calls this only when a .library version changed.
    public override IReadOnlyList<Volt.Engine.Library.LibSignature> ExtractLibrarySignatures() =>
        _om.ExtractLibrarySignatures();

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
