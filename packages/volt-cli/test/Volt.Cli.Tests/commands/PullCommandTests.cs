using System.IO;
using Volt.Cli.Sync;
using Xunit;
using static Volt.Cli.Tests.CommandHarness;

namespace Volt.Cli.Tests;

/// <summary>`volt pull` at the CLI layer — seed, incremental, conflict, dry-run, and the refusals.</summary>
public class PullCommandTests
{
    private static FakeIde.Item Prg(string impl = "x := 1;") =>
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", impl);

    private static string PrgPath(string root) => Path.Combine(root, "src", "PLC_PRG.prg");

    [Fact]
    public void Pull_seeds_the_workspace_then_reports_in_sync_and_is_idempotent()
    {
        var ide = ConnectedIde(Prg(),
            FakeIde.Item.TextualPou("FB_Motor", "FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR", "y := 2;", "POUs"));
        var (root, host, client) = Bound(ide);
        try
        {
            var r = Commands.Pull(root, client);
            Assert.Equal("ok", r.Kind);
            Assert.Contains("PLC_PRG.prg", r.Synced!);
            Assert.Contains("FB_Motor.fb", r.Synced!);

            Assert.True(File.Exists(PrgPath(root)));
            Assert.True(File.Exists(Path.Combine(root, "src", "POUs", "FB_Motor.fb")));
            Assert.Contains("PROGRAM PLC_PRG", File.ReadAllText(PrgPath(root)));

            var s = Commands.Status(root, client);
            Assert.Equal(0, s.Incoming.Count);
            Assert.Equal(0, s.Outgoing.Count);
            Assert.Equal("in sync with the IDE", s.Summary);

            var r2 = Commands.Pull(root, client);
            Assert.Equal("ok", r2.Kind);
            Assert.Empty(r2.Synced!);
            Assert.Equal("already up to date with the IDE", r2.Message);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Pull_brings_in_an_IDE_side_edit()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            ide.MutateImplementation("PLC_PRG", "x := 99;"); // the engineer edits it in the IDE

            var r = Commands.Pull(root, client);
            Assert.Equal("ok", r.Kind);
            Assert.Contains("PLC_PRG.prg", r.Synced!);
            Assert.Contains("x := 99;", File.ReadAllText(PrgPath(root)));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Pull_reports_a_conflict_when_both_sides_edited_the_same_item()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client); // base: x := 1
            File.WriteAllText(PrgPath(root), File.ReadAllText(PrgPath(root)).Replace("x := 1;", "x := 2;")); // ours
            ide.MutateImplementation("PLC_PRG", "x := 99;"); // theirs

            var r = Commands.Pull(root, client);
            Assert.Equal("conflict", r.Kind);
            Assert.Contains("PLC_PRG.prg", r.Paths!);
            Assert.True(Git.IsMerging(root)); // left mid-merge for the user to resolve
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Pull_refuses_while_a_merge_is_already_in_progress()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            File.WriteAllText(PrgPath(root), File.ReadAllText(PrgPath(root)).Replace("x := 1;", "x := 2;"));
            ide.MutateImplementation("PLC_PRG", "x := 99;");
            Commands.Pull(root, client); // → conflict, leaves a merge in progress

            var r = Commands.Pull(root, client);
            Assert.Equal("refused", r.Kind);
            Assert.Contains("a merge is already in progress", r.Reason);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Pull_dry_run_previews_without_merging()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            ide.MutateImplementation("PLC_PRG", "x := 99;");

            var r = Commands.Pull(root, client, dryRun: true);
            Assert.Equal("ok", r.Kind);
            Assert.Contains("PLC_PRG.prg", r.Synced!);
            Assert.Equal("dry run — these IDE items would be merged in", r.Message);
            Assert.Contains("x := 1;", File.ReadAllText(PrgPath(root))); // workspace untouched
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

    [Fact]
    public void Pull_refuses_outside_a_workspace()
    {
        var root = TestUtil.NewRepo();
        try
        {
            var r = Commands.Pull(root, new BridgeClient(Pipe()));
            Assert.Equal("refused", r.Kind);
            Assert.Contains("not a Volt workspace", r.Reason);
        }
        finally { TestUtil.ForceDelete(root); }
    }
}
