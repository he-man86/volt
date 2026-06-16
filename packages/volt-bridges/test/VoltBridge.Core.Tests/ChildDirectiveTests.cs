using System.Collections.Generic;
using System.Linq;
using VoltBridge.Core;
using Xunit;

namespace VoltBridge.Core.Tests;

/// <summary>
/// Child metadata travels as a directive block at the top of the body — `%FOLDER &lt;path&gt;` (the
/// sub-folder) and `%LANG &lt;lang&gt;` (graphical language) — not as signature comments/markers. This
/// asserts both directions (assemble → split) and the VgBody classification.
/// </summary>
public class ChildDirectiveTests
{
    private static IDictionary<string, object?> Child(string kind, string name, string decl, string impl, string? folder) =>
        new Dictionary<string, object?>
        {
            ["kind"] = kind, ["name"] = name, ["declaration"] = decl, ["implementation"] = impl, ["folder"] = folder,
        };

    [Fact]
    public void Folder_and_language_round_trip_as_directives()
    {
        var result = new Dictionary<string, object?>
        {
            ["kind"] = "function_block",
            ["declaration"] = "FUNCTION_BLOCK FB",
            ["implementation"] = "",
            ["children"] = new List<object?>
            {
                Child("action", "BF01", "ACTION BF01", "%LANG FBD\nNETWORK\n  out := a;", "MFB01_Basic Functions"),
                Child("action", "TA01", "ACTION TA01", "x := 1;", "Sub/Deep"),
            },
        };

        var st = StAssembler.Assemble(result);
        Assert.Contains("%FOLDER MFB01_Basic Functions", st);   // folder is a directive now
        Assert.Contains("%LANG FBD", st);
        Assert.Contains("ACTION BF01", st);                     // signature stays a clean identifier
        Assert.DoesNotContain("(* folder", st);                 // no comment annotation
        Assert.DoesNotContain("@volt-graphical", st);           // no marker

        var split = StSplitter.SplitSt(st);

        var bf = split.Children.First(ch => ch.Name == "BF01");
        Assert.Equal("MFB01_Basic Functions", bf.Folder);
        Assert.StartsWith("%LANG FBD", bf.Implementation);      // graphical body preserved, %FOLDER peeled off
        Assert.True(VgBody.Is(bf.Implementation));

        var ta = split.Children.First(ch => ch.Name == "TA01");
        Assert.Equal("Sub/Deep", ta.Folder);                    // nested folder round-trips
        Assert.Equal("x := 1;", ta.Implementation);             // textual body, directive peeled
        Assert.False(VgBody.Is(ta.Implementation));
    }

    [Theory]
    [InlineData("%LANG FBD\nNETWORK\n  x := a;", "FBD", true)]
    [InlineData("%LANG LD\nNETWORK\n  x := a;", "LD", true)]
    [InlineData("%LANG CFC", "CFC", false)]   // read-only view
    [InlineData("%LANG SFC", "SFC", false)]
    [InlineData("x := 1;", null, false)]      // textual ST
    public void VgBody_classifies_language_and_editability(string impl, string? lang, bool editable)
    {
        Assert.Equal(lang != null, VgBody.Is(impl));
        Assert.Equal(lang, VgBody.LanguageOf(impl));
        Assert.Equal(editable, VgBody.IsEditable(VgBody.LanguageOf(impl)));
    }
}
