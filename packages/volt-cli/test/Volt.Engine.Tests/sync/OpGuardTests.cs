using System.Collections.Generic;
using Volt.Engine;
using Xunit;

using Volt.Wire;
using Volt.Contracts;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

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

    /// <summary>Same bridge, but its CACHED health snapshot has no serving row while the LIVE signals say connected —
    /// TwinCAT's shape for a moment after a reconnect (health is throttled to ~5s; `IsConnected` is a live read).</summary>
    private static FakeIde StaleSnapshot(string platform, string project) => new(
        FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
    { HealthConnected = true, HealthPlatform = platform, HealthProjectName = project, StaleHealthSnapshot = true };

    private static PushRequest Empty(string platform, string project) => new()
    {
        Force = true, ExpectedProjectVersion = null, Ops = new List<PushOp>(),
        ExpectedPlatform = platform, ExpectedProjectName = project,
    };

    /// <summary>REGRESSION — the precondition must come from ONE LIVE signal. `IIdeSession` documents that the
    /// not-connected precondition is decided against `IsConnected`; `RefsService` did that, but `OpGuard` (every
    /// fetch/push/build) read `BuildHealthResponse().Connected` — a throttled CACHED snapshot on TwinCAT. So a WRITE
    /// was refused PLC_DISCONNECTED on stale state while a READ of the same bridge succeeded. Symptom: after an IDE
    /// close/reopen, `connect` and `refs` succeed and the first write fails.</summary>
    [Fact]
    public void A_write_is_not_refused_because_the_cached_health_snapshot_is_stale()
    {
        var ide = StaleSnapshot("codesys", "Demo");
        Assert.False(ide.BuildHealthResponse().Connected); // the snapshot really is stale
        Assert.True(ide.IsConnected);                      // ...while the live signal says connected
        PushService.Handle(ide, Empty("codesys", "Demo")); // must NOT throw
    }

    /// <summary>A read and a write must never disagree about whether the bridge is connected.</summary>
    [Fact]
    public void A_read_and_a_write_reach_the_same_verdict_on_a_stale_snapshot()
    {
        var ide = StaleSnapshot("twincat", "PLC_A");
        RefsService.Handle(ide);                            // the live-signal path already proceeded
        PushService.Handle(ide, Empty("twincat", "PLC_A")); // so the write must too
    }

    /// <summary>The fix must not become permissiveness: a REAL identity mismatch still refuses, and it refuses with
    /// WRONG_PROJECT (naming both projects) rather than degrading into PLC_DISCONNECTED because the cache was empty.</summary>
    [Fact]
    public void A_real_mismatch_still_refuses_when_the_snapshot_is_stale()
    {
        var ex = Assert.Throws<BridgeException>(() =>
            PushService.Handle(StaleSnapshot("codesys", "Demo"), Empty("codesys", "SomethingElse")));
        Assert.Equal(BridgeErrorCodes.WrongProject, ex.ErrorCode);
        Assert.Contains("Demo", ex.Message);
    }

    /// <summary>And a genuinely detached bridge still refuses even though nothing is stale.</summary>
    [Fact]
    public void A_detached_bridge_still_refuses_with_PLC_DISCONNECTED()
    {
        var ex = Assert.Throws<BridgeException>(() =>
            PushService.Handle(Ide("codesys", "Demo", connected: false), Empty("codesys", "Demo")));
        Assert.Equal(BridgeErrorCodes.PlcDisconnected, ex.ErrorCode);
    }

    [Fact]
    public void No_expected_identity_checks_only_connected_not_the_project()
    {
        // init/older client: null Expected* ⇒ any loaded project is fine (only the connected check runs).
        var resp = FetchService.Handle(Ide("codesys", "WhateverProject"), new FetchRequest { Init = true });
        Assert.Equal("WhateverProject", resp.ProjectName); // proceeded despite no expected identity
    }
}
