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

    /// <summary>THE SAME CHECK ON AN ITEM THE IDE WILL NOT OPEN (DIALECT C2i): a forced delete goes through the parent by
    /// name, and when it answers and leaves the item the post-condition is the same — refused <c>IDE_LOST_ITEM</c>, not
    /// landed, nothing of it stays, its path not in <c>removed</c>.</summary>
    [Fact]
    public void A_forced_delete_of_an_unopened_item_that_did_not_take_is_refused_not_removed()
    {
        var ide = new FakeIde { DeletesThatDoNotTake = new[] { "Broken" } };
        Seed(ide, "POUs", "Broken", "Other");
        ide.UnopenedItems.Add("Broken");

        var res = BoundWrite.Push(ide, new PushRequest
        {
            Force = true,
            Ops = new List<PushOp> { new DeleteItemOp { Name = "POUs/Broken.pou" } },
        });

        Assert.Contains("delete:Broken", ide.Recorded);
        Assert.True(ide.Exists("Broken"));
        Assert.False(res.Landed());
        var c = Assert.Single(res.Conflicts!);
        Assert.Equal(("POUs/Broken.pou", BridgeErrorCodes.IdeLostItem), (c.Name, c.Code));
        Assert.Null(c.PartiallyApplied);
        Assert.DoesNotContain("POUs/Broken.pou", res.Removed ?? new List<string>());
        Assert.Empty(ide.OpenedUnopened);
    }

    /// <summary>THE CHECK ITSELF CANNOT READ THE FOLDER. The IDE ran the delete; looking the path up again then faults on a
    /// SIBLING. That fault is the op's refusal (<c>ITEM_UNVERIFIED</c>), but the delete call ran, so the conflict cannot
    /// say nothing of the op stays: it is <c>partiallyApplied</c>, and the receipt walk — which reads the folder — decides
    /// <c>removed</c> as for any partly applied op. A client is never told nothing changed while the item is gone.</summary>
    [Fact]
    public void A_delete_whose_check_faults_on_a_sibling_is_partially_applied_and_the_receipt_proves_the_removal()
    {
        FakeIde ide = null!;
        ide = new FakeIde
        {
            FailDelete = name =>
            {
                if (name == "A") ide.FaultingNameReads = new[] { "B" };
                return null;
            },
        };
        Seed(ide, "F", "A", "B");

        var res = Delete(ide, "F/A.pou");

        Assert.False(ide.Exists("A"));
        var c = Assert.Single(res.Conflicts!);
        Assert.Equal(("F/A.pou", ConflictCodes.ItemUnverified), (c.Name, c.Code));
        Assert.True(c.PartiallyApplied);
        // The reason names the ITEM by its path, never a bare name (an item is always its full path on the wire).
        Assert.Contains("the IDE ran the delete of 'F/A.pou' before the check faulted, so it may be gone", c.Reason);
        Assert.NotNull(res.NewProjectVersion);
        Assert.Equal(new[] { "F/A.pou" }, res.Removed);
        Assert.DoesNotContain("F/A.pou", res.NewItems!.Keys);
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
