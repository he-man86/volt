using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using Volt.Wire;
using Volt.Contracts;

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
        /// <summary>Run <c>--list-xae-pids</c> with a hard timeout and return the XAE window pids, or <c>null</c> if the
        /// probe FAILED (exe missing, spawn failed, timed out, or the worker exited non-zero = COM enumeration threw).
        /// A failure must NOT be read as "no XAE open": the caller leaves the fleet untouched on null and only reaps on
        /// a SUCCESSFUL empty result — otherwise a persistently-failing probe would reap every healthy worker. An empty
        /// list therefore means "the enumeration ran and saw no XAE". stderr inherits (tiny diagnostics, no drain).</summary>
        public static IReadOnlyList<int>? ListPids(string? workerExe, TimeSpan timeout)
        {
            if (string.IsNullOrEmpty(workerExe) || !File.Exists(workerExe)) return null;
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = workerExe,
                    Arguments = WorkerCli.ListXaePids,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                };
                using var proc = Process.Start(psi);
                if (proc == null) return null;
                var stdout = proc.StandardOutput.ReadToEndAsync(); // drain async so a big write can't deadlock WaitForExit
                // The two failure returns below abandon that read while `using` disposes the stream under it, so it can
                // fault after we're gone. Observe it here or every failed probe leaks an unobserved faulted Task — on a
                // path the design makes RECURRENT (a persistently failing probe fires every tick, forever).
                stdout.ContinueWith(t => { _ = t.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
                if (!proc.WaitForExit((int)timeout.TotalMilliseconds))
                {
                    try { proc.Kill(entireProcessTree: true); } catch { /* already gone */ }
                    return null; // timed out / hung — a failure, not "no XAE"
                }
                if (proc.ExitCode != 0) return null; // the worker signalled the enumeration itself failed
                return Parse(stdout.GetAwaiter().GetResult());
            }
            catch { return null; }
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
