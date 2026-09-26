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
        NetworkText.Validate("(* @volt-implementation LD *)\nNETWORK\n" +
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
        Assert.Equal("a negation with an edge", ex.Marker);
        Assert.Contains("xtest", ex.Message);
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
