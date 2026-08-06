using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using Volt.Cli.Connector;
using Xunit;

namespace Volt.Cli.Connector.Tests;

/// <summary>
/// The worker-fleet rules that ACTUALLY run: <c>EnsureWorker</c>'s de-dup, its crash-restart, and the job object's
/// <c>KILL_ON_JOB_CLOSE</c> orphan guard. All three were structurally unreachable from any test project while
/// <see cref="BridgeSupervisor"/> lived in the net8.0-windows WinForms assembly — the suite asserted a spawn plan
/// the tray discarded instead, so the tested policy was not the one that ran.
///
/// <para>Spawning is not test-safe in general, so these drive HARMLESS <c>cmd.exe</c> children out of a per-test
/// temp directory — never a real <c>VoltBridgeTwincat</c>. Windows-only (the whole connector is): the assertions
/// no-op elsewhere rather than fail, since the CI job that runs this suite is windows-latest.</para>
/// </summary>
public class BridgeSupervisorTests : IDisposable
{
    private static bool OnWindows => RuntimeInformation.IsOSPlatform(OSPlatform.Windows);

    private static string Cmd =>
        Environment.GetEnvironmentVariable("ComSpec")
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "cmd.exe");

    private readonly string _dir = Directory.CreateDirectory(
        Path.Combine(Path.GetTempPath(), "volt-supervisor-" + Guid.NewGuid().ToString("N"))).FullName;

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch { /* a leaked child still holds a file — best effort */ }
    }

    // ── helpers ────────────────────────────────────────────────────────────

    /// <summary>Write a .cmd next to the marker files and return the WorkerSpec that runs it. Scripts are used
    /// instead of an inline argument string so no cmd quoting depends on the temp path's spelling.</summary>
    private WorkerSpec Spec(string id, string scriptName, string body)
    {
        var path = Path.Combine(_dir, scriptName);
        File.WriteAllText(path, body);
        return new WorkerSpec(id, Cmd, $"/c \"{path}\"");
    }

    private string Marker => Path.Combine(_dir, "marker.txt");

    /// <summary>Lines written so far — one per worker START, so it counts spawns.</summary>
    private int Spawns()
    {
        try
        {
            using var fs = new FileStream(Marker, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var r = new StreamReader(fs);
            var n = 0;
            while (r.ReadLine() is { } line)
                if (line.Trim().Length > 0) n++;
            return n;
        }
        catch { return 0; } // not created yet
    }

    private static bool WaitUntil(Func<bool> condition, int timeoutMs = 30000)
    {
        var sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            if (condition()) return true;
            Thread.Sleep(100);
        }
        return condition();
    }

    // Marks its own start, then stays alive for a minute (bounding any leak if an assertion below fails).
    private const string LiveScript = "@echo off\r\necho tick>>\"%~dp0marker.txt\"\r\nping -n 60 127.0.0.1 >nul\r\n";

    // Marks its own start and exits at once — a "crashed" worker.
    private const string ExitScript = "@echo off\r\necho tick>>\"%~dp0marker.txt\"\r\n";

    // Launches a DETACHED grandchild and exits immediately, so by teardown time Kill(entireProcessTree) has no tree
    // left to walk. The grandchild holds `lock.txt` open for its whole life (cmd keeps the redirection handle), which
    // is how the test observes it without needing its pid.
    private const string DetachScript =
        "@echo off\r\nstart \"\" /b cmd /c \"%~dp0sleeper.cmd\"\r\n";

    private const string SleeperScript = "@echo off\r\nping -n 60 127.0.0.1 >\"%~dp0lock.txt\"\r\n";

    /// <summary>True while some process still holds the file open — an exclusive open fails against any live handle.</summary>
    private bool Held(string path)
    {
        if (!File.Exists(path)) return false;
        try
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
            return false;
        }
        catch (IOException) { return true; }
        catch (UnauthorizedAccessException) { return true; }
    }

    // ── the rules ──────────────────────────────────────────────────────────

    [Fact]
    public void A_live_worker_is_never_started_twice()
    {
        if (!OnWindows) return;
        using var sup = new BridgeSupervisor();
        var spec = Spec("twincat.100", "live.cmd", LiveScript);

        sup.EnsureWorker(spec);
        Assert.True(WaitUntil(() => Spawns() == 1), "the first worker never started");

        // The de-dup that actually runs is `if (!existing.HasExited) return;`, keyed by WorkerSpec.Id. Two workers on
        // one XAE means two COM attachments fighting over a single volt.bridge.twincat.<pid> pipe — the tray calls
        // EnsureWorker for EVERY live pid on EVERY reconcile, so this idempotency is what makes that loop safe.
        sup.EnsureWorker(spec);
        sup.EnsureWorker(spec);
        Thread.Sleep(3000); // a second cmd would have marked itself long before this
        Assert.Equal(1, Spawns());
        Assert.True(sup.IsWorkerRunning(spec.Id));
    }

    [Fact]
    public void A_crashed_worker_is_restarted_by_the_next_reconcile()
    {
        if (!OnWindows) return;
        using var sup = new BridgeSupervisor();
        var spec = Spec("twincat.100", "once.cmd", ExitScript);

        sup.EnsureWorker(spec);
        Assert.True(WaitUntil(() => Spawns() == 1 && !sup.IsWorkerRunning(spec.Id)), "the first worker never ran to exit");

        // This is the ONLY respawn rule in the product: the fleet's reconcile re-calls EnsureWorker for every live XAE
        // pid, and an entry whose process HasExited is dropped and started again. Break it and TwinCAT silently stops
        // syncing for that window until the tray is restarted.
        sup.EnsureWorker(spec);
        Assert.True(WaitUntil(() => Spawns() == 2), "a worker that exited was not restarted");
    }

    [Fact]
    public void A_worker_the_tree_kill_would_miss_still_dies_with_the_supervisor()
    {
        if (!OnWindows) return;
        var lockFile = Path.Combine(_dir, "lock.txt");
        var sup = new BridgeSupervisor();
        File.WriteAllText(Path.Combine(_dir, "sleeper.cmd"), SleeperScript);
        var spec = Spec("twincat.100", "detach.cmd", DetachScript);

        sup.EnsureWorker(spec);
        Assert.True(WaitUntil(() => Held(lockFile)), "the detached grandchild never started");
        Assert.True(WaitUntil(() => !sup.IsWorkerRunning(spec.Id)), "the spawned worker was expected to exit at once");

        // The spawned process is already gone, so Kill(entireProcessTree: true) has nothing to walk — the only thing
        // that can still reap the survivor is the job object's KILL_ON_JOB_CLOSE (job membership is INHERITED by a
        // child's children). That is exactly the guard's documented purpose: a connector that dies without a clean
        // Dispose must not leave workers holding volt.bridge.twincat.<pid> pipes for the next start to collide with.
        sup.Dispose();
        Assert.True(WaitUntil(() => !Held(lockFile), 20000), "closing the job did not terminate the surviving worker");
    }

    [Fact]
    public void A_worker_whose_exe_is_missing_is_a_no_op_not_a_throw()
    {
        using var sup = new BridgeSupervisor();
        // Dev machines without a build have no VoltBridgeTwincat.exe; the reconcile must stay quiet rather than
        // throw out of the tray's timer tick.
        sup.EnsureWorker(new WorkerSpec("twincat.100", null));
        sup.EnsureWorker(new WorkerSpec("twincat.100", Path.Combine(_dir, "definitely-not-here.exe")));
        Assert.False(sup.IsWorkerRunning("twincat.100"));
    }
}
