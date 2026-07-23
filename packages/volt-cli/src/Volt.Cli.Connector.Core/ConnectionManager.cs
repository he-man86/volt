using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// The core of the connection model. Owns the merged, vendor-agnostic list of detected projects across every
    /// <see cref="IProjectSource"/>, the per-vendor health + current selection, the bind dispatch, and the one
    /// aggregate status the tray colour reflects. The tray, the branded window, and the control plane are ALL
    /// thin views over this — none of them branch on vendor. Vendor lives only inside the sources (below) and as
    /// a field on <see cref="DetectedProject"/> (for the prefix/logo + routing).
    /// </summary>
    public sealed class ConnectionManager
    {
        private readonly IReadOnlyList<IProjectSource> _sources;
        private readonly Dictionary<string, IProjectSource> _byVendor;
        // Replaced wholesale, never mutated in place — a refresh can now run on a control-plane threadpool thread
        // while the tray's UI thread reads these, and mutating a plain Dictionary under a concurrent reader throws
        // ("collection was modified") or tears. Every write below builds a new map and publishes it.
        private IReadOnlyDictionary<string, BridgeHealth> _health = new Dictionary<string, BridgeHealth>();
        private IReadOnlyDictionary<string, DetectedProject?> _selected = new Dictionary<string, DetectedProject?>();
        // Per-PROJECT serving state, keyed by DetectedProject.Id — the ground truth "is this project's bridge
        // actually serving it right now". Distinct from _selected (a tray highlight) and from _health (per VENDOR,
        // which is ambiguous the moment two CODESYS instances run). Everything user-facing derives from this.
        private IReadOnlyDictionary<string, bool> _serving = new Dictionary<string, bool>();
        private IReadOnlyList<DetectedProject> _projects = Array.Empty<DetectedProject>();

        // A refresh runs on the tray's timer AND on demand from the control plane, so it must not run twice at
        // once: the gate serializes it, and both _projects/_serving are REPLACED wholesale (never mutated in
        // place) so a concurrent reader always sees one consistent generation.
        private readonly SemaphoreSlim _refreshGate = new(1, 1);
        private DateTime _lastRefreshUtc = DateTime.MinValue;

        public ConnectionManager(IReadOnlyList<IProjectSource> sources)
        {
            _sources = sources;
            _byVendor = sources.ToDictionary(s => s.Vendor);
            _health = sources.ToDictionary(s => s.Vendor, _ => new BridgeHealth { Status = BridgeStatus.Unknown });
            _selected = sources.ToDictionary(s => s.Vendor, _ => (DetectedProject?)null);
        }

        /// <summary>A connect succeeded — carry the project so the UI can toast "Connected to X (vendor)".</summary>
        public event Action<DetectedProject>? Connected;

        /// <summary>The merged list the unified selector shows — one entry per detected project, all vendors.</summary>
        public IReadOnlyList<DetectedProject> Projects => _projects;

        public IReadOnlyList<IProjectSource> Sources => _sources;

        public BridgeHealth HealthOf(string vendor) =>
            _health.TryGetValue(vendor, out var h) ? h : new BridgeHealth { Status = BridgeStatus.Unknown };

        public DetectedProject? SelectedOf(string vendor) =>
            _selected.TryGetValue(vendor, out var p) ? p : null;

        /// <summary>Human platform name for a vendor id ("codesys" → "CODESYS"), for prefixes + notifications.</summary>
        public string DisplayNameOf(string vendor) =>
            _byVendor.TryGetValue(vendor, out var s) ? s.DisplayName : vendor;

        /// <summary>Re-probe every source's health and re-enumerate its projects; rebuild the merged list. A
        /// source that is unreachable simply contributes nothing (never throws the whole refresh).</summary>
        public async Task RefreshAsync()
        {
            await _refreshGate.WaitAsync().ConfigureAwait(false);
            try { await RefreshCoreAsync().ConfigureAwait(false); }
            finally { _refreshGate.Release(); }
        }

        /// <summary>Refresh only if the snapshot is older than <paramref name="maxAge"/>. The control plane calls
        /// this so a client's GET reads LIVE state instead of whatever the 4s tray tick last cached — otherwise a
        /// change made outside Volt (an IDE closing) lags by up to the tick PLUS the client's own poll. If another
        /// refresh is already running, wait for it and use its result rather than starting a second one.</summary>
        public async Task RefreshIfStaleAsync(TimeSpan maxAge)
        {
            if (DateTime.UtcNow - _lastRefreshUtc < maxAge) return;
            await _refreshGate.WaitAsync().ConfigureAwait(false);
            try
            {
                if (DateTime.UtcNow - _lastRefreshUtc < maxAge) return; // a queued caller refreshed it for us
                await RefreshCoreAsync().ConfigureAwait(false);
            }
            finally { _refreshGate.Release(); }
        }

        private async Task RefreshCoreAsync()
        {
            var merged = new List<DetectedProject>();
            var health = new Dictionary<string, BridgeHealth>();
            foreach (var s in _sources)
            {
                // Health of the connected instance's bridge (CODESYS probes the selected pipe; TwinCAT ignores it).
                try { health[s.Vendor] = await s.ProbeAsync(SelectedOf(s.Vendor)); }
                catch { health[s.Vendor] = new BridgeHealth { Status = BridgeStatus.Unreachable }; }

                try { merged.AddRange(await s.EnumerateAsync()); }
                catch { /* unreachable / mid-load → contributes no projects this tick */ }
            }
            _health = health; // one generation, published atomically
            _projects = merged;

            // Ask each project's OWN bridge whether it is serving that project. This is the one question the UI
            // actually needs, and only the bridge can answer it: a project can be detected (it shows in the
            // selector) while its bridge refuses sync — that is exactly what Disconnect does. Deriving "connected"
            // from detection, or from _selected, is what let the UI claim connected against a gated bridge.
            var serving = new Dictionary<string, bool>();
            foreach (var p in merged)
            {
                if (!_byVendor.TryGetValue(p.Vendor, out var s)) continue;
                // The SELECTED project's probe was already taken above for the vendor health — same pipe, same
                // call. Reuse it instead of asking twice per tick (this loop already probes every project, and
                // /status can now trigger a refresh on demand, so the round-trips add up).
                if (SelectedOf(p.Vendor)?.Id == p.Id && health.TryGetValue(p.Vendor, out var known))
                {
                    serving[p.Id] = IsServing(known, p);
                    continue;
                }
                try { serving[p.Id] = IsServing(await s.ProbeAsync(p), p); }
                catch { serving[p.Id] = false; }
            }
            _serving = serving; // published as one generation — never mutated while a reader is walking it

            // Drop a stale selection whose project is no longer detected (its IDE/host closed).
            _selected = _selected.ToDictionary(
                kv => kv.Key,
                kv => kv.Value is { } sel && merged.All(p => p.Id != sel.Id) ? null : kv.Value);

            _lastRefreshUtc = DateTime.UtcNow;
        }

        /// <summary>Does this health response mean "serving THIS project"? A live channel is not enough: one
        /// TwinCAT worker multiplexes every open project but holds ONE at a time, so the health's projectName is
        /// what says which. (CODESYS has a pipe per IDE, where the name always matches — the check is harmless.)
        /// A bridge that reports no project name at all is not serving anything.</summary>
        private static bool IsServing(BridgeHealth h, DetectedProject p)
        {
            if (h.Status != BridgeStatus.Connected && h.Status != BridgeStatus.Degraded) return false;
            if (string.IsNullOrEmpty(h.ProjectName)) return false;
            return h.ProjectName == (p.Attach.Project ?? p.DisplayName) || h.ProjectName == p.DisplayName;
        }

        /// <summary>Is this project's bridge serving it right now — the single signal every surface renders from
        /// (the tray colour, both frontends' connection status, and what the CLI would find on the pipe).</summary>
        public bool IsServingProject(string projectId) => _serving.TryGetValue(projectId, out var s) && s;

        /// <summary>Connect a detected project via its own vendor's source, then remember it as THE one active
        /// connection — connecting anything clears every other selection (one connected at a time, vendor-neutral;
        /// every host stays live, so switching is just another connect). Routing is by
        /// <see cref="DetectedProject.Vendor"/> — the caller never chose a vendor.</summary>
        public async Task ConnectAsync(DetectedProject project)
        {
            if (!_byVendor.TryGetValue(project.Vendor, out var source))
                throw new InvalidOperationException($"no source for vendor '{project.Vendor}'");
            await source.BindAsync(project);
            // One active connection: every other vendor clears. Rebuilt as a new map (see the field comment).
            _selected = _selected.ToDictionary(kv => kv.Key, kv => kv.Key == project.Vendor ? project : null);
            Connected?.Invoke(project);
        }

        /// <summary>Disconnect the active connection: tell its bridge to stop serving (sync ops are refused as
        /// PLC_DISCONNECTED until the next connect) AND clear the selection. Nothing is torn down — every activated
        /// CODESYS host and running TwinCAT project stays loaded and re-connectable, so reconnecting is just another
        /// <see cref="ConnectAsync"/>. The bridge-side gate is what makes this real: the CLI reaches the pipe
        /// directly, so clearing the selection alone would leave push/pull working.</summary>
        /// <summary>Disconnect a SPECIFIC project (or, with no id, whatever is the active connection).
        /// <para>Per-project because the UI is: a VS Code window shows the connection for the project ITS workspace
        /// is bound to, which is often not the tray's active one. A global disconnect there gated a different
        /// project than the row described — silently stopping sync for another workspace while the row that was
        /// clicked stayed connected.</para>
        /// <para>Note the asymmetry that remains, deliberately: the BRIDGE gate is per host, so on TwinCAT (one
        /// worker for every project) disconnecting one project stops sync for all of them. That was chosen over
        /// per-project gating for simplicity; targeting the right bridge is what this fixes.</para></summary>
        /// <returns>What the bridge did — <see cref="UnbindResult.Unsupported"/> means it KEEPS SERVING and the
        /// caller must say so; <see cref="UnbindResult.Unreachable"/> means it is simply gone.</returns>
        public async Task<UnbindResult> DisconnectAsync(string? projectId = null)
        {
            var target = projectId is null
                ? ActiveConnection
                : _projects.FirstOrDefault(p => p.Id == projectId);

            var result = UnbindResult.Gated; // nothing to disconnect is a no-op, not a failure
            if (target != null && _byVendor.TryGetValue(target.Vendor, out var source))
                result = await source.UnbindAsync(target);

            // Clear the highlight only when it pointed at what we just disconnected — disconnecting project B
            // must not un-highlight project A.
            if (target != null)
                _selected = _selected.ToDictionary(kv => kv.Key, kv => kv.Value?.Id == target.Id ? null : kv.Value);

            return result;
        }

        /// <summary>The one active connection across all vendors (or null). Vendor-neutral — the single-connection
        /// abstraction the UI + control plane sit on.</summary>
        public DetectedProject? ActiveConnection => _selected.Values.FirstOrDefault(p => p != null);

        /// <summary>The single status the tray icon reflects: the most informative ALIVE state, never an alarmist
        /// colour just because a vendor isn't in use. Connected wins, then a degraded live channel, then "up,
        /// waiting for a project"; "nothing running" folds to neutral Unknown.</summary>
        public BridgeStatus Aggregate()
        {
            // Green = the project the user CONNECTED is being served. Both halves are required, and they are
            // different questions:
            //   • serving alone is not enough — a CODESYS host serves its project the moment it loads, so the
            //     tray went green merely because an IDE was open, before the user connected anything.
            //   • selection alone is not enough — that is a highlight; the bridge may be gated or gone.
            // (Per-WORKSPACE status is the other question and must NOT use selection: a workspace bound to a
            // non-selected project really does sync, which is why IsServingProject is what the frontends read.)
            // Green ONLY when the active connection is genuinely serving AND its channel is healthy: a Degraded
            // bridge still serves, so keying off IsServing alone painted it green and threw away the only signal
            // that the channel is impaired.
            var active = ActiveConnection;
            var activeHealth = active != null ? HealthOf(active.Vendor).Status : BridgeStatus.Unknown;
            if (active != null && IsServingProject(active.Id))
                return activeHealth == BridgeStatus.Degraded ? BridgeStatus.Degraded : BridgeStatus.Connected;

            // Nothing connected. Degraded must still be checked BEFORE a merely-live channel, or a degraded vendor
            // hides behind an unconnected healthy one and is reported as "up, waiting for a pick".
            var statuses = _health.Values.Select(h => h.Status).ToList();
            if (statuses.Contains(BridgeStatus.Degraded)) return BridgeStatus.Degraded;
            if (statuses.Contains(BridgeStatus.Connected)) return BridgeStatus.Unavailable; // live channel, nothing connected
            if (statuses.Contains(BridgeStatus.Unavailable)) return BridgeStatus.Unavailable;
            return BridgeStatus.Unknown;
        }
    }
}
