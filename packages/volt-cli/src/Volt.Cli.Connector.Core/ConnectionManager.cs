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
        // Per-PROJECT serving state, keyed by DetectedProject.Id — the ground truth "is this project's bridge
        // actually serving it right now". Distinct from _selected (a tray highlight) and from _health (per VENDOR,
        // which is ambiguous the moment two CODESYS instances run). Everything user-facing derives from this.
        private readonly Dictionary<string, bool> _serving = new();
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

            // Ask each project's OWN bridge whether it is serving that project. This is the one question the UI
            // actually needs, and only the bridge can answer it: a project can be detected (it shows in the
            // selector) while its bridge refuses sync — that is exactly what Disconnect does. Deriving "connected"
            // from detection, or from _selected, is what let the UI claim connected against a gated bridge.
            _serving.Clear();
            foreach (var p in merged)
            {
                if (!_byVendor.TryGetValue(p.Vendor, out var s)) continue;
                try { _serving[p.Id] = IsServing(await s.ProbeAsync(p), p); }
                catch { _serving[p.Id] = false; }
            }

            // Drop a stale selection whose project is no longer detected (its IDE/host closed).
            foreach (var vendor in _selected.Keys.ToList())
                if (_selected[vendor] is { } sel && merged.All(p => p.Id != sel.Id))
                    _selected[vendor] = null;
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
            foreach (var v in _selected.Keys.ToList()) _selected[v] = null; // one active connection
            _selected[project.Vendor] = project;
            Connected?.Invoke(project);
        }

        /// <summary>Disconnect the active connection: tell its bridge to stop serving (sync ops are refused as
        /// PLC_DISCONNECTED until the next connect) AND clear the selection. Nothing is torn down — every activated
        /// CODESYS host and running TwinCAT project stays loaded and re-connectable, so reconnecting is just another
        /// <see cref="ConnectAsync"/>. The bridge-side gate is what makes this real: the CLI reaches the pipe
        /// directly, so clearing the selection alone would leave push/pull working.</summary>
        /// <returns>FALSE when the bridge did not accept the deselect — an OLD bridge (mid-update, or a CODESYS
        /// in-proc host loaded before this shipped) has no such op and KEEPS SERVING the CLI. The selection is
        /// cleared either way, so the UI would look disconnected while `volt push` still worked — exactly the bug
        /// this whole gate exists to kill. Callers must surface a false.</returns>
        public async Task<bool> DisconnectAsync()
        {
            var gated = true;
            if (ActiveConnection is { } active && _byVendor.TryGetValue(active.Vendor, out var source))
                gated = await source.UnbindAsync(active);
            foreach (var v in _selected.Keys.ToList()) _selected[v] = null;
            return gated;
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
            if (ActiveConnection is { } active && IsServingProject(active.Id)) return BridgeStatus.Connected;
            var statuses = _health.Values.Select(h => h.Status).ToList();
            if (statuses.Contains(BridgeStatus.Connected)) return BridgeStatus.Unavailable; // live channel, nothing connected
            if (statuses.Contains(BridgeStatus.Degraded)) return BridgeStatus.Degraded;
            if (statuses.Contains(BridgeStatus.Unavailable)) return BridgeStatus.Unavailable;
            return BridgeStatus.Unknown;
        }
    }
}
