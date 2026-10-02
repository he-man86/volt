using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// AN ITEM THE DRIVER NAMES BUT MUST NOT OPEN (openspec <c>push-without-header-check</c> 5.H, DIALECT C2i).
///
/// <para>After a solution load, touching the tree item of a TwinCAT POU whose text the IDE does not read as a POU
/// kills TcXaeShell. The driver learns which children those are without touching them and answers
/// <see cref="UnreadableItemException"/> from <c>ChildAt</c> (<see cref="FakeIde.UnopenedItems"/> models it). The
/// engine must then: name it in <c>unreadable</c> and walk on; keep its folder walked (it is a POU, never a
/// container) while never reporting its own file removed; find every item beside it; refuse an op on its name
/// without force, by name; and under force delete it through its parent, by name — a set deleting and recreating it
/// in the same folder. Nothing may open it on the way (<see cref="FakeIde.OpenedUnopened"/>).</para>
/// </summary>
public class UnopenedItemTests
{
    private static string Fb(string name) =>
        $"FUNCTION_BLOCK {name}\nVAR\nEND_VAR\nIMPLEMENTATION ST\nn := 0;\n\nEND_FUNCTION_BLOCK\n";

    /// <summary>A, Data/B and Data/Broken (all function blocks); Broken is then made un-openable.</summary>
    private static (FakeIde Ide, RefsResponse Baseline) Project()
    {
        var ide = new FakeIde();
        foreach (var (name, folder) in new[] { ("A", ""), ("B", "Data"), ("Broken", "Data") })
            PushService.Handle(ide, new PushRequest
            {
                ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion,
                Ops = new List<PushOp> { new SetItemOp { Name = $"{name}.pou", ToFolder = folder, SourceText = Fb(name) } },
            });
        var baseline = RefsService.Handle(ide);
        ide.UnopenedItems.Add("Broken");
        ide.Recorded.Clear();   // only what the test itself causes
        return (ide, baseline);
    }

    [Fact]
    public void Refs_names_it_unreadable_returns_every_other_item_and_keeps_its_folder_walked()
    {
        var (ide, _) = Project();

        var refs = RefsService.Handle(ide);

        Assert.Equal(new[] { "Broken" }, refs.Unreadable);
        Assert.Equal(new[] { "A.pou", "B.pou" }, refs.Items.Keys.OrderBy(k => k).ToArray());
        Assert.Empty(refs.UnwalkedFolders);
        Assert.Empty(ide.OpenedUnopened);
    }

    /// <summary>Its folder is walked, so a sibling deleted in the IDE IS reported removed — and its own known file is
    /// not, because the removal pass knows the kinds it can be.</summary>
    [Fact]
    public void Its_own_file_is_never_removed_while_a_deleted_sibling_in_its_folder_is()
    {
        var (ide, baseline) = Project();
        ide.RemoveItem("B");

        var refs = RefsService.Handle(ide, new RefsRequest { KnownItems = baseline.Items, KnownFolders = baseline.Folders });
        var fetch = FetchService.Handle(ide, new FetchRequest { KnownItems = baseline.Items, KnownFolders = baseline.Folders });

        Assert.Equal(new[] { "B.pou" }, refs.Removed);
        Assert.Equal(new[] { "B.pou" }, fetch.Removed);
        Assert.Equal(new[] { "Broken" }, fetch.Unreadable);
        Assert.Empty(ide.OpenedUnopened);
    }

    [Fact]
    public void A_lookup_finds_the_items_beside_it_and_refuses_its_own_name_by_name()
    {
        var (ide, _) = Project();

        Assert.NotNull(ItemLookup.Find(ide, "B"));
        var refusal = Assert.Throws<BridgeException>(() => ItemLookup.Find(ide, "Broken"));
        Assert.Equal(BridgeErrorCodes.Unreadable, refusal.ErrorCode);
        Assert.Contains("'Broken'", refusal.Message);
        Assert.DoesNotContain(ItemLookup.All(ide), x => x.Name == "Broken");
        Assert.Empty(ide.OpenedUnopened);
    }

    [Fact]
    public void Without_force_a_set_and_a_delete_of_it_are_refused_unreadable_and_nothing_is_written()
    {
        var (ide, _) = Project();

        var set = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = "Broken.pou", SourceText = Fb("Broken") } },
        });
        var delete = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion,
            Ops = new List<PushOp> { new DeleteItemOp { Name = "Broken.pou" } },
        });

        Assert.False(set.Accepted);
        Assert.Equal(BridgeErrorCodes.Unreadable, Assert.Single(set.Conflicts!).Code);
        Assert.False(delete.Accepted);
        Assert.Equal(BridgeErrorCodes.Unreadable, Assert.Single(delete.Conflicts!).Code);
        Assert.Contains("'Broken'", delete.Conflicts![0].Reason);
        Assert.DoesNotContain(ide.Recorded, r => r.Contains("Broken"));
        Assert.Empty(ide.OpenedUnopened);
    }

    /// <summary>VALIDATE EVERY OP BEFORE APPLYING ANY OF THEM: an unforced op on it is refused in the PRE-FLIGHT, so an
    /// earlier op in the same push is never written. The version gate lets the delete through as idempotent (the item
    /// has no version entry), so only the pre-flight can stop it before the apply loop runs.</summary>
    [Fact]
    public void Without_force_an_op_on_it_refuses_the_whole_push_before_an_earlier_op_is_written()
    {
        var (ide, baseline) = Project();

        var push = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp { Name = "A.pou", IfVersion = baseline.Items["A.pou"],
                                SourceText = Fb("A").Replace("n := 0;", "n := 1;") },
                new DeleteItemOp { Name = "Broken.pou" },
            },
        });

        Assert.False(push.Accepted);
        var conflict = Assert.Single(push.Conflicts!);
        Assert.Equal(BridgeErrorCodes.Unreadable, conflict.Code);
        Assert.Equal("Broken.pou", conflict.Name);
        Assert.DoesNotContain("already written", conflict.Reason);
        Assert.Empty(ide.Recorded);
        Assert.Empty(ide.OpenedUnopened);
    }

    [Fact]
    public void A_forced_delete_deletes_it_through_its_parent_by_name()
    {
        var (ide, _) = Project();

        var push = PushService.Handle(ide, new PushRequest
        {
            Force = true,
            Ops = new List<PushOp> { new DeleteItemOp { Name = "Broken.pou" } },
        });

        Assert.True(push.Accepted, string.Join("; ", (push.Conflicts ?? new List<PushConflict>()).Select(c => c.Reason)));
        Assert.Equal(new[] { "delete:Broken" }, ide.Recorded.Where(r => r.Contains("Broken")).ToArray());
        Assert.False(ide.Exists("Broken"));
        Assert.Empty(ide.OpenedUnopened);
    }

    /// <summary>The repair: a forced set deletes it and creates the pushed item in its place — the SAME folder, not
    /// the root — so the next refs lists it as an ordinary item.</summary>
    [Fact]
    public void A_forced_set_deletes_it_and_creates_the_pushed_item_in_the_same_folder()
    {
        var (ide, _) = Project();

        var push = PushService.Handle(ide, new PushRequest
        {
            Force = true,
            Ops = new List<PushOp> { new SetItemOp { Name = "Broken.pou", SourceText = Fb("Broken") } },
        });

        Assert.True(push.Accepted, string.Join("; ", (push.Conflicts ?? new List<PushConflict>()).Select(c => c.Reason)));
        var touched = ide.Recorded.Where(r => r.EndsWith(":Broken")).ToArray();
        Assert.Equal("delete:Broken", touched[0]);
        Assert.Equal("create:Broken", touched[1]);
        var refs = RefsService.Handle(ide);
        Assert.Empty(refs.Unreadable);
        Assert.Equal("Data", refs.Folders["Broken.pou"]);
        Assert.Empty(ide.OpenedUnopened);
    }

    /// <summary>Force drops a version gate; it never widens what a name means. `Broken.dut` names a DUT, and the
    /// IDE's `Broken` is a POU — it is not deleted.</summary>
    [Fact]
    public void A_forced_op_naming_a_kind_it_cannot_be_does_not_reach_it()
    {
        var (ide, _) = Project();

        var push = PushService.Handle(ide, new PushRequest
        {
            Force = true,
            Ops = new List<PushOp> { new DeleteItemOp { Name = "Broken.dut" } },
        });

        Assert.False(push.Accepted);
        Assert.Equal(BridgeErrorCodes.Unreadable, Assert.Single(push.Conflicts!).Code);
        Assert.True(ide.Exists("Broken"));
        Assert.DoesNotContain("delete:Broken", ide.Recorded);
    }
}
