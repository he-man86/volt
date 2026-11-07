using Volt.Engine.Library;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// THE `(unresolved)` FOLDER NAME MUST BE THE SAME ON EVERY RUN AND EVERY MACHINE.
///
/// <para>An element whose owning library matched no <c>.library</c> ref is foldered under an explicit
/// <c>(unresolved)</c> marker rather than dropped or guessed into a real library's folder — that part is
/// deliberate and stays. What was not deliberate is where the folder's NAME came from: the whole first
/// comma-segment of the vendor's <c>LibraryPath</c>, sanitized. For a library the IDE staged into a temp
/// directory that segment is an ABSOLUTE PATH CONTAINING A FRESH GUID, so the workspace grew
/// <c>(unresolved)/_TEMPORARY__C__Users_marce_AppData_Local_Temp_87217613-…_Visu_Itfs.compiled-library-v3/</c>
/// — a directory that is new on every pull, orphaning the previous one, in the engineer's own git repo. It
/// also writes their username and machine temp path into a committed tree.</para>
///
/// <para><b>Measured, not theorised:</b> refreshing <c>awa-palletizer</c> and <c>bakon-nano</c> in the same
/// session produced two DIFFERENT GUIDs for the same library.</para>
/// </summary>
public class UnresolvedLibraryFolderTests
{
    /// <summary>The exact string that produced the churn (GUID from the awa-palletizer refresh).</summary>
    private const string TempStaged =
        @"_TEMPORARY_\C:\Users\marce\AppData\Local\Temp\87217613-a7da-401d-b10c-a69c378925bf\Visu_Itfs.compiled-library-v3";

    [Fact]
    public void A_temp_staged_library_folders_under_its_own_name()
    {
        Assert.Equal("Visu_Itfs", LibraryLayout.UnresolvedNameFor(TempStaged));
    }

    /// <summary>THE POINT OF THE FIX: two runs, two staging directories, ONE folder. Without it these differ
    /// and every pull leaves another directory behind.</summary>
    [Fact]
    public void Two_runs_that_staged_to_different_directories_agree()
    {
        var other =
            @"_TEMPORARY_\C:\Users\someone\AppData\Local\Temp\67b5eb46-988a-4b12-b3b5-b5cc632285fe\Visu_Itfs.compiled-library-v3";

        Assert.Equal(LibraryLayout.UnresolvedNameFor(TempStaged), LibraryLayout.UnresolvedNameFor(other));
    }

    /// <summary>Nothing of the machine survives into the workspace path.</summary>
    [Theory]
    [InlineData("marce")]
    [InlineData("AppData")]
    [InlineData("Temp")]
    [InlineData("87217613")]
    public void No_part_of_the_machine_reaches_the_folder_name(string leak)
    {
        Assert.DoesNotContain(leak, LibraryLayout.UnresolvedNameFor(TempStaged));
    }

    /// <summary>The ORDINARY resolution — the overwhelmingly common case — is untouched. A fix that also
    /// renamed every normal unresolved folder would silently move files for every existing workspace.</summary>
    [Theory]
    [InlineData("Visu Interfaces, * (System)", "Visu Interfaces")]
    [InlineData("CAA Memory, 3.5.17.0 (CAA Technical Workgroup)", "CAA Memory")]
    [InlineData("Standard", "Standard")]
    public void A_plain_resolution_keeps_its_name(string path, string expected)
    {
        Assert.Equal(expected, LibraryLayout.UnresolvedNameFor(path));
    }

    /// <summary>A forward-slash path is reduced too — the vendor's strings are free text and nothing promises
    /// one separator.</summary>
    [Fact]
    public void A_forward_slash_path_is_reduced_as_well()
    {
        Assert.Equal("Some_Lib", LibraryLayout.UnresolvedNameFor("/var/tmp/abc-123/Some_Lib.compiled-library"));
    }

    /// <summary>Only the compiled-library extensions are stripped, so a library whose NAME contains a dot keeps
    /// it. Trimming at the last dot would rename `CAA Types 3.5` to `CAA Types 3`.</summary>
    [Fact]
    public void A_dot_that_is_not_a_library_extension_survives()
    {
        Assert.Equal("CAA Types 3.5", LibraryLayout.UnresolvedNameFor("CAA Types 3.5, 3.5.17.0 (CAA)"));
    }

    /// <summary>A path-shaped resolution whose last segment is empty must not produce an EMPTY folder name —
    /// that would silently hoist the elements into `(unresolved)` itself, mixing two libraries' files.</summary>
    [Fact]
    public void A_degenerate_path_does_not_produce_an_empty_name()
    {
        Assert.NotEqual("", LibraryLayout.UnresolvedNameFor(@"C:\some\dir\"));
    }

    private static LibraryRef Ref(string resolution) =>
        new("Lib, * (Vendor)", "Lib, * (Vendor)", "Library Manager", resolution, "v1", null);

    private static LibSignature Sig(string libraryPath) =>
        new("FB_A", libraryPath, "FunctionBlock", new LibVar[0], new LibVar[0], new LibVar[0], new LibVar[0], null, null);

    /// <summary>A managed reference's manifest states the library it RESOLVED to (DIALECT C37c), so its RESOLUTION is the
    /// concrete version CODESYS lower-cases into the signature's path: the exact rule owns the signature, no wildcard
    /// needed.</summary>
    [Fact]
    public void A_reference_stating_its_resolved_version_owns_its_signatures_exactly()
    {
        var r = Ref("Lib, 1.2.3.4 (Vendor)");
        var claim = LibraryMatcher.Over(new[] { r }, new[] { Sig("lib, 1.2.3.4 (vendor)") }).For("lib, 1.2.3.4 (vendor)");
        Assert.Same(r, claim.Owner);
    }

    /// <summary>An UNRESOLVED reference claims nothing, so a signature the IDE still produced (staged to a temp path)
    /// stays loudly under <c>(unresolved)</c>.</summary>
    [Fact]
    public void An_unresolved_reference_claims_no_signature()
    {
        var path = TempStaged;
        var claim = LibraryMatcher.Over(new[] { Ref(LibraryManifest.Unresolved) }, new[] { Sig(path) }).For(path);
        Assert.Null(claim.Owner);
        Assert.Empty(claim.Claimants);
    }
}
