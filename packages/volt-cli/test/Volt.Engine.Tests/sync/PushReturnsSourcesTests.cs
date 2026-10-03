using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// THE PUSH ANSWER CARRIES WHAT A FETCH WOULD GIVE (openspec <c>st-roundtrip-fixed-point</c> 2.1, route A).
///
/// <para>A client that patches the text it pushed misses after a create: the fetch gives volt's canonical form (one
/// blank line before the END line, members METHOD, ACTION, PROPERTY then by name — <c>PushThenFetchShapeTests</c>), not
/// the pushed shape. Route (B), keeping the pushed shape, breaks stable workspace diffs and is not built. Route (A): with
/// <c>returnSources: true</c> an accepted push answers <c>newSources</c>, full wire name → the stored text exactly as a
/// fetch returns it, for every item the push changed — each item a landed <c>set</c> left in the project, and each item
/// whose version it changed though no op names it (the callers a native rename rewrote).</para>
///
/// <para>Every expected text here is a FETCH on the same FakeIde, never <c>PushThenFetchShapeTests.Canonical</c> — the
/// oracle is what a read gives, whatever the writer's form is.</para>
/// </summary>
public class PushReturnsSourcesTests
{
    /// <summary>The census's W1 shape: no blank line before <c>END_FUNCTION_BLOCK</c>, PROPERTY before ACTION.</summary>
    private const string W1 =
        "FUNCTION_BLOCK FB_Motor\n" +
        "VAR_INPUT\n\txEnable : BOOL;\nEND_VAR\n" +
        "VAR\n\txRunning : BOOL;\nEND_VAR\n" +
        "IMPLEMENTATION ST\n" +
        "xRunning := xEnable;\n" +
        "END_FUNCTION_BLOCK\n" +
        "\n" +
        "PROPERTY Running : BOOL\n" +
        "GET\n" +
        "IMPLEMENTATION ST\n" +
        "Running := xRunning;\n" +
        "END_GET\n" +
        "END_PROPERTY\n" +
        "\n" +
        "ACTION Stop\n" +
        "IMPLEMENTATION ST\n" +
        "xRunning := FALSE;\n" +
        "END_ACTION\n";

    private const string Gvl = "VAR_GLOBAL\n\tgMotorOn : BOOL;\n\tgSpeed : INT;\nEND_VAR";
    private const string Struct = "TYPE ST_Drive :\nSTRUCT\n\tnSpeed : INT;\n\txOn : BOOL;\nEND_STRUCT\nEND_TYPE";
    private const string Enum = "TYPE E_Mode :\n(\n\tIdle,\n\tRun\n);\nEND_TYPE";

    private static SetItemOp Create(string wireName, string source) =>
        new() { Name = wireName, IfVersion = null, ToFolder = "", SourceText = source };

    private static PushResponse Push(FakeIde ide, bool? returnSources, params PushOp[] ops) =>
        PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion,
            ReturnSources = returnSources,
            Ops = ops.ToList(),
        });

    private static FetchedItem Fetch(FakeIde ide, string wireName) =>
        FetchService.Handle(ide, new FetchRequest
        {
            KnownItems = new Dictionary<string, string>(),
            OnlyItems = new List<string> { wireName },
        }).Changed.Single();

    /// <summary>The answer holds the fetched text and the fetched version for <paramref name="wireName"/>.</summary>
    private static void HoldsWhatAFetchGives(FakeIde ide, PushResponse push, string wireName)
    {
        var fetched = Fetch(ide, wireName);
        Assert.NotNull(push.NewSources);
        Assert.True(push.NewSources!.ContainsKey(wireName), $"newSources has no entry for '{wireName}'");
        Assert.Equal(fetched.SourceText, push.NewSources[wireName]);
        Assert.Equal(fetched.Version, push.NewItems![wireName]);
    }

    /// <summary>The census case: W1 created with the flag; the answer holds the canonical text, not the pushed one, so a
    /// patch searching <c>xRunning := xEnable;\n\nEND_FUNCTION_BLOCK</c> (what a read gives) matches without a re-read.</summary>
    [Fact]
    public void A_created_FB_with_members_answers_the_text_a_fetch_gives()
    {
        var ide = new FakeIde();

        var push = Push(ide, true, Create("FB_Motor.pou", W1));

        Assert.True(push.Accepted, push.Conflicts?.FirstOrDefault()?.Reason);
        HoldsWhatAFetchGives(ide, push, "FB_Motor.pou");
        Assert.NotEqual(W1, push.NewSources!["FB_Motor.pou"]);
        Assert.True(push.NewSources["FB_Motor.pou"].IndexOf("ACTION Stop") < push.NewSources["FB_Motor.pou"].IndexOf("PROPERTY Running"));
    }

    /// <summary>A GVL and two DUTs (a struct and an enum) in one push: each is answered as a fetch gives it.</summary>
    [Fact]
    public void A_created_GVL_and_DUTs_answer_the_text_a_fetch_gives()
    {
        var ide = new FakeIde();

        var push = Push(ide, true, Create("GVL_Drive.gvl", Gvl), Create("ST_Drive.dut", Struct), Create("E_Mode.dut", Enum));

        Assert.True(push.Accepted, push.Conflicts?.FirstOrDefault()?.Reason);
        HoldsWhatAFetchGives(ide, push, "GVL_Drive.gvl");
        HoldsWhatAFetchGives(ide, push, "ST_Drive.dut");
        HoldsWhatAFetchGives(ide, push, "E_Mode.dut");
    }

    /// <summary>An UPDATE of an existing item (with its version) is answered too, as its fetch gives it.</summary>
    [Fact]
    public void An_updated_item_answers_the_text_a_fetch_gives()
    {
        var ide = new FakeIde();
        Push(ide, null, Create("FB_Motor.pou", W1));
        var version = RefsService.Handle(ide).Items["FB_Motor.pou"];

        var push = Push(ide, true, new SetItemOp
        {
            Name = "FB_Motor.pou", IfVersion = version,
            SourceText = W1.Replace("xRunning := FALSE;", "xRunning := NOT xEnable;"),
        });

        Assert.True(push.Accepted, push.Conflicts?.FirstOrDefault()?.Reason);
        HoldsWhatAFetchGives(ide, push, "FB_Motor.pou");
        Assert.Contains("xRunning := NOT xEnable;", push.NewSources!["FB_Motor.pou"]);
    }

    /// <summary>Only the items the push CHANGED: an item already in the project that no op names has no entry, and
    /// every key is a <c>newItems</c> key.</summary>
    [Fact]
    public void Only_the_changed_items_are_answered()
    {
        var ide = new FakeIde();
        Push(ide, null, Create("GVL_Drive.gvl", Gvl));

        var push = Push(ide, true, Create("ST_Drive.dut", Struct));

        Assert.True(push.Accepted, push.Conflicts?.FirstOrDefault()?.Reason);
        Assert.NotNull(push.NewSources);
        Assert.Equal(new[] { "ST_Drive.dut" }, push.NewSources!.Keys.ToArray());
        Assert.Contains("GVL_Drive.gvl", push.NewItems!.Keys);
    }

    /// <summary>A rename+edit is answered under the NEW name — the <c>newItems</c> key — and the old name has none.</summary>
    [Fact]
    public void A_rename_and_edit_is_answered_under_the_new_name()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("FB_Old", "FUNCTION_BLOCK FB_Old\nVAR\nEND_VAR", "y := 1;"));
        var refs = RefsService.Handle(ide);

        var push = Push(ide, true, new SetItemOp
        {
            Name = "FB_Old.pou", ToName = "FB_New.pou", IfVersion = refs.Items["FB_Old.pou"],
            SourceText = "FUNCTION_BLOCK FB_New\nVAR\nEND_VAR\nIMPLEMENTATION ST\ny := 2;\nEND_FUNCTION_BLOCK\n",
        });

        Assert.True(push.Accepted, push.Conflicts?.FirstOrDefault()?.Reason);
        HoldsWhatAFetchGives(ide, push, "FB_New.pou");
        Assert.False(push.NewSources!.ContainsKey("FB_Old.pou"));
    }

    /// <summary>A RENAME-ONLY op (no <c>SourceText</c>) is answered too: the client sent no text, yet the stored text
    /// changed — a native rename rewrites the item's own header on both vendors (DIALECT C2o). The CODESYS shape: the
    /// header only.</summary>
    [Fact]
    public void A_rename_only_op_is_answered_with_the_rewritten_header()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("FB_Old", "FUNCTION_BLOCK FB_Old\nVAR\nEND_VAR", "y := 1;"));
        var refs = RefsService.Handle(ide);

        var push = Push(ide, true, new SetItemOp { Name = "FB_Old.pou", ToName = "FB_New.pou", IfVersion = refs.Items["FB_Old.pou"] });

        Assert.True(push.Accepted, push.Conflicts?.FirstOrDefault()?.Reason);
        Assert.Contains("FUNCTION_BLOCK FB_New", Fetch(ide, "FB_New.pou").SourceText);   // premise: the rename rewrote it
        HoldsWhatAFetchGives(ide, push, "FB_New.pou");
        Assert.Contains("FUNCTION_BLOCK FB_New", push.NewSources!["FB_New.pou"]);
        Assert.False(push.NewSources.ContainsKey("FB_Old.pou"));
    }

    /// <summary>The TwinCAT rename shape (DIALECT C2o, <c>RewritesOwnReferencesOnRename</c>): beyond the header, the
    /// item's own code references are rewritten — a FUNCTION's return assignment. The answer holds that text.</summary>
    [Fact]
    public void A_rename_only_op_under_the_TwinCAT_rename_shape_is_answered_with_the_rewritten_references()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("F_Old", "FUNCTION F_Old : BOOL\nVAR\nEND_VAR", "F_Old := TRUE;"))
        {
            RewritesOwnReferencesOnRename = true,
        };
        var refs = RefsService.Handle(ide);

        var push = Push(ide, true, new SetItemOp { Name = "F_Old.pou", ToName = "F_New.pou", IfVersion = refs.Items["F_Old.pou"] });

        Assert.True(push.Accepted, push.Conflicts?.FirstOrDefault()?.Reason);
        Assert.Contains("F_New := TRUE;", Fetch(ide, "F_New.pou").SourceText);   // premise: the TwinCAT shape rewrote it
        HoldsWhatAFetchGives(ide, push, "F_New.pou");
        Assert.Contains("FUNCTION F_New", push.NewSources!["F_New.pou"]);
        Assert.Contains("F_New := TRUE;", push.NewSources["F_New.pou"]);
    }

    /// <summary>A NATIVE RENAME REWRITES THE CALL SITES in items no op names (gate 3 review): those items changed —
    /// <c>newItems</c> carries their new version — so the answer carries their text too. Without it a client holding the
    /// caller's pre-rename text adopts its new version as baseline, and its next patch-and-push of that caller passes the
    /// <c>ifVersion</c> gate and writes the OLD name back over the rename.</summary>
    [Fact]
    public void A_rename_answers_the_callers_it_rewrote()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("FB_A", "FUNCTION_BLOCK FB_A\nVAR\nEND_VAR", ";"),
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\n\tfb : FB_A;\nEND_VAR", "fb();"),
            FakeIde.Item.TextualPou("P_Other", "PROGRAM P_Other\nVAR\nEND_VAR", ";"))
        { RewritesReferencesOnRename = true };
        var refs = RefsService.Handle(ide);

        var push = Push(ide, true, new SetItemOp { Name = "FB_A.pou", ToName = "FB_B.pou", IfVersion = refs.Items["FB_A.pou"] });

        Assert.True(push.Accepted, push.Conflicts?.FirstOrDefault()?.Reason);
        Assert.NotEqual(refs.Items["PLC_PRG.pou"], push.NewItems!["PLC_PRG.pou"]);          // premise: the caller changed
        Assert.Contains("fb : FB_B;", Fetch(ide, "PLC_PRG.pou").SourceText);               // premise: rewritten
        HoldsWhatAFetchGives(ide, push, "FB_B.pou");
        HoldsWhatAFetchGives(ide, push, "PLC_PRG.pou");
        Assert.Equal(new[] { "FB_B.pou", "PLC_PRG.pou" }, push.NewSources!.Keys.OrderBy(k => k, System.StringComparer.Ordinal));
    }

    /// <summary>The same on a push accepted IN PART: a rename+edit refused after its native rename ran "stays renamed"
    /// and rewrote the callers. The refused item itself is re-read (it is in <c>conflicts</c>, under <c>renamedTo</c>);
    /// the callers it rewrote are answered.</summary>
    [Fact]
    public void A_refused_rename_that_stays_renamed_answers_the_callers_it_rewrote()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("X", "FUNCTION_BLOCK X\nVAR\nEND_VAR", ";"),
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\n\tfb : X;\nEND_VAR", "fb();"))
        {
            RewritesReferencesOnRename = true,
            FailCreate = (name, kind) => kind == Volt.Engine.Item.ItemKind.PlcMethod
                ? new Volt.Engine.Ide.ChildRefusedException($"The name '{name}' is not valid for this object.", Volt.Engine.Ide.ChildRefusalCause.Name)
                : null,
        };
        var refs = RefsService.Handle(ide);

        var push = Push(ide, true,
            Create("ST_Drive.dut", Struct),
            new SetItemOp
            {
                Name = "X.pou", ToName = "Y.pou", IfVersion = refs.Items["X.pou"],
                SourceText = "FUNCTION_BLOCK Y\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK" +
                             "\n\nMETHOD M : BOOL\nIMPLEMENTATION ST\nM := TRUE;\nEND_METHOD\n",
            });

        Assert.True(push.Accepted, push.Conflicts?.FirstOrDefault()?.Reason);
        var c = Assert.Single(push.Conflicts!);
        Assert.Equal("Y.pou", c.RenamedTo);                                                   // premise: stays renamed
        Assert.Contains("fb : Y;", Fetch(ide, "PLC_PRG.pou").SourceText);                     // premise: caller rewritten
        HoldsWhatAFetchGives(ide, push, "ST_Drive.dut");
        HoldsWhatAFetchGives(ide, push, "PLC_PRG.pou");
        Assert.False(push.NewSources!.ContainsKey("Y.pou"));
        Assert.False(push.NewSources.ContainsKey("X.pou"));
    }

    /// <summary>THE KEY IS THE IDE'S SPELLING (gate 3 review): the IDE resolves an op's name case-insensitively, so an
    /// update named <c>fb_motor.pou</c> lands on <c>FB_Motor</c>, and the answer is keyed <c>FB_Motor.pou</c> — the
    /// <c>newItems</c> key — not the op's spelling.</summary>
    [Fact]
    public void An_update_named_in_another_case_is_answered_under_the_IDEs_spelling()
    {
        var ide = new FakeIde();
        Push(ide, null, Create("FB_Motor.pou", W1));
        var version = RefsService.Handle(ide).Items["FB_Motor.pou"];

        var push = Push(ide, true, new SetItemOp
        {
            Name = "fb_motor.pou", IfVersion = version,
            SourceText = W1.Replace("xRunning := FALSE;", "xRunning := NOT xEnable;"),
        });

        Assert.True(push.Accepted, push.Conflicts?.FirstOrDefault()?.Reason);
        HoldsWhatAFetchGives(ide, push, "FB_Motor.pou");
        Assert.False(push.NewSources!.ContainsKey("fb_motor.pou"));
        Assert.Contains("FB_Motor.pou", push.NewItems!.Keys);
    }

    /// <summary>A MOVE-ONLY op (no <c>SourceText</c>) is a landed <c>set</c> too: it has an entry.</summary>
    [Fact]
    public void A_move_only_op_is_answered()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("FB_A", "FUNCTION_BLOCK FB_A\nVAR\nEND_VAR", "y := 1;"));
        var refs = RefsService.Handle(ide);

        var push = Push(ide, true, new SetItemOp { Name = "FB_A.pou", ToFolder = "Sub", IfVersion = refs.Items["FB_A.pou"] });

        Assert.True(push.Accepted, push.Conflicts?.FirstOrDefault()?.Reason);
        HoldsWhatAFetchGives(ide, push, "FB_A.pou");
    }

    /// <summary>An op in <c>conflicts</c> whose item is STILL in the project (and so in <c>newItems</c>) has no entry: a
    /// refused UPDATE whose declaration landed before the member refusal (<c>partiallyApplied</c>) is re-read by the
    /// client, never answered. Keying on <c>newItems</c> alone would answer it.</summary>
    [Fact]
    public void A_partially_applied_refused_update_is_not_answered_though_it_is_in_the_receipt()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("K", "FUNCTION_BLOCK K\nVAR\nEND_VAR", ";")) { RefusesMembersByText = true };
        var version = RefsService.Handle(ide).Items["K.pou"];

        var push = Push(ide, true,
            Create("ST_Drive.dut", Struct),
            new SetItemOp
            {
                Name = "K.pou", IfVersion = version,
                SourceText = "FUNCTION K : BOOL\nVAR\nEND_VAR\nIMPLEMENTATION ST\nK := TRUE;\nEND_FUNCTION" +
                             "\n\nMETHOD M : BOOL\nIMPLEMENTATION ST\nM := TRUE;\nEND_METHOD\n",
            });

        Assert.True(push.Accepted, push.Conflicts?.FirstOrDefault()?.Reason);
        var c = Assert.Single(push.Conflicts!);
        Assert.Equal("K.pou", c.Name);
        Assert.True(c.PartiallyApplied, "premise: the refused update left its declaration");
        Assert.Contains("K.pou", push.NewItems!.Keys);
        HoldsWhatAFetchGives(ide, push, "ST_Drive.dut");
        Assert.False(push.NewSources!.ContainsKey("K.pou"));
    }

    /// <summary>A refused UPDATE under which NOTHING was written: the item is unchanged and in <c>newItems</c>, the op is
    /// in <c>conflicts</c> — no entry.</summary>
    [Fact]
    public void A_refused_update_that_wrote_nothing_is_not_answered_though_it_is_in_the_receipt()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("K", "FUNCTION K : BOOL\nVAR\nEND_VAR", "K := TRUE;")) { RefusesMembersByText = true };
        var version = RefsService.Handle(ide).Items["K.pou"];

        var push = Push(ide, true,
            Create("ST_Drive.dut", Struct),
            new SetItemOp
            {
                Name = "K.pou", IfVersion = version,
                SourceText = "FUNCTION K : BOOL\nVAR\nEND_VAR\nIMPLEMENTATION ST\nK := TRUE;\nEND_FUNCTION" +
                             "\n\nMETHOD M : BOOL\nIMPLEMENTATION ST\nM := TRUE;\nEND_METHOD\n",
            });

        Assert.True(push.Accepted, push.Conflicts?.FirstOrDefault()?.Reason);
        Assert.Equal("K.pou", Assert.Single(push.Conflicts!).Name);
        Assert.Contains("K.pou", push.NewItems!.Keys);
        HoldsWhatAFetchGives(ide, push, "ST_Drive.dut");
        Assert.False(push.NewSources!.ContainsKey("K.pou"));
    }

    /// <summary>A delete has no entry — nothing of it is left to hold.</summary>
    [Fact]
    public void A_delete_is_not_answered()
    {
        var ide = new FakeIde();
        Push(ide, null, Create("GVL_Drive.gvl", Gvl));
        var refs = RefsService.Handle(ide);

        var push = Push(ide, true,
            new DeleteItemOp { Name = "GVL_Drive.gvl", IfVersion = refs.Items["GVL_Drive.gvl"] },
            Create("ST_Drive.dut", Struct));

        Assert.True(push.Accepted, push.Conflicts?.FirstOrDefault()?.Reason);
        HoldsWhatAFetchGives(ide, push, "ST_Drive.dut");
        Assert.False(push.NewSources!.ContainsKey("GVL_Drive.gvl"));
    }

    /// <summary>A push accepted IN PART (openspec <c>push-keeps-what-landed</c>): the landed creates are answered, the
    /// refused op is not (it is in <c>conflicts</c>; nothing of it stays — the create rolled back).</summary>
    [Fact]
    public void A_partial_push_answers_only_the_landed_ops()
    {
        var ide = new FakeIde { RefusesMembersByText = true };
        const string functionWithMethod =
            "FUNCTION F : BOOL\nVAR\nEND_VAR\nIMPLEMENTATION ST\nF := TRUE;\nEND_FUNCTION" +
            "\n\nMETHOD M : BOOL\nIMPLEMENTATION ST\nM := TRUE;\nEND_METHOD\n";

        var push = Push(ide, true, Create("E_Mode.dut", Enum), Create("ST_Drive.dut", Struct), Create("F.pou", functionWithMethod));

        Assert.True(push.Accepted, push.Conflicts?.FirstOrDefault()?.Reason);
        Assert.Equal("F.pou", Assert.Single(push.Conflicts!).Name);
        HoldsWhatAFetchGives(ide, push, "E_Mode.dut");
        HoldsWhatAFetchGives(ide, push, "ST_Drive.dut");
        Assert.False(push.NewSources!.ContainsKey("F.pou"));
    }

    /// <summary>A changed item the receipt could not materialize has no entry, and none in <c>newItems</c> either — the
    /// engine never invents text for it; the client re-reads it and gets the fetch's own refusal.</summary>
    [Fact]
    public void A_changed_item_the_receipt_cannot_read_is_not_answered()
    {
        var ide = new FakeIde();
        // Unreadable from the moment its write landed: the receipt walk's read of it fails.
        ide.OnReadContent = (fake, item) =>
        {
            if (fake.Name(item) == "ST_Drive" && fake.Recorded.Any(r => r.StartsWith("create:", System.StringComparison.Ordinal) && r.Contains("ST_Drive")))
                throw new System.InvalidOperationException("'ST_Drive': unreadable after its write");
        };

        var push = Push(ide, true, Create("GVL_Drive.gvl", Gvl), Create("ST_Drive.dut", Struct));

        Assert.True(push.Accepted, push.Conflicts?.FirstOrDefault()?.Reason);
        Assert.DoesNotContain("ST_Drive.dut", push.NewItems!.Keys);
        Assert.NotNull(push.NewSources);
        Assert.False(push.NewSources!.ContainsKey("ST_Drive.dut"));
        Assert.Contains("GVL_Drive.gvl", push.NewSources.Keys);
    }

    /// <summary>A changed item the receipt walk never reaches — its folder could not be enumerated after the write
    /// (<c>unwalkedFolders</c>) — has no entry and none in <c>newItems</c>; the receipt names the folder.</summary>
    [Fact]
    public void A_changed_item_under_an_unwalked_folder_is_not_answered()
    {
        var ide = new FakeIde();
        // The folder becomes unenumerable once the item's write landed: the receipt walk skips its subtree.
        ide.OnWalkItems = () =>
        {
            if (ide.Recorded.Any(r => r.StartsWith("create:", System.StringComparison.Ordinal) && r.Contains("ST_Drive")))
                ide.UnwalkableFolders = new[] { "Types" };
        };

        var push = Push(ide, true, Create("GVL_Drive.gvl", Gvl),
            new SetItemOp { Name = "ST_Drive.dut", IfVersion = null, ToFolder = "Types", SourceText = Struct });

        Assert.True(push.Accepted, push.Conflicts?.FirstOrDefault()?.Reason);
        Assert.Contains("Types", push.UnwalkedFolders);
        Assert.DoesNotContain("ST_Drive.dut", push.NewItems!.Keys);
        Assert.NotNull(push.NewSources);
        Assert.False(push.NewSources!.ContainsKey("ST_Drive.dut"));
        HoldsWhatAFetchGives(ide, push, "GVL_Drive.gvl");
    }

    /// <summary>Without the flag the answer is unchanged: no <c>newSources</c>, on the wire too.</summary>
    [Theory]
    [InlineData(null)]
    [InlineData(false)]
    public void Without_the_flag_there_is_no_newSources(bool? flag)
    {
        var ide = new FakeIde();

        var push = Push(ide, flag, Create("FB_Motor.pou", W1));

        Assert.True(push.Accepted, push.Conflicts?.FirstOrDefault()?.Reason);
        Assert.Null(push.NewSources);
        Assert.DoesNotContain("newSources", System.Text.Json.JsonSerializer.Serialize(push));
    }

    /// <summary>A rejected push (nothing landed) has no <c>newSources</c>, flag or not.</summary>
    [Fact]
    public void A_rejected_push_has_no_newSources()
    {
        var ide = new FakeIde();

        var push = Push(ide, true, Create("Good.pou", "PROGRAM Good\nIMPLEMENTATION ST\nEND_PROGRAM\n"), Create("Bad.pou", "not a POU at all"));

        Assert.False(push.Accepted);
        Assert.Null(push.NewSources);
    }

    /// <summary>Every <c>newSources</c> key is a <c>newItems</c> key — one materialization gives both.</summary>
    [Fact]
    public void Every_answered_name_is_in_the_receipt()
    {
        var ide = new FakeIde();

        var push = Push(ide, true, Create("FB_Motor.pou", W1), Create("GVL_Drive.gvl", Gvl), Create("ST_Drive.dut", Struct));

        Assert.True(push.Accepted, push.Conflicts?.FirstOrDefault()?.Reason);
        Assert.NotNull(push.NewSources);
        Assert.Equal(3, push.NewSources!.Count);
        Assert.All(push.NewSources.Keys, k => Assert.Contains(k, push.NewItems!.Keys));
    }
}
