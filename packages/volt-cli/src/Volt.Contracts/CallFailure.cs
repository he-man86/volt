using System;
using System.IO;
using System.Linq;
using System.Reflection;

namespace Volt.Contracts;

/// <summary>
/// How an UNCODED failure of a call is told — to the client (the <c>INTERNAL_ERROR</c> message, which the relay
/// forwards to a remote client unchanged) and to the log (openspec ide-identity-report 3.1).
///
/// <para>WHY: the 3.5.17 field failure reached PLCAssist as one message — <c>Method not found: 'Void
/// Volt.Wire.PipeClient.Call(…)'</c> — with no exception type, no stack, nothing about which copies were loaded, and
/// the bridge's own log held at most that same message (the pipe server logged nothing at all). A binding failure is
/// answered only by WHICH copies the process had loaded at that moment, and a second copy can load after start, so
/// the loaded copies are read when the failure happens, not taken from the start log.</para>
/// </summary>
public static class CallFailure
{
    /// <summary>The client's message: <c>&lt;ExceptionType&gt;: &lt;message&gt;</c> of the innermost meaningful
    /// exception (a <see cref="TargetInvocationException"/> / <see cref="TypeInitializationException"/> wrapper is
    /// looked through), and for a binding failure the load conflicts at that moment — or that there are none.</summary>
    public static string Message(Exception ex)
    {
        var root = Root(ex);
        var text = $"{root.GetType().Name}: {root.Message}";
        if (!IsBindingFailure(root)) return text;
        var conflicts = LoadedCopies.Conflicts();
        return text + (conflicts.Count == 0
            ? " [loaded: one copy of each Volt and System.Text.Json assembly, one Volt build]"
            : " [load conflict: " + string.Join(" / ", conflicts) + "]");
    }

    /// <summary>The log's text: the whole exception (type, message, stack, inner exceptions), and for a binding failure
    /// every watched copy loaded at that moment, one per line.</summary>
    public static string LogText(Exception ex)
    {
        var text = ex.ToString();
        var root = Root(ex);
        if (!IsBindingFailure(root)) return text;
        var copies = LoadedCopies.Loaded();
        var conflicts = LoadedCopies.Conflicts(copies);
        return text
            + Environment.NewLine + "  loaded at the failure:"
            + string.Concat(copies.Select(c => Environment.NewLine + $"    {c.Name} {c.Describe()}"))
            + Environment.NewLine + (conflicts.Count == 0
                ? "  load conflicts: none"
                : "  load conflicts:" + string.Concat(conflicts.Select(c => Environment.NewLine + "    " + c)));
    }

    /// <summary>A failure to bind a type, member or assembly — the class the two field failures belong to.</summary>
    private static bool IsBindingFailure(Exception ex) =>
        ex is MissingMemberException      // MissingMethodException, MissingFieldException
        || ex is TypeLoadException
        || (ex is FileNotFoundException f && IsAssemblyName(f.FileName))   // not an ordinary missing file
        || ex is FileLoadException
        || ex is BadImageFormatException;

    // The loader states an assembly by display name (`Volt.Wire, Version=1.0.0.0, …`) or by its file.
    private static bool IsAssemblyName(string? file) =>
        file != null && (file.Contains("Version=") || file.EndsWith(".dll", StringComparison.OrdinalIgnoreCase));

    private static Exception Root(Exception ex)
    {
        var e = ex;
        while ((e is TargetInvocationException || e is TypeInitializationException) && e.InnerException != null)
            e = e.InnerException;
        if (e is AggregateException agg && agg.InnerExceptions.Count == 1) return Root(agg.InnerExceptions[0]);
        return e;
    }
}
