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
}
