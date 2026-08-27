using Volt.Engine;
using Xunit;
using Volt.Engine.Source.Body;
using Volt.Engine.Source.Body.St;

namespace Volt.Cli.Tests;

/// <summary>ParseCodeHeader classifies an item from its DECLARATION using only the keyword + name — it requires
/// NOTHING after the name on the header line, so a `: type` / `EXTENDS Base :` tail that legally wraps onto the
/// next line (a real CODESYS export form) can never make a header unrecognizable. The bug that motivated this:
/// pro2193's Fanuc_* structs wrapped `EXTENDS … :` and were silently dropped from the pull (9 items).</summary>
public class CodeHelperTests
{
    private static (string Type, string? Name) Parse(string src)
    {
        var h = CodeHelper.ParseCodeHeader(src);
        return (h.Type, h.Name);
    }

    // ---- a comment and the declaration on ONE line ----

    /// <summary>`(* doc *) FUNCTION_BLOCK FB` — the comment CLOSES and the declaration follows on the same line.
    /// That line is the header, and it was being skipped entirely.
    /// <para><c>HeaderLine</c> treated any line STARTING with <c>(*</c> as trivia, so it returned the NEXT line
    /// (<c>VAR</c>) and <c>ParseCodeHeader</c> rejected it as INVALID_CODE_HEADER. The suite only ever covered the
    /// comment on its own line, which is the shape that works.</para>
    /// <para>It is not a parsing nicety. <c>CodesysTypeMap.LeadingKeyword</c> reads exactly this line to classify
    /// an item, is TOTAL by design (the classifier must never throw mid-walk), and falls back to FUNCTION_BLOCK —
    /// so a PROGRAM written this way is reported as <c>function_block</c> on refs/fetch. That is the same failure
    /// the leading-<c>{attribute}</c> case was fixed for, arriving through the other kind of trivia.</para>
    /// <para>And the repo already disagreed with itself about it: <c>StReader</c>'s own scanner calls this line
    /// CODE (<c>Text/StReader.cs</c>, <c>ScanContext.Update</c>), which is correct. Two scanners, one question.</para></summary>
    [Theory]
    [InlineData("(* doc *) FUNCTION_BLOCK FB\nVAR\nEND_VAR", "FUNCTION_BLOCK FB")]
    [InlineData("(* a *) (* b *) PROGRAM P", "PROGRAM P")]
    [InlineData("(* multi\n   line *) INTERFACE ITest", "INTERFACE ITest")]
    [InlineData("{attribute 'x'}\n(* doc *) TYPE T :", "TYPE T :")]
    public void A_declaration_sharing_its_line_with_a_closing_comment_IS_the_header(string src, string expected) =>
        Assert.Equal(expected, CodeHelper.HeaderLine(src));

    /// <summary>And it classifies — the consequence the line above only implies.</summary>
    [Fact]
    public void A_program_declared_after_an_inline_comment_is_a_program_not_a_function_block() =>
        Assert.Equal(("program", "P"), Parse("(* the main task *) PROGRAM P\nVAR\nEND_VAR"));

    // ---- the wrapping cases (the whole point of the structural fix) ----

    [Fact]
    public void Struct_with_wrapped_EXTENDS_and_colon_is_a_dut()   // verbatim pro2193 form
    {
        // A DUT is ONE wire kind `dut` — the header no longer carries the struct/enum/union/alias subkind.
        Assert.Equal(("dut", "Fanuc_PositionXYZWPR_Type"),
            Parse("TYPE Fanuc_PositionXYZWPR_Type\nEXTENDS Fanuc_PositionXYZ_Type :\nSTRUCT\n\trPosW\t: REAL;\nEND_STRUCT\nEND_TYPE\n"));
    }

    [Fact]
    public void Property_with_wrapped_type_is_a_property()   // used to THROW (colon required on the header line)
    {
        Assert.Equal(("property", "Position"), Parse("PROPERTY Position\n: INT\n"));
    }

    [Fact]
    public void Function_with_wrapped_return_type_is_a_function()
    {
        Assert.Equal(("function", "Compute"), Parse("FUNCTION Compute\n: REAL\nVAR_INPUT\n x : INT;\nEND_VAR"));
    }

    [Fact]
    public void Method_with_wrapped_return_type_is_a_method()
    {
        Assert.Equal(("method", "Step"), Parse("METHOD Step\n: BOOL\nVAR\nEND_VAR"));
    }

    [Fact]
    public void Enum_with_wrapped_colon_is_a_dut()
    {
        Assert.Equal(("dut", "Color"), Parse("TYPE Color\n: (Red, Green, Blue);\nEND_TYPE"));
    }

    // ---- same-line + modifier cases (no regressions) ----

    [Theory]
    [InlineData("FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR", "function_block", "FB_Motor")]
    [InlineData("FUNCTION_BLOCK FB_Base EXTENDS FB_Root IMPLEMENTS I1, I2\nVAR\nEND_VAR", "function_block", "FB_Base")]
    [InlineData("PROGRAM PLC_PRG\nVAR\nEND_VAR", "program", "PLC_PRG")]
    [InlineData("INTERFACE IThing EXTENDS IBase", "interface", "IThing")]
    [InlineData("FUNCTION Add : INT\nVAR_INPUT\nEND_VAR", "function", "Add")]
    [InlineData("ACTION DoWork", "action", "DoWork")]
    [InlineData("METHOD PUBLIC FINAL Run : BOOL", "method", "Run")]
    [InlineData("PROPERTY PROTECTED Speed : REAL", "property", "Speed")]
    [InlineData("TYPE Handle : __XWORD; END_TYPE", "dut", "Handle")]
    [InlineData("TYPE U : UNION\n a : INT;\nEND_UNION\nEND_TYPE", "dut", "U")]
    [InlineData("VAR_GLOBAL\n g : INT;\nEND_VAR", "gvl", null)]
    public void Same_line_and_modifier_headers_parse(string src, string type, string? name) =>
        Assert.Equal((type, name), Parse(src));

    [Fact]
    public void FunctionBlock_is_not_misread_as_a_function()   // FUNCTION_BLOCK checked before FUNCTION
    {
        Assert.Equal("function_block", Parse("FUNCTION_BLOCK FB\nVAR\nEND_VAR").Type);
    }

    [Fact]
    public void A_leading_comment_before_the_header_is_skipped()
    {
        Assert.Equal(("function_block", "FB"), Parse("(* doc *)\n// note\nFUNCTION_BLOCK FB\nVAR\nEND_VAR"));
    }

    [Fact]
    public void A_genuinely_unrecognized_header_still_throws()
    {
        Assert.Throws<BridgeException>(() => CodeHelper.ParseCodeHeader("NONSENSE Foo\n x := 1;"));
    }

    // ── HeaderLine: the TOTAL half, extracted so a classifier that must not throw can share it ──
    // The CODESYS driver found its keyword with a bare TrimStart() + first-token read, which returns "" for any
    // declaration opening with a non-word character. A PROGRAM behind a pragma therefore fell to RefinePou's
    // FUNCTION_BLOCK default and was reported as `function_block` on refs/fetch. These pin the shared answer.

    [Theory]
    [InlineData("{attribute 'qualified_only'}\nPROGRAM Main\nVAR\nEND_VAR", "PROGRAM Main")]
    [InlineData("// what this does\nFUNCTION Add : INT\nVAR_INPUT\nEND_VAR", "FUNCTION Add : INT")]
    [InlineData("(* doc\n   spanning lines *)\nINTERFACE ITest", "INTERFACE ITest")]
    [InlineData("\n\n   \nPROGRAM Spaced", "PROGRAM Spaced")]
    [InlineData("PROGRAM Plain", "PROGRAM Plain")]
    public void HeaderLine_skips_pragmas_comments_and_blanks_to_the_real_header(string decl, string expected)
    {
        Assert.Equal(expected, CodeHelper.HeaderLine(decl));
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

    [Fact]
    public void HeaderLine_and_ParseCodeHeader_agree_on_which_line_is_the_header()
    {
        // One question, one answer: the strict parser must select the SAME line the total helper does, or the
        // driver's classification and the workspace's materialization can disagree about the same declaration.
        const string decl = "{attribute 'qualified_only'}\n// note\nPROGRAM Main\nVAR\nEND_VAR";
        Assert.Equal("PROGRAM Main", CodeHelper.HeaderLine(decl));
        Assert.Equal(("program", "Main"), Parse(decl));
    }
}
