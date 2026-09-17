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

    [Fact]
    public void Declaring_a_function_block_a_program_is_refused()
    {
        var ide = WithFunctionBlock();
        var resp = Push(ide, "K.fb", "PROGRAM K\nVAR\n\tx : INT;\nEND_VAR\n(* @volt-implementation *)\nx := 1;\n\nEND_PROGRAM\n");

        Assert.False(resp.Accepted);
        Assert.Contains("cannot change what it IS", resp.Conflicts![0].Reason);
        // NOTHING was written: a refusal that lands half the change is worse than one that lands none.
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("writecontent:"));
    }

    [Fact]
    public void Declaring_a_function_block_a_DUT_is_refused()
    {
        // The cross-family case, where no vendor could re-type the object even in principle.
        var resp = Push(WithFunctionBlock(), "K.fb", "TYPE K :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n");

        Assert.False(resp.Accepted);
        Assert.Contains("cannot change what it IS", resp.Conflicts![0].Reason);
    }

    [Fact]
    public void An_ordinary_edit_of_the_same_kind_still_applies()
    {
        // The guard must cost nothing to the case it is not about.
        var ide = WithFunctionBlock();
        var resp = Push(ide, "K.fb", "FUNCTION_BLOCK K\nVAR\n\tx : INT;\nEND_VAR\n(* @volt-implementation *)\nx := 2;\n\nEND_FUNCTION_BLOCK\n");

        Assert.True(resp.Accepted);
        Assert.Contains(ide.Recorded, r => r.StartsWith("writecontent:"));
    }
}
