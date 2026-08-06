using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using Volt.Cli.Transport;

namespace Volt.Cli.Connector
{
    /// <summary>A headless bridge worker the connector spawns + supervises — an ExternalAttach vendor that
    /// attaches to a running IDE over its external API (TwinCAT COM/DTE, later Siemens/Allen-Bradley). CODESYS is
    /// NOT one: it loads in-proc via user activation and is never spawned (see <c>CodesysActivation</c> in the
    /// tray shell).</summary>
    public sealed record WorkerSpec(string Id, string? Exe, string Args = "");

    /// <summary>
    /// Owns the lifecycle of the headless bridge WORKER processes (the ExternalAttach vendors: TwinCAT, later
    /// Siemens/Allen-Bradley). Spawns, supervises (respawns on crash), and tears them down. It does NOT launch or
    /// open any IDE — CODESYS loads in-proc via user activation, and project selection is a wire op, not a
    /// respawn-with-env. Only ever kills its OWN spawned PIDs (entire child tree) — never a broad process-name
    /// kill, which could take down a live IDE.
    ///
    /// <para>Every spawned worker is assigned to a Windows JOB OBJECT with <c>KILL_ON_JOB_CLOSE</c>, so if the
    /// connector exits WITHOUT a clean <see cref="Dispose"/> — a crash, a kill — the kernel closes the job handle and
    /// terminates every worker. Without it, orphaned <c>VoltBridgeTwincat</c> processes would survive and, on the
    /// next connector start, a fresh worker would collide with the orphan on the same <c>volt.bridge.twincat.&lt;pid&gt;</c>
    /// pipe (two COM attachments to one XAE). CODESYS needs none of this — its host is in-proc and dies with the IDE.</para>
    ///
    /// <para>Lives in Connector.Core, NOT the WinForms shell: nothing here touches a UI (System.Diagnostics/IO/
    /// InteropServices only), and while it sat in the net8.0-windows assembly the de-dup, the crash-restart path and
    /// the orphan guard above were unreachable from any test project — the tested policy was not the one that ran.</para>
    /// </summary>
    public sealed class BridgeSupervisor : IDisposable
    {
        private readonly Dictionary<string, Process> _workers = new();
        private readonly object _gate = new();
        private readonly SafeJobHandle _job = SafeJobHandle.CreateKillOnClose();

        /// <summary>Ensure the worker is running (spawn if absent, respawn if it exited). No-op when the binary
        /// can't be found. The spawn args name the ONE IDE instance the worker owns (`--xae-pid &lt;pid&gt;`, which
        /// the worker refuses to run without); which PROJECT it serves is a wire op (`connect`), never a
        /// respawn.</summary>
        public void EnsureWorker(WorkerSpec w)
        {
            if (string.IsNullOrEmpty(w.Exe) || !File.Exists(w.Exe)) return;

            lock (_gate)
            {
                if (_workers.TryGetValue(w.Id, out var existing))
                {
                    if (!existing.HasExited) return;
                    VoltLog.Warn($"worker {w.Id} crashed (exit {existing.ExitCode}) — restarting");
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
                catch (Exception ex) { VoltLog.Error($"spawn {w.Id} failed: {ex.Message}"); return; }
                if (proc == null) return;

                // Tie the worker's lifetime to the connector's: if we die without a clean Dispose, the job closes and
                // the kernel kills it — no orphan to collide with the next start. Best-effort (never block a spawn).
                _job.Assign(proc);

                // Capture the worker's stdout/stderr into the shared store, tagged with its source (belt-and-
                // suspenders: the worker self-logs via VoltLog too, but this catches anything it prints directly).
                proc.OutputDataReceived += (_, e) => VoltLog.Raw(w.Id, e.Data);
                proc.ErrorDataReceived += (_, e) => VoltLog.Raw(w.Id, e.Data);
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();
                _workers[w.Id] = proc;
                VoltLog.Info($"started {Path.GetFileName(w.Exe)} for {w.Id} (pid {proc.Id})");
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
                    VoltLog.Info($"stopped worker {id}");
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
            _job.Dispose(); // closing the job also terminates anything still assigned (belt-and-suspenders with KillTree)
        }

        private static void KillTree(Process proc)
        {
            try { if (!proc.HasExited) proc.Kill(entireProcessTree: true); } catch { /* already gone */ }
        }
    }

    /// <summary>A Windows Job Object configured to KILL every assigned process when the handle closes — including on
    /// an unclean connector exit (crash/kill), where the OS closes all handles and the kernel reaps the workers. A
    /// no-op wrapper on non-Windows / if creation fails, so it never breaks a spawn.</summary>
    internal sealed class SafeJobHandle : IDisposable
    {
        [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr CreateJobObject(IntPtr a, string? name);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int len);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr h);

        private const int JobObjectExtendedLimitInformation = 9;
        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

        [StructLayout(LayoutKind.Sequential)] private struct JOBOBJECT_BASIC_LIMIT_INFORMATION { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
        [StructLayout(LayoutKind.Sequential)] private struct IO_COUNTERS { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
        [StructLayout(LayoutKind.Sequential)] private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION { public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }

        private IntPtr _handle = IntPtr.Zero;
        private SafeJobHandle(IntPtr handle) => _handle = handle;

        public static SafeJobHandle CreateKillOnClose()
        {
            try
            {
                if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return new SafeJobHandle(IntPtr.Zero);
                var h = CreateJobObject(IntPtr.Zero, null);
                if (h == IntPtr.Zero) return new SafeJobHandle(IntPtr.Zero);
                var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                if (!SetInformationJobObject(h, JobObjectExtendedLimitInformation, ref info, Marshal.SizeOf(info)))
                {
                    CloseHandle(h);
                    return new SafeJobHandle(IntPtr.Zero);
                }
                return new SafeJobHandle(h);
            }
            catch { return new SafeJobHandle(IntPtr.Zero); }
        }

        public void Assign(Process proc)
        {
            if (_handle == IntPtr.Zero) return;
            try { AssignProcessToJobObject(_handle, proc.Handle); } catch { /* best effort — KillTree still covers clean exit */ }
        }

        public void Dispose()
        {
            if (_handle == IntPtr.Zero) return;
            try { CloseHandle(_handle); } catch { }
            _handle = IntPtr.Zero;
        }
    }
}
