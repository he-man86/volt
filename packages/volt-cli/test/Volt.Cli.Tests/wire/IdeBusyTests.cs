using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Volt.Engine.Host;
using Volt.Wire;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// A PUSH OR BUILD WHILE ANOTHER ONE RUNS IS REFUSED, NOT NESTED (openspec <c>codesys-build-nesting</c>).
///
/// <para>Measured 2026-10-03 (PLCAssist's log): on CODESYS the build command pumps the primary thread, so a second
/// build, a fetch and 25 pushes ran INSIDE a build that held the IDE for minutes; the builds finished last-in,
/// first-out. TwinCAT's STA queue serialized the same requests instead — one vendor nested, one queued. The host now
/// TRIES one gate around <c>push</c> and <c>build</c> before marshalling, never waits on it, and answers a held gate
/// <c>IDE_BUSY</c> — identically on both vendors, since the gate is shared Core. Reads and <c>health</c> are not
/// gated: they change nothing.</para>
///
/// <para>The double runs every call inline (no serialization), so a held build lets other ops run beside it — the
/// CODESYS shape. Without the gate, the second build and the push below would run.</para>
/// </summary>
public class IdeBusyTests
{
    private static string Pipe() => "volt.test." + Guid.NewGuid().ToString("N");

    /// <summary>The call's refusal, within a liveness bound: without the gate the call runs INTO the held build and
    /// never answers, which must fail the test rather than hang it.</summary>
    private static PipeCallException Refused(Func<object> call)
    {
        var t = Task.Run(call);
        try
        {
            Assert.True(t.Wait(15_000), "the call did not answer — it ran beside the held build instead of being refused");
        }
        catch (AggregateException ae) when (ae.InnerException is PipeCallException p) { return p; }
        Assert.Fail("the call answered ok — it ran beside the held build instead of being refused");
        return null!;
    }

    [Fact]
    public void A_build_and_a_push_during_a_build_are_refused_IDE_BUSY_and_nothing_runs_twice()
    {
        using var entered = new ManualResetEventSlim(false);
        using var release = new ManualResetEventSlim(false);
        var ide = new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        {
            HealthProjectName = "Demo",
            BuildEntered = entered,
            BuildBlock = release,
        };
        var pipe = Pipe();
        using var host = new BridgePipeHost(ide, pipe);
        host.Start();

        var first = Task.Run(() => new PipeClient(pipe).Call("build"));
        try
        {
            Assert.True(entered.Wait(15_000), "the first build never reached the compile");
            var lease = new PipeClient(pipe).Call("refs").GetProperty("projectVersion").GetString();

            var build = Refused(() => new PipeClient(pipe).Call("build"));
            Assert.Equal("IDE_BUSY", build.Code);
            Assert.Equal("the IDE is running a build or push — nothing was applied", build.Message);

            var push = Refused(() => new PipeClient(pipe).Call("push", new
            {
                expectedProjectVersion = lease,
                ops = new object[]
                {
                    new { op = "set", name = "Q.pou", toFolder = "", ifVersion = (string?)null,
                          sourceText = "PROGRAM Q\nVAR\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\nEND_PROGRAM\n" },
                },
            }));
            Assert.Equal("IDE_BUSY", push.Code);

            // Not gated: reads and health still answer while the build holds the gate.
            new PipeClient(pipe).Call("refs");
            new PipeClient(pipe).Call("health");
        }
        finally { release.Set(); }

        Assert.True(first.Wait(15_000), "the first build never finished");
        Assert.Equal(1, ide.BuildSequence.Count(s => s == "build"));   // one compile
        Assert.Empty(ide.Recorded);                                     // no write

        // The gate is released when the op ends: the next build runs.
        new PipeClient(pipe).Call("build");
        Assert.Equal(2, ide.BuildSequence.Count(s => s == "build"));
    }

    [Fact]
    public void A_refused_push_releases_the_gate()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;")) { HealthProjectName = "Demo" };
        var pipe = Pipe();
        using var host = new BridgePipeHost(ide, pipe);
        host.Start();

        var bad = Assert.Throws<PipeCallException>(() => new PipeClient(pipe).Call("push", new { ops = "all of them" }));
        Assert.Equal("BAD_REQUEST", bad.Code);
        new PipeClient(pipe).Call("build");
        Assert.Equal(1, ide.BuildSequence.Count(s => s == "build"));
    }
}
