using System;
using System.IO;
using System.Linq;
using System.Threading;
using Volt.Wire;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Host;

namespace Volt.Cli.Tests;

/// <summary>PipeDiscovery enumerates the live named-pipe namespace so a client finds every CODESYS instance host
/// (each on its own <c>volt.bridge.codesys.&lt;pid&gt;</c>). Uses a unique prefix per test run so it never picks up a
/// real bridge.</summary>
public class PipeDiscoveryTests
{
    [Fact]
    public void Lists_every_live_server_under_a_prefix()
    {
        var prefix = "volt.test.disco." + Guid.NewGuid().ToString("N") + ".";
        var a = prefix + "1234";
        var b = prefix + "5678";
        using var hostA = new BridgePipeHost(new FakeIde(Array.Empty<FakeIde.Item>()), a);
        using var hostB = new BridgePipeHost(new FakeIde(Array.Empty<FakeIde.Item>()), b);
        hostA.Start();
        hostB.Start();
        // Start() spawns the accept thread; the NamedPipeServerStream binds a moment later, so wait for both.
        //
        // WAIT ON THE THING UNDER TEST, and fail loudly if it never happens. This polled `File.Exists` on the pipe
        // paths — a different mechanism from the `PipeDiscovery.List` enumeration the assertion uses, so the two
        // can disagree — and then gave up SILENTLY after 1s, leaving the real failure ("a pipe never bound") to
        // surface as a confusing list mismatch. Its sibling in CodesysMultiInstanceTests failed in CI exactly
        // that way.
        var found = new List<string>();
        for (int i = 0; i < 150; i++)
        {
            found = PipeDiscovery.List(prefix).OrderBy(x => x).ToList();
            if (found.Count == 2) break;
            Thread.Sleep(20);
        }

        Assert.Equal(new[] { a, b }, found);
    }

    [Fact]
    public void Empty_when_nothing_matches()
    {
        var prefix = "volt.test.disco." + Guid.NewGuid().ToString("N") + ".";
        Assert.Empty(PipeDiscovery.List(prefix));
    }

    [Fact]
    public void Enumerating_the_whole_namespace_never_throws()
    {
        // The real namespace holds system pipes with names illegal as file paths — the native walk must not throw.
        var ex = Record.Exception(() => PipeDiscovery.List(PipeNames.PrefixForVendor("codesys")));
        Assert.Null(ex);
    }
}
