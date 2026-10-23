using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A KIND THE CREATE TABLE DOES NOT MAP IS VOLT'S BUG (openspec <c>bridge-refusal-review</c> 2.17/2.18).
///
/// <para>The push creates by the KIND its host declared (a registry string); an old-contract host is handed the one
/// numeric code each kind is created as by the adapter (<see cref="LegacyDriver"/>, volt-cli-rework step 5). A kind
/// missing from that table is a table gap — INTERNAL_ERROR, never BAD_REQUEST, which would tell a client its request was
/// malformed.</para>
/// </summary>
public class PushKindInvariantTests
{
    [Theory]
    [InlineData("")]
    [InlineData(ItemKind.Kinds.Library)]
    public void An_unmapped_kind_is_an_internal_error(string kind)
    {
        var ex = Assert.Throws<BridgeException>(() => LegacyDriver.CodeOf(kind));
        Assert.Equal(BridgeErrorCodes.InternalError, ex.ErrorCode);
    }

    [Theory]
    [InlineData(ItemKind.Kinds.Pou, ItemKind.PlcPou)]
    [InlineData(ItemKind.Kinds.Dut, ItemKind.PlcDut)]
    [InlineData(ItemKind.Kinds.Gvl, ItemKind.PlcGvl)]
    [InlineData(ItemKind.Kinds.Interface, ItemKind.PlcItf)]
    [InlineData(ItemKind.Kinds.Task, ItemKind.PlcTask)]
    [InlineData(ItemKind.Kinds.Method, ItemKind.PlcMethod)]
    [InlineData(ItemKind.Kinds.PropertyGet, ItemKind.PlcPropGet)]
    [InlineData(ItemKind.Kinds.InterfacePropertySet, ItemKind.PlcItfPropSet)]
    public void Every_creatable_kind_has_its_create_code(string kind, int code) =>
        Assert.Equal(code, LegacyDriver.CodeOf(kind));
}
