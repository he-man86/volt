using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// AN UNREADABLE ITEM IS NAMED BY ITS PATH (openspec <c>unreadable-name-carries-kind</c>). Every item on the wire is
/// <c>&lt;folder&gt;/&lt;name&gt;.&lt;kind&gt;</c>, readable or not: the entry in <c>unreadable</c> is exactly the path the
/// item has in <c>items</c> while it reads, minted by the same function, so a client can address it (a forced
/// <c>deleteItem</c>) without guessing its kind. A tree node with no file — a container, an object whose kind could not
/// be read — is listed apart, in <c>unreadableNodes</c>, by its node path.
/// </summary>
public class UnreadableItemPathTests
{
    private const string Dut = "TYPE X :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE\n";

    [Fact]
    public void A_classified_POU_whose_read_fails_is_named_by_the_path_it_has_while_readable()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("Bad", "PROGRAM Bad\nVAR\nEND_VAR", "x := 1;", "POUs"));
        var path = Assert.Single(RefsService.Handle(ide).Items.Keys);

        var broken = new FakeIde(FakeIde.Item.MalformedGraphical("Bad", "POUs"));
        var entry = Assert.Single(RefsService.Handle(broken).Unreadable);

        Assert.Equal(path, entry.Name);
        Assert.Equal("POUs/Bad.pou", entry.Name);
        Assert.Contains("cannot be read", entry.Reason);
    }

    [Fact]
    public void An_unreadable_FB_beside_a_readable_visualization_of_its_name_is_named_as_the_FB()
    {
        var ide = new FakeIde(
            FakeIde.Item.MalformedGraphical("CM_Carrier", "Modules"),
            new FakeIde.Item("CM_Carrier", ItemKind.PlcVisObj, "Modules", true, "VISU", null, null, null));

        var refs = RefsService.Handle(ide);

        Assert.Equal(new[] { "Modules/CM_Carrier.pou" }, refs.Unreadable.Select(u => u.Name));
        Assert.Contains("Modules/CM_Carrier.visualization", refs.Items.Keys);
    }

    /// <summary>A kind whose IDE name already carries its extension (TwinCAT's <c>Untitled2.tmc</c>) keeps it once, as
    /// in <c>items</c>, and a client that knows that path is not told it was removed.</summary>
    [Fact]
    public void A_verbatim_named_kind_is_named_once_and_not_reported_removed()
    {
        var ide = new FakeIde(new FakeIde.Item("Untitled2.tmc", ItemKind.PlcTmcDescription, "Plc", true, null, null, null,
            "the module description cannot be read"));

        var refs = RefsService.Handle(ide, new RefsRequest { KnownItems = new() { ["Plc/Untitled2.tmc"] = "v" } });
        var fetch = FetchService.Handle(ide, new FetchRequest { KnownItems = new() { ["Plc/Untitled2.tmc"] = "v" } });

        Assert.Equal(new[] { "Plc/Untitled2.tmc" }, refs.Unreadable.Select(u => u.Name));
        Assert.Empty(refs.Removed);
        Assert.Empty(fetch.Removed);
    }

    /// <summary>A refused library reference sits in the library's own folder (<c>Versioning.FolderOf</c>), as its
    /// <c>.library</c> does in <c>items</c> — not in the manager's.</summary>
    [Fact]
    public void A_refused_library_is_named_in_its_own_folder()
    {
        var walk = new WalkResult(new List<ProjectItem>(), new List<string>(),
            new[] { new UnreadableObject("Standard", "Library Manager", "a placeholder no version resolves", ItemKind.Kinds.Library) },
            new List<string>());

        var (items, nodes) = Versioning.CountUnclassifiable(walk, new Dictionary<string, string>());

        Assert.Equal(new[] { "Library Manager/Standard/Standard.library" }, items.Select(u => u.Name));
        Assert.Empty(nodes);
    }

    /// <summary>An object of unknown kind and a container node have no file: <c>unreadableNodes</c>, by node path.</summary>
    [Fact]
    public void A_node_with_no_file_is_listed_apart_by_its_node_path()
    {
        var walk = new WalkResult(new List<ProjectItem>(), new List<string>(),
            new[]
            {
                new UnreadableObject("SER_OperationModeType", "Data", "the kind read failed", Kind: null),
                new UnreadableObject("Library Manager", "Device/Plc Logic/Application", "holds a setting no text spells", ItemKind.Kinds.Folder),
            },
            new List<string>());

        var (items, nodes) = Versioning.CountUnclassifiable(walk, new Dictionary<string, string>());

        Assert.Empty(items);
        Assert.Equal(new[] { "Data/SER_OperationModeType", "Device/Plc Logic/Application/Library Manager" }, nodes.Select(u => u.Name));
    }

    /// <summary>The item an op names is its PATH: a <c>set</c> on <c>X.dut</c> is not refused over an unreadable POU
    /// <c>X</c> of known kind — it names another item. Only an object whose kind is unknown may be what the op lands on.</summary>
    [Fact(Skip = "openspec unreadable-name-carries-kind 1.7, stopped for the owner: the gate no longer refuses this op, but the APPLY resolves it by folder + bare name (the IDE's lookup key) and lands on the object X of another kind - a re-type (UNSUPPORTED on a readable X; INTERNAL_ERROR from the failed read of an unreadable X.pou; UNREADABLE from ApplyToUnopened for an unopened X). The design's 'applied' needs the apply to resolve by path, which it does not plan.")]
    public void A_set_of_another_kind_beside_an_unreadable_item_of_known_kind_is_applied()
    {
        var ide = new FakeIde(FakeIde.Item.MalformedGraphical("X", "Data"));

        var push = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = "Data/X.dut", SourceText = Dut } },
        });

        Assert.True(push.Accepted, string.Join("; ", (push.Conflicts ?? new List<PushConflict>()).Select(c => $"{c.Code}: {c.Reason}")));
    }

    [Fact(Skip = "openspec unreadable-name-carries-kind 1.7, stopped for the owner: the gate no longer refuses this op, but the APPLY resolves it by folder + bare name (the IDE's lookup key) and lands on the object X of another kind - a re-type (UNSUPPORTED on a readable X; INTERNAL_ERROR from the failed read of an unreadable X.pou; UNREADABLE from ApplyToUnopened for an unopened X). The design's 'applied' needs the apply to resolve by path, which it does not plan.")]
    public void A_set_beside_an_unopened_POU_of_its_bare_name_is_applied()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("X", "PROGRAM X\nVAR\nEND_VAR", "n := 0;", "Data"));
        ide.UnopenedItems.Add("X");

        var push = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = "Data/X.dut", SourceText = Dut } },
        });

        Assert.True(push.Accepted, string.Join("; ", (push.Conflicts ?? new List<PushConflict>()).Select(c => $"{c.Code}: {c.Reason}")));
        Assert.Empty(ide.OpenedUnopened);
    }

    [Fact]
    public void A_set_beside_an_object_of_unknown_kind_of_its_bare_name_is_still_refused()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("X", "PROGRAM X\nVAR\nEND_VAR", "n := 0;", "Data"));
        ide.UnclassifiableItems = new[] { "X" };

        var push = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = "Data/X.dut", SourceText = Dut } },
        });

        Assert.False(push.Accepted);
        Assert.Equal(BridgeErrorCodes.Unreadable, Assert.Single(push.Conflicts!).Code);
    }

    [Fact]
    public void Refs_and_fetch_over_one_walk_give_identical_lists()
    {
        var ide = new FakeIde(
            FakeIde.Item.MalformedGraphical("B", "Data"),
            FakeIde.Item.MalformedGraphical("A"),
            FakeIde.Item.TextualPou("U", "PROGRAM U\nVAR\nEND_VAR", "n := 0;", "Data"),
            FakeIde.Item.TextualPou("Kept", "PROGRAM Kept\nVAR\nEND_VAR", "n := 0;"));
        ide.UnclassifiableItems = new[] { "U" };

        var refs = RefsService.Handle(ide);
        var fetch = FetchService.Handle(ide, new FetchRequest { KnownItems = new() });

        Assert.Equal(new[] { "A.pou", "Data/B.pou" }, refs.Unreadable.Select(u => u.Name));
        Assert.Equal(new[] { "Data/U" }, refs.UnreadableNodes.Select(u => u.Name));
        Assert.Equal(refs.Unreadable, fetch.Unreadable);
        Assert.Equal(refs.UnreadableNodes, fetch.UnreadableNodes);
    }
}
