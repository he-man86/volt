using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using VoltBridge.Core;

namespace VoltBridge.Beckhoff.Adapters;

public class BeckhoffAdapter : IAdapter
{
    private readonly BlockingCollection<Action> _staQueue = new();
    private readonly object _cacheLock = new();
    private dynamic? _dte;
    private dynamic? _sysManager;
    private dynamic? _nestedProject;
    private dynamic? _plcNode;
    private string? _projectName;
    private string? _plcProjectPath;
    private string? _lookupBasePath;
    private string? _ideProgId;
    private string? _ideVersion;

    private bool _cachedIdeAlive;
    private string? _cachedProjectName;
    private string? _cachedPlcProjectName;
    private bool? _cachedProjectDirty;
    private long _cachedAtMs;
    private bool _probeInFlight;

    private volatile bool _isDegraded;
    private string? _degradedReason;

    public bool IsConnected => _dte != null && _sysManager != null && _plcProjectPath != null;
    public bool IsDegraded => _isDegraded;
    public string? DegradedReason => _degradedReason;

    public string Version { get; } = "1.0.0";

    public string? IdeName => _ideProgId switch
    {
        "VisualStudio.DTE.17.0" => "Visual Studio 2022",
        "VisualStudio.DTE.16.0" => "Visual Studio 2019",
        "TcXaeShell.DTE.15.0" => "TcXaeShell",
        _ => _ideProgId,
    };

    public string? IdeVersion => _ideVersion;

    // ── COM P/Invoke ────────────────────────────────────────────────

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

    // ── Connection ──────────────────────────────────────────────────

    public void Connect()
    {
        string[] progIds = ["VisualStudio.DTE.17.0", "VisualStudio.DTE.16.0", "TcXaeShell.DTE.15.0"];
        foreach (var progId in progIds)
        {
            try
            {
                _dte = GetComObject(progId);
                _ideProgId = progId;
                try { _ideVersion = (string?)_dte!.Version; } catch { }
                break;
            }
            catch (COMException) { continue; }
        }
        if (_dte == null)
            throw new InvalidOperationException("No running TwinCAT XAE instance found.");
        FindTwinCatProject();
        FindPlcProject();
    }

    private void FindTwinCatProject()
    {
        // Access Solution.Projects via COM type system (not dynamic)
        dynamic solution = _dte!.Solution;
        dynamic projects = solution.Projects;
        int count = projects.Count;

        for (int i = 1; i <= count; i++)
        {
            try
            {
                dynamic proj = projects.Item(i);
                // In TcXaeShell, proj.Object IS the SystemManager.
                // In full VS, proj.Object.SystemManager is the SystemManager.
                dynamic obj = proj.Object;
                try { _sysManager = obj; }
                catch { _sysManager = null; }

                if (_sysManager != null)
                {
                    _projectName = proj.Name;
                    try
                    {
                        dynamic plcProj = _sysManager.PlcProject;
                        _plcProjectPath = plcProj?.ProjectPath;
                    }
                    catch (Exception ex2)
                    {
                        // In TcXaeShell, PlcProject might not be directly accessible via dynamic.
                        // Try LookupTreeItem with the plc path.
                        try
                        {
                            var pp = _sysManager.LookupTreeItem("TIPC");
                            if (pp != null)
                            {
                                try { _plcProjectPath = pp.Child[1]?.ProjectPath ?? pp.Child[1]?.Name; }
                                catch { }
                            }
                        }
                        catch (Exception ex3) { }
                    }
                }

                if (_sysManager == null)
                {
                    // Full VS path: obj.SystemManager
                    try
                    {
                        _sysManager = obj.SystemManager;
                        _projectName = proj.Name;
                        try
                        {
                            dynamic plcProj = _sysManager.PlcProject;
                            _plcProjectPath = plcProj?.ProjectPath;
                        }
                        catch { }
                    }
                    catch { continue; }
                }

                if (_sysManager != null)
                {
                    break;
                }
            }
            catch (Exception ex) { }
        }

        if (_sysManager == null) throw new InvalidOperationException("No TwinCAT project found in solution.");
    }

    private void FindPlcProject()
    {
        if (_plcProjectPath != null) { _plcNode = LookupTreeItem(_plcProjectPath); return; }

        // Try LookupTreeItem to find PLC projects under TIPC
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
                    _plcNode = plc;
                    _plcProjectPath = name;
                    break;
                }
                catch (Exception ex) { }
            }
        }
        catch (Exception ex) { }

        if (_plcNode == null) throw new InvalidOperationException("Cannot find PLC project under TIPC.");
    }

    public dynamic LookupTreeItem(string path)
    {
        return _sysManager!.LookupTreeItem(path);
    }

    public dynamic GetPlcProjectRoot()
    {
        if (_plcNode != null)
        {
            try { return _plcNode.NestedProject; }
            catch { }
        }
        if (_nestedProject != null) return _nestedProject;
        if (_plcProjectPath == null) throw new InvalidOperationException("No PLC project found");
        return LookupTreeItem(_plcProjectPath);
    }

    // ── STA Thread ──────────────────────────────────────────────────

    public void RunStaMessageLoop(CancellationToken cancel)
    {
        while (!cancel.IsCancellationRequested)
        {
            if (_staQueue.TryTake(out var action, 100))
            {
                try { action(); }
                catch { }
            }
            else
            {
                try { System.Threading.Thread.Sleep(10); } catch { }
            }
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
        if (!evt.Wait(TimeSpan.FromSeconds(30)))
            throw new TimeoutException("STA operation timed out");
        if (error != null) throw error;
        return result;
    }

    // ── Health + Cache ──────────────────────────────────────────────

    public object BuildHealthResponse()
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

        return new
        {
            status = IsConnected ? (_isDegraded ? "degraded" : "healthy") : "unavailable",
            platform = "beckhoff",
            platformVariant = (string?)null,
            connected = IsConnected,
            ideAlive,
            degraded = _isDegraded,
            degradedReason = _degradedReason,
            ideName = IdeName,
            ideVersion = IdeVersion,
            version = Version,
            projectName,
            plcProjectName,
            projectDirty = projectDirty ?? false,
        };
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
                    bool alive = ProbeIdeAlive();
                    if (!alive && _dte != null) { try { Disconnect(); } catch { } }
                    else if (alive && _isDegraded) { ClearDegraded(); }
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
            catch { }
            finally { lock (_cacheLock) { _probeInFlight = false; } }
        });
    }

    private bool ProbeIdeAlive()
    {
        if (_dte == null) return false;
        try { var _ = (int)_dte.Solution.Count; return true; }
        catch { return false; }
    }

    public void MarkDegraded(string reason)
    {
        if (!_isDegraded)
        {
            Console.Error.WriteLine($"[Connection] DEGRADED: {reason}");
        }
        _isDegraded = true;
        _degradedReason = reason;
    }
    public void ClearDegraded()
    {
        if (_isDegraded)
        {
            Console.Error.WriteLine("[Connection] DEGRADED cleared — COM channel responsive again");
        }
        _isDegraded = false;
        _degradedReason = null;
    }

    public void Disconnect()
    {
        if (_sysManager != null) { try { Marshal.ReleaseComObject(_sysManager); } catch { } _sysManager = null; }
        if (_dte != null) { try { Marshal.ReleaseComObject(_dte); } catch { } _dte = null; }
        if (_nestedProject != null) { try { Marshal.ReleaseComObject(_nestedProject); } catch { } _nestedProject = null; }
        _projectName = null; _plcProjectPath = null; _lookupBasePath = null;
        _isDegraded = false; _degradedReason = null;
    }

    // ── Tree Walking ────────────────────────────────────────────────

    public List<TreeItemVisit> WalkAllItems(HashSet<string>? onlyNames = null)
    {
        var items = new List<TreeItemVisit>();
        var found = 0;
        WalkInner(GetPlcProjectRoot(), "", items, onlyNames, ref found);
        if (onlyNames == null || found < onlyNames.Count)
            WalkIoDevices(items);
        return items;
    }

    private void WalkInner(dynamic node, string folderPath, List<TreeItemVisit> items,
        HashSet<string>? onlyNames, ref int found)
    {
        // Short-circuit: all requested items found
        if (onlyNames != null && found >= onlyNames.Count) return;

        int count;
        try { count = (int)node.ChildCount; } catch { return; }
        for (int i = 1; i <= count; i++)
        {
            if (onlyNames != null && found >= onlyNames.Count) return;
            dynamic child;
            try { child = node.Child[i]; } catch { continue; }
            string name;
            try { name = (string)child.Name; } catch { continue; }
            int itemType = GetItemType(child);

            if (itemType == 601) // Folder
            {
                var nested = string.IsNullOrEmpty(folderPath) ? name : $"{folderPath}/{name}";
                WalkInner(child, nested, items, onlyNames, ref found);
                continue;
            }
            if (IsInlinedInPou(itemType)) continue;

            int childCount = 0;
            try { childCount = (int)child.ChildCount; } catch { }
            bool isTopLevelCrud = IsTopLevelCrud(itemType);
            bool isHybrid = childCount > 0 && !isTopLevelCrud;
            string emitFolder = isHybrid ? (string.IsNullOrEmpty(folderPath) ? name : $"{folderPath}/{name}") : folderPath;

            items.Add(new TreeItemVisit(name, child, itemType, isTopLevelCrud, emitFolder));
            if (onlyNames != null && onlyNames.Contains(name)) found++;
            if (isHybrid) WalkInner(child, emitFolder, items, onlyNames, ref found);
        }
    }

    private void WalkIoDevices(List<TreeItemVisit> items)
    {
        if (_sysManager == null) return;
        dynamic tiid;
        try { tiid = _sysManager.LookupTreeItem("TIID"); } catch { return; }
        int count;
        try { count = (int)tiid.ChildCount; } catch { return; }
        for (int i = 1; i <= count; i++)
        {
            dynamic device;
            try { device = tiid.Child[i]; } catch { continue; }
            string name;
            try { name = (string)device.Name; } catch { continue; }
            items.Add(new TreeItemVisit(name, device, GetItemType(device), false, "I/O Devices"));
        }
    }

    public int GetItemType(dynamic item) { try { return (int)item.ItemType; } catch { return 0; } }

    public int GetChildCount(dynamic parent) { try { return (int)parent.ChildCount; } catch { return 0; } }

    public dynamic GetChildAt(dynamic parent, int index) { return parent.Child[index]; }

    public string? ExportItemBodyAsXml(dynamic item, string itemName)
    {
        if (_dte == null) return null;
        try
        {
            return (string?)_dte.Solution?._SolutionBuild?.PlcOpenExport?.Invoke(item);
        }
        catch { return null; }
    }

    public string? MapItemType(int typeCode, bool isTopLevelCrud) =>
        ItemTypes.Map(typeCode, isTopLevelCrud);

    // ── Write Operations (COM) ─────────────────────────────────────

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

    public List<object> GetBuildDiagnostics()
    {
        var result = new List<object>();
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
                var regex = new Regex(@"^(.+?)(?:\((\d+)\))?\s*:\s*(error|warning|message)\s*:\s*(.+)$",
                    RegexOptions.IgnoreCase | RegexOptions.Multiline);
                foreach (Match m in regex.Matches(text))
                {
                    int lineNum = 0;
                    if (m.Groups[2].Success) int.TryParse(m.Groups[2].Value, out lineNum);
                    var sev = m.Groups[3].Value.ToLowerInvariant();
                    result.Add(new Dictionary<string, object?>
                    {
                        ["severity"] = sev == "message" ? "info" : sev,
                        ["message"] = m.Groups[4].Value.Trim(),
                        ["line"] = lineNum,
                    });
                }
            }
        }
        catch { }
        return result;
    }

    public dynamic? LookupItemByName(string name)
    {
        if (_lookupBasePath != null)
        {
            try
            {
                var root = GetPlcProjectRoot();
                var relPath = FindRelativePath(root, name);
                if (relPath != null)
                    return _sysManager!.LookupTreeItem(_lookupBasePath + "^" + relPath);
            }
            catch { }
        }
        return FindItemByName(GetPlcProjectRoot(), name);
    }

    private dynamic? FindItemByName(dynamic parent, string name)
    {
        for (int i = 1; ; i++)
        {
            dynamic child;
            try { child = parent.Child[i]; } catch { break; }
            string childName;
            try { childName = (string)child.Name; } catch { continue; }
            if (string.Equals(childName, name, StringComparison.OrdinalIgnoreCase))
            {
                int itemType = GetItemType(child);
                if (IsTopLevelCrud(itemType)) return child;
            }
            if (GetItemType(child) == 601)
            {
                var found = FindItemByName(child, name);
                if (found != null) return found;
            }
        }
        return null;
    }

    private string? FindRelativePath(dynamic parent, string name)
    {
        for (int i = 1; ; i++)
        {
            dynamic child;
            try { child = parent.Child[i]; } catch { break; }
            string childName;
            try { childName = (string)child.Name; } catch { continue; }
            if (string.Equals(childName, name, StringComparison.OrdinalIgnoreCase)
                && IsTopLevelCrud(GetItemType(child)))
                return childName;
        }
        return null;
    }

    public dynamic CreateChild(dynamic parent, string name, int itemType)
    {
        return parent.CreateChild(name, itemType, "", "ST");
    }

    public void DeleteChild(dynamic parent, string name)
    {
        parent.DeleteChild(name);
    }

    public void WriteSourceText(dynamic item, string declaration, string implementation)
    {
        try { item.DeclarationText = declaration ?? ""; } catch { }
        if (!string.IsNullOrEmpty(implementation))
            try { item.ImplementationText = implementation; } catch { }
    }

    public void RenameItem(dynamic item, string newName)
    {
        item.Name = newName;
    }

    public string ReadDeclaration(dynamic item) { try { return (string)item.DeclarationText ?? ""; } catch { return ""; } }
    public string ReadImplementation(dynamic item) { try { return (string)item.ImplementationText ?? ""; } catch { return ""; } }

    public static bool IsTopLevelCrud(int typeCode) =>
        typeCode is 602 or 603 or 604 or 605 or 606 or 615 or 618;

    public static bool IsInlinedInPou(int typeCode) =>
        typeCode is 608 or 609 or 610 or 611 or 612 or 613 or 614 or 616 or 650 or 654 or 655;

    // ── Version Hashing ─────────────────────────────────────────────

    public string ComputeItemVersion(dynamic item, string folderPath)
    {
        var sb = new System.Text.StringBuilder();
        sb.Append("folder=").Append(folderPath ?? "").Append('\0');
        sb.Append("d=").Append(ReadDeclaration(item)).Append('\0');
        sb.Append("i=").Append(ReadImplementation(item)).Append('\0');
        return ShortSha1(sb.ToString());
    }

    public string ComputeProjectVersion(Dictionary<string, string> versions)
    {
        var sb = new System.Text.StringBuilder();
        foreach (var kvp in versions.OrderBy(p => p.Key, StringComparer.Ordinal))
            sb.Append(kvp.Key).Append(':').Append(kvp.Value).Append('\n');
        return ShortSha1(sb.ToString());
    }

    public string ComputeStructureVersion(Dictionary<string, string> versions)
    {
        var sb = new System.Text.StringBuilder();
        foreach (var name in versions.Keys.OrderBy(n => n, StringComparer.Ordinal))
            sb.Append(name).Append('\n');
        return ShortSha1(sb.ToString());
    }

    private static string ShortSha1(string content)
    {
        using var sha = System.Security.Cryptography.SHA1.Create();
        byte[] hash = sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(content));
        return Convert.ToHexString(hash).Substring(0, 16).ToLowerInvariant();
    }
}
