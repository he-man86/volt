using System.Collections.Generic;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Seam;
using Volt.Engine.Sync;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A KIND THE CREATE TABLE DOES NOT MAP IS VOLT'S BUG (openspec <c>bridge-refusal-review</c> 2.17/2.18).
///
/// <para>The push creates by the KIND its host declared (a registry string); a host whose tree answers the IEC codes
/// creates it as the one code each kind is created as (<c>ItemKind.CreateCode</c>). A kind missing from that table is a table gap — INTERNAL_ERROR, never BAD_REQUEST, which would tell a client its request was
/// malformed.</para>
/// </summary>
public class PushKindInvariantTests
{
    /// <summary>The code the double was asked to create <paramref name="kind"/> as, through its contract create.</summary>
    private static int CreatedAs(string kind)
    {
        var codes = new Dictionary<string, int>();
        var ide = new FakeIde { FailCreate = (name, code) => { codes[name] = code; return null; } };
        var driver = HostLink.Of(ide).Driver;
        driver.CreateChild(driver.Root, "X", kind, CreateArgs.None);
        return codes["X"];
    }

    [Theory]
    [InlineData("")]
    [InlineData(ItemKind.Kinds.Library)]
    public void An_unmapped_kind_is_an_internal_error(string kind)
    {
        var ex = Assert.Throws<BridgeException>(() => CreatedAs(kind));
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
        Assert.Equal(code, CreatedAs(kind));
}
