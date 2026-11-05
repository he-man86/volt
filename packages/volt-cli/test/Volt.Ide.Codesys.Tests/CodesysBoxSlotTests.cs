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

        Assert.Equal(BoxRefusals.NullInputSlotMarker, ex.Reason);
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
        Assert.Equal(BoxRefusals.MissingListMarker, ex.Reason);
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
        Assert.Equal(BoxRefusals.MissingListMarker, ex.Reason);
        Assert.Contains(member, ex.Message);
    }

    [Fact]
    public void An_operators_empty_name_lists_still_read()
    {
        var read = Read(new Nwl.BoxTreeBox { BoxType = "AND", InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("b") } });
        Assert.Equal(2, Assert.IsType<Box>(Assert.IsType<Assign>(Assert.Single(read.Trees)).Value).Inputs.Count);
    }

    /// <summary>A CONSUMED FB OR PROGRAM BOX WHOSE OUTPUT LIST HOLDS NO NULL HANDS NOTHING ON. Measured live (CODESYS 3.5.21.40,
    /// openspec nwl-box-storage-map, EN off and EN+ENO, LD and FBD): the IDE stores it and its build answers "The assignment
    /// source is incorrect." The slot-0 fallback read it as a call read by its first output, so the pull showed
    /// <c>y := t2(a := a).q1;</c>, which builds and assigns <c>y</c>: another program than the stored one on the next edit of
    /// that network. There is no main output to name, so the network is refused by name.</summary>
    [Theory]
    [InlineData("FunctionBlock", 0)]
    [InlineData("FunctionBlock", 2)]
    [InlineData("Program", 0)]
    [InlineData("Program", 2)]
    public void A_consumed_FB_or_program_box_holding_no_null_is_refused_by_name(string callType, int emptySlots)
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "Callee",
            CallType = (Nwl.Operator)System.Enum.Parse(typeof(Nwl.Operator), callType),
            InputItemList = new object[] { Nwl.Leaf("a") },
            InputParams = new Nwl.ParamList { Names = new[] { "a" }, Types = new[] { "BOOL" } },
            OutputParams = new Nwl.ParamList { Names = new[] { "q1", "q2" }, Types = new[] { "BOOL", "INT" } },
        };
        if (callType == "FunctionBlock") box.Instance = new Nwl.Operand { OperandExpr = "t2" };
        for (var i = 0; i < emptySlots; i++) box.Outputs.AppendOutputItem(new Nwl.Operand { OperandExpr = "" });

        var ex = Refused(box);

        Assert.Equal(BoxRefusals.NoMainOutputMarker, ex.Reason);
        Assert.Contains("'Callee'", ex.Message);
    }

    /// <summary>The ENO does not save it: a shown ENO over a list with no null fails the same way, measured with every list
    /// of the same run (<c>[]</c>, <c>['','','']</c>, <c>['z','','']</c>); it pulled as a clean <c>.ENO</c>.</summary>
    [Fact]
    public void A_consumed_FB_showing_ENO_and_holding_no_null_is_refused_by_name()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "Callee",
            CallType = Nwl.Operator.FunctionBlock,
            Instance = new Nwl.Operand { OperandExpr = "t2" },
            En = true,
            Eno = true,
            InputItemList = new object[] { Nwl.Leaf("go"), Nwl.Leaf("a") },
            InputParams = new Nwl.ParamList { Names = new[] { "EN", "a" }, Types = new[] { "BOOL", "BOOL" } },
            OutputParams = new Nwl.ParamList { Names = new[] { "ENO", "q1" }, Types = new[] { "BOOL", "BOOL" } },
        };
        box.Outputs.AppendOutputItem(new Nwl.Operand { OperandExpr = "z" });
        box.Outputs.AppendOutputItem(new Nwl.Operand { OperandExpr = "" });

        Assert.Equal(BoxRefusals.NoMainOutputMarker, Refused(box).Reason);
    }

    /// <summary>A consumed FUNCTION holding no null is another fact: the same run reads its value (<c>y := f(a);</c>), so it
    /// stays read by its value slot.</summary>
    [Fact]
    public void A_consumed_function_holding_no_null_is_still_read_by_its_value()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "F",
            CallType = Nwl.Operator.Function,
            InputItemList = new object[] { Nwl.Leaf("a") },
            InputParams = new Nwl.ParamList { Names = new[] { "a" }, Types = new[] { "BOOL" } },
            OutputParams = new Nwl.ParamList { Names = new[] { "   " }, Types = new[] { "BOOL" } },
        };
        box.Outputs.AppendOutputItem(new Nwl.Operand { OperandExpr = "" });

        Assert.Equal(0, Assert.IsType<Box>(Assert.IsType<Assign>(Assert.Single(Read(box).Trees)).Value).ConnectedSlot);
    }

    /// <summary>AN OPERATOR BOX WHOSE ONE OUTPUT SLOT HOLDS AN EMPTY OPERAND HAS NO TARGET AND NO VALUE TO HAND ON. Measured live
    /// (CODESYS 3.5.21.40, openspec nwl-box-storage-map, AND, GT, ADD, MOVE, at a root and consumed): the build answers "The
    /// assignment target is not specified." It pulled as the plain box, <c>y := AND(a, b);</c>, whose null slot builds and
    /// runs: the next edit of the network would make another program.</summary>
    [Theory]
    [InlineData("AND", "And")]
    [InlineData("MOVE", "Move")]
    [InlineData("GT", "Gt")]
    [InlineData("ADD", "Add")]
    public void An_operator_box_with_an_empty_output_slot_is_refused_by_name(string type, string callType)
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = type,
            CallType = (Nwl.Operator)System.Enum.Parse(typeof(Nwl.Operator), callType),
            InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("b") },
            OutputParams = new Nwl.ParamList { Names = new[] { "" }, Types = new[] { "BOOL" } },
        };
        box.Outputs.AppendOutputItem(new Nwl.Operand { OperandExpr = "" });

        var ex = Refused(box);

        Assert.Equal(BoxRefusals.EmptyOperatorOutputMarker, ex.Reason);
        Assert.Contains($"'{type}'", ex.Message);
    }

    /// <summary>A FUNCTION's empty result slot is another fact: it builds, and its consumer reads the function's value (the same
    /// run), so it stays read.</summary>
    [Fact]
    public void A_function_with_an_empty_output_slot_is_still_read()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "F",
            CallType = Nwl.Operator.Function,
            InputItemList = new object[] { Nwl.Leaf("a") },
            InputParams = new Nwl.ParamList { Names = new[] { "a" }, Types = new[] { "BOOL" } },
            OutputParams = new Nwl.ParamList { Names = new[] { "   " }, Types = new[] { "BOOL" } },
        };
        box.Outputs.AppendOutputItem(new Nwl.Operand { OperandExpr = "" });

        Assert.IsType<Box>(Assert.IsType<Assign>(Assert.Single(Read(box).Trees)).Value);
    }

    /// <summary>A BOX STORING <c>ContainsExtensibleInputs</c> IS CALLED WITHOUT ITS PIN NAMES (DLL read: the generator leaves the names
    /// out; measured live, openspec nwl-box-storage-map: an FB or a PROGRAM then answers C0044 "Assignment to input missing").
    /// The text has no place for the member, and a push builds the named call, so the network is refused by name.</summary>
    [Fact]
    public void A_box_storing_extensible_inputs_is_refused_by_name()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "F",
            CallType = Nwl.Operator.Function,
            ContainsExtensibleInputs = true,
            InputItemList = new object[] { Nwl.Leaf("a") },
            InputParams = new Nwl.ParamList { Names = new[] { "p" }, Types = new[] { "BOOL" } },
            OutputParams = new Nwl.ParamList { Names = new[] { "   " }, Types = new[] { "BOOL" } },
        };
        box.Outputs.AppendOutputItem(null!);

        Assert.Equal(BoxRefusals.ExtensibleInputsMarker, Refused(box).Reason);
    }

    /// <summary>AN OPERATOR BOX SHOWING ENO WHOSE VALUE SLOT HOLDS AN EMPTY OPERAND has no target either: the same run answers "The
    /// assignment target is not specified." It pulled as <c>AND(EN := go, a, b).ENO;</c>, which a push builds with no value slot.</summary>
    [Fact]
    public void An_operator_box_showing_ENO_with_an_empty_value_slot_is_refused_by_name()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "AND",
            CallType = Nwl.Operator.And,
            En = true,
            Eno = true,
            InputItemList = new object[] { Nwl.Leaf("go"), Nwl.Leaf("a"), Nwl.Leaf("b") },
            InputParams = new Nwl.ParamList { Names = new[] { "EN" }, Types = new[] { "BOOL" } },
            OutputParams = new Nwl.ParamList { Names = new[] { "ENO", "" }, Types = new[] { "BOOL", "BOOL" } },
        };
        box.Outputs.AppendOutputItem(null!);
        box.Outputs.AppendOutputItem(new Nwl.Operand { OperandExpr = "" });

        Assert.Equal(BoxRefusals.EmptyOperatorOutputMarker, Refused(box).Reason);
    }
}
