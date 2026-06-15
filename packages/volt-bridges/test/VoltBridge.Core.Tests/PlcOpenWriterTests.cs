using System.Xml.Linq;
using VoltBridge.Core.Fbd;
using VoltBridge.Core.Fbd.Vg;
using Xunit;

namespace VoltBridge.Core.Tests;

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
        Assert.Contains("NOT a", vg1);                                   // negation surfaces in VG

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
        Assert.StartsWith("%LANG LD", VgWriter.Write(g));
        Assert.Equal("LD", PlcOpenWriter.WriteBody(g).Name.LocalName);   // wrapper mirrors the language
    }

    /// <summary>Full pipeline VG → graph → PLCopenXML → graph → VG (the write path the bridge runs),
    /// with FB types supplied by the declaration resolver.</summary>
    [Fact]
    public void Vg_through_xml_back_to_vg_with_type_resolver()
    {
        const string vg = "%LANG FBD\nNETWORK\n  t1(IN := start, PT := pt);\n  running := t1.Q;\n";
        var graph = VgParser.Parse(vg);
        var xml = PlcOpenWriter.WriteBody(graph, inst => inst == "t1" ? "TON" : null);
        Assert.Contains("typeName=\"TON\"", xml.ToString());
        var back = VgWriter.Write(PlcOpenReader.ReadBody(xml));
        Assert.Equal(vg, back);
    }
}
