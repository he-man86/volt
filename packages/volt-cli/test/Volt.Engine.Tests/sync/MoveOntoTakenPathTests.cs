using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A RENAME OR A MOVE ONTO A PATH THE IDE HOLDS IS <c>ITEM_EXISTS</c>, FORCE OR NOT (openspec
/// <c>move-onto-existing-path-refused</c>).
///
/// <para>The gate passed a version-matching rename or move whose <c>to</c> the IDE already held: what happened next was the
/// IDE's to decide (a refusal surfacing as <c>INTERNAL_ERROR</c> after earlier ops landed, or a clash-rename). The
/// pre-flight now refuses it against the pre-apply version map, the one place full identities exist, before any op of the
/// batch lands; <c>currentVersion</c> is the version of the item already at <c>to</c> — the same meaning a create's
/// <c>ITEM_EXISTS</c> has.</para>
/// </summary>
public class MoveOntoTakenPathTests
{
    private static FakeIde.Item Fb(string name, string folder) => FakeIde.Item.TextualPou(name,
        $"FUNCTION_BLOCK {name}\nVAR\nEND_VAR\n", "n := 0;\n", folder);

    private static string Src(string name, string body = "n := 1;") =>
        $"FUNCTION_BLOCK {name}\nVAR\nEND_VAR\n%LANGUAGE ST\n{body}\n\nEND_FUNCTION_BLOCK\n";

    private static FakeIde ThreeFbs() => new(Fb("FB_A", "POUs"), Fb("FB_B", "POUs"), Fb("FB_C", "POUs"));

    private static PushResponse Push(FakeIde ide, bool force, params PushOp[] ops) => BoundWrite.Push(ide, new PushRequest
    {
        ExpectedProjectVersion = force ? null : RefsService.Handle(ide).ProjectVersion,
        Force = force,
        Ops = ops.ToList(),
    });

    private static void AssertNothingApplied(FakeIde ide, Dictionary<string, string> before) =>
        Assert.Equal(before, RefsService.Handle(ide).Items.ToDictionary(x => x.Key, x => x.Value));

    /// <summary>2.1: a same-folder rename onto a taken name; the earlier op of the batch is not applied either.</summary>
    [Fact]
    public void A_rename_onto_a_taken_path_is_ITEM_EXISTS_and_nothing_of_the_batch_applies()
    {
        var ide = ThreeFbs();
        var v = RefsService.Handle(ide).Items.ToDictionary(x => x.Key, x => x.Value);

        var res = Push(ide, false,
            new SetItemOp { Name = "POUs/FB_C.pou", SourceText = Src("FB_C"), IfVersion = v["POUs/FB_C.pou"] },
            new SetItemOp { Name = "POUs/FB_A.pou", To = "POUs/FB_B.pou", IfVersion = v["POUs/FB_A.pou"] });

        Assert.False(res.Landed());
        var c = Assert.Single(res.Refused());
        Assert.Equal("POUs/FB_A.pou", c.Name);
        Assert.Equal(ConflictCodes.ItemExists, c.Code);
        Assert.Contains("POUs/FB_B.pou", c.Reason);
        Assert.Equal(v["POUs/FB_B.pou"], c.CurrentVersion);
        AssertNothingApplied(ide, v);
    }

    /// <summary>2.2: a move onto a path the walk holds.</summary>
    [Fact]
    public void A_move_onto_a_taken_path_is_ITEM_EXISTS()
    {
        var ide = new FakeIde(Fb("FB_A", "POUs"), Fb("FB_A", "Other"));
        var v = RefsService.Handle(ide).Items.ToDictionary(x => x.Key, x => x.Value);

        var res = Push(ide, false, new SetItemOp { Name = "POUs/FB_A.pou", To = "Other/FB_A.pou", IfVersion = v["POUs/FB_A.pou"] });

        var c = Assert.Single(res.Conflicts!);
        Assert.Equal(ConflictCodes.ItemExists, c.Code);
        Assert.Equal(v["Other/FB_A.pou"], c.CurrentVersion);
        AssertNothingApplied(ide, v);
    }

    /// <summary>2.3: under force with no lease — a rename and a pure move — still refused, <c>currentVersion</c> the
    /// version at <c>to</c>.</summary>
    [Theory]
    [InlineData("POUs/FB_A.pou", "POUs/FB_B.pou", "POUs/FB_B.pou")]
    [InlineData("POUs/FB_A.pou", "Other/FB_A.pou", "Other/FB_A.pou")]
    public void Force_does_not_let_a_set_land_on_a_taken_path(string name, string to, string taken)
    {
        var ide = new FakeIde(Fb("FB_A", "POUs"), Fb("FB_B", "POUs"), Fb("FB_A", "Other"));
        var v = RefsService.Handle(ide).Items.ToDictionary(x => x.Key, x => x.Value);

        var res = Push(ide, true, new SetItemOp { Name = name, To = to });

        Assert.False(res.Landed());
        var c = Assert.Single(res.Conflicts!);
        Assert.Equal(ConflictCodes.ItemExists, c.Code);
        Assert.Equal(v[taken], c.CurrentVersion);
        AssertNothingApplied(ide, v);
    }

    /// <summary>The comparison ignores case, as every addressed path does.</summary>
    [Fact]
    public void A_to_in_another_case_still_finds_the_taken_path()
    {
        var ide = ThreeFbs();
        var v = RefsService.Handle(ide).Items.ToDictionary(x => x.Key, x => x.Value);

        var res = Push(ide, true, new SetItemOp { Name = "POUs/FB_A.pou", To = "pous/fb_b.pou" });

        Assert.Equal(ConflictCodes.ItemExists, Assert.Single(res.Conflicts!).Code);
        AssertNothingApplied(ide, v);
    }

    // ── 2.4 / 3.2: the IDE's name scope (DIALECT C38) ──────────────────────────────────────────────────────────────
    // Both IDEs refuse a rename onto a name an object of the same APPLICATION holds, whatever its folder, for an FB, a
    // program, a DUT and a GVL alike: "An object with the name 'X' already exists within the corresponding namespace."

    /// <summary>A rename onto a name another folder of the application holds, one case per measured pair.</summary>
    [Theory]
    [InlineData("Other/FB_Z.pou", "Other/FB_X.pou")]   // an FB onto an FB's name, another folder
    [InlineData("Other/P_Z.pou", "Other/FB_X.pou")]    // a program onto an FB's name
    [InlineData("Other/D_Z.dut", "Other/FB_X.dut")]    // a DUT onto an FB's name
    [InlineData("Other/G_Z.gvl", "Other/FB_X.gvl")]    // a GVL onto an FB's name
    public void A_rename_onto_a_name_the_application_holds_is_ITEM_EXISTS(string name, string to)
    {
        var ide = new FakeIde(Fb("FB_X", "POUs"), Fb("FB_Z", "Other"),
            FakeIde.Item.TextualPou("P_Z", "PROGRAM P_Z\nVAR\nEND_VAR\n", "", "Other"),
            FakeIde.Item.TextualPou("D_Z", "TYPE D_Z :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n", "", "Other"),
            FakeIde.Item.TextualPou("G_Z", "VAR_GLOBAL\n\tg : INT;\nEND_VAR\n", "", "Other"));
        var v = RefsService.Handle(ide).Items.ToDictionary(x => x.Key, x => x.Value);

        foreach (var force in new[] { false, true })
        {
            var res = Push(ide, force, new SetItemOp { Name = name, To = to, IfVersion = force ? null : v[name] });

            var c = Assert.Single(res.Conflicts!);
            Assert.Equal(ConflictCodes.ItemExists, c.Code);
            Assert.Contains("POUs/FB_X.pou", c.Reason);
            Assert.Equal(v["POUs/FB_X.pou"], c.CurrentVersion);
            AssertNothingApplied(ide, v);
        }
    }

    /// <summary>A CREATE onto a name its application holds in another folder or kind is the same IDE state (C38: the IDE
    /// refuses the create, which reached the apply as INTERNAL_ERROR) — ITEM_EXISTS naming the holder, force or not.</summary>
    [Theory]
    [InlineData("Other/FB_X.pou", "FUNCTION_BLOCK FB_X\nVAR\nEND_VAR\n%LANGUAGE ST\n;\nEND_FUNCTION_BLOCK\n")]
    [InlineData("Other/FB_X.dut", "TYPE FB_X :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n")]
    [InlineData("POUs/fb_x.gvl", "VAR_GLOBAL\n\tg : INT;\nEND_VAR\n")]
    public void A_create_onto_a_name_the_application_holds_is_ITEM_EXISTS(string name, string text)
    {
        var ide = new FakeIde(Fb("FB_X", "POUs"), Fb("FB_Z", "Other"));
        var v = RefsService.Handle(ide).Items.ToDictionary(x => x.Key, x => x.Value);

        foreach (var force in new[] { false, true })
        {
            var res = Push(ide, force, new SetItemOp { Name = name, SourceText = text, IfVersion = null });

            var c = Assert.Single(res.Conflicts!);
            Assert.Equal(ConflictCodes.ItemExists, c.Code);
            Assert.Contains("POUs/FB_X.pou", c.Reason);
            Assert.Equal(v["POUs/FB_X.pou"], c.CurrentVersion);
            AssertNothingApplied(ide, v);
        }
    }

    [Fact]
    public void A_create_onto_a_name_another_application_holds_applies()
    {
        var ide = new FakeIde(Fb("FB_X", "Dev1/Plc Logic/App"), Fb("FB_Z", "Dev2/Plc Logic/App"));
        ide.ContainerKinds["Dev1/Plc Logic/App"] = ItemKind.Application;
        ide.ContainerKinds["Dev2/Plc Logic/App"] = ItemKind.Application;

        var res = Push(ide, false, new SetItemOp { Name = "Dev2/Plc Logic/App/FB_X.pou", SourceText = Src("FB_X"), IfVersion = null });

        Assert.True(res.Landed(), string.Join("; ", (res.Conflicts ?? new()).Select(c => $"{c.Code}: {c.Reason}")));
    }

    /// <summary>The scope is the APPLICATION: the same name in another application is another namespace.</summary>
    [Fact]
    public void A_rename_onto_a_name_another_application_holds_applies()
    {
        var ide = new FakeIde(Fb("FB_X", "Dev1/Plc Logic/App"), Fb("FB_Z", "Dev2/Plc Logic/App"));
        ide.ContainerKinds["Dev1/Plc Logic/App"] = ItemKind.Application;
        ide.ContainerKinds["Dev2/Plc Logic/App"] = ItemKind.Application;
        var v = RefsService.Handle(ide).Items;

        var res = Push(ide, false, new SetItemOp
        {
            Name = "Dev2/Plc Logic/App/FB_Z.pou", To = "Dev2/Plc Logic/App/FB_X.pou", IfVersion = v["Dev2/Plc Logic/App/FB_Z.pou"],
        });

        Assert.True(res.Landed(), string.Join("; ", (res.Conflicts ?? new()).Select(c => $"{c.Code}: {c.Reason}")));
    }

    /// <summary>A kind whose scope is not measured is not judged: an FB beside its visualization of one name is a real
    /// project's shape (CM_Carrier), so a rename onto a visualization's name is the IDE's to answer.</summary>
    [Fact]
    public void A_rename_onto_a_visualizations_name_is_not_judged()
    {
        var ide = new FakeIde(Fb("FB_Z", "POUs"),
            new FakeIde.Item("CM_Carrier", ItemKind.PlcVisObj, "Visu", true, "visualization: CM_Carrier", null, null, null));
        var v = RefsService.Handle(ide).Items;

        var res = Push(ide, false, new SetItemOp { Name = "POUs/FB_Z.pou", To = "POUs/CM_Carrier.pou", IfVersion = v["POUs/FB_Z.pou"] });

        Assert.True(res.Landed(), string.Join("; ", (res.Conflicts ?? new()).Select(c => $"{c.Code}: {c.Reason}")));
    }

    // ── 2.5 pins ──────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_case_only_rename_applies()
    {
        var ide = ThreeFbs();
        var v = RefsService.Handle(ide).Items;

        var res = Push(ide, false, new SetItemOp { Name = "POUs/FB_A.pou", To = "POUs/Fb_a.pou", IfVersion = v["POUs/FB_A.pou"] });

        Assert.True(res.Landed(), string.Join("; ", (res.Conflicts ?? new()).Select(c => $"{c.Code}: {c.Reason}")));
    }

    [Fact]
    public void A_move_beside_a_same_named_visualization_applies()
    {
        var ide = new FakeIde(Fb("CM_Carrier", "POUs"),
            new FakeIde.Item("CM_Carrier", ItemKind.PlcVisObj, "Visu", true, "visualization: CM_Carrier", null, null, null));
        var v = RefsService.Handle(ide).Items;

        var res = Push(ide, false, new SetItemOp { Name = "POUs/CM_Carrier.pou", To = "Visu/CM_Carrier.pou", IfVersion = v["POUs/CM_Carrier.pou"] });

        Assert.True(res.Landed(), string.Join("; ", (res.Conflicts ?? new()).Select(c => $"{c.Code}: {c.Reason}")));
        Assert.Contains("Visu/CM_Carrier.pou", RefsService.Handle(ide).Items.Keys);
    }

    [Fact]
    public void A_create_onto_an_existing_path_stays_ITEM_EXISTS()
    {
        var ide = ThreeFbs();

        var res = Push(ide, false, new SetItemOp { Name = "POUs/FB_B.pou", SourceText = Src("FB_B"), IfVersion = null });

        Assert.Equal(ConflictCodes.ItemExists, Assert.Single(res.Conflicts!).Code);
    }

    [Fact]
    public void A_delete_and_a_set_onto_the_same_path_in_one_push_stays_BAD_REQUEST()
    {
        var ide = ThreeFbs();
        var v = RefsService.Handle(ide).Items;

        var res = Push(ide, false,
            new DeleteItemOp { Name = "POUs/FB_B.pou", IfVersion = v["POUs/FB_B.pou"] },
            new SetItemOp { Name = "POUs/FB_A.pou", To = "POUs/FB_B.pou", IfVersion = v["POUs/FB_A.pou"] });

        Assert.Equal(BridgeErrorCodes.BadRequest, Assert.Single(res.Refused()).Code);
    }
}
