using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;

namespace Volt.Bridge.Connector
{
    /// <summary>
    /// Owns the lifecycle of the headless bridge WORKER processes (the external-attach
    /// vendors). Spawns, supervises (respawns on crash), and tears them down. In-IDE
    /// vendors (CODESYS) aren't hosted here — only launched via <see cref="LaunchIde"/>.
    ///
    /// Only ever kills its OWN spawned PIDs (entire child tree) — never a broad
    /// process-name kill, which could take down a live IDE.
    /// </summary>
    public sealed class BridgeSupervisor : IDisposable
    {
        private readonly Dictionary<string, Process> _workers = new();
        private readonly object _gate = new();

        public string LogDir { get; }

        public BridgeSupervisor()
        {
            LogDir = Path.Combine(Path.GetTempPath(), "volt-connector");
            Directory.CreateDirectory(LogDir);
        }

        /// <summary>Ensure the vendor's worker is running (spawn if absent or crashed).
        /// No-op for in-IDE vendors or when the worker binary can't be found.</summary>
        public void EnsureWorker(VendorProvider p)
        {
            if (p.Archetype != Archetype.ExternalAttach || !p.Enabled) return;
            if (string.IsNullOrEmpty(p.WorkerExe) || !File.Exists(p.WorkerExe)) return;

            lock (_gate)
            {
                if (_workers.TryGetValue(p.Id, out var existing))
                {
                    if (!existing.HasExited) return;
                    existing.Dispose();          // crashed worker — dispose before respawning
                    _workers.Remove(p.Id);
                }

                var log = Path.Combine(LogDir, $"{p.Id}.log");
                var psi = new ProcessStartInfo
                {
                    FileName = p.WorkerExe,
                    Arguments = p.WorkerArgs,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };
                // The worker reads its attach target from the environment at startup.
                if (p.Target != null)
                {
                    if (!string.IsNullOrEmpty(p.Target.Instance)) psi.EnvironmentVariables["VOLT_TC_INSTANCE"] = p.Target.Instance;
                    if (!string.IsNullOrEmpty(p.Target.Project)) psi.EnvironmentVariables["VOLT_TC_PROJECT"] = p.Target.Project;
                    if (!string.IsNullOrEmpty(p.Target.PlcProject)) psi.EnvironmentVariables["VOLT_TC_PLC"] = p.Target.PlcProject;
                }
                Process? proc;
                try { proc = Process.Start(psi); }
                catch (Exception ex) { AppendLog(log, $"[connector] spawn failed: {ex.Message}"); return; }
                if (proc == null) return;

                proc.OutputDataReceived += (_, e) => AppendLog(log, e.Data);
                proc.ErrorDataReceived += (_, e) => AppendLog(log, e.Data);
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();
                _workers[p.Id] = proc;
                AppendLog(log, $"[connector] started {Path.GetFileName(p.WorkerExe)} (pid {proc.Id})");
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
                }
            }
        }

        /// <summary>Launch the vendor's default IDE (with the in-proc loader arg so the
        /// bridge auto-loads). Returns false if the IDE exe is unknown.</summary>
        public bool LaunchIde(VendorProvider p) => p.CanLaunchIde && LaunchIde(p.IdeExe!, p.IdeLaunchArgs);

        /// <summary>Launch a specific install (any discovered CODESYS version/fork) with
        /// the loader args. Returns false if the exe is missing or launch fails.</summary>
        public bool LaunchIde(string exePath, string args)
        {
            if (string.IsNullOrEmpty(exePath) || !File.Exists(exePath)) return false;
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = exePath,
                    Arguments = args,
                    UseShellExecute = true,
                });
                return true;
            }
            catch { return false; }
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

        private static void AppendLog(string path, string? line)
        {
            if (string.IsNullOrEmpty(line)) return;
            try { File.AppendAllText(path, line + Environment.NewLine); } catch { /* best effort */ }
        }
    }
}
