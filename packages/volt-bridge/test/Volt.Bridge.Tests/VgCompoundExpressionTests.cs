using System.Linq;
using Volt.Bridge.Core.Graphical;
using Volt.Bridge.Core.Graphical.Vg;
using Xunit;

namespace Volt.Bridge.Tests;

/// <summary>
/// Regression: a NESTED/compound expression in a graphical body must be REFUSED, not silently turned into an
/// opaque leaf that references the per-network VAR_TEMP names. Those temps are stripped on push, so the
/// generated PLCopen XML referenced symbols that don't exist in the IDE → TwinCAT threw on import ("Creation
/// of object 'fbd' failed … Object reference not set"). The bridge owns FORMAT and must refuse cleanly,
/// before any IDE write — never emit IDE-corrupting XML.
/// </summary>
public class VgCompoundExpressionTests
{
    private static string Net(string body) =>
        "NETWORK 1 FBD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n    i3 : BOOL;\n    g1 : BOOL;\n  END_VAR\n"
        + body + "END_NETWORK\n";

    [Fact]
    public void Nested_expression_referencing_temps_is_refused()
    {
        // g1 := (i1 AND i2) OR i3 — slips past the single "(…)" operator path (no closing paren) and would
        // otherwise become an opaque inVariable citing the stripped temps i1/i2/i3.
        var src = Net("  i1 := FALSE;\n  i2 := TRUE;\n  i3 := FALSE;\n  g1 := (i1 AND i2) OR i3;\n  outpur := g1;\n");
        var ex = Assert.Throws<VgParseException>(() => VgParser.Parse(src));
        Assert.Contains("one operation", ex.Message.ToLowerInvariant().Replace("only ", "").Replace("carry ", ""));
        Assert.Contains("i1", ex.Message);   // names the offending temp
    }

    [Fact]
    public void The_decomposed_strict_form_is_accepted_and_round_trips()
    {
        // The supported way to write the same logic: one operation per statement.
        var src = Net(
            "  i1 := FALSE;\n  i2 := TRUE;\n  i3 := FALSE;\n" +
            "  g0 := (i1 AND i2);\n  g1 := (g0 OR i3);\n  outpur := g1;\n").Replace("    g1 : BOOL;", "    g0 : BOOL;\n    g1 : BOOL;");
        var graph = VgParser.Parse(src);
        var blocks = graph.Networks[0].Nodes.OfType<Block>().ToList();
        Assert.Equal(2, blocks.Count);                                  // an AND block and an OR block
        Assert.Contains(blocks, b => b.TypeName == "AND");
        Assert.Contains(blocks, b => b.TypeName == "OR");
        // and it writes without throwing (the inverse is exercised by PlcOpenWriter)
        var xml = PlcOpenWriter.WriteBody(graph).ToString();
        Assert.Contains("OR", xml);
    }

    [Fact]
    public void Not_of_a_temp_on_its_own_line_is_refused()
    {
        // g2 := NOT g1 — in FBD a NOT is a PIN modifier, not a node; this derives g2 from the temp g1.
        var src = "NETWORK 1 FBD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n    g1 : BOOL;\n    g2 : BOOL;\n  END_VAR\n"
            + "  i1 := TRUE;\n  i2 := FALSE;\n  g1 := (i1 OR i2);\n  g2 := NOT g1;\n  outpur := g2;\nEND_NETWORK\n";
        var ex = Assert.Throws<VgParseException>(() => VgParser.Parse(src));
        Assert.Contains("NOT g1", ex.Message);                       // names the offending statement
        Assert.Contains("consumer", ex.Message.ToLowerInvariant());  // tells the user to fold it onto the consumer
    }

    [Fact]
    public void Invert_an_OUTPUT_with_NOT_on_the_sink()
    {
        // outpur := NOT g1 — the negation rides on the sink (the supported way to invert an output).
        var src = "NETWORK 1 FBD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n    g1 : BOOL;\n  END_VAR\n"
            + "  i1 := TRUE;\n  i2 := FALSE;\n  g1 := (i1 OR i2);\n  outpur := NOT g1;\nEND_NETWORK\n";
        var graph = VgParser.Parse(src);
        Assert.Single(graph.Networks[0].Nodes.OfType<Block>());      // just the OR block — no phantom NOT node
        Assert.Contains("negated", PlcOpenWriter.WriteBody(graph).ToString().ToLowerInvariant());
    }

    [Fact]
    public void Invert_an_INPUT_with_NOT_on_the_operand_or_leaf()
    {
        // NOT on an operand inside the operation, AND on a leaf reading a real variable — both supported.
        var src = "NETWORK 1 FBD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n    g1 : BOOL;\n  END_VAR\n"
            + "  i1 := NOT someVar;\n  i2 := FALSE;\n  g1 := (NOT i1 AND i2);\n  outpur := g1;\nEND_NETWORK\n";
        var graph = VgParser.Parse(src);                              // must not throw
        Assert.Contains("negated", PlcOpenWriter.WriteBody(graph).ToString().ToLowerInvariant());
    }

    [Fact]
    public void Negation_round_trips_through_plcopen_as_a_pin_modifier()
    {
        // The supported inversions — NOT on an input operand and on the output sink — are exactly what
        // VgWriter emits and what PLCopenXML stores (negated="true" on the pin/variable). They MUST survive
        // VG → PLCopen → VG unchanged, or hand-edited inversions wouldn't round-trip.
        var vg = "NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n    g1 : BOOL;\n  END_VAR\n"
            + "  i1 := a;\n  i2 := b;\n  g1 := (NOT i1 AND i2);\n  out := NOT g1;\nEND_NETWORK\n";
        var back = GraphicalRoundTrip.ToVg(vg);
        Assert.Equal(vg, back);   // fixed point
    }

    [Fact]
    public void Leaf_negation_is_encoded_as_expression_text_not_the_attribute()
    {
        // TwinCAT drops `negated` on an <inVariable>, so a negated leaf carries NOT in the EXPRESSION text
        // (both IDEs round-trip expression text verbatim). Edge/storage would stay attrs.
        var vg = "NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n  END_VAR\n  i1 := NOT x;\n  out := i1;\nEND_NETWORK\n";
        var graph = VgParser.Parse(vg);
        var xml = PlcOpenWriter.WriteBody(graph).ToString();
        Assert.Contains("NOT x", xml);                            // negation is in the expression
        Assert.DoesNotContain("negated", xml.ToLowerInvariant()); // NOT as a `negated` attribute
        var back = GraphicalRoundTrip.ToVg(graph);
        Assert.Equal(vg, back);                                   // read↔write symmetric (bridge fixed point)
    }

    [Fact]
    public void Output_negation_stays_a_negated_outVariable_attribute()
    {
        // TC HANDLES `negated` on an outVariable — keep it there, don't move it into expression text.
        var vg = "NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n  END_VAR\n  i1 := x;\n  out := NOT i1;\nEND_NETWORK\n";
        var xml = PlcOpenWriter.WriteBody(VgParser.Parse(vg)).ToString();
        Assert.Contains("outVariable", xml);
        Assert.Contains("negated", xml.ToLowerInvariant());       // output negation stays an attribute
        Assert.DoesNotContain("NOT i1", xml);                     // not moved into text
    }
}
