using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Cli.Transport;

namespace Volt.Cli.Connector
{
    /// <summary>What one reconcile pass decided: retarget these bridges to serve (<see cref="ToBind"/>), gate these
    /// (<see cref="ToUnbind"/>), and the project ids that are DESIRED this pass (<see cref="Wanted"/> — ∪ interests \
    /// forceOff, resolved to detected projects), so a caller can answer "connected" as serving ∧ wanted without
    /// recomputing. Bind/unbind are BEST-EFFORT — a failed op simply recurs next pass, because the plan is recomputed
    /// from the bridges' ACTUAL serving state every time, never from a "desired == already done" cache.</summary>
    public sealed record ReconcilePlan(
        IReadOnlyList<DetectedProject> ToBind,
        IReadOnlyList<DetectedProject> ToUnbind,
        IReadOnlyCollection<string> Wanted);

    /// <summary>
    /// The PURE heart of the session model. Given the live sessions, the tray's force-off set, what was wanted LAST
    /// pass, the detected projects (each carrying its real per-row serving state), and the clock, it decides which
    /// bridges to bind and unbind. No I/O, no stored state: call it, apply the plan, discard it. The
    /// <see cref="ConnectionManager"/> re-runs it (serialized) on every sync, lease sweep, and detection change, so
    /// the loop is self-correcting.
    ///
    /// <para><b>Bind is level-triggered; unbind is edge-triggered.</b> A bridge SERVES BY DEFAULT (a loaded IDE host
    /// serves its project), so "serve iff wanted" would gate every bridge no session has declared — breaking
    /// standalone <c>volt push</c> and gating a neighbour the moment you connect something else. Instead: RESUME any
    /// wanted-but-idle project (level), but only GATE a project the connector was already serving on a client's
    /// behalf and that the LAST interested session has now left (the wanted→unwanted edge), plus anything the tray
    /// force-offs. A project no session has ever wanted is left untouched.</para>
    ///
    /// <para>Edge-gating alone is NOT what covers a connector restart: <see cref="ConnectionManager"/> RESTORES
    /// <paramref name="previouslyWanted"/> from <c>wanted.json</c>, so the set is not empty after a restart (field
    /// incident 2026-07-28 — an empty set after an auto-update left a project serving that nothing could ever gate
    /// again). Because that restored set would otherwise gate everything in the seconds before clients re-declare,
    /// the manager holds unbinds of the RESTORED ids for a short startup grace window. Both live there; this
    /// function stays pure and knows nothing about either.</para>
    /// </summary>
    public static class Reconciler
    {
        /// <param name="previouslyWanted">The desired set from the last pass (the connector stores it). A project in
        /// here but no longer wanted is one whose last interested session left — the only thing (besides force-off)
        /// this pass will gate.</param>
        public static ReconcilePlan Plan(
            IReadOnlyCollection<Session> sessions,
            IReadOnlyCollection<string> forceOff,
            IReadOnlyCollection<string> previouslyWanted,
            IReadOnlyList<DetectedProject> detected,
            DateTime nowUtc)
        {
            // Always rebuild with the Ordinal comparer — never adopt the caller's set as-is: a project id is compared
            // ordinally everywhere else here, and an incoming OrdinalIgnoreCase set would silently make force-off the
            // one case-insensitive match in the function. It is a handful of ids; the allocation is irrelevant.
            var forceOffSet = new HashSet<string>(forceOff, StringComparer.Ordinal);

            // desired IDENTITIES: union of interests over non-expired sessions, each resolved to a detected project by
            // vendor+name (matchesBinding), minus force-off. An interest whose project isn't detected right now
            // resolves to nothing and simply waits — no error, no bind.
            var wanted = new HashSet<string>(StringComparer.Ordinal);
            foreach (var s in sessions)
            {
                if (s.ExpiresAt <= nowUtc) continue; // lapsed lease contributes nothing
                foreach (var i in s.Interests)
                {
                    var p = Resolve(i, detected);
                    if (p != null && !forceOffSet.Contains(p.Id)) wanted.Add(p.Id);
                }
            }

            // GATE (unbind): only a project we were serving on a client's behalf and no longer want (the last session
            // left it — the wanted→unwanted edge), OR one the tray force-offs. NEVER a bridge no session ever wanted:
            // that keeps its default serving state, so `volt push` from a terminal works and connecting one project
            // does not gate an untouched neighbour.
            var lost = new HashSet<string>(previouslyWanted, StringComparer.Ordinal);
            lost.ExceptWith(wanted);
            var toUnbind = detected.Where(p => p.Serving && (lost.Contains(p.Id) || forceOffSet.Contains(p.Id))).ToList();

            // RESUME (bind): any wanted-but-idle project, honouring the one-project-per-host limit. Group by HOST —
            // the pipe a bridge serves. CODESYS is per-pid (one project per host, no contention); a TwinCAT XAE worker
            // can hold several projects on ONE pipe and serve only one at a time. Grouping by pipe honours that WITHOUT
            // thrashing (a null pipe — only in unit fixtures — is its own isolated host, never a false sibling).
            var toBind = new List<DetectedProject>();
            foreach (var host in detected.GroupBy(p => p.Pipe ?? p.Id, StringComparer.Ordinal))
            {
                var rows = host.ToList();

                // A WANTED row already serving on this host holds it — bind nothing else here (the one-per-worker
                // limit resolves with no churn: the incumbent stays, wanted siblings wait, the last Connect wins by
                // being the one serving).
                if (rows.Any(p => p.Serving && wanted.Contains(p.Id))) continue;

                // Otherwise nothing wanted serves here yet: bind ONE wanted-but-idle row. Deterministic pick keeps the
                // choice stable across passes; switching which sibling serves on a shared worker is an explicit Connect.
                var candidate = rows.Where(p => wanted.Contains(p.Id) && !p.Serving)
                                    .OrderBy(p => p.Id, StringComparer.Ordinal)
                                    .FirstOrDefault();
                if (candidate != null) toBind.Add(candidate);
            }

            return new ReconcilePlan(toBind, toUnbind, wanted);
        }

        /// <summary>Resolve a durable interest to the currently-detected project by vendor+name — the same match
        /// <c>boundStatus</c>/<c>reconnectBound</c> use. Null when that project isn't detected (its IDE is closed);
        /// the interest then waits until it reappears. Same-name collapse upstream makes this a lookup, not an
        /// ambiguity — at most one detected row per (vendor, name). Matched against <see cref="DetectedProject.Attach"/>
        /// — the BINDING name the interest is declared from (the same field the TS client's <c>matchesBinding</c> and
        /// the control plane's <c>ProjectView.ProjectName</c> use), not the display label.</summary>
        private static DetectedProject? Resolve(Interest i, IReadOnlyList<DetectedProject> detected) =>
            detected.FirstOrDefault(p => p.Vendor == i.Vendor && p.Attach.Project == i.ProjectName);
    }
}
