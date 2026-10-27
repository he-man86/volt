using System.Collections.Generic;
using Volt.Contracts;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A WRITE NAMES THE PROJECT IT WRITES (openspec <c>push-requires-project-identity</c>). <c>push</c> and <c>build</c>
/// without <c>expectedPlatform</c> and <c>expectedProjectName</c> ran only the connected check, so they wrote into
/// whatever project the bridge served (volt-cli-rework census, finding P1). Both members are required on both ops: a
/// request missing one, or sending it empty, is BAD_REQUEST naming each missing member, before anything is walked,
/// written or built. A build counts as a write: on TwinCAT it saves the served solution's changed documents (DIALECT
/// D45, D46). Reads stay optional: they write nothing and echo what they walked.
/// </summary>
public class WriteRequiresBindingTests
{
    private static FakeIde Ide(bool connected = true) =>
        new(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        { HealthConnected = connected, HealthPlatform = "codesys", HealthProjectName = "Demo" };

    private static PushRequest Push(string? platform, string? project) => new()
    {
        ExpectedPlatform = platform, ExpectedProjectName = project,
        Ops = new List<PushOp> { new SetItemOp { Name = "P.pou", SourceText = "PROGRAM P\nVAR\nEND_VAR\n%LANGUAGE ST\ny := 2;\nEND_PROGRAM\n" } },
        Force = true,
    };

    [Theory]
    [InlineData(null, null, "expectedPlatform and expectedProjectName")]
    [InlineData("codesys", null, "expectedProjectName")]
    [InlineData(null, "Demo", "expectedPlatform")]
    [InlineData("", "Demo", "expectedPlatform")]
    [InlineData("codesys", "", "expectedProjectName")]
    public void A_push_without_its_binding_is_refused_naming_the_missing_member_and_nothing_is_walked(
        string? platform, string? project, string named)
    {
        var ide = Ide();

        var ex = Assert.Throws<BridgeException>(() => PushService.Handle(ide, Push(platform, project)));

        Assert.Equal(BridgeErrorCodes.BadRequest, ex.ErrorCode);
        Assert.Contains($"push: {named}", ex.Message);
        Assert.Equal(0, ide.WalkCalls);
        Assert.Empty(ide.Recorded);
    }

    /// <summary>The missing member is the request's fault whatever the bridge's state: a disconnected bridge answers it
    /// too, rather than PLC_DISCONNECTED, which would send the client to reconnect a request that can never land.</summary>
    [Fact]
    public void A_push_without_its_binding_is_refused_as_a_bad_request_on_a_disconnected_bridge_too()
    {
        var ex = Assert.Throws<BridgeException>(() => PushService.Handle(Ide(connected: false), Push(null, null)));

        Assert.Equal(BridgeErrorCodes.BadRequest, ex.ErrorCode);
    }

    [Theory]
    [InlineData(null, null, "expectedPlatform and expectedProjectName")]
    [InlineData("codesys", null, "expectedProjectName")]
    [InlineData(null, "Demo", "expectedPlatform")]
    public void A_build_without_its_binding_is_refused_naming_the_missing_member_and_nothing_is_built(
        string? platform, string? project, string named)
    {
        var ide = Ide();

        var ex = Assert.Throws<BridgeException>(() =>
            BuildService.Handle(ide, new BuildRequest { ExpectedPlatform = platform, ExpectedProjectName = project }));

        Assert.Equal(BridgeErrorCodes.BadRequest, ex.ErrorCode);
        Assert.Contains($"build: {named}", ex.Message);
        Assert.Empty(ide.BuildSequence);
        Assert.Equal(0, ide.WalkCalls);
    }

    /// <summary>A bound push and build proceed as before.</summary>
    [Fact]
    public void A_bound_push_and_build_proceed()
    {
        var ide = Ide();

        Assert.True(PushService.Handle(ide, Push("codesys", "Demo")).Landed());
        Assert.True(BuildService.Handle(ide, new BuildRequest { ExpectedPlatform = "codesys", ExpectedProjectName = "Demo" }).Success);
    }

    /// <summary>Reads are unchanged: a `refs` and a `fetch` (an `init` too) with no identity proceed and echo what they
    /// walked, which is what a client confirms before it merges.</summary>
    [Fact]
    public void A_read_without_identity_proceeds_and_echoes_the_walked_identity()
    {
        var refs = RefsService.Handle(Ide());
        var init = FetchService.Handle(Ide(), new FetchRequest { Init = true });

        Assert.Equal(("codesys", "Demo"), (refs.Platform, refs.ProjectName));
        Assert.Equal(("codesys", "Demo"), (init.Platform, init.ProjectName));
    }
}
