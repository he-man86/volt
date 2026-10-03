using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Library;
using Volt.Engine.Sync;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// READING ONE LIBRARY RETURNS ITS API — ON TWINCAT (openspec <c>directed-library-signatures</c> 2.2).
///
/// <para>The signatures here are this vendor's REAL ones: <c>library-signatures.xml</c> is a verbatim excerpt of
/// <c>ProduceAllLibrarySignatures()</c> (what <c>BeckhoffDriver.ExtractLibrarySignatures</c> →
/// <c>TcObjectModel.ExtractLibrarySignatures</c> returns), parsed by the driver's own <see cref="TcLibrarySignatures"/>.
/// The refs are spelled as the live Project14 answers them (tasks.md 1.1: <c>Tc2_Standard.library</c> in
/// <c>References/Tc2_Standard</c>, <c>RESOLUTION Tc2_Standard, 3.4.5.0 (Beckhoff Automation GmbH)</c>). So the only
/// double is the tree; the signatures and their join keys are the vendor's.</para>
///
/// <para>Before this change a directed read answered the manifest alone on TwinCAT too (152 chars, live).</para>
/// </summary>
public class TcDirectedLibraryReadTests
{
    private const string References = "References";
    private const string Standard = "Tc2_Standard.library";
    private const string System_ = "Tc2_System.library";

    private static FakeIde.Item Ref(string title, string version) =>
        FakeIde.Item.Library(title,
            LibraryManifest.Build(title, title, LibraryManifest.Resolution(title, version, "Beckhoff Automation GmbH"), true, false),
            References);

    private static FakeIde Project() =>
        new FakeIde(
            FakeIde.Item.TextualPou("MAIN", "PROGRAM MAIN\nVAR\nEND_VAR", "x := 1;", "POUs"),
            Ref("Tc2_Standard", "3.4.5.0"),
            Ref("Tc2_System", "3.10.1.0"))
        {
            HealthPlatform = Vendors.Twincat,
            LibSignatures = TcLibrarySignatures.Parse(Fixtures.Pou("library-signatures.xml")),
        };

    private static FetchResponse Full(FakeIde ide) => FetchService.Handle(ide, new FetchRequest { Init = true });

    private static FetchResponse Directed(FakeIde ide, params string[] names) =>
        FetchService.Handle(ide, new FetchRequest { KnownItems = new Dictionary<string, string>(), OnlyItems = names.ToList() });

    private static string Describe(FetchedItem c) => $"{c.Folder}|{c.Name}|{c.Version}|{c.SourceText}";

    /// <summary>The premise, on the full fetch: every parsed signature is foldered beside its own ref (TwinCAT's join is
    /// exact — no wildcard, no `(unresolved)`, live 1.1), and Tc2_Standard's RS carries its pins.</summary>
    [Fact]
    public void The_full_fetch_writes_each_librarys_signatures_beside_its_ref()
    {
        var full = Full(Project());

        var std = full.Changed.Single(c => c.Name == Standard).Folder;
        Assert.Equal(LibraryLayout.FolderFor(References, "Tc2_Standard"), std);
        Assert.Contains(full.Changed, c => c.Name == "RS.pou" && c.Folder == std);
        Assert.DoesNotContain(full.Changed, c => c.Folder!.Contains(LibraryLayout.UnresolvedFolder, StringComparison.Ordinal));
    }

    /// <summary>THE GAP on TwinCAT: a directed read of Tc2_Standard answers its manifest AND its signatures — RS with
    /// SET/RESET1 → Q1 — in the same item shape as the full fetch, and nothing of Tc2_System.</summary>
    [Fact]
    public void A_directed_read_of_a_library_returns_its_signatures()
    {
        var res = Directed(Project(), Standard);

        var folder = res.Changed.Single(c => c.Name == Standard).Folder;
        var rs = res.Changed.SingleOrDefault(c => c.Name == "RS.pou");
        Assert.True(rs is not null,
            $"a directed read of {Standard} answered [{string.Join(", ", res.Changed.Select(c => c.Name))}] — the manifest alone");
        Assert.Equal(folder, rs!.Folder);
        foreach (var pin in new[] { "SET : BOOL", "RESET1 : BOOL", "Q1 : BOOL" })
            Assert.Contains(pin, rs.SourceText);
        Assert.All(res.Changed, c => Assert.Equal(folder, c.Folder));   // no Tc2_System element
        Assert.False(res.LibrariesRefreshed);
    }

    /// <summary>The same bytes the full fetch writes for that library: folder, name, version and text of the `.library`
    /// and of every signature in its folder.</summary>
    [Theory]
    [InlineData(Standard)]
    [InlineData(System_)]
    public void A_directed_library_read_equals_the_full_fetch_for_that_library(string named)
    {
        var full = Full(Project());
        var folder = full.Changed.Single(c => c.Name == named).Folder;
        var expected = full.Changed.Where(c => c.Folder == folder).Select(Describe).OrderBy(s => s, StringComparer.Ordinal).ToArray();
        Assert.True(expected.Length > 1, $"the fixture's {named} has no signature to compare");

        var directed = Directed(Project(), named);

        Assert.Equal(expected, directed.Changed.Select(Describe).OrderBy(s => s, StringComparer.Ordinal).ToArray());
    }
}
