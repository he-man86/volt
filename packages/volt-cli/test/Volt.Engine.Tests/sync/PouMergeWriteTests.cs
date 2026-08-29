using System.Linq;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Sync;
using Volt.Engine.Format.Body;
using Volt.Engine.Item;

namespace Volt.Cli.Tests;

/// <summary>The single-document POU write (`pou-writes-via-plcopen` §3.1): a POU's declaration, body, children and
/// accessors go to the IDE as ONE merged PLCopen import instead of a root write plus a write per child plus an
/// orphan-deletion walk.
/// <para>These are the OFFLINE half of the gate — that the push issues the right CALLS. What the IDE then does
/// with the document was measured live (see §3.1) and is re-checked by the e2e suite; a fake cannot answer it, and
/// a fake that pretended to would assert the behaviour away.</para></summary>
public class PouMergeWriteTests
{
    private static FakeIde Fb(string childFolder = "") =>
        new FakeIde(
            new FakeIde.Item("FB_Test", ItemKind.PlcPouFb, "", true,
                "FUNCTION_BLOCK FB_Test\nVAR\n\tn : INT;\nEND_VAR", "n := n + 1;", null, null,
                Children: new[] { "DoIt" }),
            new FakeIde.Item("DoIt", ItemKind.PlcMethod, childFolder, false,
                "METHOD DoIt : BOOL", "DoIt := TRUE;", null, null))
        ;

    // Canonical workspace ST, in StWriter's layout: the POU's own END keyword precedes its children.
    private static string Source(string body, string childBody, string? childFolder = null)
    {
        var folder = childFolder is null ? "" : $"%FOLDER {childFolder}\n";
        return $"FUNCTION_BLOCK FB_Test\nVAR\n\tn : INT;\nEND_VAR\n\n{body}\n\nEND_FUNCTION_BLOCK\n\n" +
               $"METHOD DoIt : BOOL\n{folder}{childBody}\nEND_METHOD\n";
    }

    private static PushResponse Push(FakeIde ide, string src)
    {
        var refs = RefsService.Handle(ide);
        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new() { new SetItemOp { Name = "FB_Test.fb", IfVersion = refs.Items["FB_Test.fb"], SourceText = src } },
        });
        // A rejection here is a test-setup bug 9 times in 10 — surface WHY instead of a bare "expected True".
        Assert.True(resp.Accepted,
            "push rejected: " + string.Join("; ", resp.Conflicts?.Select(c => $"{c.Name}: {c.Reason}") ?? new[] { "<none>" }));
        return resp;
    }

    /// <summary>The whole write is ONE WriteXml. No per-child WriteText, no CreateChild, no orphan Delete — those
    /// three calls ARE the seam every data-loss bug in this bridge lived in.</summary>
    [Fact]
    public void A_pou_update_is_one_document_write()
    {
        var ide = Fb();
        Push(ide, Source("n := n + 2;", "DoIt := FALSE;"));

        Assert.Equal(new[] { "writecontent:FB_Test" }, ide.Recorded.Where(r => !r.StartsWith("walk")).ToArray());
        Assert.Contains("n := n + 2;", FakeIde.AllText(ide.WrittenContent["FB_Test"]));
        Assert.Contains("DoIt := FALSE;", FakeIde.AllText(ide.WrittenContent["FB_Test"]));
    }

    /// <summary>A child carrying a <c>%FOLDER</c> reaches the driver WITH its folder.
    ///
    /// <para>This asserted a <c>Move</c> after the write, because PLCopen carries no folder membership: its
    /// import FLATTENED a POU's internal folders (measured live on <c>FB_FolderChild</c>) and the engine
    /// re-placed every child afterwards from the pushed source, or the engineer's method organisation was
    /// silently destroyed on every push. Nothing flattens them now — the folder rides on the member and the
    /// driver places it — so what the engine owes is that the folder ARRIVES. The placement is a driver concern
    /// and is not observable from here.</para></summary>
    [Fact]
    public void A_foldered_child_reaches_the_driver_with_its_folder()
    {
        var ide = Fb(childFolder: "Helpers");
        Push(ide, Source("n := n + 2;", "DoIt := FALSE;", childFolder: "Helpers"));

        Assert.Contains("writecontent:FB_Test", ide.Recorded);
        var child = Assert.Single(ide.WrittenContent["FB_Test"].Members, m => m.Name == "DoIt");
        Assert.Equal("Helpers", child.Folder);
    }

    /// <summary>EVERY foldered child arrives with its folder, not only the first.
    ///
    /// <para>The defect this was written for was in the re-placement loop: it hoisted the POU lookup out of the
    /// loop, and on a driver whose move invalidates every handle into the POU (placing a member is a round trip
    /// through the enclosing POU's own archive on TwinCAT, DIALECT D4j) the handle was dead by the second child,
    /// which was then never placed. There is no re-placement loop any more, so the stale-handle shape cannot
    /// occur. What stays checkable here is that no child loses its folder on the way through the push.</para></summary>
    [Fact]
    public void Every_foldered_child_arrives_with_its_folder()
    {
        var ide = new FakeIde(
            new FakeIde.Item("FB_Two", ItemKind.PlcPouFb, "", true,
                "FUNCTION_BLOCK FB_Two\nVAR\n\tn : INT;\nEND_VAR", "n := 1;", null, null,
                Children: new[] { "One", "Two" }),
            new FakeIde.Item("One", ItemKind.PlcMethod, "", false, "METHOD One : BOOL", "One := TRUE;", null, null),
            new FakeIde.Item("Two", ItemKind.PlcMethod, "", false, "METHOD Two : BOOL", "Two := TRUE;", null, null));

        var refs = RefsService.Handle(ide);
        var src = "FUNCTION_BLOCK FB_Two\nVAR\n\tn : INT;\nEND_VAR\n\nn := 2;\n\nEND_FUNCTION_BLOCK\n"
                + "\nMETHOD One : BOOL\n%FOLDER Helpers\nOne := TRUE;\nEND_METHOD\n"
                + "\nMETHOD Two : BOOL\n%FOLDER Helpers/Inner\nTwo := TRUE;\nEND_METHOD\n";
        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new() { new SetItemOp { Name = "FB_Two.fb", IfVersion = refs.Items["FB_Two.fb"], SourceText = src } },
        });
        Assert.True(resp.Accepted, string.Join("; ", (resp.Conflicts ?? new()).Select(c => c.Reason)));

        var members = ide.WrittenContent["FB_Two"].Members;
        Assert.Equal("Helpers", Assert.Single(members, m => m.Name == "One").Folder);
        Assert.Equal("Helpers/Inner", Assert.Single(members, m => m.Name == "Two").Folder);
    }

    /// <summary>A child with NO folder is never moved. A blanket "re-place everything" would drag every root-level
    /// method into a folder that was never asked for.</summary>
    [Fact]
    public void A_child_at_the_pou_root_is_not_moved()
    {
        var ide = Fb();
        Push(ide, Source("n := n + 2;", "DoIt := FALSE;"));
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("move:"));
    }

    // ── create and move ─────────────────────────────────────────────────────────────────────────────

    private static PushResponse PushOp(FakeIde ide, SetItemOp op)
    {
        var refs = RefsService.Handle(ide);
        var resp = PushService.Handle(ide, new PushRequest { ExpectedProjectVersion = refs.ProjectVersion, Ops = new() { op } });
        Assert.True(resp.Accepted,
            "push rejected: " + string.Join("; ", resp.Conflicts?.Select(c => $"{c.Name}: {c.Reason}") ?? new[] { "<none>" }));
        return resp;
    }

    /// <summary>A CREATE is CreateChild (structure) then ONE document write — not a create followed by a WriteText
    /// followed by a CreateChild+WriteText per child. On the old path a new FB with two methods cost six COM
    /// writes; this is the seam the whole change exists to remove, and create was the last place it survived.
    /// <para>Measured on 3.5.21.40: a just-created POU exports with an <c>InterfaceAsPlainText</c> AND a
    /// <c>body</c>, which is what makes splicing into a brand-new item possible at all.</para></summary>
    [Fact]
    public void A_create_is_one_CreateChild_plus_one_document_write_plus_one_declaration()
    {
        var ide = new FakeIde();
        PushOp(ide, new SetItemOp
        {
            Name = "FB_New.fb",
            SourceText = "FUNCTION_BLOCK FB_New\nVAR\n\tn : INT;\nEND_VAR\n\nn := 1;\n\nEND_FUNCTION_BLOCK\n\n"
                       + "METHOD First : BOOL\nFirst := TRUE;\nEND_METHOD\n\nMETHOD Second : BOOL\nSecond := FALSE;\nEND_METHOD\n",
        });

        // One CreateChild per member, then ONE content write. The members used to arrive inside the
        // document, so this was two calls flat; see the cost note in TransportMatrixTests.
        Assert.Equal(new[] { "create:FB_New", "create:First", "create:Second", "writecontent:FB_New" },
                     ide.Recorded.ToArray());
        var doc = FakeIde.AllText(ide.WrittenContent["FB_New"]);
        Assert.Contains("First", doc);
        Assert.Contains("Second", doc);
    }

    /// <summary>A create ESTABLISHES the body language — the guard that protects an engineer's diagram must not
    /// fire against the seed the same push just laid down.
    /// <para>`CreateChild` is handed the pushed language, and TwinCAT REFUSES "LD" (DIALECT C6), so it creates FBD
    /// and carries the ladder view as archive metadata. The document then shows an empty <c>&lt;FBD/&gt;</c>, which
    /// by content reads as "made graphical on purpose" — and the splice refused the very LD body it was creating:
    /// *has a FBD body in the IDE but the push carries LD*. Volt refusing a Volt decision, one line after making
    /// it, and it failed every LD create on that vendor.</para></summary>
    [Fact]
    public void A_create_establishes_the_body_language_over_the_seed_CreateChild_laid_down()
    {
        var ide = new FakeIde();
        PushOp(ide, new SetItemOp { Name = "VG_New.prg", SourceText = "PROGRAM VG_New\nVAR\n  c : BOOL;\n  y : BOOL;\nEND_VAR\n\nNETWORK 1 LD\n  y := c;\nEND_NETWORK\n\nEND_PROGRAM\n" });

        Assert.Contains("NETWORK 1 LD", FakeIde.AllText(ide.WrittenContent["VG_New"]));
    }

    /// <summary>A MOVE is one <c>Move</c> — the item is never read, deleted or rebuilt, so there is no window in
    /// which it does not exist and nothing to lose. It used to be a full delete-and-recreate.</summary>
    [Fact]
    public void A_pure_move_relocates_the_item_instead_of_recreating_it()
    {
        var ide = Fb();
        var refs = RefsService.Handle(ide);
        PushOp(ide, new SetItemOp { Name = "FB_Test.fb", IfVersion = refs.Items["FB_Test.fb"], ToFolder = "Motors" });

        Assert.Contains("move:FB_Test->Motors", ide.Recorded);
        // `create:Motors` IS expected — the destination folder is resolved-or-created. What must not appear is a
        // delete or a re-create of the ITEM, which is what the old move did.
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("delete:") || r == "create:FB_Test");
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("write"));   // a pure move writes no content at all
    }

    /// <summary>A move that also EDITS relocates first, then takes the ordinary in-place document write — one
    /// move plus one import, still no delete.</summary>
    [Fact]
    public void A_move_with_an_edit_is_a_move_plus_one_document_write()
    {
        var ide = Fb();
        var refs = RefsService.Handle(ide);
        PushOp(ide, new SetItemOp
        {
            Name = "FB_Test.fb",
            IfVersion = refs.Items["FB_Test.fb"],
            ToFolder = "Motors",
            SourceText = Source("n := n + 9;", "DoIt := FALSE;"),
        });

        Assert.Contains("move:FB_Test->Motors", ide.Recorded);
        Assert.Contains("writecontent:FB_Test", ide.Recorded);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("delete:"));
        Assert.Contains("n := n + 9;", FakeIde.AllText(ide.WrittenContent["FB_Test"]));
    }

    /// <summary>A move is a MOVE on every driver — with or without the single-document capability, which is a
    /// separate question about the CONTENT write.
    /// <para>This replaces a test that pinned the delete-and-recreate arm for "a driver without a move". There is
    /// no such driver: <c>IProjectTree.Move</c> is a required member and both vendors implement it (CODESYS's
    /// scripting object has one; TwinCAT's is its export/import archive with the entry paths flattened, DIALECT
    /// D4f). The arm it pinned was also strictly worse: it REFUSED a graphical move outright, because a diagram
    /// cannot be rebuilt from text.</para></summary>
    [Fact]
    public void A_move_relocates_the_item_rather_than_recreating_it()
    {
        var ide = Fb();
        var refs = RefsService.Handle(ide);
        PushOp(ide, new SetItemOp { Name = "FB_Test.fb", IfVersion = refs.Items["FB_Test.fb"], ToFolder = "Motors" });

        Assert.Contains("move:FB_Test->Motors", ide.Recorded);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("delete:"));
    }

    /// <summary>A member whose KIND changes is deleted and RECREATED, not written through.
    ///
    /// <para>THE BUG (audit, 2026-08-29): `have`/`want` are keyed on NAME alone, so `PROPERTY Ready` becoming
    /// `METHOD Ready` was neither created nor deleted. The method's declaration went into the property's
    /// Interface aspect, its body went to an Implementation aspect a property does not have (a silent no-op on
    /// CODESYS), and the old GET/SET stayed compiled in. BodyFormatGuard cannot see it - both shapes are
    /// Textual.</para></summary>
    [Fact]
    public void A_member_whose_kind_changes_is_deleted_and_recreated()
    {
        var ide = new FakeIde(
            new FakeIde.Item("FB_K", ItemKind.PlcPouFb, "", true,
                "FUNCTION_BLOCK FB_K\nVAR\n\tx : INT;\nEND_VAR", "x := 1;", null, null,
                Children: new[] { "Ready" }),
            new FakeIde.Item("Ready", ItemKind.PlcProp, "", false, "PROPERTY Ready : INT", null, null, null));

        var refs = RefsService.Handle(ide);
        var src = "FUNCTION_BLOCK FB_K\nVAR\n\tx : INT;\nEND_VAR\n\nx := 1;\n\nEND_FUNCTION_BLOCK\n"
                + "\nMETHOD Ready : INT\nReady := x;\nEND_METHOD\n";
        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new() { new SetItemOp { Name = "FB_K.fb", IfVersion = refs.Items["FB_K.fb"], SourceText = src } },
        });

        Assert.True(resp.Accepted, string.Join("; ", (resp.Conflicts ?? new()).Select(c => c.Reason)));
        Assert.Contains("delete:Ready", ide.Recorded);
        Assert.Contains("create:Ready", ide.Recorded);
        Assert.True(ide.Recorded.IndexOf("delete:Ready") < ide.Recorded.IndexOf("create:Ready"),
                    "the delete must come FIRST - a create already committed when a later delete throws leaves "
                    + "the project mutated under a rejected push");
    }

    /// <summary>Deletes run before creates, so a throw in either cannot half-apply a push.</summary>
    [Fact]
    public void A_removed_member_is_deleted_before_any_member_is_created()
    {
        var ide = new FakeIde(
            new FakeIde.Item("FB_D", ItemKind.PlcPouFb, "", true,
                "FUNCTION_BLOCK FB_D\nVAR\n\tx : INT;\nEND_VAR", "x := 1;", null, null,
                Children: new[] { "Gone" }),
            new FakeIde.Item("Gone", ItemKind.PlcMethod, "", false, "METHOD Gone : BOOL", "Gone := TRUE;", null, null));

        var refs = RefsService.Handle(ide);
        var src = "FUNCTION_BLOCK FB_D\nVAR\n\tx : INT;\nEND_VAR\n\nx := 1;\n\nEND_FUNCTION_BLOCK\n"
                + "\nMETHOD Fresh : BOOL\nFresh := TRUE;\nEND_METHOD\n";
        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new() { new SetItemOp { Name = "FB_D.fb", IfVersion = refs.Items["FB_D.fb"], SourceText = src } },
        });

        Assert.True(resp.Accepted, string.Join("; ", (resp.Conflicts ?? new()).Select(c => c.Reason)));
        Assert.True(ide.Recorded.IndexOf("delete:Gone") < ide.Recorded.IndexOf("create:Fresh"));
    }
}
