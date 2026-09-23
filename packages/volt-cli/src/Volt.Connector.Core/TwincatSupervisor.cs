using System.Collections.Generic;

namespace Volt.Connector
{
    /// <summary>
    /// Decides which per-XAE TwinCAT workers to REAP, so a worker whose XAE window is gone does not outlive it.
    /// This is the PURE decision — no COM, no processes, no timers — so the flicker/reap policy is unit-tested
    /// with no live IDE. <see cref="TwincatFleet"/> drives it: each <c>Tick</c> hands it the pids returned by
    /// <see cref="TwincatXaeProbe"/> (a COM-isolated subprocess, never a tray-side ROT walk), and the returned
    /// list names the <c>VoltBridgeTwincat --xae-pid</c> workers whose XAE has been gone long enough to stop.
    ///
    /// <para><b>It used to decide spawns too, and nothing read them.</b> `Reconcile` returned
    /// `(Spawn, Reap)`; the only caller is `TwincatFleet.Tick`, which does `var (_, reap) = …` and then spawns
    /// unconditionally for every live pid via `EnsureWorker` — level-triggered, which is the right shape,
    /// because a worker that died between ticks has to come back without a fresh "newly seen" edge. So the
    /// spawn list was computed, returned, discarded, and asserted by four tests that pinned behaviour no
    /// production path could observe. `TrayContext.RestartWorker` had already found this out the hard way, and
    /// says so in a comment.</para>
    ///
    /// <para>Why per-XAE: TwinCAT automation is out-of-process COM, so (unlike CODESYS's forced in-proc host) a
    /// worker can own ONE window, attach by its stable process id, and serve
    /// <c>volt.bridge.twincat.&lt;pid&gt;</c> — giving CODESYS-identical per-pipe discovery and parallel ops. The
    /// cost is exactly this supervisor: CODESYS's in-proc host dies with the IDE for free; a TwinCAT worker is
    /// external, so the connector must stop it.</para>
    /// </summary>
    public sealed class TwincatSupervisor
    {
        /// <summary>Consecutive ticks an XAE must be ABSENT before its worker is reaped — a transient ROT gap (a busy
        /// DTE momentarily not enumerable) must not tear down a healthy worker.</summary>
        public const int ReapAfterMisses = 3;

        private readonly Dictionary<int, int> _misses = new();

        /// <summary>Reap the workers whose XAE pid has been absent for <see cref="ReapAfterMisses"/> consecutive
        /// ticks (debouncing flicker). A worker survives a short absence; only a sustained one reaps it, after
        /// which a returning pid is spawned again by the fleet's own level-triggered `EnsureWorker`.</summary>
        public IReadOnlyList<int> Reap(IReadOnlyCollection<int> liveXaePids)
        {
            var live = new HashSet<int>(liveXaePids);
            var reap = new List<int>();

            foreach (var pid in live) _misses[pid] = 0;   // present: reset the miss counter

            foreach (var pid in new List<int>(_misses.Keys))
                if (!live.Contains(pid) && ++_misses[pid] >= ReapAfterMisses)
                    reap.Add(pid);
            foreach (var pid in reap) _misses.Remove(pid);

            return reap;
        }
    }
}
