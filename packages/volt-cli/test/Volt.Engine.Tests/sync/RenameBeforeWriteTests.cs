using System.Collections.Generic;
using System.Linq;
using Xunit;
using Xunit.Abstractions;
using Volt.Contracts;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// A REJECTED push must leave the project untouched.
///
/// <para><c>MoveItem</c> already learned this, and says so: "It used to move first, which meant a rejected
/// move+edit left the item ALREADY RELOCATED … the push reported failure while the project had quietly
/// half-changed, and nothing put it back." The fix was to write the content first, because the write is the step
/// that can refuse.</para>
///
/// <para>The RENAME in the same method never got that treatment. It runs before everything —
/// <c>ide.Rename(item, toName)</c> — and a native rename is not a small change: the IDE rewrites every reference
/// to that POU across the project. So a rename+edit whose edit is refused left the item renamed, its call sites
/// rewritten, and the push reporting rejected. Nothing put that back either.</para>
///
/// <para>Same bug, same method, one arm fixed and the other not — which is the shape half these findings share.</para>
/// </summary>
public class RenameBeforeWriteTests
{
    private readonly ITestOutputHelper _out;
    public RenameBeforeWriteTests(ITestOutputHelper o) => _out = o;

    /// <summary>An ordinary, perfectly readable POU. The refusal comes from the PUSHED TEXT rather than the
    /// item's state — malformed network text, which `NetworkTextGate.Validate` rejects inside the write.
    /// <para>Deliberate: an unreadable item is isolated out of `/refs` by design, so it has no version to push
    /// against. Using a real guard on a normal item is also the stronger test — this is the shape an engineer
    /// actually hits, a rename plus an edit that turns out not to parse.</para></summary>
    private static FakeIde WithPlainPou() => new FakeIde(
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"),
        FakeIde.Item.TextualPou("FB_Draw", "PROGRAM FB_Draw\nVAR\nEND_VAR", "y := 1;"));

    /// <summary>A body that parses as graphical and then fails validation — the network is never closed.</summary>
    private const string MalformedBody =
        "PROGRAM FB_Renamed\nVAR\nEND_VAR\n\nNETWORK 0 LD\n  out := (a AND b);\nEND_PROGRAM\n";

    [Fact]
    public void A_rename_whose_edit_is_refused_does_not_rename()
    {
        var ide = WithPlainPou();
        var refs = RefsService.Handle(ide);
        var before = refs.Items.Keys.OrderBy(k => k).ToList();
        _out.WriteLine($"before: [{string.Join(", ", before)}]");

        var res = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp
                {
                    Name = "FB_Draw.prg",
                    ToName = "FB_Renamed",
                    SourceText = MalformedBody,
                    IfVersion = refs.Items["FB_Draw.prg"],
                },
            },
        });

        _out.WriteLine($"accepted={res.Accepted}");
        _out.WriteLine($"recorded: {string.Join(", ", ide.Recorded)}");

        // The push was refused…
        Assert.False(res.Accepted);
        // …so nothing may have been renamed. A native rename rewrites every call site in the project; leaving one
        // behind after a rejected push is a half-applied change nothing puts back.
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("rename:", System.StringComparison.Ordinal));
        Assert.Equal(before, RefsService.Handle(ide).Items.Keys.OrderBy(k => k).ToList());
    }

    /// <summary>A rename whose edit SUCCEEDS still renames — so the fix cannot be "stop renaming".</summary>
    [Fact]
    public void A_rename_with_a_writable_body_still_renames()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"),
            FakeIde.Item.TextualPou("FB_Old", "PROGRAM FB_Old\nVAR\nEND_VAR", "y := 1;"));
        var refs = RefsService.Handle(ide);

        var res = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp
                {
                    Name = "FB_Old.prg",
                    ToName = "FB_New",
                    SourceText = "PROGRAM FB_New\nVAR\nEND_VAR\n\ny := 2;\nEND_PROGRAM\n",
                    IfVersion = refs.Items["FB_Old.prg"],
                },
            },
        });

        Assert.True(res.Accepted);
        Assert.Contains(ide.Recorded, r => r.StartsWith("rename:", System.StringComparison.Ordinal));
        Assert.Contains("FB_New.prg", RefsService.Handle(ide).Items.Keys);
    }
}
