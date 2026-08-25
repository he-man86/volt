using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Cli.Sync;
using Volt.Wire;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Wire;

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
    public void PrefixForVendor_is_the_per_instance_discovery_prefix_for_both_vendors()
    {
        // Both vendors are discovered per-pid now; the resolver lists pipes under this prefix. A regression here
        // (e.g. the old bare `volt.bridge.twincat`) would send the CLI to a pipe nothing serves.
        Assert.Equal("volt.bridge.twincat.", PipeNames.PrefixForVendor("twincat"));
        Assert.Equal("volt.bridge.codesys.", PipeNames.PrefixForVendor("codesys"));
        Assert.Equal(PipeNames.TwincatPrefix, PipeNames.PrefixForVendor("twincat"));
        Assert.Equal(PipeNames.CodesysPrefix, PipeNames.PrefixForVendor("codesys"));
        // A worker's actual served pipe is the prefix + its pid — never the bare base.
        Assert.Equal("volt.bridge.twincat.17844", PipeNames.TwincatInstance(17844));
    }

    // ── push + refs over the pipe (fetch/init/health were covered; the push/refs framing was not) ──

    private static (string pipe, BridgePipeHost host) OneProgramHost()
    {
        var pipe = Pipe();
        var host = new BridgePipeHost(new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;")), pipe);
        host.Start();
        return (pipe, host);
    }

    [Fact]
    public void GetRefs_over_the_pipe_returns_the_project_shape()
    {
        var (pipe, host) = OneProgramHost();
        using (host)
        {
            var refs = new BridgeClient(pipe).GetRefs();
            Assert.False(string.IsNullOrEmpty(refs.ProjectVersion));
            Assert.Contains("PLC_PRG.prg", refs.Items.Keys);
        }
    }

    [Fact]
    public void PushBatch_over_the_pipe_returns_an_accepted_receipt()
    {
        var (pipe, host) = OneProgramHost();
        using (host)
        {
            var client = new BridgeClient(pipe);
            var refs = client.GetRefs();
            // Derive the edit from a real fetch so the SourceText round-trips in the canonical POU form.
            var src = client.FetchChanges(new FetchRequest { KnownItems = new Dictionary<string, string>() })
                .Changed.First(c => c.Name == "PLC_PRG.prg").SourceText.Replace("x := 1", "x := 2");
            var resp = client.PushBatch(new PushRequest
            {
                ExpectedProjectVersion = refs.ProjectVersion,
                Ops = new() { new SetItemOp { Name = "PLC_PRG.prg", IfVersion = refs.Items["PLC_PRG.prg"], SourceText = src } },
            });
            Assert.True(resp.Accepted);
            Assert.False(string.IsNullOrEmpty(resp.NewProjectVersion));
        }
    }

    [Fact]
    public void PushBatch_over_the_pipe_reports_a_project_conflict()
    {
        var (pipe, host) = OneProgramHost();
        using (host)
        {
            var client = new BridgeClient(pipe);
            var refs = client.GetRefs();
            var resp = client.PushBatch(new PushRequest
            {
                ExpectedProjectVersion = "stale-pv",
                Ops = new() { new SetItemOp { Name = "PLC_PRG.prg", IfVersion = refs.Items["PLC_PRG.prg"], SourceText = "PROGRAM PLC_PRG\nVAR\nEND_VAR\nx := 2;" } },
            });
            Assert.False(resp.Accepted);
            Assert.Contains(resp.Conflicts!, c => c.Name == "<project>");
        }
    }
}
