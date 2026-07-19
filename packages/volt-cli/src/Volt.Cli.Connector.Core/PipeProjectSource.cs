using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// The pipe-backed <see cref="IProjectSource"/> — and the ONLY one needed. Because both bridges expose the
    /// same <c>instances</c> / <c>select</c> / <c>health</c> wire ops, this one class serves every vendor: it is
    /// parameterized only by the vendor id + display name + its <see cref="IBridgeWire"/>. All the per-vendor
    /// attach mechanism (TwinCAT COM/ROT, CODESYS in-proc <c>ScriptProjects</c>) lives on the bridge side of the
    /// wire, so the connector never branches on vendor.
    ///
    /// Enumeration maps the wire's instance→project(→sub-project) tree into flat <see cref="DetectedProject"/>s:
    /// a project's sub-projects (TwinCAT PLC projects under a solution project) each become their own connectable
    /// entry; a project with no sub-projects (CODESYS) is one entry.
    /// </summary>
    public sealed class PipeProjectSource : IProjectSource
    {
        private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

        private readonly IBridgeWire _wire;

        public string Vendor { get; }
        public string DisplayName { get; }

        public PipeProjectSource(string vendor, string displayName, IBridgeWire wire)
        {
            Vendor = vendor;
            DisplayName = displayName;
            _wire = wire;
        }

        public async Task<IReadOnlyList<DetectedProject>> EnumerateAsync()
        {
            JsonElement root;
            try { root = await _wire.CallAsync("instances"); }
            catch { return Array.Empty<DetectedProject>(); } // unreachable / not loaded → nothing to offer

            WireInstances? parsed;
            try { parsed = JsonSerializer.Deserialize<WireInstances>(root.GetRawText(), Json); }
            catch { return Array.Empty<DetectedProject>(); }

            var list = new List<DetectedProject>();
            foreach (var inst in parsed?.Instances ?? Enumerable.Empty<WireInstance>())
            foreach (var proj in inst.Projects ?? Enumerable.Empty<WireProject>())
            {
                if (proj.Project is null) continue;
                if (proj.SubProjects is { Count: > 0 } subs)
                    foreach (var sub in subs) list.Add(Make(inst.InstanceId, proj.Project, sub, proj.Dirty, sub));
                else
                    list.Add(Make(inst.InstanceId, proj.Project, null, proj.Dirty, proj.Project));
            }
            return list;
        }

        public Task BindAsync(DetectedProject project)
        {
            var a = project.Attach;
            return _wire.CallAsync("select", new { instanceId = a.Instance, project = a.Project, plcProject = a.SubProject });
        }

        public async Task<BridgeHealth> ProbeAsync()
        {
            try { return HealthProbe.FromWire(await _wire.CallAsync("health")); }
            catch { return new BridgeHealth { Status = BridgeStatus.Unreachable }; }
        }

        private DetectedProject Make(string? instance, string project, string? sub, bool dirty, string display)
        {
            var attach = new ProjectRef(instance, project, sub);
            return new DetectedProject(DetectedProject.MakeId(Vendor, attach), display, Vendor, dirty, attach);
        }

        // ── the connector's view of the `instances` wire response (the bridge produces matching JSON) ──
        private sealed record WireInstances(List<WireInstance>? Instances);
        private sealed record WireInstance(string? InstanceId, string? Name, List<WireProject>? Projects);
        private sealed record WireProject(string? Project, bool Dirty, List<string>? SubProjects);
    }
}
