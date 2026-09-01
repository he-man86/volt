using System.Collections.Generic;
using Xunit;
using Xunit.Abstractions;
using Volt.Contracts;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// An op that is neither a set nor a delete must be REFUSED, not reported as an accepted no-op.
///
/// <para><c>PushOp</c> is a concrete class, so an op arriving without its <c>op</c> discriminator — or with a
/// PascalCase one — deserializes as the plain base type. The dispatch's <c>default</c> arm covered that case and
/// the legitimate one (an idempotent delete of an item that is already gone) with the same answer: "no-op".</para>
///
/// <para>So a client whose ops ALL silently did nothing received <c>accepted: true</c> and a receipt, and its
/// next status showed the same outgoing changes it had just "pushed".</para>
/// </summary>
public class MalformedPushOpTests
{
    private readonly ITestOutputHelper _out;
    public MalformedPushOpTests(ITestOutputHelper o) => _out = o;

    private static FakeIde Ide() => new FakeIde(
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"));

    [Fact]
    public void An_op_with_no_recognised_discriminator_is_refused()
    {
        var ide = Ide();
        var refs = RefsService.Handle(ide);

        // The shape a missing/misspelled `op` produces after deserialization: the BASE type.
        var res = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new PushOp { Name = "PLC_PRG.prg", IfVersion = refs.Items["PLC_PRG.prg"] } },
        });

        _out.WriteLine($"accepted={res.Accepted} conflicts={string.Join("; ", (res.Conflicts ?? new List<PushConflict>()).ConvertAll(c => c.Reason))}");
        Assert.False(res.Accepted, "an op that applied NOTHING was reported as accepted");
    }

    /// <summary>The legitimate no-op still is one: deleting an item that is already gone is idempotent, and the
    /// wire says so. Without this the fix could be "refuse anything that changes nothing".</summary>
    [Fact]
    public void An_idempotent_delete_of_a_missing_item_is_still_accepted()
    {
        var ide = Ide();
        var refs = RefsService.Handle(ide);

        var res = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new DeleteItemOp { Name = "FB_AlreadyGone.fb", IfVersion = null } },
        });

        Assert.True(res.Accepted);
    }
}
