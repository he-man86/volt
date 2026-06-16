using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

namespace Volt.Bridge.Beckhoff;

/// <summary>One PLC project inside a TwinCAT solution, with its PLC sub-projects.</summary>
public sealed record TcProject(string Project, List<string> PlcProjects);

/// <summary>One running TwinCAT XAE / VS instance and the projects it has open.</summary>
public sealed record TcInstance(string InstanceId, string? IdeName, string? IdeVersion, string? Solution, List<TcProject> Projects);

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

    private static bool IsDteMoniker(string name) =>
        name.IndexOf("VisualStudio.DTE", StringComparison.OrdinalIgnoreCase) >= 0 ||
        name.IndexOf("TcXaeShell.DTE", StringComparison.OrdinalIgnoreCase) >= 0;

    private static IEnumerable<(string Name, object Dte)> RunningDtes()
    {
        if (GetRunningObjectTable(0, out var rot) != 0) yield break;
        if (CreateBindCtx(0, out var ctx) != 0) yield break;
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
            yield return (name, obj);
        }
    }

    /// <summary>Bind the DTE object for a specific ROT display name, or null if gone.</summary>
    public static object? Bind(string instanceId)
    {
        foreach (var (name, dte) in RunningDtes())
            if (string.Equals(name, instanceId, StringComparison.OrdinalIgnoreCase)) return dte;
        return null;
    }

    /// <summary>All running instances + their projects/PLC projects.</summary>
    public static List<TcInstance> Enumerate()
    {
        var list = new List<TcInstance>();
        foreach (var (name, dte) in RunningDtes())
        {
            string? ver = null, sln = null;
            var projects = new List<TcProject>();
            try { ver = (string?)((dynamic)dte).Version; } catch { }
            try
            {
                dynamic solution = ((dynamic)dte).Solution;
                try { sln = solution.FullName as string; } catch { }
                dynamic projs = solution.Projects;
                int count = projs.Count;
                for (int i = 1; i <= count; i++)
                {
                    try
                    {
                        dynamic proj = projs.Item(i);
                        projects.Add(new TcProject((string)proj.Name, PlcProjectsFor(proj)));
                    }
                    catch { }
                }
            }
            catch { }
            list.Add(new TcInstance(name, IdeName(name), ver, sln, projects));
        }
        return list;
    }

    private static List<string> PlcProjectsFor(dynamic proj)
    {
        var plcs = new List<string>();
        dynamic? sysManager = null;
        try
        {
            dynamic obj = proj.Object;
            try { var _ = obj.LookupTreeItem("TIPC"); sysManager = obj; }  // TcXaeShell: obj IS the SystemManager
            catch { try { sysManager = obj.SystemManager; } catch { } }     // full VS: obj.SystemManager
        }
        catch { }
        if (sysManager == null) return plcs;
        try
        {
            dynamic tipc = sysManager.LookupTreeItem("TIPC");
            int n = tipc.ChildCount;
            for (int i = 1; i <= n; i++) { try { plcs.Add((string)tipc.Child[i].Name); } catch { } }
        }
        catch { }
        return plcs;
    }

    public static string? IdeName(string moniker) =>
        moniker.IndexOf("DTE.17", StringComparison.OrdinalIgnoreCase) >= 0 ? "Visual Studio 2022" :
        moniker.IndexOf("DTE.16", StringComparison.OrdinalIgnoreCase) >= 0 ? "Visual Studio 2019" :
        moniker.IndexOf("TcXaeShell", StringComparison.OrdinalIgnoreCase) >= 0 ? "TcXaeShell" : null;

    /// <summary>"!VisualStudio.DTE.17.0:1234" → "VisualStudio.DTE.17.0".</summary>
    public static string? ProgId(string moniker)
    {
        var s = moniker.TrimStart('!');
        var colon = s.LastIndexOf(':');
        return colon > 0 ? s.Substring(0, colon) : s;
    }
}
