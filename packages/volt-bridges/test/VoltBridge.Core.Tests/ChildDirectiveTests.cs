using System.Collections.Generic;
using System.Linq;
using VoltBridge.Core;
using Xunit;

namespace VoltBridge.Core.Tests;

/// <summary>
/// Child metadata travels as a directive block at the top of the body: `%FOLDER &lt;path&gt;` (the
/// sub-folder), not as signature comments/markers. The graphical language is conveyed by the body
/// itself — the `NETWORK &lt;n&gt; &lt;LANG&gt;` marker for editable FBD/LD, or a `%LANG &lt;lang&gt;`
/// placeholder for read-only CFC/SFC. This asserts both directions (assemble → split) and the VgBody
/// classification.
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
                Child("action", "BF01", "ACTION BF01", "NETWORK 0 FBD\n  i1 := a;\n  out := i1;\nEND_NETWORK", "MFB01_Basic Functions"),
                Child("action", "TA01", "ACTION TA01", "x := 1;", "Sub/Deep"),
            },
        };

        var st = StAssembler.Assemble(result);
        Assert.Contains("%FOLDER MFB01_Basic Functions", st);   // folder is a directive now
        Assert.Contains("NETWORK 0 FBD", st);                   // editable body leads with the network marker
        Assert.Contains("ACTION BF01", st);                     // signature stays a clean identifier
        Assert.DoesNotContain("(* folder", st);                 // no comment annotation
        Assert.DoesNotContain("@volt-graphical", st);           // no marker

        var split = StSplitter.SplitSt(st);

        var bf = split.Children.First(ch => ch.Name == "BF01");
        Assert.Equal("MFB01_Basic Functions", bf.Folder);
        Assert.StartsWith("NETWORK 0 FBD", bf.Implementation);  // graphical body preserved, %FOLDER peeled off
        Assert.True(VgBody.Is(bf.Implementation));

        var ta = split.Children.First(ch => ch.Name == "TA01");
        Assert.Equal("Sub/Deep", ta.Folder);                    // nested folder round-trips
        Assert.Equal("x := 1;", ta.Implementation);             // textual body, directive peeled
        Assert.False(VgBody.Is(ta.Implementation));
    }

    [Fact]
    public void Graphical_pou_var_temp_stays_in_impl_not_decl()
    {
        // Regression: a graphical body's VAR_TEMP must NOT be split into the POU declaration. (It used
        // to: the decl/impl split scanned for the LAST END_VAR, which is the VG VAR_TEMP's — so push
        // wrote temp vars into the POU and corrupted it, breaking every later read.)
        var st = "PROGRAM POU\nVAR\n  out1 : BOOL;\n  R_TRIG_0 : R_TRIG;\nEND_VAR\n\n" +
                 "NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n    g1 : BOOL;\n  END_VAR\n" +
                 "  i1 := a;\n  g1 := (i1 AND i1);\n  out1 := g1;\nEND_NETWORK\n\nEND_PROGRAM\n";
        var s = StSplitter.SplitSt(st);
        Assert.Contains("PROGRAM POU", s.PouDeclaration);
        Assert.Contains("out1 : BOOL;", s.PouDeclaration);
        Assert.DoesNotContain("VAR_TEMP", s.PouDeclaration);   // VG temps never leak into the decl
        Assert.DoesNotContain("NETWORK", s.PouDeclaration);
        Assert.StartsWith("NETWORK 0 FBD", s.PouImplementation);
        Assert.Contains("VAR_TEMP", s.PouImplementation);      // they stay in the body
        Assert.Contains("g1 := (i1 AND i1);", s.PouImplementation);
    }

    [Theory]
    [InlineData("NETWORK 0 FBD\n  out := i1;\nEND_NETWORK", "FBD", true)]   // editable: language on the marker
    [InlineData("NETWORK 0 LD\n  out := i1;\nEND_NETWORK", "LD", true)]
    [InlineData("%LANG CFC", "CFC", false)]   // read-only view (no networks → %LANG placeholder)
    [InlineData("%LANG SFC", "SFC", false)]
    [InlineData("x := 1;", null, false)]      // textual ST
    public void VgBody_classifies_language_and_editability(string impl, string? lang, bool editable)
    {
        Assert.Equal(lang != null, VgBody.Is(impl));
        Assert.Equal(lang, VgBody.LanguageOf(impl));
        Assert.Equal(editable, VgBody.IsEditable(VgBody.LanguageOf(impl)));
    }
}
