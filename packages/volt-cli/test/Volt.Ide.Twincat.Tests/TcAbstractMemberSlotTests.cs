using System.Linq;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A TWINCAT ABSTRACT MEMBER HAS A BODY SLOT, SO IT KEEPS <c>IMPLEMENTATION ST</c> (openspec <c>abstract-member-push</c>,
/// DIALECT C2n) — the stand-in for a TwinCAT twin of <c>CodesysAbstractMemberPushTests</c>, which would assert a refusal
/// that cannot happen here.
///
/// <para>Measured (<c>vendor-facts</c> <c>abstract-member-slot</c>, 2026-10-11): on a <c>FUNCTION_BLOCK ABSTRACT</c>, a
/// <c>METHOD ABSTRACT</c> (609) and a <c>PROPERTY ABSTRACT</c>'s GET (613) expose <c>ImplementationText</c> <c>""</c>, and
/// the saved <c>.TcPOU</c> holds an empty <c>&lt;ST&gt;</c> under each. CODESYS states <c>IMPLEMENTATION NONE</c> only for
/// an object that holds no <c>Implementation</c> aspect; TwinCAT never states it, so its pulled text stays
/// <c>IMPLEMENTATION ST</c> with nothing under it — and that text pushes back (measured accepted, both lines landed).</para>
/// </summary>
public class TcAbstractMemberSlotTests
{
    [Fact]
    public void An_abstract_method_and_an_abstract_propertys_GET_pull_as_IMPLEMENTATION_ST_never_NONE()
    {
        var getter = new TcHiddenBodyWriteTests.Node("Get", ItemKind.PlcPropGet, "VAR\nEND_VAR", "");
        var pou = new TcHiddenBodyWriteTests.Node("VltA_PushBase", ItemKind.PlcPou,
            "FUNCTION_BLOCK ABSTRACT VltA_PushBase\nVAR\nEND_VAR", "",
            new TcHiddenBodyWriteTests.Node("Pick", ItemKind.PlcMethod, "METHOD ABSTRACT Pick : INT", ""),
            new TcHiddenBodyWriteTests.Node("Busy", ItemKind.PlcProp, "PROPERTY ABSTRACT Busy : BOOL", "", getter));

        var content = TcUntouchablePouTests.BoundDriver().ReadContent(new ItemRef(pou));
        var text = StWriter.Write(content);

        Assert.DoesNotContain(ImplementationMarker.NoneLine, text);
        Assert.Contains("METHOD ABSTRACT Pick : INT\nIMPLEMENTATION ST\n", text);
        Assert.Contains("GET\nVAR\nEND_VAR\nIMPLEMENTATION ST\n", text);
        Assert.Null(content.Members.Single(m => m.Name == "Pick").Stated);                 // an empty body: a slot holding nothing
        Assert.Null(content.Members.Single(m => m.Name == "Busy").Getter?.Stated);
    }
}
