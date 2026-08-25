using Xunit;
using Volt.Engine.Vocabulary;

namespace Volt.Cli.Tests;

/// <summary>
/// TwinCAT's DUT tree codes. A DUT is ONE wire kind (<c>dut</c>, one <c>.dut</c> extension) but FOUR tree codes on
/// that vendor, and for a long time only one of them was mapped.
/// <para><b>The bug this pins was silent data loss.</b> <c>ItemKind</c> asserted that 605/606/607 — the
/// enum/struct/union subtypes — were "never produced, never needed". They are: a DUT authored in the TwinCAT IDE
/// carries its SUBTYPE code, not the generic 623 that <c>CreateChild</c> accepts, and a DUT re-created from
/// TwinCAT's own item archive comes back as one too. An unmapped code is emitted by the walk and then dropped by
/// Core, so those items never reached <c>refs</c> or <c>fetch</c> — and to a pull, absent means DELETED.</para>
/// <para>Measured two independent ways: the committed <c>TwinCAT Project14</c> fixture's hand-authored enum
/// <c>E_PackML_Mode</c> has always walked as 605, and moving a struct DUT turns 623 into 606.</para>
/// </summary>
public class DutSubtypeCodeTests
{
    /// <summary>All four codes are the ONE wire kind. The wire never learns that TwinCAT splits them — that is
    /// what "a DUT is one kind" means, and it is preserved by mapping rather than by pretending.</summary>
    [Theory]
    [InlineData(ItemKind.PlcDut)]        // 623 — the generic code CreateChild takes
    [InlineData(ItemKind.PlcDutEnum)]    // 605 — E_PackML_Mode, live fixture
    [InlineData(ItemKind.PlcDutStruct)]  // 606 — what a moved struct comes back as
    [InlineData(ItemKind.PlcDutUnion)]   // 607
    public void Every_dut_tree_code_maps_to_the_one_dut_wire_kind(int code) =>
        Assert.Equal(ItemKind.Kinds.Dut, ItemKind.Map(code));

    /// <summary>And each is a top-level source item, so the walk emits it as a file rather than descending it.
    /// Mapping without this would put the item on the wire and then mis-shape it.</summary>
    [Theory]
    [InlineData(ItemKind.PlcDut)]
    [InlineData(ItemKind.PlcDutEnum)]
    [InlineData(ItemKind.PlcDutStruct)]
    [InlineData(ItemKind.PlcDutUnion)]
    public void Every_dut_tree_code_is_top_level_crud(int code) =>
        Assert.True(ItemKind.IsTopLevelCrud(code));
}
