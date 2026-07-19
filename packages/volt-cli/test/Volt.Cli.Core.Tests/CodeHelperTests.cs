using Volt.Cli.Core;
using Volt.Cli.Core.Workspace.SourceText;
using Xunit;

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
}
