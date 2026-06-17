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

    public CodesysDriver(object? projects)
    {
        _om = new CodesysObjectModel(projects);
        _dispatcher = CodesysDispatcher.TryCreate();
    }

    public bool IsConnected => _dispatcher != null && _om.HasProjects && _om.HasObjectManager;
    public string? IdeName => "CODESYS";
    public string? IdeVersion => "3.5";

    /// <summary>Snapshot the project name/dirty flag on the primary thread (we are on it at startup).</summary>
    public void Connect() { lock (_cacheLock) { _projectName = _om.ProjectName; _projectDirty = _om.ProjectDirty; } }
    public void Disconnect() => ClearDegraded();

    public T RunOnStaThread<T>(Func<T> fn) => _dispatcher == null ? fn() : _dispatcher.Run(fn);

    // In-process: no transport that can die mid-call, so never auto-degrade.
    public override bool ShouldMarkDegraded(Exception ex) => false;

    public HealthResponse BuildHealthResponse()
    {
        string? name; bool dirty;
        lock (_cacheLock) { name = _projectName; dirty = _projectDirty; }
        TriggerAsyncProbe();
        return BuildHealth("codesys", IsConnected, ideAlive: _dispatcher != null, IdeName, IdeVersion, name, name, dirty);
    }

    public void TriggerAsyncProbe() => RunProbeOnce(() =>
    {
        var (n, d) = RunOnStaThread(() => (_om.ProjectName, _om.ProjectDirty));
        lock (_cacheLock) { _projectName = n; _projectDirty = d; }
    });

    public void FlushPendingWrites() { /* writes commit immediately via SetObject */ }

    public bool Build() =>
        _om.Build(_om.FindApplication() ?? throw new InvalidOperationException("CODESYS: no Application to build"));

    public IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics() =>
        _om.GetBuildDiagnostics().Select(d =>
        {
            var m = (Dictionary<string, object?>)d;
            return new BridgeDiagnostic
            {
                Severity = m.TryGetValue("severity", out var s) ? s as string ?? "info" : "info",
                Message = m.TryGetValue("message", out var msg) ? msg as string ?? "" : "",
                Line = m.TryGetValue("line", out var l) && l is int li ? li : 0,
            };
        }).ToList();
}
