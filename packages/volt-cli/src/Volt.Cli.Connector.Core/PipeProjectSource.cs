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
            try { return WireProjects.Flatten(await _wire.CallAsync("instances"), Vendor, _pipe); }
            catch { return Array.Empty<DetectedProject>(); } // unreachable / not loaded → nothing to offer
        }

        public Task BindAsync(DetectedProject project)
        {
            var a = project.Attach;
            return _wire.CallAsync("select", new { instanceId = a.Instance, project = a.Project, plcProject = a.SubProject });
        }

        public async Task<UnbindResult> UnbindAsync(DetectedProject project)
        {
            try { await _wire.CallAsync("deselect"); return UnbindResult.Gated; }
            // The bridge ANSWERED, with an error: it is running and simply has no such op, so it keeps serving.
            catch (PipeCallException) { return UnbindResult.Unsupported; }
            // Nothing answered at all — the worker is gone, so there is nothing left to gate.
            catch { return UnbindResult.Unreachable; }
        }

        public async Task<BridgeHealth> ProbeAsync(DetectedProject? selected)
        {
            BridgeHealth health;
            try { health = HealthProbe.FromWire(await _wire.CallAsync("health")); }
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

    /// <summary>Shared parse of the <c>instances</c> wire response into flat <see cref="DetectedProject"/>s — a
    /// project's sub-projects (TwinCAT PLC projects under a solution) each become a connectable entry; a project
    /// with no sub-projects (CODESYS) is one entry. Stamps the serving <paramref name="pipe"/> + IDE version onto
    /// each so the source, CLI and UI can target/label the instance.</summary>
    public static class WireProjects
    {
        private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

        public static List<DetectedProject> Flatten(JsonElement instancesRoot, string vendor, string? pipe)
        {
            WireInstances? parsed;
            try { parsed = JsonSerializer.Deserialize<WireInstances>(instancesRoot.GetRawText(), Json); }
            catch { return new List<DetectedProject>(); }

            var list = new List<DetectedProject>();
            foreach (var inst in parsed?.Instances ?? Enumerable.Empty<WireInstance>())
            foreach (var proj in inst.Projects ?? Enumerable.Empty<WireProject>())
            {
                if (proj.Project is null) continue;
                var subs = proj.SubProjects;
                if (subs is { Count: > 1 })
                    // Multiple PLC projects under one IDE project — qualify each by its sub-project name to tell them apart.
                    foreach (var sub in subs) list.Add(Make(vendor, pipe, inst, proj.Project, sub, proj.Dirty, $"{proj.Project} / {sub}"));
                else if (subs is { Count: 1 })
                    // The common case: one PLC project. Show the IDE PROJECT name (meaningful — "TwinCAT Project13"),
                    // not the PLC child's often-default name ("Untitled1"); still attach the sub so select targets it.
                    list.Add(Make(vendor, pipe, inst, proj.Project, subs[0], proj.Dirty, proj.Project));
                else
                    list.Add(Make(vendor, pipe, inst, proj.Project, null, proj.Dirty, proj.Project));
            }
            return list;
        }

        private static DetectedProject Make(string vendor, string? pipe, WireInstance inst, string project, string? sub, bool dirty, string display)
        {
            var attach = new ProjectRef(inst.InstanceId, project, sub);
            return new DetectedProject(DetectedProject.MakeId(vendor, attach), display, vendor, dirty, attach, pipe, inst.Version);
        }

        // ── the connector's view of the `instances` wire response (the bridge produces matching JSON) ──
        private sealed record WireInstances(List<WireInstance>? Instances);
        private sealed record WireInstance(string? InstanceId, string? Name, string? Version, List<WireProject>? Projects);
        private sealed record WireProject(string? Project, bool Dirty, List<string>? SubProjects);
    }
}
