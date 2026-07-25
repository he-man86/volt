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

        public async Task<SourceScan> ScanAsync()
        {
            // One cache-served `health` poll, never marshalled onto the STA thread: the rows ARE the projects (each
            // self-describing — serving/status/dirty), and the call succeeding is the reachability bit. A worker up
            // with no project open answers with zero rows but Reachable: true (the tray's "up, waiting for a pick").
            try { return new SourceScan(WireProjects.Flatten(await _wire.CallAsync(Ops.Health), Vendor, _pipe), Reachable: true); }
            catch { return new SourceScan(Array.Empty<DetectedProject>(), Reachable: false); } // worker gone
        }

        public Task BindAsync(DetectedProject project)
        {
            return _wire.CallAsync(Ops.Connect, new { project = project.Attach.Project });
        }

        public async Task<UnbindResult> UnbindAsync(DetectedProject project)
        {
            try { await _wire.CallAsync(Ops.Disconnect); return UnbindResult.Gated; }
            // The bridge ANSWERED, with an error: it is running and simply has no such op, so it keeps serving.
            catch (PipeCallException) { return UnbindResult.Unsupported; }
            // Nothing answered at all — the worker is gone, so there is nothing left to gate.
            catch { return UnbindResult.Unreachable; }
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
