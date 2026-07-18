using System;
using System.IO;
using System.Linq;
using Volt.Cli.Core.Wire;
using Volt.Cli.Sync;
using Volt.Cli.Transport;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>The verbs end-to-end: a real repo + a live pipe host (connected FakeIde) driven through the ported
/// commands. This is the white-box precursor to the black-box parity net — same real bridge, real git.</summary>
public class CommandTests
{
    private static string Pipe() => "volt.test." + Guid.NewGuid().ToString("N");

    private static (string root, BridgePipeHost host, BridgeClient client) Bound(FakeIde ide)
    {
        var pipe = Pipe();
        var host = new BridgePipeHost(ide, pipe);
        host.Start();
        var root = TestUtil.NewRepo();
        Config.SaveConfig(root, new WorkspaceConfig { Bridge = new() { Port = 8556 }, Project = new() { Platform = "codesys", ProjectName = "Demo" }, LinkedAt = "t" });
        return (root, host, new BridgeClient(pipe));
    }

    [Fact]
    public void Pull_seeds_the_workspace_then_reports_in_sync_and_is_idempotent()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"),
            FakeIde.Item.TextualPou("FB_Motor", "FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR", "y := 2;", "POUs"))
        { HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "Demo" };
        var (root, host, client) = Bound(ide);
        try
        {
            // First pull = init-like seed: everything is incoming.
            var r = Commands.Pull(root, client);
            Assert.Equal("ok", r.Kind);
            Assert.Contains("PLC_PRG.prg", r.Synced!);
            Assert.Contains("FB_Motor.fb", r.Synced!);

            // The src/ tree now mirrors the IDE, at the right paths.
            Assert.True(File.Exists(Path.Combine(root, "src", "PLC_PRG.prg")));
            Assert.True(File.Exists(Path.Combine(root, "src", "POUs", "FB_Motor.fb")));
            Assert.Contains("PROGRAM PLC_PRG", File.ReadAllText(Path.Combine(root, "src", "PLC_PRG.prg")));

            // Status after pull = in sync (no drift).
            var s = Commands.Status(root, client);
            Assert.Equal(0, s.Incoming.Count);
            Assert.Equal(0, s.Outgoing.Count);
            Assert.Equal("in sync with the IDE", s.Summary);

            // Idempotent: a second pull is up-to-date, nothing synced.
            var r2 = Commands.Pull(root, client);
            Assert.Equal("ok", r2.Kind);
            Assert.Empty(r2.Synced!);
            Assert.Equal("already up to date with the IDE", r2.Message);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Init_binds_scaffolds_and_seeds_a_fresh_directory()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"),
            FakeIde.Item.TextualPou("FB_Motor", "FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR", "y := 2;", "POUs"))
        { HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "Demo" };
        var pipe = Pipe();
        var host = new BridgePipeHost(ide, pipe);
        host.Start();
        // a PLAIN directory — not a git repo yet, so init does the full git-init + commit + seed flow.
        var root = Directory.CreateTempSubdirectory("volt-init-").FullName;
        var client = new BridgeClient(pipe);
        try
        {
            var r = Commands.Init(root, client, 8556);
            Assert.Equal("ok", r.Kind);
            Assert.True(r.GitCreated);
            Assert.Equal("codesys/Demo", r.Project);
            Assert.True(r.Scaffold >= 5);          // Cargo project + README + vscode settings
            Assert.True(r.Pulled >= 2);            // the two IDE items

            // Bound + seeded + scaffolded.
            Assert.True(Config.ConfigExists(root));
            Assert.True(File.Exists(Path.Combine(root, "src", "PLC_PRG.prg")));
            Assert.True(File.Exists(Path.Combine(root, "src", "POUs", "FB_Motor.fb")));
            Assert.True(File.Exists(Path.Combine(root, "rust", "Cargo.toml")));
            Assert.True(File.Exists(Path.Combine(root, ".gitattributes")));

            // Post-init the workspace is in sync, and a second init refuses.
            Assert.Equal("in sync with the IDE", Commands.Status(root, client).Summary);
            Assert.Equal("error", Commands.Init(root, client, 8556).Kind);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Status_shows_a_local_edit_as_outgoing()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"))
        { HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "Demo" };
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client); // seed
            File.WriteAllText(Path.Combine(root, "src", "PLC_PRG.prg"), "PROGRAM PLC_PRG\n(* edited locally *)\n");

            var s = Commands.Status(root, client);
            Assert.Contains("PLC_PRG.prg", s.Outgoing.Modified);
            Assert.Equal("volt push", s.Recommend);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_sends_a_local_edit_and_leaves_the_workspace_in_sync()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"))
        { HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "Demo" };
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client); // seed the baseline
            // A VALID ST edit — the bridge parses on apply, so the change must round-trip as real ST.
            var path = Path.Combine(root, "src", "PLC_PRG.prg");
            File.WriteAllText(path, File.ReadAllText(path).Replace("x := 1;", "x := 2;"));

            var r = Commands.Push(root, client);
            Assert.True(r.Kind == "ok", $"push rejected: {r.Reason}");
            Assert.Contains("PLC_PRG.prg", r.Items!);
            Assert.Contains(ide.Recorded, x => x.StartsWith("write:PLC_PRG")); // the bridge applied the write

            // After push, volt/ide == HEAD == the edit → no outgoing drift.
            var s = Commands.Status(root, client);
            Assert.Equal(0, s.Outgoing.Count);

            // Nothing left to push.
            Assert.Equal("nothing to push — the IDE already matches your workspace", Commands.Push(root, client).Message);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Build_diff_and_show_after_a_local_edit()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"))
        { HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "Demo" };
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            var path = Path.Combine(root, "src", "PLC_PRG.prg");
            File.WriteAllText(path, File.ReadAllText(path).Replace("x := 1;", "x := 9;"));

            // build → succeeds via the IDE (FakeIde.Build == true), no diagnostics.
            var b = Commands.Build(root, client, full: false);
            Assert.True(b.Success);
            Assert.Empty(b.Diagnostics);
            Assert.True(Commands.UnpushedCount(root) >= 1); // the edit is unpushed

            // diff → one outgoing modified file.
            var (ok, diffs, _) = Commands.Diff(root);
            Assert.True(ok);
            Assert.Contains(diffs, d => d.File == "src/PLC_PRG.prg" && d.Status == "modified");

            // show WORKSPACE → the live edited bytes; show VOLTIDE → the pre-edit baseline; show BRIDGE → the IDE.
            Assert.Contains("x := 9;", System.Text.Encoding.UTF8.GetString(Commands.Show(root, client, "WORKSPACE", "PLC_PRG.prg").Bytes!));
            Assert.Contains("x := 1;", System.Text.Encoding.UTF8.GetString(Commands.Show(root, client, "VOLTIDE", "PLC_PRG.prg").Bytes!));
            Assert.Contains("x := 1;", System.Text.Encoding.UTF8.GetString(Commands.Show(root, client, "BRIDGE", "PLC_PRG.prg").Bytes!));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Pull_refuses_a_project_mismatch()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"))
        { HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "SomethingElse" };
        var (root, host, client) = Bound(ide); // bound to "Demo"
        try
        {
            var r = Commands.Pull(root, client);
            Assert.Equal("refused", r.Kind);
            Assert.Contains("SomethingElse", r.Reason);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }
}
