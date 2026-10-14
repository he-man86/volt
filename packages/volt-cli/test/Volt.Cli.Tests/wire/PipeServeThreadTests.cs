using System;
using System.Runtime.InteropServices;
using System.Threading;
using Volt.Engine.Host;
using Volt.Wire;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>Runs ALONE: it saturates the process's thread pool, which every other test shares.</summary>
[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class ThreadPoolSaturationCollection { public const string Name = "thread pool saturation"; }

/// <summary>
/// A REQUEST IS SERVED ON ITS OWN THREAD, NOT THE THREAD POOL'S (gate review of bridge-one-to-one step 4b, finding 7).
///
/// <para>`Health_polls_across_two_bridges…` timed out at 15 s during a suite run under the live re-pull's CPU load,
/// and passed alone. The cause was the accept loop handing every connection to <c>ThreadPool.QueueUserWorkItem</c>:
/// when the pool's threads are all blocked — the suite's own parallel tests waiting on pipes, or, in the field, the
/// host process's (CODESYS runs the bridge in-proc and shares its pool) — a request waits for the pool to inject a
/// thread, roughly one per half second. So the one ambient poll, `health`, which must answer from cache even while the
/// IDE is busy, could be held behind starvation it has nothing to do with, and the connector would read a live bridge
/// as lost. The load was the trigger, not the bug.</para>
///
/// <para>Structural, not a stopwatch on the read: the pool is saturated with work items that do not return until the
/// call has, so a request served on the pool cannot run before the bound — a pool that never grows would deadlock it;
/// one that grows at its injection rate answers only after it has injected past the saturation. 20 s is the liveness
/// bound; a dedicated thread answers in milliseconds.</para>
/// </summary>
[Collection(ThreadPoolSaturationCollection.Name)]
public class PipeServeThreadTests
{
    [Fact]
    public void Health_answers_while_the_thread_pool_is_saturated()
    {
        var pipe = "volt.test." + Guid.NewGuid().ToString("N");
        using var host = new BridgePipeHost(new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;")), pipe);
        host.Start();
        new PipeClient(pipe).Call("health");   // warm: JIT and the cached snapshot, before the pool is taken

        // Not disposed: queued items still start after Set and the method's end, and Wait on a disposed event throws on a
        // pool thread, which kills the test host (a 2-core CI runner has hundreds still queued then).
        var release = new ManualResetEventSlim(false);
        ThreadPool.GetMaxThreads(out var maxWorkers, out _);
        ThreadPool.GetMinThreads(out var minWorkers, out _);
        // Far more blocked items than the pool has threads or will inject within the bound.
        var saturation = Math.Min(maxWorkers, minWorkers + 200);
        for (var i = 0; i < saturation; i++) ThreadPool.QueueUserWorkItem(_ => release.Wait());
        try
        {
            Exception? failure = null;
            var answered = new ManualResetEventSlim(false);
            // The CLIENT on its own thread, so the test does not depend on the pool it just took.
            var client = new Thread(() =>
            {
                try { new PipeClient(pipe).Call("health"); }
                catch (Exception ex) { failure = ex; }
                finally { answered.Set(); }
            }) { IsBackground = true };
            client.Start();

            Assert.True(answered.Wait(TimeSpan.FromSeconds(20)),
                $"health did not answer within 20 s with {saturation} pool work items blocked — the request waited for a pool thread");
            Assert.Null(failure);
        }
        finally { release.Set(); }
    }

    /// <summary>THE NAME NEVER LAPSES BETWEEN TWO CALLS (gate review of step 4b; the completeness oracle lost a pull to
    /// `connect ENOENT` mid-run with the IDE alive). Served before the next instance was armed, a short request could
    /// finish and dispose its instance first, and a client connecting in that gap found no pipe of that name at all —
    /// `ERROR_FILE_NOT_FOUND`, which Node reports as ENOENT and does not retry (the C# client polls, so it cannot see
    /// it). Each open here is the shortest request there is: connect, send nothing, close. A busy pipe
    /// (`ERROR_PIPE_BUSY`) is the name existing and is no finding.</summary>
    [Fact]
    public void Back_to_back_calls_never_find_the_pipe_gone()
    {
        var pipe = "volt.test." + Guid.NewGuid().ToString("N");
        using var host = new BridgePipeHost(new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;")), pipe);
        host.Start();
        var gone = 0;
        var clients = new Thread[4];
        for (var c = 0; c < clients.Length; c++)
        {
            clients[c] = new Thread(() =>
            {
                for (var i = 0; i < 2000; i++)
                {
                    var h = CreateFileW(@"\\.\pipe\" + pipe, 0xC0000000, 0, IntPtr.Zero, 3, 0, IntPtr.Zero);
                    if (h == new IntPtr(-1)) { if (Marshal.GetLastWin32Error() == 2) Interlocked.Increment(ref gone); continue; }
                    using var s = new System.IO.FileStream(new Microsoft.Win32.SafeHandles.SafeFileHandle(h, true), System.IO.FileAccess.ReadWrite);
                    var req = System.Text.Encoding.UTF8.GetBytes("{\"op\":\"health\"}\n");
                    s.Write(req, 0, req.Length);
                    s.Flush();
                    var buf = new byte[4096];
                    while (s.Read(buf, 0, buf.Length) > 0) { }
                }
            }) { IsBackground = true };
            clients[c].Start();
        }
        foreach (var t in clients) Assert.True(t.Join(TimeSpan.FromSeconds(120)), "a client did not finish its opens");
        Assert.Equal(0, gone);
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);
}
