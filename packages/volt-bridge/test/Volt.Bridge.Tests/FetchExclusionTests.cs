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

    /// <summary>Dead (uncompiled/unreachable) project POUs are RETURNED by default (the LSP can analyze/debug unused
    /// code) and omitted ONLY with `omitDeadCode` — which mirrors the CODESYS compiler for diagnostic-parity runs.</summary>
    [Fact]
    public void Dead_code_returned_by_default_and_omitted_only_with_the_flag()
    {
        var ide = new FakeIde(Pou("Live"), Pou("Dead"))
        { CompiledPous = new System.Collections.Generic.HashSet<string>(System.StringComparer.OrdinalIgnoreCase) { "Live" } };

        var byDefault = FetchService.Handle(ide, new FetchRequest { Verbose = true });
        Assert.Contains(byDefault.Changed, c => c.Name.StartsWith("Dead")); // unused code still returned

        var matched = FetchService.Handle(ide, new FetchRequest { Verbose = true, OmitDeadCode = true });
        Assert.DoesNotContain(matched.Changed, c => c.Name.StartsWith("Dead")); // mirror the compiler
        Assert.Contains(matched.Changed, c => c.Name.StartsWith("Live"));
    }

    [Fact]
    public void Refs_omits_excluded_from_build_items()
    {
        var ide = new FakeIde(Pou("Good"), Pou("Bad", excluded: true));
        var resp = RefsService.Handle(ide);

        Assert.Contains(resp.Items.Keys, k => k.StartsWith("Good"));
        Assert.DoesNotContain(resp.Items.Keys, k => k.StartsWith("Bad"));
    }

    /// <summary>A `.library` ref is nested INTO its own library folder (`Library Manager/&lt;lib&gt;/&lt;lib&gt;.library`),
    /// beside the element signatures it describes — not a loose sibling at the Library Manager root.</summary>
    [Fact]
    public void Library_stub_is_nested_inside_its_own_library_folder()
    {
        var manifest = "LIBRARY Standard\nNAMESPACE Standard\nRESOLUTION Standard, 3.5.18.0 (System)\nPLACEHOLDER true\nSYSTEM false\n";
        var ide = new FakeIde(FakeIde.Item.Library("Standard", manifest));

        var resp = FetchService.Handle(ide, new FetchRequest());

        var stub = resp.Changed.Single(c => c.Name == "Standard.library");
        Assert.Equal("Library Manager/Standard", stub.Folder);
    }

    /// <summary>A referenced element signature folds beside its library's `.library` file — once (flat: each
    /// library materializes a single time; the hierarchy rides in the manifest's DEPENDENCIES line, not folders).</summary>
    [Fact]
    public void Referenced_library_element_folds_beside_its_library()
    {
        var manifest = "LIBRARY CAA Types\nNAMESPACE CAA\nRESOLUTION caatypes\nPLACEHOLDER false\nSYSTEM false\nDEPENDENCIES CAA Memory\n";
        var handle = new Volt.Bridge.Core.Library.LibSignature("HANDLE", "caatypes", "Type",
            new Volt.Bridge.Core.Library.LibVar[0], new Volt.Bridge.Core.Library.LibVar[0],
            new Volt.Bridge.Core.Library.LibVar[0], new Volt.Bridge.Core.Library.LibVar[0], null, null, "__XWORD");
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("User", "FUNCTION_BLOCK User\nVAR h : HANDLE; END_VAR\nEND_FUNCTION_BLOCK", ""),
            FakeIde.Item.Library("CAA Types", manifest, "Library Manager"))
        { LibSignatures = new[] { handle } };

        var resp = FetchService.Handle(ide, new FetchRequest { Verbose = true });

        var handles = resp.Changed.Where(c => c.Name == "HANDLE.alias").Select(c => c.Folder).ToList();
        Assert.Equal(new[] { "Library Manager/CAA Types" }, handles); // once, beside its stub
    }

    /// <summary>No-fallback / no-silent-drop: an element whose owning library matches NO `.library` ref (a CODESYS
    /// facade / Interfaces-Implementation split) is materialized LOUD under an explicit `(unresolved)` marker — never
    /// dropped and never guessed into a real library's folder. The matching gap stays visible.</summary>
    [Fact]
    public void Unmatched_library_element_is_surfaced_under_unresolved_not_dropped()
    {
        var manifest = "LIBRARY CAA Types\nNAMESPACE CAA\nRESOLUTION caatypes\nPLACEHOLDER false\nSYSTEM false\n";
        var orphan = new Volt.Bridge.Core.Library.LibSignature("SOMEFB", "cmpeventmgr implementation, 3.5 (system)", "FunctionBlock",
            new Volt.Bridge.Core.Library.LibVar[0], new Volt.Bridge.Core.Library.LibVar[0],
            new Volt.Bridge.Core.Library.LibVar[0], new Volt.Bridge.Core.Library.LibVar[0], null, null);
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("User", "FUNCTION_BLOCK User\nEND_FUNCTION_BLOCK", ""),
            FakeIde.Item.Library("CAA Types", manifest, "Library Manager"))
        { LibSignatures = new[] { orphan } };

        var resp = FetchService.Handle(ide, new FetchRequest { Verbose = true });

        var placed = resp.Changed.Where(c => c.Name == "SOMEFB.fb").Select(c => c.Folder).ToList();
        Assert.Single(placed);
        Assert.Contains("(unresolved)", placed[0]); // loud, not dropped, not guessed into CAA Types
    }
}
