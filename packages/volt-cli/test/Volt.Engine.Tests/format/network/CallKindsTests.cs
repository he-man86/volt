using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Engine.Tests.Format.Network;

/// <summary>
/// THE VENDOR'S <c>CallType</c> IS ONE ENUM, AND BOTH DRIVERS READ IT WRONG IN THE SAME PLACE.
///
/// <para>TwinCAT called any non-null <c>CallType</c> an Operator; CODESYS called anything except <c>"None"</c>
/// one. Neither had a <c>FunctionBlock</c> arm — so a resolved function-block call classified as an OPERATOR on
/// both vendors. Latent, because nothing consumes an archive-derived <c>Kind</c> yet, and invisible for exactly
/// that reason.</para>
///
/// <para><b>The member set is measured, not assumed.</b> The committed <c>.TcPOU</c> archives carry
/// <c>And</c> (8), <c>Or</c> (6), <c>FunctionBlock</c> (5) and <c>None</c> (2), and
/// <c>scripts/nwl-boxoutputs.log</c> records the live CODESYS side: a freshly built box reads
/// <c>Operator.None</c>, and the same box reads <c>Operator.Move</c> once the IDE has resolved it. So
/// <c>None</c> means "no operator resolved", which is why the INSTANCE decides under it.</para>
/// </summary>
public class CallKindsTests
{
    [Theory]
    [InlineData("FunctionBlock", true, CallKind.FunctionBlock)]
    [InlineData("FunctionBlock", false, CallKind.FunctionBlock)]   // the member wins over the instance
    [InlineData("And", false, CallKind.Operator)]
    [InlineData("Or", false, CallKind.Operator)]
    [InlineData("Move", false, CallKind.Operator)]
    [InlineData("None", true, CallKind.FunctionBlock)]             // unresolved + an instance
    [InlineData("None", false, CallKind.Function)]                 // unresolved, stateless
    [InlineData(null, true, CallKind.FunctionBlock)]               // no member at all — same fallback
    [InlineData(null, false, CallKind.Function)]
    [InlineData("", false, CallKind.Function)]
    public void The_member_name_decides_and_the_instance_breaks_the_tie(string? callType, bool hasInstance, CallKind expected)
    {
        Assert.Equal(expected, CallKinds.FromVendor(callType, hasInstance));
    }

    /// <summary>THE REGRESSION both drivers carried: a resolved FB call is NOT an operator.</summary>
    [Fact]
    public void A_resolved_function_block_call_is_not_an_operator()
    {
        Assert.NotEqual(CallKind.Operator, CallKinds.FromVendor("FunctionBlock", true));
    }
}
