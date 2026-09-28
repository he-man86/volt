using System.IO;
using System.Linq;
using System.Text;
using Volt.Cli.Sync;
using static Volt.Cli.Tests.CommandHarness;
using Volt.Contracts;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// A DUT's FILE NAME IS ITS WIRE NAME — <c>X.struct</c>, <c>X.enum</c>, <c>X.union</c>, <c>X.alias</c> — and the
/// CLI holds no DUT logic (openspec <c>dut-subtype-on-the-wire</c>).
///
/// <para><b>What this replaced.</b> The wire used to carry every DUT as <c>X.dut</c>, and the CLI split it: a pull
/// READ the declaration to pick the file extension, a push folded the four extensions back to <c>.dut</c>, and
/// <c>IdeTree</c> carried a guard for the bug that split caused (a struct rewritten as an enum left the old file
/// beside the new one, still mapped to the live item). Item-kind knowledge in the one layer whose job is git.
/// The engine now names the item by its subtype, so every one of those becomes identity: files in, ops out.</para>
///
/// <para>A subtype change is a REMOVED name plus an ADDED one on the wire, so the pull's ordinary removal sweep
/// retires the old file; and a push of either git shape (rename, or delete + add) is ONE update of the same IDE
/// object, decided in the engine — see <c>DutSubtypeChangePushTests</c> for that half.</para>
/// </summary>
public class DutSubtypeFileTests
{
    private static FetchedItem Dut(string name, string text, string folder = "") =>
        new() { Name = name, Folder = folder, SourceText = text };

    private const string Struct = "TYPE BUS_INFO :\nSTRUCT\n\tETYPE : INT;\nEND_STRUCT\nEND_TYPE";
    private const string Enum = "TYPE E_Mode :\n(\n\tIdle := 0,\n\tRun\n);\nEND_TYPE";
    private const string Union = "TYPE U_Bits :\nUNION\n\tb : BYTE;\nEND_UNION\nEND_TYPE";
    private const string Alias = "TYPE T_Count : UINT (0..100);\nEND_TYPE";

    // ── the file name IS the wire name ─────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(Struct, "struct")]
    [InlineData(Enum, "enum")]
    [InlineData(Union, "union")]
    [InlineData(Alias, "alias")]
    public void A_dut_is_written_under_its_wire_name(string text, string ext)
    {
        var files = Materialize.MaterializeItem(Dut($"X.{ext}", text, "POUs"));
        Assert.Equal($"POUs/X.{ext}", Assert.Single(files).Path);
    }

    /// <summary>NO DECLARATION READ ON PULL: the name the wire sent is the file, even where the text would say
    /// otherwise. Deciding the subtype is the engine's job, done once; a client that re-derives it is a second
    /// classifier that can disagree with the first.</summary>
    [Fact]
    public void The_file_name_comes_from_the_wire_never_from_the_declaration()
    {
        var file = Assert.Single(Materialize.MaterializeItem(Dut("X.enum", Struct, "DUTs")));
        Assert.Equal("DUTs/X.enum", file.Path);
    }

    [Theory]
    [InlineData("struct")]
    [InlineData("enum")]
    [InlineData("union")]
    [InlineData("alias")]
    public void And_a_dut_file_reads_back_as_that_same_wire_name(string ext)
    {
        // Folding the four extensions back onto `.dut` was the push half of the split. The bridge names the item
        // `X.<subtype>` now, so the file's own name is the only name a push may send.
        var item = Materialize.PathToItem($"POUs/X.{ext}");
        Assert.NotNull(item);
        Assert.Equal($"X.{ext}", item!.Value.Name);
        Assert.Equal("POUs", item.Value.Folder);
    }

    [Fact]
    public void The_round_trip_closes_for_every_subtype()
    {
        foreach (var name in new[] { "X.struct", "X.enum", "X.union", "X.alias" })
        {
            var path = Assert.Single(Materialize.MaterializeItem(Dut(name, Struct))).Path;
            Assert.Equal(name, Materialize.PathToItem(path)!.Value.Name);
        }
    }

    [Fact]
    public void No_path_produces_or_recognizes_a_dut_FILE()
    {
        // No wire message carries `.dut`, so no file is named that way and none is recognized.
        Assert.False(Extensions.IsTrackedPath("POUs/X.dut"));
        Assert.False(Extensions.IsPushable("POUs/X.dut"));
        Assert.Null(Materialize.PathToItem("POUs/X.dut"));
    }

    /// <summary>A wire name the CLI cannot file — now most likely the engine minting an extension its own table lacks —
    /// is refused naming THAT table. The message used to say "add it to Extensions.cs", a file that holds no list
    /// since the extensions derive from the engine's: it sent the fix into the one layer that must hold no kinds.</summary>
    [Fact]
    public void An_unfileable_wire_name_is_refused_naming_the_engines_kind_table()
    {
        var ex = Assert.Throws<InvalidOperationException>(() => Materialize.MaterializeItem(Dut("X.dut", Struct)));
        Assert.Contains("\"X.dut\"", ex.Message);
        Assert.Contains("ItemKind.FileExtensions", ex.Message);
        Assert.DoesNotContain("Extensions.cs", ex.Message);
    }

    [Theory]
    [InlineData("struct")]
    [InlineData("enum")]
    [InlineData("union")]
    [InlineData("alias")]
    public void Every_subtype_extension_is_pushable_source_not_a_read_only_reference(string ext)
    {
        Assert.True(Extensions.IsTrackedPath($"POUs/X.{ext}"), ext);
        Assert.True(Extensions.IsPushable($"POUs/X.{ext}"), ext);
        Assert.False(Extensions.IsReadOnly($"POUs/X.{ext}"), ext);
    }

    [Fact]
    public void A_non_dut_kind_is_untouched_by_any_of_this()
    {
        var fb = new FetchedItem { Name = "FB_Motor.fb", Folder = "POUs", SourceText = "FUNCTION_BLOCK FB_Motor\nIMPLEMENTATION ST\nEND_FUNCTION_BLOCK" };
        Assert.Equal("POUs/FB_Motor.fb", Assert.Single(Materialize.MaterializeItem(fb)).Path);
        Assert.Equal("FB_Motor.fb", Materialize.PathToItem("POUs/FB_Motor.fb")!.Value.Name);
    }

    // ── through the commands ───────────────────────────────────────────────────────────────────────

    /// <summary>THE BASELINE IS KEYED BY THE SAME NAME AS THE FILE. The sidecar holds what `refs` published, so a
    /// pull records `E_Mode.enum` — the file's own name — and never an `E_Mode.dut` no file maps to.</summary>
    [Fact]
    public void A_pull_writes_the_file_and_the_baseline_under_the_wire_name()
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("E_Mode", Enum, "", "DUTs"));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            Assert.True(File.Exists(Path.Combine(root, "src", "DUTs", "E_Mode.enum")));
            var baseline = Sidecar.LoadIdeRefs(root)!;
            Assert.Equal(new[] { "E_Mode.enum" }, baseline.Items.Keys.ToArray());
            Assert.Equal("DUTs", baseline.Folders["E_Mode.enum"]);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>A PULL AFTER THE IDE CHANGED A SUBTYPE LEAVES EXACTLY ONE FILE — through the ORDINARY sweep. The
    /// fetch reports `BUS_INFO.struct` removed and `BUS_INFO.enum` changed, which is every other item's shape; the
    /// stale-subtype guard that used to close this (because both files mapped to one `.dut` name) is not needed,
    /// and a stale file left behind would be a second live handle that pushes the old shape back.</summary>
    [Fact]
    public void A_pull_after_a_subtype_change_leaves_exactly_one_file()
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("BUS_INFO", Struct, ""));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            Assert.True(File.Exists(Path.Combine(root, "src", "BUS_INFO.struct")));

            // The engineer rewrites it as an enum in the IDE. Same object, a new subtype — so a new wire name.
            ide.RemoveItem("BUS_INFO");
            ide.AddItem(FakeIde.Item.TextualPou("BUS_INFO", Enum.Replace("E_Mode", "BUS_INFO"), ""));

            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            Assert.True(File.Exists(Path.Combine(root, "src", "BUS_INFO.enum")), "the new subtype was not written");
            Assert.False(File.Exists(Path.Combine(root, "src", "BUS_INFO.struct")),
                         "the old subtype's file survived — it is a second live handle on the same IDE object");
            Assert.Equal(new[] { "BUS_INFO.enum" }, Sidecar.LoadIdeRefs(root)!.Items.Keys.ToArray());
            Assert.Equal("in sync with the IDE", Commands.Status(root, client).Summary);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>A DUT DELETED IN THE IDE LEAVES THE WORKSPACE. The pull's removal sweep matched the fetch's
    /// removed WIRE names against FILE names, which differed for a DUT — so the file survived, the sidecar
    /// dropped the item, `volt status` read in sync, and the next edit of the stale file pushed as a CREATE
    /// and resurrected the DUT the engineer had deleted. (Found reviewing section 1; kept as the wire fact.)</summary>
    [Fact]
    public void A_dut_deleted_in_the_ide_is_removed_by_the_next_pull()
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("BUS_INFO", Struct, ""));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            Assert.True(File.Exists(Path.Combine(root, "src", "BUS_INFO.struct")));

            ide.RemoveItem("BUS_INFO");
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            Assert.False(File.Exists(Path.Combine(root, "src", "BUS_INFO.struct")),
                         "the IDE deleted the DUT but its file survived the pull — editing it would re-create it");
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>AN IDE-SIDE EDIT OF A DUT POINTS AT THE REAL FILE. `pathByName` for an incoming-only item is
    /// minted `{folder}/{wireName}`, so with a `.dut` wire name it named `DUTs/X.dut` — a file that does not exist.
    /// volt-vscode's drift colouring and volt-control's drift list keyed on it and never coloured the real
    /// `X.struct`, and the diff pane's `volt show BRIDGE DUTs/X.dut` failed `unrecognized path` (task 1.4 census).
    /// Fixed by construction once file name == wire name; no CLI mapping.</summary>
    [Fact]
    public void An_ide_side_dut_edit_maps_to_the_real_file_and_shows_the_ides_text()
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("BUS_INFO", Struct, "", "DUTs"));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            // The engineer adds a field in the IDE — the same subtype, so the same wire name.
            ide.RemoveItem("BUS_INFO");
            ide.AddItem(FakeIde.Item.TextualPou("BUS_INFO", Struct.Replace("ETYPE : INT;", "ETYPE : INT;\n\tEXTRA : BOOL;"), "", "DUTs"));

            var s = Commands.Status(root, client);
            Assert.Contains("BUS_INFO.struct", s.Incoming.Modified);
            Assert.Equal("DUTs/BUS_INFO.struct", s.PathByName["BUS_INFO.struct"]);

            var (bytes, err, absent) = Commands.Show(root, client, "BRIDGE", "DUTs/BUS_INFO.struct");
            Assert.True(err is null && !absent, $"volt show BRIDGE failed: {err}");
            Assert.Contains("EXTRA : BOOL;", Encoding.UTF8.GetString(bytes!));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    // ── a DUT whose text states no subtype ─────────────────────────────────────────────────────────

    /// <summary>A DUT whose declaration states no subtype — reachable live: an engineer mid-way through typing
    /// `TYPE X :` in the IDE — is ONE item, and one item never takes the whole pull down. The spec publishes it as
    /// unreadable (the engine's per-item refusal); whatever it becomes, every OTHER item is still pulled. Making
    /// the subtype reader throw before the engine had a per-item place to catch it aborted the pull with a
    /// FormatException and wrote nothing.</summary>
    [Fact]
    public void A_dut_whose_text_states_no_subtype_never_aborts_a_pull()
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            ide.AddItem(FakeIde.Item.TextualPou("X", "TYPE X :\nEND_TYPE", "", "DUTs"));
            ide.MutateImplementation("PLC_PRG", "x := 2;");
            var r = Commands.Pull(root, client);

            Assert.True(r.Kind == "ok", $"pull {r.Kind}: {r.Reason}");
            Assert.Contains("x := 2;", File.ReadAllText(Path.Combine(root, "src", "PLC_PRG.prg")));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>…and it is written under NO name. A declaration that states no subtype is published unreadable,
    /// never under a guessed one; the CLI writes what the wire names, so no `DUTs/X.*` file appears. Reading the
    /// declaration here wrote `X.alias` — `END_TYPE` read as the first token after the colon.</summary>
    [Fact]
    public void A_dut_whose_text_states_no_subtype_is_not_written_under_a_guessed_subtype()
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            ide.AddItem(FakeIde.Item.TextualPou("X", "TYPE X :\nEND_TYPE", "", "DUTs"));
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            var duts = Path.Combine(root, "src", "DUTs");
            var written = Directory.Exists(duts) ? Directory.GetFiles(duts).Select(Path.GetFileName).ToArray() : new string?[0];
            Assert.True(written.Length == 0, $"a subtype-less DUT was written as {string.Join(", ", written)}");
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>A DUT THE WORKSPACE ALREADY HOLDS, TURNED SUBTYPE-LESS IN THE IDE — an engineer half-way through
    /// retyping `X`. The item is still in the IDE, just unreadable, so the pull keeps `DUTs/X.struct` with its
    /// last content and writes no guessed `X.alias` beside it. Today's pull wrote `X.alias` holding the half-typed
    /// text and swept `X.struct` as the item's replaced file. Both pulls: with a baseline, and without one (the
    /// recovery path, which rebuilds the known names from the previous `volt/ide` tree).</summary>
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void A_held_dut_whose_text_loses_its_subtype_keeps_its_file(bool withBaseline)
    {
        const string held = "TYPE X :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE";
        var ide = ConnectedIde(
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"),
            FakeIde.Item.TextualPou("X", held, "", "DUTs"));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var file = Path.Combine(root, "src", "DUTs", "X.struct");
            Assert.True(File.Exists(file), "fixture: the first pull wrote X.struct");
            var before = File.ReadAllText(file);

            ide.RemoveItem("X");
            ide.AddItem(FakeIde.Item.TextualPou("X", "TYPE X :\nEND_TYPE", "", "DUTs"));
            if (!withBaseline) File.Delete(Config.Paths(root).IdeRefsPath);
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            Assert.True(File.Exists(file), "the pull deleted X.struct for a DUT still in the IDE");
            Assert.Equal(before, File.ReadAllText(file));
            Assert.Equal(new[] { "X.struct" }, Directory.GetFiles(Path.Combine(root, "src", "DUTs")).Select(Path.GetFileName).ToArray());
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>…AND WHEN THE ENGINEER FINISHES RETYPING IT AS ANOTHER SUBTYPE, the held file goes. A subtype
    /// change in the IDE passes through the subtype-less state above (STRUCT..END_STRUCT deleted, the enum not yet
    /// typed), so a pull in that window is ordinary. That pull used to write a baseline without `X.struct` — the
    /// fetch's `Items` leaves an unreadable item out — so the next fetch was never asked about `X.struct`, never
    /// reported it removed, and `X.enum` landed BESIDE it: two files for one IDE object, the stale one with no
    /// baseline version (a local delete of it silently skipped, an edit a versionless set at the live enum).</summary>
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void A_held_dut_retyped_through_a_subtype_less_state_leaves_one_file(bool withBaseline)
    {
        const string held = "TYPE X :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE";
        var ide = ConnectedIde(
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"),
            FakeIde.Item.TextualPou("X", held, "", "DUTs"));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            ide.RemoveItem("X");
            ide.AddItem(FakeIde.Item.TextualPou("X", "TYPE X :\nEND_TYPE", "", "DUTs"));
            if (!withBaseline) File.Delete(Config.Paths(root).IdeRefsPath);
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            ide.RemoveItem("X");
            ide.AddItem(FakeIde.Item.TextualPou("X", "TYPE X : (A, B);\nEND_TYPE", "", "DUTs"));
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            Assert.Equal(new[] { "X.enum" }, Directory.GetFiles(Path.Combine(root, "src", "DUTs")).Select(Path.GetFileName).ToArray());
            var refs = Sidecar.LoadIdeRefs(root)!;
            Assert.True(refs.Items.ContainsKey("X.enum"), "the baseline does not hold X.enum");
            Assert.False(refs.Items.ContainsKey("X.struct"), "the baseline still holds X.struct");
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>…and the same window crossed by a PUSH of another item. The receipt is a fresh walk and lists an
    /// unreadable item under no full name, so adopting the receipt dropped `X.struct` from the baseline exactly as
    /// the pull did — and the pull after the retype landed `X.enum` beside it.</summary>
    [Fact]
    public void A_push_while_a_held_dut_is_subtype_less_keeps_it_known()
    {
        const string held = "TYPE X :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE";
        var ide = ConnectedIde(
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"),
            FakeIde.Item.TextualPou("X", held, "", "DUTs"));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            ide.RemoveItem("X");
            ide.AddItem(FakeIde.Item.TextualPou("X", "TYPE X :\nEND_TYPE", "", "DUTs"));
            Assert.Equal("ok", Commands.Pull(root, client).Kind);   // the push is gated on a current baseline
            var prg = Path.Combine(root, "src", "PLC_PRG.prg");
            File.WriteAllText(prg, File.ReadAllText(prg).Replace("x := 1;", "x := 2;"));
            var pushed = Commands.Push(root, client);
            Assert.True(pushed.Kind == "ok", $"push {pushed.Kind}: {pushed.Reason}");
            Assert.True(Sidecar.LoadIdeRefs(root)!.Items.ContainsKey("X.struct"),
                "the push forgot X.struct, an item still in the IDE that it neither deleted nor renamed");

            ide.RemoveItem("X");
            ide.AddItem(FakeIde.Item.TextualPou("X", "TYPE X : (A, B);\nEND_TYPE", "", "DUTs"));
            Assert.Equal("ok", Commands.Pull(root, client).Kind);

            Assert.Equal(new[] { "X.enum" }, Directory.GetFiles(Path.Combine(root, "src", "DUTs")).Select(Path.GetFileName).ToArray());
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>…and through `volt init`, where an abort is worse: init commits the scaffold BEFORE it
    /// materializes, so a throw there left a folder with config and a commit but no `volt/ide`, no baseline and
    /// no src — and a second `volt init` refused it as a non-empty folder.</summary>
    [Fact]
    public void A_dut_whose_text_states_no_subtype_never_aborts_an_init()
    {
        var ide = ConnectedIde(
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "x := 1;"),
            FakeIde.Item.TextualPou("X", "TYPE X :\nEND_TYPE", "", "DUTs"));
        var pipe = Pipe();
        var host = new Volt.Engine.Host.BridgePipeHost(ide, pipe);
        host.Start();
        var client = new BridgeClient(pipe);
        var parent = Directory.CreateTempSubdirectory("volt-init-").FullName;
        try
        {
            var r = Commands.Init(parent, client);

            Assert.True(r.Kind == "ok", $"init {r.Kind}");
            var ws = r.Workspace!;
            Assert.True(File.Exists(Path.Combine(ws, "src", "PLC_PRG.prg")));
            Assert.NotNull(IdeTree.VoltIdeHead(Git.ResolveGitDir(ws)));
            Assert.NotNull(Sidecar.LoadIdeRefs(ws));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(parent); }
    }

    // ── a subtype change pushed as delete + add ────────────────────────────────────────────────────

    /// <summary>A struct long enough that a rewrite as an enum or union shares under half its text, so git sees
    /// a DELETE plus an ADD (the 1.1 (b) shape), never a rename.</summary>
    private const string WideStruct =
        "TYPE X :\nSTRUCT\n\talpha : INT;\n\tbeta : BOOL;\n\tgamma : REAL;\n\tdelta : STRING(80);\n\tepsilon : TIME;\nEND_STRUCT\nEND_TYPE";

    private static string Rewritten(string subtype) => subtype switch
    {
        "enum" => "TYPE X :\n(\n\tRed := 0,\n\tGreen := 1,\n\tBlue := 2,\n\tCyan := 3,\n\tMagenta := 4\n);\nEND_TYPE",
        "union" => "TYPE X :\nUNION\n\tasWord : WORD;\n\tasBytes : ARRAY[0..1] OF BYTE;\n\tasInt : INT;\nEND_UNION\nEND_TYPE",
        _ => throw new System.ArgumentOutOfRangeException(nameof(subtype)),
    };

    /// <summary>Delete `X.struct`, add `X.{subtype}` in the workspace, push. BOTH git path orders: `X.enum`
    /// sorts BEFORE `X.struct` (the measured `[set, delete]` order) and `X.union` AFTER it (`[delete, set]`).
    /// Measured before this change (1.1): without force, the first wrote the enum and then refused the delete
    /// mid-push, and the second was refused for ever; with `--force`, the first was ACCEPTED with the DUT deleted
    /// (status then read in sync over an IDE with no DUT) and the second deleted it and then failed. Both must
    /// land as one update of the same object — the DUT is there after, in its folder, and nothing is left to
    /// pull or push.</summary>
    [Theory]
    [InlineData("enum", false)]
    [InlineData("union", false)]
    [InlineData("enum", true)]
    [InlineData("union", true)]
    public void A_subtype_rewrite_pushed_as_delete_plus_add_is_one_update_of_the_same_dut(string subtype, bool force)
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("X", WideStruct, "", "DUTs"));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var dir = Path.Combine(root, "src", "DUTs");
            File.Delete(Path.Combine(dir, "X.struct"));
            File.WriteAllText(Path.Combine(dir, $"X.{subtype}"), Rewritten(subtype) + "\n");

            var r = Commands.Push(root, client, force: force);
            Assert.True(r.Kind == "ok", $"push {r.Kind}: {r.Reason}");

            Assert.True(ide.Exists("X"), "the DUT is gone from the IDE");
            Assert.DoesNotContain(ide.Recorded, x => x.StartsWith("delete:") || x.StartsWith("create:"));
            var refs = RefsService.Handle(ide);
            Assert.Equal(new[] { $"X.{subtype}" }, refs.Items.Keys.ToArray());
            Assert.Equal("DUTs", refs.Folders[$"X.{subtype}"]);

            var s = Commands.Status(root, client);
            Assert.Equal("in sync with the IDE", s.Summary);
            Assert.True(File.Exists(Path.Combine(dir, $"X.{subtype}")));
            Assert.False(File.Exists(Path.Combine(dir, "X.struct")));
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>…AND OVER A PARTIAL RECEIPT. A receipt whose walk could not read a folder keeps the baseline's
    /// entries it did not see — but not the name THIS push retired. Restored, `X.struct` stayed in the baseline
    /// beside `X.enum` while the IDE and the workspace held only `X.enum`; rewriting `X` back to a struct then
    /// sent an UPDATE of `X.struct` (at the stale version) paired with the delete of `X.enum`, and the engine
    /// refused the pair with advice the engineer could not act on.</summary>
    [Fact]
    public void A_subtype_rewrite_over_a_partial_receipt_retires_the_old_name_from_the_baseline()
    {
        var ide = ConnectedIde(
            FakeIde.Item.TextualPou("X", WideStruct, "", "DUTs"),
            FakeIde.Item.TextualPou("Deep", "PROGRAM Deep\nVAR\nEND_VAR", "y := 2;", "Machine"));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            ide.UnwalkableFolders = new[] { "Machine" };
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            var dir = Path.Combine(root, "src", "DUTs");

            File.Delete(Path.Combine(dir, "X.struct"));
            File.WriteAllText(Path.Combine(dir, "X.enum"), Rewritten("enum") + "\n");
            var first = Commands.Push(root, client);
            Assert.True(first.Kind == "ok", $"push {first.Kind}: {first.Reason}");

            var baseline = Sidecar.LoadIdeRefs(root)!.Items.Keys;
            Assert.DoesNotContain("X.struct", baseline);
            Assert.Contains("X.enum", baseline);
            Assert.Contains("Deep.prg", baseline);   // the unseen item is still kept

            File.Delete(Path.Combine(dir, "X.enum"));
            File.WriteAllText(Path.Combine(dir, "X.struct"), WideStruct + "\n");
            var back = Commands.Push(root, client);
            Assert.True(back.Kind == "ok", $"push {back.Kind}: {back.Reason}");
            Assert.Equal(new[] { "X.struct" }, RefsService.Handle(ide).Items.Keys.Where(k => k.StartsWith("X.")).ToArray());
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>…AND INTO ANOTHER FOLDER: delete `DUTs/X.struct`, add `Types/X.{subtype}`. The push sends the
    /// create with its folder, and the one update it becomes must still MOVE the DUT — otherwise the IDE keeps
    /// `X` in `DUTs` while the receipt, the baseline and the workspace say `Types`, status reads in sync, and the
    /// two never meet again (later updates carry no folder; a pull short-circuits on an equal version).</summary>
    [Theory]
    [InlineData("enum", false)]
    [InlineData("union", false)]
    [InlineData("enum", true)]
    [InlineData("union", true)]
    public void A_subtype_rewrite_into_another_folder_moves_the_dut(string subtype, bool force)
    {
        var ide = ConnectedIde(FakeIde.Item.TextualPou("X", WideStruct, "", "DUTs"));
        var (root, host, client) = Bound(ide);
        try
        {
            Assert.Equal("ok", Commands.Pull(root, client).Kind);
            File.Delete(Path.Combine(root, "src", "DUTs", "X.struct"));
            var types = Path.Combine(root, "src", "Types");
            Directory.CreateDirectory(types);
            File.WriteAllText(Path.Combine(types, $"X.{subtype}"), Rewritten(subtype) + "\n");

            var r = Commands.Push(root, client, force: force);
            Assert.True(r.Kind == "ok", $"push {r.Kind}: {r.Reason}");

            Assert.True(ide.Exists("X"), "the DUT is gone from the IDE");
            // The DUT `X` is never deleted or created. `Types` does not exist in the IDE, so the move creates the
            // FOLDER (`create:Types`) — the destination being made, not the object.
            Assert.DoesNotContain(ide.Recorded, x => x is "delete:X" or "create:X");
            var refs = RefsService.Handle(ide);
            Assert.Equal(new[] { $"X.{subtype}" }, refs.Items.Keys.ToArray());
            Assert.Equal("Types", refs.Folders[$"X.{subtype}"]);
            Assert.Equal("in sync with the IDE", Commands.Status(root, client).Summary);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }
}
