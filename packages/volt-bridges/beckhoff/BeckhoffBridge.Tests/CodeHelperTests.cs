using BeckhoffBridge.Helpers;
using Xunit;

namespace BeckhoffBridge.Tests;

/// <summary>
/// Regression tests for CodeHelper.ParseCodeHeader. Cases mirror
/// bridges/test_code_parser.py — the Python suite anchors the same
/// behavior on the CODESYS side; this xUnit suite gives us parity on
/// the Beckhoff bridge so a regression in either language gets caught
/// locally instead of via a flaky integration test in CI.
///
/// The crown jewel here is the stacked-modifier METHOD coverage — the
/// April 2026 chat-afa87d2c incident where the bridge rejected
/// `METHOD PROTECTED FINAL Execute` because the regex only allowed
/// one access modifier. Every patch against any FB containing such a
/// method failed at re-parse time. Lock those cases down.
/// </summary>
public class CodeHelperTests
{
	// ─── METHOD: stacked modifiers ─────────────────────────────────────

	[Fact]
	public void Method_With_Two_Stacked_Modifiers()
	{
		var h = CodeHelper.ParseCodeHeader("METHOD PROTECTED FINAL Execute");
		Assert.Equal("method", h.Type);
		Assert.Equal("Execute", h.Name);
		Assert.Equal("PROTECTED", h.AccessModifier);
		Assert.Null(h.ReturnType);
	}

	[Fact]
	public void Method_With_Single_Modifier_And_Return_Type()
	{
		var h = CodeHelper.ParseCodeHeader("METHOD PUBLIC Foo : BOOL");
		Assert.Equal("method", h.Type);
		Assert.Equal("Foo", h.Name);
		Assert.Equal("PUBLIC", h.AccessModifier);
		Assert.Equal("BOOL", h.ReturnType);
	}

	[Fact]
	public void Method_With_No_Modifier()
	{
		var h = CodeHelper.ParseCodeHeader("METHOD Bar");
		Assert.Equal("method", h.Type);
		Assert.Equal("Bar", h.Name);
		Assert.Null(h.AccessModifier);
	}

	[Fact]
	public void Method_With_Three_Stacked_Modifiers_And_Return_Type()
	{
		var h = CodeHelper.ParseCodeHeader("METHOD PUBLIC ABSTRACT FINAL Baz : INT");
		Assert.Equal("method", h.Type);
		Assert.Equal("Baz", h.Name);
		Assert.Equal("PUBLIC", h.AccessModifier);
		Assert.Equal("INT", h.ReturnType);
	}

	[Fact]
	public void Method_Lowercase_Header()
	{
		var h = CodeHelper.ParseCodeHeader("method protected final Execute");
		Assert.Equal("method", h.Type);
		Assert.Equal("Execute", h.Name);
		Assert.Equal("PROTECTED", h.AccessModifier);
	}

	[Fact]
	public void Method_Stacked_With_Return_Type()
	{
		var h = CodeHelper.ParseCodeHeader("METHOD PROTECTED FINAL Init : BOOL");
		Assert.Equal("method", h.Type);
		Assert.Equal("Init", h.Name);
		Assert.Equal("PROTECTED", h.AccessModifier);
		Assert.Equal("BOOL", h.ReturnType);
	}

	[Fact]
	public void Method_With_Complex_Array_Return_Type()
	{
		var h = CodeHelper.ParseCodeHeader("METHOD PUBLIC GetBuffer : ARRAY[0..15] OF BYTE");
		Assert.Equal("method", h.Type);
		Assert.Equal("GetBuffer", h.Name);
		Assert.Equal("PUBLIC", h.AccessModifier);
		Assert.Equal("ARRAY[0..15] OF BYTE", h.ReturnType);
	}

	// ─── Other POU/Child kinds ─────────────────────────────────────────

	[Fact]
	public void FunctionBlock_Header()
	{
		var h = CodeHelper.ParseCodeHeader("FUNCTION_BLOCK FB_Motor");
		Assert.Equal("function_block", h.Type);
		Assert.Equal("FB_Motor", h.Name);
	}

	[Fact]
	public void Program_Header()
	{
		var h = CodeHelper.ParseCodeHeader("PROGRAM PRG_Main");
		Assert.Equal("program", h.Type);
		Assert.Equal("PRG_Main", h.Name);
	}

	[Fact]
	public void Function_With_Return_Type()
	{
		var h = CodeHelper.ParseCodeHeader("FUNCTION Add : INT");
		Assert.Equal("function", h.Type);
		Assert.Equal("Add", h.Name);
		Assert.Equal("INT", h.ReturnType);
	}

	[Fact]
	public void Property_With_Access_Modifier_And_Data_Type()
	{
		var h = CodeHelper.ParseCodeHeader("PROPERTY PUBLIC Foo : INT");
		Assert.Equal("property", h.Type);
		Assert.Equal("Foo", h.Name);
		Assert.Equal("PUBLIC", h.AccessModifier);
		Assert.Equal("INT", h.DataType);
	}

	[Fact]
	public void Property_Without_Access_Modifier()
	{
		var h = CodeHelper.ParseCodeHeader("PROPERTY Speed : REAL");
		Assert.Equal("property", h.Type);
		Assert.Equal("Speed", h.Name);
		Assert.Null(h.AccessModifier);
		Assert.Equal("REAL", h.DataType);
	}

	[Fact]
	public void Action_Header()
	{
		var h = CodeHelper.ParseCodeHeader("ACTION Idle");
		Assert.Equal("action", h.Type);
		Assert.Equal("Idle", h.Name);
	}

	[Fact]
	public void Interface_Header()
	{
		var h = CodeHelper.ParseCodeHeader("INTERFACE IMotor");
		Assert.Equal("interface", h.Type);
		Assert.Equal("IMotor", h.Name);
	}

	[Fact]
	public void VarGlobal_Header_Yields_Gvl_With_Null_Name()
	{
		var h = CodeHelper.ParseCodeHeader("VAR_GLOBAL");
		Assert.Equal("gvl", h.Type);
		Assert.Null(h.Name);
	}

	// ─── TYPE / DUT subtype detection ──────────────────────────────────

	[Fact]
	public void Type_Struct_Detected_As_Structure()
	{
		var h = CodeHelper.ParseCodeHeader("TYPE T_Pose : STRUCT\nx : REAL;\ny : REAL;\nEND_STRUCT\nEND_TYPE");
		Assert.Equal("structure", h.Type);
		Assert.Equal("T_Pose", h.Name);
	}

	[Fact]
	public void Type_Enum_Detected_As_Enumeration()
	{
		var h = CodeHelper.ParseCodeHeader("TYPE E_State : (Idle, Running)\nEND_TYPE");
		Assert.Equal("enumeration", h.Type);
		Assert.Equal("E_State", h.Name);
	}

	[Fact]
	public void Type_Union_Detected_As_Union()
	{
		var h = CodeHelper.ParseCodeHeader("TYPE T_Bytes : UNION\nasWord : WORD;\nEND_UNION\nEND_TYPE");
		Assert.Equal("union", h.Type);
		Assert.Equal("T_Bytes", h.Name);
	}

	[Fact]
	public void Type_Alias_Defaults_To_Alias()
	{
		var h = CodeHelper.ParseCodeHeader("TYPE T_Counter : INT END_TYPE");
		Assert.Equal("alias", h.Type);
		Assert.Equal("T_Counter", h.Name);
	}

	// ─── Header discovery: skip attributes/comments before the header ─

	[Fact]
	public void Skips_Attribute_Block_Before_Header()
	{
		var h = CodeHelper.ParseCodeHeader("{attribute 'qualified_only'}\nFUNCTION_BLOCK FB_X");
		Assert.Equal("function_block", h.Type);
		Assert.Equal("FB_X", h.Name);
	}

	[Fact]
	public void Skips_Line_Comment_Before_Header()
	{
		var h = CodeHelper.ParseCodeHeader("// top-of-file comment\nFUNCTION_BLOCK FB_X");
		Assert.Equal("function_block", h.Type);
		Assert.Equal("FB_X", h.Name);
	}

	[Fact]
	public void Skips_Block_Comment_Before_Header()
	{
		var h = CodeHelper.ParseCodeHeader("(* block comment *)\nFUNCTION_BLOCK FB_X");
		Assert.Equal("function_block", h.Type);
		Assert.Equal("FB_X", h.Name);
	}

	[Fact]
	public void Empty_Code_Throws_BadRequest()
	{
		Assert.Throws<BridgeException>(() => CodeHelper.ParseCodeHeader(""));
	}

	[Fact]
	public void Unknown_Header_Throws_BadRequest()
	{
		Assert.Throws<BridgeException>(() => CodeHelper.ParseCodeHeader("WAT THIS_IS_NOT_VALID"));
	}
}
