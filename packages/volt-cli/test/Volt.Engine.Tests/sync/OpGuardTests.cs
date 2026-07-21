using System.Collections.Generic;
using Volt.Engine;
using Volt.Engine.Sync;
using Volt.Engine.Wire;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>The in-op "connected + right project" guard that replaced the client's pre-op health round-trip. It's
/// vendor-agnostic Core, so one parameterized fixture covers CODESYS- and TwinCAT-shaped health. Proves: a match
/// proceeds, a mismatch is WRONG_PROJECT, a disconnected bridge is PLC_DISCONNECTED, `push --force` is still
/// identity-guarded even with a null version lease, and no expected identity ⇒ connected-only (init/older client).</summary>
public class OpGuardTests
{
    private static FakeIde Ide(string platform, string project, bool connected = true) => new(
        FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
    { HealthConnected = connected, HealthPlatform = platform, HealthProjectName = project };

    [Theory]
    [InlineData("codesys", "Demo")]
    [InlineData("twincat", "PLC_A")]
    public void Fetch_of_the_bound_project_proceeds_and_echoes_the_identity(string platform, string project)
    {
        var resp = FetchService.Handle(Ide(platform, project),
            new FetchRequest { Init = true, ExpectedPlatform = platform, ExpectedProjectName = project });
        Assert.Equal(platform, resp.Platform);       // echoed back so the client can confirm before merging
        Assert.Equal(project, resp.ProjectName);
    }

    [Theory]
    [InlineData("codesys", "Demo")]
    [InlineData("twincat", "PLC_A")]
    public void A_wrong_bound_project_is_refused_with_WRONG_PROJECT(string platform, string project)
    {
        var ex = Assert.Throws<BridgeException>(() => FetchService.Handle(Ide(platform, project),
            new FetchRequest { Init = true, ExpectedPlatform = platform, ExpectedProjectName = "SomethingElse" }));
        Assert.Equal(BridgeErrorCodes.WrongProject, ex.ErrorCode);
        Assert.Contains(project, ex.Message);
    }

    [Fact]
    public void A_disconnected_bridge_is_refused_with_PLC_DISCONNECTED()
    {
        var ex = Assert.Throws<BridgeException>(() => FetchService.Handle(Ide("codesys", "Demo", connected: false),
            new FetchRequest { Init = true, ExpectedPlatform = "codesys", ExpectedProjectName = "Demo" }));
        Assert.Equal(BridgeErrorCodes.PlcDisconnected, ex.ErrorCode);
    }

    [Fact]
    public void Push_force_still_refuses_the_wrong_project_even_with_no_version_lease()
    {
        // --force nulls ExpectedProjectVersion (the version gate); identity is then its ONLY guard — it must hold.
        var ex = Assert.Throws<BridgeException>(() => PushService.Handle(Ide("codesys", "Demo"),
            new PushRequest { Force = true, ExpectedProjectVersion = null, Ops = new List<PushOp>(),
                              ExpectedPlatform = "codesys", ExpectedProjectName = "SomethingElse" }));
        Assert.Equal(BridgeErrorCodes.WrongProject, ex.ErrorCode);
    }

    [Fact]
    public void No_expected_identity_checks_only_connected_not_the_project()
    {
        // init/older client: null Expected* ⇒ any loaded project is fine (only the connected check runs).
        var resp = FetchService.Handle(Ide("codesys", "WhateverProject"), new FetchRequest { Init = true });
        Assert.Equal("WhateverProject", resp.ProjectName); // proceeded despite no expected identity
    }
}
