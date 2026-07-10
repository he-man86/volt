using System;
using System.Linq;
using Volt.Bridge.Core.Sync;
using Volt.Bridge.Core.Wire;
using Volt.Bridge.Core.Workspace;
using Xunit;

namespace Volt.Bridge.Tests;

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
        var it = ide.WalkItems().Single();
        Assert.ThrowsAny<Exception>(() =>
            Versioning.Materialize(ide, it.Name, ItemKind.Map(it.KindCode)!, it.Item, it.Folder));
    }

    [Fact]
    public void SafeVersion_isolates_an_unreadable_item_with_the_sentinel()
    {
        var ide = new FakeIde(FakeIde.Item.MalformedGraphical("Bad"));
        var it = ide.WalkItems().Single();
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
