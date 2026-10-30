using System;
using System.Threading;
using System.Threading.Tasks;
using Volt.Engine.Host;
using Volt.Wire;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// A REFS THAT ARRIVES WHILE AN IDENTICAL ONE RUNS JOINS IT (openspec <c>twincat-large-solution-refs</c> 1). On an
/// 18-PLC-project TwinCAT solution a <c>refs</c> took 148 s; the relay gave up at 60 s and its caller asked again, and
/// every retry queued one more full walk behind the one still on the IDE's thread. A joined retry waits for the walk
/// under way and answers what it answers — one walk, never one per retry. Not a cache: a <c>refs</c> after it ends
/// walks afresh.
/// </summary>
public class RefsSingleFlightTests
{
    private static string Pipe() => "volt.test." + Guid.NewGuid().ToString("N");

    /// <summary>Set when the bridge logs that a refs joined the running one — the moment the joiner is waiting, so the
    /// test releases the held walk only then (a sleep raced it under a loaded suite).</summary>
    private sealed class JoinWatch : System.IO.StringWriter
    {
        public readonly ManualResetEventSlim Joined = new(false);
        public override void WriteLine(string? value)
        {
            if (value?.Contains("an identical refs is running", StringComparison.Ordinal) == true) Joined.Set();
        }
        public override void Write(string? value) => WriteLine(value);
    }

    private static JoinWatch Watch()
    {
        var watch = new JoinWatch();
        Volt.Contracts.VoltLog.TeeTo(watch);
        return watch;
    }

    private static (FakeIde Ide, ManualResetEventSlim Entered, ManualResetEventSlim Release) Held()
    {
        var entered = new ManualResetEventSlim(false);
        var release = new ManualResetEventSlim(false);
        var ide = new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"));
        ide.OnWalkItems = () =>
        {
            if (ide.WalkCalls != 1) return;   // only the first walk is held
            entered.Set();
            release.Wait(TimeSpan.FromSeconds(30));
        };
        return (ide, entered, release);
    }

    [Fact]
    public void A_refs_during_an_identical_refs_answers_from_the_same_walk()
    {
        var (ide, entered, release) = Held();
        var pipe = Pipe();
        using var host = new BridgePipeHost(ide, pipe);
        host.Start();

        var watch = Watch();
        var first = TestUtil.OnOwnThread(() => new PipeClient(pipe).Call("refs").GetRawText());
        Assert.True(entered.Wait(15_000), "the first refs never reached its walk");
        var second = TestUtil.OnOwnThread(() => new PipeClient(pipe).Call("refs").GetRawText());
        try { Assert.True(watch.Joined.Wait(15_000), "the second refs never joined the first"); }
        finally { Volt.Contracts.VoltLog.TeeTo(null); release.Set(); }

        Assert.True(Task.WaitAll(new Task[] { first, second }, 15_000), "a refs did not answer");
        Assert.Equal(first.Result, second.Result);
        Assert.Equal(1, ide.WalkCalls);

        // Not a cache: the next refs walks again.
        new PipeClient(pipe).Call("refs");
        Assert.Equal(2, ide.WalkCalls);
    }

    [Fact]
    public void A_refs_asking_another_question_is_not_joined()
    {
        var (ide, entered, release) = Held();
        var pipe = Pipe();
        using var host = new BridgePipeHost(ide, pipe);
        host.Start();

        var first = TestUtil.OnOwnThread(() => new PipeClient(pipe).Call("refs"));
        Assert.True(entered.Wait(15_000), "the first refs never reached its walk");
        // Another baseline is another question: its `removed` is its own, so it is not answered from the first walk.
        var other = new PipeClient(pipe).Call("refs", new { knownItems = new { }, knownApplications = new string[0] });
        Assert.Equal(2, ide.WalkCalls);
        release.Set();
        Assert.True(first.Wait(15_000), "the first refs did not answer");
        Assert.True(other.TryGetProperty("projectVersion", out _));
    }

    [Fact]
    public void A_joined_refs_gets_the_progress_frames_sent_after_it_joined()
    {
        var (ide, entered, release) = Held();
        var pipe = Pipe();
        using var host = new BridgePipeHost(ide, pipe);
        host.Start();

        var first = TestUtil.OnOwnThread(() => new PipeClient(pipe).Call("refs"));
        Assert.True(entered.Wait(15_000), "the first refs never reached its walk");
        var frames = 0;
        var watch = Watch();
        var second = TestUtil.OnOwnThread(() => new PipeClient(pipe).Call("refs", onProgress: _ => Interlocked.Increment(ref frames)));
        try { Assert.True(watch.Joined.Wait(15_000), "the second refs never joined the first"); }
        finally { Volt.Contracts.VoltLog.TeeTo(null); release.Set(); }

        Assert.True(Task.WaitAll(new Task[] { first, second }, 15_000), "a refs did not answer");
        Assert.True(frames > 0, "the joined refs saw no progress frame");
    }
}
