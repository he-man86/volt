using Xunit;
using Volt.Engine.Ide;
using Volt.Engine.Vocabulary;
using Volt.Engine.Item;

namespace Volt.Cli.Tests;

/// <summary>
/// Finding a top-level item by name. There were TWO of these, one per driver, and they gave different answers —
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
        new(name, ItemKind.PlcPouFb, folder, true, $"FUNCTION_BLOCK {name}\nVAR\nEND_VAR", "", null, null);

    [Fact]
    public void A_finds_a_top_level_item_at_the_root()
    {
        var ide = Ide(Pou("FB_Motor"));

        Assert.NotNull(ItemLookup.Find(ide, "FB_Motor"));
        Assert.Null(ItemLookup.Find(ide, "FB_Absent"));
    }

    /// <summary>The CODESYS bug. IEC 61131-3 identifiers are case-insensitive, both IDEs treat them so, and the
    /// push's own item cache is keyed <c>OrdinalIgnoreCase</c> — so a case-sensitive lookup disagreed with the
    /// cache sitting one line above it. On a cache miss, pushing `fb_motor` at an IDE holding `FB_Motor` found
    /// nothing and went on to CREATE a second object.</summary>
    [Theory]
    [InlineData("fb_motor")]
    [InlineData("FB_MOTOR")]
    [InlineData("Fb_MoToR")]
    public void B_matching_is_case_insensitive(string queried)
    {
        var ide = Ide(Pou("FB_Motor"));

        Assert.NotNull(ItemLookup.Find(ide, queried));
    }

    /// <summary>Items nested in folders are found — the walk descends. TwinCAT's version recursed only into
    /// folders, which was right for its tree; CODESYS's structural spine (Device / Plc Logic / Application) is
    /// made of plain nodes, so "folders only" would have found nothing there at all.</summary>
    [Fact]
    public void C_finds_an_item_nested_in_folders()
    {
        var ide = Ide(Pou("FB_Deep", folder: "POUs/Sub/Deeper"));

        Assert.NotNull(ItemLookup.Find(ide, "FB_Deep"));
    }

    /// <summary>The other CODESYS bug. A POU's METHOD is not a top-level item, and the only caller asks "does an
    /// item by this name already exist" before creating one. Matching any node meant a method named `Go` could
    /// answer for a POU named `Go` — and the push would then treat the method as the item it was updating.</summary>
    [Fact]
    public void D_a_POU_member_is_not_a_top_level_item()
    {
        var ide = Ide(
            new FakeIde.Item("FB_Host", ItemKind.PlcPouFb, "", true, "FUNCTION_BLOCK FB_Host", "", null, null,
                Children: new[] { "Go" }),
            new FakeIde.Item("Go", ItemKind.PlcMethod, "", false, "METHOD Go : BOOL", "", null, null));

        Assert.Null(ItemLookup.Find(ide, "Go"));
    }

    /// <summary>A folder that happens to share an item's name is not that item either. Same rule as the member
    /// case — only the six CRUD kinds answer — and it is what lets the walk keep descending past one.</summary>
    [Fact]
    public void E_a_folder_is_not_an_item()
    {
        var ide = Ide(Pou("Inner", folder: "Motor"));

        Assert.Null(ItemLookup.Find(ide, "Motor"));
        Assert.NotNull(ItemLookup.Find(ide, "Inner"));
    }
}
