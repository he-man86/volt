using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

namespace Volt.Cli.Ide.Twincat;

/// <summary>One PLC project inside a TwinCAT solution, with its PLC sub-projects.</summary>
public sealed record TcProject(string Project);

/// <summary>One running TwinCAT XAE / VS instance and the projects it has open.</summary>
public sealed record TcInstance(string? IdeVersion, List<TcProject> Projects);

/// <summary>
/// Enumerates the COM Running Object Table for every running DTE instance
/// (TcXaeShell / Visual Studio) so the user can pick WHICH instance + project the
/// bridge attaches to. <c>GetActiveObject</c> only ever returns one instance per
/// ProgID; the ROT exposes them all.
///
/// MUST run on the bridge's STA thread — foreign DTE objects are apartment-bound,
/// and the registered <see cref="ComMessageFilter"/> handles "server busy" retries.
/// </summary>
internal static class RotInstances
{
    [DllImport("ole32.dll")] private static extern int GetRunningObjectTable(int reserved, out IRunningObjectTable prot);
    [DllImport("ole32.dll")] private static extern int CreateBindCtx(int reserved, out IBindCtx ppbc);
    [DllImport("user32.dll")] private static extern int GetWindowThreadProcessId(IntPtr hWnd, out int processId);

    /// <summary>The window process id of a DTE (its top-level MainWindow → owning process), or 0 if unreadable.
    /// STABLE for the process lifetime — the durable identity a per-XAE worker attaches by, unlike the ephemeral ROT
    /// moniker (which TcXaeShell re-registers with a fresh cookie mid-session).</summary>
    public static int PidOf(object dte)
    {
        try
        {
            long hwnd = Convert.ToInt64(((dynamic)dte).MainWindow.HWnd); // EnvDTE exposes HWND as an int/long
            if (hwnd == 0) return 0;
            GetWindowThreadProcessId(new IntPtr(hwnd), out var pid);
            return pid;
        }
        catch { return 0; }
    }

    /// <summary>The DTE whose window process id is <paramref name="pid"/>, or null. A per-XAE worker owns ONE window
    /// and attaches to it by this stable pid — re-acquiring the same pid across a DTE re-registration, no moniker.</summary>
    public static object? BindByPid(int pid)
    {
        foreach (var (_, dte) in RunningDtes())
            if (PidOf(dte) == pid) return dte;
        return null;
    }

    /// <summary>Every running XAE as (windowPid, projects) — the LIGHT enumeration the connector's supervisor uses to
    /// decide which per-XAE workers to spawn/reap. Project NAMES only, never a PLC-tree walk (that can fault a fragile
    /// XAE in its own process). MUST run on an STA thread.</summary>
    public static List<(int Pid, TcInstance Instance)> EnumerateWithPids()
    {
        var list = new List<(int, TcInstance)>();
        foreach (var (_, dte) in RunningDtes())
        {
            var pid = PidOf(dte);
            if (pid == 0) continue;
            string? ver = null;
            var projects = new List<TcProject>();
            try { ver = (string?)((dynamic)dte).Version; } catch { }
            try
            {
                dynamic projs = ((dynamic)dte).Solution.Projects;
                int count = projs.Count;
                for (int i = 1; i <= count; i++)
                    try { projects.Add(new TcProject((string)projs.Item(i).Name)); } catch { }
            }
            catch { }
            list.Add((pid, new TcInstance(ver, projects)));
        }
        return list;
    }

    private static bool IsDteMoniker(string name) =>
        name.IndexOf("VisualStudio.DTE", StringComparison.OrdinalIgnoreCase) >= 0 ||
        name.IndexOf("TcXaeShell.DTE", StringComparison.OrdinalIgnoreCase) >= 0;

    // Enumerate the ROT once. RETRY on an EMPTY result: GetRunningObjectTable/EnumRunning is racy and can transiently
    // return nothing while a TcXaeShell is genuinely running (mid-registration, or the ROT momentarily locked), which
    // otherwise surfaces as a spurious "no instance to bind" at select/probe time. A few short retries close that
    // window; a genuinely-empty ROT (no IDE open) just costs a few ms once. Runs on the STA thread — keep it brief.
    private static IEnumerable<(string Name, object Dte)> RunningDtes()
    {
        for (int attempt = 0; attempt < 3; attempt++)
        {
            var hits = EnumRunningDtesOnce();
            if (hits.Count > 0 || attempt == 2) return hits;
            System.Threading.Thread.Sleep(40);
        }
        return new List<(string, object)>();
    }

    private static List<(string Name, object Dte)> EnumRunningDtesOnce()
    {
        var result = new List<(string, object)>();
        if (GetRunningObjectTable(0, out var rot) != 0) return result;
        if (CreateBindCtx(0, out var ctx) != 0) return result;
        rot.EnumRunning(out var en);
        en.Reset();
        var arr = new IMoniker[1];
        while (en.Next(1, arr, IntPtr.Zero) == 0)
        {
            string name;
            try { arr[0].GetDisplayName(ctx, null, out name); }
            catch { continue; }
            if (string.IsNullOrEmpty(name) || !IsDteMoniker(name)) continue;
            object obj;
            try { if (rot.GetObject(arr[0], out obj) != 0 || obj == null) continue; }
            catch { continue; }
            result.Add((name, obj));
        }
        return result;
    }

    /// <summary>Find the running DTE whose solution contains a project named <paramref name="project"/>, or null.
    /// The PROJECT NAME is the stable identity Volt binds by (the ROT moniker is ephemeral — TcXaeShell re-registers
    /// its DTE with a fresh cookie <c>…:24008</c> → <c>…:24816</c> mid-session — so it is never a durable key). This
    /// is what makes selection reliable across re-registration and dead handles.</summary>
    public static object? BindByProject(string project)
    {
        foreach (var (name, dte) in RunningDtes())
        {
            try
            {
                dynamic solution = ((dynamic)dte).Solution;
                int count = solution.Projects.Count;
                for (int i = 1; i <= count; i++)
                {
                    string nm;
                    try { nm = (string)solution.Projects.Item(i).Name; } catch { continue; }
                    if (string.Equals(nm, project, StringComparison.Ordinal)) return dte;
                }
            }
            catch { }
        }
        return null;
    }

    /// <summary>The first running DTE object, or null if none are running. Version-agnostic — whatever the ROT lists
    /// (any Visual Studio / TcXaeShell), so the no-target soft-attach future-proofs the same way the picker does.</summary>
    public static object? First()
    {
        foreach (var (_, dte) in RunningDtes()) return dte;
        return null;
    }

    /// <summary>All running instances + their projects/PLC projects.</summary>
    public static List<TcInstance> Enumerate()
    {
        var list = new List<TcInstance>();
        foreach (var (_, dte) in RunningDtes())
        {
            string? ver = null;
            var projects = new List<TcProject>();
            try { ver = (string?)((dynamic)dte).Version; } catch { }
            try
            {
                dynamic solution = ((dynamic)dte).Solution;
                dynamic projs = solution.Projects;
                int count = projs.Count;
                for (int i = 1; i <= count; i++)
                {
                    try
                    {
                        dynamic proj = projs.Item(i);
                        // DELIBERATELY light: just the project NAME, NOT the PLC-tree traversal. `instances` is
                        // POLLED by the connector every few seconds, and deep-traversing a project's System-Manager
                        // tree (LookupTreeItem("TIPC") + children) on every poll can FAULT a fragile / freshly-opened
                        // TcXaeShell IN ITS OWN PROCESS — an out-of-process COM crash no try/catch here can stop
                        // (observed: a just-loaded project closing on the first probe). The PLC sub-project is
                        // resolved on the explicit, infrequent `select` (FindPlcProject) instead — where a null means
                        // "the first/default PLC project", which is the single-PLC-project common case anyway.
                        projects.Add(new TcProject((string)proj.Name));
                    }
                    catch { }
                }
            }
            catch { }
            list.Add(new TcInstance(ver, projects));
        }
        return list;
    }
}
