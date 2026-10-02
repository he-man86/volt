using Volt.Engine;
using Xunit;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.St;

namespace Volt.Engine.Tests;

/// <summary>The header helpers that remain: <c>HeaderLine</c> (the TOTAL "which line is the header", read by
/// network-text scope alone — no kind or name is decided from it, gate <c>NoKindFromTextTests</c>) and <c>CodeOn</c>
/// (the per-line trivia scanner).
///
/// <para>The strict <c>ParseCodeHeader</c>, and every test of its CLASSIFICATION, are deleted with it: it classified a
/// PUSHED text by its header, and a push no longer reads a top-level item's header — the kind is the wire name's
/// extension (openspec <c>push-without-header-check</c>). The header SHAPES those tests covered — a comment before or
/// beside the keyword, a pragma, blank lines — are what <c>HeaderLine</c> is still asked about below.</para></summary>
public class CodeHelperTests
{
    // ---- a comment and the declaration on ONE line ----

    /// <summary>`(* doc *) FUNCTION_BLOCK FB` — the comment CLOSES and the declaration follows on the same line.
    /// That line is the header, and it was being skipped entirely.
    /// <para><c>HeaderLine</c> treated any line STARTING with <c>(*</c> as trivia, so it returned the NEXT line
    /// (<c>VAR</c>). The suite only ever covered the comment on its own line, which is the shape that works.</para>
    /// <para>It is not a parsing nicety. <c>CodesysTypeMap.LeadingKeyword</c> (deleted with push-without-header-check 5.Q) read exactly this line to classify
    /// an item, is TOTAL by design (the classifier must never throw mid-walk), and falls back to FUNCTION_BLOCK —
    /// so a PROGRAM written this way is reported as <c>function_block</c> on refs/fetch. That is the same failure
    /// the leading-<c>{attribute}</c> case was fixed for, arriving through the other kind of trivia.</para>
    /// <para>And the repo already disagreed with itself about it: <c>StReader</c>'s own scanner calls this line
    /// CODE (then its <c>ScanContext</c>; since push-without-header-check 5.E.1 <c>StTrivia</c>), which is correct. Two scanners, one question.</para></summary>
    [Theory]
    [InlineData("(* doc *) FUNCTION_BLOCK FB\nVAR\nEND_VAR", "FUNCTION_BLOCK FB")]
    [InlineData("(* a *) (* b *) PROGRAM P", "PROGRAM P")]
    [InlineData("(* multi\n   line *) INTERFACE ITest", "INTERFACE ITest")]
    [InlineData("{attribute 'x'}\n(* doc *) TYPE T :", "TYPE T :")]
    public void A_declaration_sharing_its_line_with_a_closing_comment_IS_the_header(string src, string expected) =>
        Assert.Equal(expected, CodeHelper.HeaderLine(src));

    // ── HeaderLine: TOTAL, so network-text scope can ask it of any callee's declaration without a throw ──
    // The CODESYS driver found its keyword with a bare TrimStart() + first-token read, which returns "" for any
    // declaration opening with a non-word character. A PROGRAM behind a pragma therefore fell to RefinePou's
    // FUNCTION_BLOCK default and was reported as `function_block` on refs/fetch. These pin the shared answer.

    [Theory]
    [InlineData("{attribute 'qualified_only'}\nPROGRAM Main\nVAR\nEND_VAR", "PROGRAM Main")]
    [InlineData("// what this does\nFUNCTION Add : INT\nVAR_INPUT\nEND_VAR", "FUNCTION Add : INT")]
    [InlineData("(* doc\n   spanning lines *)\nINTERFACE ITest", "INTERFACE ITest")]
    [InlineData("\n\n   \nPROGRAM Spaced", "PROGRAM Spaced")]
    [InlineData("PROGRAM Plain", "PROGRAM Plain")]
    [InlineData("{attribute 'qualified_only'}\n// note\nPROGRAM Main\nVAR\nEND_VAR", "PROGRAM Main")]
    public void HeaderLine_skips_pragmas_comments_and_blanks_to_the_real_header(string decl, string expected)
    {
        Assert.Equal(expected, CodeHelper.HeaderLine(decl));
    }

    /// <summary>A PRAGMA IS TRIVIA UP TO ITS `}`, the way a closed `(* … *)` is — code after it on the line is
    /// code. `CodeOn` called the whole line trivia, while the (since deleted) DUT subtype reader, needing
    /// `{attribute 'strict'} (A, B);` to read as an enumeration, carried a scanner of its own that resumed after
    /// the `}`: two answers to "where does the code start" for one line.</summary>
    [Theory]
    [InlineData("{attribute 'strict'} (A, B);", "(A, B);")]
    [InlineData("{attribute 'qualified_only'}", "")]
    [InlineData("{attribute 'a'} {attribute 'b'} PROGRAM P", "PROGRAM P")]
    [InlineData("{an unclosed pragma", "")]
    public void CodeOn_ends_a_pragma_at_its_closing_brace(string line, string code)
    {
        var inBlockComment = false;
        Assert.Equal(code, CodeHelper.CodeOn(line, ref inBlockComment));
        Assert.False(inBlockComment);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   \n\t\n")]
    [InlineData("{attribute 'x'}\n// only skippable lines\n(* and a comment *)")]
    public void HeaderLine_is_TOTAL_returning_empty_rather_than_throwing(string? decl)
    {
        // Load-bearing: the CODESYS tree walk's try/catch wraps only GetChildren, so a throw from the classifier
        // would abort WalkItems and with it every fetch/refs/init/push for the whole project.
        Assert.Equal("", CodeHelper.HeaderLine(decl));
    }
}
