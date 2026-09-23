using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A DIRECTED FETCH CANNOT SPEAK ABOUT WHAT IT DID NOT LOOK AT.
///
/// <para><c>onlyItems</c> skips an item before it reaches <c>fullVersions</c>, and <c>removed</c> is derived
/// from absence there — so a caller that sent a real <c>knownItems</c> baseline alongside a directed fetch was
/// told every item OUTSIDE its subset had been deleted. <c>IdeTree.BuildVoltIdeTree</c> acts on that list, so
/// the workspace is wiped down to the subset.</para>
///
/// <para><b>It never fired, and that is the interesting part.</b> Every caller happens to send an empty or
/// single-entry baseline with <c>onlyItems</c> — <c>volt show BRIDGE</c> passes a one-key baseline whose key
/// IS the requested item, and the e2e harness converged on <c>{knownItems:{}, onlyItems:[x]}</c> in about
/// seventeen places without the contract ever saying why. The protocol made the dangerous shape look like the
/// ordinary one, which is the kind of defect that waits for a new client rather than showing up in testing.</para>
/// </summary>
public class FetchDirectedTests
{
    private static string Prg(string name) =>
        $"PROGRAM {name}\nVAR\nEND_VAR\n(* @volt-implementation *)\nn := 0;\n\nEND_PROGRAM\n";

    /// <summary>Three items, so a subset is genuinely a subset.</summary>
    private static FakeIde Project()
    {
        var ide = new FakeIde();
        foreach (var n in new[] { "A", "B", "C" })
            PushService.Handle(ide, new PushRequest
            {
                ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion,
                Ops = new List<PushOp> { new SetItemOp { Name = $"{n}.prg", SourceText = Prg(n), IfVersion = null } },
            });
        return ide;
    }

    private static Dictionary<string, string> Baseline(FakeIde ide) =>
        RefsService.Handle(ide).Items.ToDictionary(x => x.Key, x => x.Value);

    /// <summary>THE BUG. A real baseline plus a directed subset used to report the other two as deleted.</summary>
    [Fact]
    public void A_directed_fetch_with_a_real_baseline_reports_nothing_removed()
    {
        var ide = Project();

        var res = FetchService.Handle(ide, new FetchRequest
        {
            KnownItems = Baseline(ide),
            OnlyItems = new List<string> { "A.prg" },
        });

        Assert.Empty(res.Removed);
    }

    /// <summary>And the undirected case still reports a real deletion — the fix must not silence the feature
    /// it is narrowing.</summary>
    [Fact]
    public void An_undirected_fetch_still_reports_a_real_deletion()
    {
        var ide = Project();
        var before = Baseline(ide);
        PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion,
            Ops = new List<PushOp> { new DeleteItemOp { Name = "B.prg", IfVersion = before["B.prg"] } },
        });

        var res = FetchService.Handle(ide, new FetchRequest { KnownItems = before });

        Assert.Equal(new[] { "B.prg" }, res.Removed);
    }

    /// <summary>`onlyItems: []` MEANS ZERO ITEMS, not "everything".
    ///
    /// <para>It used to collapse to null when empty, which gave one value three readings at once: the
    /// NO_SIDECAR check saw a non-null list and allowed the request, the per-item filter saw null and let
    /// every item through, and the library gate saw null and ran the full signature extraction. A caller
    /// asking for nothing got the most expensive answer the bridge has.</para></summary>
    [Fact]
    public void An_empty_onlyItems_asks_for_nothing()
    {
        var ide = Project();

        var res = FetchService.Handle(ide, new FetchRequest
        {
            KnownItems = new Dictionary<string, string>(),
            OnlyItems = new List<string>(),
        });

        Assert.Empty(res.Changed);
        Assert.False(res.LibrariesRefreshed, "an empty subset triggered the full library extraction");
    }

    /// <summary>A named subset returns that subset and no more — the behaviour the flag is for.</summary>
    [Fact]
    public void A_named_subset_returns_only_those_items()
    {
        var ide = Project();

        var res = FetchService.Handle(ide, new FetchRequest
        {
            KnownItems = new Dictionary<string, string>(),
            OnlyItems = new List<string> { "A.prg", "C.prg" },
        });

        Assert.Equal(new[] { "A.prg", "C.prg" }, res.Changed.Select(c => c.Name).OrderBy(x => x).ToArray());
    }
}
