using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// THE CHILD SPLITTER, ONE ROW PER CASE (openspec <c>push-without-header-check</c> 5.E.1).
///
/// <para>A member has no file of its own, so its header line is the one place a push still reads a header: the
/// splitter finds where each METHOD / ACTION / PROPERTY block opens and closes in the text after the POU's END line
/// (or inside an INTERFACE block). It reads trivia through ONE skipper, <c>StTrivia</c> — the one that NESTS comments as
/// both vendors do (<c>lex_nested_block_comment</c> builds clean on CODESYS and TwinCAT), sees a comment opened after
/// code, and keeps a string's text out of the keyword search. It used to read through <c>CodeHelper.CodeOn</c>, which
/// did neither of the first two: a word after an inner <c>*)</c> was code, so a nested comment before a member refused
/// the file, and an <c>END_METHOD</c> inside one ended the member there.</para>
///
/// <para>Every row is either the members the text holds — kind, name, and where the row says so the first line of the
/// member's declaration (its leading trivia) or its return type — or a refusal naming the item and the FILE line. An
/// unsplittable text is refused, never split wrong: a member may not open inside another, and an END line stands at
/// the start of its own line.</para>
/// </summary>
public class ChildSplitterTableTests
{
    // Lines 1-6; a blank line 7; the region starts at line 8.
    private const string Fb =
        "FUNCTION_BLOCK FB\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK\n\n";

    // Line 1; the region starts at line 2.
    private const string Itf = "INTERFACE I\n";

    private static string M(string sig, string body = ";") => $"{sig}\nIMPLEMENTATION ST\n{body}\nEND_METHOD\n";

    /// <summary>(row, owner kind, region, expected). Expected is a comma list of <c>kind:Name</c>, each optionally
    /// followed by <c>=Type</c> (its return or data type) and <c>[first declaration line]</c>; or <c>!line N|text</c>,
    /// a refusal naming <c>'FB'</c>/<c>'I'</c> and file line N whose message holds the text.</summary>
    public static IEnumerable<object[]> Rows() => new[]
    {
        // ── trivia BEFORE a member ──
        Row("line comment before METHOD", "pou", "// doc\n" + M("METHOD M : INT"), "method:M=INT[// doc]"),
        Row("block comment before METHOD", "pou", "(* doc *)\n" + M("METHOD M : INT"), "method:M[(* doc *)]"),
        Row("multi-line block comment with a blank line before METHOD", "pou",
            "(*\n\n  usage: M()\n*)\n" + M("METHOD M : INT"), "method:M[(*]"),
        Row("attribute before METHOD", "pou", "{attribute 'hide'}\n" + M("METHOD M"), "method:M[{attribute 'hide'}]"),
        Row("attribute on the METHOD line", "pou", M("{attribute 'hide'} METHOD M"), "method:M[{attribute 'hide'} METHOD M]"),
        Row("attribute and comment before PROPERTY", "pou",
            "{attribute 'monitoring' := 'call'}\n// p\nPROPERTY P : INT\nGET\nIMPLEMENTATION ST\nP := 1;\nEND_GET\nEND_PROPERTY\n",
            "property:P=INT[{attribute 'monitoring' := 'call'}]"),
        // An action's line is composed, not stored (openspec bridge-refusal-review D10): a comment on it would be dropped
        // without a word, so it is refused by name. (This row read it as the action's declaration, which no write stores.)
        Row("comment on the ACTION line", "pou", "(* a *) ACTION A\nIMPLEMENTATION ST\n;\nEND_ACTION\n",
            "!line 8|an action has no declaration the IDE stores"),
        // Nor may text stand ABOVE the ACTION line, or under it before the body (review 4b): it is read into the action's
        // declaration, which neither write stores (`Action ? null`), so it would be dropped the same way. (The row
        // "trivia between members" read `// next` into action B's declaration and accepted it.) A blank line is layout.
        Row("trivia above an ACTION line", "pou",
            M("METHOD A") + "\n// next\n(* x *)\n{attribute 'y'}\nACTION B\nIMPLEMENTATION ST\n;\nEND_ACTION\n",
            "!line 13|an action has no declaration the IDE stores"),
        Row("a VAR section under an ACTION line", "pou", "ACTION A\nVAR t : INT; END_VAR\nIMPLEMENTATION ST\n;\nEND_ACTION\n",
            "!line 9|an action has no declaration the IDE stores"),
        Row("a comment under an ACTION line", "pou", "ACTION A\n// note\nIMPLEMENTATION ST\n;\nEND_ACTION\n",
            "!line 9|an action has no declaration the IDE stores"),
        Row("a blank line under an ACTION line", "pou", "ACTION A\n\nIMPLEMENTATION ST\n;\nEND_ACTION\n", "action:A"),
        Row("trivia between members", "pou",
            M("METHOD A") + "\n// next\n(* x *)\n{attribute 'y'}\n" +
            "PROPERTY C : INT\nGET\nIMPLEMENTATION ST\nC := 1;\nEND_GET\nEND_PROPERTY\n",
            "method:A,property:C[// next]"),
        Row("a comment after the last member", "pou", M("METHOD M") + "\n// trailing note\n",
            "!line 13|'// trailing note' stands after the last member"),
        Row("a comment after the END line of a POU with no member", "pou", "(* nothing below *)\n",
            "!line 8|'(* nothing below *)' stands after the last member"),
        Row("TRANSITION is no member a file carries", "pou", "TRANSITION T\n;\nEND_TRANSITION\n",
            "!line 8|expected METHOD/ACTION/PROPERTY, got: TRANSITION T"),

        // ── nested and unclosed comments ──
        Row("nested comment before METHOD", "pou", "(* outer (* inner *) still comment *)\n" + M("METHOD M : INT"),
            "method:M=INT[(* outer (* inner *) still comment *)]"),
        Row("nested comment hiding a METHOD", "pou",
            "(* outer (* inner *)\nMETHOD Hidden : INT\n*)\n" + M("METHOD M : INT"), "method:M[(* outer (* inner *)]"),
        Row("nested comment hiding END_METHOD in a body", "pou",
            "METHOD M : INT\nIMPLEMENTATION ST\n(* a (* b *)\nEND_METHOD\n*)\nM := 1;\nEND_METHOD\n\n" + M("METHOD N"),
            "method:M,method:N"),
        Row("nested comment on the signature line", "pou", M("METHOD M : INT (* a (* b *) c *)"), "method:M=INT"),
        Row("comment opened after code hiding END_METHOD", "pou",
            "METHOD M : INT\nIMPLEMENTATION ST\nM := 1; (* note\nEND_METHOD\n*)\nM := 2;\nEND_METHOD\n\n" + M("METHOD N"),
            "method:M,method:N"),
        Row("unclosed comment before a member", "pou", "(* doc never closed\n" + M("METHOD M : INT"),
            "!line 8|expected METHOD/ACTION/PROPERTY, got: (* doc never closed"),
        Row("unclosed comment in the last member's body", "pou",
            "METHOD M : INT\nIMPLEMENTATION ST\nM := 1; (* never closed\nEND_METHOD\n", "method:M"),

        // ── a keyword inside a comment or a string ──
        Row("END_METHOD inside a string", "pou",
            "METHOD M : STRING\nIMPLEMENTATION ST\nM := CONCAT('a',\n'END_METHOD');\nEND_METHOD\n\n" + M("METHOD N"),
            "method:M,method:N"),
        Row("a comment opener inside a string", "pou",
            "METHOD M : STRING\nIMPLEMENTATION ST\nM := '(*';\nEND_METHOD\n\n" + M("METHOD N"), "method:M,method:N"),
        Row("METHOD inside a string between members is code", "pou", M("METHOD A") + "'METHOD B'\n" + M("METHOD C"),
            "!line 12|expected METHOD/ACTION/PROPERTY, got: 'METHOD B'"),
        Row("END_METHOD inside a line comment", "pou",
            "METHOD M : INT\nIMPLEMENTATION ST\n// END_METHOD\nM := 1;\nEND_METHOD\n\n" + M("METHOD N"), "method:M,method:N"),

        // ── // vs (* *) mixes ──
        Row("(* inside a line comment opens nothing", "pou",
            "// (* not an opener\n" + M("METHOD A") + "(* // not a line comment *) METHOD B\nIMPLEMENTATION ST\n;\nEND_METHOD\n",
            "method:A[// (* not an opener],method:B[(* // not a line comment *) METHOD B]"),
        Row("(* after code inside a line comment", "pou",
            "METHOD M\nIMPLEMENTATION ST\nx := 1; // (*\nEND_METHOD\n\n" + M("METHOD N"), "method:M,method:N"),
        Row("*) inside a line comment inside a block comment closes it", "pou",
            "(* a\n// b *)\n" + M("METHOD M"), "method:M[(* a]"),

        // ── CRLF / BOM ──
        Row("CRLF line ends", "pou", ("// doc\n" + M("METHOD M : INT") + "\n" + M("METHOD N")).Replace("\n", "\r\n"),
            "method:M[// doc],method:N"),

        // ── every modifier order ──
        Row("modifiers in any order", "pou",
            M("METHOD PUBLIC ABSTRACT A : INT") + M("METHOD ABSTRACT PUBLIC B") + M("METHOD FINAL PROTECTED C : BOOL") +
            M("METHOD INTERNAL D") + M("method private e") +
            "PROPERTY PRIVATE P : INT\nGET\nIMPLEMENTATION ST\nP := 1;\nEND_GET\nEND_PROPERTY\n" +
            "PROPERTY PUBLIC ABSTRACT Q : INT\nEND_PROPERTY\n",
            "method:A=INT,method:B,method:C=BOOL,method:D,method:e,property:P=INT,property:Q=INT"),
        // The name is the LAST word before the colon (openspec bridge-refusal-review D10): a word before it is the build's to
        // report, not a vocabulary the splitter holds. (This row refused 'PUBLIK' as "not an access modifier".)
        Row("a word that is no modifier", "pou", M("METHOD PUBLIK M"), "method:M"),

        // ── END lines on the same line, and a member opened inside another ──
        Row("END_METHOD after code on the same line", "pou",
            "METHOD A : INT\nIMPLEMENTATION ST\nA := 1; END_METHOD\n\n" + M("METHOD B : INT"),
            "!line 10|END_METHOD"),
        Row("END_METHOD on the signature line", "pou", "METHOD A : INT END_METHOD\n", "!line 8|END_METHOD"),
        // A member NAMED after its own END keyword: the word stands in the header's NAME position, where it is the name,
        // not an END line (openspec push-keeps-what-landed 3.G). The IDE answers for the name \u2014 not a false "after code"
        // from Volt.
        Row("a METHOD named END_METHOD", "pou", M("METHOD END_METHOD : INT") + M("METHOD B"), "method:END_METHOD=INT,method:B"),
        Row("a METHOD with a modifier named end_method", "pou", M("METHOD PUBLIC end_method"), "method:end_method"),
        // With a colon on the line the name is the last word before it (D10, no vocabulary), and the END-after-code
        // exemption asks the same word: a modifier typo names end_method too, not "END_METHOD stands after code" (review 4b).
        Row("a METHOD with a modifier typo named end_method", "pou", M("METHOD PUBLC end_method : INT"), "method:end_method=INT"),
        Row("a PROPERTY with a modifier typo named end_property", "pou",
            "PROPERTY PUBLC end_property : INT\nGET\nIMPLEMENTATION ST\n;\nEND_GET\nEND_PROPERTY\n", "property:end_property=INT"),
        Row("an ACTION named END_ACTION", "pou", "ACTION END_ACTION\nIMPLEMENTATION ST\n;\nEND_ACTION\n", "action:END_ACTION"),
        Row("a PROPERTY named END_PROPERTY", "pou",
            "PROPERTY PUBLIC END_PROPERTY : INT\nGET\nIMPLEMENTATION ST\n;\nEND_GET\nEND_PROPERTY\n", "property:END_PROPERTY=INT"),
        Row("a METHOD named END_METHOD with END_METHOD after it on the line", "pou",
            "METHOD END_METHOD : INT END_METHOD\n", "!line 8|END_METHOD stands after code"),
        // …but an END word AFTER another name on a colon-less signature line is no name: the last word before the end of
        // the line is END_METHOD, and it is an END line after code (1+2d review — it used to read as member END_METHOD).
        Row("END_METHOD after the name on a signature line with no colon", "pou",
            "METHOD Foo END_METHOD\nIMPLEMENTATION ST\n;\nEND_METHOD\n", "!line 8|END_METHOD stands after code"),
        Row("END_PROPERTY after the name on a signature line with no colon", "pou",
            "PROPERTY P END_PROPERTY\nGET\nIMPLEMENTATION ST\n;\nEND_GET\nEND_PROPERTY\n", "!line 8|END_PROPERTY stands after code"),
        Row("END_GET after code on the same line", "pou",
            "PROPERTY P : INT\nGET\nIMPLEMENTATION ST\nP := 1; END_GET\nEND_PROPERTY\n", "!line 11|END_GET"),
        Row("END_ACTION after code on the same line", "pou",
            "ACTION A\nIMPLEMENTATION ST\nx := 1; END_ACTION\n", "!line 10|END_ACTION"),
        Row("a member opened before the last one closed", "pou",
            "METHOD A : INT\nIMPLEMENTATION ST\nA := 1;\n\n" + M("METHOD B : INT"), "!line 12|METHOD"),
        Row("END_SET after code on the same line", "pou",
            "PROPERTY P : INT\nSET\nIMPLEMENTATION ST\nx := P; END_SET\nEND_PROPERTY\n", "!line 11|END_SET"),
        Row("END_PROPERTY after code on the same line", "pou",
            "PROPERTY P : INT\nGET\nIMPLEMENTATION ST\nP := 1;\nEND_GET\nx := 1; END_PROPERTY\n", "!line 13|END_PROPERTY"),
        Row("END_PROPERTY on the signature line", "pou", "PROPERTY P : INT END_PROPERTY\n", "!line 8|END_PROPERTY"),
        Row("a PROPERTY opened inside a METHOD", "pou",
            "METHOD A\nIMPLEMENTATION ST\n;\n\nPROPERTY P : INT\nEND_PROPERTY\n", "!line 12|PROPERTY opens a member inside the method"),
        Row("a METHOD opened inside a property's accessor", "pou",
            "PROPERTY P : INT\nGET\nIMPLEMENTATION ST\nP := 1;\n\n" + M("METHOD M"),
            "!line 13|METHOD opens a member inside the property"),
        Row("an ACTION opened inside a property's declaration", "pou",
            "PROPERTY P : INT\nVAR\nEND_VAR\nACTION A\nIMPLEMENTATION ST\n;\nEND_ACTION\nEND_PROPERTY\n",
            "!line 11|ACTION opens a member inside the property"),

        // ── anything beside an END line: the IDE stores no END line, so it would be lost ──
        Row("a line comment after END_METHOD", "pou", "METHOD A\nIMPLEMENTATION ST\n;\nEND_METHOD // keep me\n",
            "!line 11|holds its END keyword alone"),
        Row("a block comment after END_ACTION", "pou", "ACTION A\nIMPLEMENTATION ST\n;\nEND_ACTION (* note *)\n",
            "!line 11|holds its END keyword alone"),
        Row("a comment opened after END_METHOD running over the next member", "pou",
            "METHOD A\nIMPLEMENTATION ST\n;\nEND_METHOD (* old version\nMETHOD B : INT\n*)\n\n" + M("METHOD C"),
            "!line 11|holds its END keyword alone"),
        Row("a comment after END_GET", "pou",
            "PROPERTY P : INT\nGET\nIMPLEMENTATION ST\nP := 1;\nEND_GET // g\nEND_PROPERTY\n", "!line 12|holds its END keyword alone"),
        Row("a comment after END_SET", "pou",
            "PROPERTY P : INT\nSET\nIMPLEMENTATION ST\nx := P;\nEND_SET (* s *)\nEND_PROPERTY\n", "!line 12|holds its END keyword alone"),
        Row("a comment after END_PROPERTY", "pou",
            "PROPERTY P : INT\nGET\nIMPLEMENTATION ST\nP := 1;\nEND_GET\nEND_PROPERTY // p\n", "!line 13|holds its END keyword alone"),
        Row("a comment beside GET", "pou",
            "PROPERTY P : INT\nGET // the getter\nIMPLEMENTATION ST\nP := 1;\nEND_GET\nEND_PROPERTY\n", "!line 9|holds its END keyword alone"),
        Row("a SET-led line inside a getter's body", "pou",
            "PROPERTY P : INT\nGET\nIMPLEMENTATION ST\nSet := TRUE;\nEND_GET\nEND_PROPERTY\n", "!line 11|holds its END keyword alone"),
        Row("interface: a comment after END_METHOD", "interface",
            "\nMETHOD A : INT\nEND_METHOD // a\nEND_INTERFACE\n", "!line 4|holds its END keyword alone"),
        Row("spaces and tabs beside END_METHOD are layout", "pou", "METHOD A\nIMPLEMENTATION ST\n;\n \tEND_METHOD \t \n",
            "method:A"),

        // ── inside an INTERFACE block (signatures, no boundary line) ──
        Row("interface: nested comment before METHOD", "interface",
            "\n(* outer (* inner *) still *)\nMETHOD M : INT\nEND_METHOD\nEND_INTERFACE\n",
            "interface_method:M=INT[(* outer (* inner *) still *)]"),
        Row("interface: nested comment hiding a METHOD", "interface",
            "\n(* outer (* inner *)\nMETHOD Hidden : INT\nEND_METHOD\n*)\nMETHOD M : INT\nEND_METHOD\nEND_INTERFACE\n",
            "interface_method:M"),
        Row("interface: END_METHOD on the signature line", "interface",
            "\nMETHOD A : INT END_METHOD\nMETHOD B : INT\nEND_METHOD\nEND_INTERFACE\n", "!line 3|END_METHOD"),
        Row("interface: a METHOD named END_METHOD", "interface",
            "\nMETHOD END_METHOD : INT\nEND_METHOD\nEND_INTERFACE\n", "interface_method:END_METHOD=INT"),
        Row("interface: a member opened before the last one closed", "interface",
            "\nMETHOD A : INT\n\nMETHOD B : INT\nEND_METHOD\nEND_INTERFACE\n", "!line 5|METHOD"),
        Row("interface: BOM at the start of the text", "interface",
            "\n// doc\nMETHOD M : INT\nEND_METHOD\nEND_INTERFACE\n", "interface_method:M[// doc]", bom: true),
        Row("pou: BOM at the start of the text", "pou", M("METHOD M"), "method:M", bom: true),
        // A BOM anywhere but the text's first character is no BOM: a slice of the text starting there must not read it
        // as one while the whole text reads it as code. Refused naming its line.
        Row("pou: BOM leading the first member's line", "pou", "\uFEFF" + M("METHOD M"), "!line 8|U+FEFF"),
        Row("pou: BOM leading a later member's line", "pou", M("METHOD A") + "\uFEFF" + M("METHOD B"), "!line 12|U+FEFF"),
        Row("pou: BOM inside a body", "pou", M("METHOD A", "x := 1;\uFEFF"), "!line 10|U+FEFF"),
        Row("interface: BOM leading a member's line", "interface", "\n\uFEFFMETHOD M : INT\nEND_METHOD\nEND_INTERFACE\n",
            "!line 3|U+FEFF"),
    };

    private static object[] Row(string row, string kind, string region, string expected, bool bom = false) =>
        new object[] { row, kind, (bom ? "\uFEFF" : "") + (kind == "pou" ? Fb : Itf) + region + (kind == "pou" ? "" : ""), expected };

    [Theory]
    [MemberData(nameof(Rows))]
    public void The_splitter_reads_each_row(string row, string kind, string text, string expected)
    {
        var owner = kind == "pou" ? "FB" : "I";
        if (expected.StartsWith("!", StringComparison.Ordinal))
        {
            var parts = expected.Substring(1).Split(new[] { '|' }, 2);
            var ex = Assert.Throws<BridgeException>(() => StReader.Read(text, kind, owner));
            Assert.Equal(BridgeErrorCodes.InvalidSt, ex.ErrorCode);
            Assert.True(ex.Message.Contains($"'{owner}', {parts[0]}") && ex.Message.Contains(parts[1]),
                $"{row}: expected a refusal naming '{owner}', {parts[0]} and '{parts[1]}', got: {ex.Message}");
            return;
        }

        var item = StReader.Read(text, kind, owner);
        var want = expected.Split(',');
        Assert.True(want.Length == item.Members.Count,
            $"{row}: expected {expected}, got {string.Join(",", item.Members.Select(m => $"{m.Kind}:{m.Name}"))}");
        for (int i = 0; i < want.Length; i++)
        {
            var w = want[i];
            string? first = null, type = null;
            var bracket = w.IndexOf('[');
            if (bracket >= 0) { first = w.Substring(bracket + 1, w.Length - bracket - 2); w = w.Substring(0, bracket); }
            var eq = w.IndexOf('=');
            if (eq >= 0) { type = w.Substring(eq + 1); w = w.Substring(0, eq); }
            var m = item.Members[i];
            Assert.Equal(w, $"{m.Kind}:{m.Name}");
            if (type is not null) Assert.Equal(type, m.ReturnType ?? m.DataType);
            if (first is not null) Assert.Equal(first, m.Declaration.Replace("\r", "").Split('\n')[0]);
        }
    }

    /// <summary>The bodies of the rows whose END line hides in a comment: the member ends at its REAL END line, so the
    /// comment and the code after it stay in its body.</summary>
    [Theory]
    [InlineData("METHOD M : INT\nIMPLEMENTATION ST\n(* a (* b *)\nEND_METHOD\n*)\nM := 1;\nEND_METHOD\n", "(* a (* b *)\nEND_METHOD\n*)\nM := 1;")]
    [InlineData("METHOD M : INT\nIMPLEMENTATION ST\nM := 1; (* note\nEND_METHOD\n*)\nM := 2;\nEND_METHOD\n", "M := 1; (* note\nEND_METHOD\n*)\nM := 2;")]
    [InlineData("METHOD M : INT\nIMPLEMENTATION ST\nM := 1; (* never closed\nEND_METHOD\n", "M := 1; (* never closed")]
    public void A_member_ends_at_its_real_END_line(string region, string body)
    {
        var item = StReader.Read(Fb + region, ItemKind.Kinds.Pou, "FB");
        Assert.Equal(body, ImplementationMarker.Split(Assert.Single(item.Members).Body).Code);
    }

    /// <summary>The POU's own END line is held to the same rule: after code on its line it is refused naming the line,
    /// never searched for further down.</summary>
    /// <summary>Nor may anything else stand beside the outer END: the IDE stores no END line, so a comment there would
    /// be dropped in silence.</summary>
    [Theory]
    [InlineData("FUNCTION_BLOCK FB\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK (* note *)\n", "pou", "'FB', line 6")]
    [InlineData("FUNCTION_BLOCK FB\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK // note\n", "pou", "'FB', line 6")]
    [InlineData("INTERFACE FB\nMETHOD A : INT\nEND_METHOD\nEND_INTERFACE // note\n", "interface", "'FB', line 4")]
    public void Text_beside_the_outer_END_is_refused_naming_the_line(string text, string kind, string line)
    {
        var ex = Assert.Throws<BridgeException>(() => StReader.Read(text, kind, "FB"));
        Assert.Contains(line, ex.Message);
        Assert.Contains("holds its END keyword alone", ex.Message);
    }

    /// <summary>An item NAMED after its own outer END keyword: the word stands in the header's NAME position, where it is
    /// the name (openspec push-keeps-what-landed 3.G). It used to be refused INVALID_ST "stands after code", a diagnosis of
    /// a mistake the text does not hold; the IDE answers for the name itself.</summary>
    [Theory]
    [InlineData("FUNCTION_BLOCK END_FUNCTION_BLOCK\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK\n", "pou")]
    [InlineData("PROGRAM End_Program\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_PROGRAM\n", "pou")]
    [InlineData("FUNCTION END_FUNCTION : INT\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION\n", "pou")]
    [InlineData("FUNCTION_BLOCK PUBLIC END_FUNCTION_BLOCK\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK\n", "pou")]
    [InlineData("INTERFACE END_INTERFACE\nMETHOD A : INT\nEND_METHOD\nEND_INTERFACE\n", "interface")]
    public void An_item_named_after_its_outer_END_keyword_reads(string text, string kind)
    {
        var item = StReader.Read(text, kind, "X");
        Assert.StartsWith(text.Substring(0, text.IndexOf('\n')), item.Declaration);
    }

    [Fact]
    public void An_item_named_after_its_outer_END_keyword_still_refuses_that_END_after_code()
    {
        var ex = Assert.Throws<BridgeException>(() =>
            StReader.Read("FUNCTION_BLOCK END_FUNCTION_BLOCK END_FUNCTION_BLOCK\n", ItemKind.Kinds.Pou, "X"));
        Assert.Contains("'X', line 1", ex.Message);
        Assert.Contains("END_FUNCTION_BLOCK stands after code", ex.Message);
    }

    [Fact]
    public void The_outer_END_after_code_on_its_line_is_refused_naming_the_line()
    {
        var ex = Assert.Throws<BridgeException>(() =>
            StReader.Read("FUNCTION_BLOCK FB\nVAR\nEND_VAR\nIMPLEMENTATION ST\nx := 1; END_FUNCTION_BLOCK\n", ItemKind.Kinds.Pou, "FB"));
        Assert.Contains("'FB', line 5", ex.Message);
        Assert.Contains("END_FUNCTION_BLOCK", ex.Message);
    }
}
