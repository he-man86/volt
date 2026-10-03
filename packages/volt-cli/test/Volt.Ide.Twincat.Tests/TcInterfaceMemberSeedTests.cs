using System;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// TWINCAT CREATES AN INTERFACE MEMBER WITH ITS TYPE AS THE CREATE ARGUMENT, SO ONE WITH NO TYPE IS REFUSED BY THE DRIVER
/// (openspec <c>bridge-refusal-review</c> 2.4, 2.6).
///
/// <para><c>CreateChild</c>'s <c>vInfo</c> is the interface method's return type or the interface property's data type
/// (<c>TcObjectModel.CreateChild</c>, the Beckhoff sample's <c>BuildChildVInfo</c>); a property created with a null
/// one fails inside TcXaeShell with "Object reference not set to an instance of an object" (<c>IProjectTree</c>). The
/// ST reader used to refuse every member line with nothing after its <c>:</c> and every property with no type, on both
/// vendors, for this one TwinCAT create — a check on the code everywhere else, where the IDE's build reports it. The
/// rule lives where the fact is: this driver, before the IDE is touched, naming the member. An untyped interface METHOD
/// (no colon at all) is created with a null <c>vInfo</c>, as before.</para>
/// </summary>
public class TcInterfaceMemberSeedTests
{
    private static BeckhoffDriver Driver() => new(new TcObjectModel());

    [Theory]
    [InlineData(ItemKind.PlcItfProp, null)]
    [InlineData(ItemKind.PlcItfProp, "")]
    [InlineData(ItemKind.PlcItfProp, "  ")]
    [InlineData(ItemKind.PlcItfMeth, "")]
    public void An_interface_member_with_no_type_is_refused_by_name_before_the_IDE_is_touched(int kindCode, string? seed)
    {
        // The parent is no tree item: reaching TcObjectModel at all would fail on it, so a refusal that names the
        // member proves nothing was asked of the IDE.
        var ex = Assert.Throws<NotSupportedException>(() =>
            Driver().CreateChild(new ItemRef(new object()), "Speed", kindCode, seed));

        Assert.Contains("'Speed'", ex.Message);
        Assert.Contains("type", ex.Message);
    }

    /// <summary>The push pre-flight asks the SAME predicate (<c>ICodeStore.RefusedMemberCreate</c>), so a push carrying such a
    /// member is refused before its batch's first write instead of from inside the apply loop (1+2d review).</summary>
    [Theory]
    [InlineData(ItemKind.Kinds.InterfaceProperty, null, true)]
    [InlineData(ItemKind.Kinds.InterfaceProperty, " ", true)]
    [InlineData(ItemKind.Kinds.InterfaceMethod, "", true)]
    [InlineData(ItemKind.Kinds.InterfaceMethod, null, false)]
    [InlineData(ItemKind.Kinds.InterfaceProperty, "INT", false)]
    [InlineData(ItemKind.Kinds.Property, null, false)]
    public void The_pre_flight_asks_the_same_predicate(string kind, string? seed, bool refused)
    {
        var why = Driver().RefusedMemberCreate(kind, "Speed", seed);
        Assert.Equal(refused, why is not null);
        if (refused) Assert.Contains("'Speed'", why);
    }
}
