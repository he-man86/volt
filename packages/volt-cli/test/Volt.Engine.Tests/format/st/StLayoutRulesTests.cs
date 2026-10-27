using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// The writer's output is the layout <c>wire.html#layout</c> states (openspec <c>wire-final-shape</c> 4.3d): every row of
/// <see cref="StLayoutRules"/> holds on <c>StWriter.Write</c> of its example and refuses its non-canonical variant, and a
/// push of that variant does what the row says (comes back canonical, comes back as pushed, or is refused) — a client
/// compares a pushed text against the fetched one or against these rules, never byte for byte against what it sent.
/// </summary>
public class StLayoutRulesTests
{
    public static IEnumerable<object[]> Ids => StLayoutRules.Rows.Select(r => new object[] { r.Id });

    private static StLayoutRules.Row RowOf(string id) => StLayoutRules.Rows.Single(r => r.Id == id);

    [Theory]
    [MemberData(nameof(Ids))]
    public void The_writer_follows_the_rule(string id)
    {
        var row = RowOf(id);
        Assert.True(row.Holds(StWriter.Write(row.Example)), $"{id}: the writer no longer writes: {row.Rule}");
    }

    [Theory]
    [MemberData(nameof(Ids))]
    public void The_rule_refuses_a_non_canonical_text(string id)
    {
        var row = RowOf(id);
        var text = StWriter.Write(row.Example);
        var variant = row.Break(text);
        Assert.NotEqual(text, variant);
        Assert.False(row.Holds(variant), $"{id}: the rule does not tell its own non-canonical variant apart");
    }

    /// <summary>The row's <c>push</c> column on <c>wire.html#layout</c> is what a push of its variant does: the variant
    /// read back and written again is the canonical text, or the variant itself, or the reader refuses it
    /// <c>INVALID_ST</c>.</summary>
    [Theory]
    [MemberData(nameof(Ids))]
    public void A_push_that_breaks_the_rule_does_what_the_row_says(string id)
    {
        var row = RowOf(id);
        var text = StWriter.Write(row.Example);
        var variant = row.Break(text);
        if (row.Push == StLayoutRules.PushOutcome.Refused)
        {
            var ex = Assert.Throws<BridgeException>(() => StReader.Read(variant, row.Example.Kind, "a"));
            Assert.Equal(BridgeErrorCodes.InvalidSt, ex.ErrorCode);
            return;
        }
        var back = StWriter.Write(StReader.Read(variant, row.Example.Kind, "a"));
        Assert.Equal(row.Push == StLayoutRules.PushOutcome.Canonical ? text : variant, back);
    }

    /// <summary>The <c>lf</c> rule holds on a FETCH too: a CR the IDE already holds (a CRLF declaration pushed before the
    /// reader normalised every kind still holds <c>END_VAR\r</c>) is written as a line end, wherever it stands — in a
    /// string or a comment too.</summary>
    [Theory]
    [InlineData("gvl", "VAR_GLOBAL\nEND_VAR\r", null, "VAR_GLOBAL\nEND_VAR\n\n")]
    [InlineData("gvl", "VAR_GLOBAL\r\n\ts : STRING := 'x\ry';\r\nEND_VAR", null, "VAR_GLOBAL\n\ts : STRING := 'x\ny';\nEND_VAR\n")]
    [InlineData("dut", "TYPE E :\r(a, b);\rEND_TYPE", null, "TYPE E :\n(a, b);\nEND_TYPE\n")]
    [InlineData("pou", "PROGRAM b\r\nVAR\r\nEND_VAR", "b := 1; (* x\ry *)\r\n",
        "PROGRAM b\nVAR\nEND_VAR\n%LANGUAGE ST\nb := 1; (* x\ny *)\n\n\nEND_PROGRAM\n")]
    public void A_CR_the_IDE_holds_is_fetched_as_LF(string kind, string declaration, string? body, string fetched)
    {
        var text = StWriter.Write(new ItemContent(kind, declaration, body, new(), ObjectProperties.None));
        Assert.True(RowOf("lf").Holds(text), text);
        Assert.Equal(fetched, text);
    }

    [Fact]
    public void A_CR_a_member_holds_is_fetched_as_LF()
    {
        var text = StWriter.Write(new ItemContent(ItemKind.Kinds.Pou, "FUNCTION_BLOCK a", "", new()
        {
            new Member(ItemKind.Kinds.Method, "m", "METHOD m : BOOL\r\nVAR\rEND_VAR", "m := TRUE;\r", ObjectProperties.None),
            new Member(ItemKind.Kinds.Property, "p", "PROPERTY p : BOOL", null, ObjectProperties.None,
                Getter: new Accessor("VAR\r\nEND_VAR", "p := TRUE;\r\n")),
        }, ObjectProperties.None));
        Assert.DoesNotContain('\r', text);
        Assert.Contains("METHOD m : BOOL\nVAR\nEND_VAR\n%LANGUAGE ST\nm := TRUE;\n\nEND_METHOD", text);
    }

    /// <summary>Texts that differ from the canonical one in layout only, beyond each row's own variant: every one is
    /// accepted and comes back canonical, so a reader change that began refusing or misreading one turns red here.
    /// Keyed by name; the value is (the text pushed, its kind, the canonical text).</summary>
    private static readonly Dictionary<string, (string Pushed, string Kind, string Canonical)> LayoutVariants = new()
    {
        ["no final LF"] = ("PROGRAM b\n%LANGUAGE ST\nb := 1;\n\nEND_PROGRAM", ItemKind.Kinds.Pou,
            "PROGRAM b\n%LANGUAGE ST\nb := 1;\n\nEND_PROGRAM\n"),
        ["extra LFs after the END line"] = ("PROGRAM b\n%LANGUAGE ST\nb := 1;\n\nEND_PROGRAM\n\n\n", ItemKind.Kinds.Pou,
            "PROGRAM b\n%LANGUAGE ST\nb := 1;\n\nEND_PROGRAM\n"),
        ["no blank line before a member"] = (
            "FUNCTION_BLOCK a\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\nMETHOD m : BOOL\n%LANGUAGE ST\nEND_METHOD\n",
            ItemKind.Kinds.Pou,
            "FUNCTION_BLOCK a\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\nMETHOD m : BOOL\n%LANGUAGE ST\nEND_METHOD\n"),
        ["two blank lines before a member"] = (
            "FUNCTION_BLOCK a\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\n\nMETHOD m : BOOL\n%LANGUAGE ST\nEND_METHOD\n",
            ItemKind.Kinds.Pou,
            "FUNCTION_BLOCK a\n%LANGUAGE ST\n\nEND_FUNCTION_BLOCK\n\nMETHOD m : BOOL\n%LANGUAGE ST\nEND_METHOD\n"),
        ["empty body, no blank line before END"] = ("PROGRAM b\n%LANGUAGE ST\nEND_PROGRAM\n", ItemKind.Kinds.Pou,
            "PROGRAM b\n%LANGUAGE ST\n\nEND_PROGRAM\n"),
        ["interface members with no blank lines"] = ("INTERFACE I\nMETHOD m : BOOL\nEND_METHOD\nEND_INTERFACE\n",
            ItemKind.Kinds.Interface, "INTERFACE I\n\nMETHOD m : BOOL\nEND_METHOD\n\nEND_INTERFACE\n"),
        ["CRLF POU"] = ("PROGRAM b\r\n%LANGUAGE ST\r\nb := 1;\r\n\r\nEND_PROGRAM\r\n", ItemKind.Kinds.Pou,
            "PROGRAM b\n%LANGUAGE ST\nb := 1;\n\nEND_PROGRAM\n"),
        ["CR POU"] = ("PROGRAM b\r%LANGUAGE ST\rb := 1;\r\rEND_PROGRAM\r", ItemKind.Kinds.Pou,
            "PROGRAM b\n%LANGUAGE ST\nb := 1;\n\nEND_PROGRAM\n"),
        ["CRLF GVL"] = ("VAR_GLOBAL\r\n\ta : INT;\r\nEND_VAR\r\n", ItemKind.Kinds.Gvl, "VAR_GLOBAL\n\ta : INT;\nEND_VAR\n"),
        ["CR GVL"] = ("VAR_GLOBAL\r\ta : INT;\rEND_VAR\r", ItemKind.Kinds.Gvl, "VAR_GLOBAL\n\ta : INT;\nEND_VAR\n"),
        ["CRLF DUT with a %-line"] = ("TYPE E :\r\n(a, b);\r\nEND_TYPE\r\n%EXCLUDE_FROM_BUILD\r\n", ItemKind.Kinds.Dut,
            "TYPE E :\n(a, b);\nEND_TYPE\n%EXCLUDE_FROM_BUILD\n"),
    };

    public static IEnumerable<object[]> LayoutVariantNames => LayoutVariants.Keys.Select(k => new object[] { k });

    [Theory]
    [MemberData(nameof(LayoutVariantNames))]
    public void A_layout_only_text_is_accepted_and_comes_back_canonical(string name)
    {
        var (pushed, kind, canonical) = LayoutVariants[name];
        Assert.Equal(canonical, StWriter.Write(StReader.Read(pushed, kind, "a")));
    }

    /// <summary>A line ending is LF on the way in, for EVERY kind: the text the IDE receives holds no CR — a GVL's and a
    /// DUT's declaration as much as a POU's (a CR kept there reached the IDE as <c>END_VAR\r</c>).</summary>
    [Theory]
    [InlineData("VAR_GLOBAL\r\n\ta : INT;\r\nEND_VAR\r\n", "gvl")]
    [InlineData("TYPE E :\r\n(a, b);\r\nEND_TYPE\r\n", "dut")]
    [InlineData("TYPE E :\r(a, b);\rEND_TYPE\r", "dut")]
    [InlineData("FUNCTION_BLOCK a\r\nVAR\r\n\tx : INT;\r\nEND_VAR\r\n%LANGUAGE ST\r\nx := 1;\r\n\r\nEND_FUNCTION_BLOCK\r\n", "pou")]
    public void The_text_read_holds_no_CR(string pushed, string kind)
    {
        var read = StReader.Read(pushed, kind, "a");
        Assert.DoesNotContain('\r', read.Declaration);
        Assert.DoesNotContain('\r', read.Body ?? "");
    }

    /// <summary>A declaration's own trailing newlines are the item's (<c>verbatim</c>), so the general rule holds around
    /// them: the written text is the declaration and one LF.</summary>
    [Theory]
    [InlineData("VAR_GLOBAL\n\ta : INT;\nEND_VAR\n")]
    [InlineData("VAR_GLOBAL\n\ta : INT;\nEND_VAR\n\n")]
    public void The_lf_rule_holds_on_a_declaration_with_its_own_trailing_newlines(string declaration)
    {
        var text = StWriter.Write(new ItemContent(ItemKind.Kinds.Gvl, declaration, null, new(), ObjectProperties.None));
        Assert.True(RowOf("lf").Holds(text), text);
        Assert.Equal(declaration + "\n", text);
    }

    [Fact]
    public void Every_row_has_its_own_id() =>
        Assert.Equal(StLayoutRules.Rows.Count, StLayoutRules.Rows.Select(r => r.Id).Distinct().Count());
}
