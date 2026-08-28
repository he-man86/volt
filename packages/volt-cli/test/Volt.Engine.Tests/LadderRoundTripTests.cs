using System.Linq;
using System.Xml.Linq;
using Xunit;
using Volt.Engine.Format.Network;
using Volt.Engine.PlcOpen;

namespace Volt.Cli.Tests;

/// <summary>
/// The LD (ladder) featureset, exercised through the full writer+reader pipeline: a network text ladder body is
/// generated to PLCopen <c>&lt;LD&gt;</c> (real contact/coil/power-rails) by <see cref="GraphWriter"/>,
/// read back by <see cref="GraphReader"/>, and re-rendered to network text. Each case asserts the boolean logic
/// survives at the element level AND that a second pass is a FIXED POINT (the canonical network text stabilises, so
/// re-editing never drifts). Companion to <see cref="FbdCoverageTests"/> (the refusal matrix) and the live
/// e2e / CLI ladder suites — coverage is duplicated across the three test layers on purpose.
/// </summary>
public class LadderRoundTripTests
{
    private const string Ns = "http://www.plcopen.org/xml/tc6_0200";

    /// <summary>network text → generated PLCopen <c>&lt;LD&gt;</c> element (for element-level assertions).</summary>
    private static XElement ToLadder(string net) => GraphWriter.WriteBody(NetworkTextReader.Parse(net));

    /// <summary>network text → <c>&lt;LD&gt;</c> → network text: one full write+read pass through the ladder pipeline.</summary>
    private static string RoundTrip(string net) => GraphRoundTrip.ToNetworkText(net);

    private static int Count(XElement ld, string element) => ld.Elements(XName.Get(element, Ns)).Count();

    /// <summary>The canonical network text must stabilise: a body re-read and re-written produces an identical network text,
    /// so an unedited pull→push never reports phantom drift.</summary>
    private static void AssertFixedPoint(string net)
    {
        var once = RoundTrip(net);
        var twice = RoundTrip(once);
        Assert.Equal(once, twice);
    }

    [Fact]
    public void Single_contact_drives_a_coil()
    {
        const string net = "NETWORK 0 LD\n  LET i1 := a;\n  q := i1;\nEND_NETWORK\n";
        var ld = ToLadder(net);
        Assert.Equal("LD", ld.Name.LocalName);
        Assert.Equal(1, Count(ld, "contact"));
        Assert.Equal(1, Count(ld, "coil"));
        Assert.Equal(1, Count(ld, "leftPowerRail"));
        Assert.Equal(1, Count(ld, "rightPowerRail"));
        Assert.Contains("q :=", RoundTrip(net));
        AssertFixedPoint(net);
    }

    [Theory]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    public void Series_of_n_contacts_is_an_and_chain(int n)
    {
        var asgs = string.Concat(Enumerable.Range(1, n).Select(k => $"  LET i{k} := a{k};\n"));
        var andExpr = string.Join(" AND ", Enumerable.Range(1, n).Select(k => $"i{k}"));
        var net = $"NETWORK 0 LD\n{asgs}  LET g := ({andExpr});\n  q := g;\nEND_NETWORK\n";
        var ld = ToLadder(net);
        Assert.Equal(n, Count(ld, "contact"));   // n contacts in series
        Assert.Equal(1, Count(ld, "coil"));
        AssertFixedPoint(net);
    }

    [Fact]
    public void Normally_closed_contact_is_a_negated_contact()
    {
        const string net = "NETWORK 0 LD\n" +
            "  LET i1 := NOT a;\n  LET i2 := b;\n  LET g := (i1 AND i2);\n  q := g;\nEND_NETWORK\n";
        var ld = ToLadder(net);
        Assert.Contains("negated=\"true\"", ld.ToString());
        Assert.Contains("NOT", RoundTrip(net));
        AssertFixedPoint(net);
    }

    [Theory]
    [InlineData("SET", "set")]
    [InlineData("RESET", "reset")]
    public void Storage_coil_round_trips(string netWord, string xmlAttr)
    {
        var net = $"NETWORK 0 LD\n  LET i1 := a;\n  q := i1 {netWord};\nEND_NETWORK\n";
        var ld = ToLadder(net);
        var coil = ld.Elements(XName.Get("coil", Ns)).Single();
        Assert.Equal(xmlAttr, (string?)coil.Attribute("storage"));
        Assert.Contains(netWord, RoundTrip(net));
        AssertFixedPoint(net);
    }

    [Fact]
    public void Multiple_coils_in_one_network_are_separate_rungs()
    {
        const string net = "NETWORK 0 LD\n" +
            "  LET i1 := a;\n  LET i2 := b;\n  q := i1;\n  r := i2;\nEND_NETWORK\n";
        var ld = ToLadder(net);
        Assert.Equal(2, Count(ld, "coil"));      // two outputs → two rungs
        Assert.Equal(2, Count(ld, "contact"));
        var back = RoundTrip(net);
        Assert.Contains("q :=", back);
        Assert.Contains("r :=", back);
        AssertFixedPoint(net);
    }

    [Fact]
    public void Multi_network_emits_every_network()
    {
        const string net = "NETWORK 0 LD\n" +
            "  LET i1 := a;\n  LET i2 := b;\n  LET g := (i1 AND i2);\n  x := g;\nEND_NETWORK\n" +
            "NETWORK 1 LD\n  LET i1 := c;\n  y := i1;\nEND_NETWORK\n";
        var ld = ToLadder(net);
        // ONE shared rail brackets the body; each network is a networktitle marker (TwinCAT's multi-network form)
        Assert.Equal(1, Count(ld, "leftPowerRail"));
        Assert.Equal(1, Count(ld, "rightPowerRail"));
        Assert.Equal(2, Count(ld, "vendorElement"));   // one networktitle marker per network
        Assert.Equal(2, Count(ld, "coil"));
        var back = RoundTrip(net);
        Assert.Contains("NETWORK 0 LD", back);
        Assert.Contains("NETWORK 1 LD", back);
        AssertFixedPoint(net);
    }
}
