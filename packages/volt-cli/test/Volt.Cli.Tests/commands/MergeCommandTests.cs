using System.IO;
using Volt.Cli.Sync;
using Xunit;
using static Volt.Cli.Tests.CommandHarness;

namespace Volt.Cli.Tests;

/// <summary>`volt merge` at the CLI layer — the conflicted-pull finishers (--abort / --resolve / --continue) and
/// the usage guard. Previously untested at every layer.</summary>
public class MergeCommandTests
{
    private static FakeIde.Item Prg(string impl = "x := 1;") =>
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", impl);

    private static string PrgPath(string root) => Path.Combine(root, "src", "PLC_PRG.prg");

    /// <summary>Seed, edit both sides of PLC_PRG, and pull → leaves a conflicted merge in progress.</summary>
    private static void ConflictedPull(string root, FakeIde ide, BridgeClient client)
    {
        Commands.Pull(root, client);
        File.WriteAllText(PrgPath(root), File.ReadAllText(PrgPath(root)).Replace("x := 1;", "x := 2;"));
        ide.MutateImplementation("PLC_PRG", "x := 99;");
        Assert.Equal("conflict", Commands.Pull(root, client).Kind);
    }

    [Fact]
    public void Merge_with_no_flags_prints_usage()
    {
        var root = TestUtil.NewRepo();
        try
        {
            var (code, msg) = Commands.Merge(root);
            Assert.Equal(1, code);
            Assert.Contains("--continue", msg);
        }
        finally { TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Merge_abort_restores_the_workspace()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            ConflictedPull(root, ide, client);
            var (code, msg) = Commands.Merge(root, abort: true);
            Assert.Equal(0, code);
            Assert.Contains("merge aborted", msg);
            Assert.False(Git.IsMerging(root));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Merge_resolve_use_theirs_then_continue_completes()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            ConflictedPull(root, ide, client);

            var (rcode, rmsg) = Commands.Merge(root, resolve: "PLC_PRG.prg", useTheirs: true);
            Assert.Equal(0, rcode);
            Assert.Contains("using theirs", rmsg);

            var (ccode, cmsg) = Commands.Merge(root, cont: true);
            Assert.Equal(0, ccode);
            Assert.Contains("merge completed", cmsg);
            Assert.False(Git.IsMerging(root));
            Assert.Contains("x := 99;", File.ReadAllText(PrgPath(root))); // theirs won
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Merge_resolve_use_ours_keeps_our_edit()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            ConflictedPull(root, ide, client);
            var (code, msg) = Commands.Merge(root, resolve: "PLC_PRG.prg", useOurs: true);
            Assert.Equal(0, code);
            Assert.Contains("using ours", msg);

            Commands.Merge(root, cont: true);
            Assert.Contains("x := 2;", File.ReadAllText(PrgPath(root))); // ours won
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Merge_continue_with_unresolved_files_is_refused()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            ConflictedPull(root, ide, client);
            var (code, msg) = Commands.Merge(root, cont: true); // nothing resolved yet
            Assert.Equal(2, code);
            Assert.Contains("unresolved", msg);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }
}
