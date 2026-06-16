using System.Xml.Linq;
using Volt.Bridge.Core.Graphical;
using Xunit;

namespace Volt.Bridge.Tests;

public class PlcOpenDocumentTests
{
    private const string Pou = """
    <pou xmlns="http://www.plcopen.org/xml/tc6_0200" name="P">
      <interface/>
      <body><FBD><inVariable localId="1"><expression>a</expression></inVariable></FBD></body>
    </pou>
    """;

    [Fact]
    public void Finds_the_FBD_body()
    {
        var body = PlcOpenDocument.FindFbdLdBody(Pou);
        Assert.NotNull(body);
        Assert.Equal("FBD", body!.Name.LocalName);
    }

    [Fact]
    public void Splices_a_new_body_in_place()
    {
        XNamespace ns = "http://www.plcopen.org/xml/tc6_0200";
        var newBody = new XElement(ns + "FBD", new XElement(ns + "outVariable",
            new XAttribute("localId", 9), new XElement(ns + "expression", "z")));

        var outXml = PlcOpenDocument.SpliceFbdLdBody(Pou, newBody);

        Assert.Contains("outVariable", outXml);
        Assert.Contains("z", outXml);
        Assert.DoesNotContain("inVariable", outXml);   // old body gone
        Assert.Contains("<interface", outXml);          // rest of the POU preserved
    }

    [Fact]
    public void Splice_throws_when_no_graphical_body()
    {
        const string st = """<pou xmlns="http://www.plcopen.org/xml/tc6_0200" name="P"><body><ST>x:=1;</ST></body></pou>""";
        Assert.Throws<System.InvalidOperationException>(
            () => PlcOpenDocument.SpliceFbdLdBody(st, new XElement("FBD")));
    }

    [Fact]
    public void Splice_refuses_to_drop_unrepresentable_elements()
    {
        // A body with an LD <contact> the VG editor can't reproduce — must refuse, not silently drop it.
        const string withContact = """
        <pou xmlns="http://www.plcopen.org/xml/tc6_0200" name="P">
          <body><LD>
            <inVariable localId="1"><expression>a</expression></inVariable>
            <contact localId="2"><variable>x</variable></contact>
          </LD></body>
        </pou>
        """;
        var ex = Assert.Throws<System.InvalidOperationException>(
            () => PlcOpenDocument.SpliceFbdLdBody(withContact, new XElement("FBD")));
        Assert.Contains("contact", ex.Message);
    }

    [Fact]
    public void Splice_preserves_the_original_wrapper_element()
    {
        // TwinCAT exports an LD body with an <FBD> wrapper; writing it back must NOT flip the wrapper
        // to <LD> (that would change the editor view / be rejected on import). Only contents swap.
        XNamespace ns = "http://www.plcopen.org/xml/tc6_0200";
        var newLd = new XElement(ns + "LD",
            new XElement(ns + "outVariable", new XAttribute("localId", 9), new XElement(ns + "expression", "z")));
        var outXml = PlcOpenDocument.SpliceFbdLdBody(Pou, newLd);   // Pou has an <FBD> body
        Assert.Contains("<FBD", outXml);        // wrapper preserved
        Assert.DoesNotContain("<LD>", outXml);  // not flipped to LD
        Assert.Contains("outVariable", outXml); // contents swapped in
        Assert.DoesNotContain("inVariable", outXml);
    }

    [Fact]
    public void Splice_allows_cosmetic_vendorElement()
    {
        // vendorElement (FBD editor attributes) is safe to drop — the splice must NOT refuse it.
        const string withVendor = """
        <pou xmlns="http://www.plcopen.org/xml/tc6_0200" name="P">
          <body><FBD>
            <vendorElement localId="1"/>
            <inVariable localId="2"><expression>a</expression></inVariable>
          </FBD></body>
        </pou>
        """;
        XNamespace ns = "http://www.plcopen.org/xml/tc6_0200";
        var outXml = PlcOpenDocument.SpliceFbdLdBody(withVendor, new XElement(ns + "FBD"));
        Assert.DoesNotContain("inVariable", outXml);   // body replaced
    }

    [Fact]
    public void Splice_refuses_a_gap_in_the_network_numbering()
    {
        // Networks 1, 2 and 4 are present (localId / 10^10) — network 3 is missing, i.e. a disabled
        // network the export omitted. Replacing the body would silently drop it: refuse instead.
        const string withGap = """
        <pou xmlns="http://www.plcopen.org/xml/tc6_0200" name="P">
          <body><FBD>
            <inVariable localId="10000000000"><expression>a</expression></inVariable>
            <inVariable localId="20000000000"><expression>b</expression></inVariable>
            <inVariable localId="40000000000"><expression>d</expression></inVariable>
          </FBD></body>
        </pou>
        """;
        var ex = Assert.Throws<System.InvalidOperationException>(
            () => PlcOpenDocument.SpliceFbdLdBody(withGap, new XElement("FBD")));
        Assert.Contains("gap", ex.Message);
    }

    [Fact]
    public void Splice_allows_contiguous_networks()
    {
        // Networks 1, 2, 3 — no gap, so the splice proceeds (a disabled network would break this).
        const string contiguous = """
        <pou xmlns="http://www.plcopen.org/xml/tc6_0200" name="P">
          <body><FBD>
            <inVariable localId="10000000000"><expression>a</expression></inVariable>
            <inVariable localId="20000000000"><expression>b</expression></inVariable>
            <inVariable localId="30000000000"><expression>c</expression></inVariable>
          </FBD></body>
        </pou>
        """;
        XNamespace ns = "http://www.plcopen.org/xml/tc6_0200";
        var outXml = PlcOpenDocument.SpliceFbdLdBody(contiguous, new XElement(ns + "FBD",
            new XElement(ns + "outVariable", new XAttribute("localId", 9), new XElement(ns + "expression", "z"))));
        Assert.Contains("outVariable", outXml);
    }

    // ── guard blind-spots: structure INSIDE a block the element-name guard can't see ──
    private const string Ns = "http://www.plcopen.org/xml/tc6_0200";
    private static string Fbd(string inner) =>
        $"<pou xmlns=\"{Ns}\" name=\"P\"><body><FBD>{inner}</FBD></body></pou>";

    [Fact]
    public void Splice_refuses_a_block_in_out_pin()
    {
        var xml = Fbd("""
            <block localId="1" typeName="F">
              <inOutVariables><variable formalParameter="buf"><connectionPointIn/></variable></inOutVariables>
            </block>
            """);
        var ex = Assert.Throws<System.InvalidOperationException>(
            () => PlcOpenDocument.SpliceFbdLdBody(xml, new XElement("FBD")));
        Assert.Contains("in-out", ex.Message);
    }

    [Fact]
    public void Splice_refuses_an_output_pin_modifier()
    {
        var xml = Fbd("""
            <block localId="1" typeName="F">
              <outputVariables><variable formalParameter="Q" negated="true"><connectionPointOut/></variable></outputVariables>
            </block>
            """);
        var ex = Assert.Throws<System.InvalidOperationException>(
            () => PlcOpenDocument.SpliceFbdLdBody(xml, new XElement("FBD")));
        Assert.Contains("output pin", ex.Message);
    }

    [Fact]
    public void Splice_refuses_a_pin_wired_from_multiple_sources()
    {
        var xml = Fbd("""
            <inVariable localId="1"><expression>a</expression></inVariable>
            <inVariable localId="2"><expression>b</expression></inVariable>
            <outVariable localId="3"><expression>o</expression>
              <connectionPointIn><connection refLocalId="1"/><connection refLocalId="2"/></connectionPointIn></outVariable>
            """);
        var ex = Assert.Throws<System.InvalidOperationException>(
            () => PlcOpenDocument.SpliceFbdLdBody(xml, new XElement("FBD")));
        Assert.Contains("multiple sources", ex.Message);
    }

    [Fact]
    public void Splice_allows_a_normal_block_with_empty_inOutVariables()
    {
        // The shape every real export has: input pins, an empty <inOutVariables/>, plain outputs.
        var xml = Fbd("""
            <inVariable localId="1"><expression>a</expression></inVariable>
            <block localId="2" typeName="AND">
              <inputVariables><variable formalParameter="IN1"><connectionPointIn><connection refLocalId="1"/></connectionPointIn></variable></inputVariables>
              <inOutVariables/>
              <outputVariables><variable formalParameter="OUT"><connectionPointOut/></variable></outputVariables>
            </block>
            """);
        XNamespace ns = Ns;
        var outXml = PlcOpenDocument.SpliceFbdLdBody(xml,
            new XElement(ns + "FBD", new XElement(ns + "outVariable",
                new XAttribute("localId", 9), new XElement(ns + "expression", "z"))));
        Assert.Contains("outVariable", outXml);   // splice proceeded
    }

    [Fact]
    public void InstanceTypes_parses_declaration()
    {
        var m = PlcOpenDocument.InstanceTypes("VAR\n\ttmr : TON;\n\ttrig : Tc2_Standard.R_TRIG;\nEND_VAR");
        Assert.Equal("TON", m["tmr"]);
        Assert.Equal("Tc2_Standard.R_TRIG", m["trig"]);
    }
}
