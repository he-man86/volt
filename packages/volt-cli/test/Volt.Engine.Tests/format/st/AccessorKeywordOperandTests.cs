using System.Linq;
using Xunit;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Volt.Contracts;

namespace Volt.Engine.Tests;

/// <summary>
/// `GET` / `SET` ARE LEGAL NAMES, so they are accessor keywords only outside an accessor's VAR blocks and its body — the
/// body running from its %LANGUAGE line to its own END_GET/END_SET, as every element's does (openspec
/// <c>lsp-accessor-keyword-at-line-start</c>). A field FB with <c>SET : POINTER TO …</c> and a setter line
/// <c>SET^.stri_Name := P;</c> read as a second SET accessor and was refused INVALID_ST — unreadable on pull, refused on push.
/// </summary>
public class AccessorKeywordOperandTests
{
    private const string Fb = "FUNCTION_BLOCK K\nVAR\n\tSET : POINTER TO INT;\nEND_VAR\n%LANGUAGE ST\nEND_FUNCTION_BLOCK\n\n";

    private static Member Property(string accessors) =>
        StReader.Read(Fb + "PROPERTY P : INT\n" + accessors + "END_PROPERTY\n", ItemKind.Kinds.Pou).Members.Single();

    [Theory]
    [InlineData("SET^ := P;")]
    [InlineData("SET^.x := P;")]
    [InlineData("SET := P;")]
    [InlineData("SET.x := P;")]
    [InlineData("SET[1] := P;")]
    [InlineData("SET(IN := P);")]
    [InlineData("SET\t:= P;")]
    public void A_setter_body_line_starting_with_SET_as_an_operand_stays_in_the_body(string line)
    {
        var p = Property("SET\n%LANGUAGE ST\n" + line + "\nEND_SET\n");

        Assert.Equal(line, p.Setter!.Body.Trim());
        Assert.Null(p.Getter);
    }

    [Fact]
    public void A_getter_body_line_starting_with_GET_as_an_operand_stays_in_the_body()
    {
        var p = Property("GET\n%LANGUAGE ST\nGET.x := 1;\nP := 1;\nEND_GET\n");

        Assert.Equal("GET.x := 1;\nP := 1;", p.Getter!.Body.Trim().Replace("\r\n", "\n"));
        Assert.Null(p.Setter);
    }

    [Fact]
    public void A_SET_declared_in_an_accessors_VAR_block_is_a_declaration_not_an_accessor()
    {
        var p = Property("GET\nVAR\nSET : INT;\nEND_VAR\n%LANGUAGE ST\nP := SET;\nEND_GET\n");

        Assert.Contains("SET : INT;", p.Getter!.Declaration);
        Assert.Equal("P := SET;", p.Getter.Body.Trim());
        Assert.Null(p.Setter);
    }

    [Fact]
    public void The_field_shape_both_accessors_read()
    {
        var p = Property("GET\n%LANGUAGE ST\nP := SET^;\nEND_GET\nSET\n%LANGUAGE ST\nSET^ := P;\nEND_SET\n");

        Assert.Equal("P := SET^;", p.Getter!.Body.Trim());
        Assert.Equal("SET^ := P;", p.Setter!.Body.Trim());
    }

    [Fact]
    public void A_SET_line_alone_inside_a_getter_body_is_body_text()
    {
        // Not valid ST, but the splitter's job is structure: inside a body only END_GET closes, and the IDE's compiler
        // reports the statement — the reader does not take it for an accessor and drop the getter's tail.
        var ex = Assert.Throws<BridgeException>(() => Property("GET\n%LANGUAGE ST\nP := 1;\nSET\n"));

        Assert.Contains("GET starting at line", ex.Message);
    }

    // ── an accessor body runs to its own END line ─────────────────────────────────────────────────────

    [Theory]
    [InlineData("GET\n%LANGUAGE ST\nP := 1;\n", "END_PROPERTY reached while the GET")]
    [InlineData("GET\n%LANGUAGE ST\nP := 1;\nSET\n%LANGUAGE ST\nx := P;\nEND_SET\n", "END_SET reached while the GET")]
    public void A_body_that_never_reaches_its_END_line_is_refused_naming_both_lines(string accessors, string message)
    {
        var ex = Assert.Throws<BridgeException>(() => Property(accessors));

        Assert.Equal(BridgeErrorCodes.InvalidSt, ex.ErrorCode);
        Assert.Contains(message, ex.Message);
    }

    // ── controls: real accessor keyword lines keep today's meaning ────────────────────────────────────

    [Fact]
    public void A_bare_GET_is_still_closed_by_the_next_SET()
    {
        var p = Property("GET\nSET\n%LANGUAGE ST\nSET^ := P;\nEND_SET\n");

        Assert.Equal(StatedLanguage.NoSlot, p.Getter!.Stated);   // a bare GET states no line: no body slot
        Assert.Equal("SET^ := P;", p.Setter!.Body.Trim());
    }

    /// <summary>A comment or a word after the keyword keeps it an accessor keyword, and `RefuseTextAfter` still refuses the
    /// line (the IDE stores nothing after it) — the rule decides what IS an accessor line, not what may stand on one.</summary>
    [Theory]
    [InlineData("GET", " PUBLIC")]
    [InlineData("GET", " (* note *)")]
    [InlineData("SET", " // note")]
    public void A_word_or_comment_after_the_keyword_is_still_refused_as_text_after_it(string kw, string after)
    {
        var ex = Assert.Throws<BridgeException>(() =>
            Property(kw + after + "\n%LANGUAGE ST\nP := 1;\nEND_" + kw + "\n"));

        Assert.Equal(BridgeErrorCodes.InvalidSt, ex.ErrorCode);
        Assert.Contains("anything after " + kw, ex.Message);
    }
}
