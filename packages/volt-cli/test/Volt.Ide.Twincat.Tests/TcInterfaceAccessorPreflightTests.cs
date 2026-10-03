using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// TWINCAT'S INTERFACE-ACCESSOR REFUSAL IS ASKED BY THE PUSH PRE-FLIGHT (<c>ICodeStore.ValidateInterfaceAccessor</c>;
/// review of openspec <c>bridge-refusal-review</c> 3a+3b). The write refuses any declaration or body pushed at an
/// interface property's GET/SET (DIALECT D21: <c>ReadMember</c> builds one as <c>new Accessor(null, null)</c>, so
/// anything non-blank is a change) — from inside the apply loop, after the batch's earlier ops had landed. The decision
/// needs no IDE, so the pre-flight asks the same call.
/// </summary>
public class TcInterfaceAccessorPreflightTests
{
    private static BeckhoffDriver Driver() => new(new TcObjectModel());

    [Theory]
    [InlineData("VAR\n\tscratch : INT;\nEND_VAR", null)]
    [InlineData(null, "P := 1;")]
    public void An_edit_is_refused_by_the_pre_flight(string? declaration, string? body)
    {
        var ex = Assert.Throws<BridgeException>(() => Driver().ValidateInterfaceAccessor(new Accessor(declaration, body)));
        Assert.Equal(BridgeErrorCodes.Unsupported, ex.ErrorCode);
        Assert.Contains("GET/SET", ex.Message);
    }

    [Fact]
    public void A_blank_restatement_passes() => Driver().ValidateInterfaceAccessor(new Accessor(null, "\n"));
}
