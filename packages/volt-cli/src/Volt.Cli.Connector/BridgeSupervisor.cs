using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// Owns the lifecycle of the headless bridge WORKER processes (the ExternalAttach vendors: TwinCAT, later
    /// Siemens/Allen-Bradley). Spawns, supervises (respawns on crash), and tears them down. It does NOT launch or
    /// open any IDE — CODESYS loads in-proc via user activation, and project selection is a wire op, not a
    /// respawn-with-env. Only ever kills its OWN spawned PIDs (entire child tree) — never a broad process-name
    /// kill, which could take down a live IDE.
    /// </summary>
    public sealed class BridgeSupervisor : IDisposable
    {
        private readonly Dictionary<string, Process> _workers = new();
        private readonly object _gate = new();

        /// <summary>The shared durable log store (<c>%LOCALAPPDATA%\Volt\logs</c>) — same place the bridges log,
        /// so one folder holds everything the log window + collect-diagnostics read.</summary>
        public string LogDir => Log.Dir;

        /// <summary>Ensure the worker is running (spawn if absent or crashed). No-op when the binary can't be
        /// found. The worker starts unattached and soft-attaches to the running IDE; the user picks the project
        /// via the `select` wire op (no target env, no respawn).</summary>
        public void EnsureWorker(WorkerSpec w)
        {
            if (string.IsNullOrEmpty(w.Exe) || !File.Exists(w.Exe)) return;

            lock (_gate)
            {
                if (_workers.TryGetValue(w.Id, out var existing))
                {
                    if (!existing.HasExited) return;
                    Log.Warn($"worker {w.Id} crashed (exit {existing.ExitCode}) — restarting");
                    existing.Dispose();
                    _workers.Remove(w.Id);
                }

                var psi = new ProcessStartInfo
                {
                    FileName = w.Exe,
                    Arguments = w.Args,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };
                Process? proc;
                try { proc = Process.Start(psi); }
                catch (Exception ex) { Log.Error($"spawn {w.Id} failed: {ex.Message}"); return; }
                if (proc == null) return;

                // Capture the worker's stdout/stderr into the shared store, tagged with its source (belt-and-
                // suspenders: the worker self-logs via VoltLog too, but this catches anything it prints directly).
                proc.OutputDataReceived += (_, e) => Log.Raw(w.Id, e.Data);
                proc.ErrorDataReceived += (_, e) => Log.Raw(w.Id, e.Data);
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();
                _workers[w.Id] = proc;
                Log.Info($"started {Path.GetFileName(w.Exe)} for {w.Id} (pid {proc.Id})");
            }
        }

        public bool IsWorkerRunning(string id)
        {
            lock (_gate) { return _workers.TryGetValue(id, out var p) && !p.HasExited; }
        }

        public void StopWorker(string id)
        {
            lock (_gate)
            {
                if (_workers.TryGetValue(id, out var proc))
                {
                    KillTree(proc);
                    proc.Dispose();
                    _workers.Remove(id);
                    Log.Info($"stopped worker {id}");
                }
            }
        }

        public void Dispose()
        {
            lock (_gate)
            {
                foreach (var (_, proc) in _workers) { KillTree(proc); proc.Dispose(); }
                _workers.Clear();
            }
        }

        private static void KillTree(Process proc)
        {
            try { if (!proc.HasExited) proc.Kill(entireProcessTree: true); } catch { /* already gone */ }
        }
    }
}
