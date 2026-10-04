using System.Linq;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Engine.Tests.Format.St;

/// <summary>
/// A KIND WITH NO BODY SLOT CARRIES NO BODY — null, not "" (openspec <c>bridge-refusal-review</c> D26).
///
/// <para>Both drivers now refuse a text sent at a slot the OBJECT lacks, instead of dropping it, and ask no kind table.
/// That holds only while the reader sends nothing for a slot the kind has not: it sent <c>""</c> for a GVL, a DUT, an
/// interface, an interface member and a property — "" is a body value (it CLEARS a POU's body), so a driver asking the
/// object would refuse every GVL push. The producer is fixed, not a driver table.</para>
/// </summary>
public class NoBodySlotIsNullTests
{
    [Theory]
    [InlineData(ItemKind.Kinds.Gvl, "VAR_GLOBAL\n\tg : INT;\nEND_VAR")]
    [InlineData(ItemKind.Kinds.Dut, "TYPE T :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE")]
    public void A_declaration_only_kind_has_no_body(string kind, string text) =>
        Assert.Null(StReader.Read(text, kind).Body);

    [Fact]
    public void An_interface_and_its_members_have_no_body()
    {
        var item = StReader.Read(
            "INTERFACE I_A\nMETHOD Run : BOOL\nEND_METHOD\nPROPERTY Ready : BOOL\nGET\nEND_GET\nEND_PROPERTY\nEND_INTERFACE",
            ItemKind.Kinds.Interface);

        Assert.Null(item.Body);
        Assert.Equal(2, item.Members.Count);
        Assert.All(item.Members, m => Assert.Null(m.Body));
    }

    [Fact]
    public void A_property_has_no_body_its_accessors_do()
    {
        var item = StReader.Read(
            "FUNCTION_BLOCK FB_A\nVAR\nEND_VAR\nIMPLEMENTATION ST\nEND_FUNCTION_BLOCK\n\nPROPERTY Ready : BOOL\nGET\nIMPLEMENTATION ST\nReady := TRUE;\nEND_GET\nEND_PROPERTY",
            ItemKind.Kinds.Pou);

        var ready = item.Members.Single();
        Assert.Equal(ItemKind.Kinds.Property, ready.Kind);
        Assert.Null(ready.Body);
        Assert.Equal("Ready := TRUE;", ready.Getter!.Body);
    }
}
