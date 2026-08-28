using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
using Xunit;
using Volt.Engine.Item;
using Volt.Engine.PlcOpen;
using Volt.Engine.Library;
using Volt.Engine.Format.Body;

namespace Volt.Cli.Tests;

/// <summary>
/// A property ACCESSOR's body has a language like any other body, and both legs of the accessor path ignore it.
///
/// <para>Found by audit, and it invalidates a green test of mine: `test/e2e/graphical/graphical-kinds.test.ts`
/// pushes LD into both accessors of a PROPERTY and asserts the body comes back as LD and re-pushes byte-identical.
/// It passes on both vendors. It proves nothing, because the failure is a FIXED POINT: the write flattens the
/// network TEXT into &lt;ST&gt;, and the read hands that same text back, so `NETWORK 0 LD` is still in the string
/// and the round-trip is stable. The text survives; the diagram does not.</para>
///
/// <para>DIALECT D17 records that claim as measured on both vendors. The accessor half of it is a false green.</para>
/// </summary>
public class AccessorBodyLanguageTests
{
    private const string Ns = "http://www.plcopen.org/xml/tc6_0200";

    /// <summary>An FB with one PROPERTY whose getter body is the language given.
    /// <para>Shaped after the recorded export <c>fixtures/codesys-pou/BoxFB.plcopen.xml</c>: the accessor element
    /// is <c>&lt;GetAccessor&gt;</c> and both vendors emit it that way. An earlier draft of this file invented
    /// <c>&lt;Get&gt;</c>, and the reader simply found no accessor — the tests failed for a reason that had
    /// nothing to do with the bug they exist to pin.</para></summary>
    private static string PouWithGetter(string getterBodyInner) =>
        $"""
        <?xml version="1.0" encoding="utf-8"?>
        <project xmlns="{Ns}">
          <types><pous>
            <pou name="FB_P" pouType="functionBlock">
              <interface />
              <body><ST><xhtml>x := 1;</xhtml></ST></body>
              <addData>
                <data name="http://www.3s-software.com/plcopenxml/interfaceasplaintext" handleUnknown="implementation">
                  <InterfaceAsPlainText><xhtml>FUNCTION_BLOCK FB_P
        VAR
        END_VAR</xhtml></InterfaceAsPlainText>
                </data>
                <data name="http://www.3s-software.com/plcopenxml/property" handleUnknown="implementation">
                  <Property name="P_G">
                    <GetAccessor>
                      <interface />
                      <body>{getterBodyInner}</body>
                      <InterfaceAsPlainText><xhtml>VAR
        END_VAR</xhtml></InterfaceAsPlainText>
                    </GetAccessor>
                    <InterfaceAsPlainText><xhtml>PROPERTY P_G : BOOL</xhtml></InterfaceAsPlainText>
                  </Property>
                </data>
              </addData>
            </pou>
          </pous></types>
        </project>
        """;

    private static XElement GetterBody(string xml) =>
        XDocument.Parse(xml).Descendants().First(e => e.Name.LocalName == "GetAccessor")
            .Elements().First(e => e.Name.LocalName == "body");

    private static ItemContent WithGetter(string getterCode) =>
        new(ItemKind.Kinds.FunctionBlock, "FUNCTION_BLOCK FB_P\nVAR\nEND_VAR", "x := 1;",
            new List<Member> { new(ItemKind.Kinds.Property, "P_G", "PROPERTY P_G : BOOL", "", null,
                new Accessor("VAR\nEND_VAR", getterCode), null) });

    private const string LdText = "NETWORK 0 LD\n  P_G := (a AND b);\nEND_NETWORK";

    /// <summary>Network text pushed at an accessor becomes a real &lt;LD&gt; ELEMENT, not ST holding the text.
    /// <para>This is the bug in its simplest form. <c>SetAccessor</c> hardcoded <c>&lt;ST&gt;</c>, so an LD
    /// accessor was stored as its own source text — and because the read half returned that text verbatim, the
    /// round-trip was a FIXED POINT. Every assertion about it passed; the ladder was never there. Asserting on
    /// the ELEMENT is what the round-trip could not see.</para></summary>
    [Fact]
    public void Pushing_network_text_at_an_accessor_writes_a_real_LD_element()
    {
        // A freshly created accessor carries an empty <ST> — what both IDEs seed — so this is the ordinary create.
        var doc = PouDocument.Splice(PouWithGetter("<ST><xhtml /></ST>"), "FB_P", WithGetter(LdText), establishing: false);

        var body = GetterBody(doc);
        var kids = body.Elements().Select(e => e.Name.LocalName).ToArray();
        Assert.Contains("LD", kids);
        Assert.DoesNotContain("ST", kids);
        Assert.DoesNotContain("NETWORK 0 LD", body.ToString());   // stored as a diagram, never as source
        Assert.Contains("coil", body.ToString());                 // and it really is a ladder
    }

    /// <summary>And an ST push over that LD accessor is REFUSED, not silently flattened.
    /// <para>The ladder comes from the writer above rather than a hand-authored one: a synthetic
    /// <c>&lt;LD&gt;&lt;rung/&gt;&lt;/LD&gt;</c> is a shape no vendor emits, and <c>GraphSplice</c> rightly
    /// refuses it — which would make this test pass for the wrong reason.</para></summary>
    [Fact]
    public void Pushing_ST_over_an_LD_accessor_is_refused()
    {
        var withLd = PouDocument.Splice(PouWithGetter("<ST><xhtml /></ST>"), "FB_P", WithGetter(LdText), establishing: false);

        var ex = Assert.Throws<InvalidOperationException>(
            () => PouDocument.Splice(withLd, "FB_P", WithGetter("P_G := a;"), establishing: false));
        Assert.Contains("LD", ex.Message);
        Assert.Contains("P_G", ex.Message);
    }

    /// <summary>And the READ half: an accessor body is decoded through its codec, not as raw text.
    /// <para><c>PouReader.Accessor</c> returns <c>langEl?.Value.Trim()</c>, so a diagram accessor materializes as
    /// the concatenation of its XML text nodes — junk in the engineer's workspace file, straight from a plain
    /// `volt pull`, before any push is involved.</para></summary>
    [Fact]
    public void An_unsupported_accessor_body_reads_as_the_marker_not_as_raw_xml_text()
    {
        var xml = PouWithGetter("<ST><xhtml /></ST><addData><data name=\"x/cfc\"><CFC><box>label</box></CFC></data></addData>");
        var parsed = PouReader.Parse(xml);
        var got = parsed.Properties.Single(p => p.Name == "P_G").GetterCode;

        Assert.True(BodyMarker.Is(got), $"a CFC accessor must materialize as the marker; got: '{got}'");
        Assert.DoesNotContain("label", got ?? "");
    }
}
