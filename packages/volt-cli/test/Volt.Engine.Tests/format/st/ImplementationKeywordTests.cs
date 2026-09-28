using System.Collections.Generic;
using System.Linq;
using Xunit;

using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using static Volt.Engine.Tests.NetworkModels;

namespace Volt.Engine.Tests;

/// <summary>
/// THE BOUNDARY IS THE KEYWORD LINE <c>IMPLEMENTATION &lt;LANG&gt;</c> (openspec <c>implementation-keyword</c>).
///
/// <para>It replaces the comment <c>(* @volt-implementation *)</c> / <c>(* @volt-implementation LD|FBD *)</c> on
/// exactly the items that have an implementation, and it states EVERY body's language, ST included. The comment is
/// not tolerated: there are no users, so there is no translator, and a file that still carries it has no boundary
/// line at all — the existing "pull once" refusal.</para>
///
/// <para>These pin the spelling (one line, exactly the keyword and a known language, spacing free, case-insensitive
/// as ST keywords are), where the writer puts it for every kind <see cref="ImplementationMarker.AppliesTo"/> covers,
/// and that the reader splits on it through the three shapes the old inference broke on.</para>
/// </summary>
public class ImplementationKeywordTests
{
    // ── 1.1 the line ────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("IMPLEMENTATION ST", "ST")]
    [InlineData("IMPLEMENTATION LD", "LD")]
    [InlineData("IMPLEMENTATION FBD", "FBD")]
    [InlineData("  IMPLEMENTATION   ST  ", "ST")]     // spacing is layout
    [InlineData("\tIMPLEMENTATION\tFBD", "FBD")]
    [InlineData("IMPLEMENTATION LD\r", "LD")]           // a CRLF file's line
    [InlineData("implementation st", "ST")]             // ST keywords are case-insensitive…
    [InlineData("Implementation Ld", "LD")]             // …and the language is reported in one spelling
    public void The_keyword_line_is_recognised_and_names_its_language(string line, string language)
    {
        Assert.True(ImplementationMarker.Is(line), $"'{line}' is a boundary line");
        Assert.Equal(language, ImplementationMarker.LanguageOf(line));
    }

    [Theory]
    [InlineData("(* @volt-implementation *)")]          // the retired comment, both forms — not tolerated
    [InlineData("(* @volt-implementation LD *)")]
    [InlineData("(* @volt-implementation FBD *)")]
    [InlineData("IMPLEMENTATION")]                      // no language: refused by name elsewhere, never a boundary
    [InlineData("IMPLEMENTATION CFC")]                  // not a language a body can state
    [InlineData("IMPLEMENTATION IL")]
    [InlineData("IMPLEMENTATION ST;")]                  // a statement, not the line
    [InlineData("IMPLEMENTATION ST x := 1;")]           // trailing tokens
    [InlineData("IMPLEMENTATION ST LD")]
    [InlineData("IMPLEMENTATION ST (* note *)")]
    [InlineData("IMPLEMENTATION ST // note")]
    [InlineData("x := IMPLEMENTATION ST;")]              // the word inside a statement
    [InlineData("IMPLEMENTATIONST")]
    [InlineData("IMPLEMENTATION_ST")]
    [InlineData("(* IMPLEMENTATION ST *)")]
    public void Anything_else_is_no_boundary(string line)
    {
        Assert.False(ImplementationMarker.Is(line), $"'{line}' must not be a boundary line");
        Assert.Null(ImplementationMarker.LanguageOf(line));
    }

    [Theory]
    [InlineData("ST")]
    [InlineData("LD")]
    [InlineData("FBD")]
    public void The_one_spelling_is_the_keyword_a_space_and_the_language(string language)
    {
        Assert.Equal("IMPLEMENTATION " + language, ImplementationMarker.For(language));
        Assert.True(ImplementationMarker.Is(ImplementationMarker.For(language)));
    }

    // ── 1.2 the writer states it on every kind that has a body, the reader splits on it ──────────────

    private const string FbDecl = "FUNCTION_BLOCK FB_Motor\nVAR\n\tx : INT;\nEND_VAR";

    /// <summary>Every kind <see cref="ImplementationMarker.AppliesTo"/> covers, in one file: the POU, a method, an
    /// action, a property's getter and setter. Each ST body states its language.</summary>
    private const string Golden =
        "FUNCTION_BLOCK FB_Motor\nVAR\n\tx : INT;\nEND_VAR\n" +
        "IMPLEMENTATION ST\n" +
        "x := x + 1;\n" +
        "\nEND_FUNCTION_BLOCK\n" +
        "\nMETHOD Reset : BOOL\n" +
        "IMPLEMENTATION ST\n" +
        "x := 0;\n" +
        "END_METHOD\n" +
        "\nACTION Step\n" +
        "IMPLEMENTATION ST\n" +
        "x := x + 2;\n" +
        "END_ACTION\n" +
        "\nPROPERTY Count : INT\n" +
        "GET\n" +
        "IMPLEMENTATION ST\n" +
        "Count := x;\n" +
        "END_GET\n" +
        "SET\n" +
        "IMPLEMENTATION ST\n" +
        "x := Count;\n" +
        "END_SET\n" +
        "END_PROPERTY\n";

    private static ItemContent Motor() => new(ItemKind.Kinds.FunctionBlock, FbDecl, "x := x + 1;", new List<Member>
    {
        new(ItemKind.Kinds.Method, "Reset", "METHOD Reset : BOOL", "x := 0;"),
        new(ItemKind.Kinds.Action, "Step", "ACTION Step", "x := x + 2;"),
        new(ItemKind.Kinds.Property, "Count", "PROPERTY Count : INT", "",
            Getter: new Accessor("", "Count := x;"), Setter: new Accessor("", "x := Count;")),
    });

    [Fact]
    public void The_writer_states_IMPLEMENTATION_ST_on_the_POU_a_method_an_action_a_getter_and_a_setter()
    {
        Assert.Equal(Golden, StWriter.Write(Motor()));
    }

    [Theory]
    [InlineData(ItemKind.Kinds.Program, "PROGRAM PLC_PRG\nVAR\nEND_VAR", "END_PROGRAM")]
    [InlineData(ItemKind.Kinds.Function, "FUNCTION F_Add : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR", "END_FUNCTION")]
    [InlineData(ItemKind.Kinds.FunctionBlock, "FUNCTION_BLOCK FB_A\nVAR\nEND_VAR", "END_FUNCTION_BLOCK")]
    public void Every_POU_kind_states_its_language_even_with_an_empty_body(string kind, string decl, string end)
    {
        // An empty body still has a language and still ends a declaration: the line records both.
        Assert.Equal($"{decl}\nIMPLEMENTATION ST\n\n{end}\n", StWriter.Write(new ItemContent(kind, decl, "", new List<Member>())));
    }

    [Fact]
    public void An_interface_states_no_implementation()
    {
        // Signatures only — AppliesTo is false, so there is no boundary to state and a line would invent one.
        var text = StWriter.Write(new ItemContent(ItemKind.Kinds.Interface, "INTERFACE I_Motor", "", new List<Member>
        {
            new(ItemKind.Kinds.InterfaceMethod, "Start", "METHOD Start : BOOL", ""),
        }));
        Assert.DoesNotContain("IMPLEMENTATION", text);
        Assert.DoesNotContain("volt-implementation", text);
    }

    /// <summary>A kind with no implementation has no boundary, so a keyword line in it is no boundary either — and it
    /// must not pass through as declaration text, which is written into the IDE verbatim (the IDE would then see the
    /// line push is meant to strip). It is refused by name, naming the line.</summary>
    [Theory]
    [InlineData("interface", "INTERFACE I\n\nMETHOD M : BOOL\nIMPLEMENTATION ST\nEND_METHOD\n\nEND_INTERFACE\n")]
    [InlineData("interface", "INTERFACE I\n\nPROPERTY P : BOOL\nGET\nIMPLEMENTATION LD\nEND_GET\nEND_PROPERTY\n\nEND_INTERFACE\n")]
    [InlineData("gvl", "VAR_GLOBAL\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\n")]
    [InlineData("dut", "TYPE S :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\nimplementation fbd\n")]
    public void A_keyword_line_in_a_kind_without_an_implementation_is_refused(string kind, string source)
    {
        var ex = Assert.Throws<BridgeException>(() => StReader.Read(source, kind));
        Assert.Contains("IMPLEMENTATION", ex.Message, System.StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("volt pull", ex.Message);
    }

    [Fact]
    public void The_reader_splits_on_the_keyword_and_the_IDE_never_sees_the_line()
    {
        var item = StReader.Read(Golden, ItemKind.Kinds.FunctionBlock);

        Assert.Equal(FbDecl, item.Declaration);
        Assert.Equal("x := x + 1;", item.Body);
        var reset = item.Members.Single(m => m.Name == "Reset");
        Assert.Equal("METHOD Reset : BOOL", reset.Declaration);
        Assert.Equal("x := 0;", reset.Body);
        Assert.Equal("x := x + 2;", item.Members.Single(m => m.Name == "Step").Body);
        var count = item.Members.Single(m => m.Name == "Count");
        Assert.Equal("Count := x;", count.Getter?.Body);
        Assert.Equal("x := Count;", count.Setter?.Body);

        // ST bodies are written into the IDE as they stand: the keyword line is the workspace's, not the code's.
        foreach (var body in new[] { item.Body, reset.Body, count.Getter?.Body, count.Setter?.Body })
            Assert.DoesNotContain("IMPLEMENTATION", body ?? "");
    }

    [Fact]
    public void The_file_round_trips_byte_for_byte() =>
        Assert.Equal(Golden, StWriter.Write(StReader.Read(Golden, ItemKind.Kinds.FunctionBlock)));

    [Fact]
    public void The_keyword_is_matched_case_insensitively_by_the_reader_too()
    {
        var item = StReader.Read("PROGRAM P\nVAR\n\tn : INT;\nEND_VAR\n  implementation   st  \nn := 1;\nEND_PROGRAM\n",
                                 ItemKind.Kinds.Program);
        Assert.Equal("PROGRAM P\nVAR\n\tn : INT;\nEND_VAR", item.Declaration);
        Assert.Equal("n := 1;", item.Body);
    }

    /// <summary>Trap 1 (pro2193's <c>BitLogic</c>): a trailing comment after <c>END_VAR</c> belongs to the
    /// declaration. The keyword states it; nothing is inferred.</summary>
    [Fact]
    public void A_trailing_comment_after_END_VAR_stays_in_the_declaration()
    {
        const string st =
            "FUNCTION_BLOCK FB\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nEND_FUNCTION_BLOCK\n\n" +
            "METHOD Run\nVAR\n\tx : INT;\nEND_VAR\n// what this does\nIMPLEMENTATION ST\nn := 1;\nEND_METHOD\n";
        var run = StReader.Read(st, ItemKind.Kinds.FunctionBlock).Members.Single();
        Assert.Equal("METHOD Run\nVAR\n\tx : INT;\nEND_VAR\n// what this does", run.Declaration);
        Assert.Equal("n := 1;", run.Body);
    }

    /// <summary>Trap 2: a wrapped <c>EXTENDS</c>/<c>IMPLEMENTS</c> header is one declaration — its base class never
    /// lands in the body.</summary>
    [Fact]
    public void A_wrapped_EXTENDS_and_IMPLEMENTS_header_stays_in_the_declaration()
    {
        const string st =
            "FUNCTION_BLOCK FB_Derived\n\tEXTENDS FB_Base\n\tIMPLEMENTS I_Motor\nVAR\n\tn : INT;\nEND_VAR\n" +
            "IMPLEMENTATION ST\nn := 1;\nEND_FUNCTION_BLOCK\n";
        var item = StReader.Read(st, ItemKind.Kinds.FunctionBlock);
        Assert.Equal("FUNCTION_BLOCK FB_Derived\n\tEXTENDS FB_Base\n\tIMPLEMENTS I_Motor\nVAR\n\tn : INT;\nEND_VAR",
                     item.Declaration);
        Assert.Equal("n := 1;", item.Body);
    }

    /// <summary>Trap 3: a conditional-compile pragma opens a block its body closes — the whole block is the body's.</summary>
    [Fact]
    public void A_conditional_pragma_block_stays_whole_in_the_body()
    {
        const string st =
            "FUNCTION_BLOCK FB\nVAR\n\tiCounter : INT;\nEND_VAR\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n\n" +
            "METHOD Run\nIMPLEMENTATION ST\n{define MY_FLAG}\n{IF defined (MY_FLAG)}\niCounter := 42;\n{ELSE}\nbroken_xyz;\n{END_IF}\nEND_METHOD\n";
        var run = StReader.Read(st, ItemKind.Kinds.FunctionBlock).Members.Single();
        Assert.Equal("METHOD Run", run.Declaration);
        Assert.Equal("{define MY_FLAG}\n{IF defined (MY_FLAG)}\niCounter := 42;\n{ELSE}\nbroken_xyz;\n{END_IF}", run.Body);
        Assert.Equal(st, StWriter.Write(StReader.Read(st, ItemKind.Kinds.FunctionBlock)));
    }

    /// <summary>A keyword line inside a COMMENT is the engineer's prose, not the boundary. Unlike the retired
    /// <c>@volt-implementation</c> tag, a line reading <c>IMPLEMENTATION ST</c> is something an engineer can
    /// plausibly write in a documentation comment, and the pull writes the declaration's comments through verbatim —
    /// so a reader that takes the first matching LINE splits the file inside the comment and pushes both halves.</summary>
    [Theory]
    [InlineData("(* notes:\nIMPLEMENTATION ST\n*)")]
    [InlineData("(* this block used to be\nIMPLEMENTATION LD\n   before the rewrite *)")]
    [InlineData("(*\n\tIMPLEMENTATION FBD\n*)")]
    public void A_keyword_line_inside_a_block_comment_is_no_boundary(string comment)
    {
        var decl = $"FUNCTION_BLOCK FB\n{comment}\nVAR\n\tx : INT;\nEND_VAR";
        var st = $"{decl}\nIMPLEMENTATION ST\nx := 1;\n\nEND_FUNCTION_BLOCK\n";

        var item = StReader.Read(st, ItemKind.Kinds.FunctionBlock);

        Assert.Equal(decl, item.Declaration);
        Assert.Equal("x := 1;", item.Body);
        Assert.Equal(st, StWriter.Write(item));
    }

    /// <summary>The comment shapes a line-start scan misses. A block comment may open AFTER code on its line
    /// (bakon-nano <c>MACH_AUT_Automatic.prg</c>: <c>:= TRUE;(*NOT (</c> spanning lines), and comments NEST — the
    /// LSP lexer nests them, so a reader that ends the comment at the first <c>*)</c> would disagree with the LSP
    /// about where the body starts and push the rest of the declaration as the body. Every row's only real boundary
    /// is the last keyword line.</summary>
    [Theory]
    [InlineData("FUNCTION_BLOCK FB\nVAR\n\tx : INT; (* old layout:\nIMPLEMENTATION ST\n*)\nEND_VAR")]
    [InlineData("FUNCTION_BLOCK FB\nVAR\n\tx : INT;(*NOT (\nIMPLEMENTATION LD\n*)\nEND_VAR")]
    [InlineData("FUNCTION_BLOCK FB\n(* outer (* inner *)\nIMPLEMENTATION LD\n*)\nVAR\n\tx : INT;\nEND_VAR")]
    [InlineData("FUNCTION_BLOCK FB\nVAR\n\tx : INT; (* a (* b *)\nIMPLEMENTATION FBD\n*)\nEND_VAR")]
    public void A_keyword_line_inside_a_comment_opened_mid_line_or_nested_is_no_boundary(string decl)
    {
        var st = $"{decl}\nIMPLEMENTATION ST\nx := 1;\n\nEND_FUNCTION_BLOCK\n";

        var item = StReader.Read(st, ItemKind.Kinds.FunctionBlock);

        Assert.Equal(decl, item.Declaration);
        Assert.Equal("x := 1;", item.Body);
        Assert.Equal(st, StWriter.Write(item));
    }

    /// <summary>The other side of the comment rule: <c>(*</c> inside a line comment or a string opens nothing, so
    /// the keyword line after it IS the boundary. A comment scan that over-reaches would swallow the real
    /// boundary and find none.</summary>
    [Theory]
    [InlineData("FUNCTION_BLOCK FB\nVAR\n\tx : INT; // (* not an opener\nEND_VAR")]
    [InlineData("FUNCTION_BLOCK FB\nVAR\n\ts : STRING := '(*';\nEND_VAR")]
    public void A_comment_opener_inside_a_line_comment_or_a_string_opens_nothing(string decl)
    {
        var st = $"{decl}\nIMPLEMENTATION ST\nx := 1;\n\nEND_FUNCTION_BLOCK\n";

        var item = StReader.Read(st, ItemKind.Kinds.FunctionBlock);

        Assert.Equal(decl, item.Declaration);
        Assert.Equal("x := 1;", item.Body);
    }

    [Fact]
    public void A_keyword_line_inside_a_members_block_comment_is_no_boundary()
    {
        const string methodDecl = "METHOD Run\n(* was:\nIMPLEMENTATION LD\n*)\nVAR\n\ty : INT;\nEND_VAR";
        var st = "FUNCTION_BLOCK FB\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n\n" +
                 $"{methodDecl}\nIMPLEMENTATION ST\ny := x;\nEND_METHOD\n";

        var run = StReader.Read(st, ItemKind.Kinds.FunctionBlock).Members.Single();

        Assert.Equal(methodDecl, run.Declaration);
        Assert.Equal("y := x;", run.Body);
        Assert.False(NetworkText.Is(run.Body));
    }

    /// <summary>A comment in an ST body that mentions another language is part of the body and changes nothing
    /// about how it is read: the FIRST boundary line states the language, and a later look-alike line is code.</summary>
    [Fact]
    public void A_keyword_line_inside_an_ST_bodys_comment_stays_in_the_body_and_the_body_stays_ST()
    {
        const string body = "x := 1;\n(*\nIMPLEMENTATION LD\n*)\nx := 2;";
        var st = $"FUNCTION_BLOCK FB\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\n{body}\n\nEND_FUNCTION_BLOCK\n";

        var item = StReader.Read(st, ItemKind.Kinds.FunctionBlock);

        Assert.Equal("FUNCTION_BLOCK FB\nVAR\n\tx : INT;\nEND_VAR", item.Declaration);
        Assert.Equal(body, item.Body);
        Assert.False(NetworkText.Is(item.Body));
        Assert.Equal(st, StWriter.Write(item));
    }

    // ── a body Volt cannot write states THAT, not a readable language ─────────────────────────────────

    /// <summary>A CFC/SFC/IL body, or a network body the text cannot represent, materializes as the
    /// <see cref="BodyMarker"/> (<c>(* @volt-graphical: CFC *)</c>). That marker line IS the body's statement: it
    /// says the body has no text form and why. The writer must not print <c>IMPLEMENTATION ST</c> above it — that
    /// labels a CFC chart as Structured Text, and every reader that trusts the stated language (the push, the LSP)
    /// would then read a CFC body as ST. <c>IMPLEMENTATION CFC</c> is no answer either: the keyword states a language
    /// Volt READS (ST, LD, FBD), and a marker reason such as <c>EXECUTE</c> is not a language at all.</summary>
    [Theory]
    [InlineData("CFC")]
    [InlineData("SFC")]
    [InlineData("IL")]
    [InlineData("EXECUTE")]   // an LD/FBD network whose Execute box the text cannot hold
    public void A_body_Volt_cannot_write_is_stated_by_its_marker_line_and_round_trips(string what)
    {
        var marker = BodyMarker.For(what);
        var item = new ItemContent(ItemKind.Kinds.FunctionBlock, FbDecl, marker, new List<Member>
        {
            new(ItemKind.Kinds.Method, "Chart", "METHOD Chart", marker),
            new(ItemKind.Kinds.Property, "Ready", "PROPERTY Ready : BOOL", "",
                Getter: new Accessor("", marker), Setter: null),
        });

        var text = StWriter.Write(item);

        Assert.Equal(
            $"{FbDecl}\n{marker}\n\nEND_FUNCTION_BLOCK\n" +
            $"\nMETHOD Chart\n{marker}\nEND_METHOD\n" +
            $"\nPROPERTY Ready : BOOL\nGET\n{marker}\nEND_GET\nEND_PROPERTY\n", text);
        Assert.DoesNotContain("IMPLEMENTATION", text);

        var back = StReader.Read(text, ItemKind.Kinds.FunctionBlock);
        Assert.Equal(FbDecl, back.Declaration);
        Assert.Equal(marker, back.Body);
        Assert.Equal(marker, back.Members.Single(m => m.Name == "Chart").Body);
        Assert.Equal(marker, back.Members.Single(m => m.Name == "Ready").Getter?.Body);
        Assert.Equal(text, StWriter.Write(back));
    }

    /// <summary>A member's <c>%FOLDER</c> directive goes directly after its boundary line (the
    /// <c>ChildDirectiveTests</c> layout), and a marker line IS that boundary — so the directive goes after the
    /// marker. The other order leaves <c>%FOLDER</c> above the boundary, in the DECLARATION: the directive is
    /// written into the IDE as declaration text and the member's folder is lost.</summary>
    [Theory]
    [InlineData("SFC")]
    [InlineData("CFC")]
    public void A_marker_members_folder_directive_follows_its_marker_line_and_round_trips(string what)
    {
        var marker = BodyMarker.For(what);
        var item = new ItemContent(ItemKind.Kinds.FunctionBlock, FbDecl, "", new List<Member>
        {
            new(ItemKind.Kinds.Action, "Chart", "ACTION Chart", marker, Folder: "Sub/Deep"),
        });

        var text = StWriter.Write(item);

        Assert.Equal(
            $"{FbDecl}\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n" +
            $"\nACTION Chart\n{marker}\n%FOLDER Sub/Deep\nEND_ACTION\n", text);

        var chart = StReader.Read(text, ItemKind.Kinds.FunctionBlock).Members.Single();
        Assert.Equal("Sub/Deep", chart.Folder);
        Assert.Equal("ACTION Chart", chart.Declaration);
        Assert.Equal(marker, chart.Body);
        Assert.Equal(text, StWriter.Write(StReader.Read(text, ItemKind.Kinds.FunctionBlock)));
    }

    // ── 1.3 the stated language decides the reader ────────────────────────────────────────────────────

    private const string LdBody = "NETWORK\n  out := a;\nEND_NETWORK";

    private const string Graphical =
        "FUNCTION_BLOCK FB_G\nVAR\n\ta : BOOL;\n\tout : BOOL;\nEND_VAR\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n\n" +
        "METHOD Diagram\nIMPLEMENTATION FBD\n" + LdBody + "\nEND_METHOD\n\n" +      // members in the writer's order
        "METHOD Ladder\nIMPLEMENTATION LD\n" + LdBody + "\nEND_METHOD\n\n" +
        "METHOD Text\nIMPLEMENTATION ST\nout := a;\nEND_METHOD\n";

    [Fact]
    public void LD_and_FBD_bodies_are_network_text_and_an_ST_body_is_not()
    {
        var item = StReader.Read(Graphical, ItemKind.Kinds.FunctionBlock);
        Assert.Equal("LD", NetworkText.LanguageOf(item.Members.Single(m => m.Name == "Ladder").Body));
        Assert.Equal("FBD", NetworkText.LanguageOf(item.Members.Single(m => m.Name == "Diagram").Body));
        Assert.False(NetworkText.Is(item.Members.Single(m => m.Name == "Text").Body));
        Assert.False(NetworkText.Is(item.Body));
        Assert.Equal(Graphical, StWriter.Write(item));
    }

    [Theory]
    [InlineData(BodyLanguage.Ld, "IMPLEMENTATION LD\n")]
    [InlineData(BodyLanguage.Fbd, "IMPLEMENTATION FBD\n")]
    public void The_network_text_writer_opens_a_body_with_its_keyword_line(BodyLanguage language, string first)
    {
        var text = NetworkTextWriter.Write(new NetworkBody(language, new[] { Net(Set(L("a"), T("out"))) }), NetworkScope.Empty);
        Assert.StartsWith(first, text);
        Assert.DoesNotContain("volt-implementation", text);

        var back = NetworkTextReader.Read(text, NetworkScope.Empty);
        Assert.True(back.Ok, string.Join("\n", back.Diagnostics.Select(d => d.Code + " " + d.Message)));
        Assert.Equal(language, back.Body!.Language);
        Assert.True(NetworkTextGate.Validate(text, NetworkScope.Empty).Ok);
    }

    [Theory]
    [InlineData("IMPLEMENTATION ST\n" + LdBody)]               // network text under ST: the network reader is not its reader
    [InlineData("(* @volt-implementation LD *)\n" + LdBody)]   // the retired comment
    [InlineData("IMPLEMENTATION\n" + LdBody)]                   // no language
    [InlineData("IMPLEMENTATION CFC\n" + LdBody)]               // not a network-text language
    public void The_network_text_reader_reads_only_a_body_stated_LD_or_FBD(string text)
    {
        var read = NetworkTextReader.Read(text, NetworkScope.Empty);
        Assert.False(read.Ok);
        Assert.NotEmpty(read.Diagnostics);
        Assert.False(NetworkTextGate.Validate(text, NetworkScope.Empty).Ok);
    }
}
