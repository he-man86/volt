using System;
using System.IO;
using Volt.Cli.Sync;
using Volt.Wire;
using Xunit;
using static Volt.Cli.Tests.CommandHarness;
using Volt.Contracts;
using Volt.Engine.Wire;

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
    public void Init_creates_a_project_named_folder_and_seeds_it()
    {
        var (host, client) = HostFor(ConnectedTwoItem(), out _);
        var parent = Directory.CreateTempSubdirectory("volt-init-").FullName; // WHERE the workspace is created
        try
        {
            var r = Commands.Init(parent, client);
            Assert.Equal("ok", r.Kind);
            Assert.Equal(Path.Combine(parent, "Demo"), r.Workspace); // git-clone semantics: <parent>/<project name>/
            var ws = r.Workspace!;
            Assert.True(r.GitCreated);
            Assert.Equal("codesys/Demo", r.Project);
            Assert.True(r.Scaffold >= 2); // README.md + .vscode/settings.json
            Assert.True(r.Pulled >= 2);

            Assert.True(Config.ConfigExists(ws));
            Assert.True(File.Exists(Path.Combine(ws, "src", "PLC_PRG.prg")));
            Assert.True(File.Exists(Path.Combine(ws, "src", "POUs", "FB_Motor.fb")));
            Assert.True(File.Exists(Path.Combine(ws, "README.md")));
            Assert.True(File.Exists(Path.Combine(ws, ".gitattributes")));

            Assert.Equal("in sync with the IDE", Commands.Status(ws, client).Summary);
            Assert.Equal("error", Commands.Init(parent, client).Kind); // second init refuses — Demo/ exists, non-empty
        }
        finally { host.Dispose(); TestUtil.ForceDelete(parent); }
    }

    [Fact]
    public void Rebind_repoints_the_binding_without_touching_content()
    {
        var (host, client) = HostFor(ConnectedTwoItem(), out _);
        var parent = Directory.CreateTempSubdirectory("volt-init-").FullName;
        try
        {
            var ws = Commands.Init(parent, client).Workspace!; // a real bound workspace on "Demo"
            var prg = Path.Combine(ws, "src", "PLC_PRG.prg");
            var before = File.ReadAllText(prg);

            var err = Commands.Rebind(ws, "codesys", "Renamed"); // re-point to a different name
            Assert.Null(err);
            Assert.Equal("codesys/Renamed", $"{Config.LoadConfig(ws).Project.Platform}/{Config.LoadConfig(ws).Project.ProjectName}");
            Assert.Equal(before, File.ReadAllText(prg)); // src/ untouched — no re-seed
        }
        finally { host.Dispose(); TestUtil.ForceDelete(parent); }
    }

    [Fact]
    public void Rebind_refuses_a_non_workspace()
    {
        var dir = Directory.CreateTempSubdirectory("volt-rebind-").FullName; // not a Volt workspace
        try { Assert.NotNull(Commands.Rebind(dir, "codesys", "X")); }
        finally { TestUtil.ForceDelete(dir); }
    }

    /// <summary>The whole workspace identity — the folder name AND the written binding — comes from the identity the
    /// init FETCH echoed (the live served project, checked atomically by the in-op guard), never from the health
    /// snapshot, which TwinCAT serves from a ~5s throttled cache. With the two disagreeing, init used to name the
    /// folder and write the binding from the CACHE while the files it seeded were the other project's — so init
    /// exited 0 and every later op refused WRONG_PROJECT for the life of the workspace.</summary>
    [Fact]
    public void Init_binds_the_project_the_fetch_walked_not_the_one_the_cache_named()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"))
        {
            HealthConnected = true,
            HealthPlatform = "codesys",
            HealthProjectName = "Line2",          // the LIVE served project — what the fetch walks and echoes
            HealthSnapshotProjectName = "Line1",  // the STALE cached row init used to bind from
        };
        var (host, client) = HostFor(ide, out _);
        var parent = Directory.CreateTempSubdirectory("volt-init-").FullName;
        try
        {
            var r = Commands.Init(parent, client);
            Assert.Equal("ok", r.Kind);
            Assert.Equal(Path.Combine(parent, "Line2"), r.Workspace);
            Assert.False(Directory.Exists(Path.Combine(parent, "Line1"))); // the stale name names nothing on disk
            Assert.Equal("codesys/Line2", r.Project);
            var cfg = Config.LoadConfig(r.Workspace!);
            Assert.Equal("Line2", cfg.Project.ProjectName);
            Assert.Equal("codesys", cfg.Project.Platform);
            Assert.Equal("codesys", cfg.Bridge.Vendor);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(parent); }
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
