using System.Linq;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Volt.Tests.Shared;

namespace Volt.Engine.Tests;

/// <summary>
/// A PUSH MAY NOT RE-TYPE AN EXISTING ITEM BY ITS NAME.
///
/// <para>An item's kind comes from the object's CLASS — it really is a POU, an interface, a DUT, a GVL — and the
/// op's from its wire name's extension; the two are compared, the text's header is not read. The TEXT is written as
/// sent: a POU whose text says PROGRAM where it said FUNCTION_BLOCK is still `K.pou` (openspec
/// push-without-header-check 5.Q — the owner changed this premise: until then `K.fb` → `K.prg` was a re-type by
/// NAME and refused here; with one POU extension there is no such name).</para>
///
/// <para><b>Why this was invisible offline until now.</b> <c>FakeIde.KindOf</c> derived an item's kind by
/// PARSING ITS DECLARATION, so the fake re-typed the object to match whatever the push asserted and every test
/// agreed with the push. Both real drivers take the kind from the tree code. A fake that derives MORE than its
/// driver does not model it — it invents agreement, and this is the bug that agreement hid.</para>
///
/// <para>It is reachable from an ordinary edit: renaming `X.pou` to `X.dut` leaves the BARE name unchanged, so
/// the rename compare degrades it to a content write.</para>
/// </summary>
public class ItemKindIsNotRewritableTests
{
    private static FakeIde WithFunctionBlock() =>
        new(FakeIde.Item.TextualPou("K", "FUNCTION_BLOCK K\nVAR\n\tx : INT;\nEND_VAR", "x := 1;"));

    private static PushResponse Push(FakeIde ide, string wireName, string source)
    {
        var refs = RefsService.Handle(ide);
        return PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new System.Collections.Generic.List<PushOp>
            {
                new SetItemOp { Name = wireName, SourceText = source, IfVersion = refs.Items[wireName] },
            },
        });
    }

    /// <summary>A NAME that re-types the object is refused, naming what the object IS — the rename <c>K.pou</c> →
    /// <c>K.dut</c>, which leaves the bare name unchanged and so arrives as a content write.</summary>
    [Fact]
    public void Renaming_a_pou_to_a_dut_is_refused()
    {
        var ide = WithFunctionBlock();
        var refs = RefsService.Handle(ide);
        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new System.Collections.Generic.List<PushOp>
            {
                new SetItemOp
                {
                    Name = "K.pou", ToName = "K.dut", IfVersion = refs.Items["K.pou"],
                    SourceText = "TYPE K :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n",
                },
            },
        });

        Assert.False(resp.Accepted);
        Assert.Contains("cannot re-type an object by its NAME", resp.Conflicts![0].Reason);
        // NOTHING was written: a refusal that lands half the change is worse than one that lands none.
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("writecontent:"));
    }

    /// <summary>The TEXT is not a re-type: a push does not read a top-level item's header (openspec
    /// <c>push-without-header-check</c>), so <c>K.pou</c> whose text says <c>PROGRAM</c> is written as sent and the
    /// IDE's build judges it. These two used to be refused by that header; what the IDE then holds is task 1.2's live
    /// measurement.</summary>
    [Fact]
    public void A_function_blocks_text_declaring_a_program_is_written_as_sent()
    {
        var ide = WithFunctionBlock();
        var resp = Push(ide, "K.pou", "PROGRAM K\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\n\nEND_PROGRAM\n");

        Assert.True(resp.Accepted, resp.Conflicts is null ? "" : resp.Conflicts[0].Reason);
        Assert.Equal("PROGRAM K\nVAR\n\tx : INT;\nEND_VAR", ide.WrittenContent["K"].Declaration);
    }

    /// <summary>…while a DUT's text under an FB's name cannot be SPLIT — it has no IMPLEMENTATION line and no END line
    /// of a POU — so it is refused INVALID_ST for that, and nothing is written.</summary>
    [Fact]
    public void A_function_blocks_text_that_is_a_DUT_cannot_be_split_and_is_refused()
    {
        var ide = WithFunctionBlock();
        var resp = Push(ide, "K.pou", "TYPE K :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n");

        Assert.False(resp.Accepted);
        Assert.Equal(Volt.Contracts.BridgeErrorCodes.InvalidSt, resp.Conflicts![0].Code);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("writecontent:"));
    }

    [Fact]
    public void An_ordinary_edit_of_the_same_kind_still_applies()
    {
        // The guard must cost nothing to the case it is not about.
        var ide = WithFunctionBlock();
        var resp = Push(ide, "K.pou", "FUNCTION_BLOCK K\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nx := 2;\n\nEND_FUNCTION_BLOCK\n");

        Assert.True(resp.Accepted);
        Assert.Contains(ide.Recorded, r => r.StartsWith("writecontent:"));
    }
}
