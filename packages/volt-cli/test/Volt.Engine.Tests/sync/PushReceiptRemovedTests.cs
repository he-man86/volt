using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A PUSH RECEIPT'S <c>removed</c> PROVES EACH REMOVAL (openspec <c>push-removed-proves-a-delete</c>): a path is named
/// only when the receipt walk read its folder and no longer holds it, so a client may take <c>removed</c> as proof a
/// delete took effect without reading the project again.
///
/// <para>A landed op is not that proof: "landed" is the bridge saying it ran the call (the CODESYS delete-child case
/// answers success and the object can stay), and an item under a folder the receipt walk could not read is unseen,
/// not gone.</para>
/// </summary>
public class PushReceiptRemovedTests
{
    private static string Prg(string name) => $"PROGRAM {name}\nVAR\nEND_VAR\n%LANGUAGE ST\nn := 0;\n\nEND_PROGRAM\n";

    /// <summary>A project holding <paramref name="names"/> under <paramref name="folder"/>, each pushed in.</summary>
    private static void Seed(FakeIde ide, string folder, params string[] names) =>
        Assert.True(BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion,
            Ops = names.Select(n => (PushOp)new SetItemOp { Name = $"{folder}/{n}.pou", SourceText = Prg(n), IfVersion = null }).ToList(),
        }).Landed());

    private static PushResponse Delete(FakeIde ide, string path)
    {
        var refs = RefsService.Handle(ide);
        return BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new DeleteItemOp { Name = path, IfVersion = refs.Items[path] } },
        });
    }

    /// <summary>1.2 / 1.4 — THE DELETE THE IDE ACCEPTED AND DID NOT PERFORM. The call answers success and the item stays:
    /// the push does not report it landed. It is a post-condition of the apply the IDE broke, so the op is refused
    /// <c>IDE_LOST_ITEM</c> where it ran — the push stops there, like any apply-time refusal — and its path is not in
    /// <c>removed</c>. Nothing of it stays, so it is not <c>partiallyApplied</c>; nothing landed, so there is no receipt.</summary>
    [Fact]
    public void A_delete_the_ide_answered_and_did_not_perform_is_refused_not_removed()
    {
        var ide = new FakeIde { DeletesThatDoNotTake = new[] { "Stays" } };
        Seed(ide, "POUs", "Stays", "Other");

        var res = Delete(ide, "POUs/Stays.pou");

        Assert.Contains("delete:Stays", ide.Recorded);
        Assert.Contains("POUs/Stays.pou", RefsService.Handle(ide).Items.Keys);
        Assert.False(res.Landed());
        Assert.Null(res.NewProjectVersion);
        var c = Assert.Single(res.Conflicts!);
        Assert.Equal("POUs/Stays.pou", c.Name);
        Assert.Equal(BridgeErrorCodes.IdeLostItem, c.Code);
        Assert.Null(c.PartiallyApplied);
        Assert.DoesNotContain("POUs/Stays.pou", res.Removed ?? new List<string>());
    }

    /// <summary>The same delete among other ops: the ops applied before it land and are in the receipt, the push stops at
    /// it (every op after it <c>NOT_ATTEMPTED</c>), and its path is neither in <c>removed</c> nor claimed changed.</summary>
    [Fact]
    public void A_delete_that_did_not_take_stops_the_push_and_keeps_what_landed_before_it()
    {
        var ide = new FakeIde { DeletesThatDoNotTake = new[] { "Stays" } };
        Seed(ide, "POUs", "Stays", "Goes", "Later");
        var refs = RefsService.Handle(ide);

        var res = BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new DeleteItemOp { Name = "POUs/Goes.pou", IfVersion = refs.Items["POUs/Goes.pou"] },
                new DeleteItemOp { Name = "POUs/Stays.pou", IfVersion = refs.Items["POUs/Stays.pou"] },
                new DeleteItemOp { Name = "POUs/Later.pou", IfVersion = refs.Items["POUs/Later.pou"] },
            },
        });

        Assert.NotNull(res.NewProjectVersion);
        Assert.Equal(new[] { "POUs/Goes.pou" }, res.Removed);
        Assert.DoesNotContain("POUs/Stays.pou", res.NewItems!.Keys);
        Assert.Equal(new[] { ("POUs/Stays.pou", BridgeErrorCodes.IdeLostItem), ("POUs/Later.pou", ConflictCodes.NotAttempted) },
                     res.Conflicts!.Select(x => (x.Name, x.Code)));
        Assert.Equal(new[] { "POUs/Later.pou", "POUs/Stays.pou" },
                     RefsService.Handle(ide).Items.Keys.Where(k => k.StartsWith("POUs/", System.StringComparison.Ordinal)).OrderBy(k => k, System.StringComparer.Ordinal));
    }

    /// <summary>The control: a delete that takes IS in <c>removed</c> — the receipt walk read its folder and no longer
    /// holds it.</summary>
    [Fact]
    public void A_delete_that_took_is_removed()
    {
        var ide = new FakeIde();
        Seed(ide, "POUs", "Goes", "Other");

        var res = Delete(ide, "POUs/Goes.pou");

        Assert.True(res.Landed());
        Assert.Equal(new[] { "POUs/Goes.pou" }, res.Removed);
    }

    /// <summary>1.3 — A LANDED DELETE UNDER A FOLDER THE RECEIPT WALK COULD NOT READ. The pre-apply walk held the item
    /// and the delete ran; the receipt walk then skips its folder, so it neither holds nor misses the item. Unseen is
    /// not gone: the path is not in <c>removed</c>, and the folder is in <c>unwalkedFolders</c>.</summary>
    [Fact]
    public void A_landed_delete_under_an_unwalked_receipt_folder_is_not_removed()
    {
        var ide = new FakeIde();
        // A sibling keeps the folder from being pruned as emptied.
        Seed(ide, "Machine", "Hidden", "Sibling");
        // The folder stops enumerating once the delete has run — the receipt walk is the first to meet it.
        ide.OnWalkItems = () =>
        {
            if (ide.Recorded.Contains("delete:Hidden")) ide.UnwalkableFolders = new[] { "Machine" };
        };

        var res = Delete(ide, "Machine/Hidden.pou");

        Assert.Contains("delete:Hidden", ide.Recorded);
        Assert.True(res.Landed(), res.Conflicts is null ? "" : string.Join(" | ", res.Conflicts.Select(c => c.Reason)));
        Assert.Contains("Machine", res.UnwalkedFolders!);
        Assert.DoesNotContain("Machine/Hidden.pou", res.Removed!);
    }

    /// <summary>The same for a landed MOVE's old path: under a folder the receipt walk could not read it is unseen, not
    /// gone — the one rule (<c>Gone</c>) covers every path a landed op leaves.</summary>
    [Fact]
    public void A_landed_move_out_of_an_unwalked_receipt_folder_does_not_claim_its_old_path_removed()
    {
        var ide = new FakeIde();
        Seed(ide, "Machine", "Moving", "Sibling");
        ide.OnWalkItems = () =>
        {
            if (ide.Recorded.Any(r => r.StartsWith("move:Moving", System.StringComparison.Ordinal)))
                ide.UnwalkableFolders = new[] { "Machine" };
        };
        var refs = RefsService.Handle(ide);

        var res = BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp { Name = "Machine/Moving.pou", To = "Cell/Moving.pou", IfVersion = refs.Items["Machine/Moving.pou"] },
            },
        });

        Assert.True(res.Landed(), res.Conflicts is null ? "" : string.Join(" | ", res.Conflicts.Select(c => c.Reason)));
        Assert.Contains("Machine", res.UnwalkedFolders!);
        Assert.Contains("Cell/Moving.pou", res.NewItems!.Keys);
        Assert.DoesNotContain("Machine/Moving.pou", res.Removed!);
    }
}
