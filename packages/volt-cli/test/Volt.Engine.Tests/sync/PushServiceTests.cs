using System.Linq;
using Volt.Engine.Sync;
using Volt.Engine.Wire;
using Volt.Engine.Workspace;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>Direct tests for the unified <c>set</c> apply path: that one op dispatches to the right IDE
/// primitives (native rename / recreate-move / in-place write), including the rename+edit and rename+move
/// combinations, and that the optimistic-concurrency guard holds.</summary>
public class PushServiceTests
{
    private static FakeIde OneProgram(string name = "PLC_PRG", string folder = "") =>
        new FakeIde(FakeIde.Item.TextualPou(name, $"PROGRAM {name}\nVAR\n\tn : INT;\nEND_VAR", "n := n + 1;", folder));

    private static (string Version, string ProjectVersion) Ver(FakeIde ide, string fullName)
    {
        var refs = RefsService.Handle(ide);
        return (refs.Items[fullName], refs.ProjectVersion!);
    }

    private static PushResponse Push(FakeIde ide, string pv, params PushOp[] ops) =>
        PushService.Handle(ide, new PushRequest { ExpectedProjectVersion = pv, Ops = ops.ToList() });

    [Fact]
    public void Set_rename_uses_native_rename_no_recreate()
    {
        var ide = OneProgram();
        var (v, pv) = Ver(ide, "PLC_PRG.prg");
        var resp = Push(ide, pv, new SetItemOp { Name = "PLC_PRG.prg", IfVersion = v, ToName = "MOTOR.prg" });
        Assert.True(resp.Accepted);
        Assert.Contains("rename:PLC_PRG->MOTOR", ide.Recorded);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("delete:") || r.StartsWith("create:")); // refs preserved, not recreated
    }

    [Fact]
    public void Accepted_push_receipt_matches_a_fresh_refs()
    {
        // The client persists the push receipt as its IDE baseline with no follow-up /refs, so the receipt
        // MUST equal a fresh /refs (the reuse-of-pre-apply-versions optimization broke this for renames).
        var ide = OneProgram(folder: "POUs");
        var (v, pv) = Ver(ide, "PLC_PRG.prg");
        var resp = Push(ide, pv, new SetItemOp { Name = "PLC_PRG.prg", IfVersion = v, ToName = "MOTOR.prg" });
        Assert.True(resp.Accepted);

        var refs = RefsService.Handle(ide);
        Assert.Equal(refs.ProjectVersion, resp.NewProjectVersion);
        Assert.Equal(refs.Items.OrderBy(k => k.Key), resp.NewItems!.OrderBy(k => k.Key));
        Assert.Equal(refs.Folders.OrderBy(k => k.Key), resp.NewFolders!.OrderBy(k => k.Key));
    }

    [Fact]
    public void Accepted_push_returns_newFolders_in_parity_with_newItems()
    {
        // The accepted receipt carries newFolders so the client refreshes its sidecar folder map without a
        // follow-up /refs. It must cover exactly the same full-name space as newItems (the version map).
        var ide = OneProgram(folder: "POUs");
        var (v, pv) = Ver(ide, "PLC_PRG.prg");
        var resp = Push(ide, pv, new SetItemOp { Name = "PLC_PRG.prg", IfVersion = v, ToName = "MOTOR.prg" });
        Assert.True(resp.Accepted);
        Assert.NotNull(resp.NewFolders);
        Assert.Equal(resp.NewItems!.Keys.OrderBy(k => k), resp.NewFolders!.Keys.OrderBy(k => k));
        Assert.Equal("POUs", resp.NewFolders!["MOTOR.prg"]); // a rename keeps the folder
    }

    [Fact]
    public void Set_move_recreates_in_new_folder()
    {
        var ide = OneProgram();
        var (v, pv) = Ver(ide, "PLC_PRG.prg");
        var resp = Push(ide, pv, new SetItemOp { Name = "PLC_PRG.prg", IfVersion = v, ToFolder = "Sub" });
        Assert.True(resp.Accepted);
        Assert.Contains("delete:PLC_PRG", ide.Recorded);
        Assert.Contains("create:PLC_PRG", ide.Recorded); // recreated (same name ⇒ name-based refs survive)
    }

    [Fact]
    public void Move_into_a_folder_whose_name_contains_a_slash_creates_ONE_decoded_folder()
    {
        var ide = OneProgram();
        var (v, pv) = Ver(ide, "PLC_PRG.prg");
        // The wire folder is the ENCODED form volt-git sends for a folder literally named "Interfaces / Data".
        var resp = Push(ide, pv, new SetItemOp { Name = "PLC_PRG.prg", IfVersion = v, ToFolder = FolderPath.Encode("Interfaces / Data") });
        Assert.True(resp.Accepted);
        Assert.Contains("create:Interfaces / Data", ide.Recorded);   // ONE folder, decoded to its real name
        Assert.DoesNotContain(ide.Recorded, r => r is "create:Interfaces " or "create: Data"); // NOT split on the name's '/'
    }

    [Fact]
    public void Create_with_the_full_tree_path_descends_the_spine_instead_of_doubling_it()
    {
        // The wire folder is the FULL path from the TREE ROOT (CODESYS "Device/Plc Logic/Application/…"), but new
        // items default into the PLC-PROJECT ROOT (the Application) which sits BELOW the tree root. Resolving
        // toFolder from the plc-project root re-created the spine under itself ("App" landing at "App/App" — the
        // doubling bug); it must descend from the TREE root and REUSE the existing spine node. (Old code recorded
        // "create:App" here; the fix does not.)
        var ide = new FakeIde(
            new FakeIde.Item("<root>", ItemKind.PlcFolder, "", false, null, null, null, null, Children: new[] { "App" }),
            new FakeIde.Item("App", ItemKind.PlcFolder, "", false, null, null, null, null, Children: System.Array.Empty<string>()))
        { PlcRootName = "App", TreeRootName = "<root>" };
        var pv = RefsService.Handle(ide).ProjectVersion!;
        var resp = Push(ide, pv, new SetItemOp { Name = "New.prg", IfVersion = null, ToFolder = "App", SourceText = "PROGRAM New\nEND_PROGRAM\n" });
        Assert.True(resp.Accepted);
        Assert.Contains("create:New", ide.Recorded);
        Assert.DoesNotContain("create:App", ide.Recorded);   // reused the existing spine node — NOT doubled to App/App
    }

    [Fact]
    public void Set_update_in_place_with_empty_toFolder_does_not_move()
    {
        // An in-place content edit that doesn't restate the full tree path (empty toFolder) must NOT be read as a
        // move to the root — no delete/recreate, just a write.
        var ide = OneProgram("PLC_PRG", folder: "Device/Plc Logic/Application");
        var (v, pv) = Ver(ide, "PLC_PRG.prg");
        var resp = Push(ide, pv, new SetItemOp { Name = "PLC_PRG.prg", IfVersion = v, ToFolder = "", SourceText = "PROGRAM PLC_PRG\nVAR\n\tn : INT;\nEND_VAR\n\nn := n + 9;\n\nEND_PROGRAM\n" });
        Assert.True(resp.Accepted);
        Assert.Contains("write:PLC_PRG", ide.Recorded);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("delete:") || r.StartsWith("create:")); // in place, not moved
    }

    [Fact]
    public void Set_rename_plus_edit_renames_then_writes_content()
    {
        var ide = OneProgram();
        var (v, pv) = Ver(ide, "PLC_PRG.prg");
        var src = "PROGRAM MOTOR\nVAR\n\tn : INT;\nEND_VAR\n\nn := n + 2;\n\nEND_PROGRAM\n";
        var resp = Push(ide, pv, new SetItemOp { Name = "PLC_PRG.prg", IfVersion = v, ToName = "MOTOR.prg", SourceText = src });
        Assert.True(resp.Accepted);
        Assert.Contains("rename:PLC_PRG->MOTOR", ide.Recorded);
        Assert.Contains("write:MOTOR", ide.Recorded); // content written onto the renamed identity
    }

    [Fact]
    public void Set_rename_plus_move_does_both_atomically()
    {
        var ide = OneProgram();
        var (v, pv) = Ver(ide, "PLC_PRG.prg");
        var resp = Push(ide, pv, new SetItemOp { Name = "PLC_PRG.prg", IfVersion = v, ToName = "MOTOR.prg", ToFolder = "Sub" });
        Assert.True(resp.Accepted);
        Assert.Contains("rename:PLC_PRG->MOTOR", ide.Recorded);
        Assert.Contains("delete:MOTOR", ide.Recorded);  // moved by its new name
        Assert.Contains("create:MOTOR", ide.Recorded);
    }

    [Fact]
    public void Set_with_stale_version_is_rejected_before_any_mutation()
    {
        var ide = OneProgram();
        var (_, pv) = Ver(ide, "PLC_PRG.prg");
        var resp = Push(ide, pv, new SetItemOp { Name = "PLC_PRG.prg", IfVersion = "stale", ToName = "X.prg" });
        Assert.False(resp.Accepted);
        Assert.Empty(ide.Recorded);
    }

    [Fact]
    public void Set_create_over_an_existing_item_is_rejected()
    {
        var ide = OneProgram();
        var (_, pv) = Ver(ide, "PLC_PRG.prg");
        var resp = Push(ide, pv, new SetItemOp { Name = "PLC_PRG.prg", IfVersion = null, SourceText = "PROGRAM PLC_PRG\nEND_PROGRAM\n" });
        Assert.False(resp.Accepted);
        Assert.Contains(resp.Conflicts!, c => c.Reason.Contains("already exists"));
    }

    // ── Negative / AI-mistake coverage ──────────────────────────────────────────────────
    // What an AI editing via Volt can actually send the bridge is a `set` op with CONTENT — the file
    // extension is a volt-git concern that never reaches here (kind is derived from the source text,
    // not the extension). These pin that malformed content an AI might paste is REJECTED cleanly and
    // never half-applied, and that a correctly-authored DUT lands (the bridge was never the blocker).

    [Fact]
    public void Create_struct_from_valid_content_lands_as_a_dut()
    {
        // The exact thing the PackML session wanted: a struct pushed as canonical ST. The bridge reads the
        // kind from the CONTENT (TYPE…END_TYPE ⇒ dut), independent of any file extension.
        var ide = new FakeIde();
        var pv = RefsService.Handle(ide).ProjectVersion!;
        var src = "TYPE ST_Foo :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE\n";
        var resp = Push(ide, pv, new SetItemOp { Name = "ST_Foo.dut", IfVersion = null, SourceText = src });
        Assert.True(resp.Accepted);
        Assert.Contains("create:ST_Foo", ide.Recorded);
    }

    [Theory]
    [InlineData("ST_Foo", "TYPE ST_Foo :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE\n")]
    [InlineData("E_Mode", "{attribute 'qualified_only'}\nTYPE E_Mode :\n(\n\tIDLE := 0,\n\tRUN := 1\n) USINT;\nEND_TYPE\n")]
    [InlineData("U_Val", "TYPE U_Val :\nUNION\n\ti : INT;\n\tr : REAL;\nEND_UNION\nEND_TYPE\n")]
    [InlineData("Handle", "TYPE Handle : __XWORD;\nEND_TYPE\n")]
    public void Every_dut_variant_creates_with_the_single_dut_code(string name, string src)
    {
        // The cleanest-impl invariant: a DUT is one wire kind → one create code (PlcDut). Volt never picks a
        // struct/enum/union/alias subkind — the IDE derives it from the written declaration.
        var ide = new FakeIde();
        var pv = RefsService.Handle(ide).ProjectVersion!;
        var resp = Push(ide, pv, new SetItemOp { Name = $"{name}.dut", IfVersion = null, SourceText = src });
        Assert.True(resp.Accepted);
        Assert.Equal(ItemKind.PlcDut, ide.CreatedKinds[name]);
    }

    [Fact]
    public void Create_with_empty_sourceText_is_rejected_before_any_mutation()
    {
        var ide = new FakeIde();
        var pv = RefsService.Handle(ide).ProjectVersion!;
        var resp = Push(ide, pv, new SetItemOp { Name = "ST_Foo.dut", IfVersion = null, SourceText = "   " });
        Assert.False(resp.Accepted);
        Assert.Empty(ide.Recorded);   // rejected up front — nothing created/written
    }

    [Fact]
    public void Create_without_sourceText_is_rejected()
    {
        var ide = new FakeIde();
        var pv = RefsService.Handle(ide).ProjectVersion!;
        var resp = Push(ide, pv, new SetItemOp { Name = "ST_Foo.dut", IfVersion = null, SourceText = null });
        Assert.False(resp.Accepted);
        Assert.Contains(resp.Conflicts!, c => c.Reason.Contains("needs sourceText"));
        Assert.Empty(ide.Recorded);
    }

    [Fact]
    public void Create_with_unclassifiable_content_is_rejected_not_crashed()
    {
        // An AI that pastes prose or a wrong-language body instead of ST: reject with a structured error,
        // never a half-created item. ParseCodeHeader throws INVALID_CODE_HEADER before any IDE mutation.
        var ide = new FakeIde();
        var pv = RefsService.Handle(ide).ProjectVersion!;
        var resp = Push(ide, pv, new SetItemOp { Name = "Junk.dut", IfVersion = null, SourceText = "this is not structured text at all" });
        Assert.False(resp.Accepted);
        Assert.Empty(ide.Recorded);
    }

    // Duplicate child names (an unmarked overload) are keyed by name → the second would silently overwrite the
    // first, losing a source method while the push reports accepted. The guard lives in Core (before any driver
    // call), so BOTH drivers reject it identically — this is the parity test for that shared behaviour.
    private const string TwoSameNameMethods =
        "FUNCTION_BLOCK FB_Math\nEND_FUNCTION_BLOCK\n" +
        "METHOD Calc : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nEND_METHOD\n" +
        "METHOD Calc : INT\nVAR_INPUT\n\ta : INT;\n\tb : INT;\nEND_VAR\nEND_METHOD\n";

    [Fact]
    public void Duplicate_child_name_is_rejected_not_silently_collapsed()
    {
        var ide = new FakeIde();
        var pv = RefsService.Handle(ide).ProjectVersion!;
        var resp = Push(ide, pv, new SetItemOp { Name = "FB_Math.fb", IfVersion = null, SourceText = TwoSameNameMethods });
        Assert.False(resp.Accepted);
        Assert.Contains(resp.Conflicts!, c => c.Name == "FB_Math.fb" && c.Reason.Contains("more than one child named 'Calc'"));
        Assert.Empty(ide.Recorded); // guard throws before any CreateChild/WriteText — no half-written FB
    }

    [Fact]
    public void Distinct_child_names_still_push_cleanly()
    {
        var ide = new FakeIde();
        var pv = RefsService.Handle(ide).ProjectVersion!;
        var twoDistinct = TwoSameNameMethods.Replace("METHOD Calc : INT\nVAR_INPUT\n\ta : INT;\n\tb : INT;", "METHOD Calc2 : INT\nVAR_INPUT\n\ta : INT;\n\tb : INT;");
        var resp = Push(ide, pv, new SetItemOp { Name = "FB_Math.fb", IfVersion = null, SourceText = twoDistinct });
        Assert.True(resp.Accepted);
    }

    // ── conflict REASON strings: the wire text a client turns into its message (pinned once, here) ──

    [Fact]
    public void Stale_ifVersion_conflict_carries_the_item_changed_reason()
    {
        var ide = OneProgram();
        var (_, pv) = Ver(ide, "PLC_PRG.prg");
        var resp = Push(ide, pv, new SetItemOp { Name = "PLC_PRG.prg", IfVersion = "stale", SourceText = "PROGRAM PLC_PRG\nVAR\nEND_VAR\nn := 5;" });
        Assert.False(resp.Accepted);
        Assert.Contains(resp.Conflicts!, c => c.Name == "PLC_PRG.prg" && c.Reason == "item changed since you fetched its version");
        Assert.Empty(ide.Recorded);
    }

    [Fact]
    public void Wrong_expected_project_version_carries_the_project_conflict_reason()
    {
        var ide = OneProgram();
        var (v, _) = Ver(ide, "PLC_PRG.prg");
        var resp = Push(ide, "not-the-current-pv", new SetItemOp { Name = "PLC_PRG.prg", IfVersion = v, SourceText = "PROGRAM PLC_PRG\nVAR\nEND_VAR\nn := 7;" });
        Assert.False(resp.Accepted);
        Assert.Contains(resp.Conflicts!, c => c.Name == "<project>" && c.Reason == "expected project version does not match current project version");
    }

    // ── multi-op batch atomicity at the service layer (was only proven in the e2e wire suite) ──

    [Fact]
    public void A_multi_op_batch_applies_create_update_and_delete_atomically()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\n\tn : INT;\nEND_VAR", "n := 1;"),
            FakeIde.Item.TextualPou("FB_Old", "FUNCTION_BLOCK FB_Old\nVAR\nEND_VAR", "", "POUs"));
        var refs = RefsService.Handle(ide);
        // Derive the update's SourceText from a real fetch so it round-trips in the canonical POU form.
        var prgSrc = FetchService.Handle(ide, new FetchRequest { KnownItems = new() })
            .Changed.First(c => c.Name == "PLC_PRG.prg").SourceText.Replace("n := 1;", "n := 2;");

        var resp = Push(ide, refs.ProjectVersion!,
            new SetItemOp { Name = "ST_New.dut", IfVersion = null, SourceText = "TYPE ST_New :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n" },
            new SetItemOp { Name = "PLC_PRG.prg", IfVersion = refs.Items["PLC_PRG.prg"], SourceText = prgSrc },
            new DeleteItemOp { Name = "FB_Old.fb", IfVersion = refs.Items["FB_Old.fb"] });

        Assert.True(resp.Accepted, resp.Conflicts is null ? "" : string.Join(",", resp.Conflicts.Select(c => c.Reason)));
        Assert.Contains(ide.Recorded, r => r.StartsWith("create:ST_New"));
        Assert.Contains(ide.Recorded, r => r.StartsWith("write:PLC_PRG"));
        Assert.Contains(ide.Recorded, r => r.StartsWith("delete:FB_Old"));
    }

    [Fact]
    public void A_conflict_anywhere_in_a_batch_rejects_the_whole_batch()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("A", "PROGRAM A\nVAR\nEND_VAR", "x := 1;"),
            FakeIde.Item.TextualPou("B", "PROGRAM B\nVAR\nEND_VAR", "y := 1;"));
        var refs = RefsService.Handle(ide);
        var resp = Push(ide, refs.ProjectVersion!,
            new SetItemOp { Name = "A.prg", IfVersion = refs.Items["A.prg"], SourceText = "PROGRAM A\nVAR\nEND_VAR\nx := 2;" }, // valid
            new SetItemOp { Name = "B.prg", IfVersion = "stale", SourceText = "PROGRAM B\nVAR\nEND_VAR\ny := 2;" });          // conflicts

        Assert.False(resp.Accepted);
        Assert.Contains(resp.Conflicts!, c => c.Name == "B.prg");
        Assert.Empty(ide.Recorded); // the valid op A was NOT applied — atomic rollback
    }

    /// <summary>An SFC POU's TRANSITIONS must survive a push that does not mention them. No reader models a
    /// transition — it never reaches the item's file — so it can never be in the pushed member set, and the
    /// orphan walk used to reconcile against the wider "inlined in a POU" set and delete every one of them on
    /// the FIRST push of the enclosing POU. Silent, and the engineer's SFC logic was gone.
    /// <para>The fake had to be fixed first: it rendered a transition as <c>&lt;action&gt;</c>, a shape no vendor
    /// emits, so the reader read it back as an action MEMBER and it landed in `keep` — the fake was asserting
    /// the bug away.</para></summary>
    [Fact]
    public void A_push_does_not_delete_the_POUs_transitions()
    {
        var pou = new FakeIde.Item("SFC_PRG", ItemKind.PlcPouProg, "", true,
            "PROGRAM SFC_PRG\nVAR\nEND_VAR", "x := 1;", null, null, new[] { "ACT_A", "T1" });
        var act = new FakeIde.Item("ACT_A", ItemKind.PlcAction, "", false, null, "a := 1;", null, null);
        var trans = new FakeIde.Item("T1", ItemKind.PlcTrans, "", false, null, "TRUE", null, null);
        var ide = new FakeIde(pou, act, trans);

        var (v, pv) = Ver(ide, "SFC_PRG.prg");
        var resp = Push(ide, pv, new SetItemOp
        {
            Name = "SFC_PRG.prg",
            IfVersion = v,
            SourceText = "PROGRAM SFC_PRG\nVAR\nEND_VAR\n\nx := 2;\n\nEND_PROGRAM\n\nACTION ACT_A\na := 1;\nEND_ACTION\n",
        });

        Assert.True(resp.Accepted, string.Join(" | ", (resp.Conflicts ?? new()).Select(c => c.Name + ": " + c.Reason)));
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("delete:") && r.Contains("T1"));
    }

    /// <summary>A move+edit whose CONTENT is refused must leave the item where it was — the refusal has to be
    /// atomic. The move used to run FIRST, so a rejected edit (a read-only body, a language change, malformed
    /// network text) left the item already relocated and its destination folder already created, while the push
    /// reported failure. Nothing put that back.</summary>
    [Fact]
    public void A_refused_move_plus_edit_does_not_relocate_the_item()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "n := 1;"))
        { OneDocumentWrite = true };
        var (v, pv) = Ver(ide, "PLC_PRG.prg");

        // Malformed network text: the splice refuses it, so the whole push must be rejected.
        var resp = Push(ide, pv, new SetItemOp
        {
            Name = "PLC_PRG.prg",
            IfVersion = v,
            ToFolder = "Machine",
            SourceText = "PROGRAM PLC_PRG\nVAR\nEND_VAR\n\nNETWORK 0 FBD\n  out := (a AND b);\n",
        });

        Assert.False(resp.Accepted);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("move:"));   // never relocated
    }
}
