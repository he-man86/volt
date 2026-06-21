using System.Linq;
using System.Xml.Linq;
using Volt.Bridge.Core.Graphical;
using Volt.Bridge.Core.Graphical.Vg;
using Xunit;

namespace Volt.Bridge.Tests;

/// <summary>
/// The LD (ladder) featureset, exercised through the full writer+reader pipeline: a VG ladder body is
/// generated to PLCopen <c>&lt;LD&gt;</c> (real contact/coil/power-rails) by <see cref="PlcOpenWriter"/>,
/// read back by <see cref="PlcOpenReader"/>, and re-rendered to VG. Each case asserts the boolean logic
/// survives at the element level AND that a second pass is a FIXED POINT (the canonical VG stabilises, so
/// re-editing never drifts). Companion to <see cref="FbdCoverageTests"/> (the refusal matrix) and the live
/// e2e / CLI ladder suites — coverage is duplicated across the three test layers on purpose.
/// </summary>
public class LadderRoundTripTests
{
    private const string Ns = "http://www.plcopen.org/xml/tc6_0200";

    /// <summary>VG → generated PLCopen <c>&lt;LD&gt;</c> element (for element-level assertions).</summary>
    private static XElement ToLadder(string vg) => PlcOpenWriter.WriteBody(VgParser.Parse(vg));

    /// <summary>VG → <c>&lt;LD&gt;</c> → VG: one full write+read pass through the ladder pipeline.</summary>
    private static string RoundTrip(string vg) => VgWriter.Write(PlcOpenReader.ReadBody(ToLadder(vg)));

    private static int Count(XElement ld, string element) => ld.Elements(XName.Get(element, Ns)).Count();

    /// <summary>The canonical VG must stabilise: a body re-read and re-written produces an identical VG,
    /// so an unedited pull→push never reports phantom drift.</summary>
    private static void AssertFixedPoint(string vg)
    {
        var once = RoundTrip(vg);
        var twice = RoundTrip(once);
        Assert.Equal(once, twice);
    }

    [Fact]
    public void Single_contact_drives_a_coil()
    {
        const string vg = "NETWORK 0 LD\n  VAR_TEMP\n    i1 : BOOL;\n  END_VAR\n  i1 := a;\n  q := i1;\nEND_NETWORK\n";
        var ld = ToLadder(vg);
        Assert.Equal("LD", ld.Name.LocalName);
        Assert.Equal(1, Count(ld, "contact"));
        Assert.Equal(1, Count(ld, "coil"));
        Assert.Equal(1, Count(ld, "leftPowerRail"));
        Assert.Equal(1, Count(ld, "rightPowerRail"));
        Assert.Contains("q :=", RoundTrip(vg));
        AssertFixedPoint(vg);
    }

    [Theory]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    public void Series_of_n_contacts_is_an_and_chain(int n)
    {
        var temps = string.Concat(Enumerable.Range(1, n).Select(k => $"    i{k} : BOOL;\n"));
        var asgs = string.Concat(Enumerable.Range(1, n).Select(k => $"  i{k} := a{k};\n"));
        var andExpr = string.Join(" AND ", Enumerable.Range(1, n).Select(k => $"i{k}"));
        var vg = $"NETWORK 0 LD\n  VAR_TEMP\n{temps}    g : BOOL;\n  END_VAR\n{asgs}  g := ({andExpr});\n  q := g;\nEND_NETWORK\n";
        var ld = ToLadder(vg);
        Assert.Equal(n, Count(ld, "contact"));   // n contacts in series
        Assert.Equal(1, Count(ld, "coil"));
        AssertFixedPoint(vg);
    }

    [Fact]
    public void Normally_closed_contact_is_a_negated_contact()
    {
        const string vg = "NETWORK 0 LD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n    g : BOOL;\n  END_VAR\n" +
            "  i1 := NOT a;\n  i2 := b;\n  g := (i1 AND i2);\n  q := g;\nEND_NETWORK\n";
        var ld = ToLadder(vg);
        Assert.Contains("negated=\"true\"", ld.ToString());
        Assert.Contains("NOT", RoundTrip(vg));
        AssertFixedPoint(vg);
    }

    [Theory]
    [InlineData("SET", "set")]
    [InlineData("RESET", "reset")]
    public void Storage_coil_round_trips(string vgWord, string xmlAttr)
    {
        var vg = $"NETWORK 0 LD\n  VAR_TEMP\n    i1 : BOOL;\n  END_VAR\n  i1 := a;\n  q := i1 {vgWord};\nEND_NETWORK\n";
        var ld = ToLadder(vg);
        var coil = ld.Elements(XName.Get("coil", Ns)).Single();
        Assert.Equal(xmlAttr, (string?)coil.Attribute("storage"));
        Assert.Contains(vgWord, RoundTrip(vg));
        AssertFixedPoint(vg);
    }

    [Fact]
    public void Multiple_coils_in_one_network_are_separate_rungs()
    {
        const string vg = "NETWORK 0 LD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n  END_VAR\n" +
            "  i1 := a;\n  i2 := b;\n  q := i1;\n  r := i2;\nEND_NETWORK\n";
        var ld = ToLadder(vg);
        Assert.Equal(2, Count(ld, "coil"));      // two outputs → two rungs
        Assert.Equal(2, Count(ld, "contact"));
        var back = RoundTrip(vg);
        Assert.Contains("q :=", back);
        Assert.Contains("r :=", back);
        AssertFixedPoint(vg);
    }

    [Fact]
    public void Multi_network_emits_every_network()
    {
        const string vg = "NETWORK 0 LD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n    g : BOOL;\n  END_VAR\n" +
            "  i1 := a;\n  i2 := b;\n  g := (i1 AND i2);\n  x := g;\nEND_NETWORK\n" +
            "NETWORK 1 LD\n  VAR_TEMP\n    i1 : BOOL;\n  END_VAR\n  i1 := c;\n  y := i1;\nEND_NETWORK\n";
        var ld = ToLadder(vg);
        // ONE shared rail brackets the body; each network is a networktitle marker (TwinCAT's multi-network form)
        Assert.Equal(1, Count(ld, "leftPowerRail"));
        Assert.Equal(1, Count(ld, "rightPowerRail"));
        Assert.Equal(2, Count(ld, "vendorElement"));   // one networktitle marker per network
        Assert.Equal(2, Count(ld, "coil"));
        var back = RoundTrip(vg);
        Assert.Contains("NETWORK 0 LD", back);
        Assert.Contains("NETWORK 1 LD", back);
        AssertFixedPoint(vg);
    }
}
