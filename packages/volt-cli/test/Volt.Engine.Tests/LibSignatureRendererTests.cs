using System.Collections.Generic;
using Volt.Engine.Library;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// The library-signature renderer turns an extracted <see cref="LibSignature"/> into a minimal ST declaration.
/// The load-bearing case: CODESYS exposes a function's return value as an output pin named after the function
/// (with ReturnType empty — verified live against the language model). The renderer must lift that into the
/// declared return type and NOT emit it as a bogus self-named VAR_OUTPUT.
/// </summary>
public class LibSignatureRendererTests
{
    private static LibSignature Fn(string name, IReadOnlyList<LibVar> outputs, string? returnType) =>
        new(name, "lib", "Function", new LibVar[0], outputs, new LibVar[0], new LibVar[0], null, returnType);

    [Fact]
    public void Function_return_pin_named_after_function_becomes_the_return_type()
    {
        var r = LibSignatureRenderer.Render(Fn("GETVERSION", new[] { new LibVar("GETVERSION", "VERSION") }, null));
        Assert.NotNull(r);
        Assert.Equal(".fun", r!.Value.Ext);
        Assert.Equal("FUNCTION GETVERSION : VERSION\nEND_FUNCTION", r.Value.Text);
    }

    [Fact]
    public void Function_keeps_real_outputs_but_drops_the_self_named_return_pin()
    {
        var outs = new[] { new LibVar("GETX", "INT"), new LibVar("XERROR", "BOOL") };
        var r = LibSignatureRenderer.Render(Fn("GETX", outs, null));
        Assert.NotNull(r);
        Assert.Equal("FUNCTION GETX : INT\nVAR_OUTPUT\n\tXERROR : BOOL;\nEND_VAR\nEND_FUNCTION", r!.Value.Text);
    }

    [Fact]
    public void Function_prefers_explicit_return_type_when_present()
    {
        var r = LibSignatureRenderer.Render(Fn("F", new LibVar[0], "REAL"));
        Assert.Equal("FUNCTION F : REAL\nEND_FUNCTION", r!.Value.Text);
    }

    // A DUT ALIAS (CODESYS `Flags == "Alias"`, e.g. `TYPE HANDLE : __XWORD`) must render as an alias, NOT an
    // empty struct. The base can be a `__`-prefixed system type — emitted verbatim (the LSP resolves it).
    [Fact]
    public void Dut_alias_renders_as_an_alias_not_an_empty_struct()
    {
        var s = new LibSignature("HANDLE", "CAA Types", "Type",
            new LibVar[0], new LibVar[0], new LibVar[0], new LibVar[0], null, null, "__XWORD");
        var r = LibSignatureRenderer.Render(s);
        Assert.NotNull(r);
        Assert.Equal(".alias", r!.Value.Ext);
        Assert.Equal("TYPE HANDLE : __XWORD;\nEND_TYPE", r.Value.Text);
    }

    [Fact]
    public void Dut_without_alias_base_still_renders_as_a_struct()
    {
        var s = new LibSignature("PT", "lib", "Type",
            new LibVar[0], new LibVar[0], new LibVar[0], new[] { new LibVar("Lo", "INT"), new LibVar("Hi", "INT") }, null, null);
        var r = LibSignatureRenderer.Render(s);
        Assert.Equal(".struct", r!.Value.Ext);
        Assert.Equal("TYPE PT :\nSTRUCT\n\tLo : INT;\n\tHi : INT;\nEND_STRUCT\nEND_TYPE", r.Value.Text);
    }

    // A struct field named with a single letter X/B/W/D/L (a valid identifier — e.g. a Point's X/Y) must NOT be
    // dropped by the direct-address-prefix heuristic in OkName. Regression for the silent field-loss bug.
    [Fact]
    public void Single_letter_field_name_is_not_dropped()
    {
        var s = new LibSignature("POINT", "lib", "Type",
            new LibVar[0], new LibVar[0], new LibVar[0], new[] { new LibVar("X", "INT"), new LibVar("Y", "INT") }, null, null);
        var r = LibSignatureRenderer.Render(s);
        Assert.Equal("TYPE POINT :\nSTRUCT\n\tX : INT;\n\tY : INT;\nEND_STRUCT\nEND_TYPE", r!.Value.Text);
    }

    // Enum members carry their ordinal in LibVar.Initial and must render as `NAME := value` (e.g. error codes).
    [Fact]
    public void Enum_members_render_with_their_ordinal_values()
    {
        var members = new[]
        {
            new LibVar("UNKNOWN", "PERIODE", "0"), new LibVar("STANDARD", "PERIODE", "1"), new LibVar("DAYLIGHT", "PERIODE", "2"),
        };
        var s = new LibSignature("PERIODE", "lib", "VarGlobal",
            new LibVar[0], new LibVar[0], new LibVar[0], members, null, null);
        var r = LibSignatureRenderer.Render(s);
        Assert.Equal(".enum", r!.Value.Ext);
        Assert.Equal("TYPE PERIODE :\n(\n\tUNKNOWN := 0,\n\tSTANDARD := 1,\n\tDAYLIGHT := 2\n);\nEND_TYPE", r.Value.Text);
    }

    // A DUT with Flags "Union" renders as a UNION, not a struct.
    [Fact]
    public void Dut_union_renders_as_a_union()
    {
        var s = new LibSignature("U", "lib", "Type",
            new LibVar[0], new LibVar[0], new LibVar[0], new[] { new LibVar("asWord", "WORD"), new LibVar("asBytes", "ARRAY[0..1] OF BYTE") },
            null, null, null, "Union");
        var r = LibSignatureRenderer.Render(s);
        Assert.Equal(".union", r!.Value.Ext);
        Assert.Equal("TYPE U :\nUNION\n\tasWord : WORD;\n\tasBytes : ARRAY[0..1] OF BYTE;\nEND_UNION\nEND_TYPE", r.Value.Text);
    }
}
