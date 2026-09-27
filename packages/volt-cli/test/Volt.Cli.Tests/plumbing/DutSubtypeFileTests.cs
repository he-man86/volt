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
        var fb = new FetchedItem { Name = "FB_Motor.fb", Folder = "POUs", SourceText = "FUNCTION_BLOCK FB_Motor\n(* @volt-implementation *)\nEND_FUNCTION_BLOCK" };
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
}
