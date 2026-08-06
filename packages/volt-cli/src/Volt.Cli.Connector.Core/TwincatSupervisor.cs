using System.Collections.Generic;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// Decides which per-XAE TwinCAT workers to spawn and reap so there is exactly ONE worker per running XAE window.
    /// This is the PURE decision — no COM, no processes, no timers — so the flicker/reap policy is unit-tested with no
    /// live IDE. <see cref="TwincatFleet"/> drives it: each <c>Tick</c> hands it the pids returned by
    /// <see cref="TwincatXaeProbe"/> (a COM-isolated subprocess, never a tray-side ROT walk), and the returned
    /// <c>Reap</c> list names the <c>VoltBridgeTwincat --xae-pid</c> workers whose XAE has been gone long enough to stop.
    ///
    /// <para>Why per-XAE: TwinCAT automation is out-of-process COM, so (unlike CODESYS's forced in-proc host) a worker
    /// can own ONE window, attach by its stable process id, and serve <c>volt.bridge.twincat.&lt;pid&gt;</c> — giving
    /// CODESYS-identical per-pipe discovery and parallel ops. The cost is exactly this supervisor: CODESYS's in-proc
    /// host dies with the IDE for free; a TwinCAT worker is external, so the connector must start and stop it.</para>
    /// </summary>
    public sealed class TwincatSupervisor
    {
        /// <summary>Consecutive ticks an XAE must be ABSENT before its worker is reaped — a transient ROT gap (a busy
        /// DTE momentarily not enumerable) must not tear down a healthy worker.</summary>
        public const int ReapAfterMisses = 3;

        private sealed class Worker { public bool Spawned; public int Misses; }
        private readonly Dictionary<int, Worker> _workers = new();

        /// <summary>Reconcile against the currently-live XAE pids: spawn a worker for each newly-seen pid, and reap a
        /// worker whose pid has been absent for <see cref="ReapAfterMisses"/> consecutive ticks (debouncing flicker).
        /// A worker survives a short absence; only a sustained one reaps it, after which a returning pid spawns anew.</summary>
        public (IReadOnlyList<int> Spawn, IReadOnlyList<int> Reap) Reconcile(IReadOnlyCollection<int> liveXaePids)
        {
            var live = new HashSet<int>(liveXaePids);
            var spawn = new List<int>();
            var reap = new List<int>();

            // Present: reset the miss counter; spawn once per pid we don't yet have a worker for.
            foreach (var pid in live)
            {
                if (!_workers.TryGetValue(pid, out var w)) { w = new Worker(); _workers[pid] = w; }
                w.Misses = 0;
                if (!w.Spawned) { w.Spawned = true; spawn.Add(pid); }
            }

            // Absent: count misses; reap once a spawned worker has been gone long enough.
            foreach (var kv in _workers)
                if (!live.Contains(kv.Key) && kv.Value.Spawned && ++kv.Value.Misses >= ReapAfterMisses)
                    reap.Add(kv.Key);
            foreach (var pid in reap) _workers.Remove(pid);

            return (spawn, reap);
        }
    }
}
