using System;
using System.Collections.Generic;
using Volt.Cli.Sync;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>The CODESYS pipe-choice logic — the data-safety guard for multiple live IDEs. Never guesses: 0 or an
/// ambiguous match is a loud refusal, so a push can't land in the wrong CODESYS.</summary>
public class BridgeResolverTests
{
    private static Func<string, string?> Names(Dictionary<string, string?> map) => p => map.TryGetValue(p, out var n) ? n : null;

    [Fact]
    public void No_live_pipe_refuses()
    {
        var ex = Assert.Throws<BridgeError>(() => BridgeResolver.ChooseCodesysPipe(new string[0], "Any", false, _ => null));
        Assert.Equal("PLC_DISCONNECTED", ex.Code);
    }

    [Fact]
    public void Exactly_one_live_pipe_is_used_unambiguously()
    {
        var pipe = BridgeResolver.ChooseCodesysPipe(new[] { "volt.bridge.codesys.7" }, "Whatever", false, _ => "SomethingElse");
        Assert.Equal("volt.bridge.codesys.7", pipe);
    }

    [Fact]
    public void Several_live_matches_the_bound_project_by_name()
    {
        var pipes = new[] { "volt.bridge.codesys.1", "volt.bridge.codesys.2" };
        var names = Names(new() { ["volt.bridge.codesys.1"] = "MachineA", ["volt.bridge.codesys.2"] = "MachineB" });
        Assert.Equal("volt.bridge.codesys.2", BridgeResolver.ChooseCodesysPipe(pipes, "MachineB", false, names));
    }

    [Fact]
    public void Several_live_none_matching_the_binding_refuses()
    {
        var pipes = new[] { "volt.bridge.codesys.1", "volt.bridge.codesys.2" };
        var names = Names(new() { ["volt.bridge.codesys.1"] = "MachineA", ["volt.bridge.codesys.2"] = "MachineB" });
        var ex = Assert.Throws<BridgeError>(() => BridgeResolver.ChooseCodesysPipe(pipes, "MachineZ", false, names));
        Assert.Equal("PLC_DISCONNECTED", ex.Code);
    }

    [Fact]
    public void Two_live_with_the_same_project_name_refuses_rather_than_guess()
    {
        var pipes = new[] { "volt.bridge.codesys.1", "volt.bridge.codesys.2" };
        var names = Names(new() { ["volt.bridge.codesys.1"] = "Machine", ["volt.bridge.codesys.2"] = "Machine" });
        var ex = Assert.Throws<BridgeError>(() => BridgeResolver.ChooseCodesysPipe(pipes, "Machine", false, names));
        Assert.Equal("AMBIGUOUS_BRIDGE", ex.Code);
    }

    [Fact]
    public void Init_with_several_live_demands_a_single_choice()
    {
        var pipes = new[] { "volt.bridge.codesys.1", "volt.bridge.codesys.2" };
        var ex = Assert.Throws<BridgeError>(() => BridgeResolver.ChooseCodesysPipe(pipes, null, true, _ => "X"));
        Assert.Equal("AMBIGUOUS_BRIDGE", ex.Code);
    }
}
