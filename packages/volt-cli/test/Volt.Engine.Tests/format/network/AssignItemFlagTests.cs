using Volt.Engine.Format.Network;
using Volt.Tests.Shared;
using Xunit;
using static Volt.Engine.Tests.NetworkModels;

namespace Volt.Engine.Tests.Format.Network;

/// <summary>
/// A FLAG ON THE ASSIGNMENT ITEM ITSELF (<c>BoxTreeAssign.Flags</c>) that no target carries has no position in the text —
/// the text's item flags are its targets' jump/return (the reader's <c>Flags.None.WithControlFlowFrom(targets)</c>). Found by
/// the NWL completeness gate (openspec <c>nwl-schema-completeness-gate</c> 3.2): the writer wrote <c>z := a;</c> for an item
/// holding Set, Jump or Return and read back a model without it — a silent loss. Now refused by name, the same name the
/// vendor readers give a negation or an edge on the item.
/// </summary>
public class AssignItemFlagTests
{
    [Theory]
    [InlineData("set")]
    [InlineData("jump")]
    [InlineData("return")]
    public void An_item_bit_no_target_carries_is_refused_by_name(string bit)
    {
        var item = bit switch { "set" => SetBit, "jump" => JumpBit, _ => ReturnBit };
        var body = Ld1(new Assign(L("a"), new[] { T("z") }, item));
        var ex = Assert.Throws<StNetworkUnspellableException>(() => StNetworkWriter.Write(body, NetworkModelScopes.ScopeOf(body)));
        Assert.Equal(UnheldFlags.AssignItemMarker, ex.Reason);
    }

    [Fact]
    public void An_item_jump_its_target_carries_is_the_jump()
    {
        var body = Ld1(new Assign(L("a"), new[] { T("l", JumpBit) }, JumpBit));
        Assert.Equal("%LANGUAGE LD\n%NETWORK\nASSIGN(a, Q => JMP.l);\n", StNetworkWriter.Write(body, NetworkModelScopes.ScopeOf(body)));
    }
}
