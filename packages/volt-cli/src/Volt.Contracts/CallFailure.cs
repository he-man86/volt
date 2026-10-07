using System;
using System.Reflection;

namespace Volt.Contracts;

/// <summary>
/// How an UNCODED failure of a call is told — to the client (the <c>INTERNAL_ERROR</c> message, which the relay
/// forwards to a remote client unchanged) and to the log (openspec ide-identity-report 3.1).
///
/// <para>WHY: the 3.5.17 field failure reached PLCAssist as one message — <c>Method not found: 'Void
/// Volt.Wire.PipeClient.Call(…)'</c> — with no exception type and no stack, and the bridge's own log held at most that
/// same message (the pipe server logged nothing at all). The type name is not OS-localized; the message text is.</para>
///
/// <para>It used to append which copies of Volt's assemblies were loaded at the failure, for exactly that family of
/// failures (a second copy of a Volt or System.Text.Json assembly in the CODESYS process). The CODESYS bridge now ships
/// as one assembly with those merged in and internalized (openspec codesys-bridge-single-assembly), so there is no
/// second copy to name.</para>
/// </summary>
public static class CallFailure
{
    /// <summary>The client's message: <c>&lt;ExceptionType&gt;: &lt;message&gt;</c> of the innermost meaningful
    /// exception (a <see cref="TargetInvocationException"/> / <see cref="TypeInitializationException"/> wrapper is
    /// looked through).</summary>
    public static string Message(Exception ex)
    {
        var root = Root(ex);
        return $"{root.GetType().Name}: {root.Message}";
    }

    /// <summary>The log's text: the whole exception (type, message, stack, inner exceptions).</summary>
    public static string LogText(Exception ex) => ex.ToString();

    private static Exception Root(Exception ex)
    {
        var e = ex;
        while ((e is TargetInvocationException || e is TypeInitializationException) && e.InnerException != null)
            e = e.InnerException;
        if (e is AggregateException agg && agg.InnerExceptions.Count == 1) return Root(agg.InnerExceptions[0]);
        return e;
    }
}
