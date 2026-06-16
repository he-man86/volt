using System.Linq;
using System.Xml.Linq;
using Volt.Bridge.Core.Graphical;
using Volt.Bridge.Core.Graphical.Vg;
using Xunit;

namespace Volt.Bridge.Tests;

public class PlcOpenWriterTests
{
    private const string Ns = "http://www.plcopen.org/xml/tc6_0200";

    /// <summary>XML → graph → XML → graph → VG must reproduce the same VG: the writer faithfully
    /// reproduces the graph the reader parsed.</summary>
    private static void AssertXmlRoundTrip(string fbdInner)
    {
        var g1 = PlcOpenReader.ReadBody(XElement.Parse($"<FBD xmlns=\"{Ns}\">{fbdInner}</FBD>"));
        var vg1 = VgWriter.Write(g1);

        var xml2 = PlcOpenWriter.WriteBody(g1);           // graph → PLCopenXML
        var g2 = PlcOpenReader.ReadBody(xml2);            // PLCopenXML → graph
        var vg2 = VgWriter.Write(g2);

        Assert.Equal(vg1, vg2);
        Assert.Equal(Ns, xml2.Name.Namespace);           // emitted in the PLCopen namespace
    }

    [Fact]
    public void Fb_call_round_trips_through_xml()
        => AssertXmlRoundTrip("""
            <inVariable localId="1"><expression>FALSE</expression></inVariable>
            <block localId="2" typeName="L_EATP_FAST_Config" instanceName="Config">
              <inputVariables>
                <variable formalParameter="x"><connectionPointIn><connection refLocalId="1"/></connectionPointIn></variable>
              </inputVariables>
              <outputVariables><variable formalParameter="o"><connectionPointOut/></variable></outputVariables>
            </block>
            """);

    [Fact]
    public void Nested_operators_round_trip_through_xml()
        => AssertXmlRoundTrip("""
            <inVariable localId="1"><expression>A</expression></inVariable>
            <inVariable localId="2"><expression>B</expression></inVariable>
            <inVariable localId="3"><expression>C</expression></inVariable>
            <block localId="4" typeName="AND">
              <inputVariables>
                <variable formalParameter="IN1"><connectionPointIn><connection refLocalId="1"/></connectionPointIn></variable>
                <variable formalParameter="IN2"><connectionPointIn><connection refLocalId="2"/></connectionPointIn></variable>
              </inputVariables>
              <outputVariables><variable formalParameter="OUT"><connectionPointOut/></variable></outputVariables>
            </block>
            <block localId="5" typeName="OR">
              <inputVariables>
                <variable formalParameter="IN1"><connectionPointIn><connection refLocalId="4"/></connectionPointIn></variable>
                <variable formalParameter="IN2"><connectionPointIn><connection refLocalId="3"/></connectionPointIn></variable>
              </inputVariables>
              <outputVariables><variable formalParameter="OUT"><connectionPointOut/></variable></outputVariables>
            </block>
            <outVariable localId="6"><expression>result</expression><connectionPointIn><connection refLocalId="5"/></connectionPointIn></outVariable>
            """);

    /// <summary>Regression: a negated block input is read into Mods, must surface in VG as NOT, and
    /// must be RE-EMITTED as negated="true" on write (it was silently dropped before).</summary>
    [Fact]
    public void Negated_input_survives_read_then_write()
    {
        const string fbd = """
            <inVariable localId="1"><expression>a</expression></inVariable>
            <inVariable localId="2"><expression>b</expression></inVariable>
            <block localId="3" typeName="AND">
              <inputVariables>
                <variable formalParameter="IN1" negated="true"><connectionPointIn><connection refLocalId="1"/></connectionPointIn></variable>
                <variable formalParameter="IN2"><connectionPointIn><connection refLocalId="2"/></connectionPointIn></variable>
              </inputVariables>
              <outputVariables><variable formalParameter="OUT"><connectionPointOut/></variable></outputVariables>
            </block>
            <outVariable localId="4"><expression>out</expression><connectionPointIn><connection refLocalId="3"/></connectionPointIn></outVariable>
            """;
        var g1 = PlcOpenReader.ReadBody(XElement.Parse($"<FBD xmlns=\"{Ns}\">{fbd}</FBD>"));
        var vg1 = VgWriter.Write(g1);
        Assert.Contains("NOT i1", vg1);                                  // negation surfaces in VG (on the named leaf ref)

        var xml2 = PlcOpenWriter.WriteBody(g1);
        Assert.Contains("negated=\"true\"", xml2.ToString());           // re-emitted, not dropped
        Assert.Equal(vg1, VgWriter.Write(PlcOpenReader.ReadBody(xml2))); // fixed point
    }

    /// <summary>FBD and LD share the PLCopen element set — only the wrapper/view differs. An LD body
    /// reads its language from the wrapper, surfaces as %LANG LD, and re-emits an &lt;LD&gt; wrapper.</summary>
    [Fact]
    public void Ld_body_reads_and_writes_as_ld()
    {
        const string inner = """
            <inVariable localId="1"><expression>a</expression></inVariable>
            <inVariable localId="2"><expression>b</expression></inVariable>
            <block localId="3" typeName="AND">
              <inputVariables>
                <variable formalParameter="IN1"><connectionPointIn><connection refLocalId="1"/></connectionPointIn></variable>
                <variable formalParameter="IN2"><connectionPointIn><connection refLocalId="2"/></connectionPointIn></variable>
              </inputVariables>
              <outputVariables><variable formalParameter="OUT"><connectionPointOut/></variable></outputVariables>
            </block>
            <outVariable localId="4"><expression>out</expression><connectionPointIn><connection refLocalId="3"/></connectionPointIn></outVariable>
            """;
        var g = PlcOpenReader.ReadBody(XElement.Parse($"<LD xmlns=\"{Ns}\">{inner}</LD>"));
        Assert.Equal("LD", g.Language);
        Assert.StartsWith("NETWORK 0 LD", VgWriter.Write(g));            // language rides on the NETWORK marker
        Assert.Equal("LD", PlcOpenWriter.WriteBody(g).Name.LocalName);   // wrapper mirrors the language
    }

    /// <summary>Regression (caught by a live CODESYS push): a network comment must be written as
    /// xhtml content with an in-network localId — bare text or a stray localId makes CODESYS reject
    /// the whole import.</summary>
    [Fact]
    public void Comment_writes_codesys_importable_form()
    {
        var g = new GraphBody("FBD", new[]
        {
            new GraphNetwork(0, null, "hi", false, new GraphNode[] { new InVar(1, null, "a", Mods.None) }),
        });
        var comment = PlcOpenWriter.WriteBody(g).Elements().First(e => e.Name.LocalName == "comment");
        Assert.Equal("hi", comment.Value.Trim());                                    // text present…
        Assert.Equal("xhtml", comment.Element(XName.Get("content", Ns))!.Elements().First().Name.LocalName);  // …wrapped in xhtml
        Assert.True((long)comment.Attribute("localId")! / 10_000_000_000L == 0);     // in network 0 (with the content)
    }

    /// <summary>An operator/function result is referenced by its bare name (valid ST: `out := g1`),
    /// NOT `g1.Out1` (member access on a BOOL isn't ST). FB-instance outputs keep their pin (`t1.Q`).
    /// On write the operator's output pin is re-derived so the PLCopen connection stays named.</summary>
    [Fact]
    public void Operator_result_is_referenced_without_a_pin_suffix()
    {
        const string inner = """
            <inVariable localId="1"><expression>a</expression></inVariable>
            <inVariable localId="2"><expression>b</expression></inVariable>
            <block localId="3" typeName="OR">
              <inputVariables>
                <variable formalParameter="IN1"><connectionPointIn><connection refLocalId="1"/></connectionPointIn></variable>
                <variable formalParameter="IN2"><connectionPointIn><connection refLocalId="2"/></connectionPointIn></variable>
              </inputVariables>
              <outputVariables><variable formalParameter="Out1"><connectionPointOut/></variable></outputVariables>
            </block>
            <outVariable localId="4"><expression>out</expression><connectionPointIn><connection refLocalId="3" formalParameter="Out1"/></connectionPointIn></outVariable>
            """;
        var g = PlcOpenReader.ReadBody(XElement.Parse($"<FBD xmlns=\"{Ns}\">{inner}</FBD>"));
        var vg = VgWriter.Write(g);
        Assert.Contains("out := g1;", vg);   // operator result referenced directly
        Assert.DoesNotContain(".Out1", vg);  // no non-ST pin suffix
        Assert.Equal(vg, VgWriter.Write(PlcOpenReader.ReadBody(PlcOpenWriter.WriteBody(VgParser.Parse(vg)))));  // fixed point
    }

    /// <summary>Regression: a MULTI-network body must round-trip through XML without colliding
    /// localIds. Each VgParser network used to restart numbering at 1, so a 2nd network duplicated
    /// ids → networks collapsed / the IDE import broke on push. localIds now encode the network.</summary>
    [Fact]
    public void Multi_network_vg_round_trips_through_xml()
    {
        const string vg =
            "NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n    g1 : BOOL;\n  END_VAR\n" +
            "  i1 := a;\n  i2 := b;\n  g1 := (i1 AND i2);\n  x := g1;\nEND_NETWORK\n" +
            "NETWORK 1 FBD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n    g1 : BOOL;\n  END_VAR\n" +
            "  i1 := c;\n  i2 := d;\n  g1 := (i1 OR i2);\n  y := g1;\nEND_NETWORK\n";
        var back = VgWriter.Write(PlcOpenReader.ReadBody(PlcOpenWriter.WriteBody(VgParser.Parse(vg))));
        Assert.Equal(vg, back);   // a true fixed point — no hash drift, no collapse
    }

    /// <summary>Regression: VG carries an FB output only on the CONSUMER (`done := t1.Q`), never on the
    /// block's call. The writer must still declare `Q` as an output pin on the block — otherwise the
    /// connection names a pin the block doesn't have and the IDE drops it on import (the `out := ;` bug).</summary>
    [Fact]
    public void Fb_output_referenced_only_on_consumer_is_declared_on_the_block()
    {
        const string vg =
            "NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n  END_VAR\n  i1 := clk;\n  t1(CLK := i1);\n  done := t1.Q;\nEND_NETWORK\n";
        var xml = PlcOpenWriter.WriteBody(VgParser.Parse(vg), inst => inst == "t1" ? "R_TRIG" : null);
        var blk = xml.Descendants(XName.Get("block", Ns)).First(b => (string?)b.Attribute("instanceName") == "t1");
        var outPins = blk.Element(XName.Get("outputVariables", Ns))!.Elements()
            .Select(v => (string?)v.Attribute("formalParameter")).ToList();
        Assert.Contains("Q", outPins);                                          // the block declares Q
        Assert.Equal(vg, VgWriter.Write(PlcOpenReader.ReadBody(xml)));          // and it round-trips
    }

    /// <summary>Full pipeline VG → graph → PLCopenXML → graph → VG (the write path the bridge runs),
    /// with FB types supplied by the declaration resolver.</summary>
    [Fact]
    public void Vg_through_xml_back_to_vg_with_type_resolver()
    {
        const string vg =
            "NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n  END_VAR\n" +
            "  i1 := start;\n  i2 := pt;\n  t1(IN := i1, PT := i2);\n  running := t1.Q;\nEND_NETWORK\n";
        var graph = VgParser.Parse(vg);
        var xml = PlcOpenWriter.WriteBody(graph, inst => inst == "t1" ? "TON" : null);
        Assert.Contains("typeName=\"TON\"", xml.ToString());
        var back = VgWriter.Write(PlcOpenReader.ReadBody(xml));
        Assert.Equal(vg, back);
    }
}
