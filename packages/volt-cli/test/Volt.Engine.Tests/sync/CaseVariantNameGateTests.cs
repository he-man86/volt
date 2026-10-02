using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// THE VERSION GATE RESOLVES A NAME AS THE APPLY DOES — CASE-INSENSITIVELY. IEC identifiers are case-insensitive, and
/// the apply finds an op's item through the item cache by bare name ignoring case. The gate used to look the op's full
/// name up ORDINAL in the version map, so `e_mode.dut` over a live `E_Mode.dut` (or `fb_motor.pou` over `FB_Motor.pou`)
/// found nothing: a create passed as a create, and the apply then resolved `E_Mode` and overwrote it with no version
/// check. Before openspec <c>push-without-header-check</c> 5.P the DUT half was closed by a DUT-only sibling scan
/// (<c>LiveDut</c>, OrdinalIgnoreCase); 5.P deleted it, and the POU half had never been closed. One rule now covers
/// every kind: a create over a case variant of a live item is <c>ITEM_EXISTS</c>, and a guarded update or delete is
/// gated against that item's version.
/// </summary>
public class CaseVariantNameGateTests
{
    private static FakeIde Ide() => new(
        new FakeIde.Item("E_Mode", ItemKind.PlcDut, "DUTs", true, "TYPE E_Mode :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE", null, null, null),
        FakeIde.Item.TextualPou("FB_Motor", "FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR", "x := 1;"));

    [Theory]
    [InlineData("e_mode.dut", "E_Mode.dut", "TYPE e_mode :\nSTRUCT\n\tb : INT;\nEND_STRUCT\nEND_TYPE")]
    [InlineData("fb_motor.pou", "FB_Motor.pou", "FUNCTION_BLOCK fb_motor\nVAR\nEND_VAR\nIMPLEMENTATION ST\ny := 2;\nEND_FUNCTION_BLOCK\n")]
    public void A_create_under_a_case_variant_of_a_live_item_is_refused_item_exists(string name, string live, string text)
    {
        var ide = Ide();
        var refs = RefsService.Handle(ide);
        Assert.Contains(live, refs.Items.Keys);

        var push = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = name, IfVersion = null, SourceText = text } },
        });

        Assert.False(push.Accepted, "a create under a case variant of a live item was accepted");
        var conflict = Assert.Single(push.Conflicts!);
        Assert.True(conflict.Code == ConflictCodes.ItemExists, $"{conflict.Code}: {conflict.Reason}");
        Assert.Equal(name, conflict.Name);
        Assert.Equal(refs.Items[live], conflict.CurrentVersion);
        Assert.Empty(ide.Recorded);
    }

    [Theory]
    [InlineData("e_mode.dut")]
    [InlineData("fb_motor.pou")]
    public void A_guarded_delete_under_a_case_variant_is_gated_against_the_live_items_version(string name)
    {
        var ide = Ide();
        var refs = RefsService.Handle(ide);

        var push = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new DeleteItemOp { Name = name, IfVersion = "0123456789abcdef" } },
        });

        Assert.False(push.Accepted, "a guarded delete under a case variant ran without its version check");
        var conflict = Assert.Single(push.Conflicts!);
        Assert.True(conflict.Code == ConflictCodes.StaleItemVersion, $"{conflict.Code}: {conflict.Reason}");
        Assert.Empty(ide.Recorded);
    }
}
