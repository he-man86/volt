using Xunit;
using Volt.Contracts;

namespace Volt.Cli.Tests;

/// <summary>
/// The wire's diagnostic severity vocabulary. Both drivers mapped a vendor's word to it themselves and neither
/// mapping was executed by a test — while <c>BuildService</c> COUNTS on these exact strings to report "N errors,
/// M warnings", so a word that fell through to a different spelling was silently counted as info.
/// </summary>
public class SeverityTests
{
    /// <summary>CODESYS hands over a .NET enum NAME. The three error-ish spellings it is known to produce all
    /// have to reach `error`, and they are matched as substrings because the enum's full set was never
    /// enumerated — `CompileErrorSeverity` must not read as anything else.</summary>
    [Theory]
    [InlineData("Error", "error")]
    [InlineData("FatalError", "error")]
    [InlineData("Exception", "error")]
    [InlineData("CompileErrorSeverity", "error")]
    [InlineData("Warning", "warning")]
    [InlineData("CompileWarning", "warning")]
    [InlineData("Information", "info")]
    [InlineData("Note", "info")]
    public void A_a_vendor_enum_name_maps_to_the_wire_vocabulary(string vendor, string expected)
    {
        Assert.Equal(expected, Severity.Of(vendor));
    }

    /// <summary>TwinCAT's output-window regex yields exactly `error`, `warning` or `message`. The last is its
    /// word for informational, and used to be a hand-written special case in the driver.</summary>
    [Theory]
    [InlineData("error", "error")]
    [InlineData("warning", "warning")]
    [InlineData("message", "info")]
    public void B_the_TwinCAT_output_window_words_map_too(string vendor, string expected)
    {
        Assert.Equal(expected, Severity.Of(vendor));
    }

    /// <summary>Case-insensitive: TwinCAT lowercases its capture, CODESYS does not, and neither should have to.</summary>
    [Theory]
    [InlineData("ERROR")]
    [InlineData("eRRoR")]
    public void C_matching_ignores_case(string vendor) => Assert.Equal("error", Severity.Of(vendor));

    /// <summary>Anything unrecognised — including null — is INFO, and that direction is deliberate. Inventing an
    /// error would fail a build that actually passed, on CODESYS where success IS "no error-severity message".</summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("SomethingNobodyHasSeen")]
    public void D_an_unknown_severity_is_info_not_error(string? vendor) =>
        Assert.Equal("info", Severity.Of(vendor));
}
