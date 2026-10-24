using System;
using System.Linq;
using System.Threading.Tasks;
using Volt.Contracts;

namespace Volt.Connector
{
    /// <summary>The TwinCAT worker builds the connector ships, one per XAE bitness (DIALECT C2t): the worker reads the
    /// XAE's Solution Explorer in-process, through the XAE's own msenvp proxy, so it must have the XAE's bitness — the
    /// x86 build for TcXaeShell (4024), the x64 build for TcXaeShell64 (4026). Null = that build is not there.</summary>
    public sealed record TwincatWorkers(string? X86, string? X64)
    {
        /// <summary>The build that serves an XAE of this bitness.</summary>
        public string? For(bool xaeIs32Bit) => xaeIs32Bit ? X86 : X64;

        /// <summary>The build that runs the pid probe (<c>--list-xae-pids</c>): the ROT lists every XAE to a process of
        /// either bitness, so it is whichever build is there, the x64 one first (the connector's own bitness).</summary>
        public string? Probe => !string.IsNullOrEmpty(X64) ? X64 : !string.IsNullOrEmpty(X86) ? X86 : null;
    }

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

        /// <summary>The XAE shells on this machine with their elevation — none when the connector itself runs elevated
        /// (it then sees an elevated XAE in the ROT like any other).</summary>
        private readonly Func<System.Collections.Generic.IReadOnlyList<(int Pid, bool? Elevated)>> _shells;
        private readonly System.Collections.Generic.HashSet<int> _elevatedOutOfSight = new();

        /// <summary>The XAE's bitness by pid (null = unreadable), as a seam: it is a fact about real processes.</summary>
        private readonly Func<int, bool?> _xaeIs32Bit;
        private readonly System.Collections.Generic.HashSet<int> _unservable = new();

        public TwincatFleet() : this(TwincatXaeProbe.ListPids, MachineShells, Volt.Wire.ProcessBitness.Is32Bit) { }

        private static System.Collections.Generic.IReadOnlyList<(int Pid, bool? Elevated)> MachineShells() =>
            Volt.Wire.ProcessElevation.Self()
                ? Array.Empty<(int, bool?)>()
                : Volt.Wire.ProcessElevation.Of(ConnectorVendors.TwincatShellProcesses);

        /// <summary>The pid probe, the shells and the XAE bitness, as seams. The probe is the part of this loop a test
        /// cannot drive: it spawns a COM-isolated subprocess and reads its stdout, so without this the composition
        /// below — the thing the class was extracted from the tray to make testable — could only be exercised by having
        /// real XAE windows open. Which XAE runs elevated, and its bitness, are facts about real processes.</summary>
        internal TwincatFleet(Func<string?, TimeSpan, System.Collections.Generic.IReadOnlyList<int>?> listPids,
            Func<System.Collections.Generic.IReadOnlyList<(int Pid, bool? Elevated)>> shells, Func<int, bool?> xaeIs32Bit)
        {
            _listPids = listPids;
            _shells = shells;
            _xaeIs32Bit = xaeIs32Bit;
        }

        /// <summary>The XAE pids this fleet has named as elevated and out of the probe's sight (environment-dependency-audit
        /// 2.2) — each named once in the log, for as long as the connector runs.</summary>
        public System.Collections.Generic.IReadOnlyCollection<int> ElevatedOutOfSight => _elevatedOutOfSight;

        /// <summary>The XAE pids this fleet has named as having no worker build of their bitness — each named once in the
        /// log, for as long as the connector runs.</summary>
        public System.Collections.Generic.IReadOnlyCollection<int> Unservable => _unservable;

        /// <summary>The worker id for one XAE window — the SAME string across spawn, reap and restart, so it is
        /// spelled exactly once.</summary>
        private static string WorkerId(int pid) => $"{ConnectorVendors.Twincat}.{pid}";

        /// <summary>One reconciliation pass. TwinCAT is per-XAE: probe the live XAE window pids (a COM-isolated
        /// subprocess, off the caller's thread), then keep exactly one worker per XAE — spawn/respawn one for each
        /// live pid (<see cref="BridgeSupervisor.EnsureWorker"/> is idempotent AND respawns a crashed one, so this
        /// also covers a worker that died while its XAE lived), and reap workers whose XAE has been gone long enough
        /// (the policy debounces a transient probe miss). CODESYS is in-proc — never spawned.</summary>
        public async Task Tick(TwincatWorkers workers, TimeSpan probeTimeout)
        {
            var probeExe = workers.Probe;
            if (probeExe is null) return;                                  // no worker binary (dev without a build)
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

            // AN XAE THE PROBE CANNOT SEE. Windows hides an elevated process's ROT entries from an unelevated one, so an
            // XAE run "as administrator" never reaches this list, gets no worker, and nothing said why — the engineer saw
            // a TwinCAT window and no bridge. Named once per pid; the CLI names it to the user (BridgeResolver.UnreachableXae).
            foreach (var (pid, elevated) in _shells())
                if (elevated == true && !pids.Contains(pid) && _elevatedOutOfSight.Add(pid))
                    VoltLog.Warn($"TwinCAT XAE pid {pid} runs elevated (\"as administrator\") and the connector does not — Windows "
                        + "hides it from the worker probe, so it gets no TwinCAT bridge. Start XAE without \"Run as administrator\", "
                        + "or run the connector elevated too.");
            var reap = _policy.Reap(pids);
            foreach (var pid in pids)
            {
                // The worker of the XAE's own bitness, or none: a worker of the other bitness cannot read that XAE's
                // Solution Explorer (DIALECT C2t). An unreadable bitness (the XAE exited since the probe) waits a pass.
                if (_xaeIs32Bit(pid) is not { } is32) continue;
                var exe = workers.For(is32);
                if (string.IsNullOrEmpty(exe))
                {
                    if (_unservable.Add(pid))
                        VoltLog.Error($"TwinCAT XAE pid {pid} is {(is32 ? "32" : "64")}-bit and the {(is32 ? "x86" : "x64")} TwinCAT "
                            + "worker is not installed beside the connector, so it gets no TwinCAT bridge. Reinstall Volt.");
                    continue;
                }
                _supervisor.EnsureWorker(new WorkerSpec(WorkerId(pid), exe, $"{WorkerCli.XaePid} {pid}"));
            }
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
