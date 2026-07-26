using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Cli.Transport;

namespace Volt.Cli.Connector
{
    /// <summary>What one reconcile pass decided: retarget these bridges to serve (<see cref="ToBind"/>), gate these
    /// (<see cref="ToUnbind"/>). Both are BEST-EFFORT — a failed op simply recurs next pass, because the plan is
    /// recomputed from the bridges' ACTUAL serving state every time, never from a "desired == already done" cache.</summary>
    public sealed record ReconcilePlan(IReadOnlyList<DetectedProject> ToBind, IReadOnlyList<DetectedProject> ToUnbind);

    /// <summary>
    /// The PURE heart of the session model. Given the live sessions, the tray's force-off set, the detected projects
    /// (each carrying its real per-row serving state), and the clock, it decides which bridges to bind and unbind so
    /// that <b>a project serves iff some non-expired session wants it and it is not force-off</b> —
    /// <c>desired = ⋃ interests over live sessions \ forceOff</c>. No I/O, no stored state: call it, apply the plan,
    /// discard it. The <see cref="ConnectionManager"/> re-runs it (serialized) on every sync, lease sweep, and
    /// detection change, so the loop is self-correcting.
    /// </summary>
    public static class Reconciler
    {
        /// <param name="startupGraceUntil">Until this instant, UNBIND is suppressed (bind is never delayed) so a
        /// just-(re)started connector does not unbind still-wanted projects before live clients re-declare their
        /// interests. Pass <see cref="DateTime.MinValue"/> for steady state (no grace).</param>
        public static ReconcilePlan Plan(
            IReadOnlyCollection<Session> sessions,
            IReadOnlyCollection<string> forceOff,
            IReadOnlyList<DetectedProject> detected,
            DateTime nowUtc,
            DateTime startupGraceUntil)
        {
            // desired IDENTITIES: union of interests over non-expired sessions, each resolved to a detected project
            // by vendor+name (matchesBinding), minus force-off. An interest whose project isn't detected right now
            // resolves to nothing and simply waits — no error, no bind.
            var wanted = new HashSet<string>(StringComparer.Ordinal);
            foreach (var s in sessions)
            {
                if (s.ExpiresAt <= nowUtc) continue; // lapsed lease contributes nothing
                foreach (var i in s.Interests)
                {
                    var p = Resolve(i, detected);
                    if (p != null && !forceOff.Contains(p.Id)) wanted.Add(p.Id);
                }
            }

            var inGrace = nowUtc < startupGraceUntil;
            var toBind = new List<DetectedProject>();
            var toUnbind = new List<DetectedProject>();

            // Group by HOST — the pipe a bridge serves. CODESYS is per-pid, so one project per host: no contention.
            // A TwinCAT XAE worker can hold several projects on ONE pipe and serve only one at a time; grouping by
            // pipe is what lets us honour that limit WITHOUT thrashing (a null pipe — only in unit fixtures — is its
            // own isolated host, never a false sibling).
            foreach (var host in detected.GroupBy(p => p.Pipe ?? p.Id, StringComparer.Ordinal))
            {
                var rows = host.ToList();

                // Unbind every serving row this pass does not want — unless still inside the startup grace, where an
                // unbind could gate a project whose client just hasn't re-declared yet. Binds are never suppressed.
                if (!inGrace)
                    foreach (var p in rows.Where(p => p.Serving && !wanted.Contains(p.Id)))
                        toUnbind.Add(p);

                // If a WANTED row already serves on this host, keep it and bind nothing else here. This is how the
                // one-project-per-worker limit resolves with no churn: the incumbent holds, its wanted siblings stay
                // idle, and the last imperative Connect (which set who serves) wins by simply being the one serving.
                if (rows.Any(p => p.Serving && wanted.Contains(p.Id))) continue;

                // Otherwise nothing wanted serves here yet (cold start, or the unwanted incumbent above is being
                // gated): bind ONE wanted-but-idle row. Deterministic pick keeps the choice stable across passes;
                // switching which sibling serves on a shared worker is an explicit Connect, not the auto-loop's job.
                var candidate = rows.Where(p => wanted.Contains(p.Id) && !p.Serving)
                                    .OrderBy(p => p.Id, StringComparer.Ordinal)
                                    .FirstOrDefault();
                if (candidate != null) toBind.Add(candidate);
            }

            return new ReconcilePlan(toBind, toUnbind);
        }

        /// <summary>Resolve a durable interest to the currently-detected project by vendor+name — the same match
        /// <c>boundStatus</c>/<c>reconnectBound</c> use. Null when that project isn't detected (its IDE is closed);
        /// the interest then waits until it reappears. Same-name collapse upstream makes this a lookup, not an
        /// ambiguity — at most one detected row per (vendor, name).</summary>
        private static DetectedProject? Resolve(Interest i, IReadOnlyList<DetectedProject> detected) =>
            detected.FirstOrDefault(p => p.Vendor == i.Vendor && p.DisplayName == i.ProjectName);
    }
}
