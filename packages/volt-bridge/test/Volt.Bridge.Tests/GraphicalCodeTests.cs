using System;
using Volt.Bridge.Core.Graphical;
using Volt.Bridge.Core.Graphical.Vg;
using Volt.Bridge.Core.Ide;
using Xunit;

namespace Volt.Bridge.Tests;

/// <summary>Exercises the graphical code path (<see cref="GraphicalCode"/>) entirely offline through a
/// fake code store — the payoff of the clean boundary: no live IDE needed. Proves the symmetric
/// read/write (decl + body via one PLCopen) and the zero-fallback behaviour (failures propagate).</summary>
public class GraphicalCodeTests
{
    private const string Ns = "http://www.plcopen.org/xml/tc6_0200";

    private static string Pou(string body, bool withIface, string oldDecl = "FUNCTION_BLOCK FB_Old\nVAR\n\tz : BOOL;\nEND_VAR")
    {
        var iface = withIface
            ? "<addData><data name=\"http://www.3s-software.com/plcopenxml/interfaceasplaintext\" handleUnknown=\"implementation\">" +
              $"<InterfaceAsPlainText><xhtml xmlns=\"http://www.w3.org/1999/xhtml\">{System.Security.SecurityElement.Escape(oldDecl)}</xhtml></InterfaceAsPlainText></data></addData>"
            : "";
        return $"<pou xmlns=\"{Ns}\" name=\"P\"><interface/><body>{body}</body>{iface}</pou>";
    }

    private const string FbdBody =
        "<FBD><inVariable localId=\"1\"><expression>a</expression></inVariable>" +
        "<outVariable localId=\"2\"><expression>x</expression><connectionPointIn><connection refLocalId=\"1\"/></connectionPointIn></outVariable></FBD>";

    private static ItemRef Item => new(new object());

    [Fact]
    public void Textual_body_returns_null_and_never_exports()
    {
        var s = new FakeCodeStore { Lang = null };
        Assert.Null(GraphicalCode.Read(s, Item));
        Assert.Equal(0, s.ReadXmlCalls);   // the cheap gate short-circuits — no export for textual POUs
    }

    [Fact]
    public void Fbd_body_reads_as_vg_with_declaration_from_the_same_export()
    {
        var s = new FakeCodeStore { Lang = "FBD", Xml = Pou(FbdBody, withIface: true, oldDecl: "FUNCTION_BLOCK FB\nVAR\n\ta : BOOL;\nEND_VAR") };
        var gb = GraphicalCode.Read(s, Item);
        Assert.NotNull(gb);
        Assert.Equal("FBD", gb!.Language);
        Assert.StartsWith("NETWORK 0 FBD", gb.Body);
        Assert.Equal("FUNCTION_BLOCK FB\nVAR\n\ta : BOOL;\nEND_VAR", gb.Declaration);   // from the export's plaintext interface
        Assert.Equal(1, s.ReadXmlCalls);
    }

    [Theory]
    [InlineData("CFC")]
    [InlineData("SFC")]
    public void Cfc_and_sfc_bodies_are_read_only_markers_with_a_real_declaration(string lang)
    {
        // Read-only graphical languages surface as an empty (non-transpiled) marker on BOTH vendors — this
        // is a Core rule, not a vendor trait, so it's proven offline here rather than via a live IDE fixture.
        var s = new FakeCodeStore { Lang = lang, Xml = Pou($"<{lang}/>", withIface: false), Decl = "FUNCTION_BLOCK C\nVAR\nEND_VAR" };
        var gb = GraphicalCode.Read(s, Item);
        Assert.Equal(lang, gb!.Language);
        Assert.Equal("", gb.Body);                                       // not transpiled — empty marker
        Assert.DoesNotContain("NETWORK", gb.Body);                       // never an editable VG body
        Assert.Equal("FUNCTION_BLOCK C\nVAR\nEND_VAR", gb.Declaration);  // export omits plaintext iface → textual aspect
    }

    [Fact]
    public void Declaration_falls_to_the_textual_aspect_when_the_export_omits_it()
    {
        var s = new FakeCodeStore { Lang = "FBD", Xml = Pou(FbdBody, withIface: false), Decl = "FUNCTION_BLOCK T\nVAR\n\ta : BOOL;\nEND_VAR" };
        Assert.Equal("FUNCTION_BLOCK T\nVAR\n\ta : BOOL;\nEND_VAR", GraphicalCode.Read(s, Item)!.Declaration);
    }

    [Fact]
    public void Graphical_language_but_no_fbd_body_throws_not_a_silent_marker()
    {
        var s = new FakeCodeStore { Lang = "FBD", Xml = Pou("<ST>x:=1;</ST>", withIface: true) };
        Assert.Throws<InvalidOperationException>(() => GraphicalCode.Read(s, Item));
    }

    [Fact]
    public void Write_refuses_an_unknown_graphical_language_with_a_clear_message()
    {
        // A3: a bad language token is rejected BEFORE the IDE import, with a clear message — not downstream
        // with a misleading "not writable". The guard fires before ReadXml, so the store needn't be valid.
        var s = new FakeCodeStore { Lang = "FBD", Xml = Pou(FbdBody, withIface: false) };
        var ex = Assert.Throws<InvalidOperationException>(() => GraphicalCode.Write(
            s, Item, "NETWORK 0 BANANA\n  VAR_TEMP\n    i1 : BOOL;\n  END_VAR\n  i1 := a;\n  q := i1;\nEND_NETWORK\n",
            "FUNCTION_BLOCK FB\nVAR\nEND_VAR"));
        Assert.Contains("unknown graphical language", ex.Message);
        Assert.Contains("BANANA", ex.Message);
    }

    [Fact]
    public void Write_refuses_a_non_canonical_body_and_shows_the_canonical_form()
    {
        // The strict round-trip gate: this parses fine, but it spells out named temps where the writer inlines
        // the single-use operands, so it would not round-trip identically. Refused before the import, with the
        // readable canonical form shown.
        var s = new FakeCodeStore { Lang = "FBD", Xml = Pou(FbdBody, withIface: false) };
        var nonCanonical = "NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n    gX : BOOL;\n  END_VAR\n"
            + "  i1 := a;\n  i2 := b;\n  gX := (i1 AND i2);\n  out := gX;\nEND_NETWORK\n";
        var ex = Assert.Throws<VgParseException>(() =>
            GraphicalCode.Write(s, Item, nonCanonical, "FUNCTION_BLOCK FB\nVAR\nEND_VAR"));
        Assert.Equal("VG_NOT_CANONICAL", ex.Code);          // structured diagnostic
        Assert.NotNull(ex.Line);                            // names the first differing line
        Assert.Contains("out := (a AND b)", ex.Message);    // the writer's readable canonical form is shown verbatim
    }

    [Fact]
    public void A_failed_export_propagates_never_an_empty_marker()
    {
        var s = new FakeCodeStore { Lang = "FBD", ThrowOnReadXml = true };
        Assert.Throws<InvalidOperationException>(() => GraphicalCode.Read(s, Item));
    }

    [Fact]
    public void Write_replaces_the_body_and_preserves_the_interface()
    {
        // The body is replaced; the POU's declaration is NOT touched (CODESYS regenerates the interface
        // from the typed <interface> on import, ignoring the plaintext — so we never splice the decl).
        var s = new FakeCodeStore
        {
            Xml = Pou("<FBD><inVariable localId=\"1\"><expression>old</expression></inVariable></FBD>",
                      withIface: true, oldDecl: "FUNCTION_BLOCK FB_Old\nVAR\n\tz : BOOL;\nEND_VAR"),
        };
        const string vg = "NETWORK 0 FBD\n  x := a;\nEND_NETWORK\n";
        const string decl = "FUNCTION_BLOCK FB\nVAR\n\ta : BOOL;\n\tx : BOOL;\nEND_VAR";

        GraphicalCode.Write(s, Item, vg, decl);

        Assert.NotNull(s.WrittenXml);
        Assert.DoesNotContain("old", s.WrittenXml!);                       // old body gone
        Assert.Contains("<expression>x</expression>", s.WrittenXml!);      // edited body in
        Assert.Equal("FUNCTION_BLOCK FB_Old\nVAR\n\tz : BOOL;\nEND_VAR",   // interface untouched
                     Volt.Bridge.Core.Graphical.PlcOpenDocument.DeclFromExport(s.WrittenXml!));
    }
}

/// <summary>A minimal in-memory <see cref="ICodeStore"/>: only the members <see cref="GraphicalCode"/>
/// uses do anything; the rest throw (never reached on the graphical path).</summary>
internal sealed class FakeCodeStore : ICodeStore
{
    public string? Lang;
    public string Xml = "";
    public string Decl = "";
    public bool ThrowOnReadXml;
    public int ReadXmlCalls;
    public string? WrittenXml;

    public string? BodyLanguage(ItemRef item) => Lang;
    public string ReadXml(ItemRef item) { ReadXmlCalls++; if (ThrowOnReadXml) throw new InvalidOperationException("export failed"); return Xml; }
    public void WriteXml(ItemRef item, string xml) => WrittenXml = xml;
    public string ReadDeclaration(ItemRef item) => Decl;
    public string ReadImplementation(ItemRef item) => "";
    public void WriteText(ItemRef item, string declaration, string implementation) => throw new NotSupportedException();
    public string ReadManifest(ItemRef item, string kind) => throw new NotSupportedException();
}
