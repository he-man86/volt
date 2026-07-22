using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Ide;
using Volt.Engine.Wire;

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
    private string? _projectName;
    private bool _projectDirty;
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
    public override string? IdeName => "CODESYS";
    public override string? IdeVersion => "3.5";

    /// <summary>Snapshot the project name/dirty/open flags on the primary thread (we are on it at startup).</summary>
    public override void Connect()
    {
        lock (_cacheLock) { _projectName = _om.ProjectName; _projectDirty = _om.ProjectDirty; _hasProject = _om.HasPrimaryProject; }
    }
    public override void Disconnect() { ClearDegraded(); }

    public override T RunOnStaThread<T>(Func<T> fn) => _dispatcher == null ? fn() : _dispatcher.Run(fn);

    // ── project discovery + selection (the connector's instances / select) ──
    /// <summary>The in-proc host serves ONE CODESYS's PRIMARY project, so it reports a single instance/project
    /// (CODESYS has no sub-projects); nothing open → an empty list. This is the InIdeLoad analogue of TwinCAT's
    /// multi-instance ROT enumeration — the connector shows both in the same unified list. The instance id is this
    /// process's pid, so two running CODESYS (even with the same project name) stay distinguishable end-to-end.</summary>
    public override InstancesResult EnumerateInstances()
    {
        var name = _om.ProjectName;
        if (string.IsNullOrEmpty(name)) return new InstancesResult(new List<IdeInstance>());
        var proj = new IdeProject(name!, _om.ProjectDirty, new List<string>());
        var instanceId = System.Diagnostics.Process.GetCurrentProcess().Id.ToString();
        return new InstancesResult(new List<IdeInstance>
        {
            new IdeInstance(instanceId, "CODESYS", IdeVersion, new List<IdeProject> { proj }),
        });
    }

    /// <summary>The in-proc host can only serve the primary project of the CODESYS it was loaded into (it can't
    /// switch to another process's project), so `select` confirms/refreshes that binding rather than switching —
    /// and the connector only ever offers this one CODESYS project. Selecting anything else is a no-op refresh.</summary>
    public override void SelectProject(SelectRequest sel)
    {
        lock (_cacheLock) { _projectName = _om.ProjectName; _projectDirty = _om.ProjectDirty; _hasProject = _om.HasPrimaryProject; }
        if (_hasProject && IsDegraded) ClearDegraded();
    }

    // In-process: no transport that can die mid-call, so never auto-degrade.
    public override bool ShouldMarkDegraded(Exception ex) => false;

    public override HealthResponse BuildHealthResponse()
    {
        string? name; bool dirty;
        lock (_cacheLock) { name = _projectName; dirty = _projectDirty; }
        TriggerAsyncProbe();
        return BuildHealth("codesys", IsConnected, ideAlive: _dispatcher != null, IdeName, IdeVersion, name, dirty);
    }

    public override void TriggerAsyncProbe() => RunProbeOnce(() =>
    {
        var (n, d, has) = RunOnStaThread(() => (_om.ProjectName, _om.ProjectDirty, _om.HasPrimaryProject));
        lock (_cacheLock) { _projectName = n; _projectDirty = d; _hasProject = has; }
    });

    public override void FlushPendingWrites() { /* writes commit immediately via SetObject */ }

    public override bool Build() =>
        _om.Build(_om.FindApplication() ?? throw new InvalidOperationException("CODESYS: no Application to build"));

    // The precompile + read — run only on a fingerprint miss (DriverBase caches the result).
    protected override IReadOnlyList<Volt.Engine.Library.LibSignature> ExtractLibrarySignaturesUncached() =>
        _om.ExtractLibrarySignatures();

    // Build-FREE fingerprint: the sorted referenced-library manifests (each encodes name+version+deps — the same
    // string the .library items use as their version-hash input). No precompile — read from Library-Manager metadata.
    protected override string ReferencedLibraryFingerprint() =>
        string.Join("\n", LibraryRefManifests());

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
