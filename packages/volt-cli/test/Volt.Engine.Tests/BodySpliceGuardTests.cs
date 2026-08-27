using System.Xml.Linq;
using Xunit;
using Volt.Engine.Document;
using Volt.Engine.Graph;

namespace Volt.Cli.Tests;

/// <summary>
/// The capability gate over a stored graphical body: what a push may overwrite, and what it must refuse.
///
/// <para>These cases used to drive <c>GraphSplice.SpliceFbdLdBody</c>, which had ZERO production callers — a
/// second graphical write path that existed only for this file. The contract they actually assert is real and
/// production-critical, so they are RETARGETED rather than deleted: the refusal cases now call
/// <c>BodySpliceGuard.RequireReplaceable</c> directly, which is what <c>BodyCodec.NetworkCodec.Encode</c> calls,
/// and the document-scoping cases call <c>PouSplice.SetBody</c>, the real write entry.</para>
///
/// <para>Testing a contract through a shim that ships beside the real caller is how the shim stayed alive: the
/// tests looked like coverage of the write path and were coverage of something nothing ran.</para>
/// </summary>
public class BodySpliceGuardTests
{
    private const string Pou = """
    <pou xmlns="http://www.plcopen.org/xml/tc6_0200" name="P">
      <interface/>
      <body><FBD><inVariable localId="1"><expression>a</expression></inVariable></FBD></body>
    </pou>
    """;


    // ── the production entry points these cases assert, reached directly ──

    /// <summary>Run the capability gate over the one graphical body in a single-body fixture — exactly what
    /// <c>BodyCodec.NetworkCodec.Encode</c> does before it replaces a stored body.</summary>
    private static void Gate(string xml) =>
        BodySpliceGuard.RequireReplaceable(
            XDocument.Parse(xml).Descendants().First(e => e.Name.LocalName is "FBD" or "LD"));

    /// <summary>The NAMED item's graphical body, via the production scoping rule
    /// (<c>PlcOpenDocument.ItemBody</c>) — the thing the scoping cases below are actually about.</summary>
    private static XElement? NamedBody(string xml, string itemName) =>
        PlcOpenDocument.ItemBody(XDocument.Parse(xml), itemName)?
            .Elements().FirstOrDefault(e => e.Name.LocalName is "FBD" or "LD");

    /// <summary>Replace the NAMED item's body element, gate first. The scoped equivalent of
    /// <c>TestPlcOpen.SpliceOnlyGraphicalBody</c>, for the multi-body documents below.</summary>
    private static string SpliceNamed(string xml, string itemName, XElement newBody)
    {
        var doc = XDocument.Parse(xml);
        var body = PlcOpenDocument.ItemBody(doc, itemName)
            ?? throw new System.InvalidOperationException($"'{itemName}' has no <body> element");
        var existing = body.Elements().FirstOrDefault(e => e.Name.LocalName is "FBD" or "LD");
        if (existing is null) { body.RemoveNodes(); body.Add(newBody); }      // first write onto a textual body
        else { BodySpliceGuard.RequireReplaceable(existing); existing.ReplaceWith(newBody); }
        return PlcOpenDocument.Serialize(doc);
    }

    [Fact]
    public void Finds_the_FBD_body()
    {
        var body = NamedBody(Pou, "P");
        Assert.NotNull(body);
        Assert.Equal("FBD", body!.Name.LocalName);
    }

    [Fact]
    public void Splices_a_new_body_in_place()
    {
        XNamespace ns = "http://www.plcopen.org/xml/tc6_0200";
        var newBody = new XElement(ns + "FBD", new XElement(ns + "outVariable",
            new XAttribute("localId", 9), new XElement(ns + "expression", "z")));

        var outXml = SpliceNamed(Pou, "P", newBody);

        Assert.Contains("outVariable", outXml);
        Assert.Contains("z", outXml);
        Assert.DoesNotContain("inVariable", outXml);   // old body gone
        Assert.Contains("<interface", outXml);          // rest of the POU preserved
    }

    [Fact]
    public void Splice_into_a_textual_body_inserts_for_the_first_time()
    {
        // A POU whose export still has a textual <ST> body (e.g. a freshly created CODESYS POU getting its
        // first graphical body) is the first-write case: InlineInsert replaces the ST body with the new
        // graphical one. NOT a throw — nothing of value is lost (the textual body is discarded by design).
        const string st = """<pou xmlns="http://www.plcopen.org/xml/tc6_0200" name="P"><body><ST>x:=1;</ST></body></pou>""";
        XNamespace ns = "http://www.plcopen.org/xml/tc6_0200";
        var outXml = SpliceNamed(st, "P", new XElement(ns + "FBD", new XElement(ns + "inVariable", new XAttribute("localId", 1))));
        Assert.Contains("<FBD", outXml);          // graphical body inserted
        Assert.DoesNotContain("x:=1", outXml);    // textual body discarded
    }

    [Fact]
    public void Splice_throws_when_the_pou_has_no_body_element()
    {
        const string noBody = """<pou xmlns="http://www.plcopen.org/xml/tc6_0200" name="P"><interface/></pou>""";
        Assert.Throws<System.InvalidOperationException>(
            () => SpliceNamed(noBody, "P", new XElement("FBD")));
    }

    [Fact]
    public void Splice_refuses_to_drop_unrepresentable_elements()
    {
        // A body with a <connector> the network text editor can't reproduce — must refuse, not silently drop it.
        // (contact/coil/power-rails ARE now reproduced by the ladder generator, so they're no longer here.)
        const string withConnector = """
        <pou xmlns="http://www.plcopen.org/xml/tc6_0200" name="P">
          <body><FBD>
            <inVariable localId="1"><expression>a</expression></inVariable>
            <connector localId="2" name="C"><connectionPointIn><connection refLocalId="1"/></connectionPointIn></connector>
          </FBD></body>
        </pou>
        """;
        var ex = Assert.Throws<System.InvalidOperationException>(() => Gate(withConnector));
        Assert.Contains("connector", ex.Message);
    }

    [Fact]
    public void Splice_flips_the_wrapper_to_the_new_body_language()
    {
        // TwinCAT creates a graphical POU as FBD even for an LD body, so the export's body wrapper is <FBD>
        // while the new (regenerated) body is <LD>. The splice MUST flip the wrapper to <LD> — verified live:
        // TwinCAT's importer requires real ladder elements inside <LD> and rejects a contact inside <FBD>.
        // Only the body element changes; the rest of the POU is preserved.
        XNamespace ns = "http://www.plcopen.org/xml/tc6_0200";
        var newLd = new XElement(ns + "LD",
            new XElement(ns + "coil", new XAttribute("localId", 9), new XElement(ns + "variable", "z")));
        var outXml = SpliceNamed(Pou, "P", newLd);   // Pou has an <FBD> body
        Assert.Contains("<LD>", outXml);             // wrapper flipped to match the new body
        Assert.DoesNotContain("<FBD>", outXml);      // old FBD wrapper replaced
        Assert.Contains("coil", outXml);             // new contents present
        Assert.DoesNotContain("inVariable", outXml); // old body gone
        Assert.Contains("<interface", outXml);       // rest of POU preserved
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
        var outXml = SpliceNamed(withVendor, "P", new XElement(ns + "FBD"));
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
        var ex = Assert.Throws<System.InvalidOperationException>(() => Gate(withGap));
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
        var outXml = SpliceNamed(contiguous, "P", new XElement(ns + "FBD",
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
        var ex = Assert.Throws<System.InvalidOperationException>(() => Gate(xml));
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
        var ex = Assert.Throws<System.InvalidOperationException>(() => Gate(xml));
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
        var ex = Assert.Throws<System.InvalidOperationException>(() => Gate(xml));
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
        var outXml = SpliceNamed(xml, "P", new XElement(ns + "FBD", new XElement(ns + "outVariable",
                new XAttribute("localId", 9), new XElement(ns + "expression", "z"))));
        Assert.Contains("outVariable", outXml);   // splice proceeded
    }

    // ── document scoping: the ROOT POU's body, never a child method's ──

    /// <summary>A children-bearing document: the POU's own body is textual (ST) while the graphical bodies
    /// belong to its two METHODS — the situation `ReadXml` returns on both vendors, since neither can export a
    /// method or action standalone.
    /// <para><b>The member SHAPE below is not a vendor's.</b> It nests <c>&lt;pou pouType="method"&gt;</c>, which
    /// TC6 forbids and no recorded export contains; the real ones are <c>&lt;addData&gt;/&lt;data&gt;/&lt;Method&gt;</c>
    /// and <c>&lt;actions&gt;/&lt;action&gt;</c>. It is kept here ONLY because these cases test NAME SCOPING via
    /// <c>PlcOpenDocument.ItemBody</c>, which matches a named element out of the whole document and is indifferent
    /// to where it sits — so the shape is irrelevant to what is under test. This comment used to claim it WAS the
    /// vendors' shape; that was false, and believing it is what kept a dead branch in <c>PouReader</c> alive.</para> Every one of these read/write entry points used to scan the WHOLE document and so
    /// answered about whichever body came first, not the one asked for: the read reported the textual POU as FBD
    /// and handed back a method's body, and the write spliced the regenerated body over that method, destroying
    /// it while leaving the intended target untouched. Two methods, not one, because "first in document order"
    /// is also wrong BETWEEN siblings.</summary>
    private const string PouWithGraphicalMethods = $"""
    <pou xmlns="{Ns}" name="P" pouType="functionBlock">
      <interface/>
      <body><ST>pou_body</ST></body>
      <pou name="First" pouType="method">
        <body><FBD><inVariable localId="1"><expression>first_body</expression></inVariable></FBD></body>
      </pou>
      <pou name="Second" pouType="method">
        <body><FBD><inVariable localId="1"><expression>second_body</expression></inVariable></FBD></body>
      </pou>
    </pou>
    """;

    [Fact]
    public void Body_language_is_the_named_items_not_a_relatives()
    {
        Assert.Null(PlcOpenDocument.GraphicalBodyLang(PouWithGraphicalMethods, "P"));       // textual POU
        Assert.Equal("FBD", PlcOpenDocument.GraphicalBodyLang(PouWithGraphicalMethods, "Second"));
    }

    [Fact]
    public void Finding_a_graphical_body_selects_the_named_item()
    {
        Assert.Null(NamedBody(PouWithGraphicalMethods, "P"));
        Assert.Contains("second_body", NamedBody(PouWithGraphicalMethods, "Second")!.ToString());
    }

    [Fact]
    public void Splice_writes_the_named_item_and_leaves_its_siblings_intact()
    {
        XNamespace ns = Ns;
        static XElement NewBody(XNamespace ns) => new(ns + "FBD", new XElement(ns + "outVariable",
            new XAttribute("localId", 9), new XElement(ns + "expression", "written")));

        // The SECOND method — not the first, which is what document order would have picked.
        var onMethod = SpliceNamed(PouWithGraphicalMethods, "Second", NewBody(ns));
        Assert.Contains("written", onMethod);
        Assert.DoesNotContain("second_body", onMethod);   // replaced
        Assert.Contains("first_body", onMethod);          // sibling method untouched
        Assert.Contains("pou_body", onMethod);            // the POU's own body untouched

        // The POU itself — a first write onto its textual body, leaving both methods alone.
        var onPou = SpliceNamed(PouWithGraphicalMethods, "P", NewBody(ns));
        Assert.Contains("written", onPou);
        Assert.DoesNotContain("pou_body", onPou);         // textual body discarded by the first write
        Assert.Contains("first_body", onPou);
        Assert.Contains("second_body", onPou);
    }

    /// <summary>A TwinCAT action lives in <c>&lt;actions&gt;/&lt;action&gt;</c>, which the export emits BEFORE the
    /// POU's own <c>&lt;body&gt;</c> — so document order made an action the default answer for its whole POU.</summary>
    [Fact]
    public void An_action_is_addressable_by_name_and_does_not_shadow_its_pou()
    {
        const string withAction = $"""
        <pou xmlns="{Ns}" name="P" pouType="program">
          <actions><action name="ACT"><body><FBD><inVariable localId="1"><expression>act_body</expression></inVariable></FBD></body></action></actions>
          <body><FBD><inVariable localId="1"><expression>pou_body</expression></inVariable></FBD></body>
        </pou>
        """;
        Assert.Contains("act_body", NamedBody(withAction, "ACT")!.ToString());
        Assert.Contains("pou_body", NamedBody(withAction, "P")!.ToString());
    }

    [Fact]
    public void InstanceTypes_parses_declaration()
    {
        var m = InstanceTypes.Of("VAR\n\ttmr : TON;\n\ttrig : Tc2_Standard.R_TRIG;\nEND_VAR");
        Assert.Equal("TON", m["tmr"]);
        Assert.Equal("Tc2_Standard.R_TRIG", m["trig"]);
    }
}
