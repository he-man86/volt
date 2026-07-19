using System.Collections.Generic;
using System.Linq;
using Volt.Engine;
using Volt.Engine.Sync;
using Volt.Engine.Wire;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>FetchService's incremental diff — the knownItems / onlyItems / removed logic behind `volt pull`.
/// The e2e suite proves this against a LIVE bridge; these pin the same situations at the Core service layer
/// (verifiable offline), completing the two-layer coverage for fetch.</summary>
public class FetchIncrementalTests
{
    private static FakeIde TwoItem() => new FakeIde(
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"),
        FakeIde.Item.TextualPou("FB_Motor", "FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR", "y := 2;", "POUs"));

    private static FetchResponse Fetch(FakeIde ide, Dictionary<string, string> known) =>
        FetchService.Handle(ide, new FetchRequest { KnownItems = known });

    [Fact]
    public void An_unchanged_item_is_excluded_from_changed_but_kept_in_items()
    {
        var ide = TwoItem();
        var full = Fetch(ide, new()).Items;                      // learn the baseline versions
        var resp = Fetch(ide, new Dictionary<string, string>(full)); // nothing changed since
        Assert.Empty(resp.Changed);
        Assert.Contains("PLC_PRG.prg", resp.Items.Keys);         // still in the full version map
    }

    [Fact]
    public void A_content_edit_makes_only_the_edited_item_reappear_in_changed()
    {
        var ide = TwoItem();
        var full = Fetch(ide, new()).Items;
        ide.MutateImplementation("PLC_PRG", "x := 42;");
        var resp = Fetch(ide, new Dictionary<string, string>(full));
        Assert.Contains(resp.Changed, c => c.Name == "PLC_PRG.prg" && c.SourceText.Contains("x := 42;"));
        Assert.DoesNotContain(resp.Changed, c => c.Name == "FB_Motor.fb"); // untouched stays excluded
    }

    [Fact]
    public void OnlyItems_restricts_the_walk_to_the_named_subset()
    {
        var ide = TwoItem();
        var resp = FetchService.Handle(ide, new FetchRequest { OnlyItems = new() { "PLC_PRG.prg" } });
        Assert.Contains(resp.Changed, c => c.Name == "PLC_PRG.prg");
        Assert.DoesNotContain(resp.Changed, c => c.Name == "FB_Motor.fb");
    }

    [Fact]
    public void Removed_reports_a_known_name_that_no_longer_exists()
    {
        var ide = TwoItem();
        var full = Fetch(ide, new()).Items;
        ide.RemoveItem("FB_Motor");                              // the engineer deletes it in the IDE
        var resp = Fetch(ide, new Dictionary<string, string>(full));
        Assert.Contains("FB_Motor.fb", resp.Removed);
        Assert.DoesNotContain("FB_Motor.fb", resp.Items.Keys);
    }

    [Fact]
    public void A_bare_fetch_without_a_baseline_is_refused()
    {
        var ide = TwoItem();
        var ex = Assert.Throws<BridgeException>(() => FetchService.Handle(ide, new FetchRequest()));
        Assert.Contains("knownItems", ex.Message);
    }
}
