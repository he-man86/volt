using System.Globalization;
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

namespace Volt.Ide.Twincat;

/// <summary>
/// Reaches running DTE instances (TcXaeShell / Visual Studio) through the COM Running Object Table. Three callers:
/// the connector's <c>--list-xae-pids</c> probe (<see cref="TryEnumeratePids"/> → the XAE window pids to supervise),
/// the double-click start's scan (<see cref="ListPidsByName"/>), and a per-XAE worker binding its ONE window
/// (<see cref="BindByPid"/>). Identity is the window PROCESS id
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
    private static int PidOf(object dte)
    {
        try
        {
            long hwnd = Convert.ToInt64(((dynamic)dte).MainWindow.HWnd, CultureInfo.InvariantCulture); // EnvDTE exposes HWND as an int/long
            if (hwnd == 0) return 0;
            GetWindowThreadProcessId(new IntPtr(hwnd), out var pid);
            return pid;
        }
        catch { return 0; }
    }

    /// <summary>The DTE whose window process id is <paramref name="pid"/>, or null. A per-XAE worker owns ONE window
    /// and attaches to it by this stable pid — re-acquiring the same pid across a DTE re-registration, no moniker.
    /// Picked by the pid its ROT display name states (<see cref="PickWindow"/>): another process's DTE is never bound
    /// and never called. Attach, a select and recovery all bind through here.</summary>
    public static object? BindByPid(int pid)
    {
        for (int attempt = 0; attempt < 3; attempt++)
        {
            using var rot = RotSnapshot.Take();
            if (rot.Entries.Count > 0 || attempt == 2) return PickWindow(pid, rot.Entries, PidOf, Release);
            System.Threading.Thread.Sleep(40);
        }
        return null;
    }

    /// <summary>One DTE entry of the ROT: its display name, and the bind that marshals its object out of the ROT.</summary>
    internal sealed record RotEntry(string Name, Func<object?> Bind);

    /// <summary>THE WINDOW <paramref name="pid"/> OUT OF THE ROT, WITHOUT CALLING INTO ANY OTHER. A DTE registers as
    /// <c>!TcXaeShell.DTE.15.0:&lt;pid&gt;</c> (Visual Studio as <c>!VisualStudio.DTE.17.0:&lt;pid&gt;</c>), so an entry
    /// whose name states another pid is passed over unbound: asking its <c>MainWindow.HWnd</c> is a call into that XAE,
    /// and a busy one is retried without limit (<see cref="ComMessageFilter"/>) — a connect stalled 269 s and 469 s on
    /// a window this worker does not serve (TwinCAT e2e profile, 2026-10-18). The entry that states OUR pid is bound
    /// and confirmed by its window (<see cref="PidOf"/>); a name that states no pid is bound and asked, as every entry
    /// was. The first confirmed window is kept (the caller owns it); every other DTE this bound is released.</summary>
    internal static object? PickWindow(int pid, IReadOnlyList<RotEntry> entries, Func<object, int> pidOf, Action<object> release)
    {
        foreach (var entry in entries)
        {
            if (PidInName(entry.Name) is { } stated && stated != pid) continue;   // another window: never bound
            if (entry.Bind() is not { } dte) continue;
            if (pidOf(dte) == pid) return dte;
            release(dte);
        }
        return null;
    }

    /// <summary>The XAE window pids of the ROT, read from the display names: what the double-click start scans. No DTE
    /// whose name states a pid is bound, so one busy XAE cannot stall the scan of the others. MUST run on an STA
    /// thread (a name that states no pid is bound and asked).</summary>
    public static List<int> ListPidsByName()
    {
        using var rot = RotSnapshot.Take();
        return PidsFromNames(rot.Entries, PidOf, Release);
    }

    /// <summary>The pids <paramref name="entries"/> name, in ROT order, each once. An entry whose name states its pid is
    /// that pid and is never bound; one whose name states none is bound, asked for its window (<paramref name="pidOf"/>)
    /// and released, as <see cref="PickWindow"/> does.</summary>
    internal static List<int> PidsFromNames(IReadOnlyList<RotEntry> entries, Func<object, int> pidOf, Action<object> release)
    {
        var pids = new List<int>();
        foreach (var entry in entries)
        {
            var pid = PidInName(entry.Name) ?? 0;
            if (pid == 0 && entry.Bind() is { } dte)
            {
                pid = pidOf(dte);
                release(dte);
            }
            if (pid != 0 && !pids.Contains(pid)) pids.Add(pid);
        }
        return pids;
    }

    /// <summary>The pid a DTE's ROT display name states — the number after its last <c>:</c> — or null when it states
    /// none.</summary>
    internal static int? PidInName(string name)
    {
        var at = name.LastIndexOf(':');
        return at >= 0 && int.TryParse(name.Substring(at + 1), NumberStyles.None, CultureInfo.InvariantCulture, out var pid)
            ? pid : null;
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
    /// KNOWN GAP: a moniker whose <c>GetDisplayName</c> read fails in <see cref="RotSnapshot.Take"/> is dropped
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

    internal static bool IsDteMoniker(string name) =>
        name.IndexOf("VisualStudio.DTE", StringComparison.OrdinalIgnoreCase) >= 0 ||
        name.IndexOf("TcXaeShell.DTE", StringComparison.OrdinalIgnoreCase) >= 0 ||
        name.IndexOf("TcXaeShell64.DTE", StringComparison.OrdinalIgnoreCase) >= 0;   // TwinCAT 4026's 64-bit shell

    // Every DTE of the ROT, bound. RETRY on an EMPTY result: GetRunningObjectTable/EnumRunning is racy and can
    // transiently return nothing while a TcXaeShell is genuinely running (mid-registration, or the ROT momentarily
    // locked), which otherwise surfaces as a spurious "no instance to bind" at select/probe time. A few short retries
    // close that window; a genuinely-empty ROT (no IDE open) costs three enumerations plus ~80 ms of sleep, paid on
    // EVERY call — acceptable because the supervisor's probe runs in a short-lived child process on a slow cadence.
    // Runs on the STA thread — keep it brief.
    private static List<object> RunningDtes()
    {
        for (int attempt = 0; attempt < 3; attempt++)
        {
            using var rot = RotSnapshot.Take();
            var hits = new List<object>();
            foreach (var entry in rot.Entries)
                if (entry.Bind() is { } dte) hits.Add(dte);
            if (hits.Count > 0 || attempt == 2) return hits;
            System.Threading.Thread.Sleep(40);
        }
        return new List<object>();
    }

    /// <summary>The ROT's DTE entries, read once: each one's display name, and a bind that marshals its object out of
    /// the ROT only when asked — reading a name calls into no process. Disposing releases the ROT, the bind context and
    /// every moniker.</summary>
    private sealed class RotSnapshot : IDisposable
    {
        private readonly IRunningObjectTable? _rot;
        private readonly IBindCtx? _ctx;
        private readonly List<IMoniker> _monikers = new();
        public List<RotEntry> Entries { get; } = new();

        private RotSnapshot(IRunningObjectTable? rot, IBindCtx? ctx) { _rot = rot; _ctx = ctx; }

        public static RotSnapshot Take()
        {
            if (GetRunningObjectTable(0, out var rot) != 0) return new RotSnapshot(null, null);
            if (CreateBindCtx(0, out var ctx) != 0) { Release(rot); return new RotSnapshot(null, null); }
            var snapshot = new RotSnapshot(rot, ctx);
            // The enumerator is released in a FINALLY: a throw from EnumRunning/Reset/Next would otherwise leak its RCW
            // for the life of the process (the ROT and bind context go with the snapshot's Dispose).
            IEnumMoniker? en = null;
            try
            {
                rot.EnumRunning(out en);
                en.Reset();
                var arr = new IMoniker[1];
                while (en.Next(1, arr, IntPtr.Zero) == 0)
                {
                    var moniker = arr[0];
                    string name;
                    try { moniker.GetDisplayName(ctx, null, out name); }
                    catch { Release(moniker); continue; }
                    if (string.IsNullOrEmpty(name) || !IsDteMoniker(name)) { Release(moniker); continue; }
                    snapshot._monikers.Add(moniker);
                    snapshot.Entries.Add(new RotEntry(name, () => snapshot.Bind(moniker)));
                }
            }
            catch { snapshot.Dispose(); throw; }
            finally { if (en != null) Release(en); }
            return snapshot;
        }

        private object? Bind(IMoniker moniker)
        {
            try { return _rot!.GetObject(moniker, out var obj) == 0 ? obj : null; }
            catch { return null; }
        }

        public void Dispose()
        {
            foreach (var m in _monikers) Release(m);   // a moniker is spent once its name + object are read
            _monikers.Clear();
            if (_ctx != null) Release(_ctx);
            if (_rot != null) Release(_rot);
        }
    }
}
