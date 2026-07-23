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

    /// <summary>THE bug this was added for. Both frontends have shown a "Force Pull" button with a "this cannot be
    /// undone, your local edits are discarded" confirm since long before the CLI could do it: volt-control passed
    /// `--force`, `Commands.Pull` had no such parameter, and the unknown flag was silently ignored — so the user
    /// clicked through a destructive warning and got a plain pull that changed nothing.
    /// <para>The IDE is deliberately UNCHANGED here, because that is the state a user is actually in when they
    /// reach for it: they edited locally, want it thrown away, and there is nothing incoming. The non-force path
    /// short-circuits on "already up to date" — force must not.</para></summary>
    [Fact]
    public void Force_pull_discards_local_edits_even_when_the_IDE_has_not_changed()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);                        // base: x := 1
            var pristine = File.ReadAllText(PrgPath(root));
            File.WriteAllText(PrgPath(root), pristine.Replace("x := 1;", "x := 999;"));
            var stray = Path.Combine(root, "src", "Scratch.prg"); // an untracked file is local work too
            File.WriteAllText(stray, "PROGRAM Scratch\nEND_PROGRAM");

            var plain = Commands.Pull(root, client);            // a NORMAL pull preserves local work...
            Assert.Equal("ok", plain.Kind);
            Assert.Contains("x := 999;", File.ReadAllText(PrgPath(root)));

            var forced = Commands.Pull(root, client, force: true);

            Assert.Equal("ok", forced.Kind);
            Assert.Equal(pristine, File.ReadAllText(PrgPath(root))); // ...force takes the IDE's state
            Assert.False(File.Exists(stray));                        // including dropping untracked files
            Assert.Contains("discarded", forced.Message);            // and SAYS so — a silent force is the bug
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>Force pull must not destroy anything outside src/ — the README, .vscode, and whatever else the
    /// engineer keeps beside the code are not Volt's to discard.</summary>
    [Fact]
    public void Force_pull_leaves_everything_outside_src_alone()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            var notes = Path.Combine(root, "NOTES.md");
            File.WriteAllText(notes, "my working notes");
            File.WriteAllText(PrgPath(root), "corrupted");

            Commands.Pull(root, client, force: true);

            Assert.True(File.Exists(notes));
            Assert.Equal("my working notes", File.ReadAllText(notes));
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
