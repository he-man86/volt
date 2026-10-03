using System.Diagnostics;
using System.IO;
using System.Linq;
using Xunit;
using Volt.Contracts;

namespace Volt.Contracts.Tests;

/// <summary>
/// THE BRIDGE'S RELEASE, AS HEALTH REPORTS IT (openspec ide-identity-report 2.3, design D3).
///
/// <para>PLCAssist saw <c>1.0.0.0</c> on every one of 135 Volt-era chats: the only bridge version a client got was the
/// relay <c>hello</c>'s assembly version, and every bundle it ran was unstamped. The six bundles on hand are FOUR
/// builds — each file's <c>ProductVersion</c> is <c>1.0.0+&lt;commit&gt;</c> with its own commit — so both of the
/// obvious readings (assembly version, or <c>volt --version</c>'s bare <c>(dev)</c>) give all six one value. The rows
/// below are those measured values (S3) and the stamped scratch build (S4).</para>
/// </summary>
public class BridgeReleaseTests
{
    [Theory]
    // S4: a release build — FileVersion stamped from VOLT_VERSION, the same value `volt --version` prints.
    [InlineData("0.1.17258", "0.1.17258", "0.1.17258")]
    [InlineData("0.0.1.842", "0.0.1.842", "0.0.1.842")]
    // S3: the PLCAssist bundles — unstamped, the commit in ProductVersion tells the builds apart.
    [InlineData("1.0.0.0", "1.0.0+3a59f06a58e4", "(dev) 3a59f06a58e4")]
    [InlineData("1.0.0.0", "1.0.0+203657806a38", "(dev) 203657806a38")]
    [InlineData("0.0.0.0", "1.0.0+a93e5d7619b5", "(dev) a93e5d7619b5")]
    // an unstamped file with no version resource at all is still unstamped
    [InlineData(null, "1.0.0+1b5a160675de", "(dev) 1b5a160675de")]
    // only a ProductVersion that states no commit gives the bare word
    [InlineData("1.0.0.0", "1.0.0", "(dev)")]
    [InlineData("1.0.0.0", null, "(dev)")]
    [InlineData("1.0.0.0", "1.0.0+", "(dev)")]
    public void The_release_is_the_stamped_file_version_or_dev_and_the_commit(string? file, string? product, string expected)
    {
        Assert.Equal(expected, BridgeRelease.From(file, product));
    }

    [Fact]
    public void Four_unstamped_builds_report_four_values_and_none_is_the_shared_assembly_version()
    {
        var values = new[] { "3a59f06a58e4", "203657806a38", "a93e5d7619b5", "1b5a160675de" }
            .Select(c => BridgeRelease.From("1.0.0.0", "1.0.0+" + c)).ToList();
        Assert.Equal(4, values.Distinct().Count());
        Assert.DoesNotContain("1.0.0.0", values);
    }

    /// <summary>A real file, read the way the host reads its own: this repo's build is unstamped, so it reports the
    /// commit its own ProductVersion carries, verbatim.</summary>
    [Fact]
    public void A_repo_build_reads_its_own_files_commit()
    {
        var path = typeof(BridgeRelease).Assembly.Location;
        var info = FileVersionInfo.GetVersionInfo(path);
        var plus = info.ProductVersion!.IndexOf('+');
        Assert.True(plus > 0, $"this build's ProductVersion states no commit: {info.ProductVersion}");

        var release = BridgeRelease.Of(path, out var unreadable);

        Assert.Null(unreadable);
        Assert.Equal("(dev) " + info.ProductVersion.Substring(plus + 1), release);
    }

    [Fact]
    public void An_unreadable_own_file_reports_null_and_says_why()
    {
        var release = BridgeRelease.Of(Path.Combine(Path.GetTempPath(), "volt-no-such-bridge.dll"), out var unreadable);
        Assert.Null(release);
        Assert.NotNull(unreadable);

        Assert.Null(BridgeRelease.Of("", out var empty));
        Assert.NotNull(empty);
    }
}
