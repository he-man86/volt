using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// AN UNCONDITIONAL JUMP, DRAWN BY HAND IN XAE — the shape Volt cannot create, so no fixture had ever held one.
///
/// <para>`drawn-refused-shapes.TcPOU` was drawn in a live TcXaeShell because `volt push` refuses the shape: the
/// TwinCAT driver's only create door is `PlcOpenImport` (D22), and that importer requires a jump to be wired to
/// a condition. The CODESYS driver has no such limit because it builds LIVE NWL objects in-process
/// (`NwlInterop`, `CodesysNetworkWriter`) — N1 says the object model is identical on both vendors, so the gap
/// is Volt's HOST, not the vendor. This fixture is what a hand-drawn one actually looks like.</para>
///
/// <para>It earned its place immediately, with a read-side loss nothing could have found without it.</para>
/// </summary>
public class TcDrawnJumpTests
{
    private static XElement Impl() =>
        XDocument.Load(Fixtures.Path("tc-pou", "drawn-refused-shapes.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single()
            .DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");

    private static string PulledText() => NetworkTextWriter.Write(TcNetworkReader.Read(Impl(), BodyLanguage.Ld));

    /// <summary>THE SHAPE ITSELF: the jump's input is a `BoxTreeTerminator` with an explicit null `Input`, and
    /// the destination operand carries `Flags = 4`. A CONDITIONAL jump is the same item with the RValue element
    /// typed `BoxTreeOperand` instead — measured against one Volt created on the same live XAE, where that
    /// element swap is the ONLY structural difference between the two. Which is what makes the refusal worth
    /// re-costing: `WriteNode`'s default arm refuses it ("a 'BoxTreeOperand' item becomes a terminator") and the
    /// replacement needs no INVENTED id (N11's wall), because it can reuse the id of the element it replaces.</summary>
    [Fact]
    public void An_unconditional_jump_holds_a_terminator_where_a_conditional_one_holds_an_operand()
    {
        // The item's type is on the LIST (`cet`), not on the child `<o>` — the archive names a type once for a
        // homogeneous list (N11). Selecting by `t` here finds nothing at all.
        var items = Impl().Descendants("l2").First(l => (string?)l.Attribute("cet") == "BoxTreeAssign");
        var assign = items.Elements("o").First();
        var rvalue = assign.Elements("o").First(o => (string?)o.Attribute("n") == "RValue");

        Assert.Equal("BoxTreeTerminator", (string?)rvalue.Attribute("t"));
        Assert.Contains(rvalue.Elements("n"), n => (string?)n.Attribute("n") == "Input");   // nothing drives it
        Assert.Contains("\"owrods\"", assign.ToString());
    }

    /// <summary>CENSUS 1.4 AND 1.10, the parity twin of CODESYS's reader test: a terminator carrying an input occurs in
    /// no measured project, so the model has no field for one and the reader refuses it by name. The drawn jump's
    /// terminator is given the operand the conditional jump holds, the one structural difference that shape needs.</summary>
    [Fact]
    public void A_terminator_with_an_input_is_refused_by_name()
    {
        var impl = Impl();
        var rvalues = impl.Descendants("o").Where(o => (string?)o.Attribute("n") == "RValue").ToList();
        var terminator = rvalues.First(o => (string?)o.Attribute("t") == "BoxTreeTerminator");
        var operand = new XElement(rvalues.First(o => (string?)o.Attribute("t") == "BoxTreeOperand"));
        operand.SetAttributeValue("n", "Input");
        terminator.Elements("n").Single(n => (string?)n.Attribute("n") == "Input").ReplaceWith(operand);

        var ex = Assert.Throws<Volt.Engine.Format.Body.UnrepresentableBodyException>(() => TcNetworkReader.Read(impl, BodyLanguage.Ld));
        Assert.Equal("a terminator with an input", ex.Marker);
    }

    /// <summary>CENSUS 1.2 AND 1.10: "unconnected" is the empty terminator, never a null value, so an assignment
    /// the archive gives no RValue is refused by name.</summary>
    [Fact]
    public void An_assignment_holding_no_value_is_refused_by_name()
    {
        var impl = Impl();
        impl.Descendants("o").First(o => (string?)o.Attribute("n") == "RValue")
            .ReplaceWith(new XElement("n", new XAttribute("n", "RValue")));

        var ex = Assert.Throws<Volt.Engine.Format.Body.UnrepresentableBodyException>(() => TcNetworkReader.Read(impl, BodyLanguage.Ld));
        Assert.Equal("an assignment with no value", ex.Marker);
    }

    /// <summary>And Volt reads the jump — the half that already worked.</summary>
    [Fact]
    public void The_jump_survives_the_read()
    {
        Assert.Contains("JMP owrods", PulledText());
    }

    // THE LOSS THIS FIXTURE FOUND, and it is on the READ side.
    //
    // The drawn rung drives TWO outputs from the same terminator: the jump destination `owrods` (`Flags = 4`)
    // and an ordinary coil `out` (`Flags = 0`). `NetworkTextWriter.Goto` renders `"JMP " + a.Targets[0].Text`
    // and drops every other target, so the pulled text is `JMP owrods;` and the coil is absent from the
    // engineer's file. The fixed point HIDES it: the text round-trips to itself, so every no-op push is clean
    // and nothing ever asks where `out` went.
    //
    // The assertion that catches it is written and RED, and it is held in
    // `openspec/changes/graphical-vendor-parity-map` (task 1) rather than committed red — because the fix is
    // not the assertion, it is a TEXT FORM for a rung driving a coil and a jump together that reads back as
    // ONE item. It comes back here with that form.
    //
    // It could not have been found from a Volt-created body, because Volt cannot create this shape at all.
}
