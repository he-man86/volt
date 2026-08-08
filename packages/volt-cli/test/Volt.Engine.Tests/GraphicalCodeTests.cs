using System;
using Volt.Engine;
using Volt.Engine.Graphical;
using Volt.Engine.Graphical.Vg;
using Volt.Engine.Ide;
using Volt.Engine.Workspace;
using Xunit;

namespace Volt.Cli.Tests;

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

    // An FBD network holding a CODESYS Execute box: a <block typeName="EXECUTE"> whose fbdcalltype is
    // `execute`, carrying inline ST in an <STCode> element (the real shape captured from Bakon Recipes.prg —
    // see openspec/changes/graphical-execute-box/execute-box.reference.xml).
    private const string ExecuteBoxBody =
        "<FBD><inVariable localId=\"1\"><expression>TRUE</expression></inVariable>" +
        "<block localId=\"2\" typeName=\"EXECUTE\">" +
          "<inputVariables><variable formalParameter=\"EN\"><connectionPointIn><connection refLocalId=\"1\"/></connectionPointIn></variable></inputVariables>" +
          "<outputVariables><variable formalParameter=\"ENO\"><connectionPointOut/></variable></outputVariables>" +
          "<addData>" +
            "<data name=\"http://www.3s-software.com/plcopenxml/fbdcalltype\" handleUnknown=\"implementation\"><CallType>execute</CallType></data>" +
            "<data name=\"http://www.3s-software.com/plcopenxml/stcode\" handleUnknown=\"implementation\"><STCode>target := 42;</STCode></data>" +
          "</addData>" +
        "</block></FBD>";

    private static ItemRef Item => new(new object());
    // Every fixture POU above is named "P"; the name is what scopes the read/splice to this item
    // rather than to a sibling in the same export (see PlcOpenDocument.ItemBody).
    private const string ItemName = "P";

    [Fact]
    public void Textual_body_returns_null_and_never_exports()
    {
        var s = new FakeCodeStore { Lang = null };
        Assert.Null(GraphicalCode.Read(s, Item, ItemName));
        Assert.Equal(0, s.ReadXmlCalls);   // the cheap gate short-circuits — no export for textual POUs
    }

    [Fact]
    public void Fbd_body_reads_as_vg_with_declaration_from_the_same_export()
    {
        var s = new FakeCodeStore { Lang = "FBD", Xml = Pou(FbdBody, withIface: true, oldDecl: "FUNCTION_BLOCK FB\nVAR\n\ta : BOOL;\nEND_VAR") };
        var gb = GraphicalCode.Read(s, Item, ItemName);
        Assert.NotNull(gb);
        Assert.Equal("FBD", gb!.Language);
        Assert.StartsWith("NETWORK 0 FBD", gb.Body);
        Assert.Equal("FUNCTION_BLOCK FB\nVAR\n\ta : BOOL;\nEND_VAR", gb.Declaration);   // from the export's plaintext interface
        Assert.Equal(1, s.ReadXmlCalls);
    }

    [Theory]
    [InlineData("CFC")]
    [InlineData("SFC")]
    public void Cfc_and_sfc_bodies_read_as_an_empty_body_with_a_real_declaration(string lang)
    {
        // CFC/SFC have no text form: GraphicalCode.Read returns an EMPTY body (the Materializer later wraps
        // it in the @volt-graphical marker). A Core rule, not a vendor trait — proven offline here.
        var s = new FakeCodeStore { Lang = lang, Xml = Pou($"<{lang}/>", withIface: false), Decl = "FUNCTION_BLOCK C\nVAR\nEND_VAR" };
        var gb = GraphicalCode.Read(s, Item, ItemName);
        Assert.Equal(lang, gb!.Language);
        Assert.Equal("", gb.Body);                                       // not transpiled — empty
        Assert.DoesNotContain("NETWORK", gb.Body);                       // never an editable VG body
        Assert.Equal("FUNCTION_BLOCK C\nVAR\nEND_VAR", gb.Declaration);  // export omits plaintext iface → textual aspect
    }

    [Theory]
    [InlineData("CFC")]
    [InlineData("SFC")]
    public void Graphical_body_marker_matches_the_lsp_hover_shape(string lang)
    {
        // The CFC/SFC informational marker MUST match the LSP hover regex ^\(\* @volt-graphical: (\w+) \*\)$
        // so hovering a graphical body renders "generated by Volt, edit in the IDE". Format drift breaks it.
        var marker = Materializer.GraphicalBodyMarker(lang);
        Assert.Equal($"(* @volt-graphical: {lang} *)", marker);
        Assert.Matches(@"^\(\* @volt-graphical: \w+ \*\)$", marker);
    }

    [Fact]
    public void Fbd_body_with_an_execute_box_renders_its_inline_st_not_a_call()
    {
        // REGRESSION (graphical-execute-box): a CODESYS Execute box is the standard "ST inside FBD/LD"
        // element — it carries inline ST in an <STCode> addData. The bridge must render that ST (readable,
        // analyzable), NOT collapse it into a bare `EXECUTE()` call that drops the code. The body stays a
        // normal, readable VG body.
        var s = new FakeCodeStore { Lang = "FBD", Xml = Pou(ExecuteBoxBody, withIface: false), Decl = "PROGRAM P\nVAR\nEND_VAR" };
        var gb = GraphicalCode.Read(s, Item, ItemName);
        Assert.Equal("FBD", gb!.Language);
        Assert.Contains("NETWORK", gb.Body);          // a normal, readable VG body
        Assert.Contains("target := 42;", gb.Body);    // the box's real inline ST is materialized
        Assert.DoesNotContain("EXECUTE()", gb.Body);  // never the lossy call rendering
    }

    [Fact]
    public void Execute_box_round_trips_through_vg_preserving_its_st_and_en()
    {
        // Full round-trip: PLCopen XML → VG → graph → PLCopen XML. The Execute box renders as
        // `IF en THEN EXECUTE … END_EXECUTE END_IF` (EN handled like any block), and reconstructs as
        // <block typeName="EXECUTE"> + fbdcalltype=execute + <STCode> — so its inline ST survives verbatim.
        var s = new FakeCodeStore { Lang = "FBD", Xml = Pou(ExecuteBoxBody, withIface: false), Decl = "PROGRAM P\nVAR\nEND_VAR" };
        var vg = GraphicalCode.Read(s, Item, ItemName)!.Body;
        Assert.Contains("EXECUTE", vg);
        Assert.Contains("END_EXECUTE", vg);
        Assert.Contains("target := 42;", vg);          // the ST is rendered verbatim
        Assert.Contains("IF en", vg);                  // EN via the ordinary wire+IF guard, not special-cased

        var graph = VgParser.Parse(vg);                // VG → graph (bridge parser detects the EXECUTE marker)
        var xml = PlcOpenWriter.WriteBody(graph).ToString();
        Assert.Contains("typeName=\"EXECUTE\"", xml);  // reconstructed as a CODESYS Execute box
        Assert.Contains("target := 42;", xml);         // …carrying its STCode
        Assert.Contains("STCode", xml);
    }

    [Fact]
    public void Execute_box_eno_chained_to_a_downstream_en_round_trips()
    {
        // Review finding #1: an Execute box's ENO gating a downstream EN/ENO block (a natural FBD sequencing
        // pattern). The box's `en` must be a real ENO echo — a block output that CAN fan out — not the EN-source
        // leaf; otherwise the pulled body fails the canonical/leaf-fanout gate and can't be pushed back.
        var vg = "NETWORK 0 FBD\n  LET en1 := a;\n  IF en1 THEN\n  EXECUTE\n  x := 1;\n  END_EXECUTE\n  END_IF\n"
            + "  LET en2 := en1;\n  IF en2 THEN out := (b AND c); END_IF\nEND_NETWORK\n";
        GraphicalCode.Validate(vg);   // throws VG_NOT_CANONICAL / VG_LEAF_FANOUT if the round-trip breaks
    }

    [Fact]
    public void Write_reconstructs_an_execute_box_from_its_vg()
    {
        // Full write-path round-trip: read an execute-box body to canonical VG, then Write it back. The box is
        // REBUILT into the POU export (<block typeName="EXECUTE"> + <STCode>), passing the strict Validate gate —
        // not refused. So an Execute box is editable, not read-only.
        var read = new FakeCodeStore { Lang = "FBD", Xml = Pou(ExecuteBoxBody, withIface: false), Decl = "PROGRAM P\nVAR\nEND_VAR" };
        var vg = GraphicalCode.Read(read, Item, ItemName)!.Body;
        var write = new FakeCodeStore { Lang = "FBD", Xml = Pou(ExecuteBoxBody, withIface: true) };
        GraphicalCode.Write(write, Item, ItemName, vg, "PROGRAM P\nVAR\nEND_VAR");
        Assert.NotNull(write.WrittenXml);
        Assert.Contains("typeName=\"EXECUTE\"", write.WrittenXml!);   // the box is reconstructed
        Assert.Contains("target := 42;", write.WrittenXml!);         // …with its STCode
    }

    [Fact]
    public void Declaration_falls_to_the_textual_aspect_when_the_export_omits_it()
    {
        var s = new FakeCodeStore { Lang = "FBD", Xml = Pou(FbdBody, withIface: false), Decl = "FUNCTION_BLOCK T\nVAR\n\ta : BOOL;\nEND_VAR" };
        Assert.Equal("FUNCTION_BLOCK T\nVAR\n\ta : BOOL;\nEND_VAR", GraphicalCode.Read(s, Item, ItemName)!.Declaration);
    }

    [Fact]
    public void Graphical_language_but_no_fbd_body_throws_not_a_silent_marker()
    {
        var s = new FakeCodeStore { Lang = "FBD", Xml = Pou("<ST>x:=1;</ST>", withIface: true) };
        Assert.Throws<InvalidOperationException>(() => GraphicalCode.Read(s, Item, ItemName));
    }

    [Fact]
    public void Write_refuses_an_unknown_graphical_language_with_a_clear_message()
    {
        // A3: a bad language token is rejected BEFORE the IDE import, with a clear message — not downstream
        // with a misleading "not writable". The guard fires before ReadXml, so the store needn't be valid.
        var s = new FakeCodeStore { Lang = "FBD", Xml = Pou(FbdBody, withIface: false) };
        var ex = Assert.Throws<InvalidOperationException>(() => GraphicalCode.Write(
            s, Item, ItemName, "NETWORK 0 BANANA\n  LET i1 := a;\n  q := i1;\nEND_NETWORK\n",
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
        var nonCanonical = "NETWORK 0 FBD\n"
            + "  LET i1 := a;\n  LET i2 := b;\n  LET gX := (i1 AND i2);\n  out := gX;\nEND_NETWORK\n";
        var ex = Assert.Throws<VgParseException>(() =>
            GraphicalCode.Write(s, Item, ItemName, nonCanonical, "FUNCTION_BLOCK FB\nVAR\nEND_VAR"));
        Assert.Equal("VG_NOT_CANONICAL", ex.Code);          // structured diagnostic
        Assert.NotNull(ex.Line);                            // names the first differing line
        Assert.Contains("out := (a AND b)", ex.Message);    // the writer's readable canonical form is shown verbatim
    }

    [Fact]
    public void A_failed_export_propagates_never_an_empty_marker()
    {
        var s = new FakeCodeStore { Lang = "FBD", ThrowOnReadXml = true };
        Assert.Throws<InvalidOperationException>(() => GraphicalCode.Read(s, Item, ItemName));
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

        GraphicalCode.Write(s, Item, ItemName, vg, decl);

        Assert.NotNull(s.WrittenXml);
        Assert.DoesNotContain("old", s.WrittenXml!);                       // old body gone
        Assert.Contains("<expression>x</expression>", s.WrittenXml!);      // edited body in
        Assert.Equal("FUNCTION_BLOCK FB_Old\nVAR\n\tz : BOOL;\nEND_VAR",   // interface untouched
                     Volt.Engine.Graphical.PlcOpenDocument.DeclFromExport(s.WrittenXml!, ItemName));
    }
}

/// <summary>A minimal in-memory <see cref="ICodeStore"/>: only the members <see cref="GraphicalCode"/>
/// uses do anything; the rest throw (never reached on the graphical path).</summary>
internal sealed class FakeCodeStore : ICodeStore
{
    // The graphical path never consults it (GraphicalCode owns the PLCopen write for a VG body), so false is the
    // honest answer here, not a stub for a capability this fake has.
    public bool WritesPouAsOneDocument => false;
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
    public void WriteText(ItemRef item, string? declaration, string implementation) => throw new NotSupportedException();
    public string ReadManifest(ItemRef item, string kind) => throw new NotSupportedException();
}
