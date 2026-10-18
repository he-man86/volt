using Xunit;
using Volt.Engine.Ide;
using Volt.Engine.Format.Body;
using Volt.Engine.Item;

namespace Volt.Engine.Tests;

/// <summary>
/// Finding a top-level item by its wire path (folder, name and kind). There were TWO of these, one per driver, and they gave different answers —
/// neither executed by a single C# test, which is how they came to disagree without anyone noticing. Both are
/// deleted; this is the one walk, and these are the first tests it has ever had.
/// <para>The differences were not choices: CODESYS matched case-SENSITIVELY while TwinCAT did not, and CODESYS
/// matched ANY node while TwinCAT matched only the six top-level CRUD kinds. Each case below pins the semantics
/// taken from whichever side had it right.</para>
/// </summary>
public class ItemLookupTests
{
    private static FakeIde Ide(params FakeIde.Item[] items) => new(items);

    private static FakeIde.Item Pou(string name, string folder = "") =>
        new(name, ItemKind.PlcPou, folder, true, $"FUNCTION_BLOCK {name}\nVAR\nEND_VAR", "", null, null);

    [Fact]
    public void A_finds_a_top_level_item_at_the_root()
    {
        var ide = Ide(Pou("FB_Motor"));

        Assert.NotNull(ItemLookup.Find(ide, "FB_Motor.pou"));
        Assert.Null(ItemLookup.Find(ide, "FB_Absent.pou"));
    }

    /// <summary>The CODESYS bug. IEC 61131-3 identifiers are case-insensitive, both IDEs treat them so, and the
    /// push's own item cache is keyed <c>OrdinalIgnoreCase</c> — so a case-sensitive lookup disagreed with the
    /// cache sitting one line above it. On a cache miss, pushing `fb_motor` at an IDE holding `FB_Motor` found
    /// nothing and went on to CREATE a second object.</summary>
    [Theory]
    [InlineData("fb_motor.pou")]
    [InlineData("FB_MOTOR.pou")]
    [InlineData("Fb_MoToR.pou")]
    public void B_matching_is_case_insensitive(string queried)
    {
        var ide = Ide(Pou("FB_Motor"));

        Assert.NotNull(ItemLookup.Find(ide, queried));
    }

    /// <summary>Items nested in folders are found by their PATH — the lookup descends to the folder the path names
    /// (openspec <c>multi-application-tree</c>). CODESYS's structural spine (Device / Plc Logic / Application) is made
    /// of plain nodes, so every container counts as a path segment, as the push's placement descends it. The bare name
    /// alone finds nothing: the lookup never searches the whole tree, where two applications may each hold the name.</summary>
    [Fact]
    public void C_finds_an_item_nested_in_folders_by_its_path_and_only_there()
    {
        var ide = Ide(Pou("FB_Deep", folder: "POUs/Sub/Deeper"));

        Assert.NotNull(ItemLookup.Find(ide, "POUs/Sub/Deeper/FB_Deep.pou"));
        Assert.NotNull(ItemLookup.Find(ide, "pous/sub/deeper/fb_deep.pou"));   // case-insensitive, as every identity
        Assert.Null(ItemLookup.Find(ide, "FB_Deep.pou"));
        Assert.Null(ItemLookup.Find(ide, "POUs/Sub/FB_Deep.pou"));
    }

    /// <summary>Two items of one name in two folders — two applications' <c>PLC_PRG</c> — are found each by its own
    /// path, never one for the other.</summary>
    [Fact]
    public void F_two_items_of_one_name_are_found_each_in_its_own_folder()
    {
        var ide = Ide(Pou("PLC_PRG", folder: "Device/Plc Logic/Application") with { Implementation = "a := 1;" },
                      Pou("PLC_PRG", folder: "Device_1/Plc Logic/Application") with { Implementation = "b := 2;" });

        var a = ItemLookup.Find(ide, "Device/Plc Logic/Application/PLC_PRG.pou");
        var b = ItemLookup.Find(ide, "Device_1/Plc Logic/Application/PLC_PRG.pou");

        Assert.Equal("a := 1;", ide.ReadContent(a!.Value).Body);
        Assert.Equal("b := 2;", ide.ReadContent(b!.Value).Body);
    }

    /// <summary>The other CODESYS bug. A POU's METHOD is not a top-level item, and the only caller asks "does an
    /// item by this name already exist" before creating one. Matching any node meant a method named `Go` could
    /// answer for a POU named `Go` — and the push would then treat the method as the item it was updating.</summary>
    [Fact]
    public void D_a_POU_member_is_not_a_top_level_item()
    {
        var ide = Ide(
            new FakeIde.Item("FB_Host", ItemKind.PlcPou, "", true, "FUNCTION_BLOCK FB_Host", "", null, null,
                Children: new[] { "Go" }),
            new FakeIde.Item("Go", ItemKind.PlcMethod, "", false, "METHOD Go : BOOL", "", null, null));

        Assert.Null(ItemLookup.Find(ide, "Go.pou"));
    }

    /// <summary>A folder that happens to share an item's name is not that item either. Same rule as the member
    /// case — only the six CRUD kinds answer — and it is what lets the walk keep descending past one.</summary>
    [Fact]
    public void E_a_folder_is_not_an_item()
    {
        var ide = Ide(Pou("Inner", folder: "Motor"));

        Assert.Null(ItemLookup.Find(ide, "Motor.pou"));
        Assert.NotNull(ItemLookup.Find(ide, "Motor/Inner.pou"));
    }

    /// <summary>The KIND is part of the identity (openspec <c>unreadable-name-carries-kind</c> 1.7): <c>X.dut</c> is not
    /// the POU <c>X</c>, and a push op naming it must not land on that object.</summary>
    [Fact]
    public void G_the_kind_is_part_of_the_path()
    {
        var ide = Ide(Pou("X", folder: "Data"));

        Assert.NotNull(ItemLookup.Find(ide, "Data/X.pou"));
        Assert.Null(ItemLookup.Find(ide, "Data/X.dut"));
        Assert.Null(ItemLookup.Find(ide, "Data/X.gvl"));
    }
}
