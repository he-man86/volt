using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A FOLDER THIS PUSH EMPTIED IS REMOVED — the derivation Volt's git-shaped interface was missing.
///
/// <para><b>Git is the specification.</b> A directory is not an entity there either: deleting the last file
/// under <c>a/b/</c> records exactly that one path, and a directory rename is N file renames. Volt matches —
/// <c>FolderPath</c> is "the folder path a tree item lives in", the wire's <c>folders</c> map is item → path,
/// and the ops are <c>set</c> and <c>deleteItem</c>. What was missing is what git does NEXT: it REMOVES the
/// now-empty directory from the working tree, as a consequence of the file going.</para>
///
/// <para><b>Measured on both vendors before this was written.</b> Neither IDE prunes on its own and both expose
/// the primitive — <c>scripts/probe-empty-folder-lifecycle.py</c> for CODESYS (folder survives at children=0,
/// and <c>folder.remove()</c> works), a COM tree walk for TwinCAT (<c>VltFold/New</c> and <c>VltFold/Old</c>
/// both at children=0 after a folder rename moved every item out, beside <c>Moved</c>, <c>Sub/Deep</c> and a
/// <c>POUs/POUs</c> left by earlier runs; <c>DeleteChild</c> removes them). Git pruned the workspace half for
/// free, so the two sides diverged silently and for ever.</para>
///
/// <para><b>WHY THIS IS NOT AN E2E</b>, which is the interesting part. An empty folder is UNREPRESENTABLE on
/// the wire: <c>refs</c>/<c>fetch</c> publish <c>folders</c> keyed BY ITEM, and <c>ProjectSnapshot.IsTracked</c>
/// excludes container managers from the version hashes — so a folder holding nothing changes nothing a client
/// can observe. A live test asserting "no item is in that folder" passes identically whether the prune ran or
/// not, which is exactly what the first attempt at one did. The behaviour is only visible to the vendor's own
/// tree, and the probes above are what looked at it. What IS testable here is the LOGIC, and that needed the
/// fake to be able to express an empty folder first — it could not, deriving folders from the items in them.</para>
/// </summary>
public class FolderPruneTests
{
    private static string Prg(string name) => $"PROGRAM {name}\nVAR\nEND_VAR\n(* @volt-implementation *)\nn := 0;\n\nEND_PROGRAM\n";

    private static SetItemOp Create(string wireName, string folder) =>
        new() { Name = wireName, ToFolder = folder, SourceText = Prg(Materializer.Bare(wireName)), IfVersion = null };

    private static void Push(FakeIde ide, params PushOp[] ops)
    {
        var refs = RefsService.Handle(ide);
        var res = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = ops.ToList(),
        });
        Assert.True(res.Accepted, "push refused: " + (res.Conflicts is null
            ? "(none)"
            : string.Join(" | ", res.Conflicts.Select(c => c.Reason))));
    }

    /// <summary>The version the IDE currently holds for an item — what a real client quotes in `ifVersion`.</summary>
    private static string VersionOf(FakeIde ide, string wireName) =>
        RefsService.Handle(ide).Items[wireName];

    /// <summary>Does the tree still hold this folder? Asked of the DRIVER, because that is the only place an
    /// empty folder exists — the wire cannot report one.</summary>
    private static bool HasFolder(FakeIde ide, string path)
    {
        var node = ide.GetTreeRoot();
        foreach (var segment in path.Split('/'))
        {
            var found = false;
            for (var i = 1; i <= ide.ChildCount(node); i++)
            {
                var child = ide.ChildAt(node, i);
                // BY LAST SEGMENT: this fake names a folder node by its FULL PATH, a real driver by its
                // leaf. Comparing the leaf of whatever comes back works for both.
                var leaf = ide.Name(child);
                var cut = leaf.LastIndexOf('/');
                if (cut >= 0) leaf = leaf.Substring(cut + 1);
                if (ide.KindCode(child) != ItemKind.PlcFolder || leaf != segment) continue;
                node = child;
                found = true;
                break;
            }
            if (!found) return false;
        }
        return true;
    }

    /// <summary>THE FAKE HAS TO BE ABLE TO SAY IT, or every assertion below is an echo. This is the guard on
    /// that: a folder created as a folder outlives the item that was in it, which is what both vendors do.</summary>
    [Fact]
    public void The_fake_can_express_a_folder_that_holds_nothing()
    {
        var ide = new FakeIde();
        Push(ide, Create("A.prg", "Keep"));
        Assert.True(HasFolder(ide, "Keep"));

        ide.Delete(ide.GetTreeRoot(), "A");     // the ITEM only — no prune involved
        Assert.True(HasFolder(ide, "Keep"), "the fake forgot the folder when its item left, so it cannot model this");
    }

    /// <summary>A DELETE that empties a folder removes it.</summary>
    [Fact]
    public void A_delete_that_empties_a_folder_removes_it()
    {
        var ide = new FakeIde();
        Push(ide, Create("Gone.prg", "Empties"));
        Assert.True(HasFolder(ide, "Empties"));

        Push(ide, new DeleteItemOp { Name = "Gone.prg", IfVersion = VersionOf(ide, "Gone.prg") });

        Assert.False(HasFolder(ide, "Empties"), "the folder the delete emptied was left behind");
    }

    /// <summary>A MOVE empties its ORIGIN, which is the same thing happening to a different folder — and the
    /// destination must survive, having just gained the item.</summary>
    [Fact]
    public void A_move_out_removes_the_origin_and_keeps_the_destination()
    {
        var ide = new FakeIde();
        Push(ide, Create("Trav.prg", "From"));

        Push(ide, new SetItemOp { Name = "Trav.prg", ToFolder = "To", IfVersion = VersionOf(ide, "Trav.prg") });

        Assert.False(HasFolder(ide, "From"), "the folder the move emptied was left behind");
        Assert.True(HasFolder(ide, "To"), "the destination was pruned, and it holds the item");
    }

    /// <summary>RULE 2 — RECURSIVE, BECAUSE GIT IS. Emptying <c>a/b/c</c> removes <c>a/b</c> and <c>a</c> too
    /// when each was all its parent held. Without the ancestor walk the shallow half of the chain survives,
    /// which is the litter this exists to stop.</summary>
    [Fact]
    public void The_ancestors_a_prune_empties_go_too()
    {
        var ide = new FakeIde();
        Push(ide, Create("Deep.prg", "Chain/Mid/Leaf"));
        Assert.True(HasFolder(ide, "Chain/Mid/Leaf"));

        Push(ide, new DeleteItemOp { Name = "Deep.prg", IfVersion = VersionOf(ide, "Deep.prg") });

        Assert.False(HasFolder(ide, "Chain/Mid/Leaf"));
        Assert.False(HasFolder(ide, "Chain/Mid"), "the chain was pruned one level and stopped");
        Assert.False(HasFolder(ide, "Chain"), "the chain was pruned two levels and stopped");
    }

    /// <summary>RULE 1 — ONLY WHAT THIS PUSH EMPTIED. A folder still holding something is left alone, which is
    /// the difference between pruning and deleting the engineer's tree. A sibling in the same parent proves both
    /// halves at once: the emptied child goes, the parent stays because the sibling is still in it.</summary>
    [Fact]
    public void A_folder_that_still_holds_something_is_left_alone()
    {
        var ide = new FakeIde();
        Push(ide, Create("Stays.prg", "Parent"), Create("Leaves.prg", "Parent/Child"));

        Push(ide, new DeleteItemOp { Name = "Leaves.prg", IfVersion = VersionOf(ide, "Leaves.prg") });

        Assert.False(HasFolder(ide, "Parent/Child"), "the emptied child folder survived");
        Assert.True(HasFolder(ide, "Parent"), "the parent was pruned while it still held an item");
    }

    /// <summary>AND A FOLDER THAT WAS ALREADY EMPTY IS THE ENGINEER'S. Git would not touch it either, having
    /// nothing to remove — there is no file event to derive a removal from. Only folders THIS push emptied are
    /// candidates, which is why the candidate list comes from the ops rather than from a tree scan.</summary>
    [Fact]
    public void A_folder_that_was_already_empty_is_not_touched()
    {
        var ide = new FakeIde();
        Push(ide, Create("Elsewhere.prg", "Other"));
        ide.CreateChild(ide.GetTreeRoot(), "Untouched", ItemKind.PlcFolder);
        Assert.True(HasFolder(ide, "Untouched"));

        // A push that has nothing to do with it — and must therefore leave it exactly as it found it.
        Push(ide, new DeleteItemOp { Name = "Elsewhere.prg", IfVersion = VersionOf(ide, "Elsewhere.prg") });

        Assert.True(HasFolder(ide, "Untouched"), "a folder this push did not empty was removed anyway");
    }
}
