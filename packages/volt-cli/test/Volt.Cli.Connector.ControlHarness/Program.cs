using Volt.Cli.Connector;
using Volt.Wire;
using Volt.Contracts;

// ControlServer's two background-failure lines are its ONLY record; VoltLog is a no-op until Init, so the harness
// opts in under the same source the tray uses (it wrote those lines unconditionally before the connector's private
// logger was deleted).
VoltLog.Init("connector");

// VoltControlHarness <viewJsonPath> <port>
// Runs the REAL ControlServer over the REAL ConnectionManager/Reconciler on <port>, with the detected projects read
// from <viewJsonPath> (a JSON array of ProjectView rows) by a fake IProjectSource — re-read on every scan, so an e2e
// can change the scenario (single → multi-instance) by rewriting the file. It exercises the production control-plane
// wire (serialization, routes, camelCasing) AND the production connection decision against the volt-control TS
// client — no mock:
//   • GET /status — the ambient read of the detected-project list (the connect picker).
//   • the SESSION plane — POST /session, /session/{id}/sync (declare interests), DELETE /session.
// ONLY the data is faked. The interest→serving reconcile is the shipped Reconciler, whose bind is level-triggered
// and whose unbind is EDGE-triggered; the inline reconcile that used to live here was level-triggered both ways
// ("serve iff wanted") — the behaviour the product deliberately rejects, pinned green by this very e2e.
if (args.Length < 2 || !int.TryParse(args[1], out var port))
{
    Console.Error.WriteLine("usage: VoltControlHarness <viewJsonPath> <port>");
    return 2;
}
var viewPath = args[0];

// One source per vendor, exactly as ConnectorSetup.Sources() wires the product (ConnectionManager keys sources by
// vendor, and routes each bind/unbind to the owning one).
var conn = new ConnectionManager(
    new IProjectSource[]
    {
        new FileProjectSource(Vendors.Codesys, Vendors.CodesysDisplay, viewPath),
        new FileProjectSource(Vendors.Twincat, Vendors.TwincatDisplay, viewPath),
    },
    // Beside the scenario file (the e2e mkdtemps a fresh directory per run) so this NEVER reads or writes the
    // machine's real %LOCALAPPDATA%\Volt\wanted.json — inheriting a live run's desired set is how two unit tests
    // failed, and here it would fabricate unbind edges out of the engineer's own session.
    wantedFile: viewPath + ".wanted.json");

// The unified, self-describing project list — the same projection TrayContext.Snapshot() ships.
ConnectorView View() => new(conn.Projects
    .Select(p => new ProjectView(p.Id, p.DisplayName, p.Vendor, p.Dirty, p.Status, p.Attach.Project, p.Pipe, p.IdeVersion))
    .ToList());

// The ambient read refreshes UNCONDITIONALLY (the product's 1s staleness floor is a load shield for many polling
// clients; here a test rewrites the scenario file and reads it back in the same millisecond).
async Task<ConnectorView> SnapshotAsync()
{
    await conn.RefreshAsync();
    return View();
}

using var server = new ControlServer(
    snapshot: SnapshotAsync,
    restart: _ => { },
    openSession: () => conn.OpenSessionAsync(),
    // Declare the FULL set + renew + read, one round-trip: SyncAsync reconciles and re-scans before it returns, so
    // the view already reflects what the bridges now serve.
    sync: async (id, interests) => { await conn.SyncAsync(id, interests); return View(); },
    closeSession: id => conn.CloseSessionAsync(id),
    port: port);
server.Start();
Console.WriteLine($"READY {port}"); // the e2e waits for this line
Console.Out.Flush();

// Block until the parent closes our stdin (it kills us at the end of the run).
try { while (Console.In.ReadLine() != null) { } } catch { }
return 0;
