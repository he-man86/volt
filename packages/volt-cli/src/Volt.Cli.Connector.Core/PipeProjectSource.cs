using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Volt.Cli.Transport;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// A single-pipe pipe-backed <see cref="IProjectSource"/> — used for TwinCAT (one supervised worker on
    /// <c>volt.bridge.twincat</c> that multiplexes every running project via the COM ROT). CODESYS uses
    /// <see cref="CodesysProjectSource"/> instead (one discovered pipe per running IDE). Both flatten the wire's
    /// instance→project(→sub-project) tree the same way (<see cref="WireProjects.Flatten"/>).
    /// </summary>
    public sealed class PipeProjectSource : IProjectSource
    {
        private readonly IBridgeWire _wire;
        private readonly string? _pipe; // the pipe this source's projects are served on (for DetectedProject.Pipe)

        public string Vendor { get; }
        public string DisplayName { get; }

        public PipeProjectSource(string vendor, string displayName, IBridgeWire wire, string? pipe = null)
        {
            Vendor = vendor;
            DisplayName = displayName;
            _wire = wire;
            _pipe = pipe;
        }

        public async Task<IReadOnlyList<DetectedProject>> EnumerateAsync()
        {
            // Discovery rides on `health` now (the projects list is a field on it) — one cache-served poll, never
            // marshalled onto the STA thread.
            try { return WireProjects.Flatten(await _wire.CallAsync(Ops.Health), Vendor, _pipe); }
            catch { return Array.Empty<DetectedProject>(); } // unreachable / not loaded → nothing to offer
        }

        public Task BindAsync(DetectedProject project)
        {
            var a = project.Attach;
            return _wire.CallAsync(Ops.Connect, new { instanceId = a.Instance, project = a.Project });
        }

        public async Task<UnbindResult> UnbindAsync(DetectedProject project)
        {
            try { await _wire.CallAsync(Ops.Disconnect); return UnbindResult.Gated; }
            // The bridge ANSWERED, with an error: it is running and simply has no such op, so it keeps serving.
            catch (PipeCallException) { return UnbindResult.Unsupported; }
            // Nothing answered at all — the worker is gone, so there is nothing left to gate.
            catch { return UnbindResult.Unreachable; }
        }

        public async Task<BridgeHealth> ProbeAsync(DetectedProject? selected)
        {
            BridgeHealth health;
            try { health = HealthProbe.FromWire(await _wire.CallAsync(Ops.Health)); }
            catch { return new BridgeHealth { Status = BridgeStatus.Unreachable }; }

            // "Connected" must mean a project is CONNECTED, not merely that the worker attached to an open IDE.
            // This source ignored `selected` and reported the worker's raw health, so the tray went green as soon
            // as TwinCAT was running with a project open — before the user had connected anything. (CODESYS never
            // had the bug: its per-instance probe already keys off the selection.) Downgrade to "up, waiting for a
            // pick", which is exactly what Unavailable means and what the tray paints amber.
            if (selected == null && (health.Status == BridgeStatus.Connected || health.Status == BridgeStatus.Degraded))
                return new BridgeHealth { Status = BridgeStatus.Unavailable, ProjectName = health.ProjectName, ProjectDirty = health.ProjectDirty };
            return health;
        }
    }

    /// <summary>Shared parse of the FLAT <c>health.projects</c> array into <see cref="DetectedProject"/>s — one per
    /// open project (its identity only; detection never reaches into PLC applications). Stamps the serving
    /// <paramref name="pipe"/> + IDE version onto each so the source, CLI and UI can target/label the row. The
    /// per-row serving/status are read by <see cref="HealthProbe"/> for the connection state; enumeration only needs
    /// identity + dirty + version.</summary>
    public static class WireProjects
    {
        private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

        public static List<DetectedProject> Flatten(JsonElement healthRoot, string vendor, string? pipe)
        {
            WireHealth? parsed;
            try { parsed = JsonSerializer.Deserialize<WireHealth>(healthRoot.GetRawText(), Json); }
            catch { return new List<DetectedProject>(); }

            var list = new List<DetectedProject>();
            foreach (var p in parsed?.Projects ?? Enumerable.Empty<WireProjectRow>())
            {
                if (p.Project is null) continue;
                var attach = new ProjectRef(p.InstanceId, p.Project);
                list.Add(new DetectedProject(DetectedProject.MakeId(vendor, attach), p.Project, vendor, p.Dirty, attach, pipe, p.Version, p.Serving, p.Status ?? HealthStatus.Healthy));
            }
            return list;
        }

        // ── the connector's view of the flat `health.projects` array (matching JSON) ──
        private sealed record WireHealth(List<WireProjectRow>? Projects);
        private sealed record WireProjectRow(
            string? Vendor, string? InstanceId, string? Version, string? Project, string? Status, bool Serving, bool Dirty);
    }
}
