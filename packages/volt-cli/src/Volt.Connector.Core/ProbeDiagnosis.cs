using System.Collections.Generic;
using System.Linq;

namespace Volt.Connector
{
    /// <summary>One TwinCAT window, as the connector can observe it from outside.</summary>
    public readonly struct XaeWindowState
    {
        public XaeWindowState(int pid, string? dialogTitle, bool responding)
        { Pid = pid; DialogTitle = dialogTitle; Responding = responding; }

        public int Pid { get; }

        /// <summary>The caption of a MODAL DIALOG this window has open, or null when it has none.</summary>
        public string? DialogTitle { get; }

        /// <summary>Whether the process is pumping messages at all.</summary>
        public bool Responding { get; }
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

            var blocked = windows.Where(w => !string.IsNullOrWhiteSpace(w.DialogTitle)).ToList();
            if (blocked.Count > 0)
                return "A DIALOG IS OPEN and a modal blocks COM until it is dismissed: " +
                       string.Join("; ", blocked.Select(w => $"TcXaeShell pid {w.Pid} — \"{w.DialogTitle!.Trim()}\"")) +
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
    }
}
