using System;
using System.Collections.Generic;
using System.Xml.Linq;
using Xunit;
using Volt.Engine.Item;
using Volt.Engine.PlcOpen;
using Volt.Engine.Library;
using Volt.Engine.Format.Body;

namespace Volt.Cli.Tests;

/// <summary>
/// A body in a language Volt does not model must FAIL CLOSED — be recognised as non-textual and refused — rather
/// than be read as ST and overwritten.
///
/// <para><b>This is the IL failure mode, and it was still open.</b> `PouReader.NonStLanguageOf` promises exactly
/// this: "a language nobody has thought about yet is refused rather than flattened". It could not deliver it.
/// `LangIn` iterated a hardcoded <c>{ ST, IL, FBD, LD, CFC, SFC }</c> and returned <c>default</c> for anything
/// else, so an unmodelled element read as null — which every caller takes to mean "textual". The write path had
/// the same hole one layer over: `BodyCodec.PresentWith` matches REGISTERED codecs, so an unmodelled element
/// matches none, `PouSplice.SetBody` sees no present language, and the mismatch guard never fires.</para>
///
/// <para>The closed list was the bug both times. These tests use a body language that does not exist — if the
/// fix were "add one more name to the list", they would still fail.</para>
/// </summary>
public class UnmodelledLanguageTests
{
    private const string Ns = "http://www.plcopen.org/xml/tc6_0200";
    private const string Nl = "\n";

    /// <summary>A POU whose body is a language no vendor ships and Volt has never heard of.</summary>
    private static string PouWithBody(string bodyInner) =>
        $"""
        <?xml version="1.0" encoding="utf-8"?>
        <project xmlns="{Ns}">
          <types><pous>
            <pou name="FB_Odd" pouType="functionBlock">
              <interface />
              <body>{bodyInner}</body>
              <addData>
                <data name="http://www.3s-software.com/plcopenxml/interfaceasplaintext" handleUnknown="implementation">
                  <InterfaceAsPlainText><xhtml>FUNCTION_BLOCK FB_Odd
        VAR
        END_VAR</xhtml></InterfaceAsPlainText>
                </data>
              </addData>
            </pou>
          </pous></types>
        </project>
        """;

    private static XElement BodyOf(string xml) =>
        XDocument.Parse(xml).Descendants().First(e => e.Name.LocalName == "body");

    // ── the read side ──────────────────────────────────────────────────────────────────────────────

    /// <summary>An unmodelled body language is reported AS a language, not as null. Null is what every caller
    /// reads as "textual", which is the flattening this method exists to prevent.</summary>
    [Fact]
    public void An_unmodelled_body_language_is_not_reported_as_textual()
    {
        var body = BodyOf(PouWithBody("<QUUX><whatever /></QUUX>"));
        Assert.Equal("QUUX", PouReader.NonStLanguageOf(body));
    }

    /// <summary>The schema's non-language children are still not languages. `addData` is where CFC/SFC and every
    /// vendor extension live, so mistaking it for the body language would break every real export.</summary>
    [Fact]
    public void AddData_and_documentation_are_not_mistaken_for_a_language()
    {
        Assert.Null(PouReader.NonStLanguageOf(BodyOf(PouWithBody(
            "<ST><xhtml>x := 1;</xhtml></ST><documentation /><addData />"))));
    }

    /// <summary>The shapes that already worked keep working — this is the regression half.</summary>
    [Theory]
    [InlineData("<ST><xhtml>x := 1;</xhtml></ST>", null)]
    [InlineData("<FBD />", "FBD")]
    [InlineData("<LD />", "LD")]
    [InlineData("<SFC />", "SFC")]
    [InlineData("<IL><xhtml>LD x</xhtml></IL>", "IL")]
    public void The_known_languages_are_unchanged(string bodyInner, string? expected) =>
        Assert.Equal(expected, PouReader.NonStLanguageOf(BodyOf(PouWithBody(bodyInner))));

    /// <summary>A CFC body ships an EMPTY sibling &lt;ST&gt; and hangs the real body off addData. The nested
    /// lookup must still win — this is the ordering the open-ended scan must not disturb.</summary>
    [Fact]
    public void The_nested_CFC_body_still_wins_over_its_empty_ST_sibling()
    {
        var body = BodyOf(PouWithBody(
            "<ST><xhtml /></ST><addData><data name=\"http://www.3s-software.com/plcopenxml/cfc\">" +
            "<CFC /></data></addData>"));
        Assert.Equal("CFC", PouReader.NonStLanguageOf(body));
    }

    /// <summary>The nested lookup must not depend on the DEPTH the vendor chose. This is the CODESYS shape with
    /// one more wrapper element around it — a shape nothing has measured, which is exactly the point: no TwinCAT
    /// CFC or SFC export has ever been captured (DIALECT D7), so the depth is an assumption everywhere it is
    /// relied on. If the element is not found the empty sibling &lt;ST&gt; wins, the body reads as textual, and
    /// the next push overwrites a diagram that cannot be rebuilt from text.</summary>
    [Fact]
    public void A_nested_CFC_is_found_at_any_depth()
    {
        var body = BodyOf(PouWithBody(
            "<ST><xhtml /></ST><addData><data name=\"http://www.3s-software.com/plcopenxml/cfc\">" +
            "<Wrapper><CFC /></Wrapper></data></addData>"));
        Assert.Equal("CFC", PouReader.NonStLanguageOf(body));
    }

    /// <summary>SFC in the nested position, for the same reason. TC6 makes SFC a DIRECT body child, so this shape
    /// is unmeasured too — but CFC proves a vendor will put a diagram under addData when the schema has nowhere
    /// else for it, and SFC is the other language with no write path. The reader used to look here for SFC and
    /// stopped, correctly, because the WRITER did not: it would have been read as SFC and still overwritten
    /// through the ST decoy. Sharing one locator between the two halves is what makes looking safe again.</summary>
    [Fact]
    public void A_nested_SFC_is_found_rather_than_read_as_its_empty_ST_sibling()
    {
        var body = BodyOf(PouWithBody(
            "<ST><xhtml /></ST><addData><data name=\"vendor/sfc\"><SFC /></data></addData>"));
        Assert.Equal("SFC", PouReader.NonStLanguageOf(body));
    }

    /// <summary>And the halves agree. A body the READER calls a diagram must be one the WRITER also finds, or the
    /// refusal never fires: `PresentWith` would match the empty ST, `IsUncommitted` would call it uncommitted, and
    /// the push would flatten the diagram. Reader-only recognition is not protection.</summary>
    [Theory]
    [InlineData("<ST><xhtml /></ST><addData><data name=\"x/cfc\"><Wrapper><CFC /></Wrapper></data></addData>", "CFC")]
    [InlineData("<ST><xhtml /></ST><addData><data name=\"x/sfc\"><SFC /></data></addData>", "SFC")]
    public void A_push_refuses_to_overwrite_a_nested_diagram(string bodyInner, string language)
    {
        var split = new ItemContent(ItemKind.Kinds.FunctionBlock,
            "FUNCTION_BLOCK FB_Odd\nVAR\nEND_VAR", "x := 1;", new List<Member>());
        var ex = Assert.Throws<InvalidOperationException>(
            () => PouDocument.Splice(PouWithBody(bodyInner), "FB_Odd", split, establishing: false));
        Assert.Contains(language, ex.Message);
    }

    // ── the write side ─────────────────────────────────────────────────────────────────────────────

    /// <summary>And the push REFUSES it. The read half alone is not the fix: `BodyCodec.PresentWith` matches
    /// registered codecs, so an unmodelled element matches none, the language-mismatch guard sees nothing present,
    /// and the ST write proceeds — flattening the body the read half just correctly identified.</summary>
    [Fact]
    public void A_push_refuses_to_overwrite_an_unmodelled_body_language()
    {
        var xml = PouWithBody("<QUUX><whatever /></QUUX>");
        var split = new ItemContent(ItemKind.Kinds.FunctionBlock,
            "FUNCTION_BLOCK FB_Odd\nVAR\nEND_VAR", "x := 1;", new List<Member>());

        var ex = Assert.Throws<InvalidOperationException>(
            () => PouDocument.Splice(xml, "FB_Odd", split, establishing: false));
        Assert.Contains("QUUX", ex.Message);
    }

    /// <summary>Restating the MARKER over a ROOT unsupported body is the ordinary round-trip.
    /// <para>The child path (<c>Sync/BodyFormatGuard</c>) always drew this distinction — its comment says
    /// "pushing the marker back is the ordinary no-op" — and <c>GraphicalChildGuardTests</c> pins it for a
    /// METHOD. The ROOT path refused unconditionally, so a CFC/SFC POU's declaration could not be edited AT ALL:
    /// the pushed text is `declaration + marker`, and the whole push was rejected over a body nobody wrote.
    /// Nothing justified the asymmetry, and nothing caught it either — until a live CFC POU existed to push at
    /// (test/e2e/graphical/unsupported.test.ts), the only marker any test had ever pushed was a child's.</para>
    /// <para>The body must come back BYTE-IDENTICAL, not merely "still CFC": the whole reason a diagram is
    /// refused is that Volt cannot reconstruct it, so a rewrite that happened to preserve the language would
    /// still have destroyed the drawing.</para></summary>
    [Theory]
    [InlineData("<ST><xhtml /></ST><addData><data name=\"x/cfc\"><CFC><boxes /></CFC></data></addData>", "CFC")]
    [InlineData("<SFC><step name=\"Init\" /></SFC>", "SFC")]
    public void Restating_the_marker_over_a_root_unsupported_body_is_a_no_op(string bodyInner, string language)
    {
        var xml = PouWithBody(bodyInner);
        var split = new ItemContent(ItemKind.Kinds.FunctionBlock,
            "FUNCTION_BLOCK FB_Odd\nVAR\n\tnAdded : INT;\nEND_VAR",
            Volt.Engine.Format.Body.BodyMarker.For(language), new List<Member>());

        var doc = PouDocument.Splice(xml, "FB_Odd", split, establishing: false);

        // The declaration edit lands too, but on the ASPECT now, not in this document — asserting it here
        // would be vacuous. PushDeclarationTransportTests pins it at the transport that carries it.
        // …and the diagram is untouched, element and contents both
        Assert.Equal(language, PouReader.NonStLanguageOf(BodyOf(doc)));
        Assert.Equal(BodyOf(xml).ToString(), BodyOf(doc).ToString());
    }

    /// <summary>A marker over a body that is NOT unsupported IS refused — the one case where a marker is an
    /// error rather than a round-trip.
    /// <para>The rule has two arms, and only two, stated where the child path implements it: a marker matching an
    /// unsupported body leaves it alone; a marker over something WRITABLE is stale or hand-written, and accepting
    /// it would silently discard whatever the engineer meant to push. An earlier draft of this test asserted a
    /// third arm — that a CFC marker over an SFC body is refused for naming the wrong language — which no path
    /// has ever implemented and nothing needs: both are unsupported, so the body is untouched either way, and the
    /// next pull rewrites the file. Inventing invariants in a test is how a suite starts describing a system
    /// nobody built.</para></summary>
    [Fact]
    public void A_marker_over_a_writable_body_is_refused()
    {
        var xml = PouWithBody("<ST><xhtml>x := 1;</xhtml></ST>");
        var split = new ItemContent(ItemKind.Kinds.FunctionBlock,
            "FUNCTION_BLOCK FB_Odd\nVAR\nEND_VAR",
            Volt.Engine.Format.Body.BodyMarker.For("CFC"), new List<Member>());

        // Without this arm the marker is not refused at all — it is not network text, so it falls to the ST
        // codec and REPLACES the engineer's body with a comment. Silently, which is the worst version.
        var ex = Assert.Throws<InvalidOperationException>(
            () => PouDocument.Splice(xml, "FB_Odd", split, establishing: false));

        // The message names what the IDE ACTUALLY has ("textual"), not what the marker claimed. That is the
        // useful half: the engineer's mistake is believing this body is a diagram, and repeating "CFC" back to
        // them would confirm the wrong belief. It also says what to do next.
        Assert.Contains("ST", ex.Message);       // the body really is ST; "textual" is only for a body with none
        Assert.Contains("pull first", ex.Message);
        Assert.DoesNotContain("(* @volt-graphical", PouDocument.Splice(xml, "FB_Odd",
            new ItemContent(ItemKind.Kinds.FunctionBlock, "FUNCTION_BLOCK FB_Odd" + Nl + "VAR" + Nl + "END_VAR",
                "x := 2;", new List<Member>()), establishing: false));   // a REAL body still writes normally
    }

    /// <summary>A CREATE still establishes over the seed. `establishing` exists because a body Volt itself laid
    /// down microseconds ago is not an engineer's decision to protect — the refusal above must not swallow that.</summary>
    [Fact]
    public void Establishing_a_body_on_a_create_is_still_allowed()
    {
        var xml = PouWithBody("<ST><xhtml /></ST>");
        var split = new ItemContent(ItemKind.Kinds.FunctionBlock,
            "FUNCTION_BLOCK FB_Odd\nVAR\nEND_VAR", "x := 1;", new List<Member>());

        var doc = PouDocument.Splice(xml, "FB_Odd", split, establishing: true);
        Assert.Contains("x := 1;", doc);
    }
}
