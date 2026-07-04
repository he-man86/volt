using System.Linq;
using Volt.Bridge.Core.Sync;
using Volt.Bridge.Core.Wire;
using Xunit;

namespace Volt.Bridge.Tests;

/// <summary>The bridge only returns items with compiler ground truth: an excluded-from-build object has none,
/// so it is omitted from /fetch and /refs entirely (no changed entry, no version) — the client never tracks a
/// file the LSP would false-positive on, and there is no side-channel marker field. (Dead-code omission needs a
/// build result — <c>GetCompiledPouNames</c> — which the FakeIde can't produce, so it's covered live, not here.)</summary>
public class FetchExclusionTests
{
    private static FakeIde.Item Pou(string name, bool excluded = false) =>
        FakeIde.Item.TextualPou(name, $"FUNCTION_BLOCK {name}\nEND_FUNCTION_BLOCK\n", "") with { ExcludeFromBuild = excluded };

    [Fact]
    public void Fetch_omits_excluded_from_build_items()
    {
        var ide = new FakeIde(Pou("Good"), Pou("Bad", excluded: true));
        var resp = FetchService.Handle(ide, new FetchRequest());

        Assert.Contains(resp.Changed, c => c.Name.StartsWith("Good"));
        Assert.DoesNotContain(resp.Changed, c => c.Name.StartsWith("Bad"));
        Assert.DoesNotContain(resp.Items.Keys, k => k.StartsWith("Bad"));
    }

    [Fact]
    public void Refs_omits_excluded_from_build_items()
    {
        var ide = new FakeIde(Pou("Good"), Pou("Bad", excluded: true));
        var resp = RefsService.Handle(ide);

        Assert.Contains(resp.Items.Keys, k => k.StartsWith("Good"));
        Assert.DoesNotContain(resp.Items.Keys, k => k.StartsWith("Bad"));
    }
}
