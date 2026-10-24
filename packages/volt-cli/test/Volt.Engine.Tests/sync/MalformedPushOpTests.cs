using System.Collections.Generic;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// A push op that changes nothing. An op with no <c>op</c> discriminator never reaches the dispatch: <c>PushOp</c> is
/// abstract and the body read refuses it BAD_REQUEST (<c>PipeTransportTests</c>). What reaches it and changes nothing is
/// the legitimate no-op below.
/// </summary>
public class MalformedPushOpTests
{
    private static FakeIde Ide() => new FakeIde(
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"));

    /// <summary>Deleting an item that is already gone is idempotent, and the wire says so.</summary>
    [Fact]
    public void An_idempotent_delete_of_a_missing_item_is_still_accepted()
    {
        var ide = Ide();
        var refs = RefsService.Handle(ide);

        var res = BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new DeleteItemOp { Name = "FB_AlreadyGone.pou", IfVersion = null } },
        });

        Assert.True(res.Landed());
    }
}
