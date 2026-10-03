using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.Loader;
using System.Text.Json;
using System.Threading.Tasks;
using Volt.Contracts;
using Volt.Engine.Host;
using Volt.Relay;
using Volt.Tests.Shared;
using Volt.Wire;
using Xunit;

namespace Volt.Relay.Tests;

/// <summary>
/// WHAT A REMOTE CLIENT (PLCAssist) RECEIVES IS ENOUGH TO ANSWER 3.1 / 3.2 (openspec ide-identity-report).
///
/// <para>PLCAssist reaches a bridge only through the relay: it records what <c>health</c> answers and the message of
/// every error frame. The 3.5.17 failure arrived there as a bare, OS-localized message; nothing it received said
/// which exception type it was, nor which copies of Volt were loaded. Here, end to end (real tunnel, real pipe, real
/// host, faked socket only): an uncoded failure on EITHER side of the pipe crosses with its type and the load evidence,
/// and <c>health</c> names a second copy of a Volt assembly the moment one is loaded.</para>
/// </summary>
public class LoadEvidenceRelayTests : IDisposable
{
    private readonly List<IDisposable> _disposables = new();

    public void Dispose()
    {
        foreach (var d in _disposables) { try { d.Dispose(); } catch { } }
    }

    private static string Pipe() => "volt.test.relay." + Guid.NewGuid().ToString("N");

    private FakeRelay Tunnel(string pipe, LogCapture? log = null)
    {
        var relay = new FakeRelay();
        var config = RelaySidecar.Parse("{\"url\":\"wss://relay.test/bridge\",\"token\":\"t\"}", "test");
        var tunnel = new RelayTunnel(config, pipe, "codesys", "0.0.0-test", relay.NewSocket, null, log == null ? null : log.Write);
        _disposables.Add(tunnel);
        tunnel.Start();
        Assert.True(relay.Connected.Wait(10_000), "the tunnel never dialed out");
        return relay;
    }

    private FakeRelay Served(FakeIde ide, LogCapture? log = null)
    {
        var pipe = Pipe();
        var host = new BridgePipeHost(ide, pipe);
        host.Start();
        _disposables.Add(host);
        return Tunnel(pipe, log);
    }

    private static FakeIde Ide() => new(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
    {
        Projects = new List<ProjectEntry> { new("codesys", "0", "Proj", "healthy", false) },
    };

    /// <summary>The bridge side: a member missing at call time crosses the relay as INTERNAL_ERROR with its type, the
    /// member verbatim, and the load evidence — the remote client's whole record of the failure.</summary>
    [Fact]
    public async Task A_member_missing_inside_the_bridge_reaches_the_remote_client_with_type_member_and_load_evidence()
    {
        const string field = "Method not found: 'Void Volt.Wire.PipeClient.Call(System.String, System.Object, " +
                             "System.Action`1<System.Text.Json.JsonElement>, Int32)'.";
        var ide = Ide();
        ide.CallFault = () => new MissingMethodException(field);
        var relay = Served(ide);
        await relay.AwaitHello();

        relay.SendRequest("r1", Ops.Refs);
        var error = await relay.AwaitFrame("r1", "error");

        Assert.Equal(BridgeErrorCodes.InternalError, error.GetProperty("code").GetString());
        var message = error.GetProperty("message").GetString()!;
        Assert.StartsWith("MissingMethodException: " + field + " [", message);
        Assert.Matches(@"\[(loaded: one copy of each|load conflict: )", message);
    }

    /// <summary>The relay side: the 3.5.17 failure was thrown IN the relay (it is <c>Volt.Relay</c> that calls
    /// <c>PipeClient.Call</c>). Its catch arm said only the message and logged it at Warn without a stack. Driven here
    /// by a pipe nobody serves — an uncoded <c>TimeoutException</c> out of <c>PipeClient.Call</c>, the same arm.</summary>
    [Fact]
    public async Task A_failure_inside_the_relay_says_its_type_and_logs_the_whole_exception()
    {
        var log = new LogCapture();
        var pipe = Pipe();
        var relay = Tunnel(pipe, log);   // no host on this pipe
        await relay.AwaitHello();

        relay.SendRequest("r1", Ops.Health);
        var error = await relay.AwaitFrame("r1", "error");

        Assert.Equal(BridgeErrorCodes.InternalError, error.GetProperty("code").GetString());
        Assert.StartsWith("TimeoutException: ", error.GetProperty("message").GetString());
        var logged = Assert.Single(log.At(VoltLogLevel.Error), l => l.StartsWith($"relay: 'health' failed on pipe {pipe} — "));
        Assert.Contains("System.TimeoutException", logged);
        Assert.Contains("   at Volt.Wire.PipeClient.Call", logged);   // the stack names the call
    }

    /// <summary>3.2: <c>health</c> names a second copy of a Volt assembly — absent while there is one build, present the
    /// moment another copy is loaded (as a second CODESYS session's or another bridge folder's would be), with its
    /// location and build. A copy loaded into its own load context is the .NET form of net48's LoadFrom from a second
    /// folder: two instances of one assembly in one process.</summary>
    [Fact]
    public async Task Health_names_a_second_copy_of_a_Volt_assembly_once_one_is_loaded()
    {
        var relay = Served(Ide());
        await relay.AwaitHello();

        relay.SendRequest("r1", Ops.Health);
        var before = await relay.AwaitFrame("r1", "result");
        Assert.False(before.TryGetProperty("loadConflicts", out var unexpected),
            "one build, one copy of each — yet health reported: " + unexpected);

        var dir = Path.Combine(Path.GetTempPath(), "volt-second-build-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        var copy = Path.Combine(dir, "Volt.Wire.dll");
        File.Copy(typeof(PipeClient).Assembly.Location, copy);
        new AssemblyLoadContext("second-volt-build", isCollectible: false).LoadFromAssemblyPath(copy);

        relay.SendRequest("r2", Ops.Health);
        var after = await relay.AwaitFrame("r2", "result");
        var conflict = Assert.Single(after.GetProperty("loadConflicts").EnumerateArray().Select(e => e.GetString()!),
            c => c.StartsWith("Volt.Wire loaded 2 times: "));
        Assert.Contains(typeof(PipeClient).Assembly.Location, conflict);
        Assert.Contains(copy, conflict);
        Assert.Contains("product " + LoadedCopies.Of(typeof(PipeClient).Assembly).ProductVersion, conflict);
    }
}
