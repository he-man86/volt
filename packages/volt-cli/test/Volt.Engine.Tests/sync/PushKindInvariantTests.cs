using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A TOP-LEVEL KIND THE CREATE TABLE DOES NOT MAP IS VOLT'S BUG (openspec <c>bridge-refusal-review</c> 2.17).
///
/// <para>The push reaches the create table only with a kind the pre-flight admitted (a wire name whose extension names
/// a kind, never a read-only descriptor or a task), so a kind missing from it is a table gap — a new kind added to
/// <see cref="ItemKind"/> and forgotten here. It answered BAD_REQUEST, which tells a client its request was malformed;
/// it answers INTERNAL_ERROR. Its member twin is <see cref="ItemKind.MemberCode"/> (2.18, <c>ItemKindTests</c>).</para>
/// </summary>
public class PushKindInvariantTests
{
    [Theory]
    [InlineData(ItemKind.Kinds.Method)]
    [InlineData(ItemKind.Kinds.Task)]
    [InlineData("")]
    public void An_unmapped_top_level_kind_is_an_internal_error(string kind)
    {
        var ex = Assert.Throws<BridgeException>(() => PushService.PouKindToCode(kind));
        Assert.Equal(BridgeErrorCodes.InternalError, ex.ErrorCode);
    }

    [Theory]
    [InlineData(ItemKind.Kinds.Pou, ItemKind.PlcPou)]
    [InlineData(ItemKind.Kinds.Dut, ItemKind.PlcDut)]
    [InlineData(ItemKind.Kinds.Gvl, ItemKind.PlcGvl)]
    [InlineData(ItemKind.Kinds.Interface, ItemKind.PlcItf)]
    public void Every_source_kind_has_its_create_code(string kind, int code) =>
        Assert.Equal(code, PushService.PouKindToCode(kind));
}
