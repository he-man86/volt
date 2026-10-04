using System.Collections.Generic;
using System.Linq;
using Xunit;
using Xunit.Abstractions;
using Volt.Contracts;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// A REJECTED push must leave the project untouched.
///
/// <para><c>MoveItem</c> already learned this, and says so: "It used to move first, which meant a rejected
/// move+edit left the item ALREADY RELOCATED … the push reported failure while the project had quietly
/// half-changed, and nothing put it back." The fix was to write the content first, because the write is the step
/// that can refuse.</para>
///
/// <para>The RENAME in the same method never got that treatment. It runs before everything —
/// <c>ide.Rename(item, toName)</c> — and a native rename is not a small change: it rewrites the item's header on
/// both vendors and, on TwinCAT, every reference to that POU across the project (DIALECT C2o, C2p). So a rename+edit
/// whose edit is refused left the item renamed (and its call sites rewritten), and the push reporting rejected. Nothing put that back either.</para>
///
/// <para>Same bug, same method, one arm fixed and the other not — which is the shape half these findings share.</para>
/// </summary>
public class RenameBeforeWriteTests
{
    private readonly ITestOutputHelper _out;
    public RenameBeforeWriteTests(ITestOutputHelper o) => _out = o;

    /// <summary>An ordinary, perfectly readable POU. The refusal comes from the PUSHED TEXT rather than the
    /// item's state — malformed network text, which the network text gate rejects before the write.
    /// <para>Deliberate: an unreadable item is isolated out of `/refs` by design, so it has no version to push
    /// against. Using a real guard on a normal item is also the stronger test — this is the shape an engineer
    /// actually hits, a rename plus an edit that turns out not to parse.</para></summary>
    private static FakeIde WithPlainPou() => new FakeIde(
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"),
        FakeIde.Item.TextualPou("FB_Draw", "PROGRAM FB_Draw\nVAR\nEND_VAR", "y := 1;"));

    /// <summary>A body that parses as graphical and then fails validation — the network is never closed.</summary>
    private const string MalformedBody =
        "PROGRAM FB_Renamed\nVAR\nEND_VAR\nIMPLEMENTATION LD\nNETWORK\n  out := (a AND b);\nEND_PROGRAM\n";

    [Fact]
    public void A_rename_whose_edit_is_refused_does_not_rename()
    {
        var ide = WithPlainPou();
        var refs = RefsService.Handle(ide);
        var before = refs.Items.Keys.OrderBy(k => k).ToList();
        _out.WriteLine($"before: [{string.Join(", ", before)}]");

        var res = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp
                {
                    Name = "FB_Draw.pou",
                    ToName = "FB_Renamed.pou",
                    SourceText = MalformedBody,
                    IfVersion = refs.Items["FB_Draw.pou"],
                },
            },
        });

        _out.WriteLine($"accepted={res.Accepted}");
        _out.WriteLine($"recorded: {string.Join(", ", ide.Recorded)}");

        // The push was refused…
        Assert.False(res.Accepted);
        // …so nothing may have been renamed. A native rename on TwinCAT rewrites every call site in the project; leaving one
        // behind after a rejected push is a half-applied change nothing puts back.
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("rename:", System.StringComparison.Ordinal));
        Assert.Equal(before, RefsService.Handle(ide).Items.Keys.OrderBy(k => k).ToList());
    }

    /// <summary>A rename whose edit SUCCEEDS still renames — so the fix cannot be "stop renaming".</summary>
    [Fact]
    public void A_rename_with_a_writable_body_still_renames()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"),
            FakeIde.Item.TextualPou("FB_Old", "PROGRAM FB_Old\nVAR\nEND_VAR", "y := 1;"));
        var refs = RefsService.Handle(ide);

        var res = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp
                {
                    Name = "FB_Old.pou",
                    ToName = "FB_New.pou",
                    SourceText = "PROGRAM FB_New\nVAR\nEND_VAR\nIMPLEMENTATION ST\ny := 2;\nEND_PROGRAM\n",
                    IfVersion = refs.Items["FB_Old.pou"],
                },
            },
        });

        Assert.True(res.Accepted, "a rename+edit was refused: " + res.Conflicts?.FirstOrDefault()?.Reason);
        Assert.Contains(ide.Recorded, r => r.StartsWith("rename:", System.StringComparison.Ordinal));
        Assert.Contains("FB_New.pou", RefsService.Handle(ide).Items.Keys);
    }

    /// <summary>THE RENAME'S OWN HEADER REWRITE IS NOT A CONCURRENT EDIT. Measured live 2026-10-04 (CODESYS SP21,
    /// openspec <c>push-partially-applied-flag</c> 3.1): <c>set VltE2E_pb_rnC.pou → VltE2E_pb_rnD.pou</c> with its
    /// version and an otherwise unchanged text answered <c>STALE_ITEM_VERSION</c> "'VltE2E_pb_rnD' changed in the IDE
    /// while this push was being applied" — after the rename had run, and stayed. The last-moment check compared the
    /// client's PRE-rename version with the item AFTER the native rename, which rewrote its header. So every rename+edit
    /// of a POU (`volt push` sends one for a renamed-and-edited file) was refused and left the item renamed.</summary>
    [Fact]
    public void A_rename_and_edit_lands_although_the_rename_rewrote_the_items_own_header()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("FB_Old", "FUNCTION_BLOCK FB_Old\nVAR\nEND_VAR", "y := 1;"));
        var refs = RefsService.Handle(ide);

        var res = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp
                {
                    Name = "FB_Old.pou",
                    ToName = "FB_New.pou",
                    SourceText = "FUNCTION_BLOCK FB_New\nVAR\nEND_VAR\nIMPLEMENTATION ST\ny := 1;\nEND_FUNCTION_BLOCK\n",
                    IfVersion = refs.Items["FB_Old.pou"],
                },
            },
        });

        Assert.True(res.Accepted, "a rename+edit was refused: " + res.Conflicts?.FirstOrDefault()?.Reason);
        Assert.Null(res.Conflicts);
        var after = RefsService.Handle(ide).Items;
        Assert.Contains("FB_New.pou", after.Keys);
        Assert.DoesNotContain("FB_Old.pou", after.Keys);
    }

    /// <summary>The last-moment check still guards a rename+edit — and now BEFORE the rename: an item the engineer edited
    /// in the IDE after the pre-apply walk is refused <c>STALE_ITEM_VERSION</c> and is NOT renamed (a native rename
    /// rewrites every call site; it ran, and stayed, before the check refused the op).</summary>
    [Fact]
    public void A_rename_and_edit_of_an_item_edited_in_the_IDE_meanwhile_is_refused_before_the_rename()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("FB_Old", "FUNCTION_BLOCK FB_Old\nVAR\nEND_VAR", "y := 1;"));
        var refs = RefsService.Handle(ide);
        var reads = 0;
        ide.OnReadContent = (fake, item) =>
        {
            if (++reads != 2) return;   // the walk's read, then the apply's: the window
            fake.OnReadContent = null;
            fake.EditImplementation(fake.Name(item), "y := 999;   // the engineer's edit");
        };

        var res = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp
                {
                    Name = "FB_Old.pou",
                    ToName = "FB_New.pou",
                    SourceText = "FUNCTION_BLOCK FB_New\nVAR\nEND_VAR\nIMPLEMENTATION ST\ny := 2;\nEND_FUNCTION_BLOCK\n",
                    IfVersion = refs.Items["FB_Old.pou"],
                },
            },
        });

        Assert.False(res.Accepted);
        var conflict = Assert.Single(res.Conflicts!);
        Assert.Equal(ConflictCodes.StaleItemVersion, conflict.Code);
        Assert.Null(conflict.PartiallyApplied);
        Assert.Null(conflict.RenamedTo);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("rename:", System.StringComparison.Ordinal));
        Assert.Contains("FB_Old.pou", RefsService.Handle(ide).Items.Keys);
    }

    /// <summary>THE LAST-MOMENT CHECK GUARDS A MOVE+EDIT TOO (gate review of step 3): the pre-rename check was skipped
    /// when the op also MOVES, and <c>MoveItem</c>'s write passes no version — so an edit the engineer made in the IDE
    /// after the pre-apply walk was overwritten by the push, the item renamed and moved, and the receipt said accepted.
    /// Every shape of a set that edits an existing item is checked, and before anything of the op lands.</summary>
    [Theory]
    [InlineData("FB_New.pou", "Other")]   // rename + move + edit
    [InlineData(null, "Other")]           // move + edit
    public void A_move_and_edit_of_an_item_edited_in_the_IDE_meanwhile_is_refused_before_anything_lands(string? toName, string toFolder)
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("FB_Old", "FUNCTION_BLOCK FB_Old\nVAR\nEND_VAR", "y := 1;"));
        var refs = RefsService.Handle(ide);
        var reads = 0;
        ide.OnReadContent = (fake, item) =>
        {
            if (++reads != 2) return;   // the walk's read, then the apply's: the window
            fake.OnReadContent = null;
            fake.EditImplementation(fake.Name(item), "y := 999;   // the engineer's edit");
        };
        var header = toName is null ? "FB_Old" : "FB_New";

        var res = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp
                {
                    Name = "FB_Old.pou",
                    ToName = toName,
                    ToFolder = toFolder,
                    SourceText = $"FUNCTION_BLOCK {header}\nVAR\nEND_VAR\nIMPLEMENTATION ST\ny := 2;\nEND_FUNCTION_BLOCK\n",
                    IfVersion = refs.Items["FB_Old.pou"],
                },
            },
        });

        Assert.False(res.Accepted, "a move+edit overwrote an edit made in the IDE meanwhile");
        var conflict = Assert.Single(res.Conflicts!);
        Assert.Equal(ConflictCodes.StaleItemVersion, conflict.Code);
        Assert.Null(conflict.PartiallyApplied);
        Assert.Null(conflict.RenamedTo);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("rename:", System.StringComparison.Ordinal)
                                              || r.StartsWith("move:", System.StringComparison.Ordinal)
                                              || r.StartsWith("write", System.StringComparison.Ordinal));
        Assert.Contains("FB_Old.pou", RefsService.Handle(ide).Items.Keys);
        Assert.Contains("y := 999;", ide.ReadContent(new Volt.Engine.Item.ItemRef("FB_Old")).Body);
    }

    /// <summary>The guard's other side: a move+edit (and a rename+move+edit) WITH its version and no concurrent edit
    /// lands — the check runs once, against the item before anything of the op changed it.</summary>
    [Theory]
    [InlineData("FB_New.pou", "Other")]
    [InlineData(null, "Other")]
    public void A_move_and_edit_with_its_version_lands(string? toName, string toFolder)
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("FB_Old", "FUNCTION_BLOCK FB_Old\nVAR\nEND_VAR", "y := 1;"));
        var refs = RefsService.Handle(ide);
        var header = toName is null ? "FB_Old" : "FB_New";

        var res = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp
                {
                    Name = "FB_Old.pou",
                    ToName = toName,
                    ToFolder = toFolder,
                    SourceText = $"FUNCTION_BLOCK {header}\nVAR\nEND_VAR\nIMPLEMENTATION ST\ny := 2;\nEND_FUNCTION_BLOCK\n",
                    IfVersion = refs.Items["FB_Old.pou"],
                },
            },
        });

        Assert.True(res.Accepted, "a move+edit was refused: " + res.Conflicts?.FirstOrDefault()?.Reason);
        Assert.Contains((toName ?? "FB_Old.pou"), RefsService.Handle(ide).Items.Keys);
        Assert.Contains(ide.Recorded, r => r.StartsWith("move:", System.StringComparison.Ordinal));
    }

    /// <summary>THE FAKE'S RENAME IS THE MEASURED ONE (gate review of step 3): a native rename rewrites the item's own
    /// HEADER and nothing else of its text — a leading comment, a body comment, a FUNCTION's return assignment and a
    /// self-reference in the declaration keep the old name. Measured live 2026-10-04 on CODESYS SP21
    /// (<c>push-partially-applied.test.ts</c> "a native rename's rewrite of the item's own text"). The fake rewrote the
    /// FIRST whole-word match, so a leading comment was renamed and the header kept.</summary>
    [Fact]
    public void The_fakes_native_rename_rewrites_the_header_and_nothing_else_of_the_item()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("F_Old", "// F_Old helper\nFUNCTION F_Old : BOOL\nVAR\nEND_VAR", "// sets F_Old\nF_Old := TRUE;"),
            FakeIde.Item.TextualPou("FB_Old", "// FB_Old helper\nFUNCTION_BLOCK FB_Old\nVAR\n\tpSelf : POINTER TO FB_Old;\nEND_VAR", ";"))
        { };   // the CODESYS shape (DIALECT C2o, C2p)

        ide.Rename(new Volt.Engine.Item.ItemRef("F_Old"), "F_New");
        ide.Rename(new Volt.Engine.Item.ItemRef("FB_Old"), "FB_New");

        var fn = ide.ReadContent(new Volt.Engine.Item.ItemRef("F_New"));
        Assert.Equal("// F_Old helper\nFUNCTION F_New : BOOL\nVAR\nEND_VAR", fn.Declaration);
        Assert.Contains("// sets F_Old\nF_Old := TRUE;", fn.Body);
        var fb = ide.ReadContent(new Volt.Engine.Item.ItemRef("FB_New"));
        Assert.Equal("// FB_Old helper\nFUNCTION_BLOCK FB_New\nVAR\n\tpSelf : POINTER TO FB_Old;\nEND_VAR", fb.Declaration);
    }

    /// <summary>The TwinCAT shape, measured by the same live test (DIALECT C2o): the item's own CODE references are
    /// rewritten too — the return assignment, the self-pointer — and still no comment.</summary>
    [Fact]
    public void The_fakes_twincat_rename_also_rewrites_the_items_own_code_references_and_no_comment()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("F_Old", "// F_Old helper\nFUNCTION F_Old : BOOL\nVAR\nEND_VAR", "// sets F_Old\nF_Old := TRUE;"),
            FakeIde.Item.TextualPou("FB_Old", "// FB_Old helper\nFUNCTION_BLOCK FB_Old\nVAR\n\tpSelf : POINTER TO FB_Old;\nEND_VAR", ";"))
        { RewritesReferencesOnRename = true, RewritesOwnReferencesOnRename = true };

        ide.Rename(new Volt.Engine.Item.ItemRef("F_Old"), "F_New");
        ide.Rename(new Volt.Engine.Item.ItemRef("FB_Old"), "FB_New");

        var fn = ide.ReadContent(new Volt.Engine.Item.ItemRef("F_New"));
        Assert.Equal("// F_Old helper\nFUNCTION F_New : BOOL\nVAR\nEND_VAR", fn.Declaration);
        Assert.Contains("// sets F_Old\nF_New := TRUE;", fn.Body);
        var fb = ide.ReadContent(new Volt.Engine.Item.ItemRef("FB_New"));
        Assert.Equal("// FB_Old helper\nFUNCTION_BLOCK FB_New\nVAR\n\tpSelf : POINTER TO FB_New;\nEND_VAR", fb.Declaration);
    }
}
