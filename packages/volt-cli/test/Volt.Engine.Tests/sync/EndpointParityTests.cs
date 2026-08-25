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
