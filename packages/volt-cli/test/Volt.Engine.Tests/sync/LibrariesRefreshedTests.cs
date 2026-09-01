using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// THE FLAG THAT TELLS THE CLIENT WHICH WORLD IT IS IN.
///
/// <para><c>FetchResponse.LibrariesRefreshed</c> is set by <c>FetchService</c> and read by the CLI
/// (<c>Commands.cs</c> passes it straight into <c>IdeTree.BuildVoltIdeTree</c>). No test asserted it, at either
/// end — so the two halves of the library-refresh contract were free to disagree with nothing noticing.</para>
///
/// <para>The contract in one sentence: <b>refreshed ⇒ Changed carries the COMPLETE set of signatures per
/// library folder, so anything the client still holds there is gone; not refreshed ⇒ Changed carries NO
/// signatures at all, so the client must keep what it has.</b> Without the flag the client cannot tell those
/// apart and has to keep them always — which is how a removed library's signatures became immortal.</para>
///
/// <para>Getting it wrong is symmetric and both directions are bad: falsely TRUE deletes signatures the client
/// should have kept; falsely FALSE resurrects a removed library's API files forever.</para>
/// </summary>
public class LibrariesRefreshedTests
{
    private const string Manifest = "LIBRARY Standard\nNAMESPACE Standard\nRESOLUTION Standard, 1.0.0.0 (System)";

    private static FakeIde Project() => new(
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"),
        FakeIde.Item.Library("Standard", Manifest));

    private static FetchResponse Fetch(FakeIde ide, FetchRequest request) => FetchService.Handle(ide, request);

    /// <summary>AN INIT ALWAYS REFRESHES. The client holds nothing, so the complete set is the only honest
    /// answer — and the precompile the extraction needs is exactly what an init is paying for.</summary>
    [Fact]
    public void An_init_refreshes_the_libraries()
        => Assert.True(Fetch(Project(), new FetchRequest { Init = true }).LibrariesRefreshed);

    /// <summary>A FETCH WHOSE LIBRARY VERSIONS HAVE NOT MOVED DOES NOT REFRESH — this is the whole
    /// optimization. Re-rendering signatures means running the IDE's precompile, which is the expensive part of
    /// a pull; skipping it is only safe BECAUSE the flag tells the client to keep what it holds.</summary>
    [Fact]
    public void An_incremental_fetch_over_unchanged_libraries_does_not_refresh()
    {
        var ide = Project();
        var known = new Dictionary<string, string>(Fetch(ide, new FetchRequest { Init = true }).Items);

        var again = Fetch(ide, new FetchRequest { KnownItems = known });

        Assert.False(again.LibrariesRefreshed);
        Assert.DoesNotContain(again.Changed, c => c.Name.EndsWith(".library"));
    }

    /// <summary>AND A LIBRARY WHOSE VERSION MOVED REFRESHES AGAIN. The client is holding signatures rendered
    /// against the OLD library, and they are not merely stale — a removed or renamed element still resolves in
    /// the workspace and the LSP keeps offering it.</summary>
    [Fact]
    public void A_changed_library_version_refreshes()
    {
        var ide = Project();
        var known = new Dictionary<string, string>(Fetch(ide, new FetchRequest { Init = true }).Items);

        // the same library, a new version — the manifest IS the library's content
        ide.RemoveItem("Standard");
        ide.AddItem(FakeIde.Item.Library(
            "Standard", "LIBRARY Standard\nNAMESPACE Standard\nRESOLUTION Standard, 2.0.0.0 (System)"));

        Assert.True(Fetch(ide, new FetchRequest { KnownItems = known }).LibrariesRefreshed);
    }

    /// <summary>A TARGETED FETCH NEVER REFRESHES, whatever the library versions say.
    ///
    /// <para><c>onlyItems</c> asks for named items and nothing else. Reporting a refresh there would be a lie
    /// with teeth: the client would take `Changed` as the complete per-folder set and delete every signature
    /// not in a response that was never going to contain any.</para></summary>
    [Fact]
    public void A_targeted_fetch_never_refreshes()
    {
        var ide = Project();

        var resp = Fetch(ide, new FetchRequest { OnlyItems = new List<string> { "PLC_PRG.prg" } });

        Assert.False(resp.LibrariesRefreshed);
    }

    /// <summary>AND A TARGETED FETCH ON A FIRST CONTACT STILL DOES NOT REFRESH — `onlyItems` wins over the
    /// init-shaped absence of `knownItems`, because the two conditions are AND-ed and only one of them is about
    /// what the response is allowed to claim.</summary>
    [Fact]
    public void A_targeted_fetch_with_no_known_items_still_does_not_refresh()
        => Assert.False(Fetch(Project(),
            new FetchRequest { OnlyItems = new List<string> { "PLC_PRG.prg" }, KnownItems = new() })
            .LibrariesRefreshed);

    /// <summary>THE FLAG AND THE PAYLOAD AGREE. Asserting the boolean alone would pass over a service that set
    /// it correctly and then rendered the opposite — and it is the PAYLOAD the client acts on.</summary>
    [Fact]
    public void The_flag_matches_whether_signatures_were_actually_rendered()
    {
        var ide = Project();

        var init = Fetch(ide, new FetchRequest { Init = true });
        var incremental = Fetch(ide, new FetchRequest
        { KnownItems = new Dictionary<string, string>(init.Items) });

        Assert.True(init.LibrariesRefreshed);
        Assert.Contains(init.Changed, c => c.Name.EndsWith(".library"));

        Assert.False(incremental.LibrariesRefreshed);
        Assert.DoesNotContain(incremental.Changed, c => c.Name.EndsWith(".library"));
    }
}
