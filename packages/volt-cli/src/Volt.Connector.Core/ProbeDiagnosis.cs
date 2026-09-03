using System.Collections.Generic;
using System.Linq;

namespace Volt.Connector
{
    /// <summary>One visible top-level window, as seen from outside the process.</summary>
    public readonly struct TopLevelWindow
    {
        public TopLevelWindow(string caption, string className, bool enabled)
        { Caption = caption; ClassName = className; Enabled = enabled; }

        public string Caption { get; }

        /// <summary>The Win32 window class. <c>#32770</c> is the standard dialog class — a strong hint, but only
        /// a hint: TcXaeShell's own About box is a WPF <c>HwndWrapper[…]</c> and is every bit as modal.</summary>
        public string ClassName { get; }

        /// <summary>Whether the window accepts input. A modal DISABLES the window it blocks, which is what makes
        /// this — and not the class — the fact that identifies one.</summary>
        public bool Enabled { get; }
    }

    /// <summary>One TwinCAT window, as the connector can observe it from outside.</summary>
    public readonly struct XaeWindowState
    {
        public XaeWindowState(int pid, bool responding, IReadOnlyList<TopLevelWindow> windows)
        { Pid = pid; Responding = responding; Windows = windows; }

        public int Pid { get; }

        /// <summary>Whether the process is pumping messages at all.</summary>
        public bool Responding { get; }

        /// <summary>Every visible top-level window it owns. Raw observation — the verdict is drawn here, not there.</summary>
        public IReadOnlyList<TopLevelWindow> Windows { get; }
    }

    /// <summary>
    /// WHY the XAE probe is failing, in a sentence, from what can be seen without touching COM.
    ///
    /// <para>A failing probe already reports that worker supervision is suspended (<see cref="ProbeHealth"/>).
    /// What it could not say is the CAUSE, so the message ended in a guess — "usually a TwinCAT window that is
    /// busy or left over from an earlier session" — written by whoever last had a theory. This replaces the
    /// guess with an observation, every time it happens, on any machine.</para>
    ///
    /// <para><b>A MODAL DIALOG BLOCKS COM.</b> That is a trap already recorded against this vendor, and it is
    /// the leading explanation for the failures this connector sees: the probe walks the COM ROT, a window with
    /// a dialog open does not answer, and the walk blocks until the dialog is dismissed. Measured 2026-09-03,
    /// the walk exceeded 180 SECONDS against a 6-second budget while such a window was around — so the probe is
    /// killed and reports failure every tick, for as long as the dialog sits there. A real one appeared during
    /// those runs: "saving project failed".</para>
    ///
    /// <para><b>`Responding` is NOT the signal, which is why this looks for a dialog instead.</b> A modal keeps
    /// its process pumping messages — it is pumping them FOR the dialog — so the process reports as responding
    /// while COM is entirely blocked. Checking liveness would have produced a confident, wrong answer; the
    /// dialog's own window is the thing that is actually there.</para>
    ///
    /// <para>Pure, and separated from the window enumeration for the same reason <c>TwincatXaeProbe.Decide</c>
    /// is separated from the spawn: the part that decides what to TELL the engineer is the part worth testing,
    /// and it cannot be reached behind a P/Invoke.</para>
    /// </summary>
    public static class ProbeDiagnosis
    {
        /// <summary>The sentence to append to the probe-failure warning, or null when nothing stands out.</summary>
        public static string? Explain(IReadOnlyList<XaeWindowState> windows)
        {
            if (windows.Count == 0)
                return "No TcXaeShell window is running, so there is nothing to enumerate — if a bridge is " +
                       "expected, the IDE closed or never started.";

            var blocked = windows.Select(w => new { w.Pid, Title = ModalTitle(w) })
                                 .Where(x => x.Title != null).ToList();
            if (blocked.Count > 0)
                return "A DIALOG IS OPEN and a modal blocks COM until it is dismissed: " +
                       string.Join("; ", blocked.Select(x => $"TcXaeShell pid {x.Pid} — \"{x.Title}\"")) +
                       ". Dismiss it in the IDE; supervision resumes on its own.";

            var stuck = windows.Where(w => !w.Responding).ToList();
            if (stuck.Count > 0)
                return "Not responding, so the COM enumeration cannot complete: " +
                       string.Join(", ", stuck.Select(w => $"TcXaeShell pid {w.Pid}")) +
                       ". Usually a long build or load; if it persists the window is hung.";

            // Every window looks healthy, so the cause is not visible from here — say that, rather than
            // repeating one of the guesses above and sending someone to dismiss a dialog that is not there.
            return $"All {windows.Count} TcXaeShell window(s) look responsive with no dialog open, so the cause " +
                   "is not visible from outside — the enumeration itself is slow or failing.";

        }

        /// <summary>The caption of the modal this window is blocked by, or null when it is not blocked.
        ///
        /// <para><b>A modal is identified by what it DOES, not by its class.</b> Showing one disables the window
        /// behind it, so "some window of this process is disabled while another is not" is the signal — and it
        /// holds for both shapes measured against a live TcXaeShell on 2026-09-03: the <c>#32770</c> "Open
        /// Project" dialog, and <c>Help &gt; About</c>, which is a WPF <c>HwndWrapper[…]</c>. The class gate this
        /// replaced saw only the first, and told the engineer no dialog was open while the second blocked the
        /// probe.</para>
        ///
        /// <para>The dialog is named from the ENABLED window — the one that can still be clicked, which is the
        /// one to dismiss. A <c>#32770</c> is preferred when several qualify, because a tool window that happens
        /// to be enabled is not what is blocking anything.</para></summary>
        internal static string? ModalTitle(XaeWindowState w)
        {
            var windows = w.Windows;
            if (windows == null || windows.Count == 0) return null;
            if (!windows.Any(x => !x.Enabled)) return null;   // nothing is blocked, so nothing is modal

            var candidates = windows.Where(x => x.Enabled && !string.IsNullOrWhiteSpace(x.Caption)).ToList();
            var dialog = candidates.FirstOrDefault(x => x.ClassName == DialogClass);
            var named = string.IsNullOrWhiteSpace(dialog.Caption) ? candidates.FirstOrDefault() : dialog;

            // A window is disabled but nothing visible is enabled — a modal owned by a hidden or off-screen
            // parent. Still a block, and still worth saying so; there is just no caption to point at.
            return string.IsNullOrWhiteSpace(named.Caption) ? "(unnamed dialog)" : named.Caption.Trim();
        }

        private const string DialogClass = "#32770";
    }
}
