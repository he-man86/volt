using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A TWINCAT ABSTRACT MEMBER HAS A BODY SLOT (openspec <c>language-line</c>, DIALECT C2n) — the TwinCAT twin of
/// <c>CodesysAbstractMemberPushTests</c>.
///
/// <para>Measured (<c>vendor-facts</c> <c>abstract-member-slot</c> / <c>abstract-member-code</c>, 2026-10-11): a
/// <c>METHOD ABSTRACT</c> (609) and a <c>PROPERTY ABSTRACT</c>'s GET (613) and SET (614) expose <c>ImplementationText</c>
/// <c>""</c> — a slot holding nothing — and an empty body written there persists across save/reopen. So it pulls as every
/// empty body with a slot does, <c>%LANGUAGE ST</c> with nothing under it; only a member with NO slot (CODESYS's
/// <c>AbstractPOUMethodObject</c>) has no line.</para>
/// </summary>
public class TcAbstractMemberSlotTests
{
    [Fact]
    public void An_abstract_method_and_an_abstract_propertys_GET_pull_with_an_empty_ST_body()
    {
        var getter = new TcHiddenBodyWriteTests.Node("Get", ItemKind.PlcPropGet, "VAR\nEND_VAR", "");
        var pou = new TcHiddenBodyWriteTests.Node("VltA_PushBase", ItemKind.PlcPou,
            "FUNCTION_BLOCK ABSTRACT VltA_PushBase\nVAR\nEND_VAR", "",
            new TcHiddenBodyWriteTests.Node("Pick", ItemKind.PlcMethod, "METHOD ABSTRACT Pick : INT", ""),
            new TcHiddenBodyWriteTests.Node("Busy", ItemKind.PlcProp, "PROPERTY ABSTRACT Busy : BOOL", "", getter));

        var content = TcUntouchablePouTests.BoundDriver().ReadContent(TcRefs.Ref(pou));
        Assert.Null(content.Members.Single(m => m.Name == "Pick").Stated);                 // the driver's storage fact: an empty body
        Assert.Null(content.Members.Single(m => m.Name == "Busy").Getter?.Stated);

        var text = StWriter.Write(content);

        Assert.Contains("METHOD ABSTRACT Pick : INT\n%LANGUAGE ST\nEND_METHOD", text);
        Assert.Contains("GET\nVAR\nEND_VAR\n%LANGUAGE ST\nEND_GET", text);
        Assert.Contains("FUNCTION_BLOCK ABSTRACT VltA_PushBase\nVAR\nEND_VAR\n%LANGUAGE ST\n", text);   // no member site
    }

    /// <summary>An empty ST body over an abstract method and GET holding code: <c>""</c> is written at each slot — what
    /// 1.2 measured persists and pulls back unchanged.</summary>
    [Fact]
    public void An_empty_body_over_an_abstract_method_and_GET_holding_code_is_written_empty()
    {
        var getter = new TcHiddenBodyWriteTests.Node("Get", ItemKind.PlcPropGet, "VAR\nEND_VAR", "Busy := TRUE;");
        var method = new TcHiddenBodyWriteTests.Node("Pick", ItemKind.PlcMethod, "METHOD ABSTRACT Pick : INT", "Pick := 1;");
        var pou = new TcHiddenBodyWriteTests.Node("VltA_PushBase", ItemKind.PlcPou,
            "FUNCTION_BLOCK ABSTRACT VltA_PushBase\nVAR\nEND_VAR", "x := 1;",
            method, new TcHiddenBodyWriteTests.Node("Busy", ItemKind.PlcProp, "PROPERTY ABSTRACT Busy : BOOL", "", getter));

        TcUntouchablePouTests.BoundDriver().WriteContent(TcRefs.Ref(pou),
            new ItemContent(ItemKind.Kinds.Pou, "FUNCTION_BLOCK ABSTRACT VltA_PushBase\nVAR\nEND_VAR", null, new List<Member>
            {
                new(ItemKind.Kinds.Method, "Pick", "METHOD ABSTRACT Pick : INT", "", ObjectProperties.None,
                    Stated: StatedLanguage.St),
                new(ItemKind.Kinds.Property, "Busy", "PROPERTY ABSTRACT Busy : BOOL", null, ObjectProperties.None,
                    Getter: new Accessor("VAR\nEND_VAR", "", Stated: StatedLanguage.St)),
            }, ObjectProperties.None), System.Array.Empty<Volt.Engine.Ide.PushedNetworkBody>());

        Assert.Equal("", method.ImplementationText);
        Assert.Equal("", getter.ImplementationText);
        Assert.Equal("x := 1;", pou.ImplementationText);                                    // the item body was not sent
    }

    /// <summary>A null member or accessor body is "leave it alone" — the push drops an unchanged body
    /// (<c>PushService.OnlyChanged</c>) and the declaration is written alone.</summary>
    [Fact]
    public void A_null_member_and_accessor_body_is_left_alone()
    {
        var getter = new TcHiddenBodyWriteTests.Node("Get", ItemKind.PlcPropGet, "VAR\nEND_VAR", "Busy := TRUE;");
        var method = new TcHiddenBodyWriteTests.Node("Run", ItemKind.PlcMethod, "METHOD Run : BOOL", "Run := TRUE;");
        var pou = new TcHiddenBodyWriteTests.Node("FB", ItemKind.PlcPou, "FUNCTION_BLOCK FB", "",
            method, new TcHiddenBodyWriteTests.Node("Busy", ItemKind.PlcProp, "PROPERTY Busy : BOOL", "", getter));

        TcUntouchablePouTests.BoundDriver().WriteContent(TcRefs.Ref(pou),
            new ItemContent(ItemKind.Kinds.Pou, "FUNCTION_BLOCK FB", null, new List<Member>
            {
                new(ItemKind.Kinds.Method, "Run", "METHOD Run : BOOL\n// edited", null, ObjectProperties.None),
                new(ItemKind.Kinds.Property, "Busy", "PROPERTY Busy : BOOL", null, ObjectProperties.None, Getter: new Accessor("VAR\n// edited\nEND_VAR", null)),
            }, ObjectProperties.None), System.Array.Empty<Volt.Engine.Ide.PushedNetworkBody>());

        Assert.Equal("Run := TRUE;", method.ImplementationText);
        Assert.Equal(0, method.ImplementationWrites);
        Assert.Contains("// edited", method.DeclarationText);
        Assert.Equal("Busy := TRUE;", getter.ImplementationText);
        Assert.Equal(0, getter.ImplementationWrites);
        Assert.Contains("// edited", getter.DeclarationText);
    }
}
