using System.Text.Json;
using Volt.Cli.Connector;

// VoltControlHarness <viewJsonPath> <port>
// Runs the REAL ControlServer on <port>, serving the ConnectorView read from <viewJsonPath> (a JSON array of
// ProjectView rows) — re-read on every read, so an e2e can change the scenario (single → multi-instance) by rewriting
// the file. It exercises the production control-plane wire (serialization, routes, camelCasing) against the
// volt-control TS client — no mock:
//   • GET /status — the ambient read of the detected-project list (the connect picker).
//   • the SESSION plane — POST /session, /session/{id}/sync (declare interests), DELETE /session — with a simple
//     interest→serving reconcile that mirrors the live connector (a row a live session declares interest in serves).
if (args.Length < 2 || !int.TryParse(args[1], out var port))
{
    Console.Error.WriteLine("usage: VoltControlHarness <viewJsonPath> <port>");
    return 2;
}
var viewPath = args[0];
var json = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };

var gate = new object();
var sessions = new Dictionary<string, List<Interest>>(); // id → the FULL interest set it last declared

List<ProjectView> Raw() => JsonSerializer.Deserialize<List<ProjectView>>(File.ReadAllText(viewPath), json) ?? new();

ConnectorView Snapshot()
{
    lock (gate)
    {
        // A row SERVES (idle → healthy) iff a live session declares interest in it, by vendor + the binding name
        // (projectName ?? displayName) — the union the real reconciler computes.
        var wanted = sessions.Values
            .SelectMany(list => list)
            .Select(i => (i.Vendor, i.ProjectName))
            .ToHashSet();
        var rows = Raw().ConvertAll(p =>
        {
            var name = p.ProjectName ?? p.DisplayName;
            var serving = wanted.Contains((p.Vendor, name));
            return p with { Status = serving ? (p.Status == "degraded" ? "degraded" : "healthy") : "idle" };
        });
        return new ConnectorView(rows);
    }
}

using var server = new ControlServer(
    snapshot: () => Task.FromResult(Snapshot()),
    restart: _ => { },
    openSession: () =>
    {
        var id = Guid.NewGuid().ToString("N");
        lock (gate) { sessions[id] = new(); }
        return Task.FromResult((id, 15.0));
    },
    sync: (id, interests) =>
    {
        lock (gate) { sessions[id] = interests.ToList(); } // declare the FULL set (idempotent replace)
        return Task.FromResult(Snapshot());                // declare + read in one round-trip, reconciled
    },
    closeSession: id => { lock (gate) { sessions.Remove(id); } return Task.CompletedTask; },
    port: port);
server.Start();
Console.WriteLine($"READY {port}"); // the e2e waits for this line
Console.Out.Flush();

// Block until the parent closes our stdin (it kills us at the end of the run).
try { while (Console.In.ReadLine() != null) { } } catch { }
return 0;
