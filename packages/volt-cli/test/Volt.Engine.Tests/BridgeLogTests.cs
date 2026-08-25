using System;
using System.IO;
using Xunit;
using Volt.Engine.Ide;

namespace Volt.Cli.Tests;

/// <summary>
/// The bridge's human-facing log. Two things are worth pinning: it writes BOTH sinks, and <c>WarnOnce</c> is
/// once PER KEY rather than once overall.
/// <para>The once-ness fires from inside a tree walk — once per node — so a project containing one unhandled
/// shape would otherwise emit a line per occurrence and bury everything else. Both drivers had their own
/// HashSet + lock + double-write; a second unhandled shape must still be reported, which is the part a naive
/// "warn once" would get wrong.</para>
/// </summary>
[Collection("BridgeLog")]   // the once-keys and the console are process-global
public class BridgeLogTests
{
    private static string CaptureStdErr(Action act)
    {
        var original = Console.Error;
        var buffer = new StringWriter();
        Console.SetError(buffer);
        try { act(); } finally { Console.SetError(original); }
        return buffer.ToString();
    }

    [Fact]
    public void A_a_warning_reaches_stderr_with_the_bridge_prefix()
    {
        var text = CaptureStdErr(() => BridgeLog.Warn("something went sideways"));

        Assert.Contains("[bridge] something went sideways", text);
    }

    [Fact]
    public void B_warn_once_reports_the_first_occurrence_and_swallows_repeats()
    {
        BridgeLog.ResetOnceKeysForTest();

        var text = CaptureStdErr(() =>
        {
            BridgeLog.WarnOnce("IFoo+IBar", "unrecognized shape IFoo+IBar");
            BridgeLog.WarnOnce("IFoo+IBar", "unrecognized shape IFoo+IBar");
            BridgeLog.WarnOnce("IFoo+IBar", "unrecognized shape IFoo+IBar");
        });

        Assert.Equal(1, Occurrences(text, "unrecognized shape IFoo+IBar"));
    }

    /// <summary>The half a naive implementation loses: a DIFFERENT unhandled shape is still a new finding.
    /// Silencing it would mean the first odd node in a project hides every other one.</summary>
    [Fact]
    public void C_a_different_key_still_warns()
    {
        BridgeLog.ResetOnceKeysForTest();

        var text = CaptureStdErr(() =>
        {
            BridgeLog.WarnOnce("IFoo", "shape IFoo");
            BridgeLog.WarnOnce("IBar", "shape IBar");
            BridgeLog.WarnOnce("IFoo", "shape IFoo");
        });

        Assert.Equal(1, Occurrences(text, "shape IFoo"));
        Assert.Equal(1, Occurrences(text, "shape IBar"));
    }

    private static int Occurrences(string haystack, string needle)
    {
        var n = 0;
        for (var i = haystack.IndexOf(needle, StringComparison.Ordinal); i >= 0;
             i = haystack.IndexOf(needle, i + needle.Length, StringComparison.Ordinal)) n++;
        return n;
    }
}
