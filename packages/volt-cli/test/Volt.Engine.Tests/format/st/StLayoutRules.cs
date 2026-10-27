using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Item;

namespace Volt.Engine.Tests;

/// <summary>
/// THE CANONICAL LAYOUT, as rows (openspec <c>wire-final-shape</c> 4.3d): every rule <c>StWriter</c> applies when it
/// writes an item's text, so a client can predict from <c>wire.html#layout</c> alone what a <c>fetch</c> returns for what
/// it pushed. Each row is one sentence, one made-up example, the rule as a predicate on the written text, and a hand-made
/// non-canonical variant of that text the predicate must refuse.
/// <para><c>DocDataTests</c> renders each row's example as <c>StWriter.Write(Example)</c> into <c>docs/assets/data.js</c>
/// (the doc cannot drift from the writer); <c>StLayoutRulesTests</c> holds every predicate on that text and refuses every
/// variant (the rule bites). A new writer rule without a row is caught by review: the writer has no rule list to count.</para>
/// </summary>
public static class StLayoutRules
{
    /// <param name="Id">The row's anchor on the page.</param>
    /// <param name="Rule">The rule, one sentence.</param>
    /// <param name="Example">What the writer writes; the page shows <c>StWriter.Write(Example)</c>.</param>
    /// <param name="Holds">The rule, on the written text.</param>
    /// <param name="Break">A non-canonical variant of the written text — what a client may push, and what the rule is not.</param>
    /// <param name="Push">What a push of a text that breaks the rule does — <see cref="Break"/>'s variant read back and
    /// written again, pinned per row by <c>StLayoutRulesTests</c>.</param>
    public sealed record Row(string Id, string Rule, ItemContent Example, Func<string, bool> Holds, Func<string, string> Break,
        PushOutcome Push);

    /// <summary>What a push of a text that breaks a row does: the text is accepted and comes back in the layout
    /// (<see cref="PushOutcome.Canonical"/>); or what breaks the rule is the item's own text, accepted and fetched as
    /// pushed (<see cref="PushOutcome.Kept"/>); or the rule is structure the reader needs, and the push is refused
    /// <c>INVALID_ST</c> (<see cref="PushOutcome.Refused"/>).</summary>
    public enum PushOutcome { Canonical, Kept, Refused }

    private static readonly ObjectProperties Excluded = ObjectProperties.None with { ExcludeFromBuild = true };

    private static Member Method(string name, string? body = "") =>
        new(ItemKind.Kinds.Method, name, $"METHOD {name} : BOOL", body, ObjectProperties.None);

    private static ItemContent Fb(string decl, string? body, params Member[] members) =>
        new(ItemKind.Kinds.Pou, decl, body, members.ToList(), ObjectProperties.None);

    private static string[] Lines(string text) => text.Split('\n');

    private static int At(string[] lines, string line) => Array.IndexOf(lines, line);

    /// <summary>The text's blank-line-separated blocks, two swapped (indices from the end).</summary>
    private static string SwapLastBlocks(string text)
    {
        var blocks = text.TrimEnd('\n').Split("\n\n");
        (blocks[^1], blocks[^2]) = (blocks[^2], blocks[^1]);
        return string.Join("\n\n", blocks) + "\n";
    }

    private static int KindRank(string header) =>
        header.StartsWith("METHOD ", StringComparison.Ordinal) ? 0
        : header.StartsWith("ACTION ", StringComparison.Ordinal) ? 1
        : 2;

    private static string NameOf(string header) => header.Split(' ', ':')[1];

    public static readonly IReadOnlyList<Row> Rows = new Row[]
    {
        new("lf",
            "Lines end in LF, and the file ends in one LF after the item's last character. A CR is a line end wherever it stands — in a comment or a string too — and comes back as LF.",
            new ItemContent(ItemKind.Kinds.Gvl, "VAR_GLOBAL\n\ta : INT;\nEND_VAR", null, new(), ObjectProperties.None),
            t => !t.Contains('\r') && t.EndsWith('\n'),
            t => t.Replace("\n", "\r\n"),
            // One rule on both sides (StReader.LfLines): the reader turns every CR into a line end, so the IDE receives
            // none, and the writer does the same with a CR the IDE already holds, so a fetch returns none.
            Push: PushOutcome.Canonical),

        new("declaration-only",
            "A GVL or a DUT is its declaration, then its %-lines.",
            new ItemContent(ItemKind.Kinds.Dut, "TYPE E :\n(a, b);\nEND_TYPE", null, new(), Excluded),
            t => Lines(t) is var l && l[^2] == "%EXCLUDE_FROM_BUILD" && l[^3] == "END_TYPE",
            t => "%EXCLUDE_FROM_BUILD\n" + t.Replace("%EXCLUDE_FROM_BUILD\n", ""),
            Push: PushOutcome.Refused),

        new("pou",
            "A POU is its declaration, its %LANGUAGE line, its %-lines, then its code.",
            new ItemContent(ItemKind.Kinds.Pou, "FUNCTION_BLOCK a\nVAR\n\tx : INT;\nEND_VAR", "x := 1;", new(), Excluded),
            t => Lines(t) is var l && At(l, "%LANGUAGE ST") is var i and > 0
                 && l[i - 1] == "END_VAR" && l[i + 1] == "%EXCLUDE_FROM_BUILD" && l[i + 2] == "x := 1;",
            t => t.Replace("%LANGUAGE ST\n%EXCLUDE_FROM_BUILD", "%EXCLUDE_FROM_BUILD\n%LANGUAGE ST"),
            Push: PushOutcome.Refused),

        new("end-line",
            "After the code, one blank line, then the END line that mirrors the header (END_PROGRAM, END_FUNCTION_BLOCK, END_FUNCTION).",
            Fb("PROGRAM b", "b := TRUE;"),
            t => t.EndsWith("b := TRUE;\n\nEND_PROGRAM\n", StringComparison.Ordinal),
            t => t.Replace("\n\nEND_PROGRAM", "\nEND_PROGRAM"),
            Push: PushOutcome.Canonical),

        new("members-below",
            "Each member of a POU follows its END line, after one blank line.",
            Fb("FUNCTION_BLOCK a", "", Method("m", "m := TRUE;")),
            t => Lines(t) is var l && At(l, "END_FUNCTION_BLOCK") is var e and > 0
                 && l[e + 1] == "" && l[e + 2] == "METHOD m : BOOL",
            t => t.Replace("END_FUNCTION_BLOCK\n\nMETHOD", "END_FUNCTION_BLOCK\nMETHOD"),
            Push: PushOutcome.Canonical),

        new("members-inside",
            "An interface's members sit inside its block, each after one blank line, and one blank line precedes END_INTERFACE.",
            new ItemContent(ItemKind.Kinds.Interface, "INTERFACE I", null,
                new() { new Member(ItemKind.Kinds.InterfaceMethod, "m", "METHOD m : BOOL", "", ObjectProperties.None) },
                ObjectProperties.None),
            t => t == "INTERFACE I\n\nMETHOD m : BOOL\nEND_METHOD\n\nEND_INTERFACE\n",
            t => "INTERFACE I\n\nEND_INTERFACE\n\nMETHOD m : BOOL\nEND_METHOD\n",
            Push: PushOutcome.Refused),

        new("member-order",
            "Members are ordered METHOD, ACTION, PROPERTY, and by name (ordinal: uppercase before lowercase) within a kind — whatever order was pushed.",
            Fb("FUNCTION_BLOCK a", "",
                new Member(ItemKind.Kinds.Property, "p", "PROPERTY p : BOOL", null, ObjectProperties.None,
                    Getter: new Accessor("", "p := TRUE;")),
                new Member(ItemKind.Kinds.Action, "x", "ACTION x", "", ObjectProperties.None),
                Method("b"), Method("a")),
            t =>
            {
                var heads = Lines(t).Where(l => l.StartsWith("METHOD ", StringComparison.Ordinal)
                    || l.StartsWith("ACTION ", StringComparison.Ordinal) || l.StartsWith("PROPERTY ", StringComparison.Ordinal)).ToList();
                var sorted = heads.OrderBy(KindRank).ThenBy(NameOf, StringComparer.Ordinal).ToList();
                return heads.Count == 4 && heads.SequenceEqual(sorted);
            },
            SwapLastBlocks,
            Push: PushOutcome.Canonical),

        new("member",
            "A POU's METHOD or ACTION is its declaration, its %LANGUAGE line, its %-lines, its code, then END_METHOD or END_ACTION on the next line: no blank line separates them, so a blank line pushed there is the code's own last line.",
            Fb("FUNCTION_BLOCK a", "",
                new Member(ItemKind.Kinds.Method, "m", "METHOD m : BOOL\nVAR_INPUT\n\tx : BOOL;\nEND_VAR", "m := x;", Excluded)),
            t => t.EndsWith("METHOD m : BOOL\nVAR_INPUT\n\tx : BOOL;\nEND_VAR\n%LANGUAGE ST\n%EXCLUDE_FROM_BUILD\nm := x;\nEND_METHOD\n",
                StringComparison.Ordinal),
            t => t.Replace("m := x;\nEND_METHOD", "m := x;\n\nEND_METHOD"),
            Push: PushOutcome.Kept),

        new("property",
            "A POU's PROPERTY is its declaration, its %-lines, GET then SET (each: keyword, declaration, %LANGUAGE line, code, END_GET / END_SET), then END_PROPERTY.",
            Fb("FUNCTION_BLOCK a", "",
                new Member(ItemKind.Kinds.Property, "p", "PROPERTY p : INT", null, ObjectProperties.None,
                    Getter: new Accessor("VAR\nEND_VAR", "p := 1;"), Setter: new Accessor("VAR\nEND_VAR", ";"))),
            t => Lines(t) is var l && At(l, "PROPERTY p : INT") is var p and > 0
                 && l[p + 1] == "GET" && At(l, "END_GET") is var g && l[g + 1] == "SET"
                 && At(l, "END_SET") is var s && l[s + 1] == "END_PROPERTY"
                 && l[p + 2] == "VAR" && l[p + 4] == "%LANGUAGE ST" && l[p + 5] == "p := 1;",
            t => t.Replace("GET\nVAR\nEND_VAR\n%LANGUAGE ST\np := 1;\nEND_GET\nSET\nVAR\nEND_VAR\n%LANGUAGE ST\n;\nEND_SET",
                "SET\nVAR\nEND_VAR\n%LANGUAGE ST\n;\nEND_SET\nGET\nVAR\nEND_VAR\n%LANGUAGE ST\np := 1;\nEND_GET"),
            Push: PushOutcome.Canonical),

        new("interface-member",
            "An interface's METHOD is its declaration, its %-lines, then END_METHOD; an interface PROPERTY's GET and SET are each keyword, declaration, END_GET / END_SET — no %LANGUAGE line and no code in either.",
            new ItemContent(ItemKind.Kinds.Interface, "INTERFACE I", null,
                new()
                {
                    new Member(ItemKind.Kinds.InterfaceMethod, "m", "METHOD m : BOOL", "", Excluded),
                    // An empty accessor declaration, the one both vendors take (TwinCAT refuses a non-empty one,
                    // DIALECT D21): every example is a text a client can push to either (layout-rows.test.ts).
                    new Member(ItemKind.Kinds.InterfaceProperty, "p", "PROPERTY p : INT", null, ObjectProperties.None,
                        Getter: new Accessor("", "")),
                },
                ObjectProperties.None),
            t => t == "INTERFACE I\n\nMETHOD m : BOOL\n%EXCLUDE_FROM_BUILD\nEND_METHOD\n\nPROPERTY p : INT\nGET\nEND_GET\nEND_PROPERTY\n\nEND_INTERFACE\n",
            t => t.Replace("METHOD m : BOOL\n", "METHOD m : BOOL\n%LANGUAGE ST\n"),
            Push: PushOutcome.Refused),

        new("verbatim",
            "Every other character is the item's own and comes back as pushed: inner blank lines, trailing whitespace, and the trailing newlines a declaration or a body ends with (each then followed by the line the layout puts after it).",
            Fb("FUNCTION_BLOCK a\n", "x := 1;  \n\n\ny := 2;\n"),
            t => t == "FUNCTION_BLOCK a\n\n%LANGUAGE ST\nx := 1;  \n\n\ny := 2;\n\n\nEND_FUNCTION_BLOCK\n",
            t => t.Replace("FUNCTION_BLOCK a\n\n", "FUNCTION_BLOCK a\n").Replace("x := 1;  \n\n\ny := 2;\n\n", "x := 1;\ny := 2;\n"),
            Push: PushOutcome.Kept),
    };
}
