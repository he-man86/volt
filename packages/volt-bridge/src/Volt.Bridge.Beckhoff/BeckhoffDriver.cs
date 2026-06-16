using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using Volt.Bridge.Core.Ide;
using Volt.Bridge.Core.Wire;

namespace Volt.Bridge.Beckhoff;

/// <summary>
/// The TwinCAT/Beckhoff IDE driver: implements the Core <see cref="IIdeDriver"/> over a running TwinCAT
/// XAE attached via COM (the automation interfaces on the DTE / system manager). COM objects are
/// reached late-bound through <c>dynamic</c> — that lives ONLY here, behind the typed <see cref="ItemRef"/>
/// boundary, never in Core. Split across partial files by interface facet: this file is the session
/// (connect / health / STA loop / build); <c>.Tree</c> and <c>.Code</c> are the others.
/// </summary>
public sealed partial class BeckhoffDriver : DriverBase, IIdeDriver, IInstanceProvider
{
    private readonly BlockingCollection<Action> _staQueue = new();
    private readonly object _cacheLock = new();
    private dynamic? _dte;
    private dynamic? _sysManager;
    private dynamic? _plcNode;
    private string? _projectName;
    private string? _plcProjectPath;
    private string? _ideProgId;
    private string? _ideVersion;

    private bool _cachedIdeAlive;
    private string? _cachedProjectName;
    private string? _cachedPlcProjectName;
    private bool? _cachedProjectDirty;
    private long _cachedAtMs;
    private bool _probeInFlight;

    public bool IsConnected => _dte != null && _sysManager != null && _plcProjectPath != null;

    public string? IdeName => _ideProgId switch
    {
        "VisualStudio.DTE.17.0" => "Visual Studio 2022",
        "VisualStudio.DTE.16.0" => "Visual Studio 2019",
        "TcXaeShell.DTE.15.0" => "TcXaeShell",
        _ => _ideProgId,
    };
    public string? IdeVersion => _ideVersion;

    // ── COM attach ──────────────────────────────────────────────────
    [DllImport("oleaut32.dll", PreserveSig = false)]
    private static extern void GetActiveObject(ref Guid rclsid, IntPtr pvReserved,
        [MarshalAs(UnmanagedType.IUnknown)] out object ppunk);

    private static object GetComObject(string progId)
    {
        var type = Type.GetTypeFromProgID(progId, throwOnError: true)!;
        Guid clsid = type.GUID;
        GetActiveObject(ref clsid, IntPtr.Zero, out object obj);
        return obj;
    }

    /// <summary>All running TwinCAT instances + projects (for the connector's picker).</summary>
    public object ListInstances() => RotInstances.Enumerate();

    public void Connect()
    {
        var targetInstance = Environment.GetEnvironmentVariable("VOLT_TC_INSTANCE");
        var targetProject = Environment.GetEnvironmentVariable("VOLT_TC_PROJECT");
        var targetPlc = Environment.GetEnvironmentVariable("VOLT_TC_PLC");

        if (!string.IsNullOrEmpty(targetInstance))
        {
            _dte = RotInstances.Bind(targetInstance);
            if (_dte != null)
            {
                _ideProgId = RotInstances.ProgId(targetInstance);
                try { _ideVersion = (string?)_dte!.Version; } catch { /* version is cosmetic */ }
            }
        }
        if (_dte == null)   // no target (or it vanished) → first active instance
        {
            string[] progIds = ["VisualStudio.DTE.17.0", "VisualStudio.DTE.16.0", "TcXaeShell.DTE.15.0"];
            foreach (var progId in progIds)
            {
                try
                {
                    _dte = GetComObject(progId);
                    _ideProgId = progId;
                    try { _ideVersion = (string?)_dte!.Version; } catch { /* version is cosmetic */ }
                    break;
                }
                catch (COMException) { continue; }
            }
        }
        if (_dte == null) throw new InvalidOperationException("No running TwinCAT XAE instance found.");
        FindTwinCatProject(string.IsNullOrEmpty(targetProject) ? null : targetProject);
        FindPlcProject(string.IsNullOrEmpty(targetPlc) ? null : targetPlc);
    }

    private void FindTwinCatProject(string? wantProject)
    {
        dynamic solution = _dte!.Solution;
        dynamic projects = solution.Projects;
        int count = projects.Count;
        for (int i = 1; i <= count; i++)
        {
            try
            {
                dynamic proj = projects.Item(i);
                if (wantProject != null)
                {
                    string nm;
                    try { nm = (string)proj.Name; } catch { continue; }
                    if (nm != wantProject) continue;
                }
                dynamic obj = proj.Object;   // TcXaeShell: proj.Object IS the SystemManager
                try { _sysManager = obj; } catch { _sysManager = null; }

                if (_sysManager != null)
                {
                    _projectName = proj.Name;
                    try { dynamic plcProj = _sysManager.PlcProject; _plcProjectPath = plcProj?.ProjectPath; }
                    catch
                    {
                        try
                        {
                            var pp = _sysManager.LookupTreeItem("TIPC");
                            if (pp != null) { try { _plcProjectPath = pp.Child[1]?.ProjectPath ?? pp.Child[1]?.Name; } catch { } }
                        }
                        catch { }
                    }
                }
                if (_sysManager == null)   // full VS: obj.SystemManager
                {
                    try
                    {
                        _sysManager = obj.SystemManager;
                        _projectName = proj.Name;
                        try { dynamic plcProj = _sysManager.PlcProject; _plcProjectPath = plcProj?.ProjectPath; } catch { }
                    }
                    catch { continue; }
                }
                if (_sysManager != null) break;
            }
            catch { }
        }
        if (_sysManager == null) throw new InvalidOperationException("No TwinCAT project found in solution.");
    }

    private void FindPlcProject(string? wantPlc)
    {
        if (wantPlc == null && _plcProjectPath != null) { _plcNode = LookupTreeItem(_plcProjectPath); return; }
        try
        {
            dynamic tipc = _sysManager!.LookupTreeItem("TIPC");
            int childCount = tipc.ChildCount;
            for (int i = 1; i <= childCount; i++)
            {
                try
                {
                    dynamic plc = tipc.Child[i];
                    string name = plc.Name;
                    if (wantPlc != null && name != wantPlc) continue;
                    _plcNode = plc; _plcProjectPath = name; break;
                }
                catch { }
            }
        }
        catch { }
        if (_plcNode == null && _plcProjectPath != null) _plcNode = LookupTreeItem(_plcProjectPath);
        if (_plcNode == null) throw new InvalidOperationException("Cannot find PLC project under TIPC.");
    }

    private dynamic LookupTreeItem(string path) => _sysManager!.LookupTreeItem(path);

    // ── STA thread ──────────────────────────────────────────────────
    public void RunStaMessageLoop(CancellationToken cancel)
    {
        while (!cancel.IsCancellationRequested)
        {
            if (_staQueue.TryTake(out var action, 100))
            {
                try { action(); } catch { /* per-item failure already surfaced to its caller via the result */ }
            }
            else { try { Thread.Sleep(10); } catch { } }
        }
    }

    public T RunOnStaThread<T>(Func<T> func)
    {
        using var evt = new ManualResetEventSlim(false);
        T result = default!;
        Exception? error = null;
        _staQueue.Add(() =>
        {
            try { result = func(); }
            catch (Exception ex) { error = ex; }
            finally { evt.Set(); }
        });
        if (!evt.Wait(TimeSpan.FromSeconds(30))) throw new TimeoutException("STA operation timed out");
        if (error != null) throw error;
        return result;
    }

    // ── health ──────────────────────────────────────────────────────
    public HealthResponse BuildHealthResponse()
    {
        bool ideAlive; string? projectName, plcProjectName; bool? projectDirty; long? ageMs;
        lock (_cacheLock)
        {
            ideAlive = _cachedIdeAlive;
            projectName = _cachedProjectName;
            plcProjectName = _cachedPlcProjectName;
            projectDirty = _cachedProjectDirty;
            ageMs = _cachedAtMs == 0 ? null : Environment.TickCount64 - _cachedAtMs;
        }
        if (ageMs is null || ageMs > 5000) TriggerAsyncProbe();
        return BuildHealth("beckhoff", IsConnected, ideAlive, IdeName, IdeVersion, projectName, plcProjectName, projectDirty ?? false);
    }

    public void TriggerAsyncProbe()
    {
        lock (_cacheLock) { if (_probeInFlight) return; _probeInFlight = true; }
        Task.Run(() =>
        {
            try
            {
                var r = RunOnStaThread(() =>
                {
                    if (_dte == null) { try { Connect(); } catch { } }   // (re)attach when TwinCAT appears
                    bool alive = ProbeIdeAlive();
                    if (!alive && _dte != null) { try { Disconnect(); } catch { } }
                    else if (alive && IsDegraded) ClearDegraded();
                    bool? dirty = null;
                    try { dirty = !_dte!.Solution.Saved; } catch { }
                    return (alive, _projectName, _plcProjectPath, dirty);
                });
                lock (_cacheLock)
                {
                    _cachedIdeAlive = r.alive;
                    _cachedProjectName = r._projectName;
                    _cachedPlcProjectName = r._plcProjectPath;
                    _cachedProjectDirty = r.dirty;
                    _cachedAtMs = Environment.TickCount64;
                }
            }
            catch { /* probe is best-effort (sanctioned degraded-state plumbing) */ }
            finally { lock (_cacheLock) _probeInFlight = false; }
        });
    }

    private bool ProbeIdeAlive()
    {
        if (_dte == null) return false;
        try { var _ = (int)_dte.Solution.Count; return true; }
        catch { return false; }
    }

    // A dead/disconnected TwinCAT COM channel surfaces as specific RPC HRESULTs; those (and only those)
    // flip the driver to degraded so it can recover instead of hard-failing.
    private const uint HResultRpcServerUnavailable = 0x800706BAu;
    private const uint HResultRpcCallFailed = 0x800706BEu;
    private const uint HResultRpcCallFailedDidNotExecute = 0x800706BFu;
    private const uint HResultRpceFamilyMask = 0xFFFFFF00u;
    private const uint HResultRpceFamily = 0x80010100u;
    private const uint HResultCallRejected = 0x80010001u;
    private const uint HResultDisconnected = 0x80010108u;
    private const uint HResultServerCallRetryLater = 0x8001010Au;

    public override bool ShouldMarkDegraded(Exception ex)
    {
        for (var e = ex; e != null; e = e.InnerException)
        {
            if (e is not COMException com) continue;
            var hr = unchecked((uint)com.HResult);
            if (hr == HResultRpcServerUnavailable) return true;
            if (hr == HResultRpcCallFailed || hr == HResultRpcCallFailedDidNotExecute) return true;
            if ((hr & HResultRpceFamilyMask) == HResultRpceFamily) return true;
            if (hr == HResultCallRejected || hr == HResultDisconnected || hr == HResultServerCallRetryLater) return true;
        }
        return false;
    }

    public void Disconnect()
    {
        if (_sysManager != null) { try { Marshal.ReleaseComObject(_sysManager); } catch { } _sysManager = null; }
        if (_dte != null) { try { Marshal.ReleaseComObject(_dte); } catch { } _dte = null; }
        _projectName = null; _plcProjectPath = null;
        ClearDegraded();
    }

    // ── build ───────────────────────────────────────────────────────
    public void FlushPendingWrites()
    {
        if (_dte == null) return;
        try { _dte.Documents.SaveAll(); } catch { }
    }

    public bool Build()
    {
        if (_dte == null) return false;
        try
        {
            dynamic sb = _dte.Solution.SolutionBuild;
            try { for (int i = 0; i < 100; i++) { if ((int)sb.BuildState != 2) break; Thread.Sleep(100); } } catch { }
            sb.Build(true);
            try { for (int i = 0; i < 100; i++) { if ((int)sb.BuildState != 2) break; Thread.Sleep(100); } } catch { }
            int failed;
            try { failed = sb.LastBuildInfo; } catch { failed = 0; }
            return failed == 0;
        }
        catch { return false; }
    }

    public IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics()
    {
        var result = new List<BridgeDiagnostic>();
        if (_dte == null) return result;
        try
        {
            dynamic output = _dte.Windows.Item("{34E76E81-EE4A-11D0-AE2E-00A0C90FFFC3}").Object;
            int paneCount = output.OutputWindowPanes.Count;
            for (int p = 1; p <= paneCount; p++)
            {
                dynamic pane;
                try { pane = output.OutputWindowPanes.Item(p); } catch { continue; }
                string name = (string)pane.Name;
                if (!name.Contains("Build") && !name.Contains("TwinCAT")) continue;
                dynamic td = pane.TextDocument;
                dynamic ep = td.StartPoint.CreateEditPoint();
                string text = (string)ep.GetText(td.EndPoint);
                if (string.IsNullOrEmpty(text)) continue;
                var regex = new System.Text.RegularExpressions.Regex(
                    @"^(.+?)(?:\((\d+)\))?\s*:\s*(error|warning|message)\s*:\s*(.+)$",
                    System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.Multiline);
                foreach (System.Text.RegularExpressions.Match m in regex.Matches(text))
                {
                    int lineNum = 0;
                    if (m.Groups[2].Success) int.TryParse(m.Groups[2].Value, out lineNum);
                    var sev = m.Groups[3].Value.ToLowerInvariant();
                    result.Add(new BridgeDiagnostic
                    {
                        Severity = sev == "message" ? "info" : sev,
                        Message = m.Groups[4].Value.Trim(),
                        Line = lineNum,
                    });
                }
            }
        }
        catch { }
        return result;
    }
}
