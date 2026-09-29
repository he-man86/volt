using System.Linq;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Volt.Tests.Shared;

namespace Volt.Engine.Tests;

/// <summary>
/// A PUSH MAY NOT RE-TYPE AN EXISTING ITEM.
///
/// <para>An item's kind comes from the TREE — the object really is a function block, or a program, or a DUT —
/// and a declaration write cannot change that: it writes TEXT into an object whose type is already decided.
/// Accepting one wrote `PROGRAM X` over a live function block, reported <c>updated</c>, and the CLI then saved
/// a receipt and ref pair asserting the workspace and the IDE agreed — over a project that no longer builds.
/// On CODESYS the body is CLEARED as well.</para>
///
/// <para><b>Why this was invisible offline until now.</b> <c>FakeIde.KindOf</c> derived an item's kind by
/// PARSING ITS DECLARATION, so the fake re-typed the object to match whatever the push asserted and every test
/// agreed with the push. Both real drivers take the kind from the tree code. A fake that derives MORE than its
/// driver does not model it — it invents agreement, and this is the bug that agreement hid.</para>
///
/// <para>It is reachable from an ordinary edit: renaming `X.fb` to `X.prg` leaves the BARE name unchanged, so
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

    /// <summary>A NAME that re-types the object is refused, naming what the object IS — the rename <c>K.fb</c> →
    /// <c>K.prg</c>, which leaves the bare name unchanged and so arrives as a content write.</summary>
    [Fact]
    public void Renaming_a_function_block_to_a_program_is_refused()
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
                    Name = "K.fb", ToName = "K.prg", IfVersion = refs.Items["K.fb"],
                    SourceText = "PROGRAM K\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\n\nEND_PROGRAM\n",
                },
            },
        });

        Assert.False(resp.Accepted);
        Assert.Contains("cannot change what it IS", resp.Conflicts![0].Reason);
        // NOTHING was written: a refusal that lands half the change is worse than one that lands none.
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("writecontent:"));
    }

    /// <summary>The TEXT is not a re-type: a push does not read a top-level item's header (openspec
    /// <c>push-without-header-check</c>), so <c>K.fb</c> whose text says <c>PROGRAM</c> is written as sent and the
    /// IDE's build judges it. These two used to be refused by that header; what the IDE then holds is task 1.2's live
    /// measurement.</summary>
    [Fact]
    public void A_function_blocks_text_declaring_a_program_is_written_as_sent()
    {
        var ide = WithFunctionBlock();
        var resp = Push(ide, "K.fb", "PROGRAM K\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\n\nEND_PROGRAM\n");

        Assert.True(resp.Accepted, resp.Conflicts is null ? "" : resp.Conflicts[0].Reason);
        Assert.Equal("PROGRAM K\nVAR\n\tx : INT;\nEND_VAR", ide.WrittenContent["K"].Declaration);
    }

    /// <summary>…while a DUT's text under an FB's name cannot be SPLIT — it has no IMPLEMENTATION line and no END line
    /// of a POU — so it is refused INVALID_ST for that, and nothing is written.</summary>
    [Fact]
    public void A_function_blocks_text_that_is_a_DUT_cannot_be_split_and_is_refused()
    {
        var ide = WithFunctionBlock();
        var resp = Push(ide, "K.fb", "TYPE K :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n");

        Assert.False(resp.Accepted);
        Assert.Equal(Volt.Contracts.BridgeErrorCodes.InvalidSt, resp.Conflicts![0].Code);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("writecontent:"));
    }

    [Fact]
    public void An_ordinary_edit_of_the_same_kind_still_applies()
    {
        // The guard must cost nothing to the case it is not about.
        var ide = WithFunctionBlock();
        var resp = Push(ide, "K.fb", "FUNCTION_BLOCK K\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\nx := 2;\n\nEND_FUNCTION_BLOCK\n");

        Assert.True(resp.Accepted);
        Assert.Contains(ide.Recorded, r => r.StartsWith("writecontent:"));
    }
}
