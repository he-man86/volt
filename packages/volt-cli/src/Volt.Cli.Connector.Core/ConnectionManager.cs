using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Volt.Cli.Transport;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// The core of the connection model. Owns the merged, vendor-agnostic list of detected projects across every
    /// <see cref="IProjectSource"/>, the per-vendor health + current selection, the bind dispatch, and the one
    /// aggregate status the tray colour reflects. The tray, the branded window, and the control plane are ALL
    /// thin views over this — none of them branch on vendor. Vendor lives only inside the sources (below) and as
    /// a field on <see cref="DetectedProject"/> (for the prefix/logo + routing).
    ///
    /// <para><b>Concurrency.</b> Everything observable lives in ONE immutable <see cref="State"/> behind a single
    /// volatile field. Writers build a new State and publish it with one assignment; readers take one local copy
    /// and answer entirely from it. That buys two things the previous four-separate-fields shape could not:</para>
    /// <list type="bullet">
    ///   <item>No torn collections. A refresh runs on the control plane's threadpool thread (GET /status) while
    ///   the tray's UI thread reads — mutating a plain Dictionary under a concurrent reader throws "collection
    ///   was modified". That was a real crash, and it survived one round of fixing precisely because "remember to
    ///   replace this map wholesale" is a convention every future field has to re-learn. Here it is structural.</item>
    ///   <item>No mixed generations. <see cref="Aggregate"/> combines selection + serving + health; reading three
    ///   independent fields could straddle a refresh and answer from two different ticks — green for a project
    ///   that had just stopped serving, say. One snapshot, one answer.</item>
    /// </list>
    /// </summary>
    public sealed class ConnectionManager
    {
        /// <summary>One consistent generation of everything observable. Immutable by construction: the only way to
        /// change any of it is to publish a whole new instance.</summary>
        private sealed record State(
            IReadOnlyList<DetectedProject> Projects,
            /// <summary>Per-PROJECT ground truth, keyed by <see cref="DetectedProject.Id"/>: is this project's own
            /// bridge serving it right now. Every user-facing "connected" derives from this.</summary>
            IReadOnlyDictionary<string, bool> Serving,
            /// <summary>The tray HIGHLIGHT per vendor — which project the user last picked. Says nothing about
            /// whether sync works; keep it out of any "am I connected" answer.</summary>
            IReadOnlyDictionary<string, DetectedProject?> Selected,
            /// <summary>Did ANY source's bridge answer this tick — the one bit the flat rows can't express (a bridge
            /// up with no project open yields zero rows, same as a bridge that is down). Drives the "up, waiting for
            /// a pick" vs "nothing there" tray colour when nothing is connected.</summary>
            bool AnyReachable);

        private readonly IReadOnlyList<IProjectSource> _sources;
        private readonly Dictionary<string, IProjectSource> _byVendor;
        private volatile State _state;

        // A refresh runs on the tray's timer AND on demand from the control plane, so it must not run twice at
        // once. The gate serializes WRITERS; readers never block (they just take the latest published State).
        private readonly SemaphoreSlim _refreshGate = new(1, 1);
        private DateTime _lastRefreshUtc = DateTime.MinValue;

        public ConnectionManager(IReadOnlyList<IProjectSource> sources)
        {
            _sources = sources;
            _byVendor = sources.ToDictionary(s => s.Vendor);
            _state = new State(
                Array.Empty<DetectedProject>(),
                new Dictionary<string, bool>(),
                sources.ToDictionary(s => s.Vendor, _ => (DetectedProject?)null),
                AnyReachable: false);
        }

        /// <summary>A connect succeeded — carry the project so the UI can toast "Connected to X (vendor)".</summary>
        public event Action<DetectedProject>? Connected;

        /// <summary>The merged list the unified selector shows — one entry per detected project, all vendors.</summary>
        public IReadOnlyList<DetectedProject> Projects => _state.Projects;

        public IReadOnlyList<IProjectSource> Sources => _sources;

        public DetectedProject? SelectedOf(string vendor) =>
            _state.Selected.TryGetValue(vendor, out var p) ? p : null;

        /// <summary>Is this project's bridge serving it right now — the single signal every surface renders from
        /// (the tray colour, both frontends' connection status, and what the CLI would find on the pipe).</summary>
        public bool IsServingProject(string projectId) => _state.Serving.TryGetValue(projectId, out var s) && s;

        /// <summary>The one active connection across all vendors (or null). Vendor-neutral — the single-connection
        /// abstraction the UI + control plane sit on.</summary>
        public DetectedProject? ActiveConnection => _state.Selected.Values.FirstOrDefault(p => p != null);

        /// <summary>Human platform name for a vendor id ("codesys" → "CODESYS"), for prefixes + notifications.</summary>
        public string DisplayNameOf(string vendor) =>
            _byVendor.TryGetValue(vendor, out var s) ? s.DisplayName : vendor;

        /// <summary>Re-scan every source (one `health` poll each) and rebuild the merged list. A source that is
        /// unreachable simply contributes nothing (never throws the whole refresh).</summary>
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

        /// <summary>Builds the next generation and publishes it in ONE assignment at the end. Callers hold the
        /// gate, so `prior` cannot change underneath this.</summary>
        private async Task RefreshCoreAsync()
        {
            var prior = _state;

            // Scan every source CONCURRENTLY: the bridges are independent processes (2 CODESYS in-proc hosts + the
            // TwinCAT worker), so a slow/hung one must not stall the others' health — total refresh time is the
            // SLOWEST single bridge, not the sum. Each scan is bounded (a 2s pipe connect timeout) and self-isolating
            // (a throw → empty + not reachable). Task.WhenAll preserves source order, so the dedup below stays stable.
            var scans = await Task.WhenAll(_sources.Select(async s =>
            {
                try { return await s.ScanAsync(); }
                catch { return new SourceScan(Array.Empty<DetectedProject>(), Reachable: false); }
            }));
            var scanned = scans.SelectMany(x => x.Projects);
            var anyReachable = Array.Exists(scans, x => x.Reachable);

            // Identity is vendor+name, so two projects opened under the same name at once collapse to ONE row (first
            // wins, stable order). Unsupported anyway — the CLI refuses it (AMBIGUOUS_BRIDGE) — and this keeps the id
            // the primary key of everything downstream (the serving map, the picker, selection).
            var seenIds = new HashSet<string>();
            var merged = new List<DetectedProject>();
            foreach (var p in scanned) if (seenIds.Add(p.Id)) merged.Add(p);

            // "Is this project's bridge serving it right now" — the one question the UI needs (a project can be
            // detected but gated, which is what Disconnect does). It is a per-row fact ON the wire: the bridge stamps
            // exactly one serving row and the host clears it while paused, carried straight through the scan.
            var serving = merged.ToDictionary(p => p.Id, p => p.Serving);

            // Drop a stale selection whose project is no longer detected (its IDE/host closed).
            var selectedNext = prior.Selected.ToDictionary(
                kv => kv.Key,
                kv => kv.Value is { } sel && merged.All(p => p.Id != sel.Id) ? null : kv.Value);

            _state = new State(merged, serving, selectedNext, anyReachable);
            _lastRefreshUtc = DateTime.UtcNow;
        }

        /// <summary>Connect a detected project via its own vendor's source, then remember it as THE one active
        /// connection — connecting anything clears every other selection (one connected at a time, vendor-neutral;
        /// every host stays live, so switching is just another connect). Routing is by
        /// <see cref="DetectedProject.Vendor"/> — the caller never chose a vendor.</summary>
        public async Task ConnectAsync(DetectedProject project)
        {
            if (!_byVendor.TryGetValue(project.Vendor, out var source))
                throw new InvalidOperationException($"no source for vendor '{project.Vendor}'");
            await source.BindAsync(project);
            var prior = _state;
            _state = prior with
            {
                Selected = prior.Selected.ToDictionary(kv => kv.Key, kv => kv.Key == project.Vendor ? project : null),
            };
            Connected?.Invoke(project);
        }

        /// <summary>Disconnect a SPECIFIC project (or, with no id, whatever is the active connection). Its bridge
        /// stops serving — sync ops are refused as PLC_DISCONNECTED until the next connect — and the highlight
        /// clears. Nothing is torn down: every activated CODESYS host and running TwinCAT project stays loaded and
        /// re-connectable, so reconnecting is just another <see cref="ConnectAsync"/>. The bridge-side gate is what
        /// makes this real: the CLI reaches the pipe directly, so clearing the selection alone left push/pull working.
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
            var prior = _state;
            var target = projectId is null
                ? prior.Selected.Values.FirstOrDefault(p => p != null)
                : prior.Projects.FirstOrDefault(p => p.Id == projectId);

            var result = UnbindResult.Gated; // nothing to disconnect is a no-op, not a failure
            if (target != null && _byVendor.TryGetValue(target.Vendor, out var source))
                result = await source.UnbindAsync(target);

            // Clear the highlight only when it pointed at what we just disconnected — disconnecting project B
            // must not un-highlight project A. Re-read: the unbind above awaited, so a refresh may have published
            // a newer generation while we were on the wire.
            if (target != null)
            {
                var current = _state;
                _state = current with
                {
                    Selected = current.Selected.ToDictionary(kv => kv.Key, kv => kv.Value?.Id == target.Id ? null : kv.Value),
                };
            }
            return result;
        }

        /// <summary>The single status the tray icon reflects: the most informative ALIVE state, never an alarmist
        /// colour just because a vendor isn't in use.</summary>
        public BridgeStatus Aggregate()
        {
            // ONE generation for the whole answer — this combines selection, serving and reachability, and reading
            // them as independent fields could straddle a refresh and answer from two different ticks.
            var s = _state;

            // Green = the project the user CONNECTED is being served. Both halves are required, and they are
            // different questions:
            //   • serving alone is not enough — a CODESYS host serves its project the moment it loads, so the
            //     tray went green merely because an IDE was open, before the user connected anything.
            //   • selection alone is not enough — that is a highlight; the bridge may be gated or gone.
            // (Per-WORKSPACE status is the other question and must NOT use selection: a workspace bound to a
            // non-selected project really does sync, which is why IsServingProject is what the frontends read.)
            // A DEGRADED channel still serves, so it must not be flattened to green — read the degraded distinction
            // straight off the active project's own (fresh) row, not a stored copy.
            var active = s.Selected.Values.FirstOrDefault(p => p != null);
            if (active != null && s.Serving.TryGetValue(active.Id, out var isServing) && isServing)
            {
                var row = s.Projects.FirstOrDefault(p => p.Id == active.Id);
                return row?.Status == HealthStatus.Degraded ? BridgeStatus.Degraded : BridgeStatus.Connected;
            }

            // Nothing connected: a reachable channel is "up, waiting for a pick" (amber); otherwise there is nothing
            // there. (Degraded never surfaces here — it is a property of a SERVING row, and a served-and-selected
            // project is the green/degraded branch above.)
            return s.AnyReachable ? BridgeStatus.Unavailable : BridgeStatus.Unknown;
        }
    }
}
