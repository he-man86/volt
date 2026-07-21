using System.Linq;
using Volt.Engine.Sync;
using Volt.Engine.Wire;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>What /fetch and /refs materialize: every walked item ships as ordinary source (dead/uncalled code
/// and exclude-from-build objects alike — the bridge draws no build-relevance distinction; reachability is the
/// LSP's job), and referenced-library element signatures fold beside their own `.library` file.</summary>
public class FetchExclusionTests
{
    private static FakeIde.Item Pou(string name) =>
        FakeIde.Item.TextualPou(name, $"FUNCTION_BLOCK {name}\nEND_FUNCTION_BLOCK\n", "");

    /// <summary>Dead (uncalled) project POUs are ordinary source — the bridge always returns them. Reachability
    /// is the LSP's job, so there is no fetch flag and no compiled-POU dependency to drop them.</summary>
    [Fact]
    public void Dead_code_is_always_returned()
    {
        var ide = new FakeIde(Pou("Live"), Pou("Dead"));

        var resp = FetchService.Handle(ide, new FetchRequest { KnownItems = new() });
        Assert.Contains(resp.Changed, c => c.Name.StartsWith("Live"));
        Assert.Contains(resp.Changed, c => c.Name.StartsWith("Dead"));
    }

    /// <summary>A `.library` ref is nested INTO its own library folder (`Library Manager/&lt;lib&gt;/&lt;lib&gt;.library`),
    /// beside the element signatures it describes — not a loose sibling at the Library Manager root.</summary>
    [Fact]
    public void Library_stub_is_nested_inside_its_own_library_folder()
    {
        var manifest = "LIBRARY Standard\nNAMESPACE Standard\nRESOLUTION Standard, 3.5.18.0 (System)\nPLACEHOLDER true\nSYSTEM false\n";
        var ide = new FakeIde(FakeIde.Item.Library("Standard", manifest));

        var resp = FetchService.Handle(ide, new FetchRequest { KnownItems = new() });

        var stub = resp.Changed.Single(c => c.Name == "Standard.library");
        Assert.Equal("Library Manager/Standard", stub.Folder);
    }

    /// <summary>A referenced element signature folds beside its library's `.library` file — once (flat: each
    /// library materializes a single time; the hierarchy rides in the manifest's DEPENDENCIES line, not folders).</summary>
    [Fact]
    public void Referenced_library_element_folds_beside_its_library()
    {
        var manifest = "LIBRARY CAA Types\nNAMESPACE CAA\nRESOLUTION caatypes\nPLACEHOLDER false\nSYSTEM false\nDEPENDENCIES CAA Memory\n";
        var handle = new Volt.Engine.Library.LibSignature("HANDLE", "caatypes", "Type",
            new Volt.Engine.Library.LibVar[0], new Volt.Engine.Library.LibVar[0],
            new Volt.Engine.Library.LibVar[0], new Volt.Engine.Library.LibVar[0], null, null, "__XWORD");
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("User", "FUNCTION_BLOCK User\nVAR h : HANDLE; END_VAR\nEND_FUNCTION_BLOCK", ""),
            FakeIde.Item.Library("CAA Types", manifest, "Library Manager"))
        { LibSignatures = new[] { handle } };

        var resp = FetchService.Handle(ide, new FetchRequest { KnownItems = new() });

        var handles = resp.Changed.Where(c => c.Name == "HANDLE.dut").Select(c => c.Folder).ToList();
        Assert.Equal(new[] { "Library Manager/CAA Types" }, handles); // once, beside its stub
    }

    /// <summary>No-fallback / no-silent-drop: an element whose owning library matches NO `.library` ref (a CODESYS
    /// facade / Interfaces-Implementation split) is materialized LOUD under an explicit `(unresolved)` marker — never
    /// dropped and never guessed into a real library's folder. The matching gap stays visible.</summary>
    [Fact]
    public void Unmatched_library_element_is_surfaced_under_unresolved_not_dropped()
    {
        var manifest = "LIBRARY CAA Types\nNAMESPACE CAA\nRESOLUTION caatypes\nPLACEHOLDER false\nSYSTEM false\n";
        var orphan = new Volt.Engine.Library.LibSignature("SOMEFB", "cmpeventmgr implementation, 3.5 (system)", "FunctionBlock",
            new Volt.Engine.Library.LibVar[0], new Volt.Engine.Library.LibVar[0],
            new Volt.Engine.Library.LibVar[0], new Volt.Engine.Library.LibVar[0], null, null);
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("User", "FUNCTION_BLOCK User\nEND_FUNCTION_BLOCK", ""),
            FakeIde.Item.Library("CAA Types", manifest, "Library Manager"))
        { LibSignatures = new[] { orphan } };

        var resp = FetchService.Handle(ide, new FetchRequest { KnownItems = new() });

        var placed = resp.Changed.Where(c => c.Name == "SOMEFB.fb").Select(c => c.Folder).ToList();
        Assert.Single(placed);
        Assert.Contains("(unresolved)", placed[0]); // loud, not dropped, not guessed into CAA Types
    }
}
