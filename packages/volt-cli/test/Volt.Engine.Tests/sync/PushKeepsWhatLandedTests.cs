using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A PUSH SAYS EXACTLY WHAT LANDED (openspec <c>push-keeps-what-landed</c>, design "Step 0").
///
/// <para>Two shapes made a client redo a whole batch. (1) The live IDE refuses an op after earlier ops were written:
/// the answer was <c>accepted:false</c> with what landed only as a count in prose ("NOTE: 2 of 3 item(s) were already
/// written … Run `volt pull` …") and no receipt — so a client could not tell which items to re-send. (2) The
/// pre-flight stopped at its FIRST refusal, so a batch with two malformed items cost two round trips.</para>
///
/// <para>What is built keeps the batch all-or-nothing for every refusal decidable before the first write (the
/// atomicity oracles — <c>PushServiceTests.A_batch_refused_on_a_LATER_op_writes_NONE_of_the_earlier_ones</c> and
/// friends — are untouched) and REPORTS the apply-time stop in structure: <c>accepted:true</c> + the receipt + a
/// conflict per op not landed. The live twin of the first test is <c>test/e2e/endpoints/push-keeps-what-landed.test.ts</c>.</para>
/// </summary>
public class PushKeepsWhatLandedTests
{
    private const string Enum = "TYPE E_A :\n(\n\ta,\n\tb\n);\nEND_TYPE";
    private const string Struct = "TYPE ST_B :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE";
    /// <summary>FUNCTION text with a METHOD — the member the IDE refuses by text (DIALECT C2k, modelled by
    /// <c>FakeIde.RefusesMembersByText</c>): a CLASSIFIED refusal (<c>ChildRefusedException</c>). It is NOT the path the
    /// live <c>METHOD Log</c> refusal takes today — that one reaches the engine unclassified (the CODESYS driver does
    /// not recognise "The name 'Log' is not valid for this object.", task 1.1), modelled by <see cref="FbWithMethod"/>
    /// + <c>FakeIde.FailCreate</c> below.</summary>
    private const string FunctionWithMethod =
        "FUNCTION F : BOOL\nVAR\nEND_VAR\nIMPLEMENTATION ST\nF := TRUE;\nEND_FUNCTION" +
        "\n\nMETHOD M : BOOL\nIMPLEMENTATION ST\nM := TRUE;\nEND_METHOD\n";

    /// <summary>A function block with a METHOD M — text every vendor accepts; the create of M is made to fail by
    /// <c>FakeIde.FailCreate</c>, the shape of the live <c>METHOD Log</c> refusal as it reaches the engine today.</summary>
    private const string FbWithMethod =
        "FUNCTION_BLOCK F\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK" +
        "\n\nMETHOD M : BOOL\nIMPLEMENTATION ST\nM := TRUE;\nEND_METHOD\n";

    /// <summary>The live CODESYS wording of the <c>Log</c> refusal (task 1.1), with the member renamed.</summary>
    private static System.Exception NotValidName(string name) =>
        new System.InvalidOperationException($"The name '{name}' is not valid for this object.");

    private static readonly string[] ClientAdvice = { "volt pull", "Pull first", "push again", "--force", "NOTE:" };

    private static PushResponse Push(FakeIde ide, params PushOp[] ops) =>
        PushService.Handle(ide, new PushRequest { ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion, Ops = ops.ToList() });

    private static SetItemOp Create(string wireName, string source) =>
        new() { Name = wireName, IfVersion = null, ToFolder = "", SourceText = source };

    /// <summary>Task 1.1, offline. Measured on this tree before the change: <c>accepted:false</c>, ONE conflict
    /// <c>F.pou [UNSUPPORTED]</c> ending "— NOTE: 2 of 3 item(s) were already written to the IDE … Run `volt pull` …,
    /// then push again.", NO <c>newItems</c>, while <c>E_A</c> and <c>ST_B</c> exist in the project.</summary>
    [Fact]
    public void An_apply_time_refusal_after_earlier_creates_is_accepted_with_the_receipt_and_names_only_the_refused_op()
    {
        var ide = new FakeIde { RefusesMembersByText = true };

        var resp = Push(ide, Create("E_A.dut", Enum), Create("ST_B.dut", Struct), Create("F.pou", FunctionWithMethod));

        // What the IDE holds — true today already: the earlier creates landed, the refused create rolled back whole.
        Assert.True(ide.Exists("E_A"));
        Assert.True(ide.Exists("ST_B"));
        Assert.False(ide.Exists("F"), "a refused create left its shell in the project");
        Assert.False(ide.Exists("M"));

        // What the RESPONSE says about it — the change.
        Assert.True(resp.Accepted, "two items landed, but the push answered accepted:false: " + resp.Conflicts?.FirstOrDefault()?.Reason);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal("F.pou", conflict.Name);
        Assert.Equal(BridgeErrorCodes.Unsupported, conflict.Code);
        Assert.Contains("refused to create its method 'M'", conflict.Reason);
        foreach (var advice in new[] { "volt pull", "Pull first", "push again", "--force", "NOTE:" })
            Assert.DoesNotContain(advice, conflict.Reason);

        // The receipt equals a fresh refs, as on every accepted push.
        Assert.NotNull(resp.NewItems);
        var refs = RefsService.Handle(ide);
        Assert.Equal(refs.ProjectVersion, resp.NewProjectVersion);
        Assert.Equal(refs.Items.OrderBy(k => k.Key), resp.NewItems!.OrderBy(k => k.Key));
        Assert.Contains("E_A.dut", resp.NewItems!.Keys);
        Assert.Contains("ST_B.dut", resp.NewItems!.Keys);
        Assert.DoesNotContain("F.pou", resp.NewItems!.Keys);
    }

    /// <summary>Task 1.2. Measured on this tree before the change: <c>accepted:false</c>, ONE conflict
    /// <c>Bad.pou [INVALID_ST]</c> — <c>Bad2.pou</c> is not named, so the client learns of it only on its second
    /// round trip; nothing recorded.</summary>
    [Fact]
    public void A_pre_flight_with_two_malformed_items_names_both_and_writes_nothing()
    {
        var ide = new FakeIde();

        var resp = Push(ide,
            Create("Good1.pou", "PROGRAM Good1\nIMPLEMENTATION ST\nEND_PROGRAM\n"),
            Create("Bad.pou", "not a POU at all"),
            Create("Bad2.pou", "not a POU either"),
            Create("Good2.pou", "PROGRAM Good2\nIMPLEMENTATION ST\nEND_PROGRAM\n"));

        Assert.False(resp.Accepted);
        Assert.Empty(ide.Recorded);   // all-or-nothing before the first write — unchanged
        Assert.Equal(new[] { "Bad.pou", "Bad2.pou" }, resp.Conflicts!.Select(c => c.Name).OrderBy(n => n).ToArray());
        Assert.All(resp.Conflicts!, c => Assert.Equal(BridgeErrorCodes.InvalidSt, c.Code));
        Assert.All(resp.Conflicts!, c => Assert.False(string.IsNullOrEmpty(c.Reason)));
    }
    /// <summary>Gate step 1 review: the REAL PLCAssist path, offline. The live <c>METHOD Log</c> refusal is an exception
    /// the driver does not classify, raised by <c>CreateChild</c> inside a create of a multi-op push — caught only by the
    /// rollback filter, so it reaches the client <c>INTERNAL_ERROR</c> with no word of the rollback (measured live,
    /// task 1.1). The engine cannot classify it (the CODESYS driver's <c>ChildRefusal</c> must — its own test), but
    /// whatever its code, the conflict must say what of the op the IDE kept: here nothing, the create rolled back.
    /// Measured on this tree before the change: <c>accepted:false</c>, one <c>F.pou [INTERNAL_ERROR]</c> "The name 'M'
    /// is not valid for this object. — NOTE: 2 of 3 …", no receipt; F rolled back.</summary>
    [Fact]
    public void An_unclassified_member_create_failure_after_earlier_creates_is_accepted_and_says_the_create_is_rolled_back()
    {
        var ide = new FakeIde { FailCreate = (name, kind) => kind == ItemKind.PlcMethod ? NotValidName(name) : null };

        var resp = Push(ide, Create("E_A.dut", Enum), Create("ST_B.dut", Struct), Create("F.pou", FbWithMethod));

        Assert.True(ide.Exists("E_A"));
        Assert.True(ide.Exists("ST_B"));
        Assert.False(ide.Exists("F"), "a failed create left its shell in the project");

        Assert.True(resp.Accepted, "two items landed, but the push answered accepted:false: " + resp.Conflicts?.FirstOrDefault()?.Reason);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal("F.pou", conflict.Name);
        Assert.Contains("The name 'M' is not valid for this object.", conflict.Reason);
        Assert.Contains("'F' is not created (the create is rolled back)", conflict.Reason);
        foreach (var advice in ClientAdvice) Assert.DoesNotContain(advice, conflict.Reason);
        Assert.NotNull(resp.NewItems);
        Assert.Contains("E_A.dut", resp.NewItems!.Keys);
        Assert.DoesNotContain("F.pou", resp.NewItems!.Keys);
    }

    /// <summary>Gate step 1 review: the rollback's OWN delete fails (spec "a refused create leaves nothing behind, or
    /// says it did"). The shell stays in the project; today that fact is only a <c>VoltLog.Warn</c> and never reaches
    /// the conflict. The conflict must say <c>F</c> remains, the receipt must list it (it IS in the next refs), and the
    /// reason must not claim a rollback that did not happen.</summary>
    [Fact]
    public void An_unclassified_failure_whose_rollback_delete_also_fails_says_the_shell_remains()
    {
        var ide = new FakeIde
        {
            FailCreate = (name, kind) => kind == ItemKind.PlcMethod ? NotValidName(name) : null,
            FailDelete = name => name == "F" ? new System.InvalidOperationException("the object is locked") : null,
        };

        var resp = Push(ide, Create("E_A.dut", Enum), Create("ST_B.dut", Struct), Create("F.pou", FbWithMethod));

        Assert.True(ide.Exists("F"), "premise: the rollback delete failed, so the shell is in the project");
        Assert.True(resp.Accepted, "two items landed, but the push answered accepted:false: " + resp.Conflicts?.FirstOrDefault()?.Reason);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal("F.pou", conflict.Name);
        Assert.Contains("'F' remains", conflict.Reason);
        Assert.DoesNotContain("rolled back)", conflict.Reason);
        foreach (var advice in ClientAdvice) Assert.DoesNotContain(advice, conflict.Reason);
        var refs = RefsService.Handle(ide);
        Assert.Equal(refs.Items.OrderBy(k => k.Key), resp.NewItems!.OrderBy(k => k.Key));
    }

    /// <summary>Gate step 1 review: the CLASSIFIED refusal (DIALECT C2k) with a failing rollback delete. Its reason is
    /// worded by <c>MemberRefusal</c> BEFORE the rollback runs, so today it states "'F' is not created (the create is
    /// rolled back)" while F stays in the project — a reason that lies about the state the client must act on.</summary>
    [Fact]
    public void A_classified_member_refusal_whose_rollback_delete_fails_does_not_claim_the_rollback()
    {
        var ide = new FakeIde
        {
            RefusesMembersByText = true,
            FailDelete = name => name == "F" ? new System.InvalidOperationException("the object is locked") : null,
        };

        var resp = Push(ide, Create("E_A.dut", Enum), Create("ST_B.dut", Struct), Create("F.pou", FunctionWithMethod));

        Assert.True(ide.Exists("F"), "premise: the rollback delete failed, so the shell is in the project");
        Assert.True(resp.Accepted, "two items landed, but the push answered accepted:false: " + resp.Conflicts?.FirstOrDefault()?.Reason);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.Unsupported, conflict.Code);
        Assert.Contains("'F' remains", conflict.Reason);
        Assert.DoesNotContain("rolled back)", conflict.Reason);
    }

    /// <summary>Task 2.1 (review R5): the gate's PER-ITEM conflicts no longer answer before the pre-flight. The pre-flight
    /// runs over the ops the gate did not name and the response is the UNION, in request order, nothing written.
    /// Measured on this tree before the change: ONE conflict <c>A.pou [STALE_ITEM_VERSION]</c> — the gate returned
    /// before the pre-flight ran, so <c>B</c>'s malformed text cost a second round trip.</summary>
    [Fact]
    public void A_stale_item_and_a_malformed_item_are_named_together_and_nothing_is_written()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("A", "PROGRAM A\nVAR\nEND_VAR", "x := 1;"));
        var lease = RefsService.Handle(ide).ProjectVersion;

        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = lease,
            Ops = new List<PushOp>
            {
                new SetItemOp { Name = "A.pou", IfVersion = "stale0000000", SourceText = "PROGRAM A\nVAR\nEND_VAR\nIMPLEMENTATION ST\nx := 2;\nEND_PROGRAM\n" },
                Create("B.pou", "not a POU at all"),
            },
        });

        Assert.False(resp.Accepted);
        Assert.Empty(ide.Recorded);
        Assert.Equal(new[] { ("A.pou", ConflictCodes.StaleItemVersion), ("B.pou", BridgeErrorCodes.InvalidSt) },
                     resp.Conflicts!.Select(c => (c.Name, c.Code)).ToArray());
    }

    /// <summary>Task 2.1: the LEASE is still answered without the pre-flight — the client must pull before any item's
    /// verdict means anything (spec "answered alone").</summary>
    [Fact]
    public void A_stale_lease_is_answered_without_the_pre_flight()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("A", "PROGRAM A\nVAR\nEND_VAR", "x := 1;"));

        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = "not-the-lease",
            Ops = new List<PushOp> { Create("B.pou", "not a POU at all") },
        });

        Assert.False(resp.Accepted);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal(ConflictCodes.StaleProjectVersion, conflict.Code);
    }

    /// <summary>Task 2.4: every op after the refused one in APPLY order (<c>InFolderDepthOrder</c>, deepest folder first
    /// — not request order) is named <c>NOT_ATTEMPTED</c>, so "each op landed unless a conflict names it" holds. Request
    /// <c>[F (root), E_A (in Sub), ST_B (root)]</c> applies <c>E_A, F, ST_B</c>: E_A lands although it comes after F in the
    /// request, F is refused, ST_B is not reached.</summary>
    [Fact]
    public void Every_op_after_the_refused_one_in_apply_order_is_named_not_attempted()
    {
        var ide = new FakeIde { RefusesMembersByText = true };

        var resp = Push(ide,
            Create("F.pou", FunctionWithMethod),
            new SetItemOp { Name = "E_A.dut", IfVersion = null, ToFolder = "Sub", SourceText = Enum },
            Create("ST_B.dut", Struct));

        Assert.True(ide.Exists("E_A"));
        Assert.False(ide.Exists("F"));
        Assert.False(ide.Exists("ST_B"), "an op after the refusal was applied — the push must stop at the refused op");

        Assert.True(resp.Accepted, "E_A landed, but the push answered accepted:false: " + resp.Conflicts?.FirstOrDefault()?.Reason);
        Assert.Equal(new[] { ("F.pou", BridgeErrorCodes.Unsupported), ("ST_B.dut", ConflictCodes.NotAttempted) },
                     resp.Conflicts!.Select(c => (c.Name, c.Code)).ToArray());
        Assert.Equal("not applied: the push stopped at 'F.pou'", resp.Conflicts![1].Reason);
        Assert.Contains("E_A.dut", resp.NewItems!.Keys);
        Assert.DoesNotContain("ST_B.dut", resp.NewItems!.Keys);
        Assert.Equal(RefsService.Handle(ide).ProjectVersion, resp.NewProjectVersion);
    }

    /// <summary>Task 2.4: nothing applied in full → <c>accepted:false</c> as today, and no NOTE.</summary>
    [Fact]
    public void A_refusal_of_the_first_op_is_rejected_without_a_note_and_names_the_rest_not()
    {
        var ide = new FakeIde { RefusesMembersByText = true };

        var resp = Push(ide, Create("F.pou", FunctionWithMethod), Create("ST_B.dut", Struct));

        Assert.False(resp.Accepted);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal("F.pou", conflict.Name);
        Assert.Contains("'F' is not created (the create is rolled back)", conflict.Reason);
        foreach (var advice in ClientAdvice) Assert.DoesNotContain(advice, conflict.Reason);
        Assert.False(ide.Exists("ST_B"));
        Assert.Null(resp.NewItems);
    }

    /// <summary>Task 2.5 (review R2): a refusal raised INSIDE the apply loop can now arrive on an accepted push, so its
    /// reason carries no client instruction. <c>[create A, update B]</c>, B edited in the IDE after the gate hashed it:
    /// A lands, B is refused by the last-moment check. Measured before the change: "… refusing to overwrite it. Pull\n    /// first, then push again."</summary>
    [Fact]
    public void A_race_refused_after_another_op_landed_carries_no_client_instruction()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("B", "PROGRAM B\nVAR\nEND_VAR", "x := 1;"));
        var refs = RefsService.Handle(ide);
        var reads = 0;
        ide.OnReadContent = (fake, item) =>
        {
            if (fake.Name(item) != "B" || ++reads != 2) return;   // the walk's read, then the write's: the window
            fake.OnReadContent = null;
            fake.EditImplementation("B", "x := 999;   // the engineer's edit");
        };

        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                Create("E_A.dut", Enum),
                new SetItemOp { Name = "B.pou", IfVersion = refs.Items["B.pou"], SourceText = "PROGRAM B\nVAR\nEND_VAR\nIMPLEMENTATION ST\nx := 2;\nEND_PROGRAM\n" },
            },
        });

        Assert.True(resp.Accepted, "E_A landed, but the push answered accepted:false: " + resp.Conflicts?.FirstOrDefault()?.Reason);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal("B.pou", conflict.Name);
        Assert.Contains("changed in the IDE while this push was being applied", conflict.Reason);
        // A stale item version, coded as one (openspec bridge-refusal-review 2.14) — it answered BAD_REQUEST.
        Assert.Equal(ConflictCodes.StaleItemVersion, conflict.Code);
        // …in the pre-apply gate's SHAPE too (task 8.4, 1+2d review): the version the client sent and the IDE's now.
        Assert.Equal(refs.Items["B.pou"], conflict.YourVersion);
        Assert.Equal(RefsService.Handle(ide).Items["B.pou"], conflict.CurrentVersion);
        foreach (var advice in ClientAdvice.Append("pull first")) Assert.DoesNotContain(advice, conflict.Reason);
    }

    /// <summary>Spec "whatever of the refused op itself the IDE kept … SHALL be stated in that op's conflict reason", for
    /// a refusal the driver does NOT classify. An update whose declaration changes and which adds a method writes the
    /// declaration first (DIALECT C2k order); the method create then fails unclassified. The classified refusal said so
    /// (<c>MemberRefusal</c>); this one said only the vendor's words, while the IDE kept the new declaration. Measured
    /// before the change: reason "The name 'M' is not valid for this object." and nothing else.</summary>
    [Fact]
    public void An_unclassified_failure_of_an_update_after_its_declaration_landed_says_the_declaration_stays()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("K", "FUNCTION_BLOCK K\nVAR\nEND_VAR", ";"))
        {
            FailCreate = (name, kind) => kind == ItemKind.PlcMethod ? NotValidName(name) : null,
        };
        var refs = RefsService.Handle(ide);

        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp { Name = "K.pou", IfVersion = refs.Items["K.pou"], SourceText =
                    "FUNCTION_BLOCK K\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK" +
                    "\n\nMETHOD M : BOOL\nIMPLEMENTATION ST\nM := TRUE;\nEND_METHOD\n" },
            },
        });

        Assert.Contains("n : INT;", ide.WrittenContent["K"].Declaration);   // premise: the declaration landed
        Assert.False(resp.Accepted);   // nothing applied IN FULL (step 0 R1)
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Contains("The name 'M' is not valid for this object.", conflict.Reason);
        Assert.Contains("the declaration of 'K' was written before it and stays", conflict.Reason);
    }

    /// <summary>Task 2.2 (a), measured live 2026-10-03 on CODESYS SP21 (own instance, fixture copy): a TOP-LEVEL create
    /// named like a refused identifier is refused with the same words as the member — <c>LOG.pou</c> "The name 'LOG' is
    /// not valid for this object.", <c>Log.dut</c> likewise, nothing created. The driver now classifies that wording
    /// (a NAME refusal), and the push words it as the ITEM's refusal, not a member's. Nothing was created, so the reason
    /// claims no rollback.</summary>
    [Fact]
    public void A_top_level_create_whose_name_the_IDE_refuses_is_worded_as_the_items_refusal()
    {
        var ide = new FakeIde
        {
            FailCreate = (name, kind) => name == "LOG"
                ? new Volt.Engine.Ide.ChildRefusedException($"The name '{name}' is not valid for this object.",
                                                            Volt.Engine.Ide.ChildRefusalCause.Name)
                : null,
        };

        var resp = Push(ide, Create("LOG.pou", "FUNCTION_BLOCK LOG\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK\n"));

        Assert.False(resp.Accepted);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.Unsupported, conflict.Code);
        Assert.Equal("the IDE refused to create 'LOG': The name 'LOG' is not valid for this object.", conflict.Reason);
        Assert.False(ide.Exists("LOG"));
    }

    /// <summary>Step 2 review (finding 5): the hidden-body guard (<c>BodyFormatGuard.RequireWritable</c>) runs only at
    /// APPLY, so its refusal can reach a conflict on an accepted push — and its reason ended "…, or pull first.", the
    /// client instruction the spec names. Matched without case: the task's own grep was case-sensitive and missed it.</summary>
    [Fact]
    public void A_hidden_body_refused_at_apply_after_another_op_landed_carries_no_client_instruction()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("B", "PROGRAM B\nVAR\nEND_VAR", "x := 1;"));
        var refs = RefsService.Handle(ide);

        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                Create("E_A.dut", Enum),
                new SetItemOp { Name = "B.pou", IfVersion = refs.Items["B.pou"],
                                SourceText = "PROGRAM B\nVAR\nEND_VAR\nIMPLEMENTATION LD UNSUPPORTED\nEND_PROGRAM\n" },
            },
        });

        Assert.True(resp.Accepted, "E_A landed, but the push answered accepted:false: " + resp.Conflicts?.FirstOrDefault()?.Reason);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal("B.pou", conflict.Name);
        foreach (var advice in ClientAdvice.Append("pull first"))
            Assert.DoesNotContain(advice, conflict.Reason, System.StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Step 2 review (finding 3): a RENAME+EDIT whose content write is refused AFTER the native rename ran. The
    /// rename — the IDE rewriting every reference — is kept, and the IDE now holds <c>Y</c>, no <c>X</c>; the reason must
    /// say so (spec "whatever of the refused op itself the IDE kept SHALL be stated"), or a client re-sends the op against
    /// a name that is gone. Measured before the fix: the reason named only the member refusal.</summary>
    [Fact]
    public void A_rename_whose_edit_is_refused_after_the_rename_ran_says_the_rename_stays()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("X", "FUNCTION_BLOCK X\nVAR\nEND_VAR", ";"))
        {
            FailCreate = (name, kind) => kind == ItemKind.PlcMethod
                ? new Volt.Engine.Ide.ChildRefusedException($"The name '{name}' is not valid for this object.",
                                                            Volt.Engine.Ide.ChildRefusalCause.Name)
                : null,
        };
        var refs = RefsService.Handle(ide);

        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                Create("A.dut", Struct),
                new SetItemOp { Name = "X.pou", ToName = "Y.pou", IfVersion = refs.Items["X.pou"], SourceText =
                    "FUNCTION_BLOCK Y\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK" +
                    "\n\nMETHOD M : BOOL\nIMPLEMENTATION ST\nM := TRUE;\nEND_METHOD\n" },
            },
        });

        Assert.True(ide.Exists("Y"), "premise: the native rename ran before the refused write");
        Assert.False(ide.Exists("X"));
        Assert.True(resp.Accepted, "A landed, but the push answered accepted:false: " + resp.Conflicts?.FirstOrDefault()?.Reason);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal("X.pou", conflict.Name);
        Assert.Contains("'X' was renamed to 'Y'", conflict.Reason);
        Assert.Contains("stays renamed", conflict.Reason);
        foreach (var advice in ClientAdvice) Assert.DoesNotContain(advice, conflict.Reason);
        Assert.Contains("Y.pou", resp.NewItems!.Keys);
    }

    /// <summary>Step 2 review (finding 4): an UPDATE that adds a member under an UNCHANGED declaration, whose final content
    /// write is then refused. The member create ran first and the IDE keeps it (with its seed text); the reason must say
    /// so. Measured before the fix: the bare refusal, while <c>ReadContent(K)</c> listed <c>M</c>.</summary>
    [Fact]
    public void An_update_refused_after_it_created_a_member_says_the_member_stays()
    {
        FakeIde ide = null!;
        ide = new FakeIde(FakeIde.Item.TextualPou("K", "FUNCTION_BLOCK K\nVAR\nEND_VAR", ";"))
        {
            RefuseContentWrite = item => ide.Name(item) == "K"
                ? new System.InvalidOperationException("the IDE could not write 'K'") : null,
        };
        var refs = RefsService.Handle(ide);

        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp { Name = "K.pou", IfVersion = refs.Items["K.pou"], SourceText =
                    "FUNCTION_BLOCK K\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK" +
                    "\n\nMETHOD M : BOOL\nIMPLEMENTATION ST\nM := TRUE;\nEND_METHOD\n" },
            },
        });

        Assert.True(ide.Exists("M"), "premise: the member create ran before the refused write");
        Assert.False(resp.Accepted);   // nothing applied IN FULL (step 0 R1)
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Contains("the IDE could not write 'K'", conflict.Reason);
        Assert.Contains("its method 'M' was created before it and stays", conflict.Reason);
    }

    /// <summary>Step 2 review (finding 4): the FORCED replace of an item the IDE will not open deletes the old object,
    /// then creates the pushed one — and when that create fails the old object is gone. The reason must say so.
    /// Measured before the fix: the bare create failure.</summary>
    [Fact]
    public void A_forced_replace_whose_create_fails_says_the_original_was_deleted()
    {
        var failCreate = false;
        var ide = new FakeIde
        {
            FailCreate = (name, _) => failCreate && name == "Broken"
                ? new System.InvalidOperationException("the IDE could not create 'Broken'") : null,
        };
        Push(ide, new SetItemOp { Name = "Broken.pou", ToFolder = "Data", SourceText =
            "FUNCTION_BLOCK Broken\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK\n" });
        Assert.True(ide.Exists("Broken"));
        ide.UnopenedItems.Add("Broken");
        failCreate = true;

        var resp = PushService.Handle(ide, new PushRequest
        {
            Force = true,
            Ops = new List<PushOp> { new SetItemOp { Name = "Broken.pou", SourceText =
                "FUNCTION_BLOCK Broken\nVAR\nEND_VAR\nIMPLEMENTATION ST\nn := 1;\nEND_FUNCTION_BLOCK\n" } },
        });

        Assert.False(ide.Exists("Broken"), "premise: the replace deleted the original before its create failed");
        Assert.False(resp.Accepted);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Contains("the IDE could not create 'Broken'", conflict.Reason);
        Assert.Contains("the IDE's 'Broken' was deleted before it", conflict.Reason);
    }

    // ── Gate step 2, round 2 (2026-10-03): every mutation an UPDATE makes before a later step of it is refused is named,
    // not only the members it deleted or created — an accessor deleted or created, a member moved, a POU-internal folder
    // created, and a move+edit's content write (spec "whatever of the refused op itself the IDE kept").

    private const string PropDecl = "FUNCTION_BLOCK FB_X\nVAR\n\t_v : INT;\nEND_VAR";

    /// <summary>FB_X with a PROPERTY P holding the accessors named.</summary>
    private static FakeIde.Item[] WithProperty(params string[] accessors) =>
        new[]
        {
            new FakeIde.Item("FB_X", ItemKind.PlcPou, "", true, PropDecl, "", null, null, Children: new[] { "P" }),
            new FakeIde.Item("P", ItemKind.PlcProp, "", false, "PROPERTY P : INT", null, null, null, Children: accessors),
        }.Concat(accessors.Select(a => new FakeIde.Item(a, a == "Get" ? ItemKind.PlcPropGet : ItemKind.PlcPropSet, "", false,
                                                        "VAR\nEND_VAR", a == "Get" ? "P := _v;" : "_v := P;", null, null)))
         .ToArray();

    private static string PropertySource(bool get, bool set)
    {
        var src = $"{PropDecl}\nIMPLEMENTATION ST\nEND_FUNCTION_BLOCK\n\nPROPERTY P : INT\n";
        if (get) src += "GET\nVAR\nEND_VAR\nIMPLEMENTATION ST\nP := _v;\nEND_GET\n";
        if (set) src += "SET\nVAR\nEND_VAR\nIMPLEMENTATION ST\n_v := P;\nEND_SET\n";
        return src + "END_PROPERTY\n";
    }

    /// <summary>Review finding 1 (repro as written): the IDE's P has only a GET; the pushed P has only a SET. The GET is
    /// deleted, then the SET's create is refused (CODESYS has no call to add an accessor) — and the GET stays deleted.
    /// Measured before the fix: the reason was the refusal alone; nothing said P lost its GET.</summary>
    [Fact]
    public void An_update_refused_after_it_deleted_an_accessor_says_the_accessor_stays_deleted()
    {
        var ide = new FakeIde(WithProperty("Get"))
        {
            FailCreate = (_, kind) => kind == ItemKind.PlcPropSet
                ? new System.NotSupportedException("the IDE cannot create the 'Set' accessor") : null,
        };
        var refs = RefsService.Handle(ide);

        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                Create("ST_B.dut", Struct),
                new SetItemOp { Name = "FB_X.pou", IfVersion = refs.Items["FB_X.pou"], SourceText = PropertySource(get: false, set: true) },
            },
        });

        Assert.False(ide.Exists("Get"), "premise: the GET was deleted before the SET was refused");
        Assert.True(resp.Accepted, "ST_B landed, but the push answered accepted:false: " + resp.Conflicts?.FirstOrDefault()?.Reason);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal("FB_X.pou", conflict.Name);
        Assert.Equal(BridgeErrorCodes.Unsupported, conflict.Code);
        Assert.Contains("the IDE cannot create the 'Set' accessor", conflict.Reason);
        Assert.Contains("the Get accessor of property 'P' was deleted before it and stays deleted", conflict.Reason);
        foreach (var advice in ClientAdvice) Assert.DoesNotContain(advice, conflict.Reason);
    }

    /// <summary>Review finding 1: an accessor CREATED before the content write refused stays (TwinCAT creates a missing
    /// accessor natively), empty.</summary>
    [Fact]
    public void An_update_refused_after_it_created_an_accessor_says_the_accessor_stays()
    {
        FakeIde ide = null!;
        ide = new FakeIde(WithProperty("Get"))
        {
            RefuseContentWrite = item => ide.Name(item) == "FB_X" ? new System.InvalidOperationException("the IDE could not write 'FB_X'") : null,
        };
        var refs = RefsService.Handle(ide);

        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp { Name = "FB_X.pou", IfVersion = refs.Items["FB_X.pou"], SourceText = PropertySource(get: true, set: true) },
            },
        });

        Assert.Contains(ide.Recorded, r => r == "create:Set");   // premise
        Assert.False(resp.Accepted);   // nothing applied IN FULL (step 0 R1)
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Contains("the IDE could not write 'FB_X'", conflict.Reason);
        Assert.Contains("the Set accessor of property 'P' was created before it and stays", conflict.Reason);
    }

    /// <summary>Review finding 1: a member MOVED to another POU-internal folder — and the folder CREATED for it — before
    /// the content write refused stay.</summary>
    [Fact]
    public void An_update_refused_after_it_moved_a_member_says_the_move_and_the_new_folder_stay()
    {
        FakeIde ide = null!;
        ide = new FakeIde(
            new FakeIde.Item("FB_Test", ItemKind.PlcPou, "", true,
                "FUNCTION_BLOCK FB_Test\nVAR\n\tn : INT;\nEND_VAR", "n := n + 1;", null, null, Children: new[] { "DoIt" }),
            new FakeIde.Item("DoIt", ItemKind.PlcMethod, "", false, "METHOD DoIt : BOOL", "DoIt := TRUE;", null, null))
        {
            RefuseContentWrite = item => ide.Name(item) == "FB_Test" ? new System.InvalidOperationException("the IDE could not write 'FB_Test'") : null,
        };
        var refs = RefsService.Handle(ide);

        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                Create("ST_B.dut", Struct),
                new SetItemOp { Name = "FB_Test.pou", IfVersion = refs.Items["FB_Test.pou"], SourceText =
                    "FUNCTION_BLOCK FB_Test\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := n + 1;\nEND_FUNCTION_BLOCK\n\n" +
                    "METHOD DoIt : BOOL\nIMPLEMENTATION ST\n%FOLDER Helpers\nDoIt := TRUE;\nEND_METHOD\n" },
            },
        });

        Assert.Contains(ide.Recorded, r => r.StartsWith("move:DoIt->", System.StringComparison.Ordinal));   // premise
        Assert.True(resp.Accepted, "ST_B landed, but the push answered accepted:false: " + resp.Conflicts?.FirstOrDefault()?.Reason);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal("FB_Test.pou", conflict.Name);
        Assert.Contains("the folder 'Helpers' was created in 'FB_Test' before it and stays", conflict.Reason);
        Assert.Contains("its method 'DoIt' was moved to 'Helpers' before it and stays there", conflict.Reason);
    }

    /// <summary>Review finding 3: a move+edit writes the pushed text IN PLACE first, then moves. When the move is refused
    /// the text has landed — and the destination folder the move resolved was created — and the reason must say so; on a
    /// single-op push the answer is <c>accepted:false</c>, so the reason is the only place it can be said.</summary>
    [Fact]
    public void A_move_refused_after_its_edit_was_written_says_the_text_and_the_folder_stay()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("FB_M", "FUNCTION_BLOCK FB_M\nVAR\nEND_VAR", ";", folder: "A"))
        {
            FailMove = name => name == "FB_M" ? new System.InvalidOperationException("the IDE could not move 'FB_M'") : null,
        };
        var refs = RefsService.Handle(ide);
        const string edited = "FUNCTION_BLOCK FB_M\nVAR\nEND_VAR\nIMPLEMENTATION ST\nn := 2;\nEND_FUNCTION_BLOCK\n";

        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                // Deeper than the move's destination, so it applies FIRST (ops run deepest folder first).
                new SetItemOp { Name = "ST_B.dut", IfVersion = null, ToFolder = "X/Y", SourceText = Struct },
                new SetItemOp { Name = "FB_M.pou", IfVersion = refs.Items["FB_M.pou"], ToFolder = "B", SourceText = edited },
            },
        });

        Assert.Contains("n := 2;", FakeIde.AllText(ide.WrittenContent["FB_M"]));   // premise: the text landed
        Assert.True(resp.Accepted, "ST_B landed, but the push answered accepted:false: " + resp.Conflicts?.FirstOrDefault()?.Reason);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal("FB_M.pou", conflict.Name);
        Assert.Contains("the IDE could not move 'FB_M'", conflict.Reason);
        Assert.Contains("the pushed text of 'FB_M' was written before it and stays", conflict.Reason);
        Assert.Contains("the folder 'B' was created before it and stays", conflict.Reason);
    }

    /// <summary>Review finding 3: the move landed and the SECOND write (the one that re-applies the edit to the moved item)
    /// is refused — the text written first, the move and the folder all stay.</summary>
    [Fact]
    public void A_move_whose_second_write_is_refused_says_the_move_stays()
    {
        var writes = 0;
        FakeIde ide = null!;
        ide = new FakeIde(FakeIde.Item.TextualPou("FB_M", "FUNCTION_BLOCK FB_M\nVAR\nEND_VAR", ";", folder: "A"))
        {
            RefuseContentWrite = item => ide.Name(item) == "FB_M" && ++writes == 2
                ? new System.InvalidOperationException("the IDE could not write 'FB_M' again") : null,
        };
        var refs = RefsService.Handle(ide);

        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp { Name = "FB_M.pou", IfVersion = refs.Items["FB_M.pou"], ToFolder = "B", SourceText =
                    "FUNCTION_BLOCK FB_M\nVAR\nEND_VAR\nIMPLEMENTATION ST\nn := 2;\nEND_FUNCTION_BLOCK\n" },
            },
        });

        Assert.Contains(ide.Recorded, r => r.StartsWith("move:FB_M->", System.StringComparison.Ordinal));   // premise
        Assert.False(resp.Accepted);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Contains("the IDE could not write 'FB_M' again", conflict.Reason);
        Assert.Contains("the pushed text of 'FB_M' was written before it and stays", conflict.Reason);
        Assert.Contains("'FB_M' was moved to 'B' before it and stays there", conflict.Reason);
    }

    // ── Task 3.1: a NAME the IDE refuses is refused before the first write ─────────────────────────────────────────

    /// <summary>A driver whose IDE refuses the word <c>Log</c> (any case) as a POU or member name — what both real
    /// drivers answer from their measured lists (<c>ICodeStore.RefusedName</c>).</summary>
    private static FakeIde RefusingLog(params FakeIde.Item[] items) => new(items)
    {
        RefusesName = (_, name) => string.Equals(name, "Log", System.StringComparison.OrdinalIgnoreCase)
            ? $"the IDE does not take the name '{name}'" : null,
    };

    /// <summary>Task 3.1. Measured on this tree before the change: the METHOD reached the IDE AFTER the DUT landed —
    /// <c>accepted:true</c>, <c>E_A</c> created, the FB the one conflict. A word the vendor was measured to refuse is
    /// decidable from the text, so it belongs to the pre-flight: nothing is written.</summary>
    [Fact]
    public void A_member_named_with_a_word_the_IDE_refuses_is_refused_before_the_first_write()
    {
        var ide = RefusingLog();

        var resp = Push(ide, Create("E_A.dut", Enum), Create("F.pou", FbWithMethod.Replace("METHOD M", "METHOD log").Replace("M := TRUE", "log := TRUE")));

        Assert.False(resp.Accepted);
        Assert.Empty(ide.Recorded);   // nothing written — the DUT before it included
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal("F.pou", conflict.Name);
        Assert.Equal(BridgeErrorCodes.Unsupported, conflict.Code);
        Assert.Contains("method 'log'", conflict.Reason);
        Assert.Contains("the IDE does not take the name 'log'", conflict.Reason);
    }

    /// <summary>Task 3.1: an UPDATE that adds the member is the same create of a member, refused the same way.</summary>
    [Fact]
    public void An_update_adding_a_member_named_with_a_refused_word_is_refused_before_the_first_write()
    {
        var ide = RefusingLog(FakeIde.Item.TextualPou("K", "FUNCTION_BLOCK K\nVAR\nEND_VAR", ";"));
        var refs = RefsService.Handle(ide);

        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                Create("E_A.dut", Enum),
                new SetItemOp { Name = "K.pou", IfVersion = refs.Items["K.pou"], SourceText =
                    "FUNCTION_BLOCK K\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK" +
                    "\n\nACTION Log\nIMPLEMENTATION ST\n;\nEND_ACTION\n" },
            },
        });

        Assert.False(resp.Accepted);
        Assert.Empty(ide.Recorded);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal("K.pou", conflict.Name);
        Assert.Contains("action 'Log'", conflict.Reason);
    }

    /// <summary>Task 3.1: a top-level POU create under a refused word (CODESYS measured <c>LOG.pou</c>, task 2.2).</summary>
    [Fact]
    public void A_POU_create_named_with_a_refused_word_is_refused_before_the_first_write()
    {
        var ide = RefusingLog();

        var resp = Push(ide, Create("E_A.dut", Enum), Create("LOG.pou", "FUNCTION_BLOCK LOG\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK\n"));

        Assert.False(resp.Accepted);
        Assert.Empty(ide.Recorded);
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal("LOG.pou", conflict.Name);
        Assert.Equal(BridgeErrorCodes.Unsupported, conflict.Code);
        Assert.Contains("the IDE does not take the name 'LOG'", conflict.Reason);
    }

    /// <summary>Task 3.1: a word the driver does not answer passes the pre-flight — the check refuses only what the
    /// vendor was measured to refuse, and the push lands.</summary>
    [Fact]
    public void A_name_the_driver_does_not_refuse_lands()
    {
        var ide = RefusingLog();

        var resp = Push(ide, Create("E_A.dut", Enum), Create("F.pou", FbWithMethod));

        Assert.True(resp.Accepted, resp.Conflicts?.FirstOrDefault()?.Reason);
        Assert.True(ide.Exists("F"));
    }

    /// <summary>bridge-refusal-review 3.1: a name whose SHAPE the IDE refuses (no ASCII identifier) is the driver's
    /// measured answer for an INTERFACE member too — both vendors refused all six kinds — so the pre-flight asks the
    /// driver for interface members, with the member's kind. It was the reader's unmeasured INVALID_ST before.</summary>
    [Fact]
    public void An_interface_member_named_in_a_shape_the_IDE_refuses_is_refused_before_the_first_write()
    {
        var asked = new List<(string Kind, string Name)>();
        var ide = new FakeIde
        {
            RefusesName = (kind, name) =>
            {
                asked.Add((kind, name));
                return name == "My-Name" ? $"the IDE does not take the name '{name}'" : null;
            },
        };

        var resp = Push(ide, Create("E_A.dut", Enum),
            Create("I_X.itf", "INTERFACE I_X\nMETHOD Fine : BOOL\nEND_METHOD\nPROPERTY My-Name : INT\nEND_PROPERTY\nEND_INTERFACE"));

        Assert.False(resp.Accepted);
        Assert.Empty(ide.Recorded);   // nothing written — the DUT before it included
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal("I_X.itf", conflict.Name);
        Assert.Equal(BridgeErrorCodes.Unsupported, conflict.Code);
        Assert.Contains("interface_property 'My-Name'", conflict.Reason);
        Assert.Contains((ItemKind.Kinds.InterfaceMethod, "Fine"), asked);
        Assert.Contains((ItemKind.Kinds.InterfaceProperty, "My-Name"), asked);
    }

    /// <summary>bridge-refusal-review 3.1: the POU create is asked with its kind, so a driver answers its words only where
    /// they were measured.</summary>
    [Fact]
    public void The_name_pre_flight_asks_with_the_kind_it_creates()
    {
        var asked = new List<(string Kind, string Name)>();
        var ide = new FakeIde { RefusesName = (kind, name) => { asked.Add((kind, name)); return null; } };

        var resp = Push(ide, Create("F.pou", FbWithMethod));

        Assert.True(resp.Accepted, resp.Conflicts?.FirstOrDefault()?.Reason);
        Assert.Contains((ItemKind.Kinds.Pou, "F"), asked);
        Assert.Contains((ItemKind.Kinds.Method, "M"), asked);
    }

    // ── bridge-refusal-review 2.4/2.6 (1+2d review): a member create the IDE refuses from its ARGUMENT ─────────────────

    /// <summary>TwinCAT's refusal of an interface member that states no type (<c>BeckhoffDriver.UntypedInterfaceMember</c>),
    /// as the fake models it: the pre-flight predicate and <c>CreateChild</c> answer alike.</summary>
    private static FakeIde RefusingUntypedInterfaceMembers(params FakeIde.Item[] items) => new(items)
    {
        RefusesMemberCreate = (kind, name, seed) =>
            kind == ItemKind.Kinds.InterfaceProperty && string.IsNullOrWhiteSpace(seed)
                ? $"the interface property '{name}' states no type" : null,
    };

    private const string ItfTyped = "INTERFACE I_X\nMETHOD M : BOOL\nEND_METHOD\nPROPERTY P : INT\nEND_PROPERTY\nEND_INTERFACE";
    private const string ItfUntyped = "INTERFACE I_X\nMETHOD M : BOOL\nEND_METHOD\nPROPERTY P\nEND_PROPERTY\nEND_INTERFACE";

    /// <summary>Measured on this tree before the fix: the pre-flight passed, <c>E_A</c> landed, <c>I_X</c> and its method
    /// were created, and the property's create then threw — UNSUPPORTED after a partial write. The refusal is decidable
    /// from the text and the driver's predicate, so it belongs to the pre-flight: nothing is written.</summary>
    [Fact]
    public void A_new_interface_member_the_IDE_cannot_create_without_a_type_is_refused_before_the_first_write()
    {
        var ide = RefusingUntypedInterfaceMembers();

        var resp = Push(ide, Create("E_A.dut", Enum), Create("I_X.itf", ItfUntyped));

        Assert.False(resp.Accepted);
        Assert.Empty(ide.Recorded);   // nothing written — the DUT before it included
        var conflict = Assert.Single(resp.Conflicts!);
        Assert.Equal("I_X.itf", conflict.Name);
        Assert.Equal(BridgeErrorCodes.Unsupported, conflict.Code);
        Assert.Contains("interface property 'P'", conflict.Reason);
        Assert.Contains("states no type", conflict.Reason);
    }

    /// <summary>An update that ADDS the untyped member is the same create, refused the same way; an update of a member
    /// the IDE already holds is written through, never created, so it is not asked about — its declaration is the
    /// build's to judge.</summary>
    [Fact]
    public void An_update_is_refused_only_for_the_untyped_member_it_would_create()
    {
        var ide = RefusingUntypedInterfaceMembers();
        Assert.True(Push(ide, Create("I_X.itf", ItfTyped)).Accepted);   // premise: P exists, typed
        ide.Recorded.Clear();

        var held = RefsService.Handle(ide);
        var adding = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = held.ProjectVersion,
            Ops = new List<PushOp>
            {
                Create("E_A.dut", Enum),
                new SetItemOp { Name = "I_X.itf", IfVersion = held.Items["I_X.itf"],
                                SourceText = ItfTyped.Replace("END_INTERFACE", "PROPERTY Q\nEND_PROPERTY\nEND_INTERFACE") },
            },
        });
        Assert.False(adding.Accepted);
        Assert.Empty(ide.Recorded);
        Assert.Contains("interface property 'Q'", Assert.Single(adding.Conflicts!).Reason);

        var rewriting = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = held.ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = "I_X.itf", IfVersion = held.Items["I_X.itf"], SourceText = ItfUntyped } },
        });
        Assert.True(rewriting.Accepted, string.Join("; ", (rewriting.Conflicts ?? new()).Select(c => c.Reason)));
    }
}
