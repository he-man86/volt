namespace Volt.Connector
{
    /// <summary>
    /// Whether the XAE probe is working, and the ONE message to log when that answer changes.
    ///
    /// <para><b>A failing probe suspends the whole TwinCAT fleet, and it used to do so in complete silence.</b>
    /// <see cref="TwincatXaeProbe.ListPids"/> returns null when the enumeration fails — a hard timeout, a
    /// non-zero exit, a spawn that did not start — and <see cref="TwincatFleet.Tick"/> then returns without
    /// touching anything. That is the RIGHT behaviour (a persistently failing probe must not reap every healthy
    /// worker), but it means no worker is spawned, respawned or reaped for as long as it lasts. A worker that
    /// dies in that window stays dead, and the engineer sees a bridge that stopped existing with nothing
    /// anywhere saying why.</para>
    ///
    /// <para><b>It is reachable, and the window is not small.</b> The tray gives the probe 6 seconds. Measured
    /// on 2026-09-01: a clean machine answers in 156-227ms, but with a stale XAE left over from an earlier
    /// session the COM ROT walk blocked past 180 SECONDS — thirty times the budget. The probe is killed and
    /// reports failure every tick for as long as that instance is around. The same slowdown happens under
    /// ordinary load, which is exactly when a worker is most likely to need respawning: three consecutive runs
    /// of the TwinCAT e2e suite produced 4, 1 and 2 failures, and the tier has no way to tell you supervision
    /// had stopped.</para>
    ///
    /// <para><b>Edge-triggered, not once-only.</b> The probe runs every third tick forever, so logging each
    /// failure would bury the log; logging only the first would never tell you it came back. Both TRANSITIONS
    /// are what an engineer needs — when supervision stopped, and when it resumed.</para>
    ///
    /// <para>Split out from the fleet because it is a pure state machine and the fleet is not: everything else
    /// in <see cref="TwincatFleet.Tick"/> spawns real processes. Its caller is there, one file over.</para>
    /// </summary>
    public sealed class ProbeHealth
    {
        private bool _failing;

        /// <summary>Record a probe outcome and return the line to log, or null when nothing changed.</summary>
        /// <param name="succeeded">False when the probe could not enumerate — a null from <c>ListPids</c>.</param>
        public string? Observe(bool succeeded)
        {
            if (succeeded == !_failing) return null;      // no transition
            _failing = !succeeded;
            // NO GUESS AT THE CAUSE HERE. This sentence used to end with "usually a TwinCAT window that is busy
            // or left over from an earlier session … closing stale TcXaeShell windows clears it" — a theory,
            // written by whoever last had one. `ProbeDiagnosis` now supplies the cause from what is actually on
            // the desktop, and the caller appends it. Keeping both produced a log line that guessed and then
            // contradicted itself in the same breath: "usually a stale window" followed by "all windows look
            // responsive with no dialog open".
            return _failing
                ? "the TwinCAT XAE probe is failing — worker supervision is SUSPENDED (no worker will be " +
                  "started, restarted or stopped) until it answers again."
                : "the TwinCAT XAE probe recovered — worker supervision resumed.";
        }
    }
}
