using System.Collections.Generic;
using System.IO;
using System.Linq;
using Volt.Engine.Graphical;
using Volt.Engine.Sync;
using Volt.Engine.Workspace;
using Volt.Engine.Workspace.SourceText;
using Xunit;
using Volt.Engine.PlcOpen;

namespace Volt.Cli.Tests;

/// <summary>
/// <see cref="PouDocument.Splice"/> (`pou-writes-via-plcopen` §3.1): the ONE document a POU write travels in.
/// <para>Every case runs against a RECORDED CODESYS export, so the shape under test is the IDE's, not one written
/// to match this code. Two of the fixtures could only be authored by hand in the IDE — `FB_GraphicalChild` has a
/// CFC method child (CFC is read-only, so no test can create one) and `FB_FolderChild` has an action that lived
/// in a folder.</para>
/// <para>What these pin is the CONTRACT the live gate then confirms: the document carries child add, update and
/// remove, and it never rewrites bytes it was not asked to.</para>
/// </summary>
public class PouDocumentTests
{
    private static string Fixture(string file) =>
        File.ReadAllText(Path.Combine(System.AppContext.BaseDirectory, "fixtures", "codesys-pou", file));

    private static StSplitter.StSplitResult Split(string decl, string impl, params StSplitter.StChild[] children) =>
        new(ItemKind.Kinds.FunctionBlock, decl, impl, children.ToList());

    private const string FbDecl = "FUNCTION_BLOCK FB_FolderChild\nVAR_INPUT\nEND_VAR\nVAR_OUTPUT\nEND_VAR\nVAR\nEND_VAR\n";

    private static StSplitter.StChild Action(string name, string body, string? folder = null) =>
        new(ItemKind.Kinds.Action, name, "", body, Folder: folder);

    // ── the whole point: one document, all four child operations ───────────────────────────────────

    /// <summary>An existing child is UPDATED in place — not removed and re-added. The distinction is not cosmetic:
    /// a remove+add would drop everything about the child the splice does not model.</summary>
    [Fact]
    public void An_existing_child_is_updated_in_place()
    {
        var doc = PouDocument.Splice(Fixture("FB_FolderChild.plcopen.xml"), "FB_FolderChild",
            Split(FbDecl, "//body", Action("ACT", "//new action body")));

        var parsed = PouReader.Parse(doc);
        Assert.Equal(new[] { "ACT" }, parsed.Children.Select(c => c.Name));
        Assert.Contains("//new action body", doc);
        Assert.DoesNotContain("//test action", doc);
    }

    /// <summary>A child in the push but NOT in the document is ADDED. Measured live: the merge import creates it.</summary>
    [Fact]
    public void A_child_only_in_the_push_is_added()
    {
        var doc = PouDocument.Splice(Fixture("FB_FolderChild.plcopen.xml"), "FB_FolderChild",
            Split(FbDecl, "//body", Action("ACT", "//test action"), Action("Second", "//brand new")));

        var names = PouReader.Parse(doc).Children.Select(c => c.Name).OrderBy(n => n);
        Assert.Equal(new[] { "ACT", "Second" }, names);
        Assert.Contains("//brand new", doc);
    }

    /// <summary>A child in the document but NOT in the push is REMOVED — this is what replaced the COM orphan
    /// walk. It is the case that silently diverged the workspace from the IDE when it was missing.</summary>
    [Fact]
    public void A_child_dropped_from_the_push_is_removed()
    {
        var doc = PouDocument.Splice(Fixture("FB_FolderChild.plcopen.xml"), "FB_FolderChild",
            Split(FbDecl, "//body"));

        Assert.Empty(PouReader.Parse(doc).Children);
        Assert.DoesNotContain("//test action", doc);
    }

    /// <summary>The declaration and the body both land, in the item's OWN elements.</summary>
    [Fact]
    public void The_root_declaration_and_body_land()
    {
        var decl = FbDecl.Replace("VAR\nEND_VAR", "VAR\n\tbFlag : BOOL;\nEND_VAR");
        var doc = PouDocument.Splice(Fixture("FB_FolderChild.plcopen.xml"), "FB_FolderChild",
            Split(decl, "//rewritten body", Action("ACT", "//test action")));

        var parsed = PouReader.Parse(doc);
        Assert.Contains("bFlag : BOOL;", parsed.Declaration);
        Assert.Contains("//rewritten body", doc);
    }

    // ── the guarantee that makes splicing safer than regenerating ──────────────────────────────────

    /// <summary>A textual write that would land on a CFC child is REFUSED, and the refusal NAMES the child.
    /// <para>This is the first of the three data-loss bugs in its exact original shape — a read-only graphical
    /// child flattened because the write path decided from text. The refusal is what makes the flattening
    /// impossible; asserting that the bytes happen to survive would only prove the write missed.</para>
    /// <para>It was previously written the other way — pushing the child with body <c>""</c> and asserting the CFC
    /// block came back byte-identical — and it PASSED, because the guard scanned only direct <c>&lt;body&gt;</c>
    /// children and never saw the CFC nested in <c>addData</c>. A test that green-lights a write onto a read-only
    /// diagram is worse than no test.</para></summary>
    [Fact]
    public void A_textual_write_onto_a_CFC_child_is_refused()
    {
        var xml = Fixture("FB_GraphicalChild.plcopen.xml");
        Assert.NotEmpty(Cfc(xml));   // the fixture really does carry one — else this test proves nothing

        var ex = Assert.Throws<System.InvalidOperationException>(() => PouDocument.Splice(xml, "FB_GraphicalChild",
            Split("FUNCTION_BLOCK FB_GraphicalChild\nVAR_INPUT\nEND_VAR\nVAR_OUTPUT\nEND_VAR\nVAR\nEND_VAR\n",
                  "//new parent body",
                  new StSplitter.StChild(ItemKind.Kinds.Method, "doSomething",
                      "METHOD doSomething : BOOL\nVAR_INPUT\nEND_VAR\n", ""))));

        Assert.Contains("doSomething", ex.Message);
        Assert.Contains("CFC", ex.Message);
    }

    /// <summary>A no-op splice returns the document UNCHANGED — the property the whole approach rests on. If a
    /// write moves bytes it was not asked to move, "attributes and pragmas survive" is only probably true.</summary>
    [Fact]
    public void A_no_op_splice_changes_nothing()
    {
        var xml = Fixture("FB_FolderChild.plcopen.xml");
        var doc = PouDocument.Splice(xml, "FB_FolderChild",
            Split(FbDecl, "//this is the body - for test\n", Action("ACT", "//test action\n")));

        Assert.Equal(xml, doc);
    }

    /// <summary>REGRESSION, found by the live gate: once a POU declares any variable, CODESYS exports its
    /// declaration TWICE — once inside the typed <c>&lt;interface&gt;</c>'s addData, once in the item's own
    /// trailing addData. The splice wrote only the FIRST, which is the nested one, so a declaration change was
    /// accepted and silently did nothing: a deleted FB's instance stayed in PLC_PRG and the project stopped
    /// compiling. Every offline fixture until this one had an EMPTY interface and therefore ONE copy, which is
    /// exactly why nothing caught it.</summary>
    [Fact]
    public void A_declaration_write_updates_every_copy_of_the_declaration()
    {
        var xml = Fixture("FB_TwoDeclCopies.plcopen.xml");
        Assert.Equal(2, Copies(xml, "bProbe : BOOL;"));   // the fixture really does carry two — else this proves nothing

        // Straight at SetDeclaration, not through Splice: this fixture also carries the CFC method child, and a
        // whole-POU splice is (correctly) refused because of it. The invariant under test is the declaration
        // write, so drive that member directly rather than weakening the CFC refusal to reach it.
        var without = "FUNCTION_BLOCK FB_GraphicalChild\nVAR_INPUT\nEND_VAR\nVAR_OUTPUT\nEND_VAR\nVAR\nEND_VAR\n";
        var doc = PouSplice.SetDeclaration(xml, "FB_GraphicalChild", without);

        Assert.Equal(0, Copies(doc, "bProbe : BOOL;"));
    }

    private static int Copies(string xml, string needle)
    {
        int n = 0, i = 0;
        while ((i = xml.IndexOf(needle, i, System.StringComparison.Ordinal)) >= 0) { n++; i += needle.Length; }
        return n;
    }

    private static string Cfc(string xml)
    {
        var a = xml.IndexOf("<CFC>", System.StringComparison.Ordinal);
        var b = xml.IndexOf("</CFC>", System.StringComparison.Ordinal);
        return a >= 0 && b > a ? xml.Substring(a, b - a) : "";
    }
}
