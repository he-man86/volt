using System;
using System.Threading;
using Volt.Wire;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// THE PIPE NAME IS CLAIMED BEFORE THE SERVER EXISTS (openspec twincat-double-click-next-free-xae). A double-click
/// TwinCAT bridge claims an XAE's pipe name before it attaches to that XAE, so a window another bridge serves is
/// passed over untouched. The claim is the one cross-process mutex <see cref="PipeServer"/> already took inside
/// <c>Start</c>; the server then serves under the claim it is given.
/// </summary>
public class PipeNameClaimTests
{
    private static string Pipe() => "volt.test.claim." + Guid.NewGuid().ToString("N");

    [Fact]
    public void A_server_started_under_a_claim_taken_before_it_serves_that_name()
    {
        var pipe = Pipe();
        var claim = PipeServer.TakeName(pipe);
        using var server = new PipeServer(claim, (req, emit) => new { ok = true });
        server.Start();

        Assert.True(new PipeClient(pipe).Call("health", connectTimeoutMs: 5000).GetProperty("ok").GetBoolean());
        Assert.Throws<PipeNameTakenException>(() => PipeServer.TakeName(pipe));

        server.Dispose();
        PipeServer.TakeName(pipe).Dispose();   // the server released the claim it was given
    }

    [Fact]
    public void A_second_claim_fails_while_the_first_is_held_and_succeeds_once_it_is_released()
    {
        var pipe = Pipe();
        var first = PipeServer.TakeName(pipe);

        var taken = Assert.Throws<PipeNameTakenException>(() => PipeServer.TakeName(pipe));
        Assert.Contains("already served", taken.Message);

        first.Dispose();
        PipeServer.TakeName(pipe).Dispose();
    }

    /// <summary>Another PROCESS holds the name: the mutex alone refuses it. Stood for by a thread holding the raw
    /// mutex (ownership is per thread, so another thread of this process is refused exactly as another process).</summary>
    [Fact]
    public void A_name_held_by_another_owner_is_refused_and_taken_over_once_that_owner_is_abandoned()
    {
        var pipe = Pipe();
        var held = new ManualResetEventSlim();
        var release = new ManualResetEventSlim();
        var owner = new Thread(() =>
        {
            var m = new Mutex(false, PipeServer.MutexName(pipe));
            m.WaitOne();
            held.Set();
            release.Wait();
            // ends WITHOUT ReleaseMutex: the mutex is abandoned, as a crashed bridge leaves it
        });
        owner.Start();
        held.Wait();

        Assert.Throws<PipeNameTakenException>(() => PipeServer.TakeName(pipe));

        release.Set();
        owner.Join();
        PipeServer.TakeName(pipe).Dispose();
    }
}
