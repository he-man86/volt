using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Engine.Format.Network;
using Volt.Engine.PlcOpen;
using Volt.Engine.Library;
using Volt.Engine.Format.St;
using Volt.Engine.Format.Body;
using Volt.Engine.Item;

namespace Volt.Cli.Tests;

/// <summary>
/// Child metadata travels as a directive block at the top of the body: `%FOLDER &lt;path&gt;` (the
/// sub-folder), not as signature comments/markers. The graphical language is conveyed by the body
/// itself — the `NETWORK &lt;n&gt; &lt;LANG&gt;` marker for editable FBD/LD, or a `%LANG &lt;lang&gt;`
/// placeholder for read-only CFC/SFC. This asserts both directions (assemble → split) and the NetworkText
/// classification.
/// </summary>
public class ChildDirectiveTests
{
    private static Member Child(string kind, string name, string decl, string impl, string? folder) =>
        new Member(
            Kind: kind, Name: name, Declaration: decl, Body: impl, Folder: folder,
            Getter: null, Setter: null);

    [Fact]
    public void Folder_and_language_round_trip_as_directives()
    {
        var pou = new ItemContent(
            Kind: "function_block",
            Declaration: "FUNCTION_BLOCK FB",
            Body: "",
            Members: new List<Member>
            {
                Child("action", "BF01", "ACTION BF01", "NETWORK 0 FBD\n  i1 := a;\n  out := i1;\nEND_NETWORK", "MFB01_Basic Functions"),
                Child("action", "TA01", "ACTION TA01", "x := 1;", "Sub/Deep"),
            });

        var st = StWriter.Write(pou);

        // Golden: the WHOLE emitted text, not substrings — this is the exact byte layout the content hash
        // and every git diff are taken over, and the substring assertions below cannot catch a child that
        // is emitted in the wrong place, in the wrong order, or with its body dropped.
        Assert.Equal(string.Join("\n",
            "FUNCTION_BLOCK FB",
            "",
            "END_FUNCTION_BLOCK",
            "",
            "ACTION BF01",
            "%FOLDER MFB01_Basic Functions",
            "NETWORK 0 FBD",
            "  i1 := a;",
            "  out := i1;",
            "END_NETWORK",
            "END_ACTION",
            "",
            "ACTION TA01",
            "%FOLDER Sub/Deep",
            "x := 1;",
            "END_ACTION",
            ""), st);

        Assert.Contains("%FOLDER MFB01_Basic Functions", st);   // folder is a directive now
        Assert.Contains("NETWORK 0 FBD", st);                   // editable body leads with the network marker
        Assert.Contains("ACTION BF01", st);                     // signature stays a clean identifier
        Assert.DoesNotContain("(* folder", st);                 // no comment annotation
        Assert.DoesNotContain("@volt-graphical", st);           // no marker

        var split = StReader.Read(st);

        var bf = split.Members.First(ch => ch.Name == "BF01");
        Assert.Equal("MFB01_Basic Functions", bf.Folder);
        Assert.StartsWith("NETWORK 0 FBD", bf.Body);  // graphical body preserved, %FOLDER peeled off
        Assert.True(NetworkText.Is(bf.Body));

        var ta = split.Members.First(ch => ch.Name == "TA01");
        Assert.Equal("Sub/Deep", ta.Folder);                    // nested folder round-trips
        Assert.Equal("x := 1;", ta.Body);             // textual body, directive peeled
        Assert.False(NetworkText.Is(ta.Body));
    }

    [Fact]
    public void Graphical_pou_var_temp_stays_in_impl_not_decl()
    {
        // Regression: a graphical body's VAR_TEMP must NOT be split into the POU declaration. (It used
        // to: the decl/impl split scanned for the LAST END_VAR, which is the network text VAR_TEMP's — so push
        // wrote temp vars into the POU and corrupted it, breaking every later read.)
        var st = "PROGRAM POU\nVAR\n  out1 : BOOL;\n  R_TRIG_0 : R_TRIG;\nEND_VAR\n\n" +
                 "NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n    g1 : BOOL;\n  END_VAR\n" +
                 "  i1 := a;\n  g1 := (i1 AND i1);\n  out1 := g1;\nEND_NETWORK\n\nEND_PROGRAM\n";
        var s = StReader.Read(st);
        Assert.Contains("PROGRAM POU", s.Declaration);
        Assert.Contains("out1 : BOOL;", s.Declaration);
        Assert.DoesNotContain("VAR_TEMP", s.Declaration);   // network text temps never leak into the decl
        Assert.DoesNotContain("NETWORK", s.Declaration);
        Assert.StartsWith("NETWORK 0 FBD", s.Body);
        Assert.Contains("VAR_TEMP", s.Body);      // they stay in the body
        Assert.Contains("g1 := (i1 AND i1);", s.Body);
    }

    [Theory]
    [InlineData("NETWORK 0 FBD\n  out := i1;\nEND_NETWORK", "FBD", true)]   // editable: language on the marker
    [InlineData("NETWORK 0 LD\n  out := i1;\nEND_NETWORK", "LD", true)]
    [InlineData("x := 1;", null, false)]      // textual ST — and read-only CFC/SFC (declaration-only) too: not a network-text body
    public void NetworkText_classifies_language_and_editability(string impl, string? lang, bool editable)
    {
        Assert.Equal(lang != null, NetworkText.Is(impl));
        Assert.Equal(lang, NetworkText.LanguageOf(impl));
        Assert.Equal(editable, NetworkText.IsEditable(NetworkText.LanguageOf(impl)));
    }
}
