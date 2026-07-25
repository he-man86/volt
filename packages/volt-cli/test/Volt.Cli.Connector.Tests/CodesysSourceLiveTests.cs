using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Volt.Engine.Wire;
using Volt.Cli.Transport;
using Volt.Cli.Tests; // the shared FakeIde
using Xunit;

namespace Volt.Cli.Connector.Tests;

/// <summary>
/// Integration for the connector's CODESYS stack over REAL named pipes (only the IDE is faked). Proves the
/// discovery-backed <see cref="CodesysProjectSource"/> + <see cref="ConnectionManager"/> handle the multi-instance
/// lifecycle: every live host is listed with its pipe, connect keeps exactly ONE active (switching clears the
/// other), Disconnect deselects the bridge while hosts stay live + listed, and CLOSING a host drops it — clearing the active connection
/// if it was the closed one. CI-runnable; a unique per-test prefix isolates it from any real bridge on the box.
/// </summary>
public class CodesysSourceLiveTests
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
        for (int i = 0; i < 150 && !File.Exists(@"\\.\pipe\" + pipe); i++) Thread.Sleep(20);
        return h;
    }

    // The real discovery-backed source, filtered to this test's prefix so it ignores any real bridge.
    private CodesysProjectSource Source() => new(() => PipeDiscovery.List(_prefix), pipe => new PipeBridgeWire(pipe));

    [Fact]
    public async Task Lists_every_live_host_connect_keeps_one_active_and_closing_a_host_drops_and_deselects_it()
    {
        var pa = _prefix + "1";
        var pb = _prefix + "2";
        var a = StartHost(pa, "MachineA");
        var b = StartHost(pb, "MachineB");
        var mgr = new ConnectionManager(new IProjectSource[] { Source() });
        try
        {
            await mgr.RefreshAsync();
            var projs = mgr.Projects.OrderBy(p => p.DisplayName).ToList();
            Assert.Equal(new[] { "MachineA", "MachineB" }, projs.Select(p => p.DisplayName));
            Assert.Equal(pa, projs[0].Pipe);   // each carries its serving pipe
            Assert.Equal(pb, projs[1].Pipe);

            await mgr.ConnectAsync(projs[0]);
            Assert.Equal("MachineA", mgr.ActiveConnection?.DisplayName);
            await mgr.ConnectAsync(projs[1]);  // switch — one active at a time
            Assert.Equal("MachineB", mgr.ActiveConnection?.DisplayName);

            await mgr.DisconnectAsync();
            Assert.Null(mgr.ActiveConnection);
            await mgr.RefreshAsync();
            Assert.Equal(2, mgr.Projects.Count); // Disconnect tore nothing down — both hosts still live + listed

            // Connect A, then CLOSE its host: refresh drops it and clears the (now-gone) active connection.
            await mgr.ConnectAsync(mgr.Projects.First(p => p.DisplayName == "MachineA"));
            a.Stop();
            for (int i = 0; i < 150 && File.Exists(@"\\.\pipe\" + pa); i++) Thread.Sleep(20);
            await mgr.RefreshAsync();

            Assert.Equal(new[] { "MachineB" }, mgr.Projects.Select(p => p.DisplayName));
            Assert.Null(mgr.ActiveConnection);
        }
        finally { a.Dispose(); b.Dispose(); }
    }
}
