using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Volt.Cli.Transport;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// The ONE <see cref="IProjectSource"/> for BOTH vendors: one host per running IDE, each on its own
    /// <c>volt.bridge.&lt;vendor&gt;.&lt;pid&gt;</c> pipe. CODESYS's host loads in-proc per IDE; TwinCAT's is a
    /// per-XAE worker the connector spawns (<see cref="TwincatSupervisor"/>) — but from here they are identical:
    /// this source DISCOVERS the live pipes for a vendor's prefix (<see cref="PipeDiscovery"/>) and fans out one
    /// <c>health</c> poll per pipe, concurrently, so the unified list shows every running IDE and each
    /// <see cref="DetectedProject"/> carries the pipe that serves it. The old single-worker-multiplexed TwinCAT
    /// source is gone — the vendor asymmetry is now entirely behind the connector's lifecycle, not the wire.
    /// </summary>
    public sealed class PerPipeProjectSource : IProjectSource
    {
        public string Vendor { get; }
        public string DisplayName { get; }

        // Overridable for tests (scripted pipes + wires); production discovers real pipes by the vendor prefix.
        private readonly Func<IReadOnlyList<string>> _livePipes;
        private readonly Func<string, IBridgeWire> _wireFor;

        public PerPipeProjectSource(string vendor, string displayName, string prefix)
            : this(vendor, displayName, () => PipeDiscovery.List(prefix), pipe => new PipeBridgeWire(pipe)) { }

        public PerPipeProjectSource(string vendor, string displayName,
            Func<IReadOnlyList<string>> livePipes, Func<string, IBridgeWire> wireFor)
        {
            Vendor = vendor;
            DisplayName = displayName;
            _livePipes = livePipes;
            _wireFor = wireFor;
        }

        public async Task<SourceScan> ScanAsync()
        {
            // Fan out over every live pipe CONCURRENTLY — one `health` poll each, cache-served, never marshalled onto
            // the IDE thread. Each IDE is its own process/pipe, so a hung one must not stall the others: total time is
            // the slowest single pipe, not the sum. Each call is bounded (2s connect) + self-isolating (a throw → no
            // rows for that pipe). Each row is self-describing (serving/status/dirty ride through onto the
            // DetectedProject), so there is no second probe: a live pipe existing IS the reachability bit.
            var pipes = _livePipes();
            var perPipe = await Task.WhenAll(pipes.Select(async pipe =>
            {
                try { return WireProjects.Flatten(await _wireFor(pipe).CallAsync(Ops.Health), Vendor, pipe); }
                catch { return new List<DetectedProject>(); } // that host went away mid-scan — skip it
            }));
            return new SourceScan(perPipe.SelectMany(x => x).ToList(), Reachable: pipes.Count > 0);
        }

        public Task BindAsync(DetectedProject project)
        {
            // `select` is a refresh/confirm of the one project the pipe already serves (the pipe IS the instance) —
            // harmless, and keeps the wire uniform. Target the project's own pipe.
            if (string.IsNullOrEmpty(project.Pipe)) return Task.CompletedTask;
            return _wireFor(project.Pipe!).CallAsync(Ops.Connect, new { project = project.Attach.Project });
        }

        public async Task UnbindAsync(DetectedProject project)
        {
            // Best-effort `deselect` on the project's own pipe. Any failure (no pipe, IDE gone) is a no-op — the
            // reconciler re-derives from the bridge's actual serving state next cycle.
            if (string.IsNullOrEmpty(project.Pipe)) return;
            try { await _wireFor(project.Pipe!).CallAsync(Ops.Disconnect); } catch { }
        }
    }

    /// <summary>Shared parse of the FLAT <c>health.projects</c> array into <see cref="DetectedProject"/>s — one per
    /// open project (its identity only; detection never reaches into PLC applications). Stamps the serving
    /// <paramref name="pipe"/> + IDE version onto each so the source, CLI and UI can target/label the row. Each row
    /// is self-describing: serving/status/dirty ride straight through onto the <see cref="DetectedProject"/>, so the
    /// connection state is read off the row (no second health probe).</summary>
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
                var attach = new ProjectRef(p.Project);
                list.Add(new DetectedProject(DetectedProject.MakeId(vendor, attach), p.Project, vendor, p.Dirty, attach, pipe, p.Version, p.Status ?? HealthStatus.Idle));
            }
            return list;
        }

        // ── the connector's view of the flat `health.projects` array (matching JSON) ──
        // Vendor is stamped from the caller's own `vendor` param, not the wire, so it is not read back here.
        private sealed record WireHealth(List<WireProjectRow>? Projects);
        private sealed record WireProjectRow(
            string? Version, string? Project, string? Status, bool Dirty);
    }
}
