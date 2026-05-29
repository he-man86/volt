using System.Linq;
using BeckhoffBridge.Helpers;
using Xunit;

namespace BeckhoffBridge.Tests;

/// <summary>
/// Tests for StSplitter — the bridge-side ST file partitioner that
/// recovers POU + children from the assembled `.st` text sent by the
/// agent. Foundation for the pushPou wire op.
/// </summary>
public class StSplitterTests
{
	private const string SIMPLE_FB =
@"FUNCTION_BLOCK FB_X
VAR
	iLocal : INT;
END_VAR

iLocal := iLocal + 1;

END_FUNCTION_BLOCK
";

	[Fact]
	public void Split_FB_with_only_var_section()
	{
		var r = StSplitter.SplitSt(SIMPLE_FB);
		Assert.Equal("function_block", r.PouKind);
		Assert.Equal("FB_X", r.PouName);
		Assert.Contains("VAR", r.PouDeclaration);
		Assert.Contains("END_VAR", r.PouDeclaration);
		Assert.Contains("iLocal := iLocal + 1;", r.PouImplementation);
		Assert.Empty(r.Children);
	}

	private const string FB_WITH_METHOD =
@"FUNCTION_BLOCK FB_X
VAR
	iLocal : INT;
END_VAR

iLocal := 1;

END_FUNCTION_BLOCK

METHOD Compute : BOOL
VAR_INPUT
	iDelta : INT;
END_VAR
iLocal := iLocal + iDelta;
Compute := TRUE;
END_METHOD
";

	[Fact]
	public void Split_FB_with_one_method()
	{
		var r = StSplitter.SplitSt(FB_WITH_METHOD);
		Assert.Single(r.Children);
		var m = r.Children[0];
		Assert.Equal("method", m.Kind);
		Assert.Equal("Compute", m.Name);
		Assert.Equal("BOOL", m.ReturnType);
		Assert.Contains("VAR_INPUT", m.Declaration);
		Assert.Contains("iDelta : INT;", m.Declaration);
		Assert.Contains("END_VAR", m.Declaration);
		Assert.Contains("Compute := TRUE;", m.Implementation);
	}

	private const string FB_WITH_ACCESS_MODIFIERS =
@"FUNCTION_BLOCK FB_X
END_FUNCTION_BLOCK

METHOD PROTECTED FINAL Execute : BOOL
END_METHOD
";

	[Fact]
	public void Split_method_with_stacked_access_modifiers()
	{
		var r = StSplitter.SplitSt(FB_WITH_ACCESS_MODIFIERS);
		var m = r.Children[0];
		Assert.Equal("Execute", m.Name);
		Assert.Equal("PROTECTED", m.AccessModifier);
		Assert.Equal("BOOL", m.ReturnType);
	}

	private const string FB_WITH_ACTION =
@"FUNCTION_BLOCK FB_X
END_FUNCTION_BLOCK

ACTION Reset
iLocal := 0;
END_ACTION
";

	[Fact]
	public void Split_FB_with_action()
	{
		var r = StSplitter.SplitSt(FB_WITH_ACTION);
		Assert.Single(r.Children);
		var a = r.Children[0];
		Assert.Equal("action", a.Kind);
		Assert.Equal("Reset", a.Name);
		Assert.Contains("iLocal := 0;", a.Implementation);
	}

	private const string FB_WITH_PROPERTY =
@"FUNCTION_BLOCK FB_X
VAR
	iLocal : INT;
END_VAR
END_FUNCTION_BLOCK

PROPERTY Speed : INT
GET
VAR
	iScale : INT := 1;
END_VAR
Speed := iLocal * iScale;
END_GET
SET
iLocal := Speed;
END_SET
END_PROPERTY
";

	[Fact]
	public void Split_FB_with_property_get_set()
	{
		var r = StSplitter.SplitSt(FB_WITH_PROPERTY);
		var p = r.Children[0];
		Assert.Equal("property", p.Kind);
		Assert.Equal("Speed", p.Name);
		Assert.Equal("INT", p.DataType);
		Assert.NotNull(p.Getter);
		Assert.NotNull(p.Setter);
		Assert.Contains("Speed := iLocal * iScale;", p.Getter!.Implementation);
		Assert.Contains("iLocal := Speed;", p.Setter!.Implementation);
	}

	private const string FB_WITH_PRAGMA_ON_METHOD =
@"FUNCTION_BLOCK FB_X
END_FUNCTION_BLOCK

{attribute 'monitoring' := 'variable'}
METHOD Compute : INT
END_METHOD
";

	[Fact]
	public void Split_pragma_above_method_stays_with_child()
	{
		var r = StSplitter.SplitSt(FB_WITH_PRAGMA_ON_METHOD);
		var m = r.Children[0];
		Assert.Equal("Compute", m.Name);
		// The pragma should be part of the declaration so it round-trips.
		Assert.Contains("monitoring", m.Declaration);
	}

	private const string FB_WITH_FOLDER_ANNOTATION =
@"FUNCTION_BLOCK FB_X
END_FUNCTION_BLOCK

METHOD Reset    (* folder: Modes *)
END_METHOD
";

	[Fact]
	public void Split_folder_annotation_extracted_from_signature()
	{
		var r = StSplitter.SplitSt(FB_WITH_FOLDER_ANNOTATION);
		var m = r.Children[0];
		Assert.Equal("Reset", m.Name);
		Assert.Equal("Modes", m.Folder);
	}

	private const string FB_NO_VAR_SECTION =
@"FUNCTION_BLOCK FB_X

END_FUNCTION_BLOCK
";

	[Fact]
	public void Split_FB_with_no_var_section()
	{
		var r = StSplitter.SplitSt(FB_NO_VAR_SECTION);
		Assert.Equal("FB_X", r.PouName);
		Assert.Contains("FUNCTION_BLOCK FB_X", r.PouDeclaration);
		Assert.Equal("", r.PouImplementation);
	}

	private const string INTERFACE_WITH_METHOD =
@"INTERFACE ITF_X
METHOD Compute : BOOL
VAR_INPUT
	iIn : INT;
END_VAR
END_METHOD
END_INTERFACE
";

	[Fact]
	public void Split_interface_with_method_signature()
	{
		var r = StSplitter.SplitSt(INTERFACE_WITH_METHOD);
		Assert.Equal("interface", r.PouKind);
		Assert.Single(r.Children);
		Assert.Equal("Compute", r.Children[0].Name);
		Assert.Equal("method", r.Children[0].Kind);
		// Interface methods have only declaration (signature + VAR
		// sections), no implementation body.
		Assert.Equal("", r.Children[0].Implementation);
		Assert.Contains("METHOD Compute", r.Children[0].Declaration);
		Assert.Contains("VAR_INPUT", r.Children[0].Declaration);
	}

	[Fact]
	public void Split_gvl_is_simple_blob()
	{
		var src = "{attribute 'qualified_only'}\nVAR_GLOBAL\n\tgFoo : INT;\nEND_VAR\n";
		var r = StSplitter.SplitSt(src);
		Assert.Equal("gvl", r.PouKind);
		Assert.Null(r.PouName);
		Assert.Contains("VAR_GLOBAL", r.PouDeclaration);
		Assert.Empty(r.Children);
	}

	[Fact]
	public void Split_dut_struct_is_simple_blob()
	{
		var src = "TYPE DUT_X :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n";
		var r = StSplitter.SplitSt(src);
		Assert.Equal("structure", r.PouKind);
		Assert.Equal("DUT_X", r.PouName);
		Assert.Empty(r.Children);
	}
}
