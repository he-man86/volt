using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// A BOX'S LISTS ARE READ BY SLOT, AND A LIST THE BOX DOES NOT ANSWER IS REFUSED BY NAME — never read as an empty one.
/// The parity twins of TwinCAT's <c>TcBoxSlotTests</c>; one object model (DIALECT N1), one refusal each, from
/// <see cref="BoxRefusals"/>.
/// </summary>
public class CodesysBoxSlotTests
{
    private static Network Read(Nwl.BoxTreeBox box)
    {
        var assign = new Nwl.BoxTreeAssign { RValue = box };
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out", IsLValue = true });
        return CodesysNetworkReader.ReadNetwork(new Nwl.Network().With(assign), 0);
    }

    private static UnrepresentableBodyException Refused(Nwl.BoxTreeBox box) =>
        Assert.Throws<UnrepresentableBodyException>(() => Read(box));

    /// <summary>A NULL INPUT SLOT is refused under its OWN name. The null used to be dropped by <c>NwlInterop.Items</c>
    /// while the pin-flag list kept its entry, so the length check fired and the pull was refused as "a flag on a box
    /// input pin" — the right answer by accident, under a name that sent the engineer looking for a negation; TwinCAT,
    /// with no length to check, read the shifted slots silently.</summary>
    [Fact]
    public void A_null_input_slot_is_refused_by_its_own_name()
    {
        var ex = Refused(new Nwl.BoxTreeBox
        {
            BoxType = "TON",
            InputItemList = new object[] { null!, Nwl.Leaf("pt") },
            InputParams = new Nwl.ParamList { Names = new[] { "IN", "PT" }, Types = new[] { "BOOL", "TIME" } },
        });

        Assert.Equal(BoxRefusals.NullInputSlotMarker, ex.Marker);
        Assert.Contains("'TON'", ex.Message);
    }

    /// <summary>AN OUTPUT HOLDER WITH NO LIST is not a box with no outputs: read as empty, every <c>=&gt; v</c> on the
    /// box was dropped without a word — the same "missing list read as empty" the pin-flag fix removed.</summary>
    [Fact]
    public void A_box_whose_output_holder_has_no_list_is_refused_by_name()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "TON",
            InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("pt") },
            InputParams = new Nwl.ParamList { Names = new[] { "IN", "PT" }, Types = new[] { "BOOL", "TIME" } },
            Outputs = Nwl.OutputItemList.WithoutList(),
        };

        var ex = Refused(box);
        Assert.Equal(BoxRefusals.MissingListMarker, ex.Marker);
        Assert.Contains("Outputs", ex.Message);
    }

    /// <summary>A BOX WITHOUT ITS PIN NAMES is refused: the names decide whether slot 0 is the enable. Read as "no
    /// names", <c>MOVE(EN := en1, a)</c> pulled as <c>MOVE(en1, a)</c> — the enable a data pin, and two different boxes
    /// one text. An operator's EMPTY <c>Names</c> is a real answer and still reads.</summary>
    [Theory]
    [InlineData("InputParams")]
    [InlineData("OutputParams")]
    public void A_box_without_its_pin_names_is_refused_by_name(string member)
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "MOVE",
            InputItemList = new object[] { Nwl.Leaf("en1"), Nwl.Leaf("a") },
            InputParams = new Nwl.ParamList { Names = new[] { "EN", "IN" }, Types = new[] { "BOOL", "INT" } },
        };
        if (member == "InputParams") box.InputParams = null;
        else box.OutputParams = null;

        var ex = Refused(box);
        Assert.Equal(BoxRefusals.MissingListMarker, ex.Marker);
        Assert.Contains(member, ex.Message);
    }

    [Fact]
    public void An_operators_empty_name_lists_still_read()
    {
        var read = Read(new Nwl.BoxTreeBox { BoxType = "AND", InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("b") } });
        Assert.Equal(2, Assert.IsType<Box>(Assert.IsType<Assign>(Assert.Single(read.Trees)).Value).Inputs.Count);
    }
}
