using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Connector;
using Volt.Wire;
using Xunit;
using Volt.Contracts;

namespace Volt.Connector.Tests;

/// <summary>
/// The PURE reconciler — the correctness heart of the session model — tested with no pipes, no manager, no real
/// clock (the instant is a parameter). Every rule from the connector-session-model design has a case: union of
/// interests, the wanted→unwanted LEAVE edge that gates (and, conversely, that a never-wanted serving bridge is left
/// alone), lapsed-lease drop-out, force-off, the one-project-per-worker limit, resolve by durable identity, and the
/// anti-thrash convergence invariant (a second pass over the applied state is a no-op).
/// </summary>
public class ReconcilerTests
{
    private static readonly DateTime Now = new(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    /// <summary>A detected project. A UNIQUE pipe per project by default (so nothing false-contends); pass the SAME
    /// pipe to two to model a shared TwinCAT worker.</summary>
    private static DetectedProject Proj(string vendor, string name, bool serving = false, string? pipe = null) =>
        new(DetectedProject.MakeId(vendor, new ProjectRef(name)), name, vendor, false, new ProjectRef(name),
            Pipe: pipe ?? $"volt.bridge.{vendor}.{name}",
            Status: serving ? HealthStatus.Healthy : HealthStatus.Idle);

    private static Session Live(string id, params Interest[] wants) => new(id, wants, Now.AddSeconds(30));
    private static Session Expired(string id, params Interest[] wants) => new(id, wants, Now.AddSeconds(-1));
    private static Interest Want(string vendor, string name) => new(vendor, name);

    private static readonly string[] None = Array.Empty<string>();
    private static IReadOnlyList<string> Ids(IEnumerable<DetectedProject> ps) => ps.Select(p => p.Id).ToList();

    /// <summary>Shorthand: (sessions, forceOff, previouslyWanted, detected) at <see cref="Now"/>.</summary>
    private static ReconcilePlan Plan(Session[] sessions, string[] forceOff, string[] prevWanted, DetectedProject[] detected) =>
        Reconciler.Plan(sessions, forceOff, prevWanted, detected, Now);

    [Fact]
    public void A_wanted_idle_project_binds()
    {
        var plan = Plan(new[] { Live("s1", Want("codesys", "A")) }, None, None, new[] { Proj("codesys", "A") });
        Assert.Equal(new[] { "codesys:A" }, Ids(plan.ToBind));
        Assert.Empty(plan.ToUnbind);
    }

    [Fact]
    public void Two_sessions_wanting_two_idle_projects_bind_both_independently()
    {
        var detected = new[] { Proj("codesys", "A"), Proj("twincat", "B") };
        var plan = Plan(new[] { Live("desktop", Want("codesys", "A")), Live("vscode", Want("twincat", "B")) }, None, None, detected);

        Assert.Equal(new[] { "codesys:A", "twincat:B" }, Ids(plan.ToBind).OrderBy(x => x));
        Assert.Empty(plan.ToUnbind);
    }

    [Fact]
    public void A_never_wanted_serving_bridge_is_left_untouched()
    {
        // THE regression the level-triggered model got wrong: a bridge no session has ever declared serves by default
        // (a loaded IDE host). Connecting A must not gate its idle-or-serving neighbour B — B was never wanted, so it
        // is not an edge to gate. (Standalone `volt push` depends on this: no GUI session != gated bridge.)
        var detected = new[] { Proj("codesys", "A"), Proj("codesys", "B", serving: true) };
        var plan = Plan(new[] { Live("s1", Want("codesys", "A")) }, None, None, detected);

        Assert.Equal(new[] { "codesys:A" }, Ids(plan.ToBind)); // A resumed
        Assert.Empty(plan.ToUnbind);                            // B untouched, still serving
    }

    [Fact]
    public void The_last_session_leaving_a_project_gates_it_the_wanted_to_unwanted_edge()
    {
        // A was wanted last pass (previouslyWanted) and is serving; now nothing wants it (the session crashed).
        var detected = new[] { Proj("codesys", "A", serving: true) };
        var plan = Plan(new[] { Expired("crashed", Want("codesys", "A")) }, None, new[] { "codesys:A" }, detected);

        Assert.Empty(plan.ToBind);
        Assert.Equal(new[] { "codesys:A" }, Ids(plan.ToUnbind));
    }

    [Fact]
    public void Two_sessions_want_the_same_project_and_one_leaving_keeps_it_serving()
    {
        // A is served and was wanted last pass; the session that leaves is not the last one wanting A.
        var detected = new[] { Proj("codesys", "A", serving: true) };
        var plan = Plan(
            new[] { Live("stays", Want("codesys", "A")), Expired("left", Want("codesys", "A")) },
            None, new[] { "codesys:A" }, detected);

        Assert.Empty(plan.ToBind);
        Assert.Empty(plan.ToUnbind); // still wanted by the live session → no leave edge
    }

    [Fact]
    public void A_lapsed_lease_that_was_never_previously_served_gates_nothing()
    {
        // The session expired and its project is idle and was not in previouslyWanted — nothing to bind or gate.
        var detected = new[] { Proj("codesys", "A") };
        var plan = Plan(new[] { Expired("crashed", Want("codesys", "A")) }, None, None, detected);

        Assert.Empty(plan.ToBind);
        Assert.Empty(plan.ToUnbind);
    }

    [Fact]
    public void Force_off_gates_a_serving_project_even_though_a_session_wants_it()
    {
        var detected = new[] { Proj("codesys", "A", serving: true) };
        var plan = Plan(new[] { Live("s1", Want("codesys", "A")) }, new[] { "codesys:A" }, None, detected);

        Assert.Empty(plan.ToBind);
        Assert.Equal(new[] { "codesys:A" }, Ids(plan.ToUnbind)); // supervisor override wins, no prior-wanted needed
    }

    [Fact]
    public void Force_off_keeps_an_idle_wanted_project_unbound()
    {
        var detected = new[] { Proj("codesys", "A") };
        var plan = Plan(new[] { Live("s1", Want("codesys", "A")) }, new[] { "codesys:A" }, None, detected);

        Assert.Empty(plan.ToBind); // wanted, but force-off removes it from desired
        Assert.Empty(plan.ToUnbind);
    }

    [Fact]
    public void An_interest_whose_project_is_not_detected_waits_without_error()
    {
        var detected = new[] { Proj("codesys", "Present") };
        var plan = Plan(new[] { Live("s1", Want("codesys", "Ghost")) }, None, None, detected);

        Assert.Empty(plan.ToBind);
        Assert.Empty(plan.ToUnbind);
    }

    [Fact]
    public void Interest_resolves_by_vendor_and_name_so_an_ide_restart_rebinds()
    {
        var detected = new[] { Proj("codesys", "M") };
        var plan = Plan(new[] { Live("s1", Want("codesys", "M")) }, None, None, detected);
        Assert.Equal(new[] { "codesys:M" }, Ids(plan.ToBind));
    }

    [Fact]
    public void Same_name_across_vendors_are_two_interests_two_rows()
    {
        var detected = new[] { Proj("codesys", "Shared"), Proj("twincat", "Shared") };
        var plan = Plan(new[] { Live("s1", Want("codesys", "Shared")) }, None, None, detected);

        Assert.Equal(new[] { "codesys:Shared" }, Ids(plan.ToBind)); // only the CODESYS one; the TwinCAT one untouched
        Assert.Empty(plan.ToUnbind);
    }

    // ── the one-project-per-worker limit (a shared TwinCAT pipe) + the anti-thrash invariant ──

    [Fact]
    public void One_shared_worker_with_two_wanted_projects_binds_exactly_one()
    {
        const string worker = "volt.bridge.twincat.9000";
        var detected = new[] { Proj("twincat", "A", pipe: worker), Proj("twincat", "B", pipe: worker) };
        var plan = Plan(new[] { Live("s1", Want("twincat", "A"), Want("twincat", "B")) }, None, None, detected);

        Assert.Single(plan.ToBind); // the worker serves one at a time — not both
        Assert.Empty(plan.ToUnbind);
    }

    [Fact]
    public void A_shared_worker_keeps_its_serving_wanted_project_and_never_thrashes()
    {
        const string worker = "volt.bridge.twincat.9000";
        var detected = new[] { Proj("twincat", "A", serving: true, pipe: worker), Proj("twincat", "B", pipe: worker) };
        var plan = Plan(
            new[] { Live("s1", Want("twincat", "A"), Want("twincat", "B")) }, None,
            new[] { "twincat:A", "twincat:B" }, detected);

        Assert.Empty(plan.ToBind);
        Assert.Empty(plan.ToUnbind); // incumbent holds, sibling waits, no leave edge
    }

    [Fact]
    public void A_second_pass_over_the_applied_plan_is_a_no_op_convergence()
    {
        const string worker = "volt.bridge.twincat.9000";
        var sessions = new[] { Live("s1", Want("twincat", "A"), Want("twincat", "B")) };

        var cold = new[] { Proj("twincat", "A", pipe: worker), Proj("twincat", "B", pipe: worker) };
        var pass1 = Plan(sessions, None, None, cold);
        var boundId = Assert.Single(pass1.ToBind).Id;

        // Apply: the bound project now serves; carry pass1's wanted set forward as previouslyWanted.
        var applied = cold.Select(p => p.Id == boundId ? p with { Status = HealthStatus.Healthy } : p).ToArray();
        var pass2 = Plan(sessions, None, pass1.Wanted.ToArray(), applied);

        Assert.Empty(pass2.ToBind);
        Assert.Empty(pass2.ToUnbind);
    }

    [Fact]
    public void An_unwanted_incumbent_that_lost_interest_is_gated_and_the_wanted_sibling_bound_in_one_pass()
    {
        // Shared worker was serving X (wanted last pass) while the session now wants Y instead: gate X (its leave
        // edge) and bind Y together — deselect then select retargets the worker in one reconcile.
        const string worker = "volt.bridge.twincat.9000";
        var detected = new[] { Proj("twincat", "X", serving: true, pipe: worker), Proj("twincat", "Y", pipe: worker) };
        var plan = Plan(new[] { Live("s1", Want("twincat", "Y")) }, None, new[] { "twincat:X" }, detected);

        Assert.Equal(new[] { "twincat:X" }, Ids(plan.ToUnbind));
        Assert.Equal(new[] { "twincat:Y" }, Ids(plan.ToBind));
    }

    [Fact]
    public void When_all_sessions_go_away_every_previously_wanted_serving_project_is_gated()
    {
        var detected = new[] { Proj("codesys", "A", serving: true), Proj("twincat", "B", serving: true) };
        var plan = Plan(Array.Empty<Session>(), None, new[] { "codesys:A", "twincat:B" }, detected);

        Assert.Empty(plan.ToBind);
        Assert.Equal(new[] { "codesys:A", "twincat:B" }, Ids(plan.ToUnbind).OrderBy(x => x));
    }

    [Fact]
    public void After_a_connector_restart_nothing_is_gated_until_a_client_leaves()
    {
        // previouslyWanted is empty (fresh process), so even though projects serve and no session has re-declared yet,
        // there are no leave edges — everything keeps serving. This is what removes the need for a startup grace window.
        var detected = new[] { Proj("codesys", "A", serving: true), Proj("twincat", "B", serving: true) };
        var plan = Plan(Array.Empty<Session>(), None, None, detected);

        Assert.Empty(plan.ToBind);
        Assert.Empty(plan.ToUnbind);
    }
}
