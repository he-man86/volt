using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A MOVE INTO A NODE THAT CANNOT HOLD AN ITEM IS REFUSED BEFORE ANYTHING IS APPLIED, AND A MOVE THE IDE IGNORED IS
/// CAUGHT AFTER (openspec <c>bridge-refusal-review</c> 4.31).
///
/// <para>Measured live (<c>scripts/merged-classes.log</c> 225-229): CODESYS accepts <c>Move</c> into <c>Device</c> (Pro2193)
/// and into <c>Task Configuration</c> (Bakon) and leaves the object where it was. The push reported "moved", the workspace
/// said the new folder, and the next pull moved the file back. The folder resolution descends any non-source node by
/// name, so <c>Device</c> resolved as if it were a folder.</para>
///
/// <para>The holders are MEASURED (<c>scripts/move-holders.log</c>: every top-level source object of Pro2193, Bakon,
/// AWA, Lenze and the CODESYS fixture sits at the tree root, in a folder, or directly in an Application). A move whose
/// target EXISTS and is anything else is refused <c>UNSUPPORTED</c> in the pre-flight, by name, so no op of the batch
/// lands; and the move's post-condition asks where the item is afterwards, so an IDE that ignored the move is refused
/// naming the folder it stayed in.</para>
/// </summary>
public class MoveIntoNonFolderTests
{
    private const string Application = "Device/Plc Logic/Application";
    private const string GvlFolder = Application + "/05 Global Var Lists";
    private const string TaskConfiguration = Application + "/Task Configuration";

    private static FakeIde CodesysLike(bool ignoreMoves = false)
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("PersistentVars", "VAR_GLOBAL\nEND_VAR", "", GvlFolder),
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;", Application),
            FakeIde.Item.TextualPou("FB_Proc", "FUNCTION_BLOCK FB_Proc\nVAR\nEND_VAR", "", Application + "/02 Processes"),
            new FakeIde.Item("MainTask", ItemKind.PlcTask, TaskConfiguration, true,
                             "Type:     Cyclic\nInterval: 10ms\nPriority: 1\n", null, null, null))
        { IgnoreMoves = ignoreMoves };
        ide.ContainerKinds["Device"] = ItemKind.Device;
        ide.ContainerKinds["Device/Plc Logic"] = ItemKind.PlcLogic;
        ide.ContainerKinds[Application] = ItemKind.Application;
        ide.TaskConfigFolders.Add(TaskConfiguration);
        return ide;
    }

    /// <summary>Move <paramref name="name"/> to <paramref name="toFolder"/>, and each of <paramref name="more"/> (name, folder)
    /// too, in ONE push — each op quoting the version refs gave it.</summary>
    private static PushResponse Move(FakeIde ide, string name, string toFolder, params (string Name, string To)[] more)
    {
        var refs = RefsService.Handle(ide);
        var ops = new[] { (name, toFolder) }.Concat(more)
            .Select(m => (PushOp)new SetItemOp { Name = m.Item1, ToFolder = m.Item2, IfVersion = refs.Items[m.Item1] })
            .ToList();
        return PushService.Handle(ide, new PushRequest { ExpectedProjectVersion = refs.ProjectVersion, Ops = ops });
    }

    [Theory]
    [InlineData("Device", "Device")]
    [InlineData(TaskConfiguration, "Task Configuration")]
    [InlineData("Device/Plc Logic", "Plc Logic")]
    // NOT "Device/Brand New": what CODESYS does with a folder CREATED under a non-holder, and a move into it, is
    // unmeasured — so the pre-flight judges only a target that EXISTS, and that push goes to the vendor (the move's
    // post-condition still catches a move it ignores). 4d review.
    public void A_move_into_a_node_that_is_no_folder_is_refused_before_anything_is_applied(string toFolder, string node)
    {
        var ide = CodesysLike();
        var before = RefsService.Handle(ide).ProjectVersion;

        // A second op that is fine on its own: the batch is all-or-nothing, so it does not land either.
        var res = Move(ide, "PersistentVars.gvl", toFolder,
                       ("FB_Proc.pou", Application));

        Assert.False(res.Accepted);
        var refused = Assert.Single(res.Conflicts!);
        Assert.Equal("PersistentVars.gvl", refused.Name);
        Assert.Equal(BridgeErrorCodes.Unsupported, refused.Code);
        Assert.Contains($"'PersistentVars' cannot move into '{toFolder}'", refused.Reason);
        Assert.Contains($"'{node}' is a", refused.Reason);
        Assert.Contains("not a folder", refused.Reason);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("move:") || r.StartsWith("create:"));
        Assert.Equal(before, RefsService.Handle(ide).ProjectVersion);
    }

    [Theory]
    [InlineData(Application)]                     // an Application holds items (measured: Pro2193, Bakon, AWA, the fixture)
    [InlineData(Application + "/02 Processes")]   // a folder
    [InlineData(Application + "/Brand New")]      // a folder created under the Application
    [InlineData("")]                              // the tree root, the POU pool (measured: Pro2193, AWA, Lenze)
    public void A_move_into_a_holder_lands(string toFolder)
    {
        var ide = CodesysLike();

        var res = Move(ide, "PersistentVars.gvl", toFolder);

        Assert.True(res.Accepted, string.Join("; ", (res.Conflicts ?? new()).Select(c => c.Reason)));
        Assert.Equal(toFolder, RefsService.Handle(ide).Folders["PersistentVars.gvl"]);
    }

    /// <summary>The post-condition: an IDE that accepts the move and leaves the object is refused, naming where it stayed.</summary>
    [Fact]
    public void A_move_the_IDE_ignored_is_refused_naming_the_folder_it_stayed_in()
    {
        var ide = CodesysLike(ignoreMoves: true);

        var res = Move(ide, "PersistentVars.gvl", Application + "/02 Processes");

        Assert.False(res.Accepted);
        var refused = Assert.Single(res.Conflicts!);
        Assert.Equal(BridgeErrorCodes.Unsupported, refused.Code);
        Assert.Contains("did not apply the move", refused.Reason);
        Assert.Contains($"'{GvlFolder}'", refused.Reason);
        Assert.Contains(ide.Recorded, r => r.StartsWith("move:PersistentVars"));
        Assert.Equal(GvlFolder, RefsService.Handle(ide).Folders["PersistentVars.gvl"]);
    }

    /// <summary>TwinCAT's measured non-holder: <c>References</c> (the library manager, 617). Its vendor refusal is the one
    /// that DEPOSITED the item at the PLC project root (DIALECT C2q, <c>scripts/tc-move-target.log</c>), so the pre-flight
    /// must stop it before the archive round trip runs at all.</summary>
    [Fact]
    public void A_move_into_TwinCATs_References_node_is_refused_before_anything_is_applied()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("GVL_PackML", "VAR_GLOBAL\nEND_VAR", "", "GVLs"),
            FakeIde.Item.TextualPou("Tc2_Standard", "FUNCTION_BLOCK Tc2_Standard\nVAR\nEND_VAR", "", "References"));
        ide.ContainerKinds["References"] = ItemKind.PlcLibMan;
        var before = RefsService.Handle(ide).ProjectVersion;

        var res = Move(ide, "GVL_PackML.gvl", "References");

        Assert.False(res.Accepted);
        var refused = Assert.Single(res.Conflicts!);
        Assert.Equal(BridgeErrorCodes.Unsupported, refused.Code);
        Assert.Contains("'GVL_PackML' cannot move into 'References'", refused.Reason);
        Assert.Contains("'References' is a", refused.Reason);
        Assert.Contains("not a folder", refused.Reason);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("move:") || r.StartsWith("create:"));
        Assert.Equal(before, RefsService.Handle(ide).ProjectVersion);
    }

    /// <summary>The post-condition asks for the MOVED item — name AND kind — not for any child of its bare name. An FB and
    /// its visualization share a bare name (<c>CM_Carrier.pou</c> / <c>CM_Carrier.visualization</c>, V71_PackML_Hauzer);
    /// with the visualization already in the target, a move the IDE ignored must not read as "moved".</summary>
    [Fact]
    public void A_move_the_IDE_ignored_is_refused_when_a_same_named_item_of_another_kind_is_in_the_target()
    {
        var ide = new FakeIde(
            new FakeIde.Item("CM_Carrier", ItemKind.PlcPou, "A", true,
                "FUNCTION_BLOCK CM_Carrier\nVAR\nEND_VAR", "", null, null),
            new FakeIde.Item("CM_Carrier", ItemKind.PlcVisObj, "B", true,
                "visualization: CM_Carrier", null, null, null))
        { IgnoreMoves = true };

        var res = Move(ide, "CM_Carrier.pou", "B");

        Assert.False(res.Accepted, "the visualization in 'B' answered for the FB that never left 'A'");
        var refused = Assert.Single(res.Conflicts!);
        Assert.Equal(BridgeErrorCodes.Unsupported, refused.Code);
        Assert.Contains("did not apply the move", refused.Reason);
        Assert.Contains("still in 'A'", refused.Reason);
        Assert.Equal("A", RefsService.Handle(ide).Folders["CM_Carrier.pou"]);
    }

    /// <summary>The post-condition's other branch: an IDE that accepted the move and then holds the item NOWHERE is
    /// refused saying so, not reported "moved".</summary>
    [Fact]
    public void A_move_after_which_the_item_is_nowhere_is_refused_saying_so()
    {
        var ide = CodesysLike();
        ide.DropsOnMove = true;

        var res = Move(ide, "PersistentVars.gvl", Application + "/02 Processes");

        Assert.False(res.Accepted);
        var refused = Assert.Single(res.Conflicts!);
        Assert.Equal(BridgeErrorCodes.Unsupported, refused.Code);
        Assert.Contains("did not apply the move", refused.Reason);
        Assert.Contains("the item is in neither folder afterwards", refused.Reason);
    }
}
