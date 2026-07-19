using System.IO;
using Volt.Cli.Sync;
using Xunit;
using static Volt.Cli.Tests.CommandHarness;

namespace Volt.Cli.Tests;

/// <summary>The SPEC for the pull-conflict → resolve → finalize lifecycle (Option A: `volt merge` is the git-native
/// finaliser that also advances Volt's sidecar baseline, so no "pull again" tax and no stale-push trap). Conflict
/// RESOLUTION stays pure git (markers / per-file take-ours/theirs); the one thing git can't do — advance the IDE
/// baseline — is what `volt merge --continue` owns. These assert the intended behaviour.</summary>
public class ConflictLifecycleTests
{
    private static FakeIde.Item Prg(string impl = "x := 1;") =>
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", impl);
    private static string PrgPath(string root) => Path.Combine(root, "src", "PLC_PRG.prg");

    /// <summary>Seed, edit both sides of PLC_PRG differently, pull → a conflicted git merge; returns the IDE's
    /// post-conflict projectVersion (the baseline a finalise should land on).</summary>
    private static string Conflict(string root, FakeIde ide, BridgeClient client)
    {
        Commands.Pull(root, client);
        File.WriteAllText(PrgPath(root), File.ReadAllText(PrgPath(root)).Replace("x := 1;", "x := 2;")); // ours
        ide.MutateImplementation("PLC_PRG", "x := 99;");                                                   // theirs
        Assert.Equal("conflict", Commands.Pull(root, client).Kind);
        return client.GetRefs().ProjectVersion!; // the IDE state the finalise must adopt
    }

    [Fact]
    public void A_conflicted_pull_stashes_pending_refs_without_advancing_the_live_baseline()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            var baselineBefore = Sidecar.LoadIdeRefs(root)!.ProjectVersion;
            Conflict(root, ide, client);

            Assert.True(Git.IsMerging(root));
            // The LIVE baseline is untouched (the merge isn't finished)...
            Assert.Equal(baselineBefore, Sidecar.LoadIdeRefs(root)!.ProjectVersion);
            // ...but the pending IDE refs are stashed, ready for `volt merge --continue` to adopt.
            Assert.NotNull(Sidecar.LoadPendingIdeRefs(root));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Volt_merge_continue_advances_the_baseline_to_the_resolved_IDE_state()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            var resolvedBaseline = Conflict(root, ide, client);
            Commands.Merge(root, resolve: "PLC_PRG.prg", useTheirs: true);
            Assert.Equal(0, Commands.Merge(root, cont: true).Code);

            Assert.False(Git.IsMerging(root));
            Assert.Equal(resolvedBaseline, Sidecar.LoadIdeRefs(root)!.ProjectVersion); // baseline advanced
            Assert.Null(Sidecar.LoadPendingIdeRefs(root));                              // pending cleared
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void After_volt_merge_continue_status_is_in_sync_no_pull_again_needed()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Conflict(root, ide, client);
            Commands.Merge(root, resolve: "PLC_PRG.prg", useTheirs: true); // take the IDE side
            Commands.Merge(root, cont: true);

            var s = Commands.Status(root, client);
            Assert.Equal(0, s.Incoming.Count);
            Assert.Equal(0, s.Outgoing.Count);
            Assert.Equal("in sync with the IDE", s.Summary);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Pushing_after_volt_merge_continue_is_accepted_not_stale_rejected()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Conflict(root, ide, client);
            Commands.Merge(root, resolve: "PLC_PRG.prg", useTheirs: true);
            Commands.Merge(root, cont: true);

            // A follow-up local edit pushes cleanly — the baseline is correct, so no phantom "IDE changed".
            File.WriteAllText(PrgPath(root), File.ReadAllText(PrgPath(root)).Replace("x := 99;", "x := 123;"));
            var push = Commands.Push(root, client);
            Assert.True(push.Kind == "ok", $"push rejected: {push.Reason}");
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Volt_merge_abort_discards_the_pending_refs_and_leaves_the_baseline_untouched()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            var baselineBefore = Sidecar.LoadIdeRefs(root)!.ProjectVersion;
            Conflict(root, ide, client);

            Assert.Equal(0, Commands.Merge(root, abort: true).Code);
            Assert.False(Git.IsMerging(root));
            Assert.Equal(baselineBefore, Sidecar.LoadIdeRefs(root)!.ProjectVersion); // baseline unchanged
            Assert.Null(Sidecar.LoadPendingIdeRefs(root));                            // pending discarded
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Volt_merge_continue_auto_stages_editor_resolved_files_like_pull_and_push()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Conflict(root, ide, client);
            // Resolve by EDITING the file (markers removed) — NO `volt merge --resolve`, NO manual `git add`.
            // `--continue` must auto-stage src (mirroring pull/push auto-commit) and finalise.
            File.WriteAllText(PrgPath(root), "PROGRAM PLC_PRG\nVAR\nEND_VAR\nx := 99;\n");
            Assert.Equal(0, Commands.Merge(root, cont: true).Code);
            Assert.False(Git.IsMerging(root));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Volt_merge_continue_refuses_while_conflict_markers_remain()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Conflict(root, ide, client); // leaves markers in PLC_PRG, unresolved
            var (code, msg) = Commands.Merge(root, cont: true);
            Assert.Equal(2, code);
            Assert.Contains("unresolved", msg.ToLowerInvariant()); // scanned, not just git's unmerged-path check
            Assert.True(Git.IsMerging(root)); // still mid-merge — nothing committed
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Volt_merge_continue_refuses_a_marker_less_modify_delete_conflict_instead_of_auto_resolving()
    {
        // The engineer MODIFIES FB_Motor in the IDE while the user DELETES it locally → a modify/delete conflict,
        // which carries NO `<<<<<<<` markers. It must NOT be silently committed by the auto-stage; it needs an
        // explicit `volt merge --resolve`. Guards against `git add -A` picking a side unasked.
        var ide = ConnectedIde(Prg(), FakeIde.Item.TextualPou("FB_Motor", "FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR", "y := 1;", "POUs"));
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            File.Delete(Path.Combine(root, "src", "POUs", "FB_Motor.fb")); // ours: delete
            ide.MutateImplementation("FB_Motor", "y := 99;");              // theirs: modify
            Assert.Equal("conflict", Commands.Pull(root, client).Kind);

            var (code, msg) = Commands.Merge(root, cont: true); // no marker to scan, but still unresolved
            Assert.Equal(2, code);
            Assert.Contains("unresolved", msg.ToLowerInvariant());
            Assert.True(Git.IsMerging(root)); // NOT auto-committed

            // Explicit resolution then finalises.
            Commands.Merge(root, resolve: "POUs/FB_Motor.fb", useTheirs: true);
            Assert.Equal(0, Commands.Merge(root, cont: true).Code);
            Assert.False(Git.IsMerging(root));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Volt_merge_continue_and_abort_are_graceful_with_no_merge_in_progress()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client); // clean, no conflict
            var (contCode, contMsg) = Commands.Merge(root, cont: true);
            Assert.Equal(1, contCode);
            Assert.Contains("no merge in progress", contMsg);
            Assert.Equal(0, Commands.Merge(root, abort: true).Code); // abort is a no-op, not a throw
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Per_file_resolution_mixes_take_theirs_and_take_ours_then_finalises()
    {
        var ide = ConnectedIde(Prg(), FakeIde.Item.TextualPou("FB_Motor", "FUNCTION_BLOCK FB_Motor\nVAR\nEND_VAR", "y := 1;", "POUs"));
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            var prg = PrgPath(root);
            var fb = Path.Combine(root, "src", "POUs", "FB_Motor.fb");
            File.WriteAllText(prg, File.ReadAllText(prg).Replace("x := 1;", "x := 2;"));   // ours (prg)
            File.WriteAllText(fb, File.ReadAllText(fb).Replace("y := 1;", "y := 2;"));      // ours (fb)
            ide.MutateImplementation("PLC_PRG", "x := 99;");                                // theirs (prg)
            ide.MutateImplementation("FB_Motor", "y := 99;");                               // theirs (fb)
            Assert.Equal("conflict", Commands.Pull(root, client).Kind);

            // Resolve ONE BY ONE: keep the IDE's PLC_PRG, keep MY FB_Motor.
            Commands.Merge(root, resolve: "PLC_PRG.prg", useTheirs: true);
            Commands.Merge(root, resolve: "POUs/FB_Motor.fb", useOurs: true);
            Assert.Equal(0, Commands.Merge(root, cont: true).Code);

            Assert.False(Git.IsMerging(root));
            Assert.Contains("x := 99;", File.ReadAllText(prg)); // theirs won for PLC_PRG
            Assert.Contains("y := 2;", File.ReadAllText(fb));   // ours won for FB_Motor
            Assert.Null(Sidecar.LoadPendingIdeRefs(root));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }
}
