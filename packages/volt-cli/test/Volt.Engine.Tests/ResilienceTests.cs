using System;
using System.Linq;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Sync;
using Volt.Engine.Format.Body;
using Volt.Engine.Item;

namespace Volt.Cli.Tests;

/// <summary>One malformed item (e.g. an LD POU whose PLCopen export has no body) must never crash the aggregate
/// endpoints. Versioning.Materialize stays no-catch for single-item paths where the failure must surface; the
/// aggregate wrapper SafeVersion isolates it with a stable sentinel, and RefsService keeps serving the rest.
/// (The bug this guards once made the whole /refs return 500 and left the orphan undeletable.)</summary>
public class ResilienceTests
{
    [Fact]
    public void Materialize_propagates_an_unreadable_item_so_single_item_paths_surface_it()
    {
        var ide = new FakeIde(FakeIde.Item.MalformedGraphical("Bad"));
        var it = ide.WalkItems().Items.Single();
        Assert.ThrowsAny<Exception>(() =>
            Versioning.Materialize(ide, it.Name, ItemKind.Map(it.KindCode)!, it.Item, it.Folder));
    }

    [Fact]
    public void SafeVersion_isolates_an_unreadable_item_with_the_sentinel()
    {
        var ide = new FakeIde(FakeIde.Item.MalformedGraphical("Bad"));
        var it = ide.WalkItems().Items.Single();
        var version = Versioning.SafeVersion(ide, it.Name, ItemKind.Map(it.KindCode)!, it.Item, it.Folder, out var mat);
        Assert.Equal(Versioning.Unreadable, version);
        Assert.Null(mat);   // no materialized body — so it's omitted from the Items map but stays in the project hash
    }

    [Fact]
    public void RefsService_serves_the_good_items_and_isolates_a_malformed_one_instead_of_crashing()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("Good", "PROGRAM Good\nVAR\nEND_VAR", "x := 1;"),
            FakeIde.Item.MalformedGraphical("Bad"));

        var refs = RefsService.Handle(ide);   // must NOT throw — the malformed item used to 500 the whole call

        Assert.Contains(refs.Items.Keys, k => k.StartsWith("Good"));      // the good item is listed (Good.prg)
        Assert.DoesNotContain(refs.Items.Keys, k => k.StartsWith("Bad")); // the malformed one is isolated (unmaterializable)
        Assert.False(string.IsNullOrEmpty(refs.ProjectVersion));          // the project version still computes (sentinel in the hash)
    }

    /// <summary>AN UNREADABLE ITEM IS NAMED ON THE WIRE — otherwise nothing anywhere can tell it exists.
    ///
    /// <para>The tests above pin the isolation: the item stays in the project hash and is left out of
    /// <c>Items</c>, so a pull neither crashes nor deletes it. What none of them pinned is that the CLIENT is
    /// told. It was not: the count went to the debug log and the wire said nothing, so a POU that failed to
    /// materialize was simply ABSENT — no item, no folder, no error. That is exactly how a real project lost a
    /// POU to one box whose <c>En</c> pin read as a boolean (DIALECT C7): the log knew, the engineer did not,
    /// and git never saw the file.</para>
    ///
    /// <para>Naming it is what makes the failure observable — a client can surface it, and a whole-project
    /// sweep can assert the list is EMPTY rather than trusting that everything came through.</para></summary>
    [Fact]
    public void An_unreadable_item_is_named_on_the_wire_by_both_endpoints()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("Good", "PROGRAM Good\nVAR\nEND_VAR", "x := 1;"),
            FakeIde.Item.MalformedGraphical("Bad"));

        var refs = RefsService.Handle(ide);
        var fetch = FetchService.Handle(ide, new FetchRequest { Init = true });

        Assert.Equal(new[] { "Bad" }, refs.Unreadable);
        Assert.Equal(new[] { "Bad" }, fetch.Unreadable);

        // …and it is still NOT a removal: an item Volt could not read has not gone anywhere, and reporting it as
        // removed would make the next pull delete the engineer's file.
        Assert.DoesNotContain(fetch.Removed, r => r.StartsWith("Bad", StringComparison.Ordinal));
    }

    /// <summary>A project that reads cleanly reports NOTHING unreadable — so the assertion above cannot pass by
    /// accident on an empty list.</summary>
    [Fact]
    public void A_readable_project_reports_nothing_unreadable()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("Good", "PROGRAM Good\nVAR\nEND_VAR", "x := 1;"));

        Assert.Empty(RefsService.Handle(ide).Unreadable);
        Assert.Empty(FetchService.Handle(ide, new FetchRequest { Init = true }).Unreadable);
    }

    /// <summary>/refs and /fetch must agree on the aggregate versions even when a malformed (unreadable) item
    /// exists: both count it (with its sentinel) in the project/structure hash. Before the fix, /fetch skipped
    /// the unreadable item BEFORE recording its version, so its projectVersion diverged from /refs' (and from the
    /// push receipt, which includes it), breaking the client's optimistic-concurrency guard on the next push.</summary>
    [Fact]
    public void RefsService_and_FetchService_agree_on_aggregate_versions_with_a_malformed_item()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("Good", "PROGRAM Good\nVAR\nEND_VAR", "x := 1;"),
            FakeIde.Item.MalformedGraphical("Bad"));

        var refs = RefsService.Handle(ide);
        var fetch = FetchService.Handle(ide, new FetchRequest { Init = true });

        Assert.Equal(refs.ProjectVersion, fetch.ProjectVersion);
        Assert.Equal(refs.StructureVersion, fetch.StructureVersion);
    }
}
