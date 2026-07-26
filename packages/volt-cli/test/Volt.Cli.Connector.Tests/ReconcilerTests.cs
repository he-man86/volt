using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Cli.Connector;
using Volt.Cli.Transport;
using Xunit;

namespace Volt.Cli.Connector.Tests;

/// <summary>
/// The PURE reconciler — the correctness heart of the session model — tested with no pipes, no manager, no clock
/// dependency (the instant is a parameter). Every rule from the connector-session-model design §10/§11 has a case:
/// union of interests, lapsed-lease drop-out, force-off, startup grace, the one-project-per-worker limit, resolve
/// by durable identity, and — the anti-thrash invariant — that a second pass over the applied state is a NO-OP.
/// </summary>
public class ReconcilerTests
{
    private static readonly DateTime Now = new(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime NoGrace = DateTime.MinValue;

    /// <summary>A detected project. A UNIQUE pipe per project by default (so nothing false-contends); pass the SAME
    /// pipe to two to model a shared TwinCAT worker.</summary>
    private static DetectedProject Proj(string vendor, string name, bool serving = false, string? pipe = null) =>
        new(DetectedProject.MakeId(vendor, new ProjectRef(name)), name, vendor, false, new ProjectRef(name),
            Pipe: pipe ?? $"volt.bridge.{vendor}.{name}",
            Status: serving ? HealthStatus.Healthy : HealthStatus.Idle);

    private static Session Live(string id, params Interest[] wants) => new(id, wants, Now.AddSeconds(30));
    private static Session Expired(string id, params Interest[] wants) => new(id, wants, Now.AddSeconds(-1));
    private static Interest Want(string vendor, string name) => new(vendor, name);

    private static readonly string[] NoForceOff = Array.Empty<string>();
    private static IReadOnlyList<string> Ids(IEnumerable<DetectedProject> ps) => ps.Select(p => p.Id).ToList();

    [Fact]
    public void A_wanted_detected_project_binds()
    {
        var detected = new[] { Proj("codesys", "A") };
        var plan = Reconciler.Plan(new[] { Live("s1", Want("codesys", "A")) }, NoForceOff, detected, Now, NoGrace);

        Assert.Equal(new[] { "codesys:A" }, Ids(plan.ToBind));
        Assert.Empty(plan.ToUnbind);
    }

    [Fact]
    public void Two_sessions_wanting_two_projects_bind_both_independently()
    {
        var detected = new[] { Proj("codesys", "A"), Proj("twincat", "B") };
        var plan = Reconciler.Plan(
            new[] { Live("desktop", Want("codesys", "A")), Live("vscode", Want("twincat", "B")) },
            NoForceOff, detected, Now, NoGrace);

        Assert.Equal(new[] { "codesys:A", "twincat:B" }, Ids(plan.ToBind).OrderBy(x => x));
        Assert.Empty(plan.ToUnbind);
    }

    [Fact]
    public void Two_sessions_want_the_same_project_and_one_leaving_keeps_it_serving()
    {
        // The whole point of the union: A is served; the session that leaves is not the last one wanting A.
        var detected = new[] { Proj("codesys", "A", serving: true) };
        var plan = Reconciler.Plan(
            new[] { Live("stays", Want("codesys", "A")), Expired("left", Want("codesys", "A")) },
            NoForceOff, detected, Now, NoGrace);

        Assert.Empty(plan.ToBind);   // already serving
        Assert.Empty(plan.ToUnbind); // still wanted by the live session → not gated
    }

    [Fact]
    public void The_last_session_wanting_a_project_leaving_unbinds_it()
    {
        var detected = new[] { Proj("codesys", "A", serving: true) };
        // Only session that wanted A has a lapsed lease (crash) → nothing wants A anymore.
        var plan = Reconciler.Plan(new[] { Expired("crashed", Want("codesys", "A")) }, NoForceOff, detected, Now, NoGrace);

        Assert.Empty(plan.ToBind);
        Assert.Equal(new[] { "codesys:A" }, Ids(plan.ToUnbind));
    }

    [Fact]
    public void A_lapsed_lease_contributes_no_interest()
    {
        var detected = new[] { Proj("codesys", "A") };
        var plan = Reconciler.Plan(new[] { Expired("crashed", Want("codesys", "A")) }, NoForceOff, detected, Now, NoGrace);

        Assert.Empty(plan.ToBind); // idle + unwanted → nothing to do
        Assert.Empty(plan.ToUnbind);
    }

    [Fact]
    public void Force_off_unbinds_a_serving_project_even_though_a_session_wants_it()
    {
        var detected = new[] { Proj("codesys", "A", serving: true) };
        var plan = Reconciler.Plan(
            new[] { Live("s1", Want("codesys", "A")) }, new[] { "codesys:A" }, detected, Now, NoGrace);

        Assert.Empty(plan.ToBind);
        Assert.Equal(new[] { "codesys:A" }, Ids(plan.ToUnbind)); // supervisor override wins over interest
    }

    [Fact]
    public void Force_off_keeps_an_idle_wanted_project_unbound()
    {
        var detected = new[] { Proj("codesys", "A") };
        var plan = Reconciler.Plan(
            new[] { Live("s1", Want("codesys", "A")) }, new[] { "codesys:A" }, detected, Now, NoGrace);

        Assert.Empty(plan.ToBind); // wanted, but force-off removes it from desired
        Assert.Empty(plan.ToUnbind);
    }

    [Fact]
    public void Startup_grace_suppresses_unbind_but_not_bind()
    {
        var graceUntil = Now.AddSeconds(8);
        // A serves but nothing wants it (clients haven't re-declared yet); B is wanted and idle.
        var detected = new[] { Proj("codesys", "A", serving: true), Proj("codesys", "B") };
        var plan = Reconciler.Plan(new[] { Live("s1", Want("codesys", "B")) }, NoForceOff, detected, Now, graceUntil);

        Assert.Equal(new[] { "codesys:B" }, Ids(plan.ToBind)); // bind is never delayed
        Assert.Empty(plan.ToUnbind);                           // A survives the grace window

        // After the window, the unwanted serving A is gated.
        var after = Reconciler.Plan(new[] { Live("s1", Want("codesys", "B")) }, NoForceOff, detected, graceUntil.AddSeconds(1), graceUntil);
        Assert.Equal(new[] { "codesys:A" }, Ids(after.ToUnbind));
    }

    [Fact]
    public void An_interest_whose_project_is_not_detected_waits_without_error()
    {
        var detected = new[] { Proj("codesys", "Present") };
        var plan = Reconciler.Plan(new[] { Live("s1", Want("codesys", "Ghost")) }, NoForceOff, detected, Now, NoGrace);

        Assert.Empty(plan.ToBind);
        Assert.Empty(plan.ToUnbind);
    }

    [Fact]
    public void Interest_resolves_by_vendor_and_name_so_an_ide_restart_rebinds()
    {
        // The interest is durable {codesys, M}; whatever detected row currently carries that identity is what binds —
        // a restarted IDE re-detects the same identity and is re-resolved with no client action.
        var detected = new[] { Proj("codesys", "M") };
        var plan = Reconciler.Plan(new[] { Live("s1", Want("codesys", "M")) }, NoForceOff, detected, Now, NoGrace);
        Assert.Equal(new[] { "codesys:M" }, Ids(plan.ToBind));
    }

    [Fact]
    public void Same_name_across_vendors_are_two_interests_two_rows()
    {
        var detected = new[] { Proj("codesys", "Shared"), Proj("twincat", "Shared") };
        var plan = Reconciler.Plan(
            new[] { Live("s1", Want("codesys", "Shared")) }, NoForceOff, detected, Now, NoGrace);

        Assert.Equal(new[] { "codesys:Shared" }, Ids(plan.ToBind)); // only the CODESYS one; the TwinCAT one untouched
        Assert.Empty(plan.ToUnbind);
    }

    // ── the one-project-per-worker limit (a shared TwinCAT pipe) + the anti-thrash invariant ──

    [Fact]
    public void One_shared_worker_with_two_wanted_projects_binds_exactly_one()
    {
        const string worker = "volt.bridge.twincat.9000";
        var detected = new[] { Proj("twincat", "A", pipe: worker), Proj("twincat", "B", pipe: worker) };
        var plan = Reconciler.Plan(
            new[] { Live("s1", Want("twincat", "A"), Want("twincat", "B")) }, NoForceOff, detected, Now, NoGrace);

        Assert.Single(plan.ToBind); // the worker serves one at a time — not both
        Assert.Empty(plan.ToUnbind);
    }

    [Fact]
    public void A_shared_worker_keeps_its_serving_wanted_project_and_never_thrashes()
    {
        // A already serves on the shared worker; B is wanted-but-idle on the SAME worker. The reconciler must keep A
        // and NOT bind B (which would kick A off, only for the next pass to rebind A — the flap this rule prevents).
        const string worker = "volt.bridge.twincat.9000";
        var detected = new[] { Proj("twincat", "A", serving: true, pipe: worker), Proj("twincat", "B", pipe: worker) };
        var plan = Reconciler.Plan(
            new[] { Live("s1", Want("twincat", "A"), Want("twincat", "B")) }, NoForceOff, detected, Now, NoGrace);

        Assert.Empty(plan.ToBind);
        Assert.Empty(plan.ToUnbind); // stable: the incumbent holds, its sibling waits
    }

    [Fact]
    public void A_second_pass_over_the_applied_plan_is_a_no_op_convergence()
    {
        // Cold start on a shared worker: pass 1 binds one; simulate applying it (that project now serves); pass 2
        // must do nothing. Proves the loop converges rather than oscillating.
        const string worker = "volt.bridge.twincat.9000";
        var sessions = new[] { Live("s1", Want("twincat", "A"), Want("twincat", "B")) };

        var cold = new[] { Proj("twincat", "A", pipe: worker), Proj("twincat", "B", pipe: worker) };
        var pass1 = Reconciler.Plan(sessions, NoForceOff, cold, Now, NoGrace);
        var boundId = Assert.Single(pass1.ToBind).Id;

        // Apply: the bound project now serves; the other stays idle.
        var applied = cold.Select(p => p.Id == boundId ? p with { Status = HealthStatus.Healthy } : p).ToList();
        var pass2 = Reconciler.Plan(sessions, NoForceOff, applied, Now, NoGrace);

        Assert.Empty(pass2.ToBind);
        Assert.Empty(pass2.ToUnbind);
    }

    [Fact]
    public void An_unwanted_incumbent_is_gated_and_the_wanted_sibling_bound_in_one_pass()
    {
        // Shared worker serving X (nobody wants it) while Y is wanted-idle: gate X and bind Y together — deselect
        // then select retargets the worker to Y in a single reconcile.
        const string worker = "volt.bridge.twincat.9000";
        var detected = new[] { Proj("twincat", "X", serving: true, pipe: worker), Proj("twincat", "Y", pipe: worker) };
        var plan = Reconciler.Plan(new[] { Live("s1", Want("twincat", "Y")) }, NoForceOff, detected, Now, NoGrace);

        Assert.Equal(new[] { "twincat:X" }, Ids(plan.ToUnbind));
        Assert.Equal(new[] { "twincat:Y" }, Ids(plan.ToBind));
    }

    [Fact]
    public void No_sessions_at_all_unbinds_everything_serving()
    {
        var detected = new[] { Proj("codesys", "A", serving: true), Proj("twincat", "B", serving: true) };
        var plan = Reconciler.Plan(Array.Empty<Session>(), NoForceOff, detected, Now, NoGrace);

        Assert.Empty(plan.ToBind);
        Assert.Equal(new[] { "codesys:A", "twincat:B" }, Ids(plan.ToUnbind).OrderBy(x => x));
    }
}
