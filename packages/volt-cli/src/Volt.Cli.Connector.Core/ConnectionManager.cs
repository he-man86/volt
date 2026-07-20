using System;
using System.Collections.Generic;
using System.Linq;
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
        private readonly Dictionary<string, BridgeHealth> _health = new();
        private readonly Dictionary<string, DetectedProject?> _selected = new();
        private IReadOnlyList<DetectedProject> _projects = Array.Empty<DetectedProject>();

        public ConnectionManager(IReadOnlyList<IProjectSource> sources)
        {
            _sources = sources;
            _byVendor = sources.ToDictionary(s => s.Vendor);
            foreach (var s in sources)
            {
                _health[s.Vendor] = new BridgeHealth { Status = BridgeStatus.Unknown };
                _selected[s.Vendor] = null;
            }
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
            var merged = new List<DetectedProject>();
            foreach (var s in _sources)
            {
                // Health of the connected instance's bridge (CODESYS probes the selected pipe; TwinCAT ignores it).
                try { _health[s.Vendor] = await s.ProbeAsync(SelectedOf(s.Vendor)); }
                catch { _health[s.Vendor] = new BridgeHealth { Status = BridgeStatus.Unreachable }; }

                try { merged.AddRange(await s.EnumerateAsync()); }
                catch { /* unreachable / mid-load → contributes no projects this tick */ }
            }
            _projects = merged;
            // Drop a stale selection whose project is no longer detected (its IDE/host closed).
            foreach (var vendor in _selected.Keys.ToList())
                if (_selected[vendor] is { } sel && merged.All(p => p.Id != sel.Id))
                    _selected[vendor] = null;
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
            foreach (var v in _selected.Keys.ToList()) _selected[v] = null; // one active connection
            _selected[project.Vendor] = project;
            Connected?.Invoke(project);
        }

        /// <summary>Clear the active connection (deselect). Nothing is torn down — every activated CODESYS host and
        /// running TwinCAT project stays live and re-connectable; this only forgets which one is "connected".</summary>
        public void Disconnect()
        {
            foreach (var v in _selected.Keys.ToList()) _selected[v] = null;
        }

        /// <summary>The one active connection across all vendors (or null). Vendor-neutral — the single-connection
        /// abstraction the UI + control plane sit on.</summary>
        public DetectedProject? ActiveConnection => _selected.Values.FirstOrDefault(p => p != null);

        /// <summary>The single status the tray icon reflects: the most informative ALIVE state, never an alarmist
        /// colour just because a vendor isn't in use. Connected wins, then a degraded live channel, then "up,
        /// waiting for a project"; "nothing running" folds to neutral Unknown.</summary>
        public BridgeStatus Aggregate()
        {
            var statuses = _health.Values.Select(h => h.Status).ToList();
            if (statuses.Contains(BridgeStatus.Connected)) return BridgeStatus.Connected;
            if (statuses.Contains(BridgeStatus.Degraded)) return BridgeStatus.Degraded;
            if (statuses.Contains(BridgeStatus.Unavailable)) return BridgeStatus.Unavailable;
            return BridgeStatus.Unknown;
        }
    }
}
