using System;
using System.Threading.Tasks;
using Volt.Contracts;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// The whole TwinCAT worker FLEET: probe → reconcile → spawn/reap, composed in one place over the pure reap
    /// policy (<see cref="TwincatSupervisor"/>), the pid probe (<see cref="TwincatXaeProbe"/>) and the process
    /// supervisor (<see cref="BridgeSupervisor"/>). The tray owns only the CLOCK — it decides how often to call
    /// <see cref="Tick"/>; every decision about which workers exist is here.
    ///
    /// <para>This composition used to be inline in the WinForms <c>TrayContext</c>, where no test project could
    /// reach it (net8.0-windows vs the net8.0 test assembly), so the fleet rules that actually ran had zero
    /// coverage while the suite asserted a spawn plan the tray discarded.</para>
    /// </summary>
    public sealed class TwincatFleet : IDisposable
    {
        private readonly BridgeSupervisor _supervisor = new();
        private readonly TwincatSupervisor _policy = new(); // decides which per-XAE TwinCAT workers to run

        /// <summary>The worker id for one XAE window — the SAME string across spawn, reap and restart, so it is
        /// spelled exactly once.</summary>
        private static string WorkerId(int pid) => $"{Vendors.Twincat}.{pid}";

        /// <summary>One reconciliation pass. TwinCAT is per-XAE: probe the live XAE window pids (a COM-isolated
        /// subprocess, off the caller's thread), then keep exactly one worker per XAE — spawn/respawn one for each
        /// live pid (<see cref="BridgeSupervisor.EnsureWorker"/> is idempotent AND respawns a crashed one, so this
        /// also covers a worker that died while its XAE lived), and reap workers whose XAE has been gone long enough
        /// (the policy debounces a transient probe miss). CODESYS is in-proc — never spawned.</summary>
        public async Task Tick(string? probeExe, TimeSpan probeTimeout)
        {
            if (string.IsNullOrEmpty(probeExe)) return;                    // no worker binary (dev without a build)
            var pids = await Task.Run(() => TwincatXaeProbe.ListPids(probeExe, probeTimeout));
            if (pids == null) return;                                      // probe FAILED (not "no XAE") — leave the fleet as-is
            var (_, reap) = _policy.Reconcile(pids);
            foreach (var pid in pids)
                _supervisor.EnsureWorker(new WorkerSpec(WorkerId(pid), probeExe, $"{WorkerCli.XaePid} {pid}"));
            foreach (var pid in reap)
                _supervisor.StopWorker(WorkerId(pid));
        }

        /// <summary>Kill one worker; the next <see cref="Tick"/> respawns it while its XAE is still live.</summary>
        public void StopWorker(string id) => _supervisor.StopWorker(id);

        public void Dispose() => _supervisor.Dispose();
    }
}
