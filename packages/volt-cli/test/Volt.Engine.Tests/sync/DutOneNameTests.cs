using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// EVERY DUT IS <c>X.dut</c> (openspec <c>push-without-header-check</c> 5.P, owner 2026-10-02: "keep it simple").
/// The subtype left the wire, the contract and the push: nothing in Volt reads, carries or spells it. These are the
/// three behaviours the pivot changes, written before the code (design.md, step 5.P, Migration 2):
/// <list type="bullet">
///   <item>a struct rewritten as an enum is ONE content update of <c>X.dut</c> — the name does not change;</item>
///   <item>a split name (<c>X.struct</c> …) names no kind and is refused <c>BAD_REQUEST</c>, forced or not;</item>
///   <item>deleting a DUT reads no content, so an unreadable DUT takes the generic unreadable path a POU takes.</item>
/// </list>
/// </summary>
public class DutOneNameTests
{
    private const string Struct = "TYPE X :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE";
    private const string Enum = "TYPE X :\n(\n\tIdle := 0,\n\tRun\n);\nEND_TYPE\n";

    private static FakeIde OneStruct() =>
        new(new FakeIde.Item("X", ItemKind.PlcDut, "DUTs", true, Struct, null, null, null));

    [Fact]
    public void A_struct_rewritten_as_an_enum_is_one_content_update_under_the_same_name()
    {
        var ide = OneStruct();
        var refs = RefsService.Handle(ide);
        Assert.Equal(new[] { "X.dut" }, refs.Items.Keys.ToArray());

        var push = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = "X.dut", IfVersion = refs.Items["X.dut"], SourceText = Enum } },
        });

        Assert.True(push.Accepted, string.Join("; ", push.Conflicts?.Select(c => $"{c.Name}: {c.Reason}") ?? new string[0]));
        Assert.Equal(new[] { "writecontent:X" }, ide.Recorded);
        Assert.Equal(new[] { "X.dut" }, push.NewItems!.Keys.ToArray());
        var after = RefsService.Handle(ide);
        Assert.Equal(new[] { "X.dut" }, after.Items.Keys.ToArray());
        Assert.Equal("DUTs", after.Folders["X.dut"]);
    }

    [Theory]
    [InlineData("X.struct", false)]
    [InlineData("X.enum", false)]
    [InlineData("X.union", true)]
    [InlineData("X.alias", true)]
    public void A_split_dut_name_is_refused_bad_request_before_anything_is_written(string name, bool force)
    {
        var ide = OneStruct();
        var refs = RefsService.Handle(ide);

        var push = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Force = force,
            Ops = new List<PushOp> { new SetItemOp { Name = name, IfVersion = refs.Items["X.dut"], SourceText = Enum } },
        });

        Assert.False(push.Accepted);
        var conflict = Assert.Single(push.Conflicts!);
        Assert.Equal(BridgeErrorCodes.BadRequest, conflict.Code);
        Assert.Equal(name, conflict.Name);
        Assert.Empty(ide.Recorded);
    }

    /// <summary>A delete of <c>X.dut</c> decides "does this name the IDE's <c>X</c>" by KIND alone — every kind has one
    /// extension — so a DUT whose content cannot be read is treated exactly as a POU whose content cannot be read, in
    /// every combination: guarded by the version the client's baseline still holds from before it became unreadable
    /// (as <c>volt push</c> sends for a held file) it is a version conflict unforced; unguarded it is deleted, as the
    /// POU is; under force it is deleted. (Before 5.P the delete materialized the DUT to compare subtype names and
    /// refused an unreadable one with a DUT-only error, <c>UnreadableDut</c> — the unguarded row.)</summary>
    [Theory]
    [InlineData(false, "0123456789abcdef", false)]
    [InlineData(false, null, true)]
    [InlineData(true, "0123456789abcdef", true)]
    [InlineData(true, null, true)]
    public void Deleting_an_unreadable_dut_takes_the_generic_unreadable_path(bool force, string? ifVersion, bool deleted)
    {
        var dut = new FakeIde(new FakeIde.Item("X", ItemKind.PlcDut, "DUTs", true, Struct, null, null, "read failed (COM)"));
        var pou = new FakeIde(new FakeIde.Item("X", ItemKind.PlcPou, "DUTs", true,
            "FUNCTION_BLOCK X\nVAR\nEND_VAR", "", null, "read failed (COM)"));

        PushResponse Delete(FakeIde ide, string name) => PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion,
            Force = force,
            Ops = new List<PushOp> { new DeleteItemOp { Name = name, IfVersion = ifVersion } },
        });

        var dutPush = Delete(dut, "X.dut");
        var pouPush = Delete(pou, "X.pou");

        Assert.Equal(pouPush.Accepted, dutPush.Accepted);
        Assert.Equal(pouPush.Conflicts?.Select(c => c.Code), dutPush.Conflicts?.Select(c => c.Code));
        Assert.Equal(pou.Recorded, dut.Recorded);
        Assert.Equal(deleted, !dut.Exists("X"));
    }
}
