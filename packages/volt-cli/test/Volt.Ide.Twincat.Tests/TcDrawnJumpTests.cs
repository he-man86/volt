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

    /// <summary>CENSUS 1.2, the Parallel half, the parity twin of CODESYS's reader test: an unfed Parallel is the
    /// null feed, and a Parallel fed by the empty terminator (0 in five projects) is refused by name. The drawn jump's
    /// empty terminator becomes the feed of a Parallel built around it.</summary>
    [Fact]
    public void A_Parallel_fed_by_the_empty_terminator_is_refused_by_name()
    {
        var impl = Impl();
        var rvalues = impl.Descendants("o").Where(o => (string?)o.Attribute("n") == "RValue").ToList();
        var terminator = rvalues.First(o => (string?)o.Attribute("t") == "BoxTreeTerminator");
        var feed = new XElement(terminator);
        feed.SetAttributeValue("n", "Input");
        var branch = new XElement(rvalues.First(o => (string?)o.Attribute("t") == "BoxTreeOperand"));
        branch.Attribute("n")!.Remove();
        terminator.ReplaceWith(new XElement("o", new XAttribute("n", "RValue"), new XAttribute("t", "BoxTreeParallel"),
            feed, new XElement("l2", new XAttribute("n", "Trees"), branch)));

        var ex = Assert.Throws<Volt.Engine.Format.Body.UnrepresentableBodyException>(() => TcNetworkReader.Read(impl, BodyLanguage.Ld));
        Assert.Equal("a Parallel fed by the empty terminator", ex.Marker);
    }

    /// <summary>DIALECT N20, the parity twin of CODESYS's reader tests: the object model holds no flag on a Parallel,
    /// so the model has no place for one and a bit found anyway is refused by name, never dropped. And its MODE is read
    /// by member name (census 1.3: a Sequential exists) — an archive carrying none is refused, not defaulted.</summary>
    [Theory]
    [InlineData("<v n=\"Mode\" t=\"OperationMode\">Sequential</v>", null, "Sequential")]
    [InlineData("<v n=\"Mode\" t=\"OperationMode\">BoxShortCircuit</v>", null, "BoxShortCircuit")]
    [InlineData(null, null, "an unmeasured Parallel mode")]
    [InlineData("<v n=\"Mode\" t=\"OperationMode\">BoxShortCircuit</v>", "<o n=\"Flags\" t=\"Flags\"><v n=\"Flags\">1</v></o>", "a flag on a Parallel")]
    public void A_Parallel_reads_its_mode_and_refuses_a_flag(string? mode, string? flags, string expected)
    {
        var impl = Impl();
        var rvalues = impl.Descendants("o").Where(o => (string?)o.Attribute("n") == "RValue").ToList();
        var terminator = rvalues.First(o => (string?)o.Attribute("t") == "BoxTreeTerminator");
        var branch = new XElement(rvalues.First(o => (string?)o.Attribute("t") == "BoxTreeOperand"));
        branch.Attribute("n")!.Remove();
        var par = new XElement("o", new XAttribute("n", "RValue"), new XAttribute("t", "BoxTreeParallel"),
            new XElement("n", new XAttribute("n", "Input")), new XElement("l2", new XAttribute("n", "Trees"), branch));
        if (mode is not null) par.Add(XElement.Parse(mode));
        if (flags is not null) par.Add(XElement.Parse(flags));
        terminator.ReplaceWith(par);

        if (expected is "Sequential" or "BoxShortCircuit")
        {
            var read = TcNetworkReader.Read(impl, BodyLanguage.Ld).Networks.SelectMany(n => n.Trees).OfType<Assign>()
                .Select(a => a.Value).OfType<Volt.Engine.Format.Network.Parallel>().Single();
            Assert.Equal(expected, read.Mode.ToString());
        }
        else
            Assert.Equal(expected, Assert.Throws<Volt.Engine.Format.Body.UnrepresentableBodyException>(
                () => TcNetworkReader.Read(impl, BodyLanguage.Ld)).Marker);
    }

    /// <summary>The <c>&lt;NWL&gt;</c> body holding a <c>BoxTreeParallel</c> in <paramref name="mode"/> where the fixture's
    /// empty terminator was — the archive shape <see cref="A_Parallel_reads_its_mode_and_refuses_a_flag"/> reads — and
    /// the drawn rung's COIL dropped, so the rung is a conditional jump: <c>IF PARALLEL(…) THEN JMP owrods; END_IF;</c>.
    /// A coil beside a jump has no spelling (<see cref="The_drawn_rung_goes_to_the_marker_by_name"/>), so with it the
    /// writer's change gate could not say "unchanged" about a network the text cannot hold.</summary>
    internal static XElement NwlWithParallel(string mode)
    {
        var nwl = XDocument.Load(Fixtures.Path("tc-pou", "drawn-refused-shapes.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single();
        var rvalues = nwl.Descendants("o").Where(o => (string?)o.Attribute("n") == "RValue").ToList();
        var terminator = rvalues.First(o => (string?)o.Attribute("t") == "BoxTreeTerminator");
        var branch = new XElement(rvalues.First(o => (string?)o.Attribute("t") == "BoxTreeOperand"));
        branch.Attribute("n")!.Remove();
        terminator.ReplaceWith(new XElement("o", new XAttribute("n", "RValue"), new XAttribute("t", "BoxTreeParallel"),
            new XElement("n", new XAttribute("n", "Input")), new XElement("l2", new XAttribute("n", "Trees"), branch),
            XElement.Parse($"<v n=\"Mode\" t=\"OperationMode\">{mode}</v>")));
        nwl.Descendants("o").Single(o => o.Elements("v").Any(v => (string?)v.Attribute("n") == "Operand" && v.Value == "\"out\""))
           .Remove();
        return nwl;
    }

    /// <summary>Task 4.2: the in-place writer assigns members the IDE wrote and never authors the <c>Mode</c> scalar,
    /// so a model asking for the OTHER mode is refused by name — it must not reach the archive as a silent keep of the
    /// old mode (the push would report success and the next pull would show the mode reverted).</summary>
    [Fact]
    public void The_in_place_writer_refuses_a_Parallel_mode_change()
    {
        var nwl = NwlWithParallel("BoxShortCircuit");
        var xml = nwl.ToString(SaveOptions.DisableFormatting);
        var impl = nwl.DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");
        var model = TcNetworkReader.Read(impl, BodyLanguage.Ld);
        Assert.Null(TcText.Apply(xml, model));   // the unchanged mode writes nothing

        var switched = model with
        {
            Networks = model.Networks.Select(n => n with
            {
                Trees = n.Trees.Select(t => t is Assign { Value: Volt.Engine.Format.Network.Parallel p } a
                    ? a with { Value = p with { Mode = ParallelMode.Sequential } }
                    : t).ToList(),
            }).ToList(),
        };
        var ex = Assert.Throws<System.NotSupportedException>(() => TcText.Apply(xml, switched));
        Assert.Contains("a Parallel changes mode to Sequential", ex.Message);
    }

    /// <summary>Census 1.1: no Assign ITEM carries a negation or an edge (only its operands do), and the model's
    /// <c>Assign.Flags</c> is where Jump/Return ride. A bit found there has no position in the text — v1 printed it on
    /// the VALUE, moving it to the operand on the next read — so it is refused by name, the parity twin of CODESYS's.</summary>
    [Theory]
    [InlineData(TcArchive.FlagNegation)]
    [InlineData(TcArchive.FlagRtrig)]
    [InlineData(TcArchive.FlagFtrig)]
    public void A_negation_or_edge_on_an_Assign_item_is_refused_by_name(int bit)
    {
        var impl = Impl();
        // The item is typed by its list's `cet`, so it is found through its operand-valued RValue.
        var assign = impl.Descendants("o").First(o => (string?)o.Attribute("n") == "RValue"
                                                     && (string?)o.Attribute("t") == "BoxTreeOperand").Parent!;
        var bits = assign.Elements("o").Single(o => (string?)o.Attribute("n") == "Flags")
            .Elements("v").Single(v => (string?)v.Attribute("n") == "Flags");
        bits.Value = (int.Parse(bits.Value) | bit).ToString();

        Assert.Equal("a flag on an Assign item", Assert.Throws<Volt.Engine.Format.Body.UnrepresentableBodyException>(
            () => TcNetworkReader.Read(impl, BodyLanguage.Ld)).Marker);
    }

    /// <summary>The same fact on a wire: a <c>BoxTreeDemux</c> the archive gives a flag is refused by name.</summary>
    [Fact]
    public void A_flag_on_a_wire_is_refused_by_name()
    {
        var impl = XElement.Parse(XDocument.Parse(Fixtures.Pou("ladder-demux.TcPOU")).Descendants("NWL").Single().ToString())
            .DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");
        var reference = impl.Descendants("o").First(o => (string?)o.Attribute("t") == "BoxTreeDemux"
                                                         && o.Elements("n").Any(n => (string?)n.Attribute("n") == "Input"));
        reference.Add(XElement.Parse("<o n=\"Flags\" t=\"Flags\"><v n=\"Flags\">1</v></o>"));

        Assert.Equal("a flag on a wire", Assert.Throws<Volt.Engine.Format.Body.UnrepresentableBodyException>(
            () => TcNetworkReader.Read(impl, BodyLanguage.Ld)).Marker);
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

    /// <summary>THE DRAWN RUNG GOES TO THE MARKER, BY NAME — and the coil it drives is no longer lost on the way.
    ///
    /// <para>The rung drives TWO outputs from one terminator: the jump destination <c>owrods</c> (<c>Flags = 4</c>) and an
    /// ordinary coil <c>out</c> (<c>Flags = 0</c>). v1 rendered <c>"JMP " + a.Targets[0].Text</c> and dropped every other
    /// target, so the pulled text was <c>JMP owrods;</c> and the coil was absent from the engineer's file — hidden by
    /// the fixed point, since the text round-tripped to itself. Network text v2 has no spelling for the shape (<c>JMP</c>
    /// as an assign target is not ST, and no corpus holds it — spec, "marker-only shapes stay on the existing marker"),
    /// so the writer refuses it by name and the pull materializes the marker: the POU appears, says what it holds, and
    /// nothing the engineer drew is missing from git.</para></summary>
    [Fact]
    public void The_drawn_rung_goes_to_the_marker_by_name()
    {
        var pulled = TcNetworkReader.Read(Impl(), BodyLanguage.Ld);

        var ex = Assert.ThrowsAny<Volt.Engine.Format.Body.UnrepresentableBodyException>(() => TcText.Write(pulled));

        Assert.Equal("a rung driving a coil and a jump together", ex.Marker);
    }
}
