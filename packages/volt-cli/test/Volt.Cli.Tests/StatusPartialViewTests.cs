using System.Collections.Generic;
using Volt.Cli.Sync;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// STATUS DOES NOT REPORT A DELETION FROM A PARTIAL VIEW.
///
/// <para>A deletion is derived from ABSENCE: a name in the baseline that the bridge did not return. When the
/// driver could not enumerate a folder, every item beneath it is absent for that reason and no other — and the
/// diff cannot tell the two apart. `volt status` rendered them as incoming-REMOVED, which reads as "the
/// engineer deleted your POUs".</para>
///
/// <para>The bridge now says so (`unwalkedFolders` on refs and fetch); this is the client half. Same maps,
/// same diff, and the only difference is whether the view was complete.</para>
/// </summary>
public class StatusPartialViewTests
{
    private static readonly Dictionary<string, string> Baseline =
        new() { ["A.prg"] = "v1", ["Deep.prg"] = "v2" };

    /// <summary>A COMPLETE view still reports the deletion — the fix must not silence the feature.</summary>
    [Fact]
    public void A_complete_view_reports_the_deletion()
    {
        var bridge = new Dictionary<string, string> { ["A.prg"] = "v1" };

        var incoming = StatusModel.ComputeIncoming(bridge, Baseline, complete: true);

        Assert.Equal(new[] { "Deep.prg" }, incoming.Removed);
    }

    /// <summary>A PARTIAL view reports none, because it cannot know.</summary>
    [Fact]
    public void A_partial_view_reports_none()
    {
        var bridge = new Dictionary<string, string> { ["A.prg"] = "v1" };

        var incoming = StatusModel.ComputeIncoming(bridge, Baseline, complete: false);

        Assert.Empty(incoming.Removed);
    }

    /// <summary>Additions and modifications survive a partial view: those are evidence of what WAS seen, and
    /// suppressing them would make an incomplete walk useless rather than merely cautious.</summary>
    [Fact]
    public void A_partial_view_still_reports_what_it_did_see()
    {
        var bridge = new Dictionary<string, string> { ["A.prg"] = "CHANGED", ["New.prg"] = "v9" };

        var incoming = StatusModel.ComputeIncoming(bridge, Baseline, complete: false);

        Assert.Equal(new[] { "A.prg" }, incoming.Modified);
        Assert.Equal(new[] { "New.prg" }, incoming.Added);
        Assert.Empty(incoming.Removed);
    }
}
