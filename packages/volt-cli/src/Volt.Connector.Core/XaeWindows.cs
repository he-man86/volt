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
    /// <para>A modal dialog is found by its window CLASS. <c>#32770</c> is the Win32 dialog class, which every
    /// standard dialog — including the message box a failed save produces — is built from. Matching on the
    /// class rather than on a caption means it works whatever the dialog says, and in any UI language.</para>
    /// </summary>
    public static class XaeWindows
    {
        private const string XaeProcessName = "TcXaeShell";
        private const string DialogClass = "#32770";

        /// <summary>Every running TwinCAT window, with any modal dialog it has open. Never throws: this runs on
        /// the failure path of a probe that is already failing, and a diagnostic that can itself fault would
        /// replace a useful message with a worse one.</summary>
        public static IReadOnlyList<XaeWindowState> Snapshot()
        {
            var states = new List<XaeWindowState>();
            Process[] procs;
            try { procs = Process.GetProcessesByName(XaeProcessName); }
            catch { return states; }

            foreach (var p in procs)
            {
                try { states.Add(new XaeWindowState(p.Id, DialogTitleOf(p.Id), Responding(p))); }
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

        /// <summary>The caption of a visible dialog-class window owned by this process, or null.</summary>
        private static string? DialogTitleOf(int pid)
        {
            string? found = null;
            try
            {
                EnumWindows((h, _) =>
                {
                    if (!IsWindowVisible(h)) return true;
                    GetWindowThreadProcessId(h, out var owner);
                    if (owner != pid) return true;

                    var cls = new StringBuilder(64);
                    if (GetClassName(h, cls, cls.Capacity) == 0 || cls.ToString() != DialogClass) return true;

                    var caption = new StringBuilder(512);
                    GetWindowText(h, caption, caption.Capacity);
                    found = caption.ToString();
                    return false;   // one is enough to explain the block
                }, IntPtr.Zero);
            }
            catch { return null; }
            return string.IsNullOrWhiteSpace(found) ? null : found;
        }

        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int pid);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetClassName(IntPtr hWnd, StringBuilder buf, int max);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder buf, int max);
    }
}
