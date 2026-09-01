using System.Collections.Generic;
using System.Linq;
using Xunit;
using Xunit.Abstractions;
using Volt.Contracts;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// An item Volt cannot READ still EXISTS. Reporting it as removed makes `volt pull` delete the engineer's file
/// for a POU that is sitting in the IDE.
///
/// <para>`removed` is computed as "every name the client knows that this walk did not produce a version for":</para>
/// <code>knownItems.Keys.Where(k =&gt; !fullVersions.ContainsKey(k))</code>
/// <para>and the walk skips an unreadable item before it ever reaches <c>fullVersions</c> —
/// <c>if (mat == null) { unreadable++; continue; }</c>. So absence-from-the-response carries two meanings that
/// the wire cannot tell apart: "this is gone" and "this defeated the reader". The response even COUNTS the second
/// case (the `unreadable` drop tally) while describing it as the first.</para>
///
/// <para>The walk already knows better. It records the item in <c>versions</c> with the Unreadable sentinel
/// before the body gates, precisely so `/fetch`'s projectVersion still matches `/refs`. Only the removal
/// calculation forgets.</para>
/// </summary>
public class UnreadableIsNotRemovedTests
{
    private readonly ITestOutputHelper _out;
    public UnreadableIsNotRemovedTests(ITestOutputHelper o) => _out = o;

    /// <summary>A project whose one POU cannot be materialized — a graphical export with no FBD/LD body, the
    /// shape that once bricked `/refs`.</summary>
    private static FakeIde WithUnreadable() => new FakeIde(
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"),
        FakeIde.Item.MalformedGraphical("FB_Broken"));

    [Fact]
    public void An_item_that_cannot_be_read_is_not_reported_as_removed()
    {
        var ide = WithUnreadable();

        // The client already holds both, from a pull taken when the POU still read cleanly.
        var known = new Dictionary<string, string>
        {
            ["PLC_PRG.prg"] = "stale-so-it-re-sends",
            ["FB_Broken.prg"] = "whatever-it-hashed-to",
        };

        var res = FetchService.Handle(ide, new FetchRequest { KnownItems = known });
        _out.WriteLine($"removed: [{string.Join(", ", res.Removed)}]");

        Assert.DoesNotContain("FB_Broken.prg", res.Removed);
    }

    /// <summary>A PARTIAL walk reports NO deletions at all.
    /// <para>A driver skips a subtree it cannot enumerate rather than failing the pull — right, because a
    /// transient COM fault on one folder should not stop everything. What it could not do was TELL anyone:
    /// `WalkItems()` returned a plain list, so a partial tree was indistinguishable from a complete one, and
    /// deletion is derived from absence. One faulting folder therefore deleted the engineer's files for every POU
    /// beneath it.</para>
    /// <para>The evidence existed and was unreachable: CODESYS logged the skip at Warn and TwinCAT at Debug —
    /// off by default — and neither reached the code that had to act on it. Suppressing every deletion is the
    /// only honest answer available, because absence means nothing once part of the tree went unseen.</para>
    /// <para>This test could not be written before: a fake has no COM to break, so `FakeIde` gained
    /// `UnwalkableFolders` — which is why the whole cluster of walk-fault findings was untestable.</para></summary>
    [Fact]
    public void A_partial_walk_reports_no_deletions()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"),
            FakeIde.Item.TextualPou("FB_Hidden", "FUNCTION_BLOCK FB_Hidden\nVAR\nEND_VAR", "y := 1;", "POUs"))
        {
            UnwalkableFolders = new[] { "POUs" },     // the driver could not enumerate it
        };

        var res = FetchService.Handle(ide, new FetchRequest
        {
            KnownItems = new Dictionary<string, string> { ["PLC_PRG.prg"] = "v", ["FB_Hidden.prg"] = "v" },
        });
        _out.WriteLine($"removed: [{string.Join(", ", res.Removed)}]");

        Assert.Empty(res.Removed);
    }

    /// <summary>And completeness is not assumed: the SAME project walked fully still reports the real deletion.
    /// <para>Without this, "suppress deletions" could be implemented as "never delete" and pass — making a
    /// deleted POU immortal in every workspace.</para></summary>
    [Fact]
    public void The_same_project_walked_fully_still_reports_the_deletion()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"));

        var res = FetchService.Handle(ide, new FetchRequest
        {
            KnownItems = new Dictionary<string, string> { ["PLC_PRG.prg"] = "v", ["FB_Hidden.prg"] = "v" },
        });

        Assert.Contains("FB_Hidden.prg", res.Removed);
    }

    /// <summary>The genuine case still works: a name the client knows and the walk did NOT see is removed.
    /// <para>Here so the fix cannot be "never report anything removed", which would make a deleted POU immortal
    /// in every workspace — the failure the removal signal exists to prevent.</para></summary>
    [Fact]
    public void An_item_that_really_is_gone_is_still_reported_as_removed()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"));

        var res = FetchService.Handle(ide, new FetchRequest
        {
            KnownItems = new Dictionary<string, string> { ["PLC_PRG.prg"] = "v", ["FB_Deleted.fb"] = "v" },
        });

        Assert.Contains("FB_Deleted.fb", res.Removed);
    }
}
