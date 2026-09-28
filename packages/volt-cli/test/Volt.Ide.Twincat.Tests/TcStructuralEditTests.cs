using System;
using System.Linq;
using System.Xml.Linq;
using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A STRUCTURALLY CHANGED TWINCAT NETWORK, offline (openspec network-text-literal-nwl, tasks 4.2 and 4.3).
///
/// <para>A value edit is written in place; a network whose SHAPE changed is handed to the IDE to rebuild through
/// PLCopen import (<see cref="TcNetworkWriter.Apply(string?, NetworkBody, NetworkScope, Func{Network, XElement}?)"/>'s
/// <c>resolve</c>). Three shapes are not measured through that import (review 7.16) — a <c>PARALLEL</c>, a wire whose
/// producer is a leaf (the importer crashed on one, <c>LiteralFanoutBugTests</c>), and a box's result pin <c>=&gt; v</c>
/// (the importer lowers an output pin to a separate assignment, DIALECT C20) — so a changed network holding one is
/// refused with <c>NETWORK_UNSUPPORTED</c>, naming the network and the shape, before the importer is called. The
/// <c>resolve</c> these tests hand in throws if it is ever reached, which is what "before" means here.</para>
/// </summary>
public class TcStructuralEditTests
{
    private const string Declaration =
        "PROGRAM P\nVAR\n  xoutput : BOOL;\n  xoutput2 : BOOL;\n  xtest : BOOL;\n  xtest2 : BOOL;\n  c : BOOL;\n  n : INT;\nEND_VAR";

    private static readonly NetworkScope Scope =
        NetworkScope.FromDeclarations(Declaration, _ => null, () => Array.Empty<string>());

    /// <summary>The hand-drawn <c>ladder.TcPOU</c>: ONE network, <c>xoutput := (xtest OR xtest2);</c>, LD view.</summary>
    private static string Ladder() =>
        XDocument.Parse(Fixtures.Pou("ladder.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting);

    private static NetworkBody Pushed(params string[] statements) =>
        NetworkText.Validate("IMPLEMENTATION LD\nNETWORK\n" +
                             string.Concat(statements.Select(s => "  " + s + "\n")) + "END_NETWORK\n", Scope);

    private static XElement NeverImported(Network n) =>
        throw new Xunit.Sdk.XunitException($"the importer was reached for network {n.Order + 1}");

    private static NetworkTextException RefusedBeforeImport(NetworkBody pushed) =>
        Assert.Throws<NetworkTextException>(() => TcNetworkWriter.Apply(Ladder(), pushed, Scope, NeverImported));

    [Fact]
    public void A_Parallel_in_a_structurally_changed_network_is_refused_before_the_importer()
    {
        var ex = RefusedBeforeImport(Pushed("xoutput := PARALLEL(xtest, xtest2);"));

        Assert.Equal(ConflictCodes.NetworkUnsupported, ex.Code);
        Assert.Contains("network 1", ex.Message);
        Assert.Contains("PARALLEL", ex.Message);
    }

    [Fact]
    public void A_wire_of_a_leaf_in_a_structurally_changed_network_is_refused_before_the_importer()
    {
        var ex = RefusedBeforeImport(Pushed("VAR_TEMP g1 : BOOL; END_VAR", "g1 := TRUE;", "xoutput := g1;", "xoutput2 := g1;"));

        Assert.Equal(ConflictCodes.NetworkUnsupported, ex.Code);
        Assert.Contains("network 1", ex.Message);
        Assert.Contains("g1", ex.Message);
        Assert.Contains("leaf", ex.Message);
    }

    [Fact]
    public void A_result_pin_in_a_structurally_changed_network_is_refused_before_the_importer()
    {
        var ex = RefusedBeforeImport(Pushed("MOVE(xtest, => xoutput);"));

        Assert.Equal(ConflictCodes.NetworkUnsupported, ex.Code);
        Assert.Contains("network 1", ex.Message);
        Assert.Contains("=> xoutput", ex.Message);
    }

    /// <summary>A CREATE is an import too, and the push's pre-flight (<c>BeckhoffDriver.ValidateSource</c>, creates only)
    /// runs this same lowering — so the refusal is the same, by the same code, before any op is written.</summary>
    [Theory]
    [InlineData("xoutput := PARALLEL(xtest, xtest2);", "PARALLEL")]
    [InlineData("MOVE(xtest, => xoutput);", "=> xoutput")]
    public void A_create_holding_an_unmeasured_shape_is_refused_by_the_lowering(string statement, string named)
    {
        var ex = Assert.Throws<NetworkTextException>(() => TcPlcOpenWriter.WriteProject("P", Pushed(statement)));

        Assert.Equal(ConflictCodes.NetworkUnsupported, ex.Code);
        Assert.Contains(named, ex.Message);
    }

    /// <summary>The refusal is about THOSE shapes: a structural change without one still reaches the importer — a
    /// retyped box is the measured case the rebuild exists for.</summary>
    [Fact]
    public void A_structural_change_without_those_shapes_still_reaches_the_importer()
    {
        var reached = Assert.Throws<Xunit.Sdk.XunitException>(() =>
            TcNetworkWriter.Apply(Ladder(), Pushed("xoutput := (xtest AND xtest2);"), Scope, NeverImported));
        Assert.Contains("importer was reached", reached.Message);
    }

    /// <summary>A VALUE EDIT STAYS IN PLACE (task 4.2), on a network that holds one of the refused shapes: the refusal
    /// is for the import, and a value edit never imports. The Parallel is <c>drawn-refused-shapes.TcPOU</c> with its
    /// terminator swapped for one (<c>TcDrawnJumpTests</c> builds the same body); a branch operand is renamed.</summary>
    [Fact]
    public void A_value_edit_on_a_network_holding_a_Parallel_is_written_in_place()
    {
        var nwl = TcDrawnJumpTests.NwlWithParallel("BoxShortCircuit");
        var xml = nwl.ToString(SaveOptions.DisableFormatting);
        var impl = nwl.DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");
        var model = TcNetworkReader.Read(impl, BodyLanguage.Ld);
        var branch = model.Networks.SelectMany(n => n.Trees).OfType<Assign>()
            .Select(a => a.Value).OfType<Volt.Engine.Format.Network.Parallel>().Single().Branches.OfType<Leaf>().First();
        var renamed = Rename(model, branch.Operand.Text, "renamedBranch");

        var written = TcNetworkWriter.Apply(xml, renamed, TcText.ScopeOf(renamed), NeverImported);

        Assert.NotNull(written);
        Assert.Contains("\"renamedBranch\"", written!);
    }

    /// <summary>A BOX THE IMPORT BUILT IS CONNECTED BY ITS ONE OUTPUT. <c>importer-max.TcPOU</c> is real XAE output
    /// (2026-09-26): Volt pushed <c>n := MAX(a, b);</c> and the PLCopen import built the box with ONE declared output
    /// (<c>OutputParam/Names = [Out1]</c>) and — once the importer's empty operand is dropped — no output item at all,
    /// so no slot is stored null to say which output the consumer reads. The pull read that as "a consumed box with no
    /// stored connection slot" and materialized the marker over the body Volt had just created (found live,
    /// <c>parity-fixes.test.ts</c>). A box with one output has one slot a consumer can read: slot 0.</summary>
    [Fact]
    public void A_consumed_box_the_import_built_is_connected_by_its_one_output()
    {
        var impl = XDocument.Parse(Fixtures.Pou("importer-max.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");

        var body = TcNetworkReader.Read(impl, BodyLanguage.Fbd);
        var max = Assert.IsType<Box>(Assert.IsType<Assign>(body.Networks.Single().Trees.Single()).Value);

        Assert.Equal((0, 0), (max.ConnectedSlot, max.MainOutputIndex));
        Assert.Contains("  n := MAX(", TcText.Write(body));
    }

    /// <summary>…and the same BEFORE the importer's empty operand is dropped, which is the state the stamp compares
    /// against (values first, then the repair — <c>BeckhoffDriver.Stamp</c>). Read as "no slot" there, the stamp refused
    /// ("the consumer of box 'MAX' moves to output slot 0"), the create path swallowed the refusal as a regrouping, and
    /// the body was left unstamped (found live, <c>parity-fixes.test.ts</c>).</summary>
    [Fact]
    public void A_consumed_box_the_import_built_is_connected_by_its_one_output_before_the_repair_too()
    {
        var nwl = XDocument.Parse(Fixtures.Pou("importer-max.TcPOU"), LoadOptions.PreserveWhitespace).Descendants("NWL").Single();
        var box = nwl.Descendants("o").First(o => o.Elements("v").Any(v => (string?)v.Attribute("n") == "BoxType"));
        var list = box.Elements("o").First(o => (string?)o.Attribute("n") == "OutputItems").Elements("l2").Single();
        list.Add(new XElement("o", new XElement("v", new XAttribute("n", "Operand"), "\"\""), new XElement("v", new XAttribute("n", "Id"), "99L")));

        var read = TcNetworkReader.Read(nwl.DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject"), BodyLanguage.Fbd);

        Assert.Equal(0, Assert.IsType<Box>(Assert.IsType<Assign>(read.Networks.Single().Trees.Single()).Value).ConnectedSlot);
    }

    /// <summary>…AND ITS PINS COME BACK AS THEY WERE PUSHED. Volt's PLCopen lowering must name every input it wires
    /// (<c>formalParameter</c>), so a positional pin goes out as <c>In1</c>, <c>In2</c> — and the import keeps those names
    /// (<c>importer-max.TcPOU</c>: <c>InputParam/Names = [In1, In2]</c>), so <c>n := MAX(a, b);</c> came back
    /// <c>n := MAX(In1 := a, In2 := b);</c> (found live, <c>parity-fixes.test.ts</c>). The stamp after the import writes
    /// the text's positional pins over them — a value edit of names the import itself took from Volt; a pin the IDE
    /// names otherwise is not Volt's to blank, and a push leaving it positional is refused, never a silent no-op.</summary>
    [Fact]
    public void Positional_pins_are_written_over_the_names_the_import_took_from_Volt()
    {
        var xml = XDocument.Parse(Fixtures.Pou("importer-max.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting);
        var scope = NetworkScope.FromDeclarations("PROGRAM VltProbe_Max\nVAR\n  a : INT;\n  b : INT;\n  n : INT;\nEND_VAR",
                                                  _ => null, () => Array.Empty<string>());
        var pushed = NetworkText.Validate("IMPLEMENTATION FBD\nNETWORK\n  n := MAX(a, b);\nEND_NETWORK\n", scope);

        var written = TcNetworkWriter.Apply(xml, pushed, scope);

        Assert.NotNull(written);
        var back = TcNetworkReader.Read(TcArchive.Root(written)!, BodyLanguage.Fbd);
        Assert.Contains("  n := MAX(a, b);\n", NetworkTextWriter.Write(back, scope));
    }

    /// <summary>THE NAMES THE STAMP BLANKS ARE THE NAMES THE LOWERING GAVE. <c>importer-max.TcPOU</c> is what the import
    /// made of an older lowering; this puts TODAY's lowering's pin names into that capture, so a rename on one side
    /// (a prefix, a case, a numbering) can no longer leave the stamp refusing every positional box it just created as
    /// "names its pin 'X'".</summary>
    [Fact]
    public void Positional_pins_are_blanked_under_the_names_the_lowering_gives_them()
    {
        var scope = NetworkScope.FromDeclarations("PROGRAM VltProbe_Max\nVAR\n  a : INT;\n  b : INT;\n  n : INT;\nEND_VAR",
                                                  _ => null, () => Array.Empty<string>());
        var pushed = NetworkText.Validate("IMPLEMENTATION FBD\nNETWORK\n  n := MAX(a, b);\nEND_NETWORK\n", scope);
        var lowered = TcPlcOpenWriter.WriteProject("VltProbe_Max", pushed).Descendants()
            .Where(x => x.Name.LocalName == "block").Single().Descendants()
            .Where(x => x.Name.LocalName == "variable" && x.Parent!.Name.LocalName == "inputVariables")
            .Select(x => (string)x.Attribute("formalParameter")!).ToList();
        Assert.Equal(2, lowered.Count);

        var xml = XDocument.Parse(Fixtures.Pou("importer-max.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting)
            .Replace("<v>In1</v>", "<v>" + lowered[0] + "</v>").Replace("<v>In2</v>", "<v>" + lowered[1] + "</v>");

        var written = TcNetworkWriter.Apply(xml, pushed, scope);

        Assert.NotNull(written);
        Assert.Contains("  n := MAX(a, b);\n", NetworkTextWriter.Write(TcNetworkReader.Read(TcArchive.Root(written)!, BodyLanguage.Fbd), scope));
    }

    [Fact]
    public void A_pin_name_the_IDE_holds_is_not_blanked_by_a_positional_push()
    {
        var xml = XDocument.Parse(Fixtures.Pou("importer-max.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting).Replace("<v>In2</v>", "<v>Limit</v>");
        var scope = NetworkScope.FromDeclarations("PROGRAM VltProbe_Max\nVAR\n  a : INT;\n  b : INT;\n  n : INT;\nEND_VAR",
                                                  _ => null, () => Array.Empty<string>());
        var pushed = NetworkText.Validate("IMPLEMENTATION FBD\nNETWORK\n  n := MAX(a, b);\nEND_NETWORK\n", scope);

        var ex = Assert.Throws<NotSupportedException>(() => TcNetworkWriter.Apply(xml, pushed, scope));
        Assert.Contains("Limit", ex.Message);
    }

    /// <summary>AN UNWIRED PIN THE IMPORT BUILT READS AS THE EMPTY SLOT IT IS. <c>importer-unwired.TcPOU</c> is real XAE
    /// output of <c>n := ( * m * 6);</c> and <c>t1(IN := , PT := );</c>: the import holds each unconnected pin as an
    /// operand with no text, where CODESYS holds a terminator, and it came back <c>(`` * m * 6)</c> (found live,
    /// <c>real-project-shapes.test.ts</c>). Read as the model's one "unconnected", and pushed back unchanged.</summary>
    [Fact]
    public void An_unwired_pin_the_import_built_reads_as_the_empty_slot_and_pushes_back_unchanged()
    {
        var xml = XDocument.Parse(Fixtures.Pou("importer-unwired.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting);
        var scope = NetworkScope.FromDeclarations("PROGRAM VltProbe_Max\nVAR\n  n : INT;\n  m : INT;\n  t1 : TON;\nEND_VAR",
                                                  _ => null, () => Array.Empty<string>());

        var pulled = TcNetworkReader.Read(TcArchive.Root(xml)!, BodyLanguage.Ld);
        var text = NetworkTextWriter.Write(pulled, scope);

        Assert.Contains("  n := ( * m * 6);\n", text);
        Assert.Contains("  t1(IN := , PT := );\n", text);
        Assert.Null(TcNetworkWriter.Apply(xml, NetworkText.Validate(text, scope), scope));
    }

    /// <summary>…and an unwired ENABLE is the same empty slot. The import builds an unconnected <c>EN</c> exactly as it
    /// builds an unconnected data pin (<c>TcPlcOpenWriter.EmitBox</c> emits the enable first, a terminator as an empty
    /// <c>&lt;inVariable&gt;</c>), so the capture's first pin renamed <c>EN</c> is that slot. The fix for the empty
    /// backticked name covered the data pins only, and this came back as <c>EN := ``</c>.</summary>
    [Fact]
    public void An_unwired_enable_the_import_built_reads_as_the_empty_slot_and_pushes_back_unchanged()
    {
        var xml = XDocument.Parse(Fixtures.Pou("importer-unwired.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting).Replace("<v>IN</v>", "<v>EN</v>");
        var scope = NetworkScope.FromDeclarations("PROGRAM VltProbe_Max\nVAR\n  n : INT;\n  m : INT;\n  t1 : TON;\nEND_VAR",
                                                  _ => null, () => Array.Empty<string>());

        var pulled = TcNetworkReader.Read(TcArchive.Root(xml)!, BodyLanguage.Ld);
        var box = pulled.Networks.SelectMany(n => n.Trees).OfType<Box>().Single(b => b.Type == "TON");
        Assert.IsType<Terminator>(box.Enable);

        var text = NetworkTextWriter.Write(pulled, scope);
        Assert.Contains("  t1(EN := , PT := );\n", text);
        Assert.Null(TcNetworkWriter.Apply(xml, NetworkText.Validate(text, scope), scope));
    }

    // -- 4.3: the component count ---------------------------------------------------------------------------------

    /// <summary>A WIRE AND EVERYTHING THAT READS IT ARE ONE RUNG (D25), wherever the reference sits. The count used a
    /// legacy fold (<c>Unhoist</c>) that joined only a wire read DIRECTLY by an assignment (<c>out := g1;</c>) — and
    /// census 1.8 found every one of 434 real references NESTED (<c>out := (g1 OR c);</c>). Such a network counted as
    /// two rungs and a rebuild was refused as "would split it"; it is one connected rung, so the IDE rebuilds it whole.</summary>
    [Fact]
    public void A_wire_read_inside_its_consumers_is_one_rung_and_reaches_the_importer()
    {
        var pushed = Pushed("VAR_TEMP g1 : BOOL; END_VAR", "g1 := (xtest AND xtest2);", "xoutput := (g1 OR c);",
                            "xoutput2 := (g1 AND c);");

        var reached = Assert.Throws<Xunit.Sdk.XunitException>(() => TcNetworkWriter.Apply(Ladder(), pushed, Scope, NeverImported));
        Assert.Contains("importer was reached", reached.Message);
    }

    /// <summary>…and two rungs that share nothing are still two, refused before the importer would split them.</summary>
    [Fact]
    public void Two_rungs_sharing_no_wire_are_still_refused_as_a_split()
    {
        var ex = Assert.Throws<NotSupportedException>(() =>
            TcNetworkWriter.Apply(Ladder(), Pushed("xoutput := (xtest AND xtest2);", "xoutput2 := (xtest OR c);"), Scope, NeverImported));
        Assert.Contains("2 independent rungs", ex.Message);
    }

    // -- the push half of "EN is a pin, ENO is spelled" -------------------------------------------------------------

    /// <summary>The ladder network as the importer would hand it back, with the box's output list set to
    /// <paramref name="names"/> and its type to <paramref name="type"/> — the imported box's own output list, read as
    /// CODESYS reads it (<see cref="Box.HasEnoSlot"/>).</summary>
    private static Func<Network, XElement> ImportedAs(string type, params string[] names) => _ =>
    {
        var impl = TcArchive.Root(Ladder())!;
        var net = new XElement(TcArchive.List(impl, "NetworkList")[0]);
        var box = net.Descendants("o").First(o => o.Elements("v").Any(v => (string?)v.Attribute("n") == "BoxType"));
        box.Elements("v").First(v => (string?)v.Attribute("n") == "BoxType").Value = "\"" + type + "\"";
        var list = box.Elements("o").First(o => (string?)o.Attribute("n") == "OutputParam").Elements("l2")
            .First(l => (string?)l.Attribute("n") == "Names");
        foreach (var n in names) list.Add(new XElement("v", n));
        return net;
    };

    /// <summary>A consumer written WITHOUT <c>.ENO</c> on a box the IDE builds with ENO as its main output states a data
    /// output the box does not have (spec, "ENO is the main output") — refused naming the box, after the import, from
    /// the imported box's output list.</summary>
    [Fact]
    public void A_consumer_without_ENO_on_a_box_the_import_gives_an_ENO_main_output_is_refused_naming_it()
    {
        var ex = Assert.ThrowsAny<NotSupportedException>(() =>
            TcNetworkWriter.Apply(Ladder(), Pushed("xoutput := MOVE(EN := c, xtest);"), Scope, ImportedAs("MOVE", "ENO", "")));

        Assert.Contains("'MOVE'", ex.Message);
        Assert.Contains("without `.ENO`", ex.Message);
    }

    /// <summary>…and <c>.ENO</c> on a box the IDE builds with no ENO output names an output that is not there (spec, "a
    /// box that has no ENO output says .ENO").</summary>
    [Fact]
    public void ENO_on_a_box_the_import_gives_no_ENO_output_is_refused_naming_it()
    {
        var ex = Assert.ThrowsAny<NotSupportedException>(() =>
            TcNetworkWriter.Apply(Ladder(), Pushed("xoutput := AND(xtest, xtest2).ENO;"), Scope, ImportedAs("AND")));

        Assert.Contains("'AND'", ex.Message);
        Assert.Contains("`.ENO`", ex.Message);
        Assert.Contains("no ENO output", ex.Message);
    }

    // -- the edge order (spec, "edges are R_EDGE and F_EDGE flags") --------------------------------------------------

    /// <summary>TWINCAT'S ORDER FOR A NEGATION AND AN EDGE ON ONE NODE IS UNMEASURED (task 1.14: no licensed runtime), so
    /// a pulled body holding one goes to the marker by name — never written in CODESYS's order (<c>R_EDGE(NOT x)</c>,
    /// DIALECT N17), which would state logic nobody measured TwinCAT to run.</summary>
    [Theory]
    [InlineData(TcArchive.FlagRtrig)]
    [InlineData(TcArchive.FlagFtrig)]
    public void A_negation_with_an_edge_on_one_operand_is_the_marker(int edge)
    {
        var impl = TcArchive.Root(Ladder())!;
        var bits = impl.Descendants("o").First(o => o.Elements("v").Any(v => (string?)v.Attribute("n") == "Operand" && v.Value == "\"xtest\""))
            .Elements("o").Single(o => (string?)o.Attribute("n") == "Flags").Elements("v").Single(v => (string?)v.Attribute("n") == "Flags");
        bits.Value = (TcArchive.FlagNegation | edge).ToString();

        var ex = Assert.Throws<UnrepresentableBodyException>(() => TcNetworkReader.Read(impl, BodyLanguage.Ld));
        Assert.Equal("a negation with an edge", ex.Reason);
        Assert.Contains("xtest", ex.Message);
    }

    /// <summary>…and on a BOX: a box carries its own Flags (the OR in <c>ladder.TcPOU</c>), the order is as unmeasured
    /// there, and the marker names the box.</summary>
    [Theory]
    [InlineData(TcArchive.FlagRtrig)]
    [InlineData(TcArchive.FlagFtrig)]
    public void A_negation_with_an_edge_on_one_box_is_the_marker(int edge)
    {
        var impl = TcArchive.Root(Ladder())!;
        var box = impl.Descendants("o").Single(o => (string?)o.Attribute("t") == "BoxTreeBox");
        box.Elements("o").Single(o => (string?)o.Attribute("n") == "Flags").Elements("v")
            .Single(v => (string?)v.Attribute("n") == "Flags").Value = (TcArchive.FlagNegation | edge).ToString();

        var ex = Assert.Throws<UnrepresentableBodyException>(() => TcNetworkReader.Read(impl, BodyLanguage.Ld));
        Assert.Equal("a negation with an edge", ex.Reason);
        Assert.Contains("the 'OR' box", ex.Message);
    }

    /// <summary>…and a push that spells one on a box is refused naming the box.</summary>
    [Fact]
    public void A_negation_with_an_edge_on_a_box_is_refused_on_push()
    {
        var ex = Assert.Throws<NotSupportedException>(() =>
            TcNetworkWriter.Apply(Ladder(), Pushed("xoutput := R_EDGE(NOT (xtest OR xtest2));"), Scope, NeverImported));
        Assert.Contains("a negation with an edge", ex.Message);
        Assert.Contains("the 'OR' box", ex.Message);
    }

    /// <summary>…and a push that spells one is refused by the same name before anything is written.</summary>
    [Fact]
    public void A_negation_with_an_edge_is_refused_on_push()
    {
        var ex = Assert.Throws<NotSupportedException>(() =>
            TcNetworkWriter.Apply(Ladder(), Pushed("xoutput := (R_EDGE(NOT xtest) OR xtest2);"), Scope, NeverImported));
        Assert.Contains("a negation with an edge", ex.Message);
        Assert.Contains("xtest", ex.Message);
    }

    /// <summary>A single edge, and a single negation, are measured on their own (N17's controls) and read as before.</summary>
    [Fact]
    public void A_lone_edge_or_negation_reads_as_before()
    {
        var impl = TcArchive.Root(Ladder())!;
        var bits = impl.Descendants("o").First(o => o.Elements("v").Any(v => (string?)v.Attribute("n") == "Operand" && v.Value == "\"xtest\""))
            .Elements("o").Single(o => (string?)o.Attribute("n") == "Flags").Elements("v").Single(v => (string?)v.Attribute("n") == "Flags");
        bits.Value = TcArchive.FlagRtrig.ToString();

        var box = Assert.IsType<Box>(Assert.IsType<Assign>(TcNetworkReader.Read(impl, BodyLanguage.Ld).Networks[0].Trees[0]).Value);
        Assert.True(((Leaf)box.Inputs[0].Value).Flags.Rising);
    }

    private static NetworkBody Rename(NetworkBody b, string from, string to) =>
        b with { Networks = b.Networks.Select(n => n with { Trees = n.Trees.Select(t => Rename(t, from, to)).ToList() }).ToList() };

    private static Node Rename(Node n, string from, string to) => n switch
    {
        Leaf l when l.Operand.Text == from => l with { Operand = l.Operand with { Text = to } },
        Assign a => a with { Value = Rename(a.Value, from, to) },
        Volt.Engine.Format.Network.Parallel p => p with
        {
            Input = p.Input is null ? null : Rename(p.Input, from, to),
            Branches = p.Branches.Select(x => Rename(x, from, to)).ToList(),
        },
        _ => n,
    };
}
