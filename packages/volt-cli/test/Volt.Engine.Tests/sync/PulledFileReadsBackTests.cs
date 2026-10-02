using System.Linq;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// WHAT A PULL WRITES, A PUSH READS BACK — WITH THE SAME MEMBERS (openspec <c>push-without-header-check</c> 5.E.1).
///
/// <para>The IDE stores each member's text on its own, and the push reads them back out of ONE file through the child
/// splitter (<c>StReader.Read</c>), which refuses texts it cannot split right: an END keyword after code on its line, a
/// member keyword inside an open member, a comment left open in one member and closed in another. An IDE member whose
/// stored text holds one of those shapes would be pulled into a file no push accepts — not even unchanged — or, worse,
/// one the push splits into OTHER members (a member's open comment swallowing the next member, which the push then
/// deletes). So the pull reads its own file back and refuses the item unless it gets the same members, listed
/// unreadable and the workspace file left alone. 0 such members in the six corpora.</para>
/// </summary>
public class PulledFileReadsBackTests
{
    private static FakeIde Fb(params (string Name, string Body)[] methods) => new(
        new[]
        {
            new FakeIde.Item("K", ItemKind.PlcPou, "", true, "FUNCTION_BLOCK K\nVAR\nEND_VAR", ";", null, null,
                             Children: methods.Select(m => m.Name).ToArray()),
        }.Concat(methods.Select(m =>
            new FakeIde.Item(m.Name, ItemKind.PlcMethod, "", false, $"METHOD {m.Name}", m.Body, null, null))).ToArray());

    [Fact]
    public void A_member_body_holding_an_END_line_after_code_is_refused_on_pull()
    {
        var ex = Assert.Throws<BridgeException>(() =>
            Materializer.Materialize(Fb(("A", "x := 1; END_METHOD")), "K", ItemKind.Kinds.Pou, new ItemRef("K")));

        Assert.Equal(BridgeErrorCodes.Unsupported, ex.ErrorCode);
        Assert.Contains("'K'", ex.Message);
        Assert.Contains("END_METHOD stands after code on its line", ex.Message);
    }

    /// <summary>A's body leaves a nested comment open and B's closes a stray one: read as ONE text, A's comment runs over
    /// its END line and B's header, so the file reads back as A alone — B gone, and deleted by the next push.</summary>
    [Fact]
    public void A_member_whose_open_comment_swallows_the_next_one_is_refused_on_pull()
    {
        var ex = Assert.Throws<BridgeException>(() =>
            Materializer.Materialize(Fb(("A", "(* a (* b *)"), ("B", "x := 1; *)")), "K", ItemKind.Kinds.Pou,
                                     new ItemRef("K")));

        Assert.Equal(BridgeErrorCodes.Unsupported, ex.ErrorCode);
        Assert.Contains("'K'", ex.Message);
        Assert.Contains("method 'B'", ex.Message);
    }

    [Fact]
    public void The_refused_item_is_listed_unreadable_and_not_published()
    {
        var refs = RefsService.Handle(Fb(("A", "x := 1; END_METHOD")));

        Assert.DoesNotContain("K.pou", refs.Items.Keys);
        Assert.Contains("K", refs.Unreadable);
    }

    [Fact]
    public void Members_that_read_back_as_themselves_pull()
    {
        var item = Materializer.Materialize(Fb(("A", "(* a (* b *) c *)\nx := 1;"), ("B", "x := 2;")), "K",
                                            ItemKind.Kinds.Pou, new ItemRef("K"));

        Assert.Equal("K.pou", item.FullName);
    }
}
