using System.Collections.Generic;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Sync;
using Volt.Engine.Library;

namespace Volt.Engine.Tests;

/// <summary>Method C: FetchService runs the referenced-library precompile ONLY when a `.library` version changed vs
/// the client's knownItems. The `.library` files are hashed like any other file and already carried in knownItems,
/// so this reuses that change signal — no cache, no fingerprint field. (FakeIde.ExtractCalls counts real
/// extractions.)</summary>
public class LibrarySignatureFetchTests
{
    private static FakeIde.Item Lib(string name, string version) =>
        FakeIde.Item.Library(name, $"LIBRARY {name}\nNAMESPACE {name}\nRESOLUTION {name}, {version} (System)");

    private static FakeIde OneLib() => new FakeIde(
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"),
        Lib("CmpX", "1.0.0.0"));

    private static FakeIde TwoLibs() => new FakeIde(
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"),
        Lib("CmpX", "1.0.0.0"), Lib("CmpY", "2.0.0.0"));

    // The pure decision — unchanged / added / version-bumped / removed.
    [Fact]
    public void LibrariesUnchanged_decision()
    {
        var known = new Dictionary<string, string> { ["A.library"] = "v1", ["B.library"] = "v1", ["PLC_PRG.prg"] = "p" };
        Assert.True(LibraryFetch.LibrariesUnchanged(new Dictionary<string, string> { ["A.library"] = "v1", ["B.library"] = "v1" }, known));
        Assert.False(LibraryFetch.LibrariesUnchanged(new Dictionary<string, string> { ["A.library"] = "v2", ["B.library"] = "v1" }, known)); // bump
        Assert.False(LibraryFetch.LibrariesUnchanged(new Dictionary<string, string> { ["A.library"] = "v1", ["B.library"] = "v1", ["C.library"] = "v1" }, known)); // added
        Assert.False(LibraryFetch.LibrariesUnchanged(new Dictionary<string, string> { ["A.library"] = "v1" }, known)); // B removed
    }

    /// <summary>When the signatures are re-rendered, EVERY library's `.library` stub must ride along — including
    /// the ones whose own version did not move.
    /// <para>`librariesRefreshed` has a stated client contract, spelled out in `IdeTree`: "ideFiles carries the
    /// COMPLETE set for every library folder, so a signature the client still holds and this response does not
    /// carry is an element that no longer exists". The general skip a few lines earlier —
    /// `if (!isInit && known == version) continue;` — contradicts it for the stub of an UNCHANGED library. The
    /// response then describes CmpY's folder as empty, the client drops `CmpY.library`, and the merge deletes a
    /// file nothing was wrong with.</para>
    /// <para>Worse than a lost file, and this is why it is Tier 1: with the stub gone `IdeTree.LibraryRoots` no
    /// longer recognises the folder, so everything under it loses both the removal exemption and the read-only
    /// guard — a `.dut` there becomes PUSHABLE as a project item, keyed by bare name, either creating junk inside
    /// the Library Manager or overwriting the project's own DUT of the same short name.</para>
    /// <para>`volt status` stays clean throughout, because the sidecar still lists it.</para></summary>
    [Fact]
    public void A_version_bump_on_one_library_still_carries_every_other_librarys_stub()
    {
        // The client knows both libraries at their current versions…
        var ide = TwoLibs();
        var first = FetchService.Handle(ide, new FetchRequest { Init = true });
        var known = new Dictionary<string, string>(first.Items);

        // …then CmpX alone is upgraded. CmpY has not moved.
        var bumped = new FakeIde(
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"),
            Lib("CmpX", "1.0.0.1"), Lib("CmpY", "2.0.0.0"));

        var res = FetchService.Handle(bumped, new FetchRequest { KnownItems = known });

        var names = new HashSet<string>();
        foreach (var c in res.Changed) names.Add(c.Name);
        Assert.Contains("CmpX.library", names);      // the one that moved, obviously
        Assert.True(names.Contains("CmpY.library"),
            "the signatures were re-rendered, so Changed is the COMPLETE picture per library folder — but " +
            "CmpY.library was skipped as unchanged, so the client sees its folder as empty and deletes the stub");
    }

    [Fact]
    public void Init_always_extracts()
    {
        var ide = OneLib();
        FetchService.Handle(ide, new FetchRequest { Init = true });
        Assert.Equal(1, ide.ExtractCalls);
    }

    [Fact]
    public void Unchanged_library_versions_skip_the_precompile()
    {
        var ide = OneLib();
        var full = FetchService.Handle(ide, new FetchRequest { KnownItems = new() }).Items; // learn versions (extracts once)
        Assert.Equal(1, ide.ExtractCalls);
        FetchService.Handle(ide, new FetchRequest { KnownItems = new Dictionary<string, string>(full) }); // unchanged
        Assert.Equal(1, ide.ExtractCalls); // NO second precompile
    }

    [Fact]
    public void A_changed_library_version_re_extracts()
    {
        var ide = OneLib();
        var full = FetchService.Handle(ide, new FetchRequest { KnownItems = new() }).Items;
        var stale = new Dictionary<string, string>(full) { ["CmpX.library"] = "old-version" };
        FetchService.Handle(ide, new FetchRequest { KnownItems = stale });
        Assert.Equal(2, ide.ExtractCalls);
    }

    [Fact]
    public void A_new_library_re_extracts()
    {
        var ide = OneLib();
        // The client knows the POU but has never seen CmpX.library → a library appeared → extract.
        FetchService.Handle(ide, new FetchRequest { KnownItems = new() { ["PLC_PRG.prg"] = "whatever" } });
        Assert.Equal(1, ide.ExtractCalls);
    }

    [Fact]
    public void A_removed_library_re_extracts()
    {
        var ide = OneLib();
        var full = FetchService.Handle(ide, new FetchRequest { KnownItems = new() }).Items; // extracts once
        // The client also had an Old.library that no longer exists live → removal → extract.
        var known = new Dictionary<string, string>(full) { ["Old.library"] = "v" };
        FetchService.Handle(ide, new FetchRequest { KnownItems = known });
        Assert.Equal(2, ide.ExtractCalls);
    }

    [Fact]
    public void OnlyItems_with_libraries_skips_the_precompile()
    {
        var ide = OneLib(); // has a library, but a directed preview never extracts
        FetchService.Handle(ide, new FetchRequest { OnlyItems = new() { "PLC_PRG.prg" } });
        Assert.Equal(0, ide.ExtractCalls);
    }

    [Fact]
    public void Multiple_libraries_one_bumped_re_extracts_the_rest_do_not()
    {
        var ide = TwoLibs();
        var full = FetchService.Handle(ide, new FetchRequest { KnownItems = new() }).Items; // extracts once
        FetchService.Handle(ide, new FetchRequest { KnownItems = new Dictionary<string, string>(full) }); // both unchanged
        Assert.Equal(1, ide.ExtractCalls);
        var stale = new Dictionary<string, string>(full) { ["CmpY.library"] = "old" }; // only CmpY differs
        FetchService.Handle(ide, new FetchRequest { KnownItems = stale });
        Assert.Equal(2, ide.ExtractCalls);
    }
}
