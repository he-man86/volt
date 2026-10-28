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
/// itself — its own boundary line, <c>%LANGUAGE FBD|LD</c>, for editable FBD/LD (one line per graphical body,
/// stating its language where every body states it), or the
/// <c>%LANGUAGE CFC|SFC UNSUPPORTED</c> line for a body Volt does not show. This asserts both directions
/// (assemble → split) and the NetworkText classification.
/// </summary>
public class ChildDirectiveTests
{
    private static Member Child(string kind, string name, string decl, string impl, string? folder) =>
        new Member(
            Kind: kind, Name: name, Declaration: decl, Body: impl, ObjectProperties.None, Folder: folder,
            Getter: null, Setter: null);

    [Fact]
    public void Folder_and_language_round_trip_as_directives()
    {
        var pou = new ItemContent(
            Kind: ItemKind.Kinds.Pou,
            Declaration: "FUNCTION_BLOCK FB",
            Body: "",
            Members: new List<Member>
            {
                Child("action", "BF01", "ACTION BF01", "%LANGUAGE FBD\n%NETWORK\n%WIRES w1\nw1 := a;\nout := w1;", "MFB01_Basic Functions"),
                Child("action", "TA01", "ACTION TA01", "x := 1;", "Sub/Deep"),
            }, ObjectProperties.None);

        var st = StWriter.Write(pou);

        // Golden: the WHOLE emitted text, not substrings — this is the exact byte layout the content hash
        // and every git diff are taken over, and the substring assertions below cannot catch a child that
        // is emitted in the wrong place, in the wrong order, or with its body dropped.
        Assert.Equal(string.Join("\n",
            "FUNCTION_BLOCK FB",
            "%LANGUAGE ST",
            "",
            "END_FUNCTION_BLOCK",
            "",
            "ACTION BF01",
            "%LANGUAGE FBD",   // the graphical body's own marker, in the bare one's place
            "%FOLDER MFB01_Basic Functions",
            "%NETWORK",
            "%WIRES w1",
            "w1 := a;",
            "out := w1;",
            "END_ACTION",
            "",
            "ACTION TA01",
            "%LANGUAGE ST",
            "%FOLDER Sub/Deep",
            "x := 1;",
            "END_ACTION",
            ""), st);

        Assert.Contains("%FOLDER MFB01_Basic Functions", st);   // folder is a directive now
        Assert.DoesNotContain("%LANGUAGE ST\n%LANGUAGE FBD", st);   // ONE marker, not two
        Assert.Contains("ACTION BF01", st);                     // signature stays a clean identifier
        Assert.DoesNotContain("(* folder", st);                 // no comment annotation
        Assert.DoesNotContain("@volt-graphical", st);           // no marker

        var split = StReader.Read(st, pou.Kind);

        var bf = split.Members.First(ch => ch.Name == "BF01");
        Assert.Equal("MFB01_Basic Functions", bf.Folder);
        Assert.Equal("%LANGUAGE FBD\n%NETWORK\n%WIRES w1\nw1 := a;\nout := w1;", bf.Body);   // %FOLDER peeled off, the marker back in front
        Assert.True(NetworkText.Is(bf.Body));

        var ta = split.Members.First(ch => ch.Name == "TA01");
        Assert.Equal("Sub/Deep", ta.Folder);                    // nested folder round-trips
        Assert.Equal("x := 1;", ta.Body);             // textual body, directive peeled
        Assert.False(NetworkText.Is(ta.Body));
    }

    [Fact]
    public void Graphical_pou_body_stays_in_impl_not_decl()
    {
        // A graphical body's lines are the body's: the decl/impl split is the language line, so nothing of the
        // network text reaches the POU declaration.
        var st = "PROGRAM POU\nVAR\n  out1 : BOOL;\n  R_TRIG_0 : R_TRIG;\nEND_VAR\n\n" +
                 "%LANGUAGE FBD\n%NETWORK\n%WIRES w1\n" +
                 "w1 := AND(a, a);\nout1 := w1;\n\nEND_PROGRAM\n";
        var s = StReader.Read(st, ItemKind.Kinds.Pou);
        Assert.Contains("PROGRAM POU", s.Declaration);
        Assert.Contains("out1 : BOOL;", s.Declaration);
        Assert.DoesNotContain("NETWORK", s.Declaration);
        Assert.DoesNotContain("WIRES", s.Declaration);
        Assert.StartsWith("%LANGUAGE FBD\n%NETWORK\n%WIRES w1", s.Body);
        Assert.Contains("w1 := AND(a, a);", s.Body);
    }

    [Theory]
    [InlineData("%LANGUAGE FBD\n%NETWORK\nout := i1;", "FBD", true)]   // editable: language on the marker
    [InlineData("%LANGUAGE LD\n%NETWORK\nout := i1;", "LD", true)]
    [InlineData("%LANGUAGE LD", "LD", true)]   // a graphical body with no network is still one
    [InlineData("x := 1;", null, false)]      // textual ST — and read-only CFC/SFC (declaration-only) too: not a network-text body
    public void NetworkText_classifies_language_and_editability(string impl, string? lang, bool editable)
    {
        Assert.Equal(lang != null, NetworkText.Is(impl));
        Assert.Equal(lang, NetworkText.LanguageOf(impl));
        Assert.Equal(editable, NetworkText.IsEditable(NetworkText.LanguageOf(impl)));
    }

    /// <summary>Spec, "an ST function block with an LD method": the FB body keeps the BARE marker and the method
    /// carries <c>%LANGUAGE LD</c> — one marker per body, each saying what its own body is (task
    /// 3.3). And an accessor splits the same way: a graphical GET carries its language on its own marker.</summary>
    [Fact]
    public void An_ST_function_block_with_an_LD_method_and_an_FBD_getter()
    {
        const string ld = "%LANGUAGE LD\n%NETWORK\nout := a;";
        const string fbd = "%LANGUAGE FBD\n%NETWORK\nSpeed := a;";
        var pou = new ItemContent(
            Kind: ItemKind.Kinds.Pou,
            Declaration: "FUNCTION_BLOCK FB\nVAR\n  a : BOOL;\n  out : BOOL;\nEND_VAR",
            Body: "out := NOT a;",
            Members: new List<Member>
            {
                Child("method", "Run", "METHOD Run : BOOL", ld, null),
                new Member("property", "Speed", "PROPERTY Speed : BOOL", "", ObjectProperties.None,
                           Getter: new Accessor("", fbd), Setter: null),
            }, ObjectProperties.None);

        var st = StWriter.Write(pou);

        Assert.Equal(string.Join("\n",
            "FUNCTION_BLOCK FB",
            "VAR",
            "  a : BOOL;",
            "  out : BOOL;",
            "END_VAR",
            "%LANGUAGE ST",
            "out := NOT a;",
            "",
            "END_FUNCTION_BLOCK",
            "",
            "METHOD Run : BOOL",
            "%LANGUAGE LD",
            "%NETWORK",
            "out := a;",
            "END_METHOD",
            "",
            "PROPERTY Speed : BOOL",
            "GET",
            "%LANGUAGE FBD",
            "%NETWORK",
            "Speed := a;",
            "END_GET",
            "END_PROPERTY",
            ""), st);

        var back = StReader.Read(st, pou.Kind);
        Assert.Equal("out := NOT a;", back.Body);
        Assert.False(NetworkText.Is(back.Body));
        Assert.Equal(ld, back.Members.Single(m => m.Name == "Run").Body);
        Assert.Equal(fbd, back.Members.Single(m => m.Name == "Speed").Getter!.Body);
        Assert.Equal(st, StWriter.Write(back));
    }
}
