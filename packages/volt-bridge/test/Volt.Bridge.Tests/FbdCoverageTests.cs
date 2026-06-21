using System.Linq;
using System.Xml.Linq;
using Volt.Bridge.Core.Graphical;
using Volt.Bridge.Core.Graphical.Vg;
using Xunit;

namespace Volt.Bridge.Tests;

/// <summary>
/// Coverage + SAFETY matrix over the TC6 graphical construct set (the spec the VG round-trip is
/// chasing toward 100%). The invariant that must hold at every coverage level:
///
///     a graphical body either round-trips LOSSLESSLY through VG, or its push is REFUSED —
///     never silently dropped.
///
/// As each construct gets modeled it moves from the "refused" theory to the "modeled" theory; the
/// invariant stays green throughout, so coverage rises with a zero-risk window. The one sanctioned
/// exception is vendorElement (cosmetic editor metadata, intentionally dropped) — called out below.
///
/// Fixtures are minimal PLCopen written from the TC6 schema (tc6_xml_v201.xsd) — no IDE authoring
/// needed; real captured bodies get layered on top of this matrix as they're harvested.
/// </summary>
public class FbdCoverageTests
{
    private const string Ns = "http://www.plcopen.org/xml/tc6_0200";
    private static string Doc(string lang, string inner) =>
        $"<pou xmlns=\"{Ns}\" name=\"P\"><body><{lang}>{inner}</{lang}></body></pou>";

    private static string RoundTripBody(string doc)
    {
        var g = PlcOpenReader.ReadBody(PlcOpenDocument.FindFbdLdBody(doc)!);   // reader is TOTAL (never throws)
        var back = PlcOpenWriter.WriteBody(VgParser.Parse(VgWriter.Write(g)));  // read → VG → parse → write
        return PlcOpenDocument.SpliceFbdLdBody(doc, back);                      // push (may refuse)
    }

    // ── Modeled: round-trips losslessly (every original element kind survives the push) ──
    [Theory]
    [InlineData("FBD", "in/out wire",
        "<inVariable localId='1'><expression>a</expression></inVariable>" +
        "<outVariable localId='2'><expression>o</expression><connectionPointIn><connection refLocalId='1'/></connectionPointIn></outVariable>")]
    [InlineData("FBD", "operator block",
        "<inVariable localId='1'><expression>a</expression></inVariable>" +
        "<inVariable localId='2'><expression>b</expression></inVariable>" +
        "<block localId='3' typeName='AND'><inputVariables>" +
        "<variable formalParameter='IN1'><connectionPointIn><connection refLocalId='1'/></connectionPointIn></variable>" +
        "<variable formalParameter='IN2'><connectionPointIn><connection refLocalId='2'/></connectionPointIn></variable>" +
        "</inputVariables><outputVariables><variable formalParameter='OUT'><connectionPointOut/></variable></outputVariables></block>" +
        "<outVariable localId='4'><expression>o</expression><connectionPointIn><connection refLocalId='3'/></connectionPointIn></outVariable>")]
    [InlineData("FBD", "negated input",
        "<inVariable localId='1'><expression>a</expression></inVariable>" +
        "<inVariable localId='2'><expression>b</expression></inVariable>" +
        "<block localId='3' typeName='AND'><inputVariables>" +
        "<variable formalParameter='IN1' negated='true'><connectionPointIn><connection refLocalId='1'/></connectionPointIn></variable>" +
        "<variable formalParameter='IN2'><connectionPointIn><connection refLocalId='2'/></connectionPointIn></variable>" +
        "</inputVariables><outputVariables><variable formalParameter='OUT'><connectionPointOut/></variable></outputVariables></block>" +
        "<outVariable localId='4'><expression>o</expression><connectionPointIn><connection refLocalId='3'/></connectionPointIn></outVariable>")]
    [InlineData("FBD", "label + jump", "<label localId='10000000000' label='L'/><jump localId='20000000001' label='L'/>")]
    [InlineData("FBD", "return", "<return localId='1'/>")]
    public void Modeled_construct_round_trips(string lang, string _desc, string inner)
    {
        var doc = Doc(lang, inner);
        var outXml = RoundTripBody(doc);   // must NOT throw
        // Every element kind present in the original survives the round-trip (coarse no-loss check). FBD-only:
        // an LD body CANONICALISES to real contact/coil on write (inVariable→contact), so element kinds change
        // by design — LD round-trip is covered by Ld_rung_round_trips below (it checks logic, not identity).
        foreach (var name in PlcOpenDocument.FindFbdLdBody(doc)!.Elements().Select(e => e.Name.LocalName).Distinct())
            Assert.Contains("<" + name, outXml);
    }

    // ── Not modeled yet: push must be REFUSED, never silently dropped ──
    [Theory]
    // common-objects group
    [InlineData("FBD", "connector",    "<connector localId='1' name='C'><connectionPointIn><connection refLocalId='9'/></connectionPointIn></connector>")]
    [InlineData("FBD", "continuation", "<continuation localId='1' name='C'><connectionPointOut/></continuation>")]
    [InlineData("FBD", "error",        "<error localId='1'/>")]
    [InlineData("FBD", "actionBlock",  "<actionBlock localId='1'/>")]
    // fbd-objects group
    [InlineData("FBD", "inOutVariable (standalone)", "<inOutVariable localId='1'><expression>v</expression></inOutVariable>")]
    [InlineData("FBD", "block in-out pin",
        "<block localId='1' typeName='F'><inOutVariables>" +
        "<variable formalParameter='IO'><connectionPointIn/></variable></inOutVariables></block>")]
    [InlineData("FBD", "block output modifier",
        "<block localId='1' typeName='F'><outputVariables>" +
        "<variable formalParameter='Q' negated='true'><connectionPointOut/></variable></outputVariables></block>")]
    [InlineData("FBD", "multi-output stateless function",
        "<block localId='1' typeName='F'><outputVariables>" +
        "<variable formalParameter='O1'><connectionPointOut/></variable>" +
        "<variable formalParameter='O2'><connectionPointOut/></variable></outputVariables></block>")]
    [InlineData("FBD", "pin from multiple sources",
        "<inVariable localId='1'><expression>a</expression></inVariable>" +
        "<inVariable localId='2'><expression>b</expression></inVariable>" +
        "<outVariable localId='3'><expression>o</expression><connectionPointIn>" +
        "<connection refLocalId='1'/><connection refLocalId='2'/></connectionPointIn></outVariable>")]
    // (LD contact/coil/power-rails are NOW modeled — see Ld_rung_round_trips. LD structure the boolean
    //  generator can't reproduce yet is covered by Ld_unsupported_write_is_refused below.)
    public void Unmodeled_construct_is_refused_not_silently_dropped(string lang, string _desc, string inner)
    {
        var doc = Doc(lang, inner);
        _ = PlcOpenReader.ReadBody(PlcOpenDocument.FindFbdLdBody(doc)!);   // reader stays TOTAL (no throw)
        Assert.Throws<System.InvalidOperationException>(
            () => PlcOpenDocument.SpliceFbdLdBody(doc, new XElement("FBD")));
    }

    /// <summary>A comment box round-trips its TEXT through the full edit path (XML → VG // line →
    /// XML), even though the box position is dropped. Text extraction is robust to the wrapper.</summary>
    [Fact]
    public void Comment_text_round_trips()
    {
        var doc = Doc("FBD",
            "<comment localId='1'><content>hello world</content></comment>" +
            "<inVariable localId='2'><expression>a</expression></inVariable>" +
            "<outVariable localId='3'><expression>o</expression><connectionPointIn><connection refLocalId='2'/></connectionPointIn></outVariable>");
        // through VG and back
        var g = PlcOpenReader.ReadBody(PlcOpenDocument.FindFbdLdBody(doc)!);
        Assert.Contains("// hello world", VgWriter.Write(g));     // surfaced as a VG comment
        var outXml = RoundTripBody(doc);                          // NOT refused (returns the full pou doc)
        Assert.Contains("hello world", outXml);                  // text preserved on push
        // and re-reading the written body recovers the comment text
        var g2 = PlcOpenReader.ReadBody(PlcOpenDocument.FindFbdLdBody(outXml)!);
        Assert.Contains("hello world", g2.Networks.SelectMany(n => new[] { n.Comment }).FirstOrDefault(c => c != null) ?? "");
    }

    /// <summary>An LD rung ROUND-TRIPS: it READS by lowering to the same boolean VG as the FBD twin
    /// (series contacts = AND, coil = assignment, negated contact = NOT), and WRITES back to real
    /// contact/coil via the inverse generator — losslessly in logic. No longer read-only.</summary>
    [Theory]
    [InlineData(
        "<leftPowerRail localId='1'><connectionPointOut/></leftPowerRail>" +
        "<contact localId='2'><connectionPointIn><connection refLocalId='1'/></connectionPointIn><connectionPointOut/><variable>a</variable></contact>" +
        "<contact localId='3'><connectionPointIn><connection refLocalId='2'/></connectionPointIn><connectionPointOut/><variable>b</variable></contact>" +
        "<coil localId='4'><connectionPointIn><connection refLocalId='3'/></connectionPointIn><connectionPointOut/><variable>out</variable></coil>",
        "(a AND b)")]  // two contacts in series → AND (contact vars inline as operands)
    [InlineData(
        "<leftPowerRail localId='1'><connectionPointOut/></leftPowerRail>" +
        "<contact localId='2' negated='true'><connectionPointIn><connection refLocalId='1'/></connectionPointIn><connectionPointOut/><variable>a</variable></contact>" +
        "<coil localId='3'><connectionPointIn><connection refLocalId='2'/></connectionPointIn><connectionPointOut/><variable>out</variable></coil>",
        "NOT a")]      // normally-closed contact → NOT (contact var inlines as the operand)
    [InlineData(
        "<leftPowerRail localId='1'><connectionPointOut/></leftPowerRail>" +
        "<contact localId='2'><connectionPointIn><connection refLocalId='1'/></connectionPointIn><connectionPointOut/><variable>a</variable></contact>" +
        "<contact localId='3'><connectionPointIn><connection refLocalId='1'/></connectionPointIn><connectionPointOut/><variable>b</variable></contact>" +
        "<coil localId='4'><connectionPointIn><connection refLocalId='2'/><connection refLocalId='3'/></connectionPointIn><connectionPointOut/><variable>out</variable></coil>",
        "OR")]          // two contacts in PARALLEL (both off the rail, both into the coil) → OR
    public void Ld_rung_round_trips(string inner, string expect)
    {
        var doc = Doc("LD", inner);
        var vg = VgWriter.Write(PlcOpenReader.ReadBody(PlcOpenDocument.FindFbdLdBody(doc)!));
        Assert.Contains(expect, vg);
        Assert.Contains("out :=", vg);   // coil → assignment
        // and it WRITES back to a real <LD> ladder (no longer read-only / refused)
        var outXml = RoundTripBody(doc);          // must NOT throw
        Assert.Contains("<LD>", outXml);
        Assert.Contains("<contact", outXml);      // regenerated as true ladder, not FBD blocks
        Assert.Contains("<coil", outXml);
    }

    /// <summary>An FB/operator block on a ladder rung now ROUND-TRIPS: the reader lowers it to the same Block
    /// node an FBD network uses, and the writer emits that network FBD-style (variable boxes + the block)
    /// inside the &lt;LD&gt; root — a rail-less LD network reads back via the reader's FBD path to the same
    /// graph. (Was previously refused as "edit in the IDE".)</summary>
    [Fact]
    public void Ld_block_on_a_rung_round_trips()
    {
        var inner = "<leftPowerRail localId='1'><connectionPointOut/></leftPowerRail>" +
            "<inVariable localId='2'><connectionPointOut/><expression>a</expression></inVariable>" +
            "<inVariable localId='3'><connectionPointOut/><expression>b</expression></inVariable>" +
            "<block localId='4' typeName='GT'><inputVariables>" +
            "<variable formalParameter='IN1'><connectionPointIn><connection refLocalId='2'/></connectionPointIn></variable>" +
            "<variable formalParameter='IN2'><connectionPointIn><connection refLocalId='3'/></connectionPointIn></variable>" +
            "</inputVariables><outputVariables><variable formalParameter='OUT'><connectionPointOut/></variable></outputVariables></block>" +
            "<coil localId='5'><connectionPointIn><connection refLocalId='4'/></connectionPointIn><connectionPointOut/><variable>out</variable></coil>";
        var doc = Doc("LD", inner);
        var vg = VgWriter.Write(PlcOpenReader.ReadBody(PlcOpenDocument.FindFbdLdBody(doc)!));
        Assert.Contains(">", vg);                    // the GT comparison renders infix in the VG
        var outXml = RoundTripBody(doc);             // writes back WITHOUT throwing (was a NotSupportedException)
        Assert.Contains("<block", outXml);           // emitted as a real block, not mangled
        Assert.Contains("GT", outXml);
    }

    /// <summary>The ONE sanctioned silent drop: vendorElement is cosmetic editor metadata — the guard
    /// allows it (it's representable) but VG doesn't carry it, so a push drops it. Documented here so
    /// the exception to "never silently dropped" is explicit and intentional.</summary>
    [Fact]
    public void Vendor_element_is_the_one_sanctioned_silent_drop()
    {
        var doc = Doc("FBD",
            "<vendorElement localId='1'/>" +
            "<inVariable localId='2'><expression>a</expression></inVariable>" +
            "<outVariable localId='3'><expression>o</expression><connectionPointIn><connection refLocalId='2'/></connectionPointIn></outVariable>");
        var outXml = RoundTripBody(doc);                 // NOT refused
        Assert.DoesNotContain("vendorElement", outXml);  // dropped, by design
        Assert.Contains("outVariable", outXml);          // real logic preserved
    }
}
