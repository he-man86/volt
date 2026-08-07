using System.IO;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Graphical;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// The WRITE splice (`pou-writes-via-plcopen` §2): editing an item's existing export instead of generating a
/// document.
/// <para>Every case runs against a RECORDED vendor export, not synthetic XML — so the shapes under test are
/// CODESYS's and TwinCAT's, not ones I invented to match my own code. That distinction has mattered repeatedly:
/// the hand-built interface document in the CODESYS driver matched no real export, and the parser's
/// "TC-only" fallback turned out to be what CODESYS emits too.</para>
/// </summary>
public class PlcOpenSpliceTests
{
    private static string Fixture(params string[] parts) =>
        File.ReadAllText(Path.Combine(new[] { System.AppContext.BaseDirectory, "fixtures" }.Concat(parts).ToArray()));

    private static string CodesysPou => Fixture("corpus", "PLC_PRG.st.plcopen.xml");   // ST body + plaintext decl
    private static string TwincatPou => Fixture("tc-fbd", "PLC_PRG_jump_sr.plcopen.xml"); // FBD body + an action

    // ── 2.5, first: the property everything else depends on ─────────────────────────────────────────

    /// <summary>A splice that changes NOTHING must return the document unchanged. This is the guard on the whole
    /// approach: the justification for editing the export rather than regenerating it is that attributes,
    /// pragmas, object ids and vendor addData survive — which only holds if the splice leaves untouched bytes
    /// untouched.</summary>
    [Theory]
    [InlineData("corpus", "PLC_PRG.st.plcopen.xml", "PLC_PRG")]
    [InlineData("corpus", "MAIN.plcopen.xml", "MAIN")]
    public void A_no_op_declaration_write_changes_nothing(string dir, string file, string item)
    {
        var xml = Fixture(dir, file);
        var same = PlcOpenDocument.SetDeclaration(xml, item, PlcOpenDocument.DeclFromExport(xml, item)!);
        Assert.Equal(Canon(xml), Canon(same));
    }

    [Fact]
    public void A_no_op_body_write_changes_nothing()
    {
        var xml = CodesysPou;
        var body = PlcOpenPouParser.Parse(xml).BodyElement!.Value;
        Assert.Equal(Canon(xml), Canon(PlcOpenDocument.SetTextualBody(xml, "PLC_PRG", body)));
    }

    // ── 2.1 declaration ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void The_declaration_can_be_written_and_read_back()
    {
        const string decl = "PROGRAM PLC_PRG\nVAR\n\tspliced : INT := 7;\nEND_VAR";
        var outXml = PlcOpenDocument.SetDeclaration(CodesysPou, "PLC_PRG", decl);
        Assert.Equal(decl, PlcOpenDocument.DeclFromExport(outXml, "PLC_PRG"));
        Assert.Equal(decl, PlcOpenPouParser.Parse(outXml).Declaration);   // and through the production reader
    }

    /// <summary>The TwinCAT export carries a plaintext block too — the claim that it "carries no plaintext
    /// interface at all" was false, and this is what lets one splice serve both vendors.</summary>
    [Fact]
    public void The_declaration_write_works_on_a_twincat_export_too()
    {
        const string decl = "PROGRAM PLC_PRG\nVAR\n\tfromTwincat : BOOL;\nEND_VAR";
        var outXml = PlcOpenDocument.SetDeclaration(TwincatPou, "PLC_PRG", decl);
        Assert.Equal(decl, PlcOpenDocument.DeclFromExport(outXml, "PLC_PRG"));
    }

    /// <summary>Writing a declaration to an item that is not in the document must THROW. A write that silently
    /// hits nothing is the exact failure mode this change exists to remove.</summary>
    [Fact]
    public void Writing_a_declaration_for_an_absent_item_throws()
    {
        var ex = Assert.Throws<System.InvalidOperationException>(
            () => PlcOpenDocument.SetDeclaration(CodesysPou, "NoSuchPou", "PROGRAM X\nVAR\nEND_VAR"));
        Assert.Contains("NoSuchPou", ex.Message);
    }

    // ── 2.2 textual body ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void The_textual_body_can_be_written_and_read_back()
    {
        const string body = "x := 42;\nIF x > 0 THEN\n\tx := 0;\nEND_IF";
        var outXml = PlcOpenDocument.SetTextualBody(CodesysPou, "PLC_PRG", body);
        Assert.Equal(body, PlcOpenPouParser.Parse(outXml).BodyElement!.Value);
        Assert.Equal("ST", PlcOpenPouParser.Parse(outXml).BodyLanguage);
    }

    /// <summary>The declaration must survive a body write and vice versa — they are separate splices into the
    /// same document, and a push does both.</summary>
    [Fact]
    public void Writing_the_body_leaves_the_declaration_alone_and_vice_versa()
    {
        var decl = PlcOpenDocument.DeclFromExport(CodesysPou, "PLC_PRG")!;
        var afterBody = PlcOpenDocument.SetTextualBody(CodesysPou, "PLC_PRG", "y := 1;");
        Assert.Equal(decl, PlcOpenDocument.DeclFromExport(afterBody, "PLC_PRG"));

        var afterBoth = PlcOpenDocument.SetDeclaration(afterBody, "PLC_PRG", "PROGRAM PLC_PRG\nVAR\n\ty : INT;\nEND_VAR");
        Assert.Equal("y := 1;", PlcOpenPouParser.Parse(afterBoth).BodyElement!.Value);
    }

    /// <summary>A textual write onto a GRAPHICAL body must refuse. Flattening one is the data-loss bug the live
    /// body-format guard already refuses; the splice must not become a second way to do it.</summary>
    [Fact]
    public void A_textual_body_write_refuses_to_flatten_a_graphical_body()
    {
        var ex = Assert.Throws<System.InvalidOperationException>(
            () => PlcOpenDocument.SetTextualBody(TwincatPou, "ACT_FBD", "x := 1;"));
        Assert.Contains("FBD", ex.Message);
        Assert.Contains("flatten", ex.Message);
    }

    // ── scoping: the bug class that produced three data-loss defects ────────────────────────────────

    /// <summary>A write names an ITEM, and the export describes several. Writing the enclosing POU must not
    /// touch its action, and writing the action must not touch the POU.</summary>
    [Fact]
    public void A_write_is_scoped_to_the_named_item_not_the_first_match()
    {
        // The TwinCAT fixture is a POU whose graphical body belongs to its ACTION; the POU's own body is ST.
        var beforeAction = PlcOpenDocument.FindFbdLdBody(TwincatPou, "ACT_FBD")!.ToString();

        var outXml = PlcOpenDocument.SetTextualBody(TwincatPou, "PLC_PRG", "poubody := 1;");

        Assert.Equal("poubody := 1;", PlcOpenPouParser.Parse(outXml).BodyElement!.Value);      // the POU took it
        Assert.Equal(beforeAction, PlcOpenDocument.FindFbdLdBody(outXml, "ACT_FBD")!.ToString()); // action untouched
    }

    /// <summary>Normalise only what a serializer may legitimately move: line endings and inter-element
    /// whitespace. Anything else differing is a real change.</summary>
    private static string Canon(string xml) =>
        XDocument.Parse(xml).ToString(SaveOptions.DisableFormatting).Replace("\r\n", "\n");
}
