using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using Volt.Engine.Wire;
using Volt.Cli.Transport;
using Volt.Cli.Sync;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// Integration for the multiple-live-CODESYS path, over REAL named pipes — only the IDE behind the wire is faked
/// (<see cref="FakeIde"/>). Proves end to end that: two hosts on distinct pipes are both discovered; the CLI
/// resolver picks the bound project by a REAL health probe and REFUSES on same-name ambiguity; and CLOSING a host
/// removes its pipe from discovery. CI-runnable — needs no CODESYS install. A unique per-test pipe prefix keeps it
/// isolated from any real bridge (and from the other test) running on the box.
/// </summary>
public class CodesysMultiInstanceTests
{
    private readonly string _prefix = "volt.test.codesys." + Guid.NewGuid().ToString("N") + ".";

    private static FakeIde Ide(string project) => new()
    {
        HealthConnected = true,
        HealthProjectName = project,
        Projects = new List<ProjectEntry>
        {
            new ProjectEntry("codesys", "3.5", project, "healthy", false),
        },
    };

    private static BridgePipeHost StartHost(string pipe, string project)
    {
        var h = new BridgePipeHost(Ide(project), pipe);
        h.Start();
        WaitUntil(() => File.Exists(@"\\.\pipe\" + pipe));
        return h;
    }

    private static string? NameOf(string pipe)
    {
        try { return new BridgeClient(pipe).GetHealth().ProjectName; }
        catch { return null; }
    }

    // What the resolver actually probes now — the pipe's full open-project list (a real health round-trip).
    private static IReadOnlyList<string> ProjectsOf(string pipe)
    {
        try { return new BridgeClient(pipe).GetHealth().Projects.Select(p => p.Project).ToList(); }
        catch { return Array.Empty<string>(); }
    }

    private static void WaitUntil(Func<bool> cond)
    {
        for (int i = 0; i < 150 && !cond(); i++) Thread.Sleep(20);
    }

    [Fact]
    public void Two_live_hosts_are_discovered_the_resolver_probes_the_right_one_and_closing_one_drops_it()
    {
        var pa = _prefix + "1001";
        var pb = _prefix + "1002";
        var a = StartHost(pa, "MachineA");
        var b = StartHost(pb, "MachineB");
        try
        {
            // OPEN: both hosts discovered by a real pipe-namespace walk.
            Assert.Equal(new[] { pa, pb }, PipeDiscovery.List(_prefix).OrderBy(x => x));

            // A real health round-trip over each real pipe returns its project name.
            Assert.Equal("MachineA", NameOf(pa));
            Assert.Equal("MachineB", NameOf(pb));

            // The resolver picks the bound project's pipe (by the real probe above).
            Assert.Equal(pb, BridgeResolver.ChooseBridgePipe(PipeDiscovery.List(_prefix), "MachineB", false, ProjectsOf, "CODESYS"));

            // CLOSE MachineA: its pipe vanishes and discovery drops it (the pipe dies with Stop()).
            a.Stop();
            WaitUntil(() => !File.Exists(@"\\.\pipe\" + pa));
            Assert.Equal(new[] { pb }, PipeDiscovery.List(_prefix).ToArray());
            // One left → used unambiguously (a wrong-name mismatch is caught downstream by VerifyBinding).
            Assert.Equal(pb, BridgeResolver.ChooseBridgePipe(PipeDiscovery.List(_prefix), "MachineB", false, ProjectsOf, "CODESYS"));
        }
        finally { a.Dispose(); b.Dispose(); }
    }

    [Fact]
    public void Two_hosts_with_the_same_project_name_make_the_resolver_refuse_rather_than_guess()
    {
        var pa = _prefix + "2001";
        var pb = _prefix + "2002";
        var a = StartHost(pa, "SameName");
        var b = StartHost(pb, "SameName");
        try
        {
            var live = PipeDiscovery.List(_prefix);
            Assert.Equal(2, live.Count);
            var ex = Assert.Throws<BridgeError>(() => BridgeResolver.ChooseBridgePipe(live, "SameName", false, ProjectsOf, "CODESYS"));
            Assert.Equal("AMBIGUOUS_BRIDGE", ex.Code); // never guesses which of the two same-named IDEs
        }
        finally { a.Dispose(); b.Dispose(); }
    }

    [Fact]
    public void No_live_host_refuses_loudly()
    {
        Assert.Empty(PipeDiscovery.List(_prefix));
        var ex = Assert.Throws<BridgeError>(() => BridgeResolver.ChooseBridgePipe(PipeDiscovery.List(_prefix), "Anything", false, ProjectsOf, "CODESYS"));
        Assert.Equal("PLC_DISCONNECTED", ex.Code);
    }
}
