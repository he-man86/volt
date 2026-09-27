using System.Linq;
using Volt.Cli.Sync;
using Xunit;
using static Volt.Cli.Tests.CommandHarness;

namespace Volt.Cli.Tests;

/// <summary>
/// STATUS DOES NOT REPORT A DELETION IT CANNOT KNOW.
///
/// <para>A deletion used to be derived HERE, from absence: a name in the baseline that the bridge did not return.
/// When the driver could not enumerate a folder, every item beneath it is absent for that reason and no other, so
/// `volt status` rendered them as incoming-REMOVED, which reads as "the engineer deleted your POUs". The fix was to
/// derive nothing from a partial view — which then also hid a deletion from a folder the walk DID read, one that
/// `volt pull` went on to make.</para>
///
/// <para>The bridge now decides removal (`refs` and `fetch` alike, given the baseline and where each item sat),
/// and status reports its answer. These drive `volt status` over a real pipe to pin the same three facts end to
/// end: a complete view reports the deletion, a partial one never reports what it could not see, and it still
/// reports what it did see.</para>
/// </summary>
public class StatusPartialViewTests
{
    private static FakeIde Ide() => ConnectedIde(
        FakeIde.Item.TextualPou("A", "PROGRAM A\nVAR\nEND_VAR", "x := 1;"),
        FakeIde.Item.TextualPou("Deep", "PROGRAM Deep\nVAR\nEND_VAR", "y := 2;", "Machine"));

    /// <summary>A COMPLETE view still reports the deletion — the fix must not silence the feature.</summary>
    [Fact]
    public void A_complete_view_reports_the_deletion()
    {
        var ide = Ide();
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            ide.RemoveItem("Deep");

            Assert.Equal(new[] { "Deep.prg" }, Commands.Status(root, client).Incoming.Removed);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>A PARTIAL view never reports an item under the folder it could not read.</summary>
    [Fact]
    public void A_partial_view_reports_nothing_it_could_not_see()
    {
        var ide = Ide();
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            ide.UnwalkableFolders = new[] { "Machine" };

            Assert.Empty(Commands.Status(root, client).Incoming.Removed);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>Additions and modifications survive a partial view: those are evidence of what WAS seen, and
    /// suppressing them would make an incomplete walk useless rather than merely cautious.</summary>
    [Fact]
    public void A_partial_view_still_reports_what_it_did_see()
    {
        var ide = Ide();
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            ide.RemoveItem("A");
            ide.AddItem(FakeIde.Item.TextualPou("A", "PROGRAM A\nVAR\nEND_VAR", "x := 2;"));
            ide.AddItem(FakeIde.Item.TextualPou("New", "PROGRAM New\nVAR\nEND_VAR", "z := 9;"));
            ide.UnwalkableFolders = new[] { "Machine" };

            var incoming = Commands.Status(root, client).Incoming;
            Assert.Equal(new[] { "A.prg" }, incoming.Modified);
            Assert.Equal(new[] { "New.prg" }, incoming.Added);
            Assert.Empty(incoming.Removed);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }
}
