using System.Text.Json;
using Volt.Cli.Connector;

// VoltControlHarness <viewJsonPath> <port>
// Runs the REAL ControlServer on <port>, serving the ConnectorView read from <viewJsonPath> (a JSON array of
// ProjectView rows) — re-read on every GET /status, so an e2e can change the scenario (single → multi-instance) by
// rewriting the file. POST /connect and /disconnect mutate an in-memory "which project is connected" overlay, so a
// connect/disconnect round-trips into the next /status exactly as the live connector's would. This exercises the
// production control-plane wire (serialization, routes, camelCasing) against the volt-control TS client — no mock.
if (args.Length < 2 || !int.TryParse(args[1], out var port))
{
    Console.Error.WriteLine("usage: VoltControlHarness <viewJsonPath> <port>");
    return 2;
}
var viewPath = args[0];
var json = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };

// The one project the harness currently considers "connected" (null = none) — the tray's active selection.
string? connectedId = null;
var gate = new object();

List<ProjectView> Raw() => JsonSerializer.Deserialize<List<ProjectView>>(File.ReadAllText(viewPath), json) ?? new();

ConnectorView Snapshot()
{
    lock (gate)
    {
        var active = connectedId;
        // Connecting a project makes it the highlight AND makes its bridge serve (idle → healthy); the rest are
        // detected-but-idle. Mirrors what the live connector's ConnectorView reports after a select.
        var rows = Raw().ConvertAll(p =>
            p.Id == active ? p with { Connected = true, Status = "healthy" }
                           : p with { Connected = false, Status = p.Status == "idle" ? "idle" : p.Status });
        return new ConnectorView(rows);
    }
}

using var server = new ControlServer(
    snapshot: () => Task.FromResult(Snapshot()),
    // Mirror the real ConnectionManager.ConnectByIdAsync: an UNKNOWN project id is rejected (false) and changes
    // nothing — the connect only lands when the id is actually present. Connecting an already-connected id is a no-op.
    connect: id =>
    {
        lock (gate)
        {
            if (!Raw().Exists(p => p.Id == id)) return Task.FromResult(false);
            connectedId = id;
            return Task.FromResult(true);
        }
    },
    // Disconnect the named project (or the active one when null). Disconnecting a project that isn't the active one
    // leaves the active selection untouched. Always answers Gated (the highlight cleared regardless).
    disconnect: id => { lock (gate) { if (id == null || id == connectedId) connectedId = null; } return Task.FromResult(UnbindResult.Gated); },
    restart: _ => { },
    port: port);
server.Start();
Console.WriteLine($"READY {port}"); // the e2e waits for this line
Console.Out.Flush();

// Block until the parent closes our stdin (it kills us at the end of the run).
try { while (Console.In.ReadLine() != null) { } } catch { }
return 0;
