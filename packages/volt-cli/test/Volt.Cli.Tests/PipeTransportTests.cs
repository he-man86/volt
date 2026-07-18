using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Volt.Cli.Core.Library;
using Volt.Cli.Core.Wire;
using Volt.Cli.Transport;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// The bridge wire tests, reformatted for the NAMED-PIPE transport (was HTTP + HttpClient in the bridge's
/// ProgressStreamTests). Same Core services, same FakeIde, same guarantees — proven over a pipe: a streamed op
/// yields progress frames then a result, the verbose-init progress folds into one phaseless total, and /health
/// advertises the activeOp of a concurrent in-flight mutation.
/// </summary>
public class PipeTransportTests
{
    private static string Pipe() => "volt.test." + Guid.NewGuid().ToString("N");

    [Fact]
    public void Fetch_streams_progress_then_a_result_over_the_pipe()
    {
        var items = Enumerable.Range(0, 60)
            .Select(i => FakeIde.Item.TextualPou($"P{i}", $"PROGRAM P{i}\nVAR\nEND_VAR", "x := 1;"))
            .ToArray();
        var pipe = Pipe();
        using var host = new BridgePipeHost(new FakeIde(items), pipe);
        host.Start();

        var progress = new List<JsonElement>();
        var result = new PipeClient(pipe).Call("fetch",
            new { knownItems = new Dictionary<string, string>() },
            onProgress: f => progress.Add(f.Clone()));

        Assert.NotEmpty(progress);                            // ≥1 progress frame
        Assert.True(result.TryGetProperty("changed", out _)); // the result IS a FetchResponse
    }

    [Fact]
    public void Verbose_init_folds_library_signatures_into_one_phaseless_total_over_the_pipe()
    {
        var items = Enumerable.Range(0, 30)
            .Select(i => FakeIde.Item.TextualPou($"P{i}", $"PROGRAM P{i}\nVAR\nEND_VAR", "x := 1;"))
            .ToArray();
        var libs = Enumerable.Range(0, 40)
            .Select(i => new LibSignature($"F{i}", "MyLib, 1.0.0.0 (v)", "Function",
                Array.Empty<LibVar>(), Array.Empty<LibVar>(), Array.Empty<LibVar>(), Array.Empty<LibVar>(), null, "INT"))
            .ToList();
        var pipe = Pipe();
        using var host = new BridgePipeHost(new FakeIde(items) { LibSignatures = libs }, pipe);
        host.Start();

        var progress = new List<JsonElement>();
        new PipeClient(pipe).Call("init", onProgress: f => progress.Add(f.Clone()));

        Assert.NotEmpty(progress);
        Assert.All(progress, p => Assert.False(p.TryGetProperty("phase", out _))); // no separate phase
        var last = progress[^1];
        Assert.Equal(items.Length + libs.Count, last.GetProperty("total").GetInt32());
        Assert.Equal(items.Length + libs.Count, last.GetProperty("done").GetInt32());
    }

    [Fact]
    public void Health_reports_the_active_op_while_a_mutation_is_in_flight_then_clears()
    {
        var entered = new ManualResetEventSlim(false);
        var release = new ManualResetEventSlim(false);
        var ide = new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        {
            ExtractEntered = entered,
            ExtractBlock = release,
        };
        var pipe = Pipe();
        using var host = new BridgePipeHost(ide, pipe);
        host.Start();

        Assert.Null(ActiveOp(pipe)); // idle → no activeOp

        var init = Task.Run(() => new PipeClient(pipe).Call("init"));
        Assert.True(entered.Wait(5000), "init never reached the library-extract step");

        Assert.Equal("init", ActiveOp(pipe)); // concurrent /health sees the in-flight op

        release.Set();
        Assert.True(init.Wait(5000), "init did not complete after release");

        string? op = "init";
        for (var i = 0; i < 100 && op != null; i++) { op = ActiveOp(pipe); if (op != null) Thread.Sleep(20); }
        Assert.Null(op); // cleared once the op completes
    }

    private static string? ActiveOp(string pipe)
    {
        var h = new PipeClient(pipe).Call("health");
        return h.TryGetProperty("activeOp", out var op) && op.ValueKind == JsonValueKind.String ? op.GetString() : null;
    }
}
