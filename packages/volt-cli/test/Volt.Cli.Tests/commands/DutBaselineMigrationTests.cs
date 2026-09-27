using System;
using System.IO;
using System.Linq;
using Volt.Cli.Sync;
using Xunit;
using static Volt.Cli.Tests.CommandHarness;

namespace Volt.Cli.Tests;

/// <summary>
/// A BASELINE KEYED BY THE OLD WIRE NAME IS REFUSED, NEVER TRANSLATED (openspec <c>dut-subtype-on-the-wire</c>,
/// requirement "a baseline keyed by the old wire name is refused").
///
/// <para>The sidecar (<c>.git/volt/ide-refs.json</c>) is keyed by wire name, and a workspace from the previous CLI
/// holds its DUTs as <c>X.dut</c>. The wire no longer publishes that name, so every <c>ifVersion</c> such a
/// baseline quotes names an item that does not exist and every comparison against it is wrong — a DUT would read
/// as deleted-and-added on every status. There is no translator (it would be DUT logic in the CLI, and it would
/// have to re-derive a subtype the old key never held): the refusal names the one fix, <c>volt pull</c>, which
/// rebuilds the baseline from what the wire says now. Workspace FILES are unaffected — they were already
/// <c>X.struct</c> etc.</para>
///
/// <para><b>Two doors</b>, and the second is the easy one to miss: the PENDING baseline a conflicted pull stashes
/// (<c>pending-ide-refs.json</c>) is promoted straight into the live sidecar by <c>volt merge --continue</c>, with
/// no load-time check on that path — so a refusal only at <c>LoadIdeRefs</c> would let a <c>.dut</c> key back in
/// through the merge.</para>
/// </summary>
public class DutBaselineMigrationTests
{
    private const string Enum = "TYPE E_Mode :\n(\n\tIdle := 0,\n\tRun\n);\nEND_TYPE";

    private static FakeIde.Item Prg(string impl = "x := 1;") =>
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", impl);

    private static FakeIde.Item EMode() => FakeIde.Item.TextualPou("E_Mode", Enum, "", "DUTs");

    private static string PrgPath(string root) => Path.Combine(root, "src", "PLC_PRG.prg");

    /// <summary>The baseline as the previous CLI wrote it: E_Mode's entry under <c>E_Mode.dut</c>.</summary>
    private static IdeRefs WithOldDutKey(IdeRefs refs)
    {
        var key = refs.Items.Keys.Single(k => k.StartsWith("E_Mode.", StringComparison.Ordinal));
        var items = refs.Items.Where(kv => kv.Key != key).ToDictionary(kv => kv.Key, kv => kv.Value);
        var folders = refs.Folders.Where(kv => kv.Key != key).ToDictionary(kv => kv.Key, kv => kv.Value);
        items["E_Mode.dut"] = refs.Items[key];
        folders["E_Mode.dut"] = refs.Folders[key];
        return new IdeRefs { ProjectVersion = refs.ProjectVersion, Items = items, Folders = folders };
    }

    [Fact]
    public void A_push_over_a_dut_keyed_baseline_is_refused_by_name_and_sends_nothing()
    {
        var ide = ConnectedIde(Prg(), EMode());
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            Sidecar.SaveIdeRefs(root, WithOldDutKey(Sidecar.LoadIdeRefs(root)!));
            File.WriteAllText(PrgPath(root), File.ReadAllText(PrgPath(root)).Replace("x := 1;", "x := 2;"));

            var ex = Assert.Throws<InvalidOperationException>(() => Commands.Push(root, client));
            Assert.Contains("E_Mode.dut", ex.Message);
            Assert.Contains("volt pull", ex.Message);
            Assert.Empty(ide.Recorded);   // refused before a single op reached the bridge
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>…and `volt pull` IS the fix it names: it rebuilds the baseline from the wire, after which no key
    /// is `.dut` and the same push goes through.</summary>
    [Fact]
    public void A_pull_rebuilds_a_dut_keyed_baseline_and_the_push_then_lands()
    {
        var ide = ConnectedIde(Prg(), EMode());
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            Sidecar.SaveIdeRefs(root, WithOldDutKey(Sidecar.LoadIdeRefs(root)!));

            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var rebuilt = Sidecar.LoadIdeRefs(root)!;
            Assert.DoesNotContain(rebuilt.Items.Keys, k => k.EndsWith(".dut", StringComparison.OrdinalIgnoreCase));
            Assert.Contains("E_Mode.enum", rebuilt.Items.Keys);
            Assert.True(File.Exists(Path.Combine(root, "src", "DUTs", "E_Mode.enum")));

            File.WriteAllText(PrgPath(root), File.ReadAllText(PrgPath(root)).Replace("x := 1;", "x := 2;"));
            var r = Commands.Push(root, client);
            Assert.True(r.Kind == "ok", $"push {r.Kind}: {r.Reason}");
            Assert.Contains(ide.Recorded, x => x.StartsWith("writecontent:PLC_PRG"));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>THE MERGE DOOR. A pending baseline holding a `.dut` key is never promoted: the git merge still
    /// completes (resolving it is git's job and is independent of Volt's baseline), but "IDE baseline synced" is
    /// not claimed, the live sidecar gains no `.dut` key, and the output names `volt pull`.</summary>
    [Fact]
    public void A_dut_keyed_pending_baseline_is_never_promoted_by_merge_continue()
    {
        var ide = ConnectedIde(Prg(), EMode());
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            File.WriteAllText(PrgPath(root), File.ReadAllText(PrgPath(root)).Replace("x := 1;", "x := 2;")); // ours
            ide.MutateImplementation("PLC_PRG", "x := 99;");                                                   // theirs
            Assert.Equal("conflict", Commands.Pull(root, client).Kind);

            Sidecar.SavePendingIdeRefs(root, WithOldDutKey(Sidecar.LoadPendingIdeRefs(root)!));

            Commands.Merge(root, resolve: "PLC_PRG.prg", useTheirs: true);
            var (_, msg) = Commands.Merge(root, cont: true);

            Assert.False(Git.IsMerging(root), "the git merge did not complete");
            Assert.DoesNotContain("IDE baseline synced", msg);
            Assert.Contains("volt pull", msg);
            Assert.DoesNotContain(Sidecar.LoadIdeRefs(root)!.Items.Keys,
                                  k => k.EndsWith(".dut", StringComparison.OrdinalIgnoreCase));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }
}
