using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Cli.Core.Wire;
using Volt.Cli.Host;
using Volt.Cli.Sync;
using Volt.Cli.Transport;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>The CLI's bridge client over the pipe, using Core's DTOs — the port of volt-git's bridge/client.ts,
/// verified end-to-end against the pipe host + FakeIde.</summary>
public class BridgeClientTests
{
    private static string Pipe() => "volt.test." + Guid.NewGuid().ToString("N");

    [Fact]
    public void FetchChanges_returns_a_typed_response_and_forwards_progress()
    {
        var items = Enumerable.Range(0, 60)
            .Select(i => FakeIde.Item.TextualPou($"P{i}", $"PROGRAM P{i}\nVAR\nEND_VAR", "x := 1;"))
            .ToArray();
        var pipe = Pipe();
        using var host = new BridgePipeHost(new FakeIde(items), pipe);
        host.Start();

        var frames = 0;
        var resp = new BridgeClient(pipe).FetchChanges(new FetchRequest { KnownItems = new Dictionary<string, string>() }, _ => frames++);

        Assert.True(resp.Items.Count >= 60);                        // full version map (typed)
        Assert.Contains(resp.Changed, c => c.Name == "P0.prg");     // materialized wire name
        Assert.True(frames >= 1);                                   // progress forwarded as typed ProgressFrame
    }

    [Fact]
    public void GetHealth_deserializes()
    {
        var pipe = Pipe();
        using var host = new BridgePipeHost(new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;")), pipe);
        host.Start();

        var h = new BridgeClient(pipe).GetHealth();
        Assert.NotNull(h); // a typed HealthResponse, no wire-version handshake needed
    }

    [Fact]
    public void ForPort_maps_8555_to_twincat_8556_to_codesys()
    {
        Assert.Equal(PipeNames.Beckhoff, PipeNames.ForPort(8555));
        Assert.Equal(PipeNames.Codesys, PipeNames.ForPort(8556));
    }
}
