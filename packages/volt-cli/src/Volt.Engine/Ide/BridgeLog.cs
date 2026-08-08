using System;
using System.Collections.Generic;
using Volt.Cli.Transport;

namespace Volt.Engine.Ide;

/// <summary>
/// A bridge diagnostic that has to reach a HUMAN, written to both sinks.
/// <para><b>Both sinks, and the reason is not obvious</b> — which is why it was spelled out in three separate
/// doc-comments before this type existed. <c>VoltLog</c> is the only one an engineer can read after the fact: an
/// IDE bridge is loaded into a GUI process with no console attached, so anything written to stderr there is gone.
/// stderr is what the headless dev loop (<c>codesys-pipe.ps1</c>) captures, where <c>VoltLog</c>'s file is the
/// awkward one to reach. Neither covers both situations, so every such message goes to both.</para>
/// <para>Five call sites wrote the pair by hand, and one of them writing only one sink would have been invisible
/// exactly when it mattered.</para>
/// </summary>
public static class BridgeLog
{
    private const string Prefix = "[bridge] ";

    public static void Warn(string message)
    {
        Console.Error.WriteLine(Prefix + message);
        VoltLog.Warn(message);
    }

    public static void Info(string message)
    {
        Console.Error.WriteLine(Prefix + message);
        VoltLog.Info(message);
    }

    /// <summary>Warn the FIRST time this <paramref name="key"/> is seen, and never again.
    /// <para>For the "something in this project is a shape we do not handle" warnings: they fire from inside a
    /// tree walk, once per node, so an unhandled kind in a large project would otherwise emit thousands of
    /// identical lines and bury everything else. Both drivers had this — a <c>HashSet</c>, a lock and the same
    /// double write — keyed by an interface signature on one side and a numeric tree-item type on the other.
    /// The key is the caller's to choose; the once-ness is not.</para>
    /// <para>The keys are never evicted. That is intended: the set is bounded by the number of DISTINCT unhandled
    /// shapes a project contains, which is small, and forgetting one would make the message reappear.</para></summary>
    public static void WarnOnce(string key, string message)
    {
        lock (Seen)
        {
            if (!Seen.Add(key)) return;
        }
        Warn(message);
    }

    private static readonly HashSet<string> Seen = new HashSet<string>(StringComparer.Ordinal);

    /// <summary>Forget every <see cref="WarnOnce"/> key. For tests only — the once-ness is process-global, so
    /// without this one test's warning would silence another's.</summary>
    internal static void ResetOnceKeysForTest()
    {
        lock (Seen) Seen.Clear();
    }
}
