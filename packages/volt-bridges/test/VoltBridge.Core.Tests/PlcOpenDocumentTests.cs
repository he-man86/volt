using System.Xml.Linq;
using VoltBridge.Core.Fbd;
using Xunit;

namespace VoltBridge.Core.Tests;

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

    [Fact]
    public void InstanceTypes_parses_declaration()
    {
        var m = PlcOpenDocument.InstanceTypes("VAR\n\ttmr : TON;\n\ttrig : Tc2_Standard.R_TRIG;\nEND_VAR");
        Assert.Equal("TON", m["tmr"]);
        Assert.Equal("Tc2_Standard.R_TRIG", m["trig"]);
    }
}
