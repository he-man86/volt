using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Volt.Engine.Host;
using Volt.Wire;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// AN IDE THAT LACKS WHAT THE BRIDGE NEEDS IS REFUSED BY NAME (openspec <c>codesys-minimum-version</c> 2.2/2.3).
///
/// <para>Seen in the field 2026-09-30: a bridge inside CODESYS 3.5.17 printed "connected to IDE" and then failed
/// every call with an OS-localized <c>MissingMethodException</c> nobody could act on. The contract clients build
/// on is a CODE, <c>IDE_UNSUPPORTED</c>, on every call but <c>health</c>, with a fixed English message the driver
/// composes; and <c>health</c> keeps answering — not healthy — carrying the IDE version and the same reason, so a
/// client can show "CODESYS 3.5.17 — not supported" before it makes a call.</para>
///
/// <para>The refusal is by CAPABILITY, never by a version number (owner, 2026-10-01): an OEM IDE on an older
/// CODESYS platform that has everything is served. Enforced once in shared Core (<c>BridgePipeHost</c>), so both
/// vendors refuse identically; what a vendor lacks is the driver's to say.</para>
/// </summary>
public class IdeUnsupportedTests
{
    private static string Pipe() => "volt.test." + System.Guid.NewGuid().ToString("N");

    private const string Reason =
        "CODESYS 3.5.17.0 is not supported: it lacks the primary-thread dispatcher (SystemInstances.Engine.InvokeInPrimaryThread).";

    private static FakeIde Item(string? unsupported, string version) =>
        new(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        {
            HealthProjectName = "Demo",
            UnsupportedReason = unsupported,
            Version = version,
        };

    [Theory]
    [InlineData("connect")]
    [InlineData("disconnect")]
    [InlineData("refs")]
    [InlineData("fetch")]
    [InlineData("push")]
    [InlineData("build")]
    public void Every_op_but_health_is_refused_with_IDE_UNSUPPORTED_and_the_drivers_text(string op)
    {
        var pipe = Pipe();
        using var host = new BridgePipeHost(Item(Reason, "3.5.17.0"), pipe);
        host.Start();

        var ex = Assert.Throws<PipeCallException>(() =>
            new PipeClient(pipe).Call(op, new { knownItems = new Dictionary<string, string>() }));
        Assert.Equal("IDE_UNSUPPORTED", ex.Code);
        Assert.Equal(Reason, ex.Message);
    }

    [Fact]
    public void Health_still_answers_names_the_version_and_the_reason_and_serves_nothing()
    {
        var pipe = Pipe();
        using var host = new BridgePipeHost(Item(Reason, "3.5.17.0"), pipe);
        host.Start();

        var h = new PipeClient(pipe).Call("health");
        Assert.Equal("3.5.17.0", h.GetProperty("ideVersion").GetString());
        Assert.Equal(Reason, h.GetProperty("unsupported").GetString());
        Assert.All(h.GetProperty("projects").EnumerateArray(),
            p => Assert.Equal("idle", p.GetProperty("status").GetString()));
    }

    /// <summary>The other half of "by capability, not by number", at the HOST: a version far below SP21 with nothing
    /// missing is SERVED, and its health says so — no `unsupported` member at all. This double's `Unsupported` is
    /// injected, so it pins only that the shared host adds no floor of its own; that the CODESYS DRIVER adds none is
    /// pinned through the pipe with the real driver in <c>Volt.Ide.Codesys.Tests/CodesysUnsupportedHostTests</c>.</summary>
    [Fact]
    public void An_older_version_with_every_capability_is_served()
    {
        var pipe = Pipe();
        using var host = new BridgePipeHost(Item(null, "3.5.16.0"), pipe);
        host.Start();

        new PipeClient(pipe).Call("refs");
        var h = new PipeClient(pipe).Call("health");
        Assert.Equal("3.5.16.0", h.GetProperty("ideVersion").GetString());
        Assert.False(h.TryGetProperty("unsupported", out _));
        Assert.Contains(h.GetProperty("projects").EnumerateArray(),
            p => p.GetProperty("status").GetString() != "idle");
    }
}
