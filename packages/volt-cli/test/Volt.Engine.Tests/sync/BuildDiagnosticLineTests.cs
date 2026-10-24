using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// ONE COORDINATE SYSTEM FOR EVERY LINE ON THE WIRE (wire-final-shape 3.6b, owner principle after the PLC Assist report of
/// 2026-10-24): a build diagnostic's <c>line</c> is the 1-based line of its item's FETCHED text, the coordinates <c>grep</c>
/// uses, never the vendor's own count. A vendor counts a line inside the object it names — the declaration's lines, then
/// the code's, no <c>IMPLEMENTATION</c> line; an action has no declaration (DIALECT D36) — and the bridge places it in the
/// text. A line it cannot place with certainty is absent, and its column with it.
/// <para>Each expectation is the line of the fetched text that holds the faulty statement, found in that text.</para>
/// </summary>
public class BuildDiagnosticLineTests
{
    private const string Bare = "Motor";
    private const string Name = Bare + ".pou";

    private static FakeIde Ide(params BridgeDiagnostic[] diagnostics) => new(
        new[]
        {
            new FakeIde.Item(Bare, ItemKind.PlcPou, "", true, "FUNCTION_BLOCK Motor\nVAR\n\tx : INT;\nEND_VAR",
                             "x := 1;\nzzSelf := 2;", null, null, new[] { "Compute", "Act", "Prop" }),
            new FakeIde.Item("Compute", ItemKind.PlcMethod, "", false, "METHOD Compute : INT\nVAR_INPUT\n\td : INT;\nEND_VAR",
                             "Compute := d;\nzzMethod := 1;", null, null),
            new FakeIde.Item("Act", ItemKind.PlcAction, "", false, null, "x := 1;\nx := 2;\nzzAction := 3;", null, null),
            new FakeIde.Item("Prop", ItemKind.PlcProp, "", false, "PROPERTY Prop : INT", null, null, null, new[] { "Get" }),
            new FakeIde.Item("Get", ItemKind.PlcPropGet, "", false, "", "Prop := zzGet;", null, null),
        })
    {
        BuildSucceeds = false,
        BuildDiagnostics = diagnostics.ToList(),
    };

    private static BridgeDiagnostic Error(string? member, int? line, int? column = null) =>
        new() { Name = Bare, Member = member, Severity = Severity.Error, Message = "Identifier not defined", Line = line, Column = column };

    /// <summary>The 1-based line of the fetched text holding <paramref name="token"/>.</summary>
    private static int FetchedLineOf(FakeIde ide, string token)
    {
        var text = Assert.Single(FetchService.Handle(ide, new FetchRequest { Init = true }).Changed, c => c.Name == Name)
                         .SourceText.Replace("\r\n", "\n");
        var lines = text.Split('\n');
        var at = Array.FindIndex(lines, l => l.Contains(token, StringComparison.Ordinal));
        Assert.True(at >= 0, $"'{token}' is not in the fetched text:\n{text}");
        return at + 1;
    }

    private static BridgeDiagnostic Built(FakeIde ide) => Assert.Single(BoundWrite.Build(ide, new BuildRequest()).Diagnostics);

    [Theory]
    [InlineData(null, 6, "zzSelf")]        // the FB's body line 2, after its 4 declaration lines
    [InlineData(null, 3, "x : INT;")]      // a line of the FB's declaration
    [InlineData("Compute", 6, "zzMethod")] // the METHOD's body line 2, after its 4 declaration lines
    [InlineData("Compute", 3, "d : INT;")] // a line of the METHOD's declaration
    [InlineData("Act", 3, "zzAction")]     // an action has no declaration: its body line 3
    public void A_vendor_line_is_the_line_of_the_fetched_text_holding_it(string? member, int vendorLine, string token)
    {
        var ide = Ide(Error(member, vendorLine, 5));
        var d = Built(ide);

        Assert.Equal((Name, member), (d.Name, d.Member));
        Assert.Equal(FetchedLineOf(ide, token), d.Line);
        Assert.Equal(5, d.Column);   // a column counts in the vendor's line, which is the fetched line verbatim
    }

    /// <summary>What the bridge cannot place with certainty carries no line and no column: a property's line counts in
    /// an accessor the wire does not name; a line past the object's text is no line of it; a name that resolves to no
    /// item anchors nothing.</summary>
    [Theory]
    [InlineData("Prop", 2)]
    [InlineData(null, 99)]
    [InlineData("Compute", 99)]
    [InlineData("NoSuchMember", 1)]
    public void A_line_the_bridge_cannot_place_is_absent(string? member, int vendorLine)
    {
        var d = Built(Ide(Error(member, vendorLine, 5)));

        Assert.Equal(Name, d.Name);
        Assert.Equal(((int?)null, (int?)null), (d.Line, d.Column));
    }

    [Fact]
    public void A_line_on_no_item_is_absent()
    {
        var d = Built(Ide(new BridgeDiagnostic { Severity = Severity.Error, Message = "project-level", Line = 12, Column = 1 }));

        Assert.Equal(((string?)null, (int?)null, (int?)null), (d.Name, d.Line, d.Column));
    }
}
