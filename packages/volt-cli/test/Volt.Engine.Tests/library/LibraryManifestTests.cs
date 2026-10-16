using Xunit;
using Volt.Engine.Library;

namespace Volt.Engine.Tests;

/// <summary>The one canonical `.library` manifest shape — the parity contract BOTH drivers (CODESYS + TwinCAT)
/// must produce via the shared builder, so the wire is byte-identical for the same concept.</summary>
public class LibraryManifestTests
{
    [Fact]
    public void Build_produces_the_canonical_shape_with_dependencies()
    {
        var m = LibraryManifest.Build(
            "CAA RTCLK", "RTCLK", "CAA Real Time Clock Extern, 3.5.17.0 (CAA Technical Workgroup)",
            placeholder: true, system: false, dependencies: new[] { "CAA Types", "CAA Async Manager" });

        Assert.Equal(
            "LIBRARY CAA RTCLK\n" +
            "NAMESPACE RTCLK\n" +
            "RESOLUTION CAA Real Time Clock Extern, 3.5.17.0 (CAA Technical Workgroup)\n" +
            "PLACEHOLDER true\n" +
            // SYSTEM is a flag spelled only where it is TRUE (openspec bridge-one-to-one §2.R): `SYSTEM false` is gone.
            "DEPENDENCIES CAA Types, CAA Async Manager\n" +
            "MATERIALIZATION 4\n",
            m);
    }

    /// <summary>CODESYS's other reference flags (census: <c>LinkAllContent</c> 5, <c>QualifiedOnly</c> 1 of 264) are
    /// spelled only where true, and a reference's parameters (TwinCAT's <c>ParameterList</c>) one line each.</summary>
    [Fact]
    public void Flags_are_spelled_only_where_true_and_parameters_one_line_each()
    {
        var m = LibraryManifest.Build(
            "Tc2_System", "Tc2_System", "Tc2_System, 3.10.1.0 (Beckhoff Automation GmbH)",
            placeholder: true, system: false, dependencies: new[] { "Tc2_Standard" }, linkAllContent: true,
            qualifiedOnly: true, parameters: new[] { ("PARAM.TABLE_UPPER_BOUND", "15"), ("PARAM.TABLE_SHOW_VALID_ITEMS", "FALSE") });

        Assert.Equal(
            "LIBRARY Tc2_System\n" +
            "NAMESPACE Tc2_System\n" +
            "RESOLUTION Tc2_System, 3.10.1.0 (Beckhoff Automation GmbH)\n" +
            "PLACEHOLDER true\n" +
            "LINKALLCONTENT\n" +
            "QUALIFIEDONLY\n" +
            "DEPENDENCIES Tc2_Standard\n" +
            "PARAMETER Tc2_System PARAM.TABLE_UPPER_BOUND := 15\n" +
            "PARAMETER Tc2_System PARAM.TABLE_SHOW_VALID_ITEMS := FALSE\n" +
            "MATERIALIZATION 4\n",
            m);
    }

    /// <summary>The three reference flags of CODESYS's reference dialog the census measured false on all 264 references —
    /// <c>Optional</c>, <c>HideWhenReferencedAsDependency</c>, <c>PublishSymbolsInContainer</c> — are spelled like the
    /// others: a bare line, only where true, after QUALIFIEDONLY. The default live fixture holds the first and the last
    /// (<c>CmpCodeMeter</c> Optional; <c>CmpEventMgr</c> / <c>CmpIoMgr</c> PublishSymbolsInContainer), which the
    /// manifest had no line for, so those references were not materialized.</summary>
    [Fact]
    public void Optional_hidden_and_published_references_are_spelled_where_true()
    {
        var m = LibraryManifest.Build(
            "CmpCodeMeter", "CmpCodeMeter", "CmpCodeMeter, 3.5.17.0 (System)",
            placeholder: true, system: true, linkAllContent: true, qualifiedOnly: true,
            optional: true, hideWhenReferencedAsDependency: true, publishSymbolsInContainer: true);

        Assert.Equal(
            "LIBRARY CmpCodeMeter\n" +
            "NAMESPACE CmpCodeMeter\n" +
            "RESOLUTION CmpCodeMeter, 3.5.17.0 (System)\n" +
            "PLACEHOLDER true\n" +
            "SYSTEM true\n" +
            "LINKALLCONTENT\n" +
            "QUALIFIEDONLY\n" +
            "OPTIONAL\n" +
            "HIDEWHENREFERENCEDASDEPENDENCY\n" +
            "PUBLISHSYMBOLSINCONTAINER\n" +
            "MATERIALIZATION 4\n",
            m);
    }

    /// <summary>The measured default (false, on every one of the 264 corpus references) writes NO line, so every
    /// `.library` file pulled before these flags were read stays byte-identical — and with it its version hash.</summary>
    [Fact]
    public void A_flag_at_its_measured_default_writes_no_line()
    {
        var plain = LibraryManifest.Build("Standard", "Standard", "Standard, * (System)", placeholder: true, system: false);
        var defaults = LibraryManifest.Build("Standard", "Standard", "Standard, * (System)", placeholder: true, system: false,
            optional: false, hideWhenReferencedAsDependency: false, publishSymbolsInContainer: false);

        Assert.Equal(plain, defaults);
        Assert.Equal(
            "LIBRARY Standard\nNAMESPACE Standard\nRESOLUTION Standard, * (System)\nPLACEHOLDER true\nMATERIALIZATION 4\n",
            defaults);
    }

    [Fact]
    public void Resolution_formats_name_version_distributor()
    {
        Assert.Equal("Tc2_System, 3.10.1.0 (Beckhoff Automation GmbH)",
            LibraryManifest.Resolution("Tc2_System", "3.10.1.0", "Beckhoff Automation GmbH"));
    }

    [Fact]
    public void Build_omits_the_dependencies_line_when_there_are_none()
    {
        var m = LibraryManifest.Build(
            "Tc2_Standard", "Tc2_Standard", "Tc2_Standard, * (Beckhoff Automation GmbH)",
            placeholder: true, system: true);

        Assert.Equal(
            "LIBRARY Tc2_Standard\n" +
            "NAMESPACE Tc2_Standard\n" +
            "RESOLUTION Tc2_Standard, * (Beckhoff Automation GmbH)\n" +
            "PLACEHOLDER true\n" +
            "SYSTEM true\n" +
            "MATERIALIZATION 4\n",
            m);
    }
}
