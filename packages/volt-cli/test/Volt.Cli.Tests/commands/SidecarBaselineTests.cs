using System;
using System.IO;
using System.Linq;
using Volt.Cli.Sync;
using Xunit;
using static Volt.Cli.Tests.CommandHarness;

namespace Volt.Cli.Tests;

/// <summary>
/// THE BASELINE (<c>.git/volt/ide-refs.json</c>): what a key that is no wire name does, and what a pull with no
/// baseline must still get right.
///
/// <para><b>A baseline key that is no wire name is refused by name, never translated</b>
/// (<c>Sidecar.RefuseUnknownNames</c>). Since openspec <c>push-without-header-check</c> 5.P every DUT is <c>X.dut</c>,
/// so a workspace bound under 5.B or <c>dut-subtype-on-the-wire</c> holds baseline keys <c>X.struct</c> /
/// <c>X.enum</c> / <c>X.union</c> / <c>X.alias</c>, extensions that name no kind. Every <c>ifVersion</c> such a key
/// quotes names no item, so <c>volt pull</c> and <c>volt push</c> both refuse the baseline: the key, the file to
/// delete, and <c>volt pull</c>, which rebuilds it. There is no translator: it would be item-kind knowledge in the
/// CLI.</para>
///
/// <para><b>Two doors</b>, and the second is the easy one to miss: the PENDING baseline a conflicted pull stashes
/// (<c>pending-ide-refs.json</c>) is promoted straight into the live sidecar by <c>volt merge --continue</c>, so a
/// refusal only at <c>LoadIdeRefs</c> would let the key back in through the merge.</para>
///
/// <para>The rest of the file pins the recovery the refusal names, a pull with NO baseline. These rows lived in
/// <c>DutBaselineMigrationTests</c>, whose DUT-key premise 5.P removed; they were never DUT facts.</para>
/// </summary>
public class SidecarBaselineTests
{
    private const string Enum = "TYPE E_Mode :\n(\n\tIdle := 0,\n\tRun\n);\nEND_TYPE";

    private static FakeIde.Item Prg(string impl = "x := 1;") =>
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", impl);

    private static FakeIde.Item EMode() => FakeIde.Item.TextualPou("E_Mode", Enum, "", "DUTs");

    private static string PrgPath(string root) => Path.Combine(root, "src", "PLC_PRG.prg");

    /// <summary>The baseline as a pre-5.P CLI wrote it: the DUT's entry under its subtype name.</summary>
    private static IdeRefs WithSplitDutKey(IdeRefs refs, string stale)
    {
        var items = refs.Items.Where(kv => kv.Key != "E_Mode.dut").ToDictionary(kv => kv.Key, kv => kv.Value);
        var folders = refs.Folders.Where(kv => kv.Key != "E_Mode.dut").ToDictionary(kv => kv.Key, kv => kv.Value);
        items[stale] = refs.Items["E_Mode.dut"];
        folders[stale] = refs.Folders["E_Mode.dut"];
        return new IdeRefs { ProjectVersion = refs.ProjectVersion, Items = items, Folders = folders };
    }

    private static void AssertRefusedByName(Exception? e, string stale, string file)
    {
        Assert.NotNull(e);
        Assert.IsType<InvalidOperationException>(e);
        Assert.Contains($"{file} holds \"{stale}\"", e!.Message);
        Assert.Contains("delete .git/volt/ide-refs.json", e.Message);
        Assert.Contains("volt pull", e.Message);
    }

    /// <summary>A PULL AND A PUSH OVER A SPLIT-NAME BASELINE are refused by name, and nothing reaches the IDE.</summary>
    [Theory]
    [InlineData("E_Mode.struct", "pull")]
    [InlineData("E_Mode.enum", "pull")]
    [InlineData("E_Mode.union", "push")]
    [InlineData("E_Mode.alias", "push")]
    public void A_baseline_keyed_by_a_split_dut_name_is_refused_by_name(string stale, string verb)
    {
        var ide = ConnectedIde(Prg(), EMode());
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            Sidecar.SaveIdeRefs(root, WithSplitDutKey(Sidecar.LoadIdeRefs(root)!, stale));
            File.WriteAllText(PrgPath(root), File.ReadAllText(PrgPath(root)).Replace("x := 1;", "x := 2;"));
            var recordedBefore = ide.Recorded.Count;

            var e = Record.Exception(() =>
            {
                if (verb == "pull") Commands.Pull(root, client);
                else Commands.Push(root, client);
            });

            AssertRefusedByName(e, stale, ".git/volt/ide-refs.json");
            Assert.DoesNotContain(ide.Recorded.Skip(recordedBefore), x => x.StartsWith("write") || x.StartsWith("delete"));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>THE MERGE DOOR. A pending baseline holding a split-name key is refused, not promoted: the git merge
    /// stands, the stash is dropped, the live baseline is NOT advanced, and the exit is 1 with the refusal named.</summary>
    [Fact]
    public void A_split_name_pending_baseline_is_refused_and_never_promoted_by_merge_continue()
    {
        var ide = ConnectedIde(Prg(), EMode());
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var before = Sidecar.LoadIdeRefs(root)!.ProjectVersion;
            File.WriteAllText(PrgPath(root), File.ReadAllText(PrgPath(root)).Replace("x := 1;", "x := 2;")); // ours
            ide.MutateImplementation("PLC_PRG", "x := 99;");                                                   // theirs
            Assert.Equal("conflict", Commands.Pull(root, client).Kind);

            Sidecar.SavePendingIdeRefs(root, WithSplitDutKey(Sidecar.LoadPendingIdeRefs(root)!, "E_Mode.struct"));
            AssertRefusedByName(Record.Exception(() => Sidecar.LoadPendingIdeRefs(root)),
                "E_Mode.struct", ".git/volt/pending-ide-refs.json");

            Commands.Merge(root, resolve: "PLC_PRG.prg", useTheirs: true);
            var (code, msg) = Commands.Merge(root, cont: true);

            Assert.False(Git.IsMerging(root), "the git merge did not complete");
            Assert.True(code == 1, $"merge --continue exit {code}: {msg}");
            Assert.Contains("the IDE baseline was NOT synced", msg);
            Assert.Contains("\"E_Mode.struct\"", msg);
            var live = Sidecar.LoadIdeRefs(root)!;
            Assert.Equal(before, live.ProjectVersion);
            Assert.DoesNotContain("E_Mode.struct", live.Items.Keys);
            Assert.Null(Sidecar.LoadPendingIdeRefs(root));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>…and the fix it names WORKS: with the refused baseline deleted, `volt pull` rebuilds one from the
    /// wire, after which every key is a wire name (the DUT is `E_Mode.dut`) and the push goes through.</summary>
    [Fact]
    public void Deleting_the_refused_baseline_and_pulling_rebuilds_it_and_the_push_then_lands()
    {
        var ide = ConnectedIde(Prg(), EMode());
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            Sidecar.SaveIdeRefs(root, WithSplitDutKey(Sidecar.LoadIdeRefs(root)!, "E_Mode.enum"));

            File.Delete(Config.Paths(root).IdeRefsPath);
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var rebuilt = Sidecar.LoadIdeRefs(root)!;
            Assert.DoesNotContain("E_Mode.enum", rebuilt.Items.Keys);
            Assert.Contains("E_Mode.dut", rebuilt.Items.Keys);
            Assert.True(File.Exists(Path.Combine(root, "src", "DUTs", "E_Mode.dut")));

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
    [InlineData("E_Mode", "DUTs/E_Mode.dut")]
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

    /// <summary>…and what it could not see stays IN THE BASELINE, so a later pull can still retire it. The
    /// recovery pull (the sidecar deleted, as the refusal says) over a folder that faults used to write the
    /// partial map as the whole baseline, while the files under that folder were carried forward in `volt/ide`.
    /// A later fetch is asked only about names the baseline holds, so when the IDE then deleted one of them no
    /// pull ever reported it: its file stayed, status read in sync, and its next edit was pushed as a CREATE that
    /// brought the deleted DUT back into the PLC.</summary>
    [Fact]
    public void A_baseline_less_pull_over_an_unreadable_folder_still_retires_what_the_ide_deletes_later()
    {
        var ide = ConnectedIde(Prg(),
            FakeIde.Item.TextualPou("E_Mode", "TYPE E_Mode :\n(\n\tIdle,\n\tRun\n);\nEND_TYPE", "", "Machine"));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var file = Path.Combine(root, "src", "Machine", "E_Mode.dut");
            Assert.True(File.Exists(file), "fixture: the first pull wrote the file");

            File.Delete(Config.Paths(root).IdeRefsPath);
            ide.UnwalkableFolders = new[] { "Machine" };
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            Assert.True(File.Exists(file), "the recovery pull deleted a file under a folder it could not read");
            Assert.Contains("E_Mode.dut", Sidecar.LoadIdeRefs(root)!.Items.Keys);

            ide.RemoveItem("E_Mode");
            ide.UnwalkableFolders = new string[0];
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            Assert.False(File.Exists(file), "the file of a DUT the IDE deleted outlived the recovery pull");
            Assert.Equal("in sync with the IDE", Commands.Status(root, client).Summary);
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

    /// <summary>…and a subtype change: the IDE rewrote `E_Mode` from an enum to a struct since the last pull. Under
    /// 5.P the name does not move (`E_Mode.dut`), so a baseline-less pull leaves exactly ONE file for the one DUT,
    /// holding the new text.</summary>
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
            Assert.Equal(new[] { "E_Mode.dut" }, duts);
            Assert.Contains("STRUCT", File.ReadAllText(Path.Combine(root, "src", "DUTs", "E_Mode.dut")));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }
}
