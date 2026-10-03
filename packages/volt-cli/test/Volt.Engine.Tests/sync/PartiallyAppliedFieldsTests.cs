using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A REFUSED OP'S CONFLICT STATES IN FIELDS WHAT OF IT THE IDE KEPT (openspec <c>push-partially-applied-flag</c>).
///
/// <para><c>push-keeps-what-landed</c> made the engine record what of the refused op stays (<c>PushService.OpOutcome</c>,
/// and an update's member-refusal wording) and say it in <c>reason</c> — prose only, while <c>PushConflict.Code</c>'s
/// contract is that a caller branches on fields, never on the English. So a client had to read prose that is almost
/// always absent to decide whether to re-read an item before retrying it. These pin the fields over every case that
/// leaves something: <c>partiallyApplied</c> whenever anything of the op stays, <c>renamedTo</c> (the item's current
/// WIRE name) after a native rename, <c>remains</c> for a create whose rollback failed — and their ABSENCE when nothing
/// stays (a rolled-back create, a pre-flight refusal, a member refusal under which nothing was written). The reasons
/// are the existing oracles' (<c>PushKeepsWhatLandedTests</c>, <c>DeclarationBeforeMembersTests</c>); the fields are
/// additive.</para>
/// </summary>
public class PartiallyAppliedFieldsTests
{
    private const string Struct = "TYPE ST_B :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE";
    private const string Method = "\n\nMETHOD M : BOOL\nIMPLEMENTATION ST\nM := TRUE;\nEND_METHOD\n";
    private const string FbWithMethod =
        "FUNCTION_BLOCK F\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK" + Method;
    private const string FunctionWithMethod =
        "FUNCTION F : BOOL\nVAR\nEND_VAR\nIMPLEMENTATION ST\nF := TRUE;\nEND_FUNCTION" + Method;

    private static System.Exception NotValidName(string name) =>
        new System.InvalidOperationException($"The name '{name}' is not valid for this object.");

    private static PushResponse Push(FakeIde ide, params PushOp[] ops) =>
        PushService.Handle(ide, new PushRequest { ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion, Ops = ops.ToList() });

    private static SetItemOp Create(string wireName, string source) =>
        new() { Name = wireName, IfVersion = null, ToFolder = "", SourceText = source };

    private static SetItemOp Update(FakeIde ide, string wireName, string source, string? toName = null, string? toFolder = null) =>
        new() { Name = wireName, ToName = toName, ToFolder = toFolder, IfVersion = RefsService.Handle(ide).Items[wireName], SourceText = source };

    private static void AssertNothingKept(PushConflict c)
    {
        Assert.Null(c.PartiallyApplied);
        Assert.Null(c.RenamedTo);
        Assert.Null(c.Remains);
    }

    // ── Nothing stays: no field ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_pre_flight_refusal_carries_no_partially_applied()
    {
        var ide = new FakeIde();
        var resp = Push(ide, Create("Bad.pou", "not a POU at all"));

        Assert.False(resp.Accepted);
        Assert.Empty(ide.Recorded);
        AssertNothingKept(Assert.Single(resp.Conflicts!));
    }

    [Fact]
    public void A_refused_create_that_is_rolled_back_carries_no_partially_applied()
    {
        var ide = new FakeIde { FailCreate = (name, kind) => kind == ItemKind.PlcMethod ? NotValidName(name) : null };
        var resp = Push(ide, Create("F.pou", FbWithMethod));

        Assert.False(ide.Exists("F"), "premise: the create rolled back");
        var c = Assert.Single(resp.Conflicts!);
        Assert.Contains("'F' is not created (the create is rolled back)", c.Reason);
        AssertNothingKept(c);
    }

    [Fact]
    public void A_classified_member_refusal_of_a_create_that_is_rolled_back_carries_no_partially_applied()
    {
        var ide = new FakeIde { RefusesMembersByText = true };
        var resp = Push(ide, Create("F.pou", FunctionWithMethod));

        Assert.False(ide.Exists("F"), "premise: the create rolled back");
        var c = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.Unsupported, c.Code);
        AssertNothingKept(c);
    }

    /// <summary>The MemberRefusal oracle's "nothing of 'K' was written": an update under an UNCHANGED declaration whose new
    /// member the IDE refuses — no declaration write, no member reconciled before it.</summary>
    [Fact]
    public void A_member_refusal_of_an_update_under_which_nothing_was_written_carries_no_partially_applied()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("K", "FUNCTION K : BOOL\nVAR\nEND_VAR", "K := TRUE;")) { RefusesMembersByText = true };
        var resp = Push(ide, Update(ide, "K.pou", "FUNCTION K : BOOL\nVAR\nEND_VAR\nIMPLEMENTATION ST\nK := TRUE;\nEND_FUNCTION" + Method));

        var c = Assert.Single(resp.Conflicts!);
        Assert.Contains("nothing of 'K' was written", c.Reason);
        AssertNothingKept(c);
    }

    [Fact]
    public void An_op_not_attempted_after_the_refused_one_carries_no_partially_applied()
    {
        FakeIde ide = null!;
        ide = new FakeIde(FakeIde.Item.TextualPou("K", "FUNCTION_BLOCK K\nVAR\nEND_VAR", ";"))
        {
            RefuseContentWrite = item => ide.Name(item) == "K" ? new System.InvalidOperationException("the IDE could not write 'K'") : null,
        };
        var resp = Push(ide,
            Create("ST_B.dut", Struct),
            Update(ide, "K.pou", "FUNCTION_BLOCK K\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK" + Method),
            Create("ST_C.dut", Struct.Replace("ST_B", "ST_C")));

        Assert.True(resp.Accepted, resp.Conflicts?.FirstOrDefault()?.Reason);
        var notAttempted = resp.Conflicts!.Single(c => c.Code == ConflictCodes.NotAttempted);
        AssertNothingKept(notAttempted);
    }

    // ── Something stays: partiallyApplied ───────────────────────────────────────────────────────────────────────

    /// <summary>Spec scenario "an update refused after its declaration was written" — the classified member refusal
    /// (<c>MemberRefusal</c> words it), the live CODESYS shape of task 3.1.</summary>
    [Fact]
    public void A_member_refusal_after_the_declaration_was_written_is_partially_applied()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("K", "FUNCTION_BLOCK K\nVAR\nEND_VAR", ";")) { RefusesMembersByText = true };
        var resp = Push(ide, Update(ide, "K.pou", "FUNCTION K : BOOL\nVAR\nEND_VAR\nIMPLEMENTATION ST\nK := TRUE;\nEND_FUNCTION" + Method));

        var c = Assert.Single(resp.Conflicts!);
        Assert.Contains("the declaration of 'K' was written before it and stays", c.Reason);   // as today
        Assert.True(c.PartiallyApplied);
        Assert.Null(c.RenamedTo);
        Assert.Null(c.Remains);
    }

    /// <summary>The MemberRefusal oracle with a member DELETED before the refused create, under an unchanged-text
    /// declaration ("nothing else of 'K' was written") — something stays although the declaration was not written.</summary>
    [Fact]
    public void A_member_refusal_after_a_member_was_deleted_is_partially_applied()
    {
        var pou = FakeIde.Item.TextualPou("K", "FUNCTION K : BOOL\nVAR\nEND_VAR", ";") with { Children = new[] { "A" } };
        var a = new FakeIde.Item("A", ItemKind.PlcMethod, "", false, "METHOD A : BOOL\nVAR\nEND_VAR", "A := TRUE;", null, null);
        var ide = new FakeIde(pou, a) { RefusesMembersByText = true };
        var resp = Push(ide, Update(ide, "K.pou", "FUNCTION K : BOOL\nVAR\nEND_VAR\nIMPLEMENTATION ST\nK := TRUE;\nEND_FUNCTION\n\n" +
                                                  "METHOD B : BOOL\nIMPLEMENTATION ST\nB := TRUE;\nEND_METHOD\n"));

        var c = Assert.Single(resp.Conflicts!);
        Assert.Contains("its method 'A' was deleted before it and stays deleted", c.Reason);
        Assert.True(c.PartiallyApplied);
    }

    /// <summary><c>OpOutcome.UpdateKept</c> through <c>RecordKept</c>: an unclassified member-create failure after the
    /// declaration landed.</summary>
    [Fact]
    public void An_unclassified_failure_after_the_declaration_was_written_is_partially_applied()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("K", "FUNCTION_BLOCK K\nVAR\nEND_VAR", ";"))
        {
            FailCreate = (name, kind) => kind == ItemKind.PlcMethod ? NotValidName(name) : null,
        };
        var resp = Push(ide, Update(ide, "K.pou", "FUNCTION_BLOCK K\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK" + Method));

        var c = Assert.Single(resp.Conflicts!);
        Assert.Contains("the declaration of 'K' was written before it and stays", c.Reason);
        Assert.True(c.PartiallyApplied);
        Assert.Null(c.RenamedTo);
        Assert.Null(c.Remains);
    }

    [Fact]
    public void A_content_write_refused_after_a_member_was_created_is_partially_applied()
    {
        FakeIde ide = null!;
        ide = new FakeIde(FakeIde.Item.TextualPou("K", "FUNCTION_BLOCK K\nVAR\nEND_VAR", ";"))
        {
            RefuseContentWrite = item => ide.Name(item) == "K" ? new System.InvalidOperationException("the IDE could not write 'K'") : null,
        };
        var resp = Push(ide, Update(ide, "K.pou", "FUNCTION_BLOCK K\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK" + Method));

        var c = Assert.Single(resp.Conflicts!);
        Assert.Contains("its method 'M' was created before it and stays", c.Reason);
        Assert.True(c.PartiallyApplied);
    }

    /// <summary><c>RecordMoveKept</c>: a move+edit whose move is refused after the text was written in place.</summary>
    [Fact]
    public void A_move_refused_after_its_edit_was_written_is_partially_applied()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("FB_M", "FUNCTION_BLOCK FB_M\nVAR\nEND_VAR", ";", folder: "A"))
        {
            FailMove = name => name == "FB_M" ? new System.InvalidOperationException("the IDE could not move 'FB_M'") : null,
        };
        var resp = Push(ide, Update(ide, "FB_M.pou", "FUNCTION_BLOCK FB_M\nVAR\nEND_VAR\nIMPLEMENTATION ST\nn := 2;\nEND_FUNCTION_BLOCK\n", toFolder: "B"));

        var c = Assert.Single(resp.Conflicts!);
        Assert.Contains("the pushed text of 'FB_M' was written before it and stays", c.Reason);
        Assert.True(c.PartiallyApplied);
        Assert.Null(c.RenamedTo);
    }

    /// <summary>Spec scenario "a rename that ran before the refusal": <c>renamedTo</c> is the item's current WIRE name
    /// (the full name, as every name on the wire is), so a client can re-read it under the name it now has.</summary>
    [Fact]
    public void A_rename_that_ran_before_the_refusal_is_partially_applied_and_names_the_new_name()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("X", "FUNCTION_BLOCK X\nVAR\nEND_VAR", ";"))
        {
            FailCreate = (name, kind) => kind == ItemKind.PlcMethod
                ? new ChildRefusedException($"The name '{name}' is not valid for this object.", ChildRefusalCause.Name)
                : null,
        };
        var resp = Push(ide, Update(ide, "X.pou",
            "FUNCTION_BLOCK Y\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK" + Method, toName: "Y.pou"));

        Assert.True(ide.Exists("Y"), "premise: the native rename ran before the refused write");
        var c = Assert.Single(resp.Conflicts!);
        Assert.Equal("X.pou", c.Name);
        Assert.Contains("stays renamed", c.Reason);
        Assert.True(c.PartiallyApplied);
        Assert.Equal("Y.pou", c.RenamedTo);
        Assert.Null(c.Remains);
    }

    /// <summary>THE REASON DOES NOT CONTRADICT THE FIELDS (gate review of step 3, seen live on CODESYS): a rename followed
    /// by a member refusal under a declaration the rename itself rewrote answered "nothing of 'Y' was written" AND "'X'
    /// was renamed to 'Y' … and stays renamed" in one reason. The member refusal says what of the item was written AFTER
    /// the rename; the rename is worded once, by <c>ConflictFor</c>.</summary>
    [Fact]
    public void A_member_refusal_after_a_rename_does_not_say_nothing_was_written()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("X", "FUNCTION X : BOOL\nVAR\nEND_VAR", "X := TRUE;")) { RefusesMembersByText = true };
        var resp = Push(ide, Update(ide, "X.pou",
            "FUNCTION Y : BOOL\nVAR\nEND_VAR\nIMPLEMENTATION ST\nY := TRUE;\nEND_FUNCTION" + Method, toName: "Y.pou"));

        Assert.True(ide.Exists("Y"), "premise: the native rename ran before the refused member");
        var c = Assert.Single(resp.Conflicts!);
        Assert.DoesNotContain("nothing of 'Y' was written", c.Reason);
        Assert.Contains("nothing but the rename of 'Y' was written", c.Reason);
        Assert.Contains("'X' was renamed to 'Y'", c.Reason);
        Assert.Contains("stays renamed", c.Reason);
        Assert.True(c.PartiallyApplied);
        Assert.Equal("Y.pou", c.RenamedTo);
    }

    /// <summary>The task arm's own rename (<c>ApplySetTask</c>): renamed, then the settings write refused.</summary>
    [Fact]
    public void A_task_renamed_before_its_settings_write_was_refused_names_the_new_name()
    {
        var ide = new FakeIde(new FakeIde.Item("MainTask", ItemKind.PlcTask, "Device/Plc Logic/Application/Task Configuration",
                                               true, null, null, null, null))
        {
            RefuseTaskWrite = _ => new System.InvalidOperationException("the IDE could not write the task"),
        };
        var resp = Push(ide, Update(ide, "MainTask.task",
            "Type:      Cyclic\nInterval:  20 ms\nPriority:  5\nWatchdog:  16 ms (sensitivity 2)\nCalls:     PLC_PRG\n",
            toName: "SlowTask.task"));

        Assert.Contains("rename:MainTask->SlowTask", ide.Recorded);   // premise
        var c = Assert.Single(resp.Conflicts!);
        Assert.Contains("stays renamed", c.Reason);
        Assert.True(c.PartiallyApplied);
        Assert.Equal("SlowTask.task", c.RenamedTo);
    }

    [Fact]
    public void A_forced_replace_whose_create_fails_is_partially_applied()
    {
        var failCreate = false;
        var ide = new FakeIde
        {
            FailCreate = (name, _) => failCreate && name == "Broken"
                ? new System.InvalidOperationException("the IDE could not create 'Broken'") : null,
        };
        Push(ide, new SetItemOp { Name = "Broken.pou", ToFolder = "Data", SourceText =
            "FUNCTION_BLOCK Broken\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK\n" });
        ide.UnopenedItems.Add("Broken");
        failCreate = true;

        var resp = PushService.Handle(ide, new PushRequest
        {
            Force = true,
            Ops = new List<PushOp> { new SetItemOp { Name = "Broken.pou", SourceText =
                "FUNCTION_BLOCK Broken\nVAR\nEND_VAR\nIMPLEMENTATION ST\nn := 1;\nEND_FUNCTION_BLOCK\n" } },
        });

        Assert.False(ide.Exists("Broken"), "premise: the replace deleted the original before its create failed");
        var c = Assert.Single(resp.Conflicts!);
        Assert.Contains("the IDE's 'Broken' was deleted before it", c.Reason);
        Assert.True(c.PartiallyApplied);
        Assert.Null(c.Remains);
    }

    // ── A create whose rollback failed: partiallyApplied + remains ──────────────────────────────────────────────

    [Fact]
    public void An_unclassified_create_failure_whose_rollback_fails_remains()
    {
        var ide = new FakeIde
        {
            FailCreate = (name, kind) => kind == ItemKind.PlcMethod ? NotValidName(name) : null,
            FailDelete = name => name == "F" ? new System.InvalidOperationException("the object is locked") : null,
        };
        var resp = Push(ide, Create("F.pou", FbWithMethod));

        Assert.True(ide.Exists("F"), "premise: the rollback delete failed");
        var c = Assert.Single(resp.Conflicts!);
        Assert.Contains("'F' remains", c.Reason);
        Assert.True(c.PartiallyApplied);
        Assert.True(c.Remains);
        Assert.Null(c.RenamedTo);
    }

    [Fact]
    public void A_classified_member_refusal_whose_rollback_fails_remains()
    {
        var ide = new FakeIde
        {
            RefusesMembersByText = true,
            FailDelete = name => name == "F" ? new System.InvalidOperationException("the object is locked") : null,
        };
        var resp = Push(ide, Create("F.pou", FunctionWithMethod));

        Assert.True(ide.Exists("F"), "premise: the rollback delete failed");
        var c = Assert.Single(resp.Conflicts!);
        Assert.True(c.PartiallyApplied);
        Assert.True(c.Remains);
    }

    // ── Gate review (steps 1+2): the facts the outcome did not record ─────────────────────────────────────────

    private const string TaskFolder = "Device/Plc Logic/Application/Task Configuration";
    private const string MainTaskDescriptor =
        "Type:      Cyclic\nInterval:  10 ms\nPriority:  1\nWatchdog:  off\nCalls:     PLC_PRG\n";
    private const string PushedTask =
        "Type:      Cyclic\nInterval:  20 ms\nPriority:  1\nWatchdog:  off\nCalls:     NoSuchPou\n";

    private static FakeIde.Item MainTask() =>
        new("MainTask", ItemKind.PlcTask, TaskFolder, true, MainTaskDescriptor, null, null, null);

    /// <summary>Review finding 1: neither vendor's <c>WriteTask</c> is atomic (TwinCAT lands the schedule and deletes
    /// the old calls before refusing the call list; CODESYS sets <c>kind_of_task</c> before a later member refuses), and
    /// nothing recorded what it wrote — so an existing task's refused update said nothing stays while the IDE held a new
    /// interval and an emptied call list.</summary>
    [Fact]
    public void A_refused_task_update_that_landed_part_of_its_settings_is_partially_applied()
    {
        var ide = new FakeIde(MainTask())
        {
            RefuseTaskWrite = _ => new BridgeException(BridgeErrorCodes.Unsupported,
                "TwinCAT did not take the call list for 'MainTask'"),
            TaskWriteLandsBeforeRefusal = (_, _) =>
                "Type:      Cyclic\nInterval:  20 ms\nPriority:  1\nWatchdog:  off\nCalls:     \n",
        };
        var resp = Push(ide, Update(ide, "MainTask.task", PushedTask));

        var c = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.Unsupported, c.Code);
        Assert.StartsWith("TwinCAT did not take the call list for 'MainTask'", c.Reason);
        Assert.Contains("part of the settings of 'MainTask' was written before it and stays", c.Reason);
        Assert.True(c.PartiallyApplied);
        Assert.Null(c.RenamedTo);
        Assert.Null(c.Remains);
    }

    /// <summary>…and a refused task update that landed NOTHING stays unflagged: the task reads back as it was.</summary>
    [Fact]
    public void A_refused_task_update_that_landed_nothing_carries_no_partially_applied()
    {
        var ide = new FakeIde(MainTask())
        {
            RefuseTaskWrite = _ => new BridgeException(BridgeErrorCodes.Unsupported, "the IDE could not write the task"),
        };
        var resp = Push(ide, Update(ide, "MainTask.task", PushedTask));

        var c = Assert.Single(resp.Conflicts!);
        Assert.Equal("the IDE could not write the task", c.Reason);
        AssertNothingKept(c);
    }

    /// <summary>Review finding 2: a refused CREATE into a folder that did not exist left the folders it created (the
    /// rollback removes only the item) and said nothing of them — while a refused MOVE names the folder it created.</summary>
    [Fact]
    public void A_refused_create_that_created_its_folders_is_partially_applied()
    {
        FakeIde ide = null!;
        ide = new FakeIde
        {
            RefuseContentWrite = item => ide.Name(item) == "F" ? new System.InvalidOperationException("the IDE could not write 'F'") : null,
        };
        var resp = Push(ide, new SetItemOp { Name = "F.pou", ToFolder = "NewF/Sub", SourceText = FbWithMethod });

        Assert.False(ide.Exists("F"), "premise: the create rolled back");
        Assert.Contains("create:NewF", ide.Recorded);   // premise: the folders were created by this op
        Assert.Contains("create:Sub", ide.Recorded);
        var c = Assert.Single(resp.Conflicts!);
        Assert.Contains("'F' is not created (the create is rolled back)", c.Reason);
        Assert.Contains("the folder 'NewF' was created before it and stays", c.Reason);
        Assert.Contains("the folder 'NewF/Sub' was created before it and stays", c.Reason);
        Assert.True(c.PartiallyApplied);
        Assert.Null(c.Remains);
    }

    /// <summary>Review finding 3: a native rename that RAN but whose re-find failed (a stale tree) — the IDE renamed the
    /// item, and the conflict said nothing of it.</summary>
    [Fact]
    public void A_rename_that_ran_but_cannot_be_found_afterwards_is_partially_applied_and_names_the_new_name()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("X", "FUNCTION_BLOCK X\nVAR\nEND_VAR", ";"));
        ide.HiddenItems.Add("Y");
        var resp = Push(ide, Update(ide, "X.pou", "FUNCTION_BLOCK Y\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK\n", toName: "Y.pou"));

        Assert.Contains("rename:X->Y", ide.Recorded);   // premise: the rename ran
        var c = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.NotFound, c.Code);
        Assert.Contains("stays renamed", c.Reason);
        Assert.True(c.PartiallyApplied);
        Assert.Equal("Y.pou", c.RenamedTo);
    }

    [Fact]
    public void A_task_rename_that_ran_but_cannot_be_found_afterwards_names_the_new_name()
    {
        var ide = new FakeIde(MainTask());
        ide.HiddenItems.Add("SlowTask");
        var resp = Push(ide, Update(ide, "MainTask.task", MainTaskDescriptor, toName: "SlowTask.task"));

        Assert.Contains("rename:MainTask->SlowTask", ide.Recorded);   // premise
        var c = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.NotFound, c.Code);
        Assert.Contains("stays renamed", c.Reason);
        Assert.True(c.PartiallyApplied);
        Assert.Equal("SlowTask.task", c.RenamedTo);
    }

    /// <summary>…while a rename the IDE did NOT apply (case-only, ignored) leaves nothing renamed and claims nothing.</summary>
    [Fact]
    public void A_rename_the_IDE_ignored_claims_no_rename()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("Calc", "FUNCTION_BLOCK Calc\nVAR\nEND_VAR", ";")) { IgnoreRenames = true };
        var resp = Push(ide, Update(ide, "Calc.pou", "FUNCTION_BLOCK calc\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK\n", toName: "calc.pou"));

        var c = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.Unsupported, c.Code);
        AssertNothingKept(c);
    }

    /// <summary>Review finding 4: a created interface whose re-find fails was neither rolled back nor reported — the
    /// re-find ran outside the rollback. It rolls back now, like every other refusal of a create.</summary>
    [Fact]
    public void A_created_interface_that_cannot_be_found_is_rolled_back()
    {
        var ide = new FakeIde();
        ide.HiddenItems.Add("I_New");
        var resp = Push(ide, Create("I_New.itf", "INTERFACE I_New\nEND_INTERFACE\n"));

        Assert.Contains("create:I_New", ide.Recorded);   // premise: CreateChild ran
        Assert.False(ide.Exists("I_New"), "the create is rolled back");
        var c = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.NotFound, c.Code);
        Assert.Contains("'I_New' is not created (the create is rolled back)", c.Reason);
        AssertNothingKept(c);
    }

    [Fact]
    public void A_created_interface_that_cannot_be_found_nor_removed_remains()
    {
        var ide = new FakeIde { FailDelete = name => name == "I_New" ? new System.InvalidOperationException("the object is locked") : null };
        ide.HiddenItems.Add("I_New");
        var resp = Push(ide, Create("I_New.itf", "INTERFACE I_New\nEND_INTERFACE\n"));

        Assert.True(ide.Exists("I_New"), "premise: the rollback delete failed");
        var c = Assert.Single(resp.Conflicts!);
        Assert.Contains("'I_New' remains", c.Reason);
        Assert.True(c.PartiallyApplied);
        Assert.True(c.Remains);
    }

    // ── The wire shape: absent, not false/null ──────────────────────────────────────────────────────────────────

    /// <summary>"absent otherwise": a conflict that kept nothing serializes WITHOUT the three keys, so a client tests
    /// presence, and an older client sees exactly the shape it knew.</summary>
    [Fact]
    public void The_fields_are_absent_from_the_wire_when_nothing_stays()
    {
        var json = System.Text.Json.JsonSerializer.Serialize(new PushConflict { Name = "A.pou", Reason = "r", Code = "X" });
        Assert.DoesNotContain("partiallyApplied", json);
        Assert.DoesNotContain("renamedTo", json);
        Assert.DoesNotContain("remains", json);

        var kept = System.Text.Json.JsonSerializer.Serialize(new PushConflict
        {
            Name = "A.pou", Reason = "r", Code = "X", PartiallyApplied = true, RenamedTo = "B.pou", Remains = true,
        });
        Assert.Contains("\"partiallyApplied\":true", kept);
        Assert.Contains("\"renamedTo\":\"B.pou\"", kept);
        Assert.Contains("\"remains\":true", kept);
    }
}
