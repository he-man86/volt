using System.IO;
using System.Text;
using Volt.Cli.Sync;
using Xunit;
using static Volt.Cli.Tests.CommandHarness;

namespace Volt.Cli.Tests;

/// <summary>`volt show` at the CLI layer — the ref matrix (WORKSPACE / VOLTIDE / BRIDGE / MERGE_*) and error paths.</summary>
public class ShowCommandTests
{
    private static FakeIde.Item Prg(string impl = "x := 1;") =>
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", impl);

    private static string PrgPath(string root) => Path.Combine(root, "src", "PLC_PRG.prg");
    private static string ShowText(string root, BridgeClient c, string @ref) =>
        Encoding.UTF8.GetString(Commands.Show(root, c, @ref, "PLC_PRG.prg").Bytes!);

    [Fact]
    public void Show_reads_each_ref()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            File.WriteAllText(PrgPath(root), File.ReadAllText(PrgPath(root)).Replace("x := 1;", "x := 9;"));

            Assert.Contains("x := 9;", ShowText(root, client, "WORKSPACE")); // live edited bytes
            Assert.Contains("x := 1;", ShowText(root, client, "VOLTIDE"));   // pre-edit baseline
            Assert.Contains("x := 1;", ShowText(root, client, "BRIDGE"));    // the live IDE
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Show_errors_on_a_missing_workspace_file()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            var (bytes, err) = Commands.Show(root, client, "WORKSPACE", "Nope.prg");
            Assert.Null(bytes);
            Assert.Contains("not in the workspace", err);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Show_errors_on_an_unknown_bridge_item()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            var (bytes, err) = Commands.Show(root, client, "BRIDGE", "Nope.prg");
            Assert.Null(bytes);
            Assert.Contains("bridge has no item", err);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Show_reads_the_three_merge_sides_during_a_conflict()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client); // base: x := 1
            File.WriteAllText(PrgPath(root), File.ReadAllText(PrgPath(root)).Replace("x := 1;", "x := 2;")); // ours
            ide.MutateImplementation("PLC_PRG", "x := 99;"); // theirs
            Commands.Pull(root, client); // → conflict, mid-merge

            Assert.Contains("x := 1;", ShowText(root, client, "MERGE_BASE"));
            Assert.Contains("x := 2;", ShowText(root, client, "MERGE_OURS"));
            Assert.Contains("x := 99;", ShowText(root, client, "MERGE_THEIRS"));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }
}
