using System.Collections.Generic;
using Volt.Bridge.Core.Library;
using Xunit;

namespace Volt.Bridge.Tests;

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
}
