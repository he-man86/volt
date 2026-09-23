using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Sync;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A DIAGNOSTIC SAYS WHICH ITEM IT IS ABOUT.
///
/// <para>Both vendors identified the item and both threw it away. CODESYS's <c>IMessage</c> carries
/// <c>ObjectGuid</c> and the driver read <c>Text</c>/<c>Severity</c> only, scraping `Line `/`Column ` out of prose
/// that never contains them — every diagnostic in the recorded CODESYS conformance corpus carries `line: 0`, while
/// the TwinCAT recording of the SAME corpus carries real lines. TwinCAT's own regex captured the file path in
/// group 1 and dropped the capture. Either way the client got a line number with no file to put it in.</para>
///
/// <para>The promotion from the vendor's BARE name to the wire's FULL `name.kind` happens above the seam, because
/// a POU's kind comes from its DECLARATION and only materialization reads that.</para>
/// </summary>
public class BuildDiagnosticNameTests
{
    private const string Prog = "PROGRAM Boiler\nVAR\nEND_VAR\n";
    private const string Fb = "FUNCTION_BLOCK Boiler\nVAR\nEND_VAR\n";

    private static BuildResponse Build(FakeIde ide) => BuildService.Handle(ide, new BuildRequest());

    private static FakeIde.Item Pou(string name, string decl) =>
        FakeIde.Item.TextualPou(name, decl, "n := 0;\n");

    /// <summary>The kind is NOT the vendor's kind code: `Boiler` is a POU to both IDEs, and only the declaration
    /// says whether the wire calls it `Boiler.prg` or `Boiler.fb`.</summary>
    [Theory]
    [InlineData(Prog, "Boiler.prg")]
    [InlineData(Fb, "Boiler.fb")]
    public void A_bare_name_from_the_vendor_becomes_the_full_wire_name(string decl, string expected)
    {
        var ide = new FakeIde(Pou("Boiler", decl))
        {
            BuildSucceeds = false,
            BuildDiagnostics = new List<BridgeDiagnostic>
            {
                new() { Name = "Boiler", Severity = Severity.Error, Message = "C0032: cannot convert", Line = 12 },
            },
        };

        var diagnostic = Assert.Single(Build(ide).Diagnostics);

        Assert.Equal(expected, diagnostic.Name);
        Assert.Equal(12, diagnostic.Line);   // the position the vendor gave is untouched
    }

    /// <summary>THE V71 SHAPE. IEC guarantees unique names within a kind, not across them — a control module and
    /// the visualization that draws it are both `CM_Carrier`. A bare name from the vendor picks neither, and
    /// publishing either would point an editor at the wrong file.</summary>
    [Fact]
    public void A_bare_name_that_matches_two_kinds_resolves_to_nothing()
    {
        var ide = new FakeIde(
            Pou("CM_Carrier", Fb),
            new FakeIde.Item("CM_Carrier", Volt.Engine.Item.ItemKind.PlcVisObj, "", true, null, null, null, null))
        {
            BuildDiagnostics = new List<BridgeDiagnostic>
            {
                new() { Name = "CM_Carrier", Severity = Severity.Error, Message = "ambiguous" },
            },
        };

        Assert.Null(Assert.Single(Build(ide).Diagnostics).Name);
    }

    /// <summary>A project-level message names no item and must not acquire one.</summary>
    [Fact]
    public void A_diagnostic_with_no_name_stays_nameless()
    {
        var ide = new FakeIde(Pou("Boiler", Prog))
        {
            BuildDiagnostics = new List<BridgeDiagnostic>
            {
                new() { Severity = Severity.Error, Message = "the application is not built" },
            },
        };

        Assert.Null(Assert.Single(Build(ide).Diagnostics).Name);
    }

    /// <summary>A name the walk does not hold resolves to null rather than travelling as a bare name: the wire's
    /// names are full names, and a field that is sometimes one spelling and sometimes the other is worse than an
    /// absent one.</summary>
    [Fact]
    public void An_unknown_name_never_leaks_through_as_a_bare_one()
    {
        var ide = new FakeIde(Pou("Boiler", Prog))
        {
            BuildDiagnostics = new List<BridgeDiagnostic>
            {
                new() { Name = "SomethingElse", Severity = Severity.Error, Message = "?" },
            },
        };

        Assert.Null(Assert.Single(Build(ide).Diagnostics).Name);
    }

    /// <summary>The promotion rewrites the diagnostic in place, so a driver MUST hand back a fresh list — else
    /// the second build finds full names where it expects bare ones and resolves every one to null. The contract
    /// is stated on <c>IIdeSession.GetBuildDiagnostics</c>; this is what enforces it.</summary>
    [Fact]
    public void Building_twice_gives_the_same_names()
    {
        var ide = new FakeIde(Pou("Boiler", Prog))
        {
            BuildDiagnostics = new List<BridgeDiagnostic>
            {
                new() { Name = "Boiler", Severity = Severity.Error, Message = "C0032: cannot convert" },
            },
        };

        Assert.Equal("Boiler.prg", Assert.Single(Build(ide).Diagnostics).Name);
        Assert.Equal("Boiler.prg", Assert.Single(Build(ide).Diagnostics).Name);
    }

    /// <summary>A clean build walks NOTHING — the promotion is the only reason `build` would touch the tree, and
    /// it must not pay for a walk when no diagnostic carried a name.</summary>
    [Fact]
    public void A_clean_build_does_not_walk_the_project()
    {
        var ide = new FakeIde(Pou("Boiler", Prog));

        var before = ide.WalkCalls;
        Build(ide);

        Assert.Equal(before, ide.WalkCalls);
    }
}
