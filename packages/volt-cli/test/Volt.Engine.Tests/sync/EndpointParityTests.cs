using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Sync;

namespace Volt.Cli.Tests;

/// <summary>`volt status` reads <c>/refs</c>; `volt pull` reads <c>/fetch</c>; `volt push` returns a receipt — all
/// three MUST produce the SAME version map, or status would report different drift than pull (and a push would
/// wrongly see "pull first"). The live e2e pins this against a real bridge; these pin it OFFLINE (the CI gate) over
/// the shared services, so a change to one path (e.g. FetchService) cannot silently diverge from /refs.</summary>
public class EndpointParityTests
{
    // A representative mix: two POUs in different folders + a referenced library (the paths that could diverge),
    // plus a control module and the VISUALIZATION that draws it — two items sharing one bare name.
    //
    // That last pair is here because the three walks each built their own version map keyed by the BARE name, so
    // the pair collapsed into one slot and the walk order picked a winner. The three then disagreed in different
    // ways, and every assertion in this file passed anyway: the fixture had no two items that could collide. It
    // is the shape a real project ships (V71_PackML_Hauzer), so it belongs in the fixture the parity gate uses,
    // not only in a test of its own.
    private static FakeIde Mixed() => new FakeIde(
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"),
        FakeIde.Item.TextualPou("FB_Motor", "FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR", "y := 2;", "POUs"),
        FakeIde.Item.Library("CmpX", "LIBRARY CmpX\nNAMESPACE CmpX\nRESOLUTION CmpX, 1.0.0.0 (System)"),
        new FakeIde.Item("CM_Carrier", Volt.Engine.Item.ItemKind.PlcPouFb, "CMs/CM_Carrier", true,
            "FUNCTION_BLOCK CM_Carrier\nVAR\n\tnStep : INT;\nEND_VAR", "nStep := 1;", null, null),
        new FakeIde.Item("CM_Carrier", Volt.Engine.Item.ItemKind.PlcVisObj, "CMs/CM_Carrier", true,
            "visualization: CM_Carrier", null, null, null));

    /// <summary>The fixture's collision is REAL — the two same-bare-named items hash differently and both reach
    /// the wire index. Without this, a regression that dropped one of them would make every parity assertion in
    /// this file pass by comparing two equally-truncated maps.</summary>
    [Fact]
    public void The_fixture_contains_two_items_that_share_a_bare_name()
    {
        var refs = RefsService.Handle(Mixed());
        Assert.Contains("CM_Carrier.fb", refs.Items.Keys);
        Assert.Contains("CM_Carrier.visualization", refs.Items.Keys);
        Assert.NotEqual(refs.Items["CM_Carrier.fb"], refs.Items["CM_Carrier.visualization"]);
    }

    /// <summary>And EDITING the shadowed one moves the aggregate hash. This is the pull-side half of the same
    /// bug: with a bare-keyed hash basis the visualization's version overwrote the FB's, so changing the FB left
    /// <c>projectVersion</c> untouched and <c>volt pull</c> took its "nothing to pull" fast path over real code.</summary>
    [Fact]
    public void Editing_one_of_two_same_bare_named_items_moves_the_project_version()
    {
        var before = RefsService.Handle(Mixed()).ProjectVersion;

        var edited = new FakeIde(
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"),
            FakeIde.Item.TextualPou("FB_Motor", "FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR", "y := 2;", "POUs"),
            FakeIde.Item.Library("CmpX", "LIBRARY CmpX\nNAMESPACE CmpX\nRESOLUTION CmpX, 1.0.0.0 (System)"),
            new FakeIde.Item("CM_Carrier", Volt.Engine.Item.ItemKind.PlcPouFb, "CMs/CM_Carrier", true,
                "FUNCTION_BLOCK CM_Carrier\nVAR\n\tnStep : INT;\nEND_VAR", "nStep := 99;", null, null),
            new FakeIde.Item("CM_Carrier", Volt.Engine.Item.ItemKind.PlcVisObj, "CMs/CM_Carrier", true,
                "visualization: CM_Carrier", null, null, null));

        Assert.NotEqual(before, RefsService.Handle(edited).ProjectVersion);
    }

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

    /// <summary>A referenced library must be reported in the SAME folder by every endpoint — and it must be the
    /// folder its file is actually written to.
    /// <para>It was not. <c>/fetch</c> wrote the stub to <c>Library Manager/&lt;lib&gt;/</c> (so it sits beside the
    /// element signatures rendered for it) but reported it at <c>Library Manager/</c> in the same response's
    /// <c>folders</c> map, and hashed its version over that outer folder; <c>/refs</c> and the push receipt gave
    /// the outer folder too. A client trusting <c>folders</c> looked for the file where it was never written.
    /// Four separate walks each applied — or forgot — the layout rule on their own, which is why the rule now
    /// lives once on <see cref="Versioning.FolderOf"/>, inside the hash every one of them already computes.</para></summary>
    [Fact]
    public void A_library_is_reported_in_the_folder_its_file_is_written_to()
    {
        var ide = Mixed();
        var refs = RefsService.Handle(ide);
        var fetch = FetchService.Handle(ide, new FetchRequest { Init = true });
        var receipt = PushService.Handle(ide, new PushRequest { Ops = new(), ExpectedProjectVersion = refs.ProjectVersion });

        var lib = fetch.Changed.Single(c => c.Name.EndsWith(".library", System.StringComparison.Ordinal));
        Assert.Equal("Library Manager/CmpX", lib.Folder);          // where the file is WRITTEN

        Assert.Equal(lib.Folder, fetch.Folders[lib.Name]);         // ...and where /fetch SAYS it is
        Assert.Equal(lib.Folder, refs.Folders[lib.Name]);          // ...and /refs
        Assert.Equal(lib.Folder, receipt.NewFolders![lib.Name]);      // ...and the push receipt
    }
}
