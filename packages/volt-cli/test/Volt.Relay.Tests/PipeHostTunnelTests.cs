using System;
using System.Collections.Generic;
using System.IO;
using Volt.Relay;
using Xunit;

namespace Volt.Relay.Tests;

/// <summary>Every relay state at start is a line (openspec bridge-console-says-what-it-serves): an install with no
/// relay said nothing, so a console or a log could not tell "not configured" from "never got that far".</summary>
public class PipeHostTunnelTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "volt-tunnel-start-" + Guid.NewGuid().ToString("N"));
    private readonly List<string> _info = new();
    private readonly List<string> _error = new();

    public PipeHostTunnelTests() => Directory.CreateDirectory(_dir);

    public void Dispose()
    {
        try { Directory.Delete(_dir, true); } catch { }
    }

    private RelayTunnel? Start(out string state) => PipeHostTunnel.StartIfConfigured(
        _dir, "volt.test.tunnel." + Guid.NewGuid().ToString("N"), "twincat", "0.0.0-test", _info.Add, _error.Add, out state);

    [Fact]
    public void No_sidecar_and_no_setup_code_is_the_line_relay_not_configured()
    {
        Assert.Null(Start(out var state));

        Assert.Equal(new[] { "relay: not configured" }, _info);
        Assert.Empty(_error);
        Assert.Equal("relay not configured", state);
    }

    [Fact]
    public void A_sidecar_starts_the_tunnel_dialing_its_host()
    {
        File.WriteAllText(Path.Combine(_dir, RelaySidecar.FileName), "{\"url\":\"wss://relay.test/bridge\",\"token\":\"t\"}");

        using var tunnel = Start(out var state);

        Assert.NotNull(tunnel);
        Assert.Equal("relay dialing relay.test", state);
        Assert.DoesNotContain("relay: not configured", _info);
    }

    [Fact]
    public void A_sidecar_that_cannot_be_read_is_not_started_with_its_reason()
    {
        File.WriteAllText(Path.Combine(_dir, RelaySidecar.FileName), "{ not json");

        Assert.Null(Start(out var state));

        Assert.StartsWith("relay not started: ", state);
        Assert.Single(_error, l => l.StartsWith("relay: tunnel did not start: ", StringComparison.Ordinal));
        Assert.DoesNotContain("relay: not configured", _info);
    }
}
