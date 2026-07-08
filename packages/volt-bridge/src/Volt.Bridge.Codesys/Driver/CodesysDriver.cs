using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Bridge.Core.Ide;
using Volt.Bridge.Core.Wire;

namespace Volt.Bridge.Codesys;

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

    /// <summary>Snapshot the project name/dirty/open flags on the primary thread (we are on it at startup), and
    /// subscribe (once) to the IDE's change events so a live edit pushes an SSE /events change.</summary>
    public override void Connect()
    {
        _om.SubscribeChanges(RaiseProjectChanged);
        lock (_cacheLock) { _projectName = _om.ProjectName; _projectDirty = _om.ProjectDirty; _hasProject = _om.HasPrimaryProject; }
    }
    public override void Disconnect() { _om.UnsubscribeChanges(); ClearDegraded(); }

    public override T RunOnStaThread<T>(Func<T> fn) => _dispatcher == null ? fn() : _dispatcher.Run(fn);

    // In-process: no transport that can die mid-call, so never auto-degrade.
    public override bool ShouldMarkDegraded(Exception ex) => false;

    public override HealthResponse BuildHealthResponse()
    {
        string? name; bool dirty;
        lock (_cacheLock) { name = _projectName; dirty = _projectDirty; }
        TriggerAsyncProbe();
        return BuildHealth("codesys", IsConnected, ideAlive: _dispatcher != null, IdeName, IdeVersion, name, name, dirty);
    }

    public override void TriggerAsyncProbe() => RunProbeOnce(() =>
    {
        var (n, d, has) = RunOnStaThread(() => (_om.ProjectName, _om.ProjectDirty, _om.HasPrimaryProject));
        lock (_cacheLock) { _projectName = n; _projectDirty = d; _hasProject = has; }
    });

    public override void FlushPendingWrites() { /* writes commit immediately via SetObject */ }

    public override bool Build() =>
        _om.Build(_om.FindApplication() ?? throw new InvalidOperationException("CODESYS: no Application to build"));

    public override IReadOnlyList<Volt.Bridge.Core.Library.LibSignature> ExtractLibrarySignatures() =>
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
