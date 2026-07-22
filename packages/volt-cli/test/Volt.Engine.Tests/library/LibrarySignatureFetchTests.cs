using System.Collections.Generic;
using Volt.Engine.Sync;
using Volt.Engine.Wire;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>Method C: FetchService extracts library signatures (the precompile) ONLY when a `.library` version
/// changed vs the client's knownItems. The `.library` files are hashed like any other file and already carried in
/// knownItems, so this reuses that change signal — no cache, no fingerprint field.</summary>
public class LibrarySignatureFetchTests
{
    private static FakeIde WithLibrary() => new FakeIde(
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"),
        FakeIde.Item.Library("CmpX", "LIBRARY CmpX\nNAMESPACE CmpX\nRESOLUTION CmpX, 1.0.0.0 (System)"));

    // The pure decision — unchanged / added / version-bumped / removed.
    [Fact]
    public void LibrariesUnchanged_decision()
    {
        var known = new Dictionary<string, string> { ["A.library"] = "v1", ["B.library"] = "v1", ["PLC_PRG.prg"] = "p" };
        Assert.True(FetchService.LibrariesUnchanged(new Dictionary<string, string> { ["A.library"] = "v1", ["B.library"] = "v1" }, known));
        Assert.False(FetchService.LibrariesUnchanged(new Dictionary<string, string> { ["A.library"] = "v2", ["B.library"] = "v1" }, known)); // bump
        Assert.False(FetchService.LibrariesUnchanged(new Dictionary<string, string> { ["A.library"] = "v1", ["B.library"] = "v1", ["C.library"] = "v1" }, known)); // added
        Assert.False(FetchService.LibrariesUnchanged(new Dictionary<string, string> { ["A.library"] = "v1" }, known)); // B removed
    }

    [Fact]
    public void Init_always_extracts()
    {
        var ide = WithLibrary();
        FetchService.Handle(ide, new FetchRequest { Init = true });
        Assert.Equal(1, ide.ExtractCalls);
    }

    [Fact]
    public void Unchanged_library_versions_skip_the_precompile()
    {
        var ide = WithLibrary();
        var full = FetchService.Handle(ide, new FetchRequest { KnownItems = new() }).Items; // learn versions (extracts once)
        Assert.Equal(1, ide.ExtractCalls);

        FetchService.Handle(ide, new FetchRequest { KnownItems = new Dictionary<string, string>(full) }); // libs unchanged
        Assert.Equal(1, ide.ExtractCalls); // NO second precompile — the point of the change
    }

    [Fact]
    public void A_changed_library_version_re_extracts()
    {
        var ide = WithLibrary();
        var full = FetchService.Handle(ide, new FetchRequest { KnownItems = new() }).Items;
        Assert.Equal(1, ide.ExtractCalls);

        // The client's known .library version no longer matches the live one (a version swap) → re-extract.
        var stale = new Dictionary<string, string>(full) { ["CmpX.library"] = "some-old-version" };
        FetchService.Handle(ide, new FetchRequest { KnownItems = stale });
        Assert.Equal(2, ide.ExtractCalls);
    }
}
