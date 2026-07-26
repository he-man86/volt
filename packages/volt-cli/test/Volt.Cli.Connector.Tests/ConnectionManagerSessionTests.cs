using System;
using System.Linq;
using System.Threading.Tasks;
using Volt.Cli.Connector;
using Volt.Cli.Transport;
using Xunit;

namespace Volt.Cli.Connector.Tests;

/// <summary>
/// The session API driving the reconcile loop end-to-end through the fake sources (no pipes): a Sync declaring an
/// interest resumes the project, the union keeps it served while any session wants it, and Close / an empty Sync
/// gates it on the leave edge — while a project no session ever declared is never touched. Complements
/// <see cref="ReconcilerTests"/> (the pure planner) and <see cref="ConnectionManagerTests"/> (the legacy facade).
/// </summary>
public class ConnectionManagerSessionTests
{
    private static Interest Want(DetectedProject p) => Interest.Of(p);

    [Fact]
    public async Task Sync_declaring_an_interest_resumes_the_project()
    {
        var cds = new FakeProjectSource("codesys", "CODESYS");
        var a = cds.Add("A"); // idle
        var mgr = new ConnectionManager(new IProjectSource[] { cds });
        var (sid, _) = await mgr.OpenSessionAsync();

        await mgr.SyncAsync(sid, new[] { Want(a) });

        Assert.Contains(a, cds.Bound); // reconcile bound it
    }

    [Fact]
    public async Task The_union_keeps_a_project_served_until_the_last_session_leaves()
    {
        var cds = new FakeProjectSource("codesys", "CODESYS");
        var a = cds.Add("A", serving: true); // a loaded host, already serving
        var mgr = new ConnectionManager(new IProjectSource[] { cds });
        var (s1, _) = await mgr.OpenSessionAsync();
        var (s2, _) = await mgr.OpenSessionAsync();
        await mgr.SyncAsync(s1, new[] { Want(a) });
        await mgr.SyncAsync(s2, new[] { Want(a) });

        await mgr.CloseSessionAsync(s1);
        Assert.Empty(cds.Unbound); // s2 still wants A → no leave edge

        await mgr.CloseSessionAsync(s2);
        Assert.Contains(a, cds.Unbound); // last leaver → gated
    }

    [Fact]
    public async Task An_empty_sync_gates_the_projects_that_session_had()
    {
        var cds = new FakeProjectSource("codesys", "CODESYS");
        var a = cds.Add("A", serving: true);
        var mgr = new ConnectionManager(new IProjectSource[] { cds });
        var (sid, _) = await mgr.OpenSessionAsync();
        await mgr.SyncAsync(sid, new[] { Want(a) });

        await mgr.SyncAsync(sid, Array.Empty<Interest>()); // declares nothing now
        Assert.Contains(a, cds.Unbound);
    }

    [Fact]
    public async Task Two_sessions_on_two_projects_serve_independently()
    {
        var cds = new FakeProjectSource("codesys", "CODESYS");
        var tc = new FakeProjectSource("twincat", "TwinCAT");
        var a = cds.Add("A");
        var b = tc.Add("B");
        var mgr = new ConnectionManager(new IProjectSource[] { cds, tc });
        var (s1, _) = await mgr.OpenSessionAsync();
        var (s2, _) = await mgr.OpenSessionAsync();

        await mgr.SyncAsync(s1, new[] { Want(a) });
        await mgr.SyncAsync(s2, new[] { Want(b) });

        Assert.Contains(a, cds.Bound);
        Assert.Contains(b, tc.Bound);
    }

    [Fact]
    public async Task A_never_declared_serving_project_is_never_gated_by_the_loop()
    {
        // The standalone-CLI guarantee at the manager level: a project no session declares keeps its default serving
        // state — the loop never gates it.
        var cds = new FakeProjectSource("codesys", "CODESYS");
        cds.Add("A", serving: true);
        var mgr = new ConnectionManager(new IProjectSource[] { cds });
        var (sid, _) = await mgr.OpenSessionAsync();

        await mgr.SyncAsync(sid, Array.Empty<Interest>());
        await mgr.RefreshAsync();

        Assert.Empty(cds.Unbound);
    }

    [Fact]
    public async Task Force_off_gates_a_project_and_clearing_it_lets_a_session_resume()
    {
        var cds = new FakeProjectSource("codesys", "CODESYS");
        var a = cds.Add("A", serving: true);
        var mgr = new ConnectionManager(new IProjectSource[] { cds });
        var (sid, _) = await mgr.OpenSessionAsync();
        await mgr.SyncAsync(sid, new[] { Want(a) });

        await mgr.SetForceOffAsync(a.Id, true);
        Assert.Contains(a, cds.Unbound); // supervisor override gates it despite the interest

        // The fake doesn't flip serving on unbind, so model the gated state, then clear force-off and re-sync.
        cds.Projects.Clear();
        cds.Add("A"); // now idle (gated)
        cds.Bound.Clear();
        await mgr.SetForceOffAsync(a.Id, false);
        await mgr.SyncAsync(sid, new[] { Want(a) });

        Assert.Contains(cds.Bound, p => p.DisplayName == "A"); // resumed once the override cleared
    }
}
