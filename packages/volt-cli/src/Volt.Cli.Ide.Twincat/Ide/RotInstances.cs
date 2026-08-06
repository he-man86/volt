using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

namespace Volt.Cli.Ide.Twincat;

/// <summary>
/// Reaches running DTE instances (TcXaeShell / Visual Studio) through the COM Running Object Table. Two callers:
/// the connector's <c>--list-xae-pids</c> probe (<see cref="TryEnumeratePids"/> → the XAE window pids to supervise),
/// and a per-XAE worker binding its ONE window (<see cref="BindByPid"/>). Identity is the window PROCESS id
/// (<see cref="PidOf"/>) — stable for the process lifetime, unlike the ephemeral ROT moniker TcXaeShell re-registers.
///
/// MUST run on an STA thread — foreign DTE objects are apartment-bound, and the registered
/// <see cref="ComMessageFilter"/> handles "server busy" retries. Every DTE proxy this hands back but the caller does
/// not keep is released here (cross-process RCWs), so a multi-XAE machine doesn't leak proxies to the other windows.
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
    /// and attaches to it by this stable pid — re-acquiring the same pid across a DTE re-registration, no moniker.
    /// Releases every OTHER window's DTE proxy (the caller keeps only the returned one, via SwapDte).</summary>
    public static object? BindByPid(int pid)
    {
        object? match = null;
        foreach (var dte in RunningDtes())
        {
            if (match == null && PidOf(dte) == pid) match = dte;   // keep the first match; caller owns it
            else Release(dte);                                     // drop every non-matched window's cross-process proxy
        }
        return match;
    }

    /// <summary>The window pids of every running XAE — the LIGHT enumeration the connector's supervisor uses to decide
    /// which per-XAE workers to spawn/reap. Pids ONLY: it never walks a project's PLC tree (that can fault a fragile
    /// XAE in its own process) and holds no DTE (each proxy is released immediately). MUST run on an STA thread.
    /// <para>Returns FALSE when the enumeration was INCOMPLETE: a DTE we were holding would not tell us its window
    /// (<see cref="PidOf"/> returned 0). That is the busy-XAE case — one pinned by a <c>volt push</c> or a full
    /// <c>volt build</c> for tens of seconds does not answer the cross-process <c>MainWindow.HWnd</c> call even after
    /// <see cref="ComMessageFilter"/>'s retries, and its catch turns that into a 0 that is INDISTINGUISHABLE from
    /// "no such window". Such an XAE is simply ABSENT from the list, and "absent" is precisely what the connector's
    /// supervisor reaps on — three misses at ~12s apiece killed a perfectly healthy worker mid-push. A partial list is
    /// therefore NOT ground truth about which XAE are gone; the caller must not let it drive a reap. The pids that
    /// WERE readable are still returned (correct, merely partial) so a human running the probe by hand still sees them.
    /// </para>
    /// <para>The verdict is bounded to DTEs we actually got hold of — a NON-DTE moniker is not evidence of anything.
    /// KNOWN GAP: a moniker whose <c>GetDisplayName</c> read fails in <see cref="EnumRunningDtesOnce"/> is dropped
    /// BEFORE <see cref="IsDteMoniker"/> can classify it, so it can never be counted as a missing DTE and that drop
    /// stays silent. Closing it means widening the verdict to every unreadable ROT entry — on a machine carrying one
    /// stale moniker EVERY probe would then be incomplete and the fleet would stall permanently. The DTE bound is the
    /// deliberate trade, not an oversight.</para></summary>
    public static bool TryEnumeratePids(out List<int> pids)
    {
        pids = new List<int>();
        var unreadable = 0;
        foreach (var dte in RunningDtes())
        {
            var pid = PidOf(dte);
            if (pid == 0) unreadable++;                            // a DTE that would not answer — a DROP, not an absence
            else if (!pids.Contains(pid)) pids.Add(pid);
            Release(dte); // pids only — never hold a DTE
        }
        return unreadable == 0;
    }

    private static void Release(object comObj) { try { Marshal.ReleaseComObject(comObj); } catch { /* already gone */ } }

    private static bool IsDteMoniker(string name) =>
        name.IndexOf("VisualStudio.DTE", StringComparison.OrdinalIgnoreCase) >= 0 ||
        name.IndexOf("TcXaeShell.DTE", StringComparison.OrdinalIgnoreCase) >= 0;

    // Enumerate the ROT once. RETRY on an EMPTY result: GetRunningObjectTable/EnumRunning is racy and can transiently
    // return nothing while a TcXaeShell is genuinely running (mid-registration, or the ROT momentarily locked), which
    // otherwise surfaces as a spurious "no instance to bind" at select/probe time. A few short retries close that
    // window; a genuinely-empty ROT (no IDE open) costs three enumerations plus ~80 ms of sleep, paid on EVERY call
    // — acceptable because the supervisor's probe runs in a short-lived child process on a slow cadence.
    // Runs on the STA thread — keep it brief.
    private static List<object> RunningDtes()
    {
        for (int attempt = 0; attempt < 3; attempt++)
        {
            var hits = EnumRunningDtesOnce();
            if (hits.Count > 0 || attempt == 2) return hits;
            System.Threading.Thread.Sleep(40);
        }
        return new List<object>();
    }

    private static List<object> EnumRunningDtesOnce()
    {
        var result = new List<object>();
        if (GetRunningObjectTable(0, out var rot) != 0) return result;
        if (CreateBindCtx(0, out var ctx) != 0) { Release(rot); return result; }
        // The three outer handles are released in a FINALLY: a throw from EnumRunning/Reset/Next would otherwise
        // leak the ROT, bind-context and enumerator RCWs for the life of the process.
        IEnumMoniker? en = null;
        try
        {
            rot.EnumRunning(out en);
            en.Reset();
            var arr = new IMoniker[1];
            while (en.Next(1, arr, IntPtr.Zero) == 0)
            {
                var moniker = arr[0];
                try
                {
                    string name;
                    try { moniker.GetDisplayName(ctx, null, out name); }
                    catch { continue; }
                    if (string.IsNullOrEmpty(name) || !IsDteMoniker(name)) continue;
                    object obj;
                    try { if (rot.GetObject(moniker, out obj) != 0 || obj == null) continue; }
                    catch { continue; }
                    result.Add(obj);
                }
                finally { Release(moniker); } // the moniker is spent once we've read its name + object
            }
        }
        finally
        {
            if (en != null) Release(en);
            Release(ctx);
            Release(rot);
        }
        return result;
    }
}
