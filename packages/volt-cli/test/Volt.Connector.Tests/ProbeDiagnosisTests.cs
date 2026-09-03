using System;
using System.Collections.Generic;
using Xunit;
using Volt.Connector;

namespace Volt.Connector.Tests;

/// <summary>
/// WHY the probe is failing, said rather than guessed.
///
/// <para>The probe-failure warning used to end in a theory — "usually a TwinCAT window that is busy or left over
/// from an earlier session" — written by whoever last had one. These pin the replacement: a sentence derived
/// from what is actually on the desktop, produced every time it happens rather than only when someone is
/// watching.</para>
///
/// <para>The ordering of the rules is the substance. A modal dialog blocks COM while its process still pumps
/// messages, so a liveness check reports the process as HEALTHY and a diagnosis built on it would confidently
/// send an engineer to look at the wrong thing. The dialog is checked first because it is the only signal that
/// is actually present when the failure everyone hits occurs.</para>
/// </summary>
public class ProbeDiagnosisTests
{
    private static XaeWindowState Fine(int pid) => new(pid, null, responding: true);
    private static XaeWindowState WithDialog(int pid, string title) => new(pid, title, responding: true);
    private static XaeWindowState Hung(int pid) => new(pid, null, responding: false);

    /// <summary>A DIALOG IS NAMED, with its caption and the window it belongs to — the message an engineer can
    /// act on without knowing anything about COM.</summary>
    [Fact]
    public void A_dialog_is_reported_with_its_caption()
    {
        var msg = ProbeDiagnosis.Explain(new[] { Fine(100), WithDialog(200, "saving project failed") });

        Assert.Contains("DIALOG IS OPEN", msg);
        Assert.Contains("pid 200", msg);
        Assert.Contains("saving project failed", msg);
        Assert.Contains("Dismiss it", msg);
    }

    /// <summary>AND A RESPONDING PROCESS WITH A DIALOG IS STILL REPORTED AS BLOCKED. This is the case the whole
    /// check exists for: a modal keeps its process pumping messages — it is pumping them FOR the dialog — so the
    /// process looks alive while COM is entirely blocked. A diagnosis that trusted liveness would say everything
    /// is fine.</summary>
    [Fact]
    public void A_dialog_wins_over_the_process_looking_healthy()
    {
        var msg = ProbeDiagnosis.Explain(new[] { WithDialog(1, "TwinCAT") });

        Assert.Contains("DIALOG IS OPEN", msg);
        Assert.DoesNotContain("look responsive", msg);
    }

    /// <summary>SEVERAL BLOCKED WINDOWS ARE ALL NAMED — closing one of two dialogs leaves the probe failing, and
    /// a message that mentioned only the first would look like the fix did not work.</summary>
    [Fact]
    public void Every_blocked_window_is_named()
    {
        var msg = ProbeDiagnosis.Explain(new[] { WithDialog(1, "first"), WithDialog(2, "second") });

        Assert.Contains("pid 1", msg);
        Assert.Contains("pid 2", msg);
    }

    /// <summary>A NON-RESPONDING WINDOW is reported when no dialog explains it — usually a long build, which is
    /// worth saying, because the answer there is to wait rather than to go looking.</summary>
    [Fact]
    public void A_hung_window_is_reported_when_no_dialog_explains_it()
    {
        var msg = ProbeDiagnosis.Explain(new[] { Fine(1), Hung(2) });

        Assert.Contains("Not responding", msg);
        Assert.Contains("pid 2", msg);
    }

    /// <summary>NO WINDOWS AT ALL is its own answer, and a different one: there is nothing to enumerate, so the
    /// probe failing is expected rather than a fault to investigate.</summary>
    [Fact]
    public void No_windows_is_reported_as_nothing_to_enumerate()
    {
        var msg = ProbeDiagnosis.Explain(Array.Empty<XaeWindowState>());

        Assert.Contains("No TcXaeShell window is running", msg);
    }

    /// <summary>AND WHEN EVERYTHING LOOKS FINE, IT SAYS SO — rather than repeating one of the guesses above.
    ///
    /// <para>This is the arm that keeps the diagnosis honest. Falling back to "probably a dialog" when no dialog
    /// is visible would send someone to dismiss something that is not there, and would make the useful case
    /// indistinguishable from the useless one. "Not visible from outside" is a smaller claim and a true one.</para></summary>
    [Fact]
    public void Healthy_windows_are_reported_as_no_visible_cause()
    {
        var msg = ProbeDiagnosis.Explain(new[] { Fine(1), Fine(2) });

        Assert.Contains("not visible from outside", msg);
        Assert.Contains("2 TcXaeShell window(s)", msg);
        Assert.DoesNotContain("DIALOG", msg);
    }

    /// <summary>A blank caption is not a dialog worth naming — a window with no title tells the engineer
    /// nothing, so it falls through to the liveness rule rather than printing empty quotes.</summary>
    [Fact]
    public void A_blank_caption_is_not_treated_as_a_dialog()
    {
        var msg = ProbeDiagnosis.Explain(new[] { new XaeWindowState(1, "   ", responding: true) });

        Assert.DoesNotContain("DIALOG IS OPEN", msg);
    }
}
