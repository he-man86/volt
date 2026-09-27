using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A PARTIAL WALK SAYS SO — on both read ops, not just the one that already knew.
///
/// <para>A driver skips a subtree it cannot enumerate rather than failing the whole pull, which is right. What
/// was missing is that only <c>fetch</c> knew: <c>ProjectSnapshot</c> took <c>WalkItems().Items</c> and
/// dropped the completeness one line after the driver produced it, on the stated grounds that nothing derives
/// a DELETION from a snapshot.</para>
///
/// <para>That was true of <c>fetch</c>, which has its own walk and its own suppression — and false of
/// everything built on the snapshot. <c>refs</c> drives <c>volt status</c>, which diffs it against the sidecar:
/// every item under a folder that failed to read is absent from the bridge map, present in the baseline, and
/// therefore rendered as incoming-REMOVED. Status told the user the engineer had deleted their POUs. The same
/// walk backs <c>init</c>/<c>pull</c>, which wrote a workspace missing those items and persisted a
/// <c>projectVersion</c> hashed over the partial set as the IDE baseline.</para>
/// </summary>
public class PartialWalkTests
{
    private static string Prg(string name) =>
        $"PROGRAM {name}\nVAR\nEND_VAR\n(* @volt-implementation *)\nn := 0;\n\nEND_PROGRAM\n";

    /// <summary>Two items at the root and one inside a folder the driver will refuse to enumerate.</summary>
    private static FakeIde WithHiddenFolder()
    {
        var ide = new FakeIde();
        foreach (var (name, folder) in new[] { ("A", ""), ("B", ""), ("Deep", "Machine") })
            PushService.Handle(ide, new PushRequest
            {
                ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion,
                Ops = new List<PushOp>
                {
                    new SetItemOp { Name = $"{name}.prg", ToFolder = folder, SourceText = Prg(name), IfVersion = null },
                },
            });
        return ide;
    }

    [Fact]
    public void Refs_reports_the_folder_it_could_not_read()
    {
        var ide = WithHiddenFolder();
        ide.UnwalkableFolders = new[] { "Machine" };

        var refs = RefsService.Handle(ide);

        Assert.Equal(new[] { "Machine" }, refs.UnwalkedFolders);
        Assert.DoesNotContain("Deep.prg", refs.Items.Keys);   // it really is missing from the map
    }

    [Fact]
    public void Fetch_reports_it_too_and_still_suppresses_removals()
    {
        var ide = WithHiddenFolder();
        var baseline = RefsService.Handle(ide).Items.ToDictionary(x => x.Key, x => x.Value);
        ide.UnwalkableFolders = new[] { "Machine" };

        var res = FetchService.Handle(ide, new FetchRequest { KnownItems = baseline });

        Assert.Equal(new[] { "Machine" }, res.UnwalkedFolders);
        Assert.Empty(res.Removed);
    }

    /// <summary>A PARTIAL WALK STILL KNOWS WHAT IT READ. With the folder each known item last sat in, a name
    /// absent from a folder the walk DID enumerate is gone, and one under the folder it could not read is merely
    /// unseen. The engine decides that — once, for both read ops — rather than each client re-deriving it with
    /// its own rule.</summary>
    [Fact]
    public void A_partial_walk_removes_a_name_absent_from_a_folder_it_read()
    {
        var ide = WithHiddenFolder();
        var baseline = RefsService.Handle(ide);
        ide.RemoveItem("B");
        ide.UnwalkableFolders = new[] { "Machine" };

        var fetch = FetchService.Handle(ide, new FetchRequest { KnownItems = baseline.Items, KnownFolders = baseline.Folders });
        var refs = RefsService.Handle(ide, new RefsRequest { KnownItems = baseline.Items, KnownFolders = baseline.Folders });

        Assert.Equal(new[] { "B.prg" }, fetch.Removed);
        Assert.Equal(fetch.Removed, refs.Removed);
    }

    /// <summary>…and a known name whose folder the client does not state is not judged: absence proves nothing
    /// about an item that may sit under the folder nobody could read.</summary>
    [Fact]
    public void A_partial_walk_does_not_remove_a_name_whose_folder_it_was_not_told()
    {
        var ide = WithHiddenFolder();
        var baseline = RefsService.Handle(ide);
        ide.RemoveItem("B");
        ide.UnwalkableFolders = new[] { "Machine" };
        var folders = baseline.Folders.Where(kv => kv.Key != "B.prg").ToDictionary(kv => kv.Key, kv => kv.Value);

        Assert.Empty(FetchService.Handle(ide, new FetchRequest { KnownItems = baseline.Items, KnownFolders = folders }).Removed);
        Assert.Empty(RefsService.Handle(ide, new RefsRequest { KnownItems = baseline.Items, KnownFolders = folders }).Removed);
    }

    /// <summary>…and the unreadable exemption on a partial walk is the SAME kind-aware one a complete walk uses:
    /// an unreadable program `X` does not shield a DUT `X.struct` the IDE deleted.</summary>
    [Fact]
    public void A_partial_walk_exempts_an_unreadable_item_by_its_kind_not_its_bare_name()
    {
        var ide = WithHiddenFolder();
        var baseline = RefsService.Handle(ide);
        var known = new Dictionary<string, string>(baseline.Items) { ["X.struct"] = "v", ["X.prg"] = "w" };
        var knownFolders = new Dictionary<string, string>(baseline.Folders) { ["X.struct"] = "DUTs", ["X.prg"] = "POUs" };
        ide.AddItem(FakeIde.Item.MalformedGraphical("X", "POUs"));
        ide.UnwalkableFolders = new[] { "Machine" };

        var fetch = FetchService.Handle(ide, new FetchRequest { KnownItems = known, KnownFolders = knownFolders });
        var refs = RefsService.Handle(ide, new RefsRequest { KnownItems = known, KnownFolders = knownFolders });

        Assert.Equal(new[] { "X.struct" }, fetch.Removed);
        Assert.Equal(fetch.Removed, refs.Removed);
    }

    /// <summary>…and a known name the walk found under ANOTHER wire name of the same kind is gone, whatever folder
    /// it last sat in. A DUT is one object under its bare name; retyped (and moved out of a folder that now
    /// faults), the walk publishes `X.enum`. `X.struct` is not "unseen" — the one object was seen, under its new
    /// name — so keeping it would leave two workspace files and two baseline keys for one IDE object.</summary>
    [Fact]
    public void A_partial_walk_removes_the_old_subtype_name_of_a_dut_it_found_retyped()
    {
        var ide = new FakeIde();
        ide.AddItem(FakeIde.Item.TextualPou("X", "TYPE X :\n(\n\tA := 0,\n\tB\n);\nEND_TYPE", "", "DUTs"));
        ide.UnwalkableFolders = new[] { "Old" };
        var known = new Dictionary<string, string> { ["X.struct"] = "v" };
        var knownFolders = new Dictionary<string, string> { ["X.struct"] = "Old" };

        var fetch = FetchService.Handle(ide, new FetchRequest { KnownItems = known, KnownFolders = knownFolders });
        var refs = RefsService.Handle(ide, new RefsRequest { KnownItems = known, KnownFolders = knownFolders });

        Assert.Contains("X.enum", fetch.Items.Keys);
        Assert.Equal(new[] { "X.struct" }, fetch.Removed);
        Assert.Equal(fetch.Removed, refs.Removed);
    }

    /// <summary>The rule is one object under two names of ONE kind — an FB `X` the walk found says nothing about a
    /// known `X.struct` whose folder it could not read (CLAUDE.md, the item-name invariant).</summary>
    [Fact]
    public void A_partial_walk_does_not_retire_a_name_because_another_kind_shares_its_bare_name()
    {
        var ide = new FakeIde();
        ide.AddItem(FakeIde.Item.TextualPou("X", "FUNCTION_BLOCK X\nVAR\nEND_VAR", "", "POUs"));
        ide.UnwalkableFolders = new[] { "Old" };
        var known = new Dictionary<string, string> { ["X.struct"] = "v" };
        var knownFolders = new Dictionary<string, string> { ["X.struct"] = "Old" };

        Assert.Empty(FetchService.Handle(ide, new FetchRequest { KnownItems = known, KnownFolders = knownFolders }).Removed);
        Assert.Empty(RefsService.Handle(ide, new RefsRequest { KnownItems = known, KnownFolders = knownFolders }).Removed);
    }

    /// <summary>`refs` answers the complete walk's removals too, so `volt status` and `volt pull` read the one
    /// answer — and a refs with no baseline reports none.</summary>
    [Fact]
    public void Refs_reports_the_removals_a_fetch_reports()
    {
        var ide = WithHiddenFolder();
        var baseline = RefsService.Handle(ide);
        ide.RemoveItem("Deep");

        var fetch = FetchService.Handle(ide, new FetchRequest { KnownItems = baseline.Items, KnownFolders = baseline.Folders });
        var refs = RefsService.Handle(ide, new RefsRequest { KnownItems = baseline.Items, KnownFolders = baseline.Folders });

        Assert.Equal(new[] { "Deep.prg" }, fetch.Removed);
        Assert.Equal(fetch.Removed, refs.Removed);
        Assert.Empty(RefsService.Handle(ide).Removed);
    }

    /// <summary>And a complete walk still says nothing, so the field cannot become noise a client learns to
    /// ignore.</summary>
    [Fact]
    public void A_complete_walk_reports_no_unwalked_folders()
    {
        var ide = WithHiddenFolder();

        Assert.Empty(RefsService.Handle(ide).UnwalkedFolders);
        Assert.Empty(FetchService.Handle(ide, new FetchRequest { Init = true }).UnwalkedFolders);
    }
}
