using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A BOX'S LISTS ARE READ BY SLOT, AND A LIST THE ARCHIVE DOES NOT HOLD IS REFUSED BY NAME — never read as an empty
/// one. The parity twins of CODESYS's <c>CodesysBoxSlotTests</c>; one object model (DIALECT N1), one refusal each, from
/// <see cref="BoxRefusals"/>.
///
/// <para>Each of these was a pull that succeeded with a different program: a null input slot dropped by the compacting
/// accessor moved every later pin onto its neighbour's name (or a data pin onto the enable); a missing output list read
/// as "no outputs" lost every <c>=&gt; v</c>; a missing pin-name list read as "no names" turned a wired EN into a
/// positional data pin.</para>
/// </summary>
public class TcBoxSlotTests
{
    private static XElement Impl(string fixture)
    {
        var doc = XDocument.Load(Fixtures.Path("tc-pou", fixture), LoadOptions.PreserveWhitespace);
        return doc.Descendants("NWL").Single()
            .DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");
    }

    private static bool Named(XElement e, string n) => (string?)e.Attribute("n") == n;

    /// <summary>The first box of the fixture whose type is <paramref name="type"/> (the TON in both fixtures here).</summary>
    private static XElement BoxOf(XElement impl, string type) =>
        impl.Descendants("o").First(o => o.Elements("v").Any(v => Named(v, "BoxType") && v.Value == $"\"{type}\""));

    private static UnrepresentableBodyException Refused(XElement impl) =>
        Assert.Throws<UnrepresentableBodyException>(() => TcNetworkReader.Read(impl, BodyLanguage.Fbd));

    /// <summary>A NULL INPUT SLOT (<c>&lt;n /&gt;</c>, the archive's spelling of a null list slot — the ENO echo is one)
    /// is not skipped: the slots are index-aligned with <c>InputParam/Names</c>, and compacting it away read the TON's
    /// <c>PT</c> operand as <c>IN</c> and lost <c>PT</c>, with no error. No measured box holds one, so it is refused.</summary>
    [Fact]
    public void A_null_input_slot_is_refused_by_name_not_compacted_away()
    {
        var impl = Impl("FbCall.derived.TcPOU");
        var inputs = BoxOf(impl, "TON").Elements("l2").Single(l => Named(l, "InputItems"));
        inputs.Elements("o").First().ReplaceWith(new XElement("n"));

        var ex = Refused(impl);
        Assert.Equal(BoxRefusals.NullInputSlotMarker, ex.Marker);
        Assert.Contains("'TON'", ex.Message);
    }

    /// <summary>A BOX WHOSE OUTPUT LIST IS ABSENT is not a box with no outputs — the rule <c>Outputs()</c> already
    /// holds for an Assign's targets. Read as empty, the TON lost <c>=&gt; wiredPin</c>.</summary>
    [Fact]
    public void A_box_with_no_output_list_is_refused_by_name_not_read_as_no_outputs()
    {
        var impl = Impl("EnoSlot.derived.TcPOU");
        BoxOf(impl, "TON").Elements("o").Single(o => Named(o, "OutputItems")).Elements("l2").Single().Remove();

        var ex = Refused(impl);
        Assert.Equal(BoxRefusals.MissingListMarker, ex.Marker);
        Assert.Contains("OutputItems", ex.Message);
    }

    /// <summary>A BOX WITHOUT ITS PIN NAMES — no <c>InputParam</c>/<c>OutputParam</c>, or one without <c>Names</c> — is
    /// refused: the names decide whether slot 0 is the enable (and the ENO), and read as "none" a wired EN became a
    /// positional data pin and a named output the box's result. An operator's EMPTY list (<c>&lt;l2 n="Names" /&gt;</c>)
    /// is a real answer and still reads.</summary>
    [Theory]
    [InlineData("InputParam", false)]
    [InlineData("InputParam", true)]
    [InlineData("OutputParam", false)]
    [InlineData("OutputParam", true)]
    public void A_box_without_its_pin_names_is_refused_by_name(string member, bool namesOnly)
    {
        var impl = Impl("FbCall.derived.TcPOU");
        var param = BoxOf(impl, "TON").Elements("o").Single(o => Named(o, member));
        if (namesOnly) param.Elements("l2").Single(l => Named(l, "Names")).Remove();
        else param.Remove();

        var ex = Refused(impl);
        Assert.Equal(BoxRefusals.MissingListMarker, ex.Marker);
        Assert.Contains(member, ex.Message);
    }

    [Fact]
    public void An_operators_empty_name_list_still_reads()
    {
        Assert.NotEmpty(TcNetworkReader.Read(Impl("FbCall.derived.TcPOU"), BodyLanguage.Fbd).Networks);
    }
}
