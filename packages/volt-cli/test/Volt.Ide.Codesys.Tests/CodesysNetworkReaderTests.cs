using System.Linq;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// Reading a CODESYS graphical body, offline.
///
/// <para><b>Why this project exists at all.</b> A POU in a user's project was ABSENT from the workspace — not an
/// item, not a folder, no error at the wire. The cause was one member: an unwired <c>En</c> pin reads as
/// <c>System.Boolean false</c>, not null (DIALECT C7), and the reader took any non-null <c>En</c> as a wired
/// enable. The resulting throw made the body unreadable, an unreadable body made the ITEM unreadable, and the
/// fetch skipped it — so a whole POU silently vanished from git.</para>
///
/// <para><b>It reached a user before a test because every graphical fixture Volt owns is one Volt itself
/// created</b>, and those carry a null <c>En</c>. Only a body an ENGINEER drew in the IDE has the boolean. That
/// used to mean the shape had no gate short of a live CODESYS with a hand-drawn network. It does now: the reader
/// reaches every vendor member by reflection and dispatches on <c>GetType().Name</c>, so a plain C# class named
/// <c>BoxTreeBox</c> reproduces the exact shape in microseconds.</para>
/// </summary>
public class CodesysNetworkReaderTests
{
    /// <summary>THE REGRESSION. `En = false` means "nothing is wired to the EN pin", and must read as no enable
    /// — not as an enable whose expression is a boolean.
    ///
    /// <para>Before the fix this did not merely mis-read the pin: <c>ReadNode</c> dispatched on the runtime type
    /// name, found <c>Boolean</c>, and threw "the graphical item 'Boolean' has no network-text form yet",
    /// costing the entire POU.</para></summary>
    [Fact]
    public void An_unwired_EN_pin_reads_as_no_enable()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "AND",
            InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("b") },
            En = false,   // the vendor's answer for "nothing wired here"
        };

        var body = CodesysNetworkReader.Read(Nwl.Body(box), BodyLanguage.Fbd);

        var read = Assert.IsType<Box>(body.Networks.Single().Trees.Single());
        Assert.Null(read.Enable);
        Assert.Equal("AND", read.Type);
        Assert.Equal(new[] { "a", "b" }, read.Inputs.Select(i => ((Leaf)i.Value).Operand.Text));
    }

    /// <summary>The same rule on every other node-valued member. They are read the same way and nothing says the
    /// vendor is consistent about which of them answers <c>false</c>, so the guard is applied to all of them and
    /// gated here rather than only where it happened to bite.</summary>
    [Fact]
    public void A_boolean_where_a_node_belongs_is_never_a_node()
    {
        var assign = new Nwl.BoxTreeAssign { RValue = false };
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out" });

        var body = CodesysNetworkReader.Read(Nwl.Body(assign), BodyLanguage.Ld);

        var read = Assert.IsType<Assign>(body.Networks.Single().Trees.Single());
        Assert.Null(read.Value);
        Assert.Equal(new[] { "out" }, read.Targets.Select(t => t.Text));
    }

    /// <summary>A WIRED enable still arrives. The guard rejects non-nodes, so it must not reject nodes — an
    /// over-broad fix would silently drop every real EN pin instead, which is the same class of loss one layer
    /// over.</summary>
    [Fact]
    public void A_wired_EN_pin_is_still_read()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "AND",
            InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("b") },
            En = Nwl.Leaf("enable"),
        };

        var body = CodesysNetworkReader.Read(Nwl.Body(box), BodyLanguage.Fbd);

        var read = Assert.IsType<Box>(body.Networks.Single().Trees.Single());
        var enable = Assert.IsType<Leaf>(read.Enable);
        Assert.Equal("enable", enable.Operand.Text);
    }

    /// <summary>FORMAL PIN NAMES COME OFF `Names`, a STRING ARRAY — the vendor's <c>IParamList</c> has no list of
    /// named objects to enumerate. Reading it the other way answered empty EVERY time, so a function-block call
    /// pulled as <c>t1( := a,  := pt)</c>: text that does not parse, which means such a POU could be pulled and
    /// never pushed back.</summary>
    [Fact]
    public void Formal_pin_names_are_read_from_the_param_list()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "TON",
            Instance = new Nwl.Operand { OperandExpr = "t1", IsInstance = true },
            InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("pt") },
            InputParams = new Nwl.ParamList { Names = new[] { "IN", "PT" }, Types = new[] { "BOOL", "TIME" } },
        };

        var body = CodesysNetworkReader.Read(Nwl.Body(box), BodyLanguage.Fbd);

        var read = Assert.IsType<Box>(body.Networks.Single().Trees.Single());
        Assert.Equal(new[] { "IN", "PT" }, read.Inputs.Select(i => i.Formal));
        Assert.Equal("t1", read.Instance?.Text);
    }

    /// <summary>A count that does not match the pins is not a licence to mis-pair them: the reader only applies
    /// formals when there is exactly one per input, so a partial list leaves them all unnamed rather than
    /// sliding the names onto the wrong pins.</summary>
    [Fact]
    public void A_mismatched_param_list_names_nothing()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "AND",
            InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("b") },
            InputParams = new Nwl.ParamList { Names = new[] { "In1" }, Types = new[] { "BOOL" } },
        };

        var body = CodesysNetworkReader.Read(Nwl.Body(box), BodyLanguage.Fbd);

        var read = Assert.IsType<Box>(body.Networks.Single().Trees.Single());
        Assert.All(read.Inputs, i => Assert.Null(i.Formal));
    }
}
