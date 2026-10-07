using System;
using System.Reflection;
using Volt.Contracts;
using Xunit;

namespace Volt.Contracts.Tests;

/// <summary>
/// AN UNCODED FAILURE SAYS WHAT EXACTLY FAILED (openspec ide-identity-report 3.1).
///
/// <para>Both open field failures — <c>MissingMethodException: Volt.Wire.PipeClient.Call(…)</c> on CODESYS 3.5.17 and
/// <c>MissingFieldException: Volt.Contracts.WireJson.Write</c> on 3.5.21.50 — reached PLCAssist as a bare, OS-localized
/// message. The client now gets the exception's type beside it, and the log the whole exception.</para>
///
/// <para>These tests used to pin which copies of Volt's assemblies were loaded, too — the evidence those failures (a
/// second copy in the CODESYS process) needed. The bridge now ships as ONE assembly with them merged in (openspec
/// codesys-bridge-single-assembly), so that evidence is gone with what it described.</para>
/// </summary>
public class CallFailureTests
{
    private static Exception Raise(Action a)
    {
        try { a(); } catch (Exception e) { return e; }
        throw new InvalidOperationException("nothing was thrown");
    }

    /// <summary>A REAL MissingMethodException (the runtime's own text), as a client sees it: the type and the member.</summary>
    [Fact]
    public void A_missing_member_reaches_the_client_with_its_type_and_member()
    {
        var ex = Raise(() => typeof(string).InvokeMember("NoSuchMember", BindingFlags.InvokeMethod | BindingFlags.Public |
                                                         BindingFlags.Instance, null, "", null));

        Assert.Equal("MissingMethodException: Method 'System.String.NoSuchMember' not found.", CallFailure.Message(ex));
    }

    /// <summary>The field's exact shape, wrapped as reflection or a type initializer would wrap it: the client still
    /// reads the missing member, the log keeps the whole chain with its stack.</summary>
    [Fact]
    public void A_wrapped_missing_member_is_looked_through_and_the_log_keeps_the_chain_and_stack()
    {
        const string field = "Method not found: 'Void Volt.Wire.PipeClient.Call(System.String, System.Object, " +
                             "System.Action`1<System.Text.Json.JsonElement>, Int32)'.";
        var ex = Raise(() => throw new TargetInvocationException(Raise(() => throw new MissingMethodException(field))));

        Assert.Equal("MissingMethodException: " + field, CallFailure.Message(ex));

        var log = CallFailure.LogText(ex);
        Assert.Contains("System.Reflection.TargetInvocationException", log);
        Assert.Contains("---> System.MissingMethodException: " + field, log);
        Assert.Contains("   at Volt.Contracts.Tests.CallFailureTests", log);       // the stack
    }

    [Fact]
    public void An_ordinary_failure_says_its_type()
    {
        var ex = Raise(() => throw new InvalidOperationException("the IDE's compiler faulted"));

        Assert.Equal("InvalidOperationException: the IDE's compiler faulted", CallFailure.Message(ex));
        Assert.Equal("FileNotFoundException: no such file",
            CallFailure.Message(new System.IO.FileNotFoundException("no such file", @"C:\proj\POU.st")));
    }
}
