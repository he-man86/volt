using Volt.Engine.Item;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE TWINCAT DRIVER STATES A DUT'S SUBTYPE ON ITS CONTENT (openspec <c>push-without-header-check</c> 5.B.1): for a
/// DUT, whichever of its four tree codes it carries, <see cref="BeckhoffDriver.ReadContent"/> sets
/// <see cref="ItemContent.DutSubtype"/>, null where it has no answer (the engine then publishes <c>name.dut</c>), and
/// null for every other kind. Never from the tree code, which lags an in-place change (DIALECT C2e): a 606 holding an
/// enum answers <c>Enum</c>. INTERIM source (design 5.B choice 7): the engine's <c>CodeHelper.TryDutSubtype</c> until
/// 5.C's classifier — so these rows pin the contract, not the source. Driven through the driver over the plain node
/// <c>dynamic</c> binds to (<see cref="TcHiddenBodyWriteTests.Node"/>).
/// </summary>
[Collection(NetworkTextSwitchCollection.Name)]
public class TcDutSubtypeReadTests
{
    private static ItemContent Read(int code, string declaration) =>
        new BeckhoffDriver(new TcObjectModel()).ReadContent(new ItemRef(
            new TcHiddenBodyWriteTests.Node("X", code, declaration, "")));

    [Theory]
    [InlineData(ItemKind.PlcDutStruct, "TYPE X :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE", DutSubtype.Struct)]
    [InlineData(ItemKind.PlcDutStruct, "TYPE X :\n(\n\tA,\n\tB\n);\nEND_TYPE", DutSubtype.Enum)]   // the code lags
    [InlineData(ItemKind.PlcDutEnum, "TYPE X :\nUNION\n\tb : BYTE;\nEND_UNION\nEND_TYPE", DutSubtype.Union)]
    [InlineData(ItemKind.PlcDut, "TYPE X : STRING(80);\nEND_TYPE", DutSubtype.Alias)]
    public void A_dut_carries_its_subtype_whatever_its_tree_code(int code, string declaration, DutSubtype subtype)
    {
        var content = Read(code, declaration);

        Assert.Equal(ItemKind.Kinds.Dut, content.Kind);
        Assert.Equal(subtype, content.DutSubtype);
    }

    /// <summary>NO ANSWER IS NULL — never a guessed subtype, never a throw.</summary>
    [Theory]
    [InlineData("TYPE X :\n(* never closed\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE")]
    [InlineData("TYPE X :\nEND_TYPE")]
    [InlineData("")]
    public void A_dut_with_no_answer_reads_with_a_null_subtype(string declaration)
    {
        var content = Read(ItemKind.PlcDutStruct, declaration);

        Assert.Equal(ItemKind.Kinds.Dut, content.Kind);
        Assert.Null(content.DutSubtype);
    }

    [Fact]
    public void A_gvl_carries_no_subtype() =>
        Assert.Null(Read(ItemKind.PlcGvl, "TYPE X :\nSTRUCT\nEND_STRUCT\nEND_TYPE").DutSubtype);
}
