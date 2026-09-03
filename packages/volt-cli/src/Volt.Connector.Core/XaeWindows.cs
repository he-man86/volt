using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace Volt.Connector
{
    /// <summary>
    /// What the TwinCAT windows on this machine look like from outside — the OBSERVATION half of
    /// <see cref="ProbeDiagnosis"/>, which holds the verdict.
    ///
    /// <para>Split for the same reason <c>TwincatXaeProbe.ListPids</c> is split from <c>Decide</c>: this part
    /// cannot be tested (it enumerates real windows on a real desktop), and the part that decides what to tell
    /// the engineer can be — so the untestable part is kept as small and as dumb as possible. It collects facts
    /// and makes no judgements.</para>
    ///
    /// <para><b>It used to make one, and the judgement was wrong.</b> This looked for a window of class
    /// <c>#32770</c> — the Win32 dialog class — on the stated grounds that "every standard dialog is built from
    /// it". Measured 2026-09-03 against a live TcXaeShell: <c>Help &gt; About</c> is a WPF window
    /// (<c>HwndWrapper[…]</c>), not <c>#32770</c>, so the class gate missed it and the connector reported "no
    /// dialog open, so the cause is not visible from outside" while a modal sat on screen blocking the very
    /// probe that was failing. A rule that can be wrong belongs where a test can hold it, so the naming of a
    /// modal now happens in <see cref="ProbeDiagnosis"/> and this file just lists what is on screen.</para>
    /// </summary>
    public static class XaeWindows
    {
        private const string XaeProcessName = "TcXaeShell";

        /// <summary>Every running TwinCAT window, with the top-level windows it currently shows. Never throws:
        /// this runs on the failure path of a probe that is already failing, and a diagnostic that can itself
        /// fault would replace a useful message with a worse one.</summary>
        public static IReadOnlyList<XaeWindowState> Snapshot()
        {
            var states = new List<XaeWindowState>();
            Process[] procs;
            try { procs = Process.GetProcessesByName(XaeProcessName); }
            catch { return states; }

            foreach (var p in procs)
            {
                try { states.Add(new XaeWindowState(p.Id, Responding(p), TopLevelWindowsOf(p.Id))); }
                catch { /* the window went away mid-enumeration — not worth reporting */ }
                finally { try { p.Dispose(); } catch { } }
            }
            return states;
        }

        private static bool Responding(Process p)
        {
            try { return p.Responding; }
            catch { return true; }   // unknown is not evidence of a hang
        }

        /// <summary>Every VISIBLE top-level window this process owns, with its class and whether it is enabled.
        /// Enabled is the load-bearing fact: showing a modal is exactly what disables the window behind it.</summary>
        private static IReadOnlyList<TopLevelWindow> TopLevelWindowsOf(int pid)
        {
            var found = new List<TopLevelWindow>();
            try
            {
                EnumWindows((h, _) =>
                {
                    if (!IsWindowVisible(h)) return true;
                    GetWindowThreadProcessId(h, out var owner);
                    if (owner != pid) return true;

                    var cls = new StringBuilder(64);
                    GetClassName(h, cls, cls.Capacity);
                    var caption = new StringBuilder(512);
                    GetWindowText(h, caption, caption.Capacity);
                    found.Add(new TopLevelWindow(caption.ToString(), cls.ToString(), IsWindowEnabled(h)));
                    return true;
                }, IntPtr.Zero);
            }
            catch { return found; }
            return found;
        }

        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr hWnd);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int pid);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetClassName(IntPtr hWnd, StringBuilder buf, int max);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder buf, int max);
    }
}
