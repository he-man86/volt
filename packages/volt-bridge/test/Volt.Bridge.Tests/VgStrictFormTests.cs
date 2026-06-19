using System.Linq;
using System.Xml.Linq;
using Volt.Bridge.Core.Graphical;
using Volt.Bridge.Core.Graphical.Vg;
using Xunit;

namespace Volt.Bridge.Tests;

/// <summary>
/// The strict, every-node-named VG contract: VG is isomorphic to the PLCopen node graph (one
/// statement per node, operands are only names, synthetic temps declared in a per-network VAR_TEMP),
/// so round-trip is identical in all cases and the VAR_TEMP is a VG-only construct stripped on push.
/// </summary>
public class VgStrictFormTests
{
    private const string Ns = "http://www.plcopen.org/xml/tc6_0200";
    private static GraphBody Read(string inner) =>
        PlcOpenReader.ReadBody(XElement.Parse($"<FBD xmlns=\"{Ns}\">{inner}</FBD>"));
    private static string Vg(string inner) => VgWriter.Write(Read(inner));
    private static string FullRoundTrip(string vg) =>
        VgWriter.Write(PlcOpenReader.ReadBody(PlcOpenWriter.WriteBody(VgParser.Parse(vg))));

    /// <summary>A leaf feeding two consumers is ONE node, referenced by its name twice — fan-out
    /// preserved exactly (the whole reason we name instead of inline).</summary>
    [Fact]
    public void Leaf_fanout_is_one_node_referenced_twice()
    {
        var vg = Vg(
            "<inVariable localId='1'><expression>a</expression></inVariable>" +
            "<outVariable localId='2'><expression>x</expression><connectionPointIn><connection refLocalId='1'/></connectionPointIn></outVariable>" +
            "<outVariable localId='3'><expression>y</expression><connectionPointIn><connection refLocalId='1'/></connectionPointIn></outVariable>");

        Assert.Contains("i1 := a;", vg);
        Assert.Contains("x := i1;", vg);
        Assert.Contains("y := i1;", vg);
        // exactly one leaf node survives a parse — not duplicated
        Assert.Single(VgParser.Parse(vg).Networks.SelectMany(n => n.Nodes).OfType<InVar>());
        Assert.Equal(vg, FullRoundTrip(vg));   // fixed point
    }

    /// <summary>Two distinct inVariable nodes with the SAME text stay TWO nodes — identity is the
    /// node, not the text.</summary>
    [Fact]
    public void Two_separate_leaves_same_text_stay_distinct()
    {
        var vg = Vg(
            "<inVariable localId='1'><expression>a</expression></inVariable>" +
            "<inVariable localId='2'><expression>a</expression></inVariable>" +
            "<outVariable localId='3'><expression>x</expression><connectionPointIn><connection refLocalId='1'/></connectionPointIn></outVariable>" +
            "<outVariable localId='4'><expression>y</expression><connectionPointIn><connection refLocalId='2'/></connectionPointIn></outVariable>");

        Assert.Contains("i1 := a;", vg);
        Assert.Contains("i2 := a;", vg);
        Assert.Equal(2, VgParser.Parse(vg).Networks.SelectMany(n => n.Nodes).OfType<InVar>().Count());
        Assert.Equal(vg, FullRoundTrip(vg));
    }

    /// <summary>An inVariable whose pin text contains operators (`a + 1`) is ONE opaque leaf node —
    /// never decomposed into operator blocks.</summary>
    [Fact]
    public void Opaque_leaf_with_operators_stays_one_node()
    {
        var vg = Vg(
            "<inVariable localId='1'><expression>a + 1</expression></inVariable>" +
            "<outVariable localId='2'><expression>x</expression><connectionPointIn><connection refLocalId='1'/></connectionPointIn></outVariable>");

        Assert.Contains("i1 := a + 1;", vg);
        var nodes = VgParser.Parse(vg).Networks.SelectMany(n => n.Nodes).ToList();
        Assert.Single(nodes.OfType<InVar>());
        Assert.Equal("a + 1", nodes.OfType<InVar>().Single().Expression);
        Assert.Empty(nodes.OfType<Block>());           // not decomposed into an ADD block
        Assert.Equal(vg, FullRoundTrip(vg));
    }

    /// <summary>The VAR_TEMP is a VG-only construct: parsing it produces NO graph nodes, so the
    /// PLCopen the bridge pushes carries neither the temp declarations nor the temp names — and no
    /// fabricated types (the IDE reconstructs them).</summary>
    [Fact]
    public void Var_temp_is_stripped_on_push()
    {
        const string vg =
            "NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n    g1 : BOOL;\n  END_VAR\n" +
            "  i1 := a;\n  i2 := b;\n  g1 := (i1 AND i2);\n  out := g1;\nEND_NETWORK\n";
        var xml = PlcOpenWriter.WriteBody(VgParser.Parse(vg)).ToString();

        Assert.DoesNotContain("VAR_TEMP", xml);
        Assert.DoesNotContain("i1", xml);              // temp names never reach the IDE
        Assert.DoesNotContain("g1", xml);
        Assert.DoesNotContain("BOOL", xml);            // no fabricated types (operator inputs are empty)
        Assert.Contains("inputparamtypes", xml);       // the (empty) param-types addData is still emitted
    }

    /// <summary>A control-flow-only network (no leaves, no results) emits no VAR_TEMP block.</summary>
    [Fact]
    public void Var_temp_omitted_for_control_flow_only_network()
    {
        var vg = VgWriter.Write(VgParser.Parse("NETWORK 0 FBD\n  myLabel:\n  JMP myLabel;\nEND_NETWORK\n"));
        Assert.DoesNotContain("VAR_TEMP", vg);
    }

    /// <summary>FB/function param types survive read → write → read (the SR fixture's BOOL BOOL),
    /// so the VAR_TEMP can declare real types when the IDE supplies them.</summary>
    [Fact]
    public void Param_types_round_trip()
    {
        var fbd = PlcOpenDocument.FindFbdLdBody(
            System.IO.File.ReadAllText(System.IO.Path.Combine(
                System.AppContext.BaseDirectory, "fixtures", "tc-fbd", "PLC_PRG_jump_sr.plcopen.xml")))!;
        var g = PlcOpenReader.ReadBody(fbd);
        var sr = g.Networks.SelectMany(n => n.Nodes).OfType<Block>().Single(b => b.TypeName == "SR");
        Assert.All(sr.Inputs, p => Assert.Equal("BOOL", p.Type));   // SET1/RESET typed from inputparamtypes

        var g2 = PlcOpenReader.ReadBody(PlcOpenWriter.WriteBody(g));
        var sr2 = g2.Networks.SelectMany(n => n.Nodes).OfType<Block>().Single(b => b.TypeName == "SR");
        Assert.All(sr2.Inputs, p => Assert.Equal("BOOL", p.Type));  // survived the rewrite
    }

    /// <summary>Synthetic temp names skip real FB-instance names, so a POU with an instance named
    /// "g1" doesn't collide with an operator result — both keep distinct names and round-trip.</summary>
    [Fact]
    public void Synthetic_names_skip_real_instance_names()
    {
        var vg = Vg(
            "<inVariable localId='1'><expression>a</expression></inVariable>" +
            "<inVariable localId='2'><expression>b</expression></inVariable>" +
            "<block localId='3' typeName='AND'><inputVariables>" +
            "<variable formalParameter='IN1'><connectionPointIn><connection refLocalId='1'/></connectionPointIn></variable>" +
            "<variable formalParameter='IN2'><connectionPointIn><connection refLocalId='2'/></connectionPointIn></variable>" +
            "</inputVariables><outputVariables><variable formalParameter='OUT'><connectionPointOut/></variable></outputVariables></block>" +
            "<block localId='4' typeName='TON' instanceName='g1'><inputVariables>" +
            "<variable formalParameter='IN'><connectionPointIn><connection refLocalId='3'/></connectionPointIn></variable>" +
            "</inputVariables><outputVariables><variable formalParameter='Q'><connectionPointOut/></variable></outputVariables></block>");

        Assert.Contains("g2 := (i1 AND i2);", vg);   // operator dodged the reserved name g1
        Assert.Contains("g1(IN := g2);", vg);        // FB instance keeps its real name g1
        Assert.DoesNotContain("g1 := (", vg);        // no operator named g1
        Assert.Equal(vg, FullRoundTrip(vg));
    }

    /// <summary>A leaf with its OWN modifier that fans out is one node: the modifier renders once on
    /// the leaf's RHS and both consumers reference it by name.</summary>
    [Fact]
    public void Modified_leaf_fanout_is_one_node()
    {
        var vg = Vg(
            "<inVariable localId='1' negated='true'><expression>x</expression></inVariable>" +
            "<outVariable localId='2'><expression>a</expression><connectionPointIn><connection refLocalId='1'/></connectionPointIn></outVariable>" +
            "<outVariable localId='3'><expression>b</expression><connectionPointIn><connection refLocalId='1'/></connectionPointIn></outVariable>");

        Assert.Contains("i1 := NOT x;", vg);   // own modifier on the leaf RHS, once
        Assert.Contains("a := i1;", vg);
        Assert.Contains("b := i1;", vg);
        Assert.Single(VgParser.Parse(vg).Networks.SelectMany(n => n.Nodes).OfType<InVar>());
        Assert.Equal(vg, FullRoundTrip(vg));
    }

    // ── structure is ENFORCED, not tolerated: malformed graphical must be refused (it can corrupt the
    //    IDE on import), never silently reshaped. ─────────────────────────────────────────────────────
    [Fact]
    public void Network_not_closed_by_END_NETWORK_is_refused()
    {
        var ex = Assert.Throws<VgParseException>(() => VgParser.Parse(
            "NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n  END_VAR\n  i1 := a;\n  q := i1;\n"));   // no END_NETWORK
        Assert.Contains("END_NETWORK", ex.Message);
    }

    [Fact]
    public void Network_not_closed_before_the_next_network_is_refused()
    {
        var ex = Assert.Throws<VgParseException>(() => VgParser.Parse(
            "NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n  END_VAR\n  i1 := a;\n  q := i1;\n" +
            "NETWORK 1 FBD\n  VAR_TEMP\n    j : BOOL;\n  END_VAR\n  j := b;\n  r := j;\nEND_NETWORK\n"));
        Assert.Contains("END_NETWORK", ex.Message);
    }

    [Fact]
    public void Var_temp_not_closed_by_END_VAR_is_refused()
    {
        var ex = Assert.Throws<VgParseException>(() => VgParser.Parse(
            "NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n  i1 := a;\n  q := i1;\nEND_NETWORK\n"));   // no END_VAR
        Assert.Contains("END_VAR", ex.Message);
    }
}
