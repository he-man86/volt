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
}
