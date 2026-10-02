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
    [InlineData("IMPLEMENTATION COBOL")]                // not a language a body can state
    [InlineData("IMPLEMENTATION ST UNSUPPORTED")]       // an ST body is always shown
    [InlineData("IMPLEMENTATION CFC")]                  // a CFC/SFC/IL body is never shown: bare, it states nothing (3b)
    [InlineData("IMPLEMENTATION SFC")]
    [InlineData("IMPLEMENTATION IL")]
    [InlineData("IMPLEMENTATION UNSUPPORTED")]
    [InlineData("IMPLEMENTATION LD UNSUPPORTED x")]
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
        Assert.False(ImplementationMarker.IsUnsupported(ImplementationMarker.For(language)));
    }

    /// <summary>A body Volt does not show states THAT on the same line (sections 2b and 3b): its language, then
    /// <c>UNSUPPORTED</c> — always for CFC, SFC and IL, and for an LD/FBD body network text cannot represent. Each is a
    /// boundary — it ends the declaration like any other — but it names no READER: the body under it is empty, so
    /// <see cref="ImplementationMarker.LanguageOf"/> has no language to hand the ST or network-text path. Spacing and
    /// case are free, and the line is held in one spelling.</summary>
    [Theory]
    [InlineData("IMPLEMENTATION CFC UNSUPPORTED", "IMPLEMENTATION CFC UNSUPPORTED")]
    [InlineData("IMPLEMENTATION SFC UNSUPPORTED", "IMPLEMENTATION SFC UNSUPPORTED")]
    [InlineData("IMPLEMENTATION IL UNSUPPORTED", "IMPLEMENTATION IL UNSUPPORTED")]
    [InlineData("IMPLEMENTATION LD UNSUPPORTED", "IMPLEMENTATION LD UNSUPPORTED")]
    [InlineData("IMPLEMENTATION FBD UNSUPPORTED", "IMPLEMENTATION FBD UNSUPPORTED")]
    [InlineData("  implementation\tcfc  unsupported ", "IMPLEMENTATION CFC UNSUPPORTED")]
    [InlineData("Implementation  Ld   Unsupported\r", "IMPLEMENTATION LD UNSUPPORTED")]
    public void An_UNSUPPORTED_line_is_a_boundary_that_names_no_reader(string line, string canonical)
    {
        Assert.True(ImplementationMarker.Is(line), $"'{line}' is a boundary line");
        Assert.True(ImplementationMarker.IsUnsupported(line));
        Assert.Null(ImplementationMarker.LanguageOf(line));
        Assert.Equal(canonical, ImplementationMarker.Canonical(line));
    }

    [Fact]
    public void The_UNSUPPORTED_spelling_is_built_in_one_place_and_for_every_language_but_ST()
    {
        Assert.Equal("IMPLEMENTATION CFC UNSUPPORTED", ImplementationMarker.Unsupported(Languages.Cfc));
        Assert.Equal("IMPLEMENTATION SFC UNSUPPORTED", ImplementationMarker.Unsupported(Languages.Sfc));
        Assert.Equal("IMPLEMENTATION IL UNSUPPORTED", ImplementationMarker.Unsupported(Languages.Il));
        Assert.Equal("IMPLEMENTATION LD UNSUPPORTED", ImplementationMarker.Unsupported(Languages.Ld));
        Assert.Equal("IMPLEMENTATION FBD UNSUPPORTED", ImplementationMarker.Unsupported(Languages.Fbd));
        // Volt shows every ST body.
        Assert.ThrowsAny<System.ArgumentException>(() => ImplementationMarker.Unsupported(Languages.St));
    }

    /// <summary>What a driver writes for a body: the body, or null — "leave the IDE's implementation alone" — for a body
    /// Volt does not show. The one decision every writer on both vendors asks (section 3b: the IDE's body is never
    /// written).</summary>
    [Theory]
    [InlineData("IMPLEMENTATION CFC UNSUPPORTED")]
    [InlineData("IMPLEMENTATION IL UNSUPPORTED\n")]
    [InlineData("  implementation ld unsupported ")]
    [InlineData("IMPLEMENTATION FBD UNSUPPORTED")]
    public void A_hidden_body_is_written_as_nothing(string body)
    {
        Assert.Null(ImplementationMarker.Written(body));
    }

    [Theory]
    [InlineData("x := 1;")]
    [InlineData("")]
    [InlineData("IMPLEMENTATION LD\nNETWORK\n  x := 1;\nEND_NETWORK")]
    [InlineData(null)]
    public void Any_other_body_is_written_as_it_is(string? body)
    {
        Assert.Equal(body, ImplementationMarker.Written(body));
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

    private static ItemContent Motor() => new(ItemKind.Kinds.Pou, FbDecl, "x := x + 1;", new List<Member>
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
    [InlineData(ItemKind.Kinds.Pou, "PROGRAM PLC_PRG\nVAR\nEND_VAR", "END_PROGRAM")]
    [InlineData(ItemKind.Kinds.Pou, "FUNCTION F_Add : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR", "END_FUNCTION")]
    [InlineData(ItemKind.Kinds.Pou, "FUNCTION_BLOCK FB_A\nVAR\nEND_VAR", "END_FUNCTION_BLOCK")]
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
    /// line push is meant to strip). It is refused by name, naming the line.
    /// <para>An INTERFACE only. A GVL or a DUT is not read at all on a push (openspec
    /// <c>push-without-header-check</c>): its text is written as sent and the IDE's build judges a stray line — see
    /// <see cref="A_keyword_line_in_a_gvl_or_a_dut_is_their_text_like_any_other"/>.</para></summary>
    [Theory]
    [InlineData("interface", "INTERFACE I\n\nMETHOD M : BOOL\nIMPLEMENTATION ST\nEND_METHOD\n\nEND_INTERFACE\n")]
    [InlineData("interface", "INTERFACE I\n\nPROPERTY P : BOOL\nGET\nIMPLEMENTATION LD\nEND_GET\nEND_PROPERTY\n\nEND_INTERFACE\n")]
    public void A_keyword_line_in_a_kind_without_an_implementation_is_refused(string kind, string source)
    {
        var ex = Assert.Throws<BridgeException>(() => StReader.Read(source, kind));
        Assert.Contains("IMPLEMENTATION", ex.Message, System.StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("volt pull", ex.Message);
    }

    [Theory]
    [InlineData("gvl", "VAR_GLOBAL\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST")]
    [InlineData("dut", "TYPE S :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\nimplementation fbd")]
    public void A_keyword_line_in_a_gvl_or_a_dut_is_their_text_like_any_other(string kind, string source) =>
        Assert.Equal(source, StReader.Read(source + "\n", kind).Declaration);

    [Fact]
    public void The_reader_splits_on_the_keyword_and_the_IDE_never_sees_the_line()
    {
        var item = StReader.Read(Golden, ItemKind.Kinds.Pou);

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
        Assert.Equal(Golden, StWriter.Write(StReader.Read(Golden, ItemKind.Kinds.Pou)));

    [Fact]
    public void The_keyword_is_matched_case_insensitively_by_the_reader_too()
    {
        var item = StReader.Read("PROGRAM P\nVAR\n\tn : INT;\nEND_VAR\n  implementation   st  \nn := 1;\nEND_PROGRAM\n",
                                 ItemKind.Kinds.Pou);
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
        var run = StReader.Read(st, ItemKind.Kinds.Pou).Members.Single();
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
        var item = StReader.Read(st, ItemKind.Kinds.Pou);
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
        var run = StReader.Read(st, ItemKind.Kinds.Pou).Members.Single();
        Assert.Equal("METHOD Run", run.Declaration);
        Assert.Equal("{define MY_FLAG}\n{IF defined (MY_FLAG)}\niCounter := 42;\n{ELSE}\nbroken_xyz;\n{END_IF}", run.Body);
        Assert.Equal(st, StWriter.Write(StReader.Read(st, ItemKind.Kinds.Pou)));
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

        var item = StReader.Read(st, ItemKind.Kinds.Pou);

        Assert.Equal(decl, item.Declaration);
        Assert.Equal("x := 1;", item.Body);
        Assert.Equal(st, StWriter.Write(item));
    }

    /// <summary>The comment shapes a line-start scan misses. A block comment may open AFTER code on its line
    /// (bakon-nano <c>MACH_AUT_Automatic.pou</c>: <c>:= TRUE;(*NOT (</c> spanning lines), and comments NEST — the
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

        var item = StReader.Read(st, ItemKind.Kinds.Pou);

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

        var item = StReader.Read(st, ItemKind.Kinds.Pou);

        Assert.Equal(decl, item.Declaration);
        Assert.Equal("x := 1;", item.Body);
    }

    [Fact]
    public void A_keyword_line_inside_a_members_block_comment_is_no_boundary()
    {
        const string methodDecl = "METHOD Run\n(* was:\nIMPLEMENTATION LD\n*)\nVAR\n\ty : INT;\nEND_VAR";
        var st = "FUNCTION_BLOCK FB\nVAR\n\tx : INT;\nEND_VAR\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n\n" +
                 $"{methodDecl}\nIMPLEMENTATION ST\ny := x;\nEND_METHOD\n";

        var run = StReader.Read(st, ItemKind.Kinds.Pou).Members.Single();

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

        var item = StReader.Read(st, ItemKind.Kinds.Pou);

        Assert.Equal("FUNCTION_BLOCK FB\nVAR\n\tx : INT;\nEND_VAR", item.Declaration);
        Assert.Equal(body, item.Body);
        Assert.False(NetworkText.Is(item.Body));
        Assert.Equal(st, StWriter.Write(item));
    }

    // ── a body Volt cannot write states THAT, on the keyword line ─────────────────────────────────────

    /// <summary>A CFC/SFC/IL body, or a network body the text cannot represent, has no text form: in memory and in
    /// the file it is its UNSUPPORTED keyword line and nothing under it (sections 2b, 3b). The writer must not print
    /// <c>IMPLEMENTATION ST</c> for it — that labels a CFC chart as Structured Text, and every reader that trusts the
    /// stated language (the push, the LSP) would then read it as ST — and no <c>(* @volt-… *)</c> comment is written
    /// anywhere.</summary>
    [Theory]
    [InlineData("IMPLEMENTATION CFC UNSUPPORTED")]
    [InlineData("IMPLEMENTATION SFC UNSUPPORTED")]
    [InlineData("IMPLEMENTATION IL UNSUPPORTED")]
    [InlineData("IMPLEMENTATION LD UNSUPPORTED")]
    [InlineData("IMPLEMENTATION FBD UNSUPPORTED")]
    public void A_hidden_body_is_its_UNSUPPORTED_line_and_round_trips(string line)
    {
        var item = new ItemContent(ItemKind.Kinds.Pou, FbDecl, line, new List<Member>
        {
            new(ItemKind.Kinds.Method, "Chart", "METHOD Chart", line),
            new(ItemKind.Kinds.Property, "Ready", "PROPERTY Ready : BOOL", "",
                Getter: new Accessor("", line), Setter: null),
        });

        var text = StWriter.Write(item);

        Assert.Equal(
            $"{FbDecl}\n{line}\n\nEND_FUNCTION_BLOCK\n" +
            $"\nMETHOD Chart\n{line}\nEND_METHOD\n" +
            $"\nPROPERTY Ready : BOOL\nGET\n{line}\nEND_GET\nEND_PROPERTY\n", text);
        Assert.DoesNotContain("IMPLEMENTATION ST", text);
        Assert.DoesNotContain("@volt", text);

        var back = StReader.Read(text, ItemKind.Kinds.Pou);
        Assert.Equal(FbDecl, back.Declaration);
        Assert.Equal(line, back.Body);
        Assert.Equal(line, back.Members.Single(m => m.Name == "Chart").Body);
        Assert.Equal(line, back.Members.Single(m => m.Name == "Ready").Getter?.Body);
        Assert.Equal(text, StWriter.Write(back));
    }

    /// <summary>A member's <c>%FOLDER</c> directive goes directly after its boundary line (the
    /// <c>ChildDirectiveTests</c> layout), and an UNSUPPORTED line IS that boundary — so the directive follows it. The
    /// other order leaves <c>%FOLDER</c> above the boundary, in the DECLARATION: the directive is written into the IDE
    /// as declaration text and the member's folder is lost.</summary>
    [Theory]
    [InlineData("IMPLEMENTATION SFC UNSUPPORTED")]
    [InlineData("IMPLEMENTATION LD UNSUPPORTED")]
    public void A_hidden_members_folder_directive_follows_its_line_and_round_trips(string line)
    {
        var item = new ItemContent(ItemKind.Kinds.Pou, FbDecl, "", new List<Member>
        {
            new(ItemKind.Kinds.Action, "Chart", "ACTION Chart", line, Folder: "Sub/Deep"),
        });

        var text = StWriter.Write(item);

        Assert.Equal(
            $"{FbDecl}\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n" +
            $"\nACTION Chart\n{line}\n%FOLDER Sub/Deep\nEND_ACTION\n", text);

        var chart = StReader.Read(text, ItemKind.Kinds.Pou).Members.Single();
        Assert.Equal("Sub/Deep", chart.Folder);
        Assert.Equal("ACTION Chart", chart.Declaration);
        Assert.Equal(line, chart.Body);
        Assert.Equal(text, StWriter.Write(StReader.Read(text, ItemKind.Kinds.Pou)));
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
        var item = StReader.Read(Graphical, ItemKind.Kinds.Pou);
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
    [InlineData("IMPLEMENTATION CFC\n" + LdBody)]               // no line at all (3b: a bare CFC states nothing)
    [InlineData("IMPLEMENTATION CFC UNSUPPORTED\n" + LdBody)]   // hidden: no reader, network text included
    [InlineData("IMPLEMENTATION LD UNSUPPORTED\n" + LdBody)]
    public void The_network_text_reader_reads_only_a_body_stated_LD_or_FBD(string text)
    {
        var read = NetworkTextReader.Read(text, NetworkScope.Empty);
        Assert.False(read.Ok);
        Assert.NotEmpty(read.Diagnostics);
        Assert.False(NetworkTextGate.Validate(text, NetworkScope.Empty).Ok);
    }

    // ── section 2, data-lens review ───────────────────────────────────────────────────────────────

    /// <summary>A declaration comment spelled like the retired <c>(* @volt-graphical: … *)</c> marker was read as the
    /// engineer's note and pushed back (section-2 review round 1). The owner's decision (section 2b) retires every
    /// <c>(* @volt-… *)</c> comment: the pull writes none, so a file holding one — in a declaration as much as at a
    /// boundary — was written before the change, and is refused naming <c>volt pull</c> rather than read around.</summary>
    [Theory]
    [InlineData("FUNCTION_BLOCK FB_Motor\n(* @volt-graphical: replaces the old CFC *)\nVAR\n\ta : BOOL;\nEND_VAR\nIMPLEMENTATION ST\na := TRUE;\n\nEND_FUNCTION_BLOCK\n")]
    [InlineData("FUNCTION_BLOCK FB_Motor\n(* @volt-graphical: replaces the old CFC *)\nVAR\nEND_VAR\nIMPLEMENTATION CFC UNSUPPORTED\n\nEND_FUNCTION_BLOCK\n")]
    public void A_marker_spelled_comment_in_a_declaration_is_refused_naming_volt_pull(string text)
    {
        var ex = Assert.Throws<BridgeException>(() => StReader.Read(text, ItemKind.Kinds.Pou, "FB_Motor"));
        Assert.Contains("volt pull", ex.Message);
        Assert.Contains("FB_Motor", ex.Message);
    }

    /// <summary><c>network</c> is an ordinary IEC name, and an ST body may open with it: a <c>REF=</c> assignment,
    /// or a statement wrapped so that the name stands alone on its first line. The pull writes such a body under
    /// <c>IMPLEMENTATION ST</c>; the contradiction check must not call it network text, or the item could never be
    /// pushed back. A network header is <c>NETWORK</c> with a header field, or alone and closed by <c>END_NETWORK</c>.</summary>
    [Theory]
    [InlineData("network REF= y;")]
    [InlineData("network\n\t:= y;")]
    [InlineData("NETWORK\n\tREF= y;")]
    public void An_ST_body_opening_with_a_variable_named_network_is_ST(string body)
    {
        var text = "FUNCTION_BLOCK FB_Motor\nVAR\n\tnetwork : REFERENCE TO INT;\n\ty : INT;\nEND_VAR\n" +
                   $"IMPLEMENTATION ST\n{body}\n\nEND_FUNCTION_BLOCK\n";

        var item = StReader.Read(text, ItemKind.Kinds.Pou, "FB_Motor");

        Assert.Equal(body, item.Body);
    }

    [Theory]
    [InlineData("NETWORK\n  out := a;\nEND_NETWORK")]
    [InlineData("NETWORK LABEL: L1\n  out := a;\nEND_NETWORK")]
    [InlineData("NETWORK TITLE: \"t\"\n  out := a;\nEND_NETWORK")]
    [InlineData("NETWORK DISABLED\n  out := a;\nEND_NETWORK")]
    [InlineData("NETWORK 0 LD\n  out := a;\nEND_NETWORK")]   // v1's header: network text, refused by its own reader
    [InlineData("NETWORK LABEL: L1\n  out := a;")]           // unclosed, but a header only network text has
    public void Network_text_under_ST_is_still_network_text(string body)
    {
        Assert.True(NetworkText.OpensNetwork(body), body);
    }

    /// <summary><c>%FOLDER</c> is peeled only where the directive stands — the FIRST line under a member's boundary.
    /// A line spelled like it deeper in the body (here inside a block comment) is the engineer's text: peeling it moved
    /// the member into a folder named after the comment and deleted the line from the body.</summary>
    [Fact]
    public void A_FOLDER_line_inside_a_body_is_body_text_and_no_folder()
    {
        const string body = "(*\n%FOLDER notes\n*)\nM := TRUE;";
        var text = $"{FbDecl}\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n\nMETHOD M : BOOL\nIMPLEMENTATION ST\n{body}\nEND_METHOD\n";

        var m = StReader.Read(text, ItemKind.Kinds.Pou, "FB_Motor").Members.Single();

        Assert.Null(m.Folder);
        Assert.Equal(body, m.Body);
    }

    /// <summary>An INTERFACE member has no boundary, so the writer puts its <c>%FOLDER</c> as the last line of its
    /// declaration (pro2193's <c>IIMM_Default_XYControl.itf</c> holds nine). The reader peels it there — it used to
    /// leave it in the declaration, which the push then wrote into the IDE as code, with the member's folder lost.</summary>
    [Fact]
    public void An_interface_members_FOLDER_is_its_folder_and_round_trips()
    {
        const string text = "INTERFACE I_X\n\nMETHOD PUBLIC Go : BOOL\nVAR_INPUT\nEND_VAR\n%FOLDER Commands\nEND_METHOD\n\nEND_INTERFACE\n";

        var item = StReader.Read(text, ItemKind.Kinds.Interface, "I_X");

        var go = item.Members.Single();
        Assert.Equal("Commands", go.Folder);
        Assert.Equal("METHOD PUBLIC Go : BOOL\nVAR_INPUT\nEND_VAR", go.Declaration);
        Assert.Equal(text, StWriter.Write(item));
    }

    // ── an ST body the IDE holds ──────────────────────────────────────────────────────────────────

    /// <summary>The drivers hand an ST body up through <see cref="ImplementationMarker.RequireStBody"/>: in memory an ST
    /// body carries no line, so a line of the keyword's shape in its text would be read back as a boundary — a
    /// hidden body, a network body, a second boundary — and the body would be pulled in a language it is not.</summary>
    [Theory]
    [InlineData("IMPLEMENTATION CFC")]
    [InlineData("IMPLEMENTATION LD UNSUPPORTED")]
    [InlineData("IMPLEMENTATION LD\nNETWORK\n  x := 1;\nEND_NETWORK")]
    [InlineData("x := 1;\nimplementation st")]
    [InlineData("IMPLEMENTATION")]
    public void An_ST_body_with_a_keyword_line_is_refused_naming_the_line(string body)
    {
        var ex = Assert.Throws<BridgeException>(() => ImplementationMarker.RequireStBody(body));
        Assert.Contains(body.Split('\n').First(l => l.Trim().StartsWith("IMPLEMENTATION", System.StringComparison.OrdinalIgnoreCase)).Trim(), ex.Message);
    }

    [Theory]
    [InlineData("x := 1;")]
    [InlineData("(*\nIMPLEMENTATION CFC\n*)\nx := 1;")]
    [InlineData("s := 'IMPLEMENTATION ST';")]
    [InlineData("IMPLEMENTATION := 1;")]              // a name, and the reserved-name rule's to answer on push
    public void An_ST_body_without_a_keyword_line_is_handed_up_unchanged(string body)
    {
        Assert.Equal(body, ImplementationMarker.RequireStBody(body));
    }
}
