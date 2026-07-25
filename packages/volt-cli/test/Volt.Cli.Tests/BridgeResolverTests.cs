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
}
