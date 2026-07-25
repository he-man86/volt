using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// Discovers running TwinCAT XAE window pids by running the worker's <c>--list-xae-pids</c> one-shot — the COM
    /// ROT walk happens in that SHORT-LIVED child process, never in the always-on tray. A hang is a child the tray
    /// timeout-kills; the tray never holds a COM apartment. The pids feed <see cref="TwincatSupervisor"/>.
    /// <para>Parsing is separated from spawning (<see cref="Parse"/>) so it is unit-tested without a process.</para>
    /// </summary>
    public static class TwincatXaeProbe
    {
        /// <summary>Run <c>--list-xae-pids</c> with a hard timeout and return the XAE window pids. A timeout/failure
        /// returns an EMPTY list — "couldn't see any this tick", which the supervisor's N-miss reap debounce absorbs
        /// so a single hung probe never tears down a healthy worker. stderr inherits (tiny diagnostics, no drain).</summary>
        public static IReadOnlyList<int> ListPids(string? workerExe, TimeSpan timeout)
        {
            if (string.IsNullOrEmpty(workerExe) || !File.Exists(workerExe)) return Array.Empty<int>();
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = workerExe,
                    Arguments = "--list-xae-pids",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                };
                using var proc = Process.Start(psi);
                if (proc == null) return Array.Empty<int>();
                var stdout = proc.StandardOutput.ReadToEndAsync(); // drain async so a big write can't deadlock WaitForExit
                if (!proc.WaitForExit((int)timeout.TotalMilliseconds))
                {
                    try { proc.Kill(entireProcessTree: true); } catch { /* already gone */ }
                    return Array.Empty<int>();
                }
                return Parse(stdout.GetAwaiter().GetResult());
            }
            catch { return Array.Empty<int>(); }
        }

        /// <summary>Parse the one-pid-per-line stdout into distinct positive pids (ignores blanks / non-numeric lines).</summary>
        public static IReadOnlyList<int> Parse(string stdout)
        {
            var pids = new List<int>();
            foreach (var line in stdout.Split('\n'))
                if (int.TryParse(line.Trim(), out var pid) && pid > 0 && !pids.Contains(pid)) pids.Add(pid);
            return pids;
        }
    }
}
