using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Cli.Sync;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>The per-vendor pipe-choice logic — the data-safety guard for multiple live IDEs. Never guesses: 0 or an
/// ambiguous match is a loud refusal, so a push can't land in the wrong IDE. Both vendors go through this ONE path
/// now (per-XAE TwinCAT + per-IDE CODESYS are both discovered per-pid).</summary>
public class BridgeResolverTests
{
    // A per-pipe project-list probe: each pipe maps to the projects its IDE has open (a TwinCAT window can list many).
    private static Func<string, IReadOnlyList<string>> Projects(Dictionary<string, string[]> map) =>
        p => map.TryGetValue(p, out var n) ? n : Array.Empty<string>();

    private static Func<string, IReadOnlyList<string>> Single(Dictionary<string, string?> map) =>
        p => map.TryGetValue(p, out var n) && n != null ? new[] { n } : Array.Empty<string>();

    [Fact]
    public void No_live_pipe_refuses()
    {
        var ex = Assert.Throws<BridgeError>(() => BridgeResolver.ChooseBridgePipe(new string[0], "Any", false, _ => Array.Empty<string>(), "CODESYS"));
        Assert.Equal("PLC_DISCONNECTED", ex.Code);
    }

    [Fact]
    public void Exactly_one_live_pipe_is_used_unambiguously()
    {
        var pipe = BridgeResolver.ChooseBridgePipe(new[] { "volt.bridge.codesys.7" }, "Whatever", false, _ => new[] { "SomethingElse" }, "CODESYS");
        Assert.Equal("volt.bridge.codesys.7", pipe);
    }

    [Fact]
    public void Several_live_matches_the_bound_project_by_name()
    {
        var pipes = new[] { "volt.bridge.codesys.1", "volt.bridge.codesys.2" };
        var names = Single(new() { ["volt.bridge.codesys.1"] = "MachineA", ["volt.bridge.codesys.2"] = "MachineB" });
        Assert.Equal("volt.bridge.codesys.2", BridgeResolver.ChooseBridgePipe(pipes, "MachineB", false, names, "CODESYS"));
    }

    [Fact]
    public void Several_live_none_matching_the_binding_refuses()
    {
        var pipes = new[] { "volt.bridge.codesys.1", "volt.bridge.codesys.2" };
        var names = Single(new() { ["volt.bridge.codesys.1"] = "MachineA", ["volt.bridge.codesys.2"] = "MachineB" });
        var ex = Assert.Throws<BridgeError>(() => BridgeResolver.ChooseBridgePipe(pipes, "MachineZ", false, names, "CODESYS"));
        Assert.Equal("PLC_DISCONNECTED", ex.Code);
    }

    [Fact]
    public void Two_live_with_the_same_project_name_refuses_rather_than_guess()
    {
        var pipes = new[] { "volt.bridge.codesys.1", "volt.bridge.codesys.2" };
        var names = Single(new() { ["volt.bridge.codesys.1"] = "Machine", ["volt.bridge.codesys.2"] = "Machine" });
        var ex = Assert.Throws<BridgeError>(() => BridgeResolver.ChooseBridgePipe(pipes, "Machine", false, names, "CODESYS"));
        Assert.Equal("AMBIGUOUS_BRIDGE", ex.Code);
    }

    [Fact]
    public void Init_with_several_live_demands_a_single_choice()
    {
        var pipes = new[] { "volt.bridge.codesys.1", "volt.bridge.codesys.2" };
        var ex = Assert.Throws<BridgeError>(() => BridgeResolver.ChooseBridgePipe(pipes, null, true, _ => new[] { "X" }, "CODESYS"));
        Assert.Equal("AMBIGUOUS_BRIDGE", ex.Code);
    }

    // ── per-XAE TwinCAT: the cases the old serving-name-only match got wrong ──────────────────────────────────

    [Fact]
    public void Twincat_matches_a_window_that_HAS_the_bound_project_even_when_not_the_only_one()
    {
        // A TwinCAT XAE window (one pipe) can hold SEVERAL projects. The bound project must match by MEMBERSHIP in
        // the window's project list — not by a single "serving" name (a not-yet-connected worker has none). This is
        // the case the old `nameOf(p) == boundName` (serving-project) resolver could not satisfy.
        var pipes = new[] { "volt.bridge.twincat.17844", "volt.bridge.twincat.33512" };
        var projects = Projects(new()
        {
            ["volt.bridge.twincat.17844"] = new[] { "TwinCAT Project13", "Shared_Lib" },
            ["volt.bridge.twincat.33512"] = new[] { "TwinCAT Project14" },
        });
        Assert.Equal("volt.bridge.twincat.17844", BridgeResolver.ChooseBridgePipe(pipes, "TwinCAT Project13", false, projects, "TwinCAT"));
        Assert.Equal("volt.bridge.twincat.33512", BridgeResolver.ChooseBridgePipe(pipes, "TwinCAT Project14", false, projects, "TwinCAT"));
    }

    [Fact]
    public void Twincat_a_not_connected_worker_still_resolves_by_its_open_project_list()
    {
        // A per-XAE worker starts NOT connected (no serving project) — health lists the window's projects as idle.
        // Resolution must still find it by that list; the old code returned null for a not-connected worker and
        // refused. (Two windows so the single-pipe shortcut doesn't mask it.)
        var pipes = new[] { "volt.bridge.twincat.100", "volt.bridge.twincat.200" };
        var projects = Projects(new()
        {
            ["volt.bridge.twincat.100"] = new[] { "MachineA" },   // idle, nothing selected — still discoverable
            ["volt.bridge.twincat.200"] = new[] { "MachineB" },
        });
        Assert.Equal("volt.bridge.twincat.100", BridgeResolver.ChooseBridgePipe(pipes, "MachineA", false, projects, "TwinCAT"));
    }

    [Fact]
    public void Two_twincat_windows_with_the_same_project_name_refuse_rather_than_guess()
    {
        var pipes = new[] { "volt.bridge.twincat.1", "volt.bridge.twincat.2" };
        var projects = Projects(new()
        {
            ["volt.bridge.twincat.1"] = new[] { "Plant" },
            ["volt.bridge.twincat.2"] = new[] { "Plant" },
        });
        var ex = Assert.Throws<BridgeError>(() => BridgeResolver.ChooseBridgePipe(pipes, "Plant", false, projects, "TwinCAT"));
        Assert.Equal("AMBIGUOUS_BRIDGE", ex.Code);
    }

    // ── an XAE no worker can reach (environment-dependency-audit 2.2) ────────────────────────────────────────────

    [Fact]
    public void An_elevated_XAE_seen_from_an_unelevated_CLI_is_named_not_sent_to_the_connector()
    {
        var why = BridgeResolver.UnreachableXae(new (int, bool?)[] { (4711, true), (4712, false) }, selfElevated: false);
        Assert.NotNull(why);
        Assert.Contains("pid 4711", why);
        Assert.Contains("runs elevated", why);
    }

    // Gate 2b: an unelevated XAE of this user beside an elevated/foreign one still has no worker when the connector is
    // stopped — its remedy (start the connector) must survive in the message, not be dropped for the other one's.
    [Theory]
    [InlineData(true)]   // beside an elevated XAE
    [InlineData(null)]   // beside another user's XAE (terminal server)
    public void An_unelevated_XAE_beside_an_unreachable_one_keeps_the_connector_advice(bool? other)
    {
        var why = BridgeResolver.UnreachableXae(new (int, bool?)[] { (4711, other), (4712, false) }, selfElevated: false);
        Assert.NotNull(why);
        Assert.Contains("pid 4711", why);
        Assert.Contains("pid 4712", why);
        Assert.Contains("start the Volt Connector", why);
    }

    [Fact]
    public void Only_unreachable_XAEs_say_nothing_about_the_connector()
    {
        var why = BridgeResolver.UnreachableXae(new (int, bool?)[] { (4711, true), (99, null) }, selfElevated: false);
        Assert.NotNull(why);
        Assert.DoesNotContain("start the Volt Connector", why);
    }

    // ── a pipe that refuses this process (environment-dependency-audit 2.2, gate 2b) ─────────────────────────────

    private static Func<string, IReadOnlyList<string>> Refusing(string refused, Dictionary<string, string[]> others) =>
        p => p == refused ? throw new BridgeError(BridgeError.AccessDeniedCode, $"refused {p}") : Projects(others)(p);

    [Fact]
    public void A_refusing_pipe_beside_the_matching_one_does_not_stop_the_resolve()
    {
        var pick = BridgeResolver.ChooseBridgePipe(new[] { "a", "b" }, "Plant", false,
            Refusing("a", new() { ["b"] = new[] { "Plant" } }), "CODESYS");
        Assert.Equal("b", pick);
    }

    [Fact]
    public void A_refusing_pipe_is_named_when_no_pipe_matches()
    {
        var ex = Assert.Throws<BridgeError>(() => BridgeResolver.ChooseBridgePipe(new[] { "a", "b" }, "Plant", false,
            Refusing("a", new() { ["b"] = new[] { "Other" } }), "CODESYS"));
        Assert.Equal(BridgeError.AccessDeniedCode, ex.Code);
        Assert.Contains("refused a", ex.Message);
        Assert.Contains("'Plant'", ex.Message);
    }

    // ── a pipe whose bridge predates this wire (wire-final-shape 4.3c) ──────────────────────────────────────────

    private static Func<string, IReadOnlyList<string>> RefusingWith(Dictionary<string, string> codes, Dictionary<string, string[]> others) =>
        p => codes.TryGetValue(p, out var code) ? throw new BridgeError(code, $"refused {p}") : Projects(others)(p);

    [Fact]
    public void A_bridge_that_predates_this_wire_beside_the_matching_one_does_not_stop_the_resolve()
    {
        var pick = BridgeResolver.ChooseBridgePipe(new[] { "p1", "p2" }, "Plant", false,
            RefusingWith(new() { ["p1"] = BridgeError.PredatesWireCode }, new() { ["p2"] = new[] { "Plant" } }), "codesys");
        Assert.Equal("p2", pick);
    }

    /// <summary>Its IDE is THERE and may hold the bound project, so it is named — never "isn't open in any" — and the
    /// code is its own: a bridge out of date is not an access denial, and is reachable.</summary>
    [Fact]
    public void A_bridge_that_predates_this_wire_is_named_by_its_own_code_when_no_pipe_matches()
    {
        var ex = Assert.Throws<BridgeError>(() => BridgeResolver.ChooseBridgePipe(new[] { "p1", "p2" }, "Plant", false,
            RefusingWith(new() { ["p1"] = BridgeError.PredatesWireCode }, new() { ["p2"] = new string[0] }), "codesys"));
        Assert.Equal(BridgeError.PredatesWireCode, ex.Code);
        Assert.Contains("refused p1", ex.Message);
        Assert.Contains("'Plant'", ex.Message);
        Assert.DoesNotContain("can reach", ex.Message);
    }

    /// <summary>Refusals of two kinds have no one code to borrow: the resolver states that several pipes refused, and
    /// the message names each with its own cause.</summary>
    [Fact]
    public void Refusals_of_two_kinds_are_each_named_under_the_resolvers_own_code()
    {
        var ex = Assert.Throws<BridgeError>(() => BridgeResolver.ChooseBridgePipe(new[] { "p1", "p2", "p3" }, "Plant", false,
            RefusingWith(new() { ["p1"] = BridgeError.AccessDeniedCode, ["p2"] = BridgeError.PredatesWireCode },
                new() { ["p3"] = new string[0] }), "codesys"));
        Assert.Equal(BridgeResolver.BridgesRefused, ex.Code);
        Assert.Contains("refused p1", ex.Message);
        Assert.Contains("refused p2", ex.Message);
    }

    [Fact]
    public void An_XAE_whose_token_cannot_be_read_is_named_as_another_users()
    {
        var why = BridgeResolver.UnreachableXae(new (int, bool?)[] { (99, null) }, selfElevated: false);
        Assert.NotNull(why);
        Assert.Contains("pid 99", why);
        Assert.Contains("another Windows user", why);
        Assert.DoesNotContain("elevated", why);
    }

    [Theory]
    [InlineData(false)]   // no XAE, or only unelevated ones: the connector is the answer, as before
    [InlineData(true)]    // an elevated CLI: elevation is not what keeps the worker away
    public void Elevation_is_named_only_when_it_is_the_reason(bool selfElevated)
    {
        var shells = selfElevated ? new (int, bool?)[] { (1, true) } : new (int, bool?)[] { (1, false) };
        Assert.Null(BridgeResolver.UnreachableXae(shells, selfElevated));
        Assert.Null(BridgeResolver.UnreachableXae(System.Array.Empty<(int, bool?)>(), false));
    }
}
