using System;
using System.IO;
using Volt.Engine.Wire;
using Volt.Cli.Sync;
using Volt.Cli.Transport;
using Xunit;
using static Volt.Cli.Tests.CommandHarness;

namespace Volt.Cli.Tests;

/// <summary>`volt init` at the CLI layer — bind + scaffold + seed, and the refusals. Unlike the other command
/// tests these must NOT pre-bind (init binds), so they spin up the host + an UNbound directory themselves.</summary>
public class InitCommandTests
{
    private static FakeIde ConnectedTwoItem() => ConnectedIde(
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"),
        FakeIde.Item.TextualPou("FB_Motor", "FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR", "y := 2;", "POUs"));

    /// <summary>A started host + a client, and a factory for a fresh UNbound directory (plain or git-repo).</summary>
    private static (BridgePipeHost host, BridgeClient client) HostFor(FakeIde ide, out string pipe)
    {
        pipe = Pipe();
        var host = new BridgePipeHost(ide, pipe);
        host.Start();
        return (host, new BridgeClient(pipe));
    }

    [Fact]
    public void Init_binds_scaffolds_and_seeds_a_fresh_directory()
    {
        var (host, client) = HostFor(ConnectedTwoItem(), out _);
        var root = Directory.CreateTempSubdirectory("volt-init-").FullName; // a PLAIN dir → full git-init flow
        try
        {
            var r = Commands.Init(root, client);
            Assert.Equal("ok", r.Kind);
            Assert.True(r.GitCreated);
            Assert.Equal("codesys/Demo", r.Project);
            Assert.True(r.Scaffold >= 5);
            Assert.True(r.Pulled >= 2);

            Assert.True(Config.ConfigExists(root));
            Assert.True(File.Exists(Path.Combine(root, "src", "PLC_PRG.prg")));
            Assert.True(File.Exists(Path.Combine(root, "src", "POUs", "FB_Motor.fb")));
            Assert.True(File.Exists(Path.Combine(root, "rust", "Cargo.toml")));
            Assert.True(File.Exists(Path.Combine(root, ".gitattributes")));

            Assert.Equal("in sync with the IDE", Commands.Status(root, client).Summary);
            Assert.Equal("error", Commands.Init(root, client).Kind); // second init refuses
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Init_reuses_an_existing_git_repo()
    {
        var (host, client) = HostFor(ConnectedTwoItem(), out _);
        var root = TestUtil.NewRepo(); // ALREADY a git repo, but unbound
        try
        {
            var r = Commands.Init(root, client);
            Assert.Equal("ok", r.Kind);
            Assert.False(r.GitCreated); // did not re-init git
            Assert.True(Config.ConfigExists(root));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Init_refuses_when_the_bridge_has_no_project_loaded()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"))
        { HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = null };
        var (host, client) = HostFor(ide, out _);
        var root = Directory.CreateTempSubdirectory("volt-init-").FullName;
        try
        {
            var r = Commands.Init(root, client);
            Assert.Equal("error", r.Kind);
            Assert.Contains("no PLC project loaded", r.Reason);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }
}
