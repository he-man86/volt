using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Sync;
using Volt.Engine.Wire;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>`volt status` reads <c>/refs</c>; `volt pull` reads <c>/fetch</c>; `volt push` returns a receipt — all
/// three MUST produce the SAME version map, or status would report different drift than pull (and a push would
/// wrongly see "pull first"). The live e2e pins this against a real bridge; these pin it OFFLINE (the CI gate) over
/// the shared services, so a change to one path (e.g. FetchService) cannot silently diverge from /refs.</summary>
public class EndpointParityTests
{
    // A representative mix: two POUs in different folders + a referenced library (the paths that could diverge).
    private static FakeIde Mixed() => new FakeIde(
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"),
        FakeIde.Item.TextualPou("FB_Motor", "FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR", "y := 2;", "POUs"),
        FakeIde.Item.Library("CmpX", "LIBRARY CmpX\nNAMESPACE CmpX\nRESOLUTION CmpX, 1.0.0.0 (System)"));

    [Fact]
    public void Status_refs_and_pull_fetch_produce_the_same_version_map()
    {
        var ide = Mixed();
        var refs = RefsService.Handle(ide);                                   // what `volt status` reads
        var fetch = FetchService.Handle(ide, new FetchRequest { Init = true }); // what `volt pull` reads

        Assert.Equal(refs.ProjectVersion, fetch.ProjectVersion);
        Assert.Equal(refs.StructureVersion, fetch.StructureVersion);
        Assert.Equal(
            refs.Items.OrderBy(kv => kv.Key, System.StringComparer.Ordinal),
            fetch.Items.OrderBy(kv => kv.Key, System.StringComparer.Ordinal)); // same keys AND versions
    }

    [Fact]
    public void Push_receipt_matches_refs()
    {
        var ide = Mixed();
        var refs = RefsService.Handle(ide);
        // An empty push still returns a fresh receipt (a cold re-walk) — it must equal /refs.
        var receipt = PushService.Handle(ide, new PushRequest { Ops = new(), ExpectedProjectVersion = refs.ProjectVersion });

        Assert.True(receipt.Accepted);
        Assert.Equal(refs.ProjectVersion, receipt.NewProjectVersion);
        Assert.Equal(
            refs.Items.OrderBy(kv => kv.Key, System.StringComparer.Ordinal),
            receipt.NewItems!.OrderBy(kv => kv.Key, System.StringComparer.Ordinal));
    }
}
