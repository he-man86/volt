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
/// have to re-derive a subtype the old key never held): the refusal is the malformed sidecar's — it names the
/// key, the file to delete (<c>.git/volt/ide-refs.json</c>) and <c>volt pull</c>, which then rebuilds the baseline
/// from what the wire says now. <c>volt pull</c> ALONE is refused too: it loads the same baseline before it can
/// rebuild one. Workspace FILES are unaffected — they were already <c>X.struct</c> etc.</para>
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
            Assert.Contains("ide-refs.json", ex.Message);
            Assert.Contains("volt pull", ex.Message);
            Assert.Empty(ide.Recorded);   // refused before a single op reached the bridge
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>`volt pull` READS THE SAME BASELINE, so it is refused the same way — a pull cannot "rebuild" a
    /// baseline it first has to load, and quietly skipping the refusal on pull would be a second, hidden
    /// migration path. The refusal is the malformed sidecar's: it names the file to delete and `volt pull`. Nothing
    /// is fetched or written: `volt/ide` does not move.</summary>
    [Fact]
    public void A_pull_over_a_dut_keyed_baseline_is_refused_naming_the_file_and_the_fix()
    {
        var ide = ConnectedIde(Prg(), EMode());
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            Sidecar.SaveIdeRefs(root, WithOldDutKey(Sidecar.LoadIdeRefs(root)!));
            var ideHead = IdeTree.VoltIdeHead(Git.ResolveGitDir(root));
            var walks = ide.WalkCalls;

            var ex = Assert.Throws<InvalidOperationException>(() => Commands.Pull(root, client));
            Assert.Contains("E_Mode.dut", ex.Message);
            Assert.Contains("ide-refs.json", ex.Message);
            Assert.Contains("volt pull", ex.Message);
            Assert.Equal(ideHead, IdeTree.VoltIdeHead(Git.ResolveGitDir(root)));
            // "Before sending anything": the IDE was never walked. `volt/ide` unmoved alone would also hold for a
            // pull that fetched first and refused afterwards.
            Assert.Equal(walks, ide.WalkCalls);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>…and the fix it names WORKS: with the old baseline deleted, `volt pull` rebuilds one from the wire,
    /// after which no key is `.dut` and the same push goes through.</summary>
    [Fact]
    public void Deleting_the_refused_baseline_and_pulling_rebuilds_it_and_the_push_then_lands()
    {
        var ide = ConnectedIde(Prg(), EMode());
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            Sidecar.SaveIdeRefs(root, WithOldDutKey(Sidecar.LoadIdeRefs(root)!));

            File.Delete(Config.Paths(root).IdeRefsPath);
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

    /// <summary>A PULL WITH NO BASELINE STILL RETIRES WHAT THE IDE NO LONGER HOLDS. The rebuild above is the
    /// dangerous moment for a workspace from the previous CLI: the IDE may have deleted an item since the last
    /// pull, and with no baseline there is nothing to report it REMOVED against — the fetch returns everything as
    /// changed and an empty `removed`, so the old file was carried forward from the previous `volt/ide` tree. The
    /// new baseline then lacks the item while the workspace keeps its file, `volt status` reads in sync, and the
    /// next edit of that file pushes as a CREATE — resurrecting what the engineer deleted in the IDE. Not a DUT
    /// fact: any baseline-less pull (a malformed sidecar deleted as told) did it to any item, hence both rows.
    /// A complete walk is the whole IDE, so a file whose name it does not list is gone.</summary>
    [Theory]
    [InlineData("E_Mode", "DUTs/E_Mode.enum")]
    [InlineData("FB_Old", "FB_Old.fb")]
    public void A_baseline_less_pull_removes_an_item_the_ide_deleted_since_the_last_pull(string bare, string file)
    {
        var ide = ConnectedIde(Prg(), EMode(), FakeIde.Item.TextualPou("FB_Old", "FUNCTION_BLOCK FB_Old\nVAR\nEND_VAR", ""));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            Assert.True(File.Exists(Path.Combine(root, "src", file)), "fixture: the first pull wrote the file");

            ide.RemoveItem(bare);
            File.Delete(Config.Paths(root).IdeRefsPath);
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            Assert.False(File.Exists(Path.Combine(root, "src", file)), $"{file} survived a pull after the IDE deleted {bare}");
            Assert.DoesNotContain(Sidecar.LoadIdeRefs(root)!.Items.Keys, k => k.StartsWith(bare + ".", StringComparison.Ordinal));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>…BUT ABSENCE IS EVIDENCE ONLY OF WHAT THE WALK COULD SEE. The same baseline-less pull must keep the
    /// file of an item the walk found and could not READ (it is named in `unreadable`: present, just not in this
    /// response), and of every item under a folder the walk could not enumerate (`unwalkedFolders`: nothing under
    /// it was seen at all). Either lost would delete the engineer's file for an item still sitting in the IDE —
    /// the opposite failure of the one above, and the same data.</summary>
    [Theory]
    [InlineData("unreadable")]
    [InlineData("unwalked")]
    public void A_baseline_less_pull_keeps_the_file_of_an_item_it_could_not_see(string why)
    {
        const string decl = "FUNCTION_BLOCK FB_A\nVAR\nEND_VAR";
        var ide = ConnectedIde(Prg(), FakeIde.Item.TextualPou("FB_A", decl, "y := 1;", "POUs"));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var file = Path.Combine(root, "src", "POUs", "FB_A.fb");
            Assert.True(File.Exists(file), "fixture: the first pull wrote the file");

            if (why == "unreadable")
            {
                ide.RemoveItem("FB_A");
                ide.AddItem(new FakeIde.Item("FB_A", Volt.Engine.Item.ItemKind.PlcPouFb, "POUs", true,
                    decl, null, "LD", "the graphical body cannot be read"));
            }
            else ide.UnwalkableFolders = new[] { "POUs" };
            File.Delete(Config.Paths(root).IdeRefsPath);
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            Assert.True(File.Exists(file), $"a baseline-less pull deleted FB_A.fb, which the IDE still holds ({why})");
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>…and the `unreadable` exemption is the unreadable ITEM's, not its bare name's. Bare names repeat
    /// across kinds (`CM_Carrier.fb` beside `CM_Carrier.visualization`, CLAUDE.md): with the FB unreadable, a
    /// visualization the IDE deleted must still be retired, or the rebuilt baseline lacks it while its file stays,
    /// and its next edit pushes as a CREATE. Both pulls: with a baseline (the bridge's `removed`) and without one
    /// (the recovery path) — one rule, applied once.</summary>
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void An_unreadable_item_does_not_keep_a_deleted_item_of_another_kind(bool withBaseline)
    {
        // FakeIde resolves an item by bare name, first match: the unreadable FB answers every read of
        // `CM_Carrier`, so the visualization reads its (empty) manifest and the FB still throws.
        FakeIde.Item Fb() => new("CM_Carrier", Volt.Engine.Item.ItemKind.PlcPouFb, "CM", true,
            null, null, "LD", "the graphical body cannot be read");
        var ide = ConnectedIde(Prg(), Fb(),
            new FakeIde.Item("CM_Carrier", Volt.Engine.Item.ItemKind.PlcVisObj, "CM", true, null, null, null, null));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var visu = Path.Combine(root, "src", "CM", "CM_Carrier.visualization");
            Assert.True(File.Exists(visu), "fixture: the first pull wrote the visualization");

            ide.RemoveItem("CM_Carrier");   // both halves go…
            ide.AddItem(Fb());              // …and the FB comes back: only the visualization was deleted
            if (!withBaseline) File.Delete(Config.Paths(root).IdeRefsPath);
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            Assert.False(File.Exists(visu), "the deleted visualization survived, shielded by the unreadable FB's bare name");
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>…and a referenced library's rendered signatures survive it: they are path-identified, never wire
    /// items, so a baseline-less pull neither names them as known nor retires them.</summary>
    [Fact]
    public void A_baseline_less_pull_keeps_the_library_signature_files()
    {
        var manifest = "LIBRARY CAA Types\nNAMESPACE CAA\nRESOLUTION caatypes\nPLACEHOLDER false\nSYSTEM false\n";
        var handle = new Volt.Engine.Library.LibSignature("HANDLE", "caatypes", "Type",
            new Volt.Engine.Library.LibVar[0], new Volt.Engine.Library.LibVar[0],
            new Volt.Engine.Library.LibVar[0], new Volt.Engine.Library.LibVar[0], null, null, "__XWORD");
        var ide = new FakeIde(Prg(), FakeIde.Item.Library("CAA Types", manifest))
        {
            HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "Demo",
            LibSignatures = new[] { handle },
        };
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var libDir = Path.Combine(root, "src", "Library Manager", "CAA Types");
            var before = Directory.GetFiles(libDir, "*", SearchOption.AllDirectories).Select(Path.GetFileName).OrderBy(x => x).ToArray();
            Assert.Contains(before, f => f!.StartsWith("HANDLE.", StringComparison.Ordinal));

            File.Delete(Config.Paths(root).IdeRefsPath);
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            var after = Directory.GetFiles(libDir, "*", SearchOption.AllDirectories).Select(Path.GetFileName).OrderBy(x => x).ToArray();
            Assert.Equal(before, after);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>…but the library's `.library` STUB is a wire item, so a library the IDE no longer references is
    /// retired by a baseline-less pull exactly as by one with a baseline. The stub sits inside its own library
    /// root, and excluding everything under a root dropped it from the names the pull sends as known: the bridge
    /// then saw no library removed (`librariesRefreshed` false, nothing in `removed`), the stub and every
    /// signature were carried forward, and the rebuilt baseline lacked the stub while its files stayed — so every
    /// later pull kept them too, and the removed library's signatures kept resolving in the LSP.</summary>
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void A_library_the_ide_no_longer_references_is_retired_with_or_without_a_baseline(bool withBaseline)
    {
        var manifest = "LIBRARY CAA Types\nNAMESPACE CAA\nRESOLUTION caatypes\nPLACEHOLDER false\nSYSTEM false\n";
        var handle = new Volt.Engine.Library.LibSignature("HANDLE", "caatypes", "Type",
            new Volt.Engine.Library.LibVar[0], new Volt.Engine.Library.LibVar[0],
            new Volt.Engine.Library.LibVar[0], new Volt.Engine.Library.LibVar[0], null, null, "__XWORD");
        var ide = new FakeIde(Prg(), FakeIde.Item.Library("CAA Types", manifest))
        {
            HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "Demo",
            LibSignatures = new[] { handle },
        };
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var libDir = Path.Combine(root, "src", "Library Manager", "CAA Types");
            Assert.True(File.Exists(Path.Combine(libDir, "CAA Types.library")), "fixture: the first pull wrote the stub");
            Assert.Contains(Directory.GetFiles(libDir).Select(Path.GetFileName), f => f!.StartsWith("HANDLE.", StringComparison.Ordinal));

            ide.RemoveItem("CAA Types");
            ide.LibSignatures = Array.Empty<Volt.Engine.Library.LibSignature>();
            if (!withBaseline) File.Delete(Config.Paths(root).IdeRefsPath);
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            var left = Directory.Exists(libDir) ? Directory.GetFiles(libDir, "*", SearchOption.AllDirectories) : Array.Empty<string>();
            Assert.True(left.Length == 0, $"the removed library's files survived: {string.Join(", ", left.Select(Path.GetFileName))}");
            Assert.DoesNotContain("CAA Types.library", Sidecar.LoadIdeRefs(root)!.Items.Keys);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>…and the subtype variant: the IDE rewrote `E_Mode` from an enum to a struct since the last pull.
    /// With no baseline the fetch cannot report `E_Mode.enum` removed, so the ordinary sweep never sees it — the
    /// pull must still leave exactly ONE file for the one DUT.</summary>
    [Fact]
    public void A_baseline_less_pull_after_an_ide_subtype_change_leaves_one_dut_file()
    {
        var ide = ConnectedIde(Prg(), EMode());
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            ide.RemoveItem("E_Mode");
            ide.AddItem(FakeIde.Item.TextualPou("E_Mode", "TYPE E_Mode :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE", "", "DUTs"));
            File.Delete(Config.Paths(root).IdeRefsPath);
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            var duts = Directory.GetFiles(Path.Combine(root, "src", "DUTs")).Select(Path.GetFileName).ToArray();
            Assert.Equal(new[] { "E_Mode.struct" }, duts);
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
