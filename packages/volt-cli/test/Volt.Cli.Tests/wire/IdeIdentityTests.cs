using System.Text.Json;
using Volt.Contracts;
using Volt.Engine.Host;
using Volt.Wire;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// HEALTH SAYS WHICH IDE AND WHICH BRIDGE (openspec ide-identity-report 2.1–2.3, 2.5).
///
/// <para>Since the Volt bridge, every PLCAssist chat recorded only the vendor: an OEM IDE read as plain CODESYS, the
/// IDE version was empty, and the bridge version was <c>1.0.0.0</c> on all 135 chats. The identity is a set of
/// PROCESS facts on the top level of <c>health</c> — so a frame with no rows still carries it — stamped once in the
/// shared host for both vendors, and each is null when its source does not answer, never filled from another.</para>
/// </summary>
public class IdeIdentityTests
{
    private static string Pipe() => "volt.test." + System.Guid.NewGuid().ToString("N");

    private static JsonElement Health(FakeIde ide)
    {
        var pipe = Pipe();
        using var host = new BridgePipeHost(ide, pipe);
        host.Start();
        return new PipeClient(pipe).Call("health");
    }

    private static FakeIde Ide(string? version, string? name, string? productVersion, string? vendor,
        string? unsupported = null, bool project = true) =>
        new(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        {
            HealthProjectName = project ? "Demo" : null,
            Version = version,
            IdeProductName = name,
            IdeProductVersion = productVersion,
            IdeProductVendor = vendor,
            UnsupportedReason = unsupported,
        };

    private static string? Str(JsonElement h, string name) =>
        h.TryGetProperty(name, out var v) && v.ValueKind != JsonValueKind.Null ? v.GetString() : null;

    [Fact]
    public void Health_carries_the_product_the_platform_and_the_bridge_release()
    {
        // an OEM-shaped IDE: its own name, number and maker, a CODESYS platform under it
        var h = Health(Ide("3.5.19.50", "PLC Designer", "4.1.0.37740", "Lenze Automation GmbH"));

        Assert.Equal("PLC Designer", Str(h, "productName"));
        Assert.Equal("4.1.0.37740", Str(h, "productVersion"));
        Assert.Equal("Lenze Automation GmbH", Str(h, "productVendor"));
        Assert.Equal("3.5.19.50", Str(h, "ideVersion"));
        Assert.Equal(BridgePipeHost.Release, Str(h, "bridgeVersion"));   // the form itself: The_release_is_read_off_…
        Assert.NotNull(Str(h, "bridgeVersion"));
        Assert.NotEqual("1.0.0.0", Str(h, "bridgeVersion"));
    }

    [Fact]
    public void An_unread_platform_version_is_null_and_never_the_product_version()
    {
        var h = Health(Ide(null, "TcXaeShell", "15.0", "Beckhoff"));

        Assert.Null(Str(h, "ideVersion"));
        Assert.False(h.TryGetProperty("ideVersion", out _));   // absent on the wire means null
        Assert.Equal("15.0", Str(h, "productVersion"));
        Assert.Equal("TcXaeShell", Str(h, "productName"));
    }

    [Fact]
    public void An_unread_product_field_is_absent_not_guessed()
    {
        var h = Health(Ide("3.5.21.40", "CODESYS", "3.5.21.40", vendor: null));

        Assert.False(h.TryGetProperty("productVendor", out _));
        Assert.Equal("CODESYS", Str(h, "productName"));
    }

    /// <summary>A refused IDE, with no project open: exactly the support case — the frame has no rows, and the identity
    /// is still all there.</summary>
    [Fact]
    public void A_refused_IDE_with_no_rows_still_states_its_identity()
    {
        const string reason = "CODESYS 3.5.17.0 is not supported: it lacks the object manager (SystemInstances.ObjectMgr).";
        var h = Health(Ide("3.5.17.0", "CODESYS", "3.5.17.0", "CODESYS Development GmbH", reason, project: false));

        Assert.Equal(0, h.GetProperty("projects").GetArrayLength());
        Assert.Equal(reason, Str(h, "unsupported"));
        Assert.Equal("CODESYS", Str(h, "productName"));
        Assert.Equal("3.5.17.0", Str(h, "productVersion"));
        Assert.Equal("CODESYS Development GmbH", Str(h, "productVendor"));
        Assert.Equal("3.5.17.0", Str(h, "ideVersion"));
        Assert.NotNull(Str(h, "bridgeVersion"));
    }

    /// <summary>The host reads its OWN file, the way <c>volt --version</c> reads the CLI's — never the process's exe,
    /// which inside CODESYS is CODESYS.exe.</summary>
    [Fact]
    public void The_release_is_read_off_the_shared_hosts_own_file()
    {
        BridgeRelease.Of(typeof(BridgePipeHost).Assembly.Location, out var unreadable);
        Assert.Null(unreadable);
        // the D3 FORM, written out here off the file's own version-info — not a re-run of the expression the Lazy holds
        // (review gate 2): the assembly version, or any other reading, fails it
        var info = System.Diagnostics.FileVersionInfo.GetVersionInfo(typeof(BridgePipeHost).Assembly.Location);
        var stamped = info.FileVersion is { } f && f != "1.0.0.0" && f != "0.0.0.0";
        var plus = info.ProductVersion?.IndexOf('+') ?? -1;
        var expected = stamped ? info.FileVersion : plus < 0 ? "(dev)" : "(dev) " + info.ProductVersion![(plus + 1)..];
        Assert.Equal(expected, BridgePipeHost.Release);
        Assert.NotEqual(typeof(BridgePipeHost).Assembly.GetName().Version!.ToString(), BridgePipeHost.Release);
    }
}
