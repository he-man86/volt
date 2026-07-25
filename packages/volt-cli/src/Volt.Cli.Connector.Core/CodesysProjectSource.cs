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
        public string Vendor => Vendors.Codesys;
        public string DisplayName => Vendors.CodesysDisplay;

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

        public async Task<SourceScan> ScanAsync()
        {
            // Fan out over every live pipe CONCURRENTLY — one `health` poll each, cache-served, never marshalled onto
            // the IDE thread. Each CODESYS is its own process/pipe, so a hung one must not stall the others: total time
            // is the slowest single pipe, not the sum. Each call is bounded (2s connect) + self-isolating (a throw →
            // no rows for that pipe). Each row is self-describing (serving/status/dirty ride through onto the
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
            // CODESYS `select` is a refresh/confirm of the one project the pipe already serves (the pipe IS the
            // instance) — harmless, and keeps the wire uniform. Target the project's own pipe.
            if (string.IsNullOrEmpty(project.Pipe)) return Task.CompletedTask;
            return _wireFor(project.Pipe!).CallAsync(Ops.Connect, new { project = project.Attach.Project });
        }

        public async Task<UnbindResult> UnbindAsync(DetectedProject project)
        {
            if (string.IsNullOrEmpty(project.Pipe)) return UnbindResult.Unreachable;
            try { await _wireFor(project.Pipe!).CallAsync(Ops.Disconnect); return UnbindResult.Gated; }
            // The host ANSWERED with an error: it is loaded but predates `deselect`, so it keeps serving.
            catch (PipeCallException) { return UnbindResult.Unsupported; }
            // Nothing answered — that IDE closed. Already disconnected; nothing to warn about.
            catch { return UnbindResult.Unreachable; }
        }
    }
}
