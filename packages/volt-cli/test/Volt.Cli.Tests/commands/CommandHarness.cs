using System;
using System.IO;
using Volt.Cli.Sync;
using Volt.Wire;
using Volt.Contracts;
using Volt.Engine.Wire;

namespace Volt.Cli.Tests;

/// <summary>The white-box CLI harness: a live pipe host over a <see cref="FakeIde"/> + a fresh git repo bound to
/// project "Demo" + a <see cref="BridgeClient"/> on the same pipe, driven through the ported <see cref="Commands"/>.
/// Shared by every per-command test file. Same real bridge + real git the black-box parity net spawns.</summary>
internal static class CommandHarness
{
    public static string Pipe() => "volt.test." + Guid.NewGuid().ToString("N");

    /// <summary>A started pipe host + a fresh bound git repo + a client on the same pipe. The caller disposes the
    /// host and <see cref="TestUtil.ForceDelete"/>s the root in a finally.</summary>
    public static (string root, BridgePipeHost host, BridgeClient client) Bound(FakeIde ide)
    {
        var pipe = Pipe();
        var host = new BridgePipeHost(ide, pipe);
        host.Start();
        var root = TestUtil.NewRepo();
        Config.SaveConfig(root, new WorkspaceConfig { Bridge = new() { Vendor = "codesys" }, Project = new() { Platform = "codesys", ProjectName = "Demo" }, LinkedAt = "t" });
        return (root, host, new BridgeClient(pipe));
    }

    /// <summary>A FakeIde presenting as a connected CODESYS bridge on project "Demo" (passes the binding checks).
    /// Pass items positionally; set health-name divergence at the call site when a mismatch is under test.</summary>
    public static FakeIde ConnectedIde(params FakeIde.Item[] items) =>
        new FakeIde(items) { HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "Demo" };
}
