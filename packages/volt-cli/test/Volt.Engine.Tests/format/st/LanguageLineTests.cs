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
/// THE BOUNDARY IS THE PROPERTY LINE <c>%LANGUAGE &lt;LANG&gt;</c> (openspec <c>language-line</c>).
///
/// <para>It ends a body's declaration, starts its body and states its language, ST included; it is one of
/// <see cref="PropertyLines"/>' closed keys, the first of them, so there is one <c>%</c>-line grammar. A METHOD or a
/// property's GET/SET whose IDE object has no body slot has NO line. The old <c>IMPLEMENTATION &lt;LANG&gt;</c> line is no
/// longer read: a push of it is refused by name, saying to pull again.</para>
///
/// <para>These pin the spelling, where the writer puts the line for every kind <see cref="ItemKind.ShapeOf"/> gives a body,
/// that the reader splits on it through the three shapes an inferred boundary broke on, and the member with no slot.</para>
/// </summary>
public class LanguageLineTests
{
    // ── the line ────────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("%LANGUAGE ST", "ST")]
    [InlineData("%LANGUAGE LD", "LD")]
    [InlineData("%LANGUAGE FBD", "FBD")]
    [InlineData("  %LANGUAGE   ST  ", "ST")]     // spacing is layout
    [InlineData("%LANGUAGE LD\r", "LD")]           // a CRLF file's line
    [InlineData("%LANGUAGE st", "ST")]             // the language word in any case…
    [InlineData("%LANGUAGE Fbd", "FBD")]           // …reported in one spelling
    [InlineData("%LANGUAGE\tST", "ST")]            // whitespace ends the key, a tab as a space (every %-line's)
    [InlineData("%LANGUAGE \tLD", "LD")]
    [InlineData("%LANGUAGE	ST", "ST")]            // whitespace ends the key, a tab as a space (every %-line's)
    [InlineData("%LANGUAGE 	LD", "LD")]
    public void The_line_is_recognised_and_names_its_language(string line, string language)
    {
        Assert.True(PropertyLines.IsLanguageLine(line), $"'{line}' is a %LANGUAGE line");
        Assert.Equal(PropertyLines.LanguageKey, PropertyLines.KeyOf(line));
        Assert.Null(PropertyLines.LanguageLineProblem(line));
        Assert.Equal(language, PropertyLines.LanguageOf(line));
    }

    /// <summary>A <c>%LANGUAGE</c> line is never code — no IEC direct address opens <c>%L</c> — so one that states no body
    /// is still the line, and its problem is named.</summary>
    [Theory]
    [InlineData("%LANGUAGE", "states no language")]
    [InlineData("%LANGUAGE COBOL", "'COBOL' is no language a body can state")]
    [InlineData("%LANGUAGE ST UNSUPPORTED", "Volt shows every ST body")]
    [InlineData("%LANGUAGE CFC", "'%LANGUAGE CFC UNSUPPORTED'")]  // a CFC/SFC/IL body is never shown
    [InlineData("%LANGUAGE SFC", "'%LANGUAGE SFC UNSUPPORTED'")]
    [InlineData("%LANGUAGE IL", "'%LANGUAGE IL UNSUPPORTED'")]
    [InlineData("%LANGUAGE UNSUPPORTED", "is no language a body can state")]
    [InlineData("%LANGUAGE 3 UNSUPPORTED", "is no language a body can state")]   // a language is a word
    [InlineData("%LANGUAGE LD UNSUPPORTED x", "is no language a body can state")]
    [InlineData("%LANGUAGE ST;", "is no language a body can state")]
    [InlineData("%LANGUAGE ST x := 1;", "is no language a body can state")]
    [InlineData("%LANGUAGE ST LD", "is no language a body can state")]
    [InlineData("%LANGUAGE ST // note", "is no language a body can state")]
    [InlineData("%LANGUAGE NONE", "'NONE' is no language a body can state")]   // no word is reserved for "no code"
    public void A_line_that_states_no_body_is_the_line_and_names_what_it_lacks(string line, string problem)
    {
        Assert.True(PropertyLines.IsLanguageLine(line));
        Assert.Null(PropertyLines.LanguageOf(line));
        Assert.False(PropertyLines.IsUnsupportedLine(line));
        Assert.Contains(problem, PropertyLines.LanguageLineProblem(line));
    }

    [Theory]
    [InlineData("(* @volt-implementation *)")]    // the retired comment
    [InlineData("IMPLEMENTATION ST")]             // the retired line: no %-line, refused elsewhere by name
    [InlineData("%language ST")]                  // a key is spelled in upper case, as every %-line's: this is code
    [InlineData("%LANGUAGEST")]
    [InlineData("%LANGUAGE_ST")]
    [InlineData("x := %LANGUAGE ST;")]            // not at the line's start
    [InlineData("(* %LANGUAGE ST *)")]
    [InlineData("%QB1 := x;")]                     // a direct address is code
    public void Anything_else_is_no_language_line(string line)
    {
        Assert.False(PropertyLines.IsLanguageLine(line), $"'{line}' must not be a %LANGUAGE line");
        Assert.Null(PropertyLines.LanguageOf(line));
    }

    [Theory]
    [InlineData("ST")]
    [InlineData("LD")]
    [InlineData("FBD")]
    public void The_one_spelling_is_the_key_a_space_and_the_language(string language)
    {
        Assert.Equal("%LANGUAGE " + language, PropertyLines.LanguageLine(language));
        Assert.Equal(language, PropertyLines.LanguageOf(PropertyLines.LanguageLine(language)));
        Assert.False(PropertyLines.IsUnsupportedLine(PropertyLines.LanguageLine(language)));
    }

    [Fact]
    public void LANGUAGE_is_the_first_of_the_closed_keys() =>
        Assert.Equal(PropertyLines.LanguageKey, PropertyLines.Keys[0]);

    /// <summary>A body Volt does not show states THAT on the same line: its language, then <c>UNSUPPORTED</c> — always
    /// for CFC, SFC and IL, and for an LD/FBD body network text cannot represent. Such a line names no READER: the body
    /// under it is empty. The words in any case, held in one spelling.</summary>
    [Theory]
    [InlineData("%LANGUAGE CFC UNSUPPORTED", "%LANGUAGE CFC UNSUPPORTED")]
    [InlineData("%LANGUAGE SFC UNSUPPORTED", "%LANGUAGE SFC UNSUPPORTED")]
    [InlineData("%LANGUAGE IL UNSUPPORTED", "%LANGUAGE IL UNSUPPORTED")]
    [InlineData("%LANGUAGE LD UNSUPPORTED", "%LANGUAGE LD UNSUPPORTED")]
    [InlineData("%LANGUAGE FBD UNSUPPORTED", "%LANGUAGE FBD UNSUPPORTED")]
    [InlineData("  %LANGUAGE cfc  unsupported ", "%LANGUAGE CFC UNSUPPORTED")]
    [InlineData("%LANGUAGE Ld Unsupported\r", "%LANGUAGE LD UNSUPPORTED")]
    // A language Volt has never seen, under the vendor's own name (D27): the driver states such a body hidden instead of
    // losing the whole item, so the line must read back.
    [InlineData("%LANGUAGE UML UNSUPPORTED", "%LANGUAGE UML UNSUPPORTED")]
    [InlineData("%LANGUAGE nwl unsupported", "%LANGUAGE NWL UNSUPPORTED")]
    [InlineData("%LANGUAGE Ladder_2 UNSUPPORTED", "%LANGUAGE LADDER_2 UNSUPPORTED")]
    [InlineData("%LANGUAGE NONE UNSUPPORTED", "%LANGUAGE NONE UNSUPPORTED")]
    public void An_UNSUPPORTED_line_names_no_reader(string line, string canonical)
    {
        Assert.True(PropertyLines.IsLanguageLine(line));
        Assert.True(PropertyLines.IsUnsupportedLine(line));
        Assert.Null(PropertyLines.LanguageOf(line));
        Assert.Equal(canonical, PropertyLines.JoinBody(line, ""));   // a hidden body IS its line, in its one spelling
    }

    [Fact]
    public void The_UNSUPPORTED_spelling_is_built_in_one_place_and_for_every_language_but_ST()
    {
        Assert.Equal("%LANGUAGE CFC UNSUPPORTED", PropertyLines.UnsupportedLine(Languages.Cfc));
        Assert.Equal("%LANGUAGE SFC UNSUPPORTED", PropertyLines.UnsupportedLine(Languages.Sfc));
        Assert.Equal("%LANGUAGE IL UNSUPPORTED", PropertyLines.UnsupportedLine(Languages.Il));
        Assert.Equal("%LANGUAGE LD UNSUPPORTED", PropertyLines.UnsupportedLine(Languages.Ld));
        Assert.Equal("%LANGUAGE FBD UNSUPPORTED", PropertyLines.UnsupportedLine(Languages.Fbd));
        Assert.ThrowsAny<System.ArgumentException>(() => PropertyLines.UnsupportedLine(Languages.St));
        Assert.Equal("%LANGUAGE UML UNSUPPORTED", PropertyLines.UnsupportedLine("UML"));
    }

    /// <summary>The language a network body's line states, from the view mode either vendor stores on it — one answer
    /// for both, so the same body is the same line on each (D27).</summary>
    [Theory]
    [InlineData("Ld", "LD")]
    [InlineData("FBD", "FBD")]
    [InlineData("Il", "IL")]
    [InlineData("Sequence", "SEQUENCE")]
    [InlineData(null, "NWL")]
    [InlineData("", "NWL")]
    public void A_network_body_states_its_view_or_the_vendors_name_for_it(string? viewMode, string stated) =>
        Assert.Equal(stated, NetworkText.ViewLanguage(viewMode));

    /// <summary>The vendor's name for a language Volt has never seen, as the line states it (D27): upper case, a word.
    /// A name that is no word, or ST (never hidden), cannot be stated and is refused naming it — UNSUPPORTED, a vendor
    /// fact; LD or FBD is a network body in a form Volt does not read, hidden under its own line.</summary>
    [Fact]
    public void A_vendor_named_language_is_stated_upper_case_and_only_as_a_word()
    {
        Assert.Equal("UML", PropertyLines.VendorLanguage("Uml"));
        Assert.Equal("NONE", PropertyLines.VendorLanguage("None"));   // no word is reserved
        var notWord = Assert.Throws<BridgeException>(() => PropertyLines.VendorLanguage("3"));
        Assert.Equal(BridgeErrorCodes.Unsupported, notWord.ErrorCode);
        Assert.Contains("'3'", notWord.Message);
        Assert.Equal(BridgeErrorCodes.Unsupported,
                     Assert.Throws<BridgeException>(() => PropertyLines.VendorLanguage("Unsupported")).ErrorCode);
        Assert.Equal("LD", PropertyLines.VendorLanguage("Ld"));
        Assert.Equal("FBD", PropertyLines.VendorLanguage("fbd"));
        var st = Assert.Throws<BridgeException>(() => PropertyLines.VendorLanguage("st"));
        Assert.Equal(BridgeErrorCodes.Unsupported, st.ErrorCode);
        Assert.Contains("'st'", st.Message);
    }

    /// <summary>What a driver writes for a body: the body, or null — "leave the IDE's implementation alone" — for a body
    /// Volt does not show and for a member with no slot (no body at all).</summary>
    [Theory]
    [InlineData("%LANGUAGE CFC UNSUPPORTED")]
    [InlineData("%LANGUAGE IL UNSUPPORTED\n")]
    [InlineData("  %LANGUAGE ld unsupported ")]
    [InlineData("%LANGUAGE FBD UNSUPPORTED")]
    [InlineData(null)]
    public void A_hidden_body_and_no_body_are_written_as_nothing(string? body) =>
        Assert.Null(PropertyLines.Written(body));

    [Theory]
    [InlineData("x := 1;")]
    [InlineData("")]
    [InlineData("%LANGUAGE LD\n%NETWORK\nx := 1;")]
    public void Any_other_body_is_written_as_it_is(string body) => Assert.Equal(body, PropertyLines.Written(body));

    // ── the writer states it on every kind that has a body, the reader splits on it ──────────────────

    private const string FbDecl = "FUNCTION_BLOCK FB_Motor\nVAR\n\tx : INT;\nEND_VAR";

    /// <summary>Every kind <see cref="ItemKind.ShapeOf"/> gives a body, in one file: the POU, a method, an action, a
    /// property's getter and setter. Each ST body states its language.</summary>
    private const string Golden =
        "FUNCTION_BLOCK FB_Motor\nVAR\n\tx : INT;\nEND_VAR\n" +
        "%LANGUAGE ST\n" +
        "x := x + 1;\n" +
        "\nEND_FUNCTION_BLOCK\n" +
        "\nMETHOD Reset : BOOL\n" +
        "%LANGUAGE ST\n" +
        "x := 0;\n" +
        "END_METHOD\n" +
        "\nACTION Step\n" +
        "%LANGUAGE ST\n" +
        "x := x + 2;\n" +
        "END_ACTION\n" +
        "\nPROPERTY Count : INT\n" +
        "GET\n" +
        "%LANGUAGE ST\n" +
        "Count := x;\n" +
        "END_GET\n" +
        "SET\n" +
        "%LANGUAGE ST\n" +
        "x := Count;\n" +
        "END_SET\n" +
        "END_PROPERTY\n";

    private static ItemContent Motor() => new(ItemKind.Kinds.Pou, FbDecl, "x := x + 1;", new List<Member>
    {
        new(ItemKind.Kinds.Method, "Reset", "METHOD Reset : BOOL", "x := 0;", ObjectProperties.None),
        new(ItemKind.Kinds.Action, "Step", "ACTION Step", "x := x + 2;", ObjectProperties.None),
        new(ItemKind.Kinds.Property, "Count", "PROPERTY Count : INT", "", ObjectProperties.None,
            Getter: new Accessor("", "Count := x;"), Setter: new Accessor("", "x := Count;")),
    }, ObjectProperties.None);

    [Fact]
    public void The_writer_states_LANGUAGE_ST_on_the_POU_a_method_an_action_a_getter_and_a_setter() =>
        Assert.Equal(Golden, StWriter.Write(Motor()));

    [Theory]
    [InlineData(ItemKind.Kinds.Pou, "PROGRAM PLC_PRG\nVAR\nEND_VAR", "END_PROGRAM")]
    [InlineData(ItemKind.Kinds.Pou, "FUNCTION F_Add : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR", "END_FUNCTION")]
    [InlineData(ItemKind.Kinds.Pou, "FUNCTION_BLOCK FB_A\nVAR\nEND_VAR", "END_FUNCTION_BLOCK")]
    public void Every_POU_states_its_language_even_with_an_empty_body(string kind, string decl, string end) =>
        Assert.Equal($"{decl}\n%LANGUAGE ST\n\n{end}\n",
                     StWriter.Write(new ItemContent(kind, decl, "", new List<Member>(), ObjectProperties.None)));

    /// <summary>The object's own property lines follow its <c>%LANGUAGE</c> line, a member's <c>%FOLDER</c> among them
    /// — the line is the first <c>%</c>-line of a body.</summary>
    [Fact]
    public void The_objects_property_lines_follow_its_LANGUAGE_line()
    {
        var item = new ItemContent(ItemKind.Kinds.Pou, FbDecl, "x := 1;", new List<Member>
        {
            new(ItemKind.Kinds.Method, "Run", "METHOD Run", "x := 2;", ObjectProperties.None with { ExcludeFromBuild = true },
                Folder: "Cmds"),
        }, ObjectProperties.None with { ExcludeFromBuild = true });

        var text = StWriter.Write(item);

        Assert.Equal($"{FbDecl}\n%LANGUAGE ST\n%EXCLUDE_FROM_BUILD\nx := 1;\n\nEND_FUNCTION_BLOCK\n" +
                     "\nMETHOD Run\n%LANGUAGE ST\n%FOLDER Cmds\n%EXCLUDE_FROM_BUILD\nx := 2;\nEND_METHOD\n", text);
        Assert.Equal(text, StWriter.Write(StReader.Read(text, ItemKind.Kinds.Pou)));
    }

    /// <summary>…and a property line ABOVE the <c>%LANGUAGE</c> line is in the declaration, which the IDE would receive
    /// as code: refused by name.</summary>
    [Fact]
    public void A_property_line_above_the_LANGUAGE_line_is_refused()
    {
        var ex = Assert.Throws<BridgeException>(() => StReader.Read(
            $"{FbDecl}\n%EXCLUDE_FROM_BUILD\n%LANGUAGE ST\nx := 1;\n\nEND_FUNCTION_BLOCK\n", ItemKind.Kinds.Pou, "FB_Motor"));
        Assert.Equal(BridgeErrorCodes.InvalidSt, ex.ErrorCode);
        Assert.Contains("'%EXCLUDE_FROM_BUILD' in its declaration", ex.Message);
    }

    [Fact]
    public void An_interface_states_no_line()
    {
        var text = StWriter.Write(new ItemContent(ItemKind.Kinds.Interface, "INTERFACE I_Motor", "", new List<Member>
        {
            new(ItemKind.Kinds.InterfaceMethod, "Start", "METHOD Start : BOOL", "", ObjectProperties.None),
        }, ObjectProperties.None));
        Assert.DoesNotContain("%LANGUAGE", text);
    }

    /// <summary>A kind with no body has no <c>%LANGUAGE</c> line: one in an interface member, a GVL or a DUT would be
    /// written into the IDE as code, so it is refused by name, naming the line.</summary>
    [Theory]
    [InlineData("interface", "INTERFACE I\n\nMETHOD M : BOOL\n%LANGUAGE ST\nEND_METHOD\n\nEND_INTERFACE\n")]
    [InlineData("interface", "INTERFACE I\n\nPROPERTY P : BOOL\nGET\n%LANGUAGE LD\nEND_GET\nEND_PROPERTY\n\nEND_INTERFACE\n")]
    [InlineData("gvl", "VAR_GLOBAL\n\tx : INT;\nEND_VAR\n%LANGUAGE ST\n")]
    [InlineData("gvl", "VAR_GLOBAL\n%LANGUAGE ST\n\tx : INT;\nEND_VAR\n")]
    [InlineData("dut", "TYPE S :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n%LANGUAGE FBD\n")]
    public void A_LANGUAGE_line_in_a_kind_without_a_body_is_refused(string kind, string source)
    {
        var ex = Assert.Throws<BridgeException>(() => StReader.Read(source, kind));
        Assert.Equal(BridgeErrorCodes.InvalidSt, ex.ErrorCode);
        Assert.Contains("%LANGUAGE", ex.Message);
        Assert.Contains("opens a body", ex.Message);
    }

    [Fact]
    public void The_reader_splits_on_the_line_and_the_IDE_never_sees_it()
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
        foreach (var body in new[] { item.Body, reset.Body, count.Getter?.Body, count.Setter?.Body })
            Assert.DoesNotContain("%LANGUAGE", body ?? "");
    }

    [Fact]
    public void The_file_round_trips_byte_for_byte() =>
        Assert.Equal(Golden, StWriter.Write(StReader.Read(Golden, ItemKind.Kinds.Pou)));

    /// <summary>Trap 1 (pro2193's <c>BitLogic</c>): a trailing comment after <c>END_VAR</c> belongs to the declaration.
    /// The line states it; nothing is inferred.</summary>
    [Fact]
    public void A_trailing_comment_after_END_VAR_stays_in_the_declaration()
    {
        const string st =
            "FUNCTION_BLOCK FB\nVAR\n\tn : INT;\nEND_VAR\n%LANGUAGE ST\nEND_FUNCTION_BLOCK\n\n" +
            "METHOD Run\nVAR\n\tx : INT;\nEND_VAR\n// what this does\n%LANGUAGE ST\nn := 1;\nEND_METHOD\n";
        var run = StReader.Read(st, ItemKind.Kinds.Pou).Members.Single();
        Assert.Equal("METHOD Run\nVAR\n\tx : INT;\nEND_VAR\n// what this does", run.Declaration);
        Assert.Equal("n := 1;", run.Body);
    }

    /// <summary>Trap 2: a wrapped <c>EXTENDS</c>/<c>IMPLEMENTS</c> header is one declaration.</summary>
    [Fact]
    public void A_wrapped_EXTENDS_and_IMPLEMENTS_header_stays_in_the_declaration()
    {
        const string st =
            "FUNCTION_BLOCK FB_Derived\n\tEXTENDS FB_Base\n\tIMPLEMENTS I_Motor\nVAR\n\tn : INT;\nEND_VAR\n" +
            "%LANGUAGE ST\nn := 1;\nEND_FUNCTION_BLOCK\n";
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
            "FUNCTION_BLOCK FB\nVAR\n\tiCounter : INT;\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\n" +
            "METHOD Run\n%LANGUAGE ST\n{define MY_FLAG}\n{IF defined (MY_FLAG)}\niCounter := 42;\n{ELSE}\nbroken_xyz;\n{END_IF}\nEND_METHOD\n";
        var run = StReader.Read(st, ItemKind.Kinds.Pou).Members.Single();
        Assert.Equal("METHOD Run", run.Declaration);
        Assert.Equal("{define MY_FLAG}\n{IF defined (MY_FLAG)}\niCounter := 42;\n{ELSE}\nbroken_xyz;\n{END_IF}", run.Body);
        Assert.Equal(st, StWriter.Write(StReader.Read(st, ItemKind.Kinds.Pou)));
    }

    /// <summary>The line FAMILY 4 (PLC Assist's lsp-field-false-positives) tripped on: whatever stands between the last
    /// <c>END_VAR</c> and the line is the declaration's — here a stray <c>;</c>, which the IDE's declaration editor judges.
    /// The line is where the body starts, wherever it stands.</summary>
    [Fact]
    public void Text_between_the_last_END_VAR_and_the_line_is_the_declarations()
    {
        const string st = "FUNCTION_BLOCK FB\nVAR\n\tn : INT;\nEND_VAR;\n%LANGUAGE ST\nn := 1;\n\nEND_FUNCTION_BLOCK\n";
        var item = StReader.Read(st, ItemKind.Kinds.Pou);
        Assert.Equal("FUNCTION_BLOCK FB\nVAR\n\tn : INT;\nEND_VAR;", item.Declaration);
        Assert.Equal("n := 1;", item.Body);
    }

    /// <summary>A line inside a COMMENT is the engineer's prose, not the boundary — a block comment, one opened after code
    /// on its line (bakon-nano), and nested ones, as the LSP lexer nests them.</summary>
    [Theory]
    [InlineData("FUNCTION_BLOCK FB\n(* notes:\n%LANGUAGE ST\n*)\nVAR\n\tx : INT;\nEND_VAR")]
    [InlineData("FUNCTION_BLOCK FB\nVAR\n\tx : INT; (* old layout:\n%LANGUAGE ST\n*)\nEND_VAR")]
    [InlineData("FUNCTION_BLOCK FB\nVAR\n\tx : INT;(*NOT (\n%LANGUAGE LD\n*)\nEND_VAR")]
    [InlineData("FUNCTION_BLOCK FB\n(* outer (* inner *)\n%LANGUAGE LD\n*)\nVAR\n\tx : INT;\nEND_VAR")]
    public void A_line_inside_a_comment_is_no_boundary(string decl)
    {
        var st = $"{decl}\n%LANGUAGE ST\nx := 1;\n\nEND_FUNCTION_BLOCK\n";
        var item = StReader.Read(st, ItemKind.Kinds.Pou);
        Assert.Equal(decl, item.Declaration);
        Assert.Equal("x := 1;", item.Body);
        Assert.Equal(st, StWriter.Write(item));
    }

    /// <summary><c>(*</c> inside a line comment or a string opens nothing, so the line after it IS the boundary.</summary>
    [Theory]
    [InlineData("FUNCTION_BLOCK FB\nVAR\n\tx : INT; // (* not an opener\nEND_VAR")]
    [InlineData("FUNCTION_BLOCK FB\nVAR\n\ts : STRING := '(*';\nEND_VAR")]
    public void A_comment_opener_inside_a_line_comment_or_a_string_opens_nothing(string decl)
    {
        var item = StReader.Read($"{decl}\n%LANGUAGE ST\nx := 1;\n\nEND_FUNCTION_BLOCK\n", ItemKind.Kinds.Pou);
        Assert.Equal(decl, item.Declaration);
        Assert.Equal("x := 1;", item.Body);
    }

    /// <summary>A comment in an ST body that mentions another language is part of the body.</summary>
    [Fact]
    public void A_line_inside_an_ST_bodys_comment_stays_in_the_body()
    {
        const string body = "x := 1;\n(*\n%LANGUAGE LD\n*)\nx := 2;";
        var st = $"FUNCTION_BLOCK FB\nVAR\n\tx : INT;\nEND_VAR\n%LANGUAGE ST\n{body}\n\nEND_FUNCTION_BLOCK\n";
        var item = StReader.Read(st, ItemKind.Kinds.Pou);
        Assert.Equal(body, item.Body);
        Assert.False(NetworkText.Is(item.Body));
        Assert.Equal(st, StWriter.Write(item));
    }

    /// <summary>A body has ONE line. Two are refused naming both: the text alone cannot say which one is meant.</summary>
    [Fact]
    public void Two_lines_in_a_region_are_refused_naming_both()
    {
        var ex = Assert.Throws<BridgeException>(() => StReader.Read(
            $"{FbDecl}\n%LANGUAGE ST\nx := 1;\n%LANGUAGE LD\n\nEND_FUNCTION_BLOCK\n", ItemKind.Kinds.Pou, "FB_Motor"));
        Assert.Equal(BridgeErrorCodes.InvalidSt, ex.ErrorCode);
        Assert.Contains("more than one %LANGUAGE line: '%LANGUAGE ST' and, below it, '%LANGUAGE LD'", ex.Message);
    }

    /// <summary>A line that states no body is refused by name with what it lacks, in an item's own body and a member's.</summary>
    [Theory]
    [InlineData("%LANGUAGE SST", "'SST' is no language a body can state")]
    [InlineData("%LANGUAGE", "states no language")]
    [InlineData("%LANGUAGE CFC", "'%LANGUAGE CFC UNSUPPORTED'")]
    [InlineData("%LANGUAGE ST x := 1;", "is no language a body can state")]
    public void A_line_that_states_no_body_is_refused_naming_it(string line, string lacks)
    {
        var pou = Assert.Throws<BridgeException>(() => StReader.Read(
            $"FUNCTION_BLOCK FB_X\nVAR\nEND_VAR\n{line}\n\nEND_FUNCTION_BLOCK\n", ItemKind.Kinds.Pou, "FB_X"));
        Assert.Equal(BridgeErrorCodes.InvalidSt, pou.ErrorCode);
        Assert.Contains($"'FB_X' holds '{line}'", pou.Message);
        Assert.Contains(lacks, pou.Message);

        var member = Assert.Throws<BridgeException>(() => StReader.Read(
            $"FUNCTION_BLOCK FB_X\nVAR\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\nMETHOD Run : BOOL\n{line}\nEND_METHOD\n",
            ItemKind.Kinds.Pou, "FB_X"));
        Assert.Contains($"method 'Run' holds '{line}'", member.Message);
    }

    // ── no line: a POU or an action is refused, a member with no body slot is read ──────────────────────

    [Theory]
    [InlineData("FUNCTION_BLOCK FB_X\nVAR\nEND_VAR\nx := 1;\n\nEND_FUNCTION_BLOCK\n")]
    [InlineData("FUNCTION_BLOCK FB_X\nVAR\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\nACTION Act\nx := 1;\nEND_ACTION\n")]
    public void A_POU_or_an_action_with_no_line_is_refused_naming_volt_pull(string text)
    {
        var ex = Assert.Throws<BridgeException>(() => StReader.Read(text, ItemKind.Kinds.Pou, "FB_X"));
        Assert.Equal(BridgeErrorCodes.InvalidSt, ex.ErrorCode);
        Assert.Contains("has no '%LANGUAGE <ST|LD|FBD>' line", ex.Message);
        Assert.Contains("volt pull", ex.Message);
    }

    /// <summary>THE RETIRED LINE: <c>IMPLEMENTATION &lt;LANG&gt;</c> is no longer read, and a push of it is refused by
    /// name, saying to pull again — in a POU's own region, a member's, and a member that would otherwise read as having
    /// no slot.</summary>
    [Theory]
    [InlineData("FUNCTION_BLOCK FB_X\nVAR\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\n\nEND_FUNCTION_BLOCK\n", "IMPLEMENTATION ST")]
    [InlineData("FUNCTION_BLOCK FB_X\nVAR\nEND_VAR\nIMPLEMENTATION CFC UNSUPPORTED\n\nEND_FUNCTION_BLOCK\n", "IMPLEMENTATION CFC UNSUPPORTED")]
    [InlineData("FUNCTION_BLOCK FB_X\nVAR\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\nMETHOD Run\nimplementation ld\nEND_METHOD\n", "implementation ld")]
    [InlineData("FUNCTION_BLOCK FB_X\nVAR\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\nMETHOD ABSTRACT Run\nIMPLEMENTATION NONE\nEND_METHOD\n", "IMPLEMENTATION NONE")]
    [InlineData("FUNCTION_BLOCK FB_X\nVAR\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\nPROPERTY P : INT\nGET\nIMPLEMENTATION ST\nP := 1;\nEND_GET\nEND_PROPERTY\n", "IMPLEMENTATION ST")]
    public void The_retired_IMPLEMENTATION_line_is_refused_saying_to_pull_again(string text, string line)
    {
        var ex = Assert.Throws<BridgeException>(() => StReader.Read(text, ItemKind.Kinds.Pou, "FB_X"));
        Assert.Equal(BridgeErrorCodes.InvalidSt, ex.ErrorCode);
        Assert.Contains($"holds '{line}': `IMPLEMENTATION` is no longer read — pull again (it is now `%LANGUAGE <LANG>`).", ex.Message);
    }

    /// <summary>A METHOD whose IDE object has no body slot (CODESYS's <c>AbstractPOUMethodObject</c>) has NO line and
    /// nothing after its declaration; its property lines close the declaration. In memory: no body, stated
    /// <see cref="StatedLanguage.NoSlot"/>.</summary>
    [Fact]
    public void A_method_with_no_body_slot_has_no_line_and_round_trips()
    {
        var item = new ItemContent(ItemKind.Kinds.Pou, FbDecl, "x := 1;", new List<Member>
        {
            new(ItemKind.Kinds.Method, "Take", "METHOD ABSTRACT Take : INT\nVAR_INPUT\n\tn : INT;\nEND_VAR\n", null,
                ObjectProperties.None, Folder: "Commands", Stated: StatedLanguage.NoSlot),
            new(ItemKind.Kinds.Property, "Busy", "PROPERTY ABSTRACT Busy : BOOL", null, ObjectProperties.None,
                Getter: new Accessor("VAR\nEND_VAR", null, Stated: StatedLanguage.NoSlot), Setter: null),
        }, ObjectProperties.None, Stated: StatedLanguage.St);

        var text = StWriter.Write(item);

        Assert.Contains("\nMETHOD ABSTRACT Take : INT\nVAR_INPUT\n\tn : INT;\nEND_VAR\n\n%FOLDER Commands\nEND_METHOD\n", text);
        Assert.Contains("\nPROPERTY ABSTRACT Busy : BOOL\nGET\nVAR\nEND_VAR\nEND_GET\nEND_PROPERTY\n", text);
        var back = StReader.Read(text, ItemKind.Kinds.Pou);
        var take = back.Members.Single(m => m.Name == "Take");
        Assert.Null(take.Body);
        Assert.Equal(StatedLanguage.NoSlot, take.Stated);
        Assert.Equal("Commands", take.Folder);
        Assert.Equal("METHOD ABSTRACT Take : INT\nVAR_INPUT\n\tn : INT;\nEND_VAR\n", take.Declaration);
        var busy = back.Members.Single(m => m.Name == "Busy").Getter!;
        Assert.Null(busy.Body);
        Assert.Equal(StatedLanguage.NoSlot, busy.Stated);
        Assert.Equal(text, StWriter.Write(back));
    }

    /// <summary>A declaration with no VAR block ends at its header, and a comment after it is the declaration's.</summary>
    [Theory]
    [InlineData("METHOD ABSTRACT Cyclic\n\n// must call the state FB\n")]
    [InlineData("METHOD PUBLIC ABSTRACT Reset : BOOL\t// returns true when homed")]
    [InlineData("{attribute 'analysis' := '-33'}\nMETHOD PROTECTED ABSTRACT Manual\nVAR_INPUT\n\tb : BOOL;\nEND_VAR\n")]
    public void A_method_declaration_alone_has_no_slot(string declaration)
    {
        var text = $"{FbDecl}\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\n{declaration}\nEND_METHOD\n";
        var m = StReader.Read(text, ItemKind.Kinds.Pou, "FB_Motor").Members.Single();
        Assert.Equal(StatedLanguage.NoSlot, m.Stated);
        Assert.Null(m.Body);
        Assert.Equal(declaration, m.Declaration);
        Assert.Equal(text, StWriter.Write(StReader.Read(text, ItemKind.Kinds.Pou)));
    }

    /// <summary>Code after a member's declaration with no line has no language to be read in: refused by name, saying to
    /// state <c>%LANGUAGE ST</c>.</summary>
    [Theory]
    [InlineData("METHOD Run\nVAR\n\tn : INT;\nEND_VAR\nn := 1;\nEND_METHOD\n", "method 'Run' holds 'n := 1;'")]
    [InlineData("METHOD Run : BOOL\nRun := TRUE;\nEND_METHOD\n", "method 'Run' holds 'Run := TRUE;'")]
    [InlineData("PROPERTY P : INT\nGET\nP := 1;\nEND_GET\nEND_PROPERTY\n", "property 'P' GET holds 'P := 1;'")]
    // `END_VAR;`: the `;` is code after the declaration, as the LSP reads it (nothing but trivia may follow it)
    [InlineData("METHOD ABSTRACT Run : BOOL\nVAR_INPUT\n\tx : INT;\nEND_VAR;\nEND_METHOD\n", "method 'Run' holds 'END_VAR;'")]
    [InlineData("PROPERTY ABSTRACT P : INT\nGET\nVAR\nEND_VAR;\nEND_GET\nEND_PROPERTY\n", "property 'P' GET holds 'END_VAR;'")]
    public void Code_after_a_members_declaration_with_no_line_is_refused(string member, string named)
    {
        var ex = Assert.Throws<BridgeException>(() => StReader.Read(
            $"{FbDecl}\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\n{member}", ItemKind.Kinds.Pou, "FB_Motor"));
        Assert.Equal(BridgeErrorCodes.InvalidSt, ex.ErrorCode);
        Assert.Contains(named, ex.Message);
        Assert.Contains("state '%LANGUAGE ST'", ex.Message);
    }

    /// <summary>"Nothing after the declaration" is the LSP's reading: the declaration is the header and its VAR blocks,
    /// each running from its keyword to its END_VAR wherever they stand on their lines — so a one-line block is a
    /// declaration, and a statement BETWEEN two blocks is code after it (the LSP: no line, so no language).</summary>
    [Theory]
    [InlineData("METHOD ABSTRACT Run : INT\nVAR_INPUT a : INT; END_VAR\n")]
    [InlineData("METHOD ABSTRACT Run : INT\nVAR_INPUT a : INT; END_VAR\nVAR CONSTANT\n\tk : INT := 1;\nEND_VAR\n")]
    [InlineData("METHOD ABSTRACT Run : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR VAR_OUTPUT b : INT; END_VAR\n")]
    public void A_one_line_VAR_block_is_a_slotless_members_declaration(string declaration)
    {
        var text = $"{FbDecl}\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\n{declaration}\nEND_METHOD\n";
        var m = StReader.Read(text, ItemKind.Kinds.Pou, "FB_Motor").Members.Single();
        Assert.Equal(StatedLanguage.NoSlot, m.Stated);
        Assert.Equal(declaration, m.Declaration);
    }

    [Theory]
    [InlineData("METHOD ABSTRACT Run : INT\nVAR_INPUT\n\ta : INT;\nEND_VAR\nRun := 1;\nVAR\nEND_VAR\nEND_METHOD\n", "method 'Run' holds 'Run := 1;'")]
    [InlineData("METHOD ABSTRACT Run : INT\nVAR_INPUT a : INT; END_VAR Run := 1;\nEND_METHOD\n", "method 'Run' holds 'VAR_INPUT a : INT; END_VAR Run := 1;'")]
    [InlineData("METHOD ABSTRACT Run : INT\nVAR_FOO\nEND_VAR\nEND_METHOD\n", "method 'Run' holds 'VAR_FOO'")]
    [InlineData("PROPERTY ABSTRACT P : INT\nGET\nVAR\nEND_VAR\nP := 1;\nVAR\nEND_VAR\nEND_GET\nEND_PROPERTY\n", "property 'P' GET holds 'P := 1;'")]
    public void A_statement_between_or_after_VAR_blocks_is_code_after_the_declaration(string member, string named)
    {
        var ex = Assert.Throws<BridgeException>(() => StReader.Read(
            $"{FbDecl}\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\n{member}", ItemKind.Kinds.Pou, "FB_Motor"));
        Assert.Equal(BridgeErrorCodes.InvalidSt, ex.ErrorCode);
        Assert.Contains(named, ex.Message);
    }

    /// <summary>A property accessor's VAR block on ONE line ends where its END_VAR stands: the %LANGUAGE line and the body
    /// under it are the accessor's, as they are with the block on three lines (the LSP reads both alike).</summary>
    [Theory]
    [InlineData("VAR x : INT; END_VAR")]
    [InlineData("VAR\n\tx : INT;\nEND_VAR")]
    public void An_accessors_one_line_VAR_block_ends_at_its_END_VAR(string block)
    {
        var text = $"{FbDecl}\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\nPROPERTY P : INT\nGET\n{block}\n%LANGUAGE ST\nP := x;\nEND_GET\nEND_PROPERTY\n";
        var getter = StReader.Read(text, ItemKind.Kinds.Pou, "FB_Motor").Members.Single().Getter!;
        Assert.Equal(StatedLanguage.St, getter.Stated);
        Assert.Equal(block, getter.Declaration);
        Assert.Contains("P := x;", getter.Body);
        Assert.Equal(text, StWriter.Write(StReader.Read(text, ItemKind.Kinds.Pou)));
    }

    /// <summary>A body with no slot exists only at a METHOD or an accessor: a POU's own or an action's read without one is
    /// no file the push reads back, and the pull refuses to write it, by name.</summary>
    [Fact]
    public void The_writer_refuses_no_slot_at_a_POU_or_an_action()
    {
        var pou = new ItemContent(ItemKind.Kinds.Pou, FbDecl, null, new List<Member>(), ObjectProperties.None,
                                  Stated: StatedLanguage.NoSlot);
        Assert.Equal(BridgeErrorCodes.Unsupported, Assert.Throws<BridgeException>(() => StWriter.Write(pou)).ErrorCode);
        var action = new ItemContent(ItemKind.Kinds.Pou, FbDecl, "", new List<Member>
        {
            new(ItemKind.Kinds.Action, "Act", "ACTION Act", null, ObjectProperties.None, Stated: StatedLanguage.NoSlot),
        }, ObjectProperties.None);
        var ex = Assert.Throws<BridgeException>(() => StWriter.Write(action));
        Assert.Contains("action 'Act' has no body slot", ex.Message);
    }

    // ── hidden bodies ─────────────────────────────────────────────────────────────────────────────────

    /// <summary>A CFC/SFC/IL body, or a network body the text cannot represent, is its UNSUPPORTED line and nothing under
    /// it — never labelled <c>%LANGUAGE ST</c>.</summary>
    [Theory]
    [InlineData("%LANGUAGE CFC UNSUPPORTED")]
    [InlineData("%LANGUAGE SFC UNSUPPORTED")]
    [InlineData("%LANGUAGE IL UNSUPPORTED")]
    [InlineData("%LANGUAGE LD UNSUPPORTED")]
    [InlineData("%LANGUAGE FBD UNSUPPORTED")]
    public void A_hidden_body_is_its_UNSUPPORTED_line_and_round_trips(string line)
    {
        var item = new ItemContent(ItemKind.Kinds.Pou, FbDecl, line, new List<Member>
        {
            new(ItemKind.Kinds.Method, "Chart", "METHOD Chart", line, ObjectProperties.None),
            new(ItemKind.Kinds.Property, "Ready", "PROPERTY Ready : BOOL", "", ObjectProperties.None,
                Getter: new Accessor("", line), Setter: null),
        }, ObjectProperties.None);

        var text = StWriter.Write(item);

        Assert.Equal(
            $"{FbDecl}\n{line}\n\nEND_FUNCTION_BLOCK\n" +
            $"\nMETHOD Chart\n{line}\nEND_METHOD\n" +
            $"\nPROPERTY Ready : BOOL\nGET\n{line}\nEND_GET\nEND_PROPERTY\n", text);
        Assert.DoesNotContain("%LANGUAGE ST", text);
        var back = StReader.Read(text, ItemKind.Kinds.Pou);
        Assert.Equal(line, back.Body);
        Assert.Equal(line, back.Members.Single(m => m.Name == "Chart").Body);
        Assert.Equal(line, back.Members.Single(m => m.Name == "Ready").Getter?.Body);
        Assert.Equal(text, StWriter.Write(back));
    }

    /// <summary>A hidden member's <c>%FOLDER</c> follows its line, as every member's does.</summary>
    [Theory]
    [InlineData("%LANGUAGE SFC UNSUPPORTED")]
    [InlineData("%LANGUAGE LD UNSUPPORTED")]
    public void A_hidden_members_folder_follows_its_line_and_round_trips(string line)
    {
        var item = new ItemContent(ItemKind.Kinds.Pou, FbDecl, "", new List<Member>
        {
            new(ItemKind.Kinds.Action, "Chart", "ACTION Chart", line, ObjectProperties.None, Folder: "Sub/Deep"),
        }, ObjectProperties.None);
        var text = StWriter.Write(item);
        Assert.Equal($"{FbDecl}\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\nACTION Chart\n{line}\n%FOLDER Sub/Deep\nEND_ACTION\n", text);
        var chart = StReader.Read(text, ItemKind.Kinds.Pou).Members.Single();
        Assert.Equal("Sub/Deep", chart.Folder);
        Assert.Equal(line, chart.Body);
    }

    // ── the stated language decides the reader ─────────────────────────────────────────────────────────

    private const string LdBody = "%NETWORK\nout := a;";

    private const string Graphical =
        "FUNCTION_BLOCK FB_G\nVAR\n\ta : BOOL;\n\tout : BOOL;\nEND_VAR\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\n" +
        "METHOD Diagram\n%LANGUAGE FBD\n" + LdBody + "\nEND_METHOD\n\n" +
        "METHOD Ladder\n%LANGUAGE LD\n" + LdBody + "\nEND_METHOD\n\n" +
        "METHOD Text\n%LANGUAGE ST\nout := a;\nEND_METHOD\n";

    [Fact]
    public void LD_and_FBD_bodies_are_network_text_and_an_ST_body_is_not()
    {
        var item = StReader.Read(Graphical, ItemKind.Kinds.Pou);
        Assert.Equal("LD", NetworkText.LanguageOf(item.Members.Single(m => m.Name == "Ladder").Body));
        Assert.Equal("FBD", NetworkText.LanguageOf(item.Members.Single(m => m.Name == "Diagram").Body));
        Assert.False(NetworkText.Is(item.Members.Single(m => m.Name == "Text").Body));
        Assert.Equal(Graphical, StWriter.Write(item));
    }

    [Theory]
    [InlineData(BodyLanguage.Ld, "%LANGUAGE LD\n")]
    [InlineData(BodyLanguage.Fbd, "%LANGUAGE FBD\n")]
    public void The_network_text_writer_opens_a_body_with_its_line(BodyLanguage language, string first)
    {
        var text = StNetworkWriter.Write(new NetworkBody(language, new[] { Net(Set(L("a"), T("out"))) }), NetworkScope.Empty);
        Assert.StartsWith(first, text);
        Assert.Equal(language, StNetworkReader.Read(text, NetworkScope.Empty).Language);
        Assert.True(StNetworkGate.Validate(text, NetworkScope.Empty).Ok);
    }

    [Theory]
    [InlineData("%LANGUAGE ST\n" + LdBody)]               // network text under ST: the network reader is not its reader
    [InlineData("IMPLEMENTATION LD\n" + LdBody)]          // the retired line
    [InlineData("%LANGUAGE\n" + LdBody)]                  // no language
    [InlineData("%LANGUAGE CFC UNSUPPORTED\n" + LdBody)]  // hidden: no reader, network text included
    [InlineData("%LANGUAGE LD UNSUPPORTED\n" + LdBody)]
    public void The_network_text_reader_reads_only_a_body_stated_LD_or_FBD(string text)
    {
        Assert.Throws<StNetworkReadException>(() => StNetworkReader.Read(text, NetworkScope.Empty));
        Assert.False(StNetworkGate.Validate(text, NetworkScope.Empty).Ok);
    }

    // ── an ST body the IDE holds ──────────────────────────────────────────────────────────────────

    /// <summary>The drivers hand an ST body up through <see cref="PropertyLines.RequireStBody"/>: in memory an ST body
    /// carries no line, so a <c>%LANGUAGE</c> line in its text would be read back as one.</summary>
    [Theory]
    [InlineData("%LANGUAGE LD UNSUPPORTED", "%LANGUAGE LD UNSUPPORTED")]
    [InlineData("%LANGUAGE LD\n%NETWORK\nx := 1;", "%LANGUAGE LD")]
    [InlineData("x := 1;\n%LANGUAGE st", "%LANGUAGE st")]
    [InlineData("x := 1;\n%LANGUAGE", "%LANGUAGE")]
    public void An_ST_body_with_a_LANGUAGE_line_is_refused_naming_the_line(string body, string line)
    {
        var ex = Assert.Throws<BridgeException>(() => PropertyLines.RequireStBody(body));
        Assert.Contains($"'{line}'", ex.Message);
    }

    [Theory]
    [InlineData("x := 1;")]
    [InlineData("(*\n%LANGUAGE CFC UNSUPPORTED\n*)\nx := 1;")]
    [InlineData("s :='%LANGUAGE ST';")]
    [InlineData("IMPLEMENTATION ST")]                 // the retired line in the IDE's own text is code the IDE compiles
    [InlineData("IMPLEMENTATION := 1;")]
    public void An_ST_body_without_a_LANGUAGE_line_is_handed_up_unchanged(string body) =>
        Assert.Equal(body, PropertyLines.RequireStBody(body));

    /// <summary>An EMPTY or blank POU or interface text has no outer block, and is refused as every text without one is.</summary>
    [Theory]
    [InlineData("", "pou", "END_FUNCTION_BLOCK / END_PROGRAM / END_FUNCTION")]
    [InlineData("  \n\t\n", "pou", "END_FUNCTION_BLOCK / END_PROGRAM / END_FUNCTION")]
    [InlineData("", "interface", "END_INTERFACE")]
    [InlineData("\n", "interface", "END_INTERFACE")]
    public void An_empty_composite_text_is_refused_as_missing_its_outer_end(string text, string kind, string ends)
    {
        var ex = Assert.Throws<BridgeException>(() => StReader.Read(text, kind, "X"));
        Assert.Equal(BridgeErrorCodes.InvalidSt, ex.ErrorCode);
        Assert.Equal($"Missing {ends} in 'X' — the text does not say where the item ends and its members begin.", ex.Message);
    }
}
