using System;
using System.Collections.Generic;
using System.Linq;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Volt.Cli.Transport;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// The core of the connection model. Owns the merged, vendor-agnostic list of detected projects across every
    /// <see cref="IProjectSource"/>, the client <b>sessions</b> and their declared <b>interests</b>, the tray's
    /// force-off overrides, and the <b>reconcile loop</b> that binds/unbinds bridges so a project serves iff a live
    /// session wants it and it is not force-off. The tray and the control plane are thin views over this — neither
    /// branches on vendor.
    ///
    /// <para><b>Declared desired-state, the only model.</b> A client (a desktop instance, a VS Code window) opens a
    /// <see cref="Session"/> and, on every sync, declares the FULL set of projects it is currently using.
    /// <c>desired = ⋃ interests over non-expired sessions \ forceOff</c>; the pure <see cref="Reconciler"/> turns that
    /// into bind/unbind actions applied here. A client going away — cleanly (<c>CloseSession</c>) or by crash (its
    /// lease lapses) — is just "its interests disappeared". There is no imperative connect/disconnect and no single
    /// "active connection" highlight.</para>
    ///
    /// <para><b>Concurrency.</b> Everything observable lives in ONE immutable <see cref="State"/> behind a single
    /// volatile field; writers build a new State and publish it with one assignment, readers answer from one local
    /// copy. Detection, session mutation and reconcile all run under the single <see cref="_gate"/> (a read-modify-write
    /// of the sessions map — never a lock-free swap — so two syncs landing together cannot lose one's interests).</para>
    /// </summary>
    public sealed class ConnectionManager
    {
        /// <summary>One consistent generation of everything observable. Immutable by construction.</summary>
        private sealed record State(
            IReadOnlyList<DetectedProject> Projects,
            /// <summary>Per-PROJECT ground truth, keyed by <see cref="DetectedProject.Id"/>: is this project's own
            /// bridge serving it right now (read from the bridge every scan, never cached as "desired == done").</summary>
            IReadOnlyDictionary<string, bool> Serving,
            /// <summary>Live client sessions by id, each with its declared interests and a lease expiry. The reconcile
            /// input; a session past its expiry contributes nothing.</summary>
            IReadOnlyDictionary<string, Session> Sessions,
            /// <summary>Tray force-off overrides, by project id — kept unbound regardless of interest until cleared.
            /// Connector-lifetime by design (a restart clears them; the "stuck bridge" they guarded is a fresh process).</summary>
            IReadOnlyCollection<string> ForceOff,
            /// <summary>The project ids currently DESIRED (∪ interests \ forceOff, resolved to detected projects) as of
            /// the last reconcile — so "connected" answers (Aggregate) need only serving ∧ wanted, no recompute.</summary>
            IReadOnlyCollection<string> Wanted,
            /// <summary>Did ANY source's bridge answer this tick — the one bit the flat rows can't express (a bridge up
            /// with no project open yields zero rows, same as a bridge that is down). Drives the "up, waiting" colour.</summary>
            bool AnyReachable);

        private readonly IReadOnlyList<IProjectSource> _sources;
        private readonly Dictionary<string, IProjectSource> _byVendor;
        private readonly TimeSpan _leaseTtl;
        // How long after start we hold disconnects so clients can re-declare (see CycleCoreAsync).
        private static readonly TimeSpan GateHold = TimeSpan.FromSeconds(20);
        private readonly DateTime _gateHoldUntil;
        private volatile State _state;

        // Detection, session mutation and reconcile are all WRITERS and must not interleave, so they share ONE gate.
        // Readers never block (they take the latest published State).
        private readonly SemaphoreSlim _gate = new(1, 1);
        private DateTime _lastRefreshUtc = DateTime.MinValue;

        /// <param name="leaseTtl">How long a session's lease lives without a renewing sync. Should be ≥3× the client
        /// poll so a single slow poll never drops a live client. Default 15s (poll is ~4s).</param>
        public ConnectionManager(IReadOnlyList<IProjectSource> sources, TimeSpan leaseTtl = default)
        {
            _sources = sources;
            _byVendor = sources.ToDictionary(s => s.Vendor);
            _leaseTtl = leaseTtl == default ? TimeSpan.FromSeconds(15) : leaseTtl;
            _gateHoldUntil = DateTime.UtcNow + GateHold;
            _state = new State(
                Array.Empty<DetectedProject>(),
                new Dictionary<string, bool>(),
                new Dictionary<string, Session>(),
                // `Wanted` is RESTORED from disk, not empty. Gating is edge-triggered ("was wanted, now isn't"), so a
                // connector that starts blank has no edge for anything it was serving before — and an auto-update
                // restarts us mid-session. Field incident 2026-07-28: after an update a project sat `healthy` with
                // every client closed, and nothing could ever gate it again. Restoring the set restores the edge.
                LoadWanted(),
                Array.Empty<string>(),
                AnyReachable: false);
        }

        /// <summary>The merged list the unified selector shows — one entry per detected project, all vendors.</summary>
        public IReadOnlyList<DetectedProject> Projects => _state.Projects;

        public IReadOnlyList<IProjectSource> Sources => _sources;

        /// <summary>Is this project's bridge serving it right now — the single signal every surface renders from.</summary>
        public bool IsServingProject(string projectId) => _state.Serving.TryGetValue(projectId, out var s) && s;

        /// <summary>Does any live session still WANT this project? Distinguishes a deliberate disconnect (nobody wants
        /// it any more) from an incident (still wanted, stopped serving) — see the tray's disconnect notification.</summary>
        public bool IsWantedProject(string projectId) => _state.Wanted.Contains(projectId);

        /// <summary>Human platform name for a vendor id ("codesys" → "CODESYS").</summary>
        public string DisplayNameOf(string vendor) =>
            _byVendor.TryGetValue(vendor, out var s) ? s.DisplayName : vendor;

        // ── the session API (declarative desired-state) ──────────────────────────────────────────────────────────

        /// <summary>Open a session and return its id + the lease seconds the client must renew within. Registers an
        /// empty-interest session — no reconcile (a session that declares nothing can't change <c>desired</c>); the
        /// client's first sync reconciles.</summary>
        public async Task<(string SessionId, double LeaseSeconds)> OpenSessionAsync()
        {
            var id = Guid.NewGuid().ToString("N");
            await _gate.WaitAsync().ConfigureAwait(false);
            try { UpsertSession(id, Array.Empty<Interest>()); }
            finally { _gate.Release(); }
            Log.Info($"session {Short(id)} opened (a client connected; lease {_leaseTtl.TotalSeconds:0}s)");
            return (id, _leaseTtl.TotalSeconds);
        }

        /// <summary>Declare a session's FULL current interest set (idempotent), renew its lease, and reconcile. Upserts
        /// an unknown id, so a client whose session was lost to a connector restart transparently re-establishes it on
        /// its next poll.</summary>
        public async Task SyncAsync(string sessionId, IReadOnlyCollection<Interest> interests)
        {
            await _gate.WaitAsync().ConfigureAwait(false);
            try
            {
                // Log the DECLARATION, not the poll: a client re-declares the same set every few seconds, so only a
                // real change is worth a line. This is the "who asked for what" half of every connection question.
                var now = Describe(interests);
                if (!_state.Sessions.TryGetValue(sessionId, out var prior) || Describe(prior.Interests) != now)
                    Log.Info($"session {Short(sessionId)} declares {now}");
                UpsertSession(sessionId, interests);
                await CycleCoreAsync().ConfigureAwait(false);
            }
            finally { _gate.Release(); }
        }

        private static string Short(string sessionId) => sessionId.Length <= 8 ? sessionId : sessionId.Substring(0, 8);

        private static string Describe(IReadOnlyCollection<Interest> interests) =>
            interests.Count == 0 ? "no projects" : string.Join(", ", interests.Select(i => $"{i.Vendor}/{i.ProjectName}"));

        /// <summary>Drop a session immediately (clean shutdown) — its interests leave <c>desired</c> at once rather
        /// than after the lease TTL.</summary>
        public async Task CloseSessionAsync(string sessionId)
        {
            await _gate.WaitAsync().ConfigureAwait(false);
            try
            {
                var s = _state;
                if (s.Sessions.ContainsKey(sessionId))
                {
                    Log.Info($"session {Short(sessionId)} closed (client shut down cleanly)");
                    var next = new Dictionary<string, Session>(s.Sessions);
                    next.Remove(sessionId);
                    _state = s with { Sessions = next };
                }
                await CycleCoreAsync().ConfigureAwait(false);
            }
            finally { _gate.Release(); }
        }

        /// <summary>The projects the tray has force-offed (supervisor override), by id — so the tray can render the
        /// paused rows and offer "resume".</summary>
        public IReadOnlyCollection<string> ForceOffIds => _state.ForceOff;

        /// <summary>Set or clear the tray's force-off for a project id (the supervisor escape hatch for a stuck
        /// bridge): while set, reconcile keeps that project unbound regardless of any session's interest.</summary>
        public Task SetForceOffAsync(string projectId, bool forceOff) => SetForceOffAsync(new[] { projectId }, forceOff);

        /// <summary>Batch form — set/clear force-off for several projects in ONE reconcile (the tray's pause/resume).</summary>
        public async Task SetForceOffAsync(IReadOnlyCollection<string> projectIds, bool forceOff)
        {
            if (projectIds.Count == 0) return;
            await _gate.WaitAsync().ConfigureAwait(false);
            try
            {
                var s = _state;
                var set = new HashSet<string>(s.ForceOff, StringComparer.Ordinal);
                foreach (var id in projectIds) { if (forceOff) set.Add(id); else set.Remove(id); }
                _state = s with { ForceOff = set };
                await CycleCoreAsync().ConfigureAwait(false);
            }
            finally { _gate.Release(); }
        }

        /// <summary>Replace a session's interests + renew its lease (read-modify-write under the gate). Creates the
        /// session if absent.</summary>
        private void UpsertSession(string sessionId, IReadOnlyCollection<Interest> interests)
        {
            var s = _state;
            var next = new Dictionary<string, Session>(s.Sessions)
            {
                [sessionId] = new Session(sessionId, interests, DateTime.UtcNow + _leaseTtl),
            };
            _state = s with { Sessions = next };
        }

        // ── detection + reconcile ────────────────────────────────────────────────────────────────────────────────

        /// <summary>Re-scan every source, sweep lapsed leases, and reconcile. A source that is unreachable simply
        /// contributes nothing (never throws the whole refresh). This is the periodic tray tick's one call.</summary>
        public async Task RefreshAsync()
        {
            await _gate.WaitAsync().ConfigureAwait(false);
            try { PruneExpiredSessions(); await CycleCoreAsync().ConfigureAwait(false); }
            finally { _gate.Release(); }
        }

        /// <summary>Refresh only if the snapshot is older than <paramref name="maxAge"/> — so a client's GET reads LIVE
        /// state instead of whatever the 4s tick last cached, without every polling client re-probing every pipe.</summary>
        public async Task RefreshIfStaleAsync(TimeSpan maxAge)
        {
            if (DateTime.UtcNow - _lastRefreshUtc < maxAge) return;
            await _gate.WaitAsync().ConfigureAwait(false);
            try
            {
                if (DateTime.UtcNow - _lastRefreshUtc < maxAge) return; // a queued caller refreshed it for us
                PruneExpiredSessions();
                await CycleCoreAsync().ConfigureAwait(false);
            }
            finally { _gate.Release(); }
        }

        /// <summary>ONE reconcile cycle (caller holds the gate): scan → plan → apply bind/unbind → re-scan to reflect
        /// the new serving state → publish the desired set. Bind/unbind are best-effort; a failure just recurs next
        /// cycle, because the plan is recomputed from the bridges' ACTUAL serving state every time.</summary>
        private async Task CycleCoreAsync()
        {
            await ScanIntoStateAsync().ConfigureAwait(false);
            var s = _state;
            var plan = Reconciler.Plan(s.Sessions.Values.ToList(), s.ForceOff, s.Wanted, s.Projects, DateTime.UtcNow);

            // A restored `Wanted` would gate everything in the seconds BEFORE the clients have re-declared — the app
            // and the connector come back together after an update, and whoever loses that race would see its bridge
            // gated out from under it. So hold unbinds during a short startup window: a client that re-declares
            // inside it keeps its project (no edge), and anything still unwanted when the window closes is gated for
            // real. Binds are never held — resuming a wanted project early is always safe.
            if (plan.ToUnbind.Count > 0 && DateTime.UtcNow < _gateHoldUntil)
            {
                Log.Info($"reconcile: holding {plan.ToUnbind.Count} disconnect(s) — startup grace, waiting for clients to re-declare");
                plan = plan with { ToUnbind = Array.Empty<DetectedProject>() };
            }

            if (plan.ToUnbind.Count > 0 || plan.ToBind.Count > 0)
            {
                // The decision, before it is applied — so a log read after the fact says what the connector INTENDED,
                // and the serving-transition lines below say what actually came of it.
                if (plan.ToBind.Count > 0) Log.Info($"reconcile: connecting {string.Join(", ", plan.ToBind.Select(p => p.Id))}");
                if (plan.ToUnbind.Count > 0) Log.Info($"reconcile: disconnecting {string.Join(", ", plan.ToUnbind.Select(p => p.Id))} (no live session wants it)");
                foreach (var p in plan.ToUnbind) await SafeUnbindAsync(p).ConfigureAwait(false);
                foreach (var p in plan.ToBind) await SafeBindAsync(p).ConfigureAwait(false);

                var before = s.Serving;
                await ScanIntoStateAsync().ConfigureAwait(false); // reflect what the bridges now serve
                // What actually changed, per project. A plan that did NOT take effect is the interesting case (a
                // bridge that refused to gate stays serving with nobody wanting it), and it was invisible before.
                foreach (var kv in _state.Serving)
                {
                    before.TryGetValue(kv.Key, out var was);
                    if (was != kv.Value) Log.Info($"{kv.Key} is now {(kv.Value ? "SERVING" : "gated")}");
                }
                foreach (var p in plan.ToUnbind)
                    if (_state.Serving.TryGetValue(p.Id, out var still) && still)
                        Log.Warn($"{p.Id} still serving after a disconnect was applied — the bridge did not gate");
            }

            if (!plan.Wanted.SequenceEqual(_state.Wanted)) SaveWanted(plan.Wanted); // so a restart inherits the edge
            _state = _state with { Wanted = plan.Wanted };
        }

        /// <summary>Scan every source CONCURRENTLY (a slow/hung bridge must not stall the others), merge into the one
        /// list, and publish — carrying Sessions/ForceOff/Wanted forward.</summary>
        private async Task ScanIntoStateAsync()
        {
            var prior = _state;

            var scans = await Task.WhenAll(_sources.Select(async src =>
            {
                try { return await src.ScanAsync().ConfigureAwait(false); }
                catch { return new SourceScan(Array.Empty<DetectedProject>(), Reachable: false); }
            })).ConfigureAwait(false);
            var anyReachable = Array.Exists(scans, x => x.Reachable);

            // Identity is vendor+name, so two same-named projects collapse to ONE row (stable order); among a pair,
            // prefer the SERVING instance so the UI shows/connects the connected one.
            var indexById = new Dictionary<string, int>();
            var merged = new List<DetectedProject>();
            foreach (var p in scans.SelectMany(x => x.Projects))
            {
                if (indexById.TryGetValue(p.Id, out var idx))
                {
                    if (p.Serving && !merged[idx].Serving) merged[idx] = p;
                }
                else { indexById[p.Id] = merged.Count; merged.Add(p); }
            }

            var serving = merged.ToDictionary(p => p.Id, p => p.Serving);
            _state = prior with { Projects = merged, Serving = serving, AnyReachable = anyReachable };
            _lastRefreshUtc = DateTime.UtcNow;
        }

        // Bind/unbind stay best-effort, but a swallowed failure is now VISIBLE: silently eating them is what let a
        // bridge sit "connected" that no client had asked for, with nothing anywhere saying why.
        private async Task SafeBindAsync(DetectedProject p)
        {
            if (_byVendor.TryGetValue(p.Vendor, out var src))
                try { await src.BindAsync(p).ConfigureAwait(false); }
                catch (Exception e) { Log.Warn($"connect {p.Id} failed: {e.Message} (retried next cycle)"); }
        }

        private async Task SafeUnbindAsync(DetectedProject p)
        {
            if (_byVendor.TryGetValue(p.Vendor, out var src))
                try { await src.UnbindAsync(p).ConfigureAwait(false); }
                catch (Exception e) { Log.Warn($"disconnect {p.Id} failed: {e.Message}"); }
        }

        // The desired set, across restarts. Tiny and best-effort: losing it costs one stranded bridge (the old
        // behaviour), never correctness, so it must never throw or block a reconcile.
        private static string WantedFile =>
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) is { Length: > 0 } d ? d : Path.GetTempPath(),
                "Volt", "wanted.json");

        private static IReadOnlyCollection<string> LoadWanted()
        {
            try
            {
                if (!File.Exists(WantedFile)) return Array.Empty<string>();
                return JsonSerializer.Deserialize<string[]>(File.ReadAllText(WantedFile)) ?? Array.Empty<string>();
            }
            catch { return Array.Empty<string>(); }
        }

        private static void SaveWanted(IReadOnlyCollection<string> wanted)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(WantedFile)!);
                File.WriteAllText(WantedFile, JsonSerializer.Serialize(wanted.ToArray()));
            }
            catch (Exception e) { Log.Warn($"could not persist the desired set: {e.Message}"); }
        }

        /// <summary>Drop sessions whose lease has lapsed (crash / lost connector). Reconcile ignores expired sessions
        /// anyway; pruning just keeps the map small. Caller holds the gate.</summary>
        private void PruneExpiredSessions()
        {
            var s = _state;
            var now = DateTime.UtcNow;
            if (!s.Sessions.Values.Any(v => v.ExpiresAt <= now)) return;
            // A lapsed lease is a client that died without closing (crash, kill, machine sleep) — the difference
            // between "the app shut down" and "the app vanished" is exactly what a support log needs to show.
            foreach (var kv in s.Sessions.Where(kv => kv.Value.ExpiresAt <= now))
                Log.Info($"session {Short(kv.Key)} lease lapsed after {(now - kv.Value.ExpiresAt + _leaseTtl).TotalSeconds:0}s — client gone without closing ({Describe(kv.Value.Interests)})");
            var next = s.Sessions.Where(kv => kv.Value.ExpiresAt > now).ToDictionary(kv => kv.Key, kv => kv.Value);
            _state = s with { Sessions = next };
        }

        /// <summary>The single status the tray icon reflects: green (or degraded) iff some project is BOTH serving and
        /// WANTED — an open-but-unconnected IDE (serving yet in no session's interests) must not paint the tray green,
        /// which was the exact bug the desired requirement guards. Nothing wanted-and-serving: "up, waiting" if any
        /// channel is reachable, else nothing there.</summary>
        public BridgeStatus Aggregate()
        {
            var s = _state; // ONE generation for the whole answer
            var servedWanted = s.Projects.Where(p => p.Serving && s.Wanted.Contains(p.Id)).ToList();
            if (servedWanted.Count > 0)
                return servedWanted.Any(p => p.Status == HealthStatus.Degraded) ? BridgeStatus.Degraded : BridgeStatus.Connected;

            return s.AnyReachable ? BridgeStatus.Unavailable : BridgeStatus.Unknown;
        }
    }
}
