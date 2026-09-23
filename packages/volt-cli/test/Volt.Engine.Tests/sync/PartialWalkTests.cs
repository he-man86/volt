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
