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
    // The window shapes below are the ones MEASURED against a live TcXaeShell on 2026-09-03, not invented: a
    // modal disables the main window and leaves itself enabled, and it is not necessarily a #32770 — the shell's
    // own About box is WPF. `Main` is what an unblocked IDE looks like.
    private static TopLevelWindow MainWindow(bool enabled = true) =>
        new("TwinCAT Project13 - TcXaeShell", "HwndWrapper[DefaultDomain;;8fa25112]", enabled);
    private static TopLevelWindow Win32Dialog(string caption) => new(caption, "#32770", enabled: true);
    private static TopLevelWindow WpfDialog(string caption) =>
        new(caption, "HwndWrapper[DefaultDomain;;ed4a950e]", enabled: true);

    private static XaeWindowState Fine(int pid) => new(pid, responding: true, new[] { MainWindow() });
    private static XaeWindowState WithDialog(int pid, string title) =>
        new(pid, responding: true, new[] { Win32Dialog(title), MainWindow(enabled: false) });
    private static XaeWindowState Hung(int pid) => new(pid, responding: false, new[] { MainWindow() });

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

    /// <summary>A WPF DIALOG COUNTS, and this is the case that was shipping wrong. The rule was "window class is
    /// #32770", on the stated grounds that every standard dialog is built from it. Measured against a live
    /// TcXaeShell: <c>Help &gt; About</c> is a WPF HwndWrapper, so the class gate saw nothing and the connector
    /// said "no dialog open, so the cause is not visible from outside" — while that dialog was blocking the very
    /// probe that was failing, and the e2e suite behind it was timing out at 60s a test.</summary>
    [Fact]
    public void A_WPF_dialog_is_a_dialog_too()
    {
        var msg = ProbeDiagnosis.Explain(new[]
            { new XaeWindowState(7, responding: true, new[] { WpfDialog("About TcXaeShell"), MainWindow(enabled: false) }) });

        Assert.Contains("DIALOG IS OPEN", msg);
        Assert.Contains("About TcXaeShell", msg);
        Assert.DoesNotContain("not visible from outside", msg);
    }

    /// <summary>THE DISABLED WINDOW IS THE SIGNAL, and the enabled one is what gets named — it is the window the
    /// engineer can actually click. Naming the blocked one would point at the thing they cannot touch.</summary>
    [Fact]
    public void The_dialog_named_is_the_one_that_can_be_dismissed()
    {
        var msg = ProbeDiagnosis.Explain(new[]
            { new XaeWindowState(7, responding: true, new[] { MainWindow(enabled: false), Win32Dialog("Open Project") }) });

        Assert.Contains("\"Open Project\"", msg);
        Assert.DoesNotContain("\"TwinCAT Project13", msg);
    }

    /// <summary>A #32770 IS PREFERRED when more than one window is enabled — a tool window that happens to be
    /// enabled is not what is blocking anything, and naming it would send someone to close the wrong thing.</summary>
    [Fact]
    public void A_real_dialog_is_named_over_an_enabled_tool_window()
    {
        var msg = ProbeDiagnosis.Explain(new[]
            {
                new XaeWindowState(7, responding: true, new[]
                {
                    new TopLevelWindow("Error List", "HwndWrapper[DefaultDomain;;aaaa]", enabled: true),
                    Win32Dialog("Save failed"),
                    MainWindow(enabled: false),
                }),
            });

        Assert.Contains("Save failed", msg);
        Assert.DoesNotContain("Error List", msg);
    }

    /// <summary>NOTHING DISABLED IS NOT A MODAL. An enabled dialog beside an enabled main window is a modeless
    /// tool window — it blocks nothing, and calling it a modal would send someone to dismiss a window that is not
    /// in the way. Being blocked is the definition, so being blocked is the test.</summary>
    [Fact]
    public void A_modeless_window_is_not_reported_as_a_modal()
    {
        var msg = ProbeDiagnosis.Explain(new[]
            { new XaeWindowState(1, responding: true, new[] { Win32Dialog("Find and Replace"), MainWindow() }) });

        Assert.DoesNotContain("DIALOG IS OPEN", msg);
        Assert.Contains("not visible from outside", msg);
    }

    /// <summary>A BLOCKED WINDOW WITH NOTHING NAMEABLE still reports the block.
    ///
    /// <para>This inverts what it replaced. The old test asserted that a blank caption is NOT a dialog — true of
    /// the old representation, where the caption WAS the whole evidence, so a blank one meant nothing had been
    /// found. The evidence is now the disabled window, which is present either way: a main window that has been
    /// disabled is blocked whether or not the thing blocking it has a title. Saying so without a name is a
    /// smaller claim than the old silence was, and a truer one.</para></summary>
    [Fact]
    public void A_block_with_no_caption_is_still_reported()
    {
        var msg = ProbeDiagnosis.Explain(new[]
            { new XaeWindowState(1, responding: true, new[] { new TopLevelWindow("   ", "#32770", true), MainWindow(enabled: false) }) });

        Assert.Contains("DIALOG IS OPEN", msg);
        Assert.Contains("(unnamed dialog)", msg);
    }
}
