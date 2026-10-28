using System.Linq;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// A VALUE THE LIVE NWL MODEL DID NOT STATE IS REFUSED BY NAME, NEVER READ AS A DEFAULT (zero-fallback policy, owner
/// 2026-10-23) — the CODESYS twin of <c>TcNetworkUnstatedValueTests</c>.
///
/// <para><c>NwlInterop.Text</c> answers null for an absent member AND for one holding null, and <c>NwlInterop.Flag</c>
/// answers false for both; the reader turned those into <c>""</c>, false and "no flag". The recorded corpora
/// (<c>test/fixtures/nwl-corpus</c>, four CODESYS projects, SP21) say what the model holds: <c>BoxType</c> a name on
/// 1300 of 1300 boxes, <c>CallType</c> a member on 1300, every network's <c>Title</c>/<c>Label</c>/<c>Comment</c> a
/// string (388 of 388, <c>""</c> where none) and <c>OutCommented</c> a boolean, every box and operand a <c>Flags</c>
/// object (7149), every pin-flag list one set per input, every output name a string (971), and an operand's text null
/// only on an Instance with none (1145) — a pin's is <c>""</c> or a name (3993 of 3993).</para>
/// </summary>
public class CodesysNetworkUnstatedValueTests
{
    private static T Refused<T>(object tree) where T : System.Exception =>
        Assert.Throws<T>(() => CodesysNetworkReader.Read(Nwl.Body(tree), BodyLanguage.Fbd));

    private static Nwl.BoxTreeBox And() => new()
    {
        BoxType = "AND",
        InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("b") },
        Flags = new Nwl.Flags(),
    };

    [Fact]
    public void The_box_these_tests_break_reads_whole()
    {
        Assert.Equal("AND", Assert.IsType<Box>(CodesysNetworkReader.Read(Nwl.Body(And()), BodyLanguage.Fbd).Networks.Single().Trees.Single()).Type);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void A_box_naming_no_type_is_refused_not_read_as_a_call_to_nothing(string? type)
    {
        var box = And();
        box.BoxType = type!;
        Assert.Contains("BoxType", Refused<BridgeException>(box).Message);
    }

    [Fact]
    public void A_contacts_operand_with_no_text_is_refused_not_read_as_unwired()
    {
        var box = And();
        box.InputItemList = new object[] { new Nwl.BoxTreeOperand { Operand = new Nwl.Operand { OperandExpr = null! } }, Nwl.Leaf("b") };
        Assert.Contains("OperandExpr", Refused<BridgeException>(box).Message);
    }

    [Fact]
    public void A_box_with_no_Flags_object_is_refused_not_read_as_no_flag()
    {
        var box = And();
        box.Flags = null;
        Assert.Contains("Flags", Refused<BridgeException>(box).Message);
    }

    [Fact]
    public void An_operand_with_no_Flags_object_is_refused_not_read_as_no_flag()
    {
        var box = And();
        box.InputItemList = new object[] { new Nwl.BoxTreeOperand { Operand = new Nwl.Operand { OperandExpr = "a", Flags = null } }, Nwl.Leaf("b") };
        Assert.Contains("Flags", Refused<BridgeException>(box).Message);
    }

    [Fact]
    public void A_pin_flag_set_answered_null_is_refused_not_read_as_no_flag()
    {
        var box = And();
        box.InputFlags = new object[] { new Nwl.Flags(), null! };
        Assert.Equal(BoxRefusals.PinFlagMarker, Refused<UnrepresentableBodyException>(box).Reason);
    }

    [Fact]
    public void An_output_name_answered_null_is_refused_not_read_as_unnamed()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "TON",
            Instance = new Nwl.Operand { OperandExpr = "t1", IsInstance = true },
            InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("pt") },
            InputParams = new Nwl.ParamList { Names = new[] { "IN", "PT" }, Types = new[] { "BOOL", "TIME" } },
            OutputParams = new Nwl.ParamList { Names = new[] { "Q", null! }, Types = new[] { "BOOL", "TIME" } },
            Flags = new Nwl.Flags(),
        };
        var ex = Assert.Throws<UnrepresentableBodyException>(() => CodesysNetworkReader.Read(Nwl.Body(box), BodyLanguage.Fbd));
        Assert.Equal(BoxRefusals.MissingListMarker, ex.Reason);
        Assert.Contains("OutputParams.Names", ex.Message);
    }

    /// <summary>A network answering no title — the model's null, not the <c>""</c> 388 of 388 recorded networks hold for
    /// none — is refused rather than read as "no title".</summary>
    [Fact]
    public void A_network_answering_no_title_is_refused()
    {
        var impl = Nwl.Body(And());
        ((Nwl.Network)impl.NetworkList[0]).Title = null!;
        Assert.Contains("Title", Assert.Throws<BridgeException>(() => CodesysNetworkReader.Read(impl, BodyLanguage.Fbd)).Message);
    }

    /// <summary>A network object that does not answer <c>OutCommented</c> is no network the model hands out; read as
    /// false, a disabled network would pull enabled.</summary>
    [Fact]
    public void A_network_with_no_OutCommented_is_refused_not_read_as_enabled()
    {
        var impl = new Nwl.NWLImplementationObject();
        impl.NetworkList.Add(new NetworkWithoutOutCommented());
        Assert.Contains("OutCommented", Assert.Throws<BridgeException>(() => CodesysNetworkReader.Read(impl, BodyLanguage.Fbd)).Message);
    }

    /// <summary>An assignment target that does not answer <c>IsLValue</c>: read as false before.</summary>
    [Fact]
    public void An_operand_with_no_IsLValue_is_refused_not_read_as_false()
    {
        var assign = new Nwl.BoxTreeAssign { RValue = Nwl.Leaf("a") };
        assign.Outputs.List.Add(new OperandWithoutIsLValue());
        Assert.Contains("IsLValue", Refused<BridgeException>(assign).Message);
    }

    internal sealed class NetworkWithoutOutCommented
    {
        public string Title { get; set; } = "";
        public string Label { get; set; } = "";
        public string Comment { get; set; } = "";
        public int NetworkItemCount => 0;
        public object? GetTree(int i) => null;
        public object? GetSplitPoint(int i) => null;
    }

    /// <summary>An operand lacking <c>IsLValue</c>. Not named <c>Operand</c>: the writer resolves NWL types BY NAME out of
    /// this assembly (<c>NwlInterop.New</c>), so a second class of a double's name would be built in its place.</summary>
    internal sealed class OperandWithoutIsLValue
    {
        public string OperandExpr { get; set; } = "a";
        public string Type { get; set; } = "";
        public bool IsInstance { get; set; }
        public object Flags { get; } = new Nwl.Flags();
        public object? GetSerializableValue(string name) => "";
    }
}
