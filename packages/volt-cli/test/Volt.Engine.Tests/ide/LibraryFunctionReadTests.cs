using System;
using System.Linq;
using Xunit;
using Volt.Engine.Format.Network;
using Volt.Engine.Ide;
using Volt.Engine.Library;

namespace Volt.Engine.Tests;

/// <summary>
/// openspec <c>ld-fbd-coverage</c> 2R.4b: a library FUNCTION's box is built from the IDE's library signatures, which the
/// driver reads through <see cref="ProjectDeclarations"/>. On CODESYS that read precompiles the libraries (a build), so
/// it runs at most once per operation, and only when a box names a callee nothing in the project names.
/// </summary>
public class LibraryFunctionReadTests
{
    static readonly LibSignature Len = new("LEN", "standard, 3.5.18.0 (system)", "Function",
        new[] { new LibVar("STR", "STRING(255)") }, new[] { new LibVar("LEN", "INT") }, Array.Empty<LibVar>(),
        Array.Empty<LibVar>(), null, null);

    static ProjectDeclarations Declarations(Func<int> onRead) =>
        new(new FakeIde(), _ => null, Scopes.RefusedPouName, () => { onRead(); return new[] { Len }; });

    const string Own = "PROGRAM P\nVAR\n\ty : INT;\n\ttxt : STRING;\nEND_VAR";

    [Fact]
    public void The_libraries_are_read_once_for_every_box_of_one_operation()
    {
        var reads = 0;
        var declarations = Declarations(() => ++reads);
        var a = declarations.ScopeFor(Own, PushedDeclarations.None);
        var b = declarations.ScopeFor(Own, PushedDeclarations.None);
        Assert.Equal("Function", a.Callee("LEN")?.CallType);
        Assert.Equal("Function", b.Callee("len")?.CallType);
        Assert.Null(a.Callee("F_none"));
        Assert.Equal(1, reads);
    }

    [Fact]
    public void A_body_with_no_library_call_reads_no_library()
    {
        var reads = 0;
        var gate = StNetworkGate.Validate("%LANGUAGE FBD\n%NETWORK\ny := ADD(y, 1);\n",
            Declarations(() => ++reads).ScopeFor(Own, PushedDeclarations.None));
        Assert.True(gate.Ok, string.Join("\n", gate.Diagnostics.Select(d => d.Message)));
        Assert.Equal(0, reads);
    }
}
