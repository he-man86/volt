using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Volt.Wire;
using Volt.Contracts;

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
                catch (Exception e)
                {
                    // Usually that host went away mid-scan — but a hung IDE or a version-skewed frame lands here too,
                    // and then the project vanishes from the tray, /status and every workspace's status. Skipping is
                    // right; skipping SILENTLY is the invisibility Conventions #4 exists to prevent.
                    VoltLog.Warn($"health on {pipe} failed, skipping that host this scan: {e.Message}");
                    return new List<DetectedProject>();
                }
            }));
            return new SourceScan(perPipe.SelectMany(x => x).ToList(), Reachable: pipes.Count > 0);
        }

        public Task BindAsync(DetectedProject project)
        {
            // `select` NAMES the project this pipe should serve — it is not merely a confirm: on a per-pid CODESYS
            // host it is a no-op refresh, on a shared TwinCAT worker (several projects, one pipe) it RETARGETS the
            // worker, and on a gated bridge it is the verb that resumes serving. That is why the reconciler groups
            // bind candidates one-per-host. Target the project's own pipe.
            if (string.IsNullOrEmpty(project.Pipe)) return Task.CompletedTask;
            // The REAL type, not `new { project = ... }`. The connector could not see ConnectRequest while it
            // lived in Volt.Engine — a project it deliberately cannot reference — so it wrote an anonymous
            // payload and a test in Volt.Cli.Connector.Tests pinned the two spellings together. That test was the
            // sole reason a connector test project referenced the Engine at all. One declaration, no pin needed.
            return _wireFor(project.Pipe!).CallAsync(Ops.Connect, new ConnectRequest { Project = project.Attach.Project });
        }

        public async Task UnbindAsync(DetectedProject project)
        {
            // `deselect` on the project's own pipe. A row with no pipe has nothing to gate. A FAILURE is deliberately
            // NOT caught here: ConnectionManager.SafeUnbindAsync already treats unbind as best-effort AND logs it, so
            // swallowing it here would make that log line unreachable — one question, one answer (Conventions #3/#4).
            // The reconciler re-derives from the bridge's actual serving state next cycle either way.
            if (string.IsNullOrEmpty(project.Pipe)) return;
            await _wireFor(project.Pipe!).CallAsync(Ops.Disconnect);
        }
    }

    /// <summary>Shared parse of the FLAT <c>health.projects</c> array into <see cref="DetectedProject"/>s — one per
    /// open project (its identity only; detection never reaches into PLC applications). Stamps the serving
    /// <paramref name="pipe"/> + IDE version onto each so the source, CLI and UI can target/label the row. Each row
    /// is self-describing: serving/status/dirty ride straight through onto the <see cref="DetectedProject"/>, so the
    /// connection state is read off the row (no second health probe).</summary>
    public static class WireProjects
    {
        // READ tolerance, deliberately not the pipe's WRITE options: the wire writes camelCase, this reads any casing.
        // The pair is asymmetric on purpose, so this is NOT a stale hand-copy of `PipeJson.Options` waiting to be
        // deduplicated — swapping it narrows what a version-skewed bridge can be parsed from, and needs its own move.


        public static List<DetectedProject> Flatten(JsonElement healthRoot, string vendor, string? pipe)
        {
            HealthResponse? parsed;
            try { parsed = JsonSerializer.Deserialize<HealthResponse>(healthRoot.GetRawText(), WireJson.Read); }
            catch (Exception e)
            {
                // One bad payload drops a whole bridge's rows; say so, or the bridge just disappears with no trace.
                VoltLog.Warn($"unreadable health payload from {pipe ?? vendor}, dropping its rows: {e.Message}");
                return new List<DetectedProject>();
            }

            var list = new List<DetectedProject>();
            // Vendor is stamped from the caller's own `vendor` param, not the wire, so it is not read back here:
            // the caller's `vendor` is the identity source (`DetectedProject.MakeId`) and the pipe's own routing key.
            // The row now carries a `Vendor` member of its own (it came down with the DTO) — leaving it unread is the
            // rule, not an oversight: one question, one answer (Conventions #3).
            // The row's ctor params are non-nullable ANNOTATIONS only (Conventions #2) — System.Text.Json still hands
            // this record nulls for absent members, so the two guards below are runtime checks, not redundancy. Delete
            // either and a bridge that omits `project`/`status` silently changes what the tray shows.
            foreach (var p in parsed?.Projects ?? Enumerable.Empty<ProjectEntry>())
            {
                if (p.Project is null) continue;
                var attach = new ProjectRef(p.Project);
                list.Add(new DetectedProject(DetectedProject.MakeId(vendor, attach), p.Project, vendor, p.Dirty, attach, pipe, p.Version, p.Status ?? HealthStatus.Idle));
            }
            return list;
        }
    }
}
