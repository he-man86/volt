using System.Collections.Generic;
using System.Linq;
using Xunit;
using Xunit.Abstractions;
using Volt.Contracts;
using Volt.Engine.Sync;

namespace Volt.Cli.Tests;

/// <summary>
/// A push that MOVES an item and EDITS it must not reach the IDE through a handle the edit invalidated.
///
/// <para><c>MoveItem</c> deliberately writes the content first and moves second, and the reason is sound: the
/// write is the step that can refuse, so writing first makes a refusal atomic — the item has not moved, and there
/// is nothing to undo. That ordering is correct and stays.</para>
///
/// <para>What it missed is that on TwinCAT the write is a document IMPORT, and an import invalidates every handle
/// into the item it replaced (DIALECT D4d). So the very next line — <c>ide.Move(item, …)</c> — passes a handle
/// the previous statement killed. A move+edit therefore fails on TwinCAT every time, and fails again on every
/// retry, because the same push always writes before it moves: the combination is not flaky, it is unpushable.</para>
///
/// <para>Untestable until now for a specific reason: `FakeIde` modelled handle invalidation on MOVE only, so a
/// write could never stale anything and this was unrepresentable. The real driver's two events are separate, and
/// the fake now says so.</para>
/// </summary>
public class MoveAfterWriteTests
{
    private readonly ITestOutputHelper _out;
    public MoveAfterWriteTests(ITestOutputHelper o) => _out = o;

    private static FakeIde TwincatLike() => new FakeIde(
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"),
        FakeIde.Item.TextualPou("FB_A", "FUNCTION_BLOCK FB_A\nVAR\nEND_VAR", "y := 1;"))
    {
        InvalidatesHandlesOnWrite = true,     // DIALECT D4d — the import replaces the item
    };

    /// <summary>Move and edit in ONE op — the ordinary "I renamed the folder and touched the code" push.</summary>
    [Fact]
    public void A_move_that_also_edits_the_content_succeeds()
    {
        var ide = TwincatLike();
        var refs = RefsService.Handle(ide);

        var res = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp
                {
                    Name = "FB_A.fb",
                    ToFolder = "POUs",
                    SourceText = "FUNCTION_BLOCK FB_A\nVAR\nEND_VAR\n\ny := 2;\nEND_FUNCTION_BLOCK\n",
                    IfVersion = refs.Items["FB_A.fb"],
                },
            },
        });

        _out.WriteLine($"accepted={res.Accepted} conflicts={string.Join("; ", (res.Conflicts ?? new List<PushConflict>()).Select(c => c.Reason))}");
        _out.WriteLine($"recorded: {string.Join(", ", ide.Recorded)}");

        Assert.True(res.Accepted,
            "the content write invalidated the handle, and the move then used it — a move+edit is unpushable on " +
            "this vendor, and retrying cannot help because the same push always writes before it moves");
    }

    /// <summary>A move with NO edit still works — nothing invalidated the handle, so this is the case that was
    /// always fine, and it is here so a fix cannot be "stop moving".</summary>
    [Fact]
    public void A_pure_move_still_succeeds()
    {
        var ide = TwincatLike();
        var refs = RefsService.Handle(ide);

        var res = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp { Name = "FB_A.fb", ToFolder = "POUs", IfVersion = refs.Items["FB_A.fb"] },
            },
        });

        Assert.True(res.Accepted);
        Assert.Contains(ide.Recorded, r => r.StartsWith("move:", System.StringComparison.Ordinal));
    }
}
