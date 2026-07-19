using System.IO;
using System.Linq;
using Volt.Cli.Sync;
using Xunit;
using static Volt.Cli.Tests.CommandHarness;

namespace Volt.Cli.Tests;

/// <summary>`volt push` at the CLI layer — every situation a user can hit, asserting the Kind + the exact
/// user-facing Message/Reason. The transport layer (PushServiceTests / push.test.ts) proves the conflict
/// MECHANISM; this file proves what the CLI reports when it fires.</summary>
public class PushCommandTests
{
    private static FakeIde.Item Prg(string impl = "x := 1;") =>
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", impl);

    private static void EditPrg(string root, string from, string to)
    {
        var path = Path.Combine(root, "src", "PLC_PRG.prg");
        File.WriteAllText(path, File.ReadAllText(path).Replace(from, to));
    }

    [Fact]
    public void Push_sends_a_local_edit_then_reports_nothing_to_push()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client); // seed the baseline
            EditPrg(root, "x := 1;", "x := 2;"); // a VALID ST edit — the bridge parses on apply

            var r = Commands.Push(root, client);
            Assert.True(r.Kind == "ok", $"push rejected: {r.Reason}");
            Assert.Contains("PLC_PRG.prg", r.Items!);
            Assert.Contains(ide.Recorded, x => x.StartsWith("write:PLC_PRG"));

            Assert.Equal(0, Commands.Status(root, client).Outgoing.Count);
            // Nothing left to push — the ok/empty path with its own message (what volt-control now surfaces).
            Assert.Equal("nothing to push — the IDE already matches your workspace", Commands.Push(root, client).Message);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_is_rejected_when_the_IDE_changed_since_the_last_sync()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client); // baseline @ projectVersion V1
            ide.MutateImplementation("PLC_PRG", "x := 99;"); // the engineer edits it in the IDE → V2
            EditPrg(root, "x := 1;", "x := 2;"); // our own conflicting local edit

            var r = Commands.Push(root, client);
            Assert.Equal("rejected", r.Kind);
            Assert.Equal("the IDE changed since your last sync — run `volt pull` first (or push --force)", r.Reason);
            Assert.DoesNotContain(ide.Recorded, x => x.StartsWith("write:")); // nothing applied
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_force_overrides_a_diverged_IDE()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            ide.MutateImplementation("PLC_PRG", "x := 99;"); // IDE moved on
            EditPrg(root, "x := 1;", "x := 2;");

            var r = Commands.Push(root, client, force: true);
            Assert.True(r.Kind == "ok", $"forced push rejected: {r.Reason}");
            Assert.Contains(ide.Recorded, x => x.StartsWith("write:PLC_PRG")); // applied despite divergence
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_force_with_lease_that_is_stale_is_rejected_with_the_current_version()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            EditPrg(root, "x := 1;", "x := 2;"); // an op to push, so we reach the bridge

            var r = Commands.Push(root, client, forceWithLease: "bogus-version");
            Assert.Equal("rejected", r.Kind);
            Assert.StartsWith("--force-with-lease is stale:", r.Reason);
            Assert.Contains("not bogus-version", r.Reason);
            Assert.DoesNotContain(ide.Recorded, x => x.StartsWith("write:"));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_force_with_lease_that_matches_the_current_version_applies()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            ide.MutateImplementation("PLC_PRG", "x := 99;"); // IDE moved on → a NEW current projectVersion
            var current = client.GetRefs().ProjectVersion; // the lease the engineer would read after `volt status`
            EditPrg(root, "x := 1;", "x := 2;");

            var r = Commands.Push(root, client, forceWithLease: current);
            Assert.True(r.Kind == "ok", $"lease-matched push rejected: {r.Reason}");
            Assert.Contains(ide.Recorded, x => x.StartsWith("write:PLC_PRG"));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_dry_run_previews_without_touching_the_IDE()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            EditPrg(root, "x := 1;", "x := 2;");

            var r = Commands.Push(root, client, dryRun: true);
            Assert.Equal("ok", r.Kind);
            Assert.Equal("dry run — would push these item(s)", r.Message);
            Assert.Contains("PLC_PRG.prg", r.Items!);
            Assert.Empty(ide.Recorded); // the bridge was never called
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_rejects_an_unrecognized_file_extension()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            File.WriteAllText(Path.Combine(root, "src", "notes.txt"), "not a PLC item");

            var r = Commands.Push(root, client);
            Assert.Equal("rejected", r.Kind);
            Assert.Contains("unrecognized file extension", r.Reason);
            Assert.Contains("notes.txt", r.Reason);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_rejects_editing_a_read_only_item()
    {
        var ide = ConnectedIde(Prg(),
            FakeIde.Item.Library("Standard", "LIBRARY Standard\nNAMESPACE Standard\n"));
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            var lib = Directory.EnumerateFiles(Path.Combine(root, "src"), "*.library", SearchOption.AllDirectories).Single();
            File.AppendAllText(lib, "\n(* tampered *)\n");

            var r = Commands.Push(root, client);
            Assert.Equal("rejected", r.Kind);
            Assert.Contains("read-only items can't be pushed", r.Reason);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_applies_a_delete()
    {
        var ide = ConnectedIde(Prg(),
            FakeIde.Item.TextualPou("FB_Motor", "FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR", "y := 2;", "POUs"));
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            File.Delete(Path.Combine(root, "src", "POUs", "FB_Motor.fb"));

            var r = Commands.Push(root, client);
            Assert.True(r.Kind == "ok", $"push rejected: {r.Reason}");
            Assert.Contains(ide.Recorded, x => x.StartsWith("delete:FB_Motor"));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_applies_a_rename()
    {
        var ide = ConnectedIde(Prg(),
            FakeIde.Item.TextualPou("FB_Motor", "FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR", "y := 2;", "POUs"));
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            var dir = Path.Combine(root, "src", "POUs");
            File.Move(Path.Combine(dir, "FB_Motor.fb"), Path.Combine(dir, "FB_Drive.fb"));

            var r = Commands.Push(root, client);
            Assert.True(r.Kind == "ok", $"push rejected: {r.Reason}");
            Assert.Contains(ide.Recorded, x => x.StartsWith("rename:FB_Motor"));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_refuses_before_the_first_pull()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            // bound but never pulled → no IDE baseline exists yet
            var r = Commands.Push(root, client);
            Assert.Equal("rejected", r.Kind);
            Assert.Contains("no IDE baseline yet", r.Reason);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Push_refuses_outside_a_workspace()
    {
        var root = TestUtil.NewRepo(); // a git repo, but never `volt init`-bound (no .git/volt/config.json)
        try
        {
            // ConfigExists fails first, so the bridge is never contacted — a client on a dead pipe is fine.
            var r = Commands.Push(root, new BridgeClient(Pipe()));
            Assert.Equal("rejected", r.Kind);
            Assert.Contains("not a Volt workspace", r.Reason);
        }
        finally { TestUtil.ForceDelete(root); }
    }
}
