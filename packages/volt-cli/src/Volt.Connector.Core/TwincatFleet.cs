using System;
using System.Threading.Tasks;
using Volt.Contracts;

namespace Volt.Connector
{
    /// <summary>
    /// The whole TwinCAT worker FLEET: probe → reconcile → spawn/reap, composed in one place over the pure reap
    /// policy (<see cref="TwincatSupervisor"/>), the pid probe (<see cref="TwincatXaeProbe"/>) and the process
    /// supervisor (<see cref="BridgeSupervisor"/>). The tray owns only the CLOCK — it decides how often to call
    /// <see cref="Tick"/>; every decision about which workers exist is here.
    ///
    /// <para>This composition used to be inline in the WinForms <c>TrayContext</c>, where no test project could
    /// reach it (net10.0-windows vs the net10.0 test assembly), so the fleet rules that actually ran had zero
    /// coverage while the suite asserted a spawn plan the tray discarded.</para>
    /// </summary>
    public sealed class TwincatFleet : IDisposable
    {
        private readonly BridgeSupervisor _supervisor = new();
        private readonly TwincatSupervisor _policy = new(); // decides which per-XAE TwinCAT workers to run
        private readonly ProbeHealth _probe = new();       // speaks only when the probe starts or stops working
        private readonly Func<string?, TimeSpan, System.Collections.Generic.IReadOnlyList<int>?> _listPids;

        public TwincatFleet() : this(TwincatXaeProbe.ListPids) { }

        /// <summary>The pid probe, as a seam. It is the ONE part of this loop a test cannot drive: it spawns a
        /// COM-isolated subprocess and reads its stdout, so without this the composition below — the thing the
        /// class was extracted from the tray to make testable — could only be exercised by having real XAE
        /// windows open. Everything else (the reap policy, the supervisor, the probe-health edge detector) is
        /// already reachable; only the pid source was not.</summary>
        internal TwincatFleet(Func<string?, TimeSpan, System.Collections.Generic.IReadOnlyList<int>?> listPids) =>
            _listPids = listPids;

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
            var pids = await Task.Run(() => _listPids(probeExe, probeTimeout));

            // SAY SO WHEN THE PROBE STOPS WORKING. Returning here on null is right — a persistently failing
            // probe must not reap every healthy worker — but it suspends spawn, respawn AND reap for as long as
            // it lasts, and it used to do that silently. `ProbeHealth` speaks only on a transition, so this is
            // two lines in the log per episode rather than one every third tick forever.
            // The transition line says supervision stopped; the diagnosis says WHY, observed rather than
            // guessed. Only gathered when the probe actually failed — enumerating windows on every healthy
            // tick would be work for nothing.
            if (_probe.Observe(pids != null) is { } transition)
                VoltLog.Warn(pids == null
                    ? transition + " " + (ProbeDiagnosis.Explain(XaeWindows.Snapshot()) ?? "")
                    : transition);

            if (pids == null) return;                                      // probe FAILED (not "no XAE") — leave the fleet as-is
            var reap = _policy.Reap(pids);
            foreach (var pid in pids)
                _supervisor.EnsureWorker(new WorkerSpec(WorkerId(pid), probeExe, $"{WorkerCli.XaePid} {pid}"));
            foreach (var pid in reap)
                _supervisor.StopWorker(WorkerId(pid));
        }

        /// <summary>Kill one worker; the next <see cref="Tick"/> respawns it while its XAE is still live.</summary>
        public void StopWorker(string id) => _supervisor.StopWorker(id);

        /// <summary>Is that worker's process alive? The fleet's observable state, and what makes <see cref="Tick"/>
        /// assertable without reaching past it into the supervisor.</summary>
        public bool IsWorkerRunning(string id) => _supervisor.IsWorkerRunning(id);

        public void Dispose() => _supervisor.Dispose();
    }
}
