using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Engine.Format.Network;
using Volt.Engine.Library;
using Volt.Engine.Format.St;
using Volt.Engine.Format.Body;
using Volt.Engine.Item;

namespace Volt.Engine.Tests;

/// <summary>
/// Child metadata travels as a directive block at the top of the body: `%FOLDER &lt;path&gt;` (the
/// sub-folder), not as signature comments/markers. The graphical language is conveyed by the body
/// itself — its own boundary line, <c>IMPLEMENTATION FBD|LD</c>, for editable FBD/LD (one line per graphical body,
/// stating its language where every body states it), or the
/// read-only <c>IMPLEMENTATION CFC|SFC</c> line for a body Volt cannot write. This asserts both directions
/// (assemble → split) and the NetworkText classification.
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
                Child("action", "BF01", "ACTION BF01", "IMPLEMENTATION FBD\nNETWORK\n  i1 := a;\n  out := i1;\nEND_NETWORK", "MFB01_Basic Functions"),
                Child("action", "TA01", "ACTION TA01", "x := 1;", "Sub/Deep"),
            });

        var st = StWriter.Write(pou);

        // Golden: the WHOLE emitted text, not substrings — this is the exact byte layout the content hash
        // and every git diff are taken over, and the substring assertions below cannot catch a child that
        // is emitted in the wrong place, in the wrong order, or with its body dropped.
        Assert.Equal(string.Join("\n",
            "FUNCTION_BLOCK FB",
            "IMPLEMENTATION ST",
            "",
            "END_FUNCTION_BLOCK",
            "",
            "ACTION BF01",
            "IMPLEMENTATION FBD",   // the graphical body's own marker, in the bare one's place
            "%FOLDER MFB01_Basic Functions",
            "NETWORK",
            "  i1 := a;",
            "  out := i1;",
            "END_NETWORK",
            "END_ACTION",
            "",
            "ACTION TA01",
            "IMPLEMENTATION ST",
            "%FOLDER Sub/Deep",
            "x := 1;",
            "END_ACTION",
            ""), st);

        Assert.Contains("%FOLDER MFB01_Basic Functions", st);   // folder is a directive now
        Assert.DoesNotContain("IMPLEMENTATION ST\nIMPLEMENTATION FBD", st);   // ONE marker, not two
        Assert.Contains("ACTION BF01", st);                     // signature stays a clean identifier
        Assert.DoesNotContain("(* folder", st);                 // no comment annotation
        Assert.DoesNotContain("@volt-graphical", st);           // no marker

        var split = StReader.Read(st);

        var bf = split.Members.First(ch => ch.Name == "BF01");
        Assert.Equal("MFB01_Basic Functions", bf.Folder);
        Assert.Equal("IMPLEMENTATION FBD\nNETWORK\n  i1 := a;\n  out := i1;\nEND_NETWORK", bf.Body);   // %FOLDER peeled off, the marker back in front
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
                 "IMPLEMENTATION FBD\nNETWORK\n  VAR_TEMP\n    g1 : BOOL;\n  END_VAR\n" +
                 "  g1 := (a AND a);\n  out1 := g1;\nEND_NETWORK\n\nEND_PROGRAM\n";
        var s = StReader.Read(st);
        Assert.Contains("PROGRAM POU", s.Declaration);
        Assert.Contains("out1 : BOOL;", s.Declaration);
        Assert.DoesNotContain("VAR_TEMP", s.Declaration);   // network text temps never leak into the decl
        Assert.DoesNotContain("NETWORK", s.Declaration);
        Assert.StartsWith("IMPLEMENTATION FBD\nNETWORK", s.Body);
        Assert.Contains("VAR_TEMP", s.Body);      // they stay in the body
        Assert.Contains("g1 := (a AND a);", s.Body);
    }

    [Theory]
    [InlineData("IMPLEMENTATION FBD\nNETWORK\n  out := i1;\nEND_NETWORK", "FBD", true)]   // editable: language on the marker
    [InlineData("IMPLEMENTATION LD\nNETWORK\n  out := i1;\nEND_NETWORK", "LD", true)]
    [InlineData("IMPLEMENTATION LD", "LD", true)]   // a graphical body with no network is still one
    [InlineData("x := 1;", null, false)]      // textual ST — and read-only CFC/SFC (declaration-only) too: not a network-text body
    [InlineData("NETWORK 0 LD\n  out := i1;\nEND_NETWORK", null, false)]   // v1: refused by name on push, never read as network text
    public void NetworkText_classifies_language_and_editability(string impl, string? lang, bool editable)
    {
        Assert.Equal(lang != null, NetworkText.Is(impl));
        Assert.Equal(lang, NetworkText.LanguageOf(impl));
        Assert.Equal(editable, NetworkText.IsEditable(NetworkText.LanguageOf(impl)));
    }

    /// <summary>Spec, "an ST function block with an LD method": the FB body keeps the BARE marker and the method
    /// carries <c>IMPLEMENTATION LD</c> — one marker per body, each saying what its own body is (task
    /// 3.3). And an accessor splits the same way: a graphical GET carries its language on its own marker.</summary>
    [Fact]
    public void An_ST_function_block_with_an_LD_method_and_an_FBD_getter()
    {
        const string ld = "IMPLEMENTATION LD\nNETWORK\n  out := a;\nEND_NETWORK";
        const string fbd = "IMPLEMENTATION FBD\nNETWORK\n  Speed := a;\nEND_NETWORK";
        var pou = new ItemContent(
            Kind: "function_block",
            Declaration: "FUNCTION_BLOCK FB\nVAR\n  a : BOOL;\n  out : BOOL;\nEND_VAR",
            Body: "out := NOT a;",
            Members: new List<Member>
            {
                Child("method", "Run", "METHOD Run : BOOL", ld, null),
                new Member("property", "Speed", "PROPERTY Speed : BOOL", "",
                           Getter: new Accessor("", fbd), Setter: null),
            });

        var st = StWriter.Write(pou);

        Assert.Equal(string.Join("\n",
            "FUNCTION_BLOCK FB",
            "VAR",
            "  a : BOOL;",
            "  out : BOOL;",
            "END_VAR",
            "IMPLEMENTATION ST",
            "out := NOT a;",
            "",
            "END_FUNCTION_BLOCK",
            "",
            "METHOD Run : BOOL",
            "IMPLEMENTATION LD",
            "NETWORK",
            "  out := a;",
            "END_NETWORK",
            "END_METHOD",
            "",
            "PROPERTY Speed : BOOL",
            "GET",
            "IMPLEMENTATION FBD",
            "NETWORK",
            "  Speed := a;",
            "END_NETWORK",
            "END_GET",
            "END_PROPERTY",
            ""), st);

        var back = StReader.Read(st);
        Assert.Equal("out := NOT a;", back.Body);
        Assert.False(NetworkText.Is(back.Body));
        Assert.Equal(ld, back.Members.Single(m => m.Name == "Run").Body);
        Assert.Equal(fbd, back.Members.Single(m => m.Name == "Speed").Getter!.Body);
        Assert.Equal(st, StWriter.Write(back));
    }
}
