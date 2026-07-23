using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Volt.Cli.Transport;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// The CODESYS <see cref="IProjectSource"/>. CODESYS is InIdeLoad — its host runs in-proc inside EACH running
    /// IDE, so there is no single bridge: every activated CODESYS serves its own <c>volt.bridge.codesys.&lt;pid&gt;</c>
    /// pipe. This source DISCOVERS them (<see cref="PipeDiscovery"/>) and fans out — one wire per live pipe — so the
    /// unified project list shows every running CODESYS, and each <see cref="DetectedProject"/> carries the pipe that
    /// serves it. Nothing above the connector learns this: it's the same flat list as TwinCAT's single-worker source.
    /// </summary>
    public sealed class CodesysProjectSource : IProjectSource
    {
        public string Vendor => "codesys";
        public string DisplayName => "CODESYS";

        // Overridable for tests (scripted pipes + wires); production discovers real pipes and opens real ones.
        private readonly Func<IReadOnlyList<string>> _livePipes;
        private readonly Func<string, IBridgeWire> _wireFor;

        public CodesysProjectSource()
            : this(() => PipeDiscovery.List(PipeNames.CodesysPrefix), pipe => new PipeBridgeWire(pipe)) { }

        public CodesysProjectSource(Func<IReadOnlyList<string>> livePipes, Func<string, IBridgeWire> wireFor)
        {
            _livePipes = livePipes;
            _wireFor = wireFor;
        }

        // The live-pipe count from the last enumeration, so ProbeAsync(null) doesn't re-walk the pipe namespace
        // every tick (EnumerateAsync already walked it). Approximate by one tick — fine for a tray colour.
        private volatile int _lastLiveCount = -1;

        public async Task<IReadOnlyList<DetectedProject>> EnumerateAsync()
        {
            var pipes = _livePipes();
            _lastLiveCount = pipes.Count;
            var all = new List<DetectedProject>();
            foreach (var pipe in pipes)
            {
                try { all.AddRange(WireProjects.Flatten(await _wireFor(pipe).CallAsync("instances"), Vendor, pipe)); }
                catch { /* that host went away mid-enumeration — skip it */ }
            }
            return all;
        }

        public Task BindAsync(DetectedProject project)
        {
            // CODESYS `select` is a refresh/confirm of the one project the pipe already serves (the pipe IS the
            // instance) — harmless, and keeps the wire uniform. Target the project's own pipe.
            if (string.IsNullOrEmpty(project.Pipe)) return Task.CompletedTask;
            var a = project.Attach;
            return _wireFor(project.Pipe!).CallAsync("select", new { instanceId = a.Instance, project = a.Project, plcProject = a.SubProject });
        }

        public async Task UnbindAsync(DetectedProject project)
        {
            if (string.IsNullOrEmpty(project.Pipe)) return;
            try { await _wireFor(project.Pipe!).CallAsync("deselect"); }
            catch { /* the IDE closed / host gone → already not serving */ }
        }

        public async Task<BridgeHealth> ProbeAsync(DetectedProject? selected)
        {
            // Health of the CONNECTED instance's pipe when one is selected; otherwise "any CODESYS reachable" so the
            // tray still shows the platform is up and waiting for a pick.
            if (selected?.Pipe is { Length: > 0 } pipe)
            {
                try { return HealthProbe.FromWire(await _wireFor(pipe).CallAsync("health")); }
                catch { return new BridgeHealth { Status = BridgeStatus.Unreachable }; }
            }
            // Reuse the last enumeration's count (walk only if we've never enumerated yet).
            var liveCount = _lastLiveCount >= 0 ? _lastLiveCount : _livePipes().Count;
            return liveCount > 0
                ? new BridgeHealth { Status = BridgeStatus.Unavailable } // up, no project selected yet
                : new BridgeHealth { Status = BridgeStatus.Unreachable };
        }
    }
}
