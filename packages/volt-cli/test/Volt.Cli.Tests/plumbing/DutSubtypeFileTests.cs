using Volt.Cli.Sync;
using Volt.Contracts;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// A DUT is ONE wire kind and FOUR files on disk.
///
/// <para><b>Which half is which matters.</b> The wire keeps <c>dut</c> because that is what both vendors have —
/// CODESYS creates every DUT with one <c>create_dut</c> call — and because
/// <c>Versioning.VersionedItem.Identity</c> IS the full wire name: every <c>ifVersion</c> gate keys on it, so a
/// subtype in the identity would turn "edit a struct into an enum" into a delete plus a create of the same
/// underlying object. The subtype belongs to the FILE, where it is a name an engineer reads in a diff.</para>
///
/// <para>These pin the seam in both directions, because a one-way mapping is how a workspace ends up with items
/// the bridge cannot resolve.</para>
/// </summary>
public class DutSubtypeFileTests
{
    private static FetchedItem Dut(string name, string text, string folder = "") =>
        new() { Name = name, Folder = folder, SourceText = text };

    private const string Struct = "TYPE BUS_INFO :\nSTRUCT\n\tETYPE : INT;\nEND_STRUCT\nEND_TYPE";
    private const string Enum = "TYPE E_Mode :\n(\n\tIdle := 0,\n\tRun\n);\nEND_TYPE";
    private const string Union = "TYPE U_Bits :\nUNION\n\tb : BYTE;\nEND_UNION\nEND_TYPE";
    private const string Alias = "TYPE T_Count : UINT (0..100);\nEND_TYPE";

    [Theory]
    [InlineData(Struct, "struct")]
    [InlineData(Enum, "enum")]
    [InlineData(Union, "union")]
    [InlineData(Alias, "alias")]
    public void A_dut_is_written_under_the_extension_its_declaration_says(string text, string ext)
    {
        var files = Materialize.MaterializeItem(Dut("X.dut", text, "POUs"));
        Assert.Equal($"POUs/X.{ext}", Assert.Single(files).Path);
    }

    [Theory]
    [InlineData("struct")]
    [InlineData("enum")]
    [InlineData("union")]
    [InlineData("alias")]
    public void And_reads_back_as_the_one_wire_name(string ext)
    {
        // The bridge only ever knows `X.dut`; if the path→name direction leaked the subtype, push would send a
        // name no vendor can resolve and the item would be created rather than updated.
        var item = Materialize.PathToItem($"POUs/X.{ext}");
        Assert.NotNull(item);
        Assert.Equal("X.dut", item!.Value.Name);
        Assert.Equal("POUs", item.Value.Folder);
    }

    [Fact]
    public void The_round_trip_closes_for_every_subtype()
    {
        foreach (var (text, _) in new[] { (Struct, 0), (Enum, 0), (Union, 0), (Alias, 0) })
        {
            var path = Assert.Single(Materialize.MaterializeItem(Dut("X.dut", text))).Path;
            Assert.Equal("X.dut", Materialize.PathToItem(path)!.Value.Name);
        }
    }

    [Fact]
    public void A_workspace_pulled_before_the_split_is_still_tracked()
    {
        // `.dut` files exist in every workspace pulled before this change, and a library's rendered signatures
        // still carry them. An unrecognized extension is not "left alone" — it is invisible to status and pull.
        Assert.True(Extensions.IsTrackedPath("POUs/X.dut"));
        Assert.True(Extensions.IsPushable("POUs/X.dut"));
        Assert.Equal("X.dut", Materialize.PathToItem("POUs/X.dut")!.Value.Name);
    }

    [Fact]
    public void Every_subtype_extension_is_pushable_source_not_a_read_only_reference()
    {
        foreach (var ext in ItemKind.DutFileExtensions)
        {
            Assert.True(Extensions.IsTrackedPath($"POUs/X.{ext}"), ext);
            Assert.True(Extensions.IsPushable($"POUs/X.{ext}"), ext);
            Assert.False(Extensions.IsReadOnly($"POUs/X.{ext}"), ext);
        }
    }

    [Fact]
    public void Changing_a_subtype_changes_the_FILE_but_never_the_wire_name()
    {
        // The hazard this guards: the same item, edited from struct to enum, must stay ONE item to the bridge
        // (so the push is an update) while moving to a new file (so the workspace reads true). The old file is
        // then absent from the materialized set, which is what makes a pull sweep it.
        var before = Assert.Single(Materialize.MaterializeItem(Dut("X.dut", Struct)));
        var after = Assert.Single(Materialize.MaterializeItem(Dut("X.dut", Enum)));

        Assert.Equal("X.struct", before.Path);
        Assert.Equal("X.enum", after.Path);
        Assert.Equal(Materialize.PathToItem(before.Path)!.Value.Name, Materialize.PathToItem(after.Path)!.Value.Name);
    }

    [Fact]
    public void A_non_dut_kind_is_untouched_by_any_of_this()
    {
        var fb = new FetchedItem { Name = "FB_Motor.fb", Folder = "POUs", SourceText = "FUNCTION_BLOCK FB_Motor\nEND_FUNCTION_BLOCK" };
        Assert.Equal("POUs/FB_Motor.fb", Assert.Single(Materialize.MaterializeItem(fb)).Path);
        Assert.Equal("FB_Motor.fb", Materialize.PathToItem("POUs/FB_Motor.fb")!.Value.Name);
    }
}
