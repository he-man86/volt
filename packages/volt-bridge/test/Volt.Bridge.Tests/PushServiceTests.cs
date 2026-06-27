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
        var (v, pv) = Ver(ide, "PLC_PRG.st");
        var resp = Push(ide, pv, new SetItemOp { Name = "PLC_PRG.st", IfVersion = v, ToName = "MOTOR.st" });
        Assert.True(resp.Accepted);
        Assert.Contains("rename:PLC_PRG->MOTOR", ide.Recorded);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("delete:") || r.StartsWith("create:")); // refs preserved, not recreated
    }

    [Fact]
    public void Set_move_recreates_in_new_folder()
    {
        var ide = OneProgram();
        var (v, pv) = Ver(ide, "PLC_PRG.st");
        var resp = Push(ide, pv, new SetItemOp { Name = "PLC_PRG.st", IfVersion = v, ToFolder = "Sub" });
        Assert.True(resp.Accepted);
        Assert.Contains("delete:PLC_PRG", ide.Recorded);
        Assert.Contains("create:PLC_PRG", ide.Recorded); // recreated (same name ⇒ name-based refs survive)
    }

    [Fact]
    public void Set_rename_plus_edit_renames_then_writes_content()
    {
        var ide = OneProgram();
        var (v, pv) = Ver(ide, "PLC_PRG.st");
        var src = "PROGRAM MOTOR\nVAR\n\tn : INT;\nEND_VAR\n\nn := n + 2;\n\nEND_PROGRAM\n";
        var resp = Push(ide, pv, new SetItemOp { Name = "PLC_PRG.st", IfVersion = v, ToName = "MOTOR.st", SourceText = src });
        Assert.True(resp.Accepted);
        Assert.Contains("rename:PLC_PRG->MOTOR", ide.Recorded);
        Assert.Contains("write:MOTOR", ide.Recorded); // content written onto the renamed identity
    }

    [Fact]
    public void Set_rename_plus_move_does_both_atomically()
    {
        var ide = OneProgram();
        var (v, pv) = Ver(ide, "PLC_PRG.st");
        var resp = Push(ide, pv, new SetItemOp { Name = "PLC_PRG.st", IfVersion = v, ToName = "MOTOR.st", ToFolder = "Sub" });
        Assert.True(resp.Accepted);
        Assert.Contains("rename:PLC_PRG->MOTOR", ide.Recorded);
        Assert.Contains("delete:MOTOR", ide.Recorded);  // moved by its new name
        Assert.Contains("create:MOTOR", ide.Recorded);
    }

    [Fact]
    public void Set_with_stale_version_is_rejected_before_any_mutation()
    {
        var ide = OneProgram();
        var (_, pv) = Ver(ide, "PLC_PRG.st");
        var resp = Push(ide, pv, new SetItemOp { Name = "PLC_PRG.st", IfVersion = "stale", ToName = "X.st" });
        Assert.False(resp.Accepted);
        Assert.Empty(ide.Recorded);
    }

    [Fact]
    public void Set_create_over_an_existing_item_is_rejected()
    {
        var ide = OneProgram();
        var (_, pv) = Ver(ide, "PLC_PRG.st");
        var resp = Push(ide, pv, new SetItemOp { Name = "PLC_PRG.st", IfVersion = null, SourceText = "PROGRAM PLC_PRG\nEND_PROGRAM\n" });
        Assert.False(resp.Accepted);
        Assert.Contains(resp.Conflicts!, c => c.Reason.Contains("already exists"));
    }
}
