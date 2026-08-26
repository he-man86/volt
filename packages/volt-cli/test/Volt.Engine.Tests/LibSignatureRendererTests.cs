using System.Collections.Generic;
using Xunit;
using Volt.Engine.Library;
using Volt.Engine.Model;

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

    /// <summary>A library FUNCTION with NO return type — and no output named after itself — is SKIPPED, not
    /// thrown on.
    /// <para>This used to throw "has no readable return type — cannot render its signature", on the reading that
    /// such a signature meant an object-model version mismatch. Measured against a live SP21 compile context, it
    /// does not: `AppendErrorString` and `ConcatX` (analyzation 4.1.0.0) are real CODESYS OPERATORS — POUType
    /// `LanguageModel.Operator.Function`, `Flags` `None` — carrying two VAR_IN_OUT and no return at all. IEC has
    /// no void FUNCTION, so there is no honest text to emit for one.</para>
    /// <para>The throw was not a cheap failure. `ExtractLibrarySignatures` renders every signature in one pass
    /// during `fetch`, so ONE unrenderable operator aborted the whole thing: a project that referenced that
    /// library fetched 0 items instead of 593. The blast radius is what makes skipping right — `Render` already
    /// returns null for kinds it does not materialize, and `FetchService` tallies those as `lib-render-null`, so
    /// this is a counted drop rather than a silent one.</para>
    /// <para>Still NOT `?? "BOOL"`: inventing a return type would resolve and then lie at every call site. The
    /// choice here is between skipping and crashing, never between skipping and guessing.</para></summary>
    [Fact]
    public void Function_with_no_return_type_is_skipped_rather_than_throwing()
    {
        Assert.Null(LibSignatureRenderer.Render(Fn("APPENDERRORSTRING", new LibVar[0], null)));
    }

    /// <summary>And a function whose outputs simply do not include a self-named pin is the same case — the skip
    /// keys on "no return could be lifted", not on the pin list being empty.</summary>
    [Fact]
    public void Function_with_outputs_but_no_liftable_return_is_also_skipped()
    {
        var outs = new[] { new LibVar("STROLD", "STRING"), new LibVar("STRNEW", "STRING") };
        Assert.Null(LibSignatureRenderer.Render(Fn("CONCATX", outs, null)));
    }

    // A DUT ALIAS (CODESYS `Flags == "Alias"`, e.g. `TYPE HANDLE : __XWORD`) must render as an alias, NOT an
    // empty struct. The base can be a `__`-prefixed system type — emitted verbatim (the LSP resolves it).
    [Fact]
    public void Dut_alias_renders_as_an_alias_not_an_empty_struct()   // one `.dut`, alias body form
    {
        var s = new LibSignature("HANDLE", "CAA Types", "Type",
            new LibVar[0], new LibVar[0], new LibVar[0], new LibVar[0], null, null, "__XWORD");
        var r = LibSignatureRenderer.Render(s);
        Assert.NotNull(r);
        Assert.Equal(".dut", r!.Value.Ext);
        Assert.Equal("TYPE HANDLE : __XWORD;\nEND_TYPE", r.Value.Text);
    }

    [Fact]
    public void Dut_without_alias_base_still_renders_as_a_struct()
    {
        var s = new LibSignature("PT", "lib", "Type",
            new LibVar[0], new LibVar[0], new LibVar[0], new[] { new LibVar("Lo", "INT"), new LibVar("Hi", "INT") }, null, null);
        var r = LibSignatureRenderer.Render(s);
        Assert.Equal(".dut", r!.Value.Ext);
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
        Assert.Equal(".dut", r!.Value.Ext);
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
        Assert.Equal(".dut", r!.Value.Ext);
        Assert.Equal("TYPE U :\nUNION\n\tasWord : WORD;\n\tasBytes : ARRAY[0..1] OF BYTE;\nEND_UNION\nEND_TYPE", r.Value.Text);
    }

    // Methods fold into the parent as METHOD blocks after END_FUNCTION_BLOCK — the form the LSP binds as members
    // (without this a library FB's method call reads as unknown-member; the whole reason methods are extracted).
    [Fact]
    public void FunctionBlock_renders_its_methods_after_the_body()
    {
        var m = new LibMethod("SwitchUnitMode",
            new[] { new LibVar("NewMode", "STRING") }, new LibVar[0], new LibVar[0], "BOOL");
        var s = new LibSignature("UnitModeManager", "lib", "FunctionBlock",
            new LibVar[0], new LibVar[0], new LibVar[0], new LibVar[0], null, null, null, "", new[] { m });
        var r = LibSignatureRenderer.Render(s);
        Assert.Equal(".fb", r!.Value.Ext);
        Assert.Equal(
            "FUNCTION_BLOCK UnitModeManager\nEND_FUNCTION_BLOCK\n\n" +
            "METHOD SwitchUnitMode : BOOL\nVAR_INPUT\n\tNewMode : STRING;\nEND_VAR\nEND_METHOD",
            r.Value.Text);
    }

    [Fact]
    public void Interface_renders_its_methods()
    {
        var m = new LibMethod("Execute", new LibVar[0], new LibVar[0], new LibVar[0], null); // no return type
        var s = new LibSignature("ICommand", "lib", "Interface",
            new LibVar[0], new LibVar[0], new LibVar[0], new LibVar[0], null, null, null, "", new[] { m });
        var r = LibSignatureRenderer.Render(s);
        Assert.Equal(".itf", r!.Value.Ext);
        Assert.Equal("INTERFACE ICommand\nEND_INTERFACE\n\nMETHOD Execute\nEND_METHOD", r.Value.Text);
    }

    // The live shape (verified against CODESYS): a method's return is an output pin named after the method with
    // ReturnType empty — e.g. ABORTMODEL → Outputs=[ABORTMODEL:ERROR]. The renderer must lift it into the return
    // type and drop it from VAR_OUTPUT, identically to functions (the shared LiftReturn path).
    [Fact]
    public void Method_return_pin_named_after_the_method_becomes_the_return_type()
    {
        var m = new LibMethod("ABORTMODEL",
            new[] { new LibVar("XCOMMIT", "BOOL") },
            new[] { new LibVar("ABORTMODEL", "ERROR"), new LibVar("XDONE", "BOOL") }, // self-named pin + a real output
            new LibVar[0], null); // ReturnType empty — the pin carries it
        var s = new LibSignature("F", "lib", "FunctionBlock",
            new LibVar[0], new LibVar[0], new LibVar[0], new LibVar[0], null, null, null, "", new[] { m });
        var r = LibSignatureRenderer.Render(s);
        Assert.Equal(
            "FUNCTION_BLOCK F\nEND_FUNCTION_BLOCK\n\n" +
            "METHOD ABORTMODEL : ERROR\nVAR_INPUT\n\tXCOMMIT : BOOL;\nEND_VAR\nVAR_OUTPUT\n\tXDONE : BOOL;\nEND_VAR\nEND_METHOD",
            r!.Value.Text);
    }

    [Fact]
    public void FunctionBlock_without_methods_is_unchanged()
    {
        var s = new LibSignature("F", "lib", "FunctionBlock",
            new LibVar[0], new LibVar[0], new LibVar[0], new LibVar[0], null, null);
        Assert.Equal("FUNCTION_BLOCK F\nEND_FUNCTION_BLOCK", LibSignatureRenderer.Render(s)!.Value.Text);
    }
}
