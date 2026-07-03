using System.Linq;
using Volt.Bridge.Core.Sync;
using Volt.Bridge.Core.Wire;
using Volt.Bridge.Core.Workspace;
using Xunit;

namespace Volt.Bridge.Tests;

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
}
