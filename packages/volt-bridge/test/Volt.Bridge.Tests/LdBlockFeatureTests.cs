using System.IO;
using System;
using Volt.Bridge.Core.Graphical;
using Volt.Bridge.Core.Graphical.Vg;
using Xunit;

namespace Volt.Bridge.Tests;

/// <summary>
/// Coverage for the LD/graphical features landed this cycle — each grounded in the live-verified behaviour
/// (TwinCAT + CODESYS) and the real captured fixture (fixtures/tc-ld), not hand-authored assumptions:
///  - an FB/operator block on a ladder rung round-trips (boolean output → coil, non-boolean output → embedded
///    expression in the pin), as a graph→write→read fixed point matching the live `after == after2`;
///  - the round-trip gate / parser carry structured diagnostics (stable Code + 1-based Line);
///  - GraphicalCode.Validate is pure (no IDE) so a refused push never creates a stub.
/// </summary>
public class LdBlockFeatureTests
{
    // VG → PLCopen → VG, resolving an FB instance's type (VG carries no types). Mirrors the live round-trip.
    private static string Rt(string vg) => GraphicalRoundTrip.ToVg(vg, _ => "TON");

    private const string TonRung =
        "NETWORK 0 LD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n  END_VAR\n"
        + "  i1 := enable;\n  i2 := pt;\n  t1(IN := i1, PT := i2);\n  done := t1.Q;\n  elapsed := t1.ET;\nEND_NETWORK\n";

    [Fact]
    public void Fb_on_a_rung_emits_boolean_output_as_coil_and_nonboolean_as_embedded_expression()
    {
        var xml = PlcOpenWriter.WriteBody(VgParser.Parse(TonRung), _ => "TON").ToString();
        Assert.Contains("<coil", xml);                 // boolean Q drives a coil (TC drops a boolean embedded in the pin)
        Assert.Contains("<block", xml);                // the TON block
        Assert.Contains("elapsed", xml);               // the non-boolean ET assignment is present...
        Assert.DoesNotContain("TIME", xml);            // ...and NOT as a TIME coil (which empties TC's export)
        // it rides as an <expression> inside an output pin's connectionPointOut, never its own coil
        Assert.Matches("connectionPointOut[^<]*>\\s*<expression>elapsed", xml.Replace("\r", "").Replace("\n", "").Replace("  ", ""));
    }

    [Fact]
    public void Fb_on_a_rung_round_trips_as_a_fixed_point()
    {
        var back1 = Rt(TonRung);
        var back2 = Rt(back1);
        Assert.Equal(back1, back2);                    // fixed point — matches the live after == after2 on both vendors
        Assert.Contains("t1(IN := i1, PT := i2)", back1);
        Assert.Contains("done := t1.Q", back1);        // boolean output preserved (coil)
        Assert.Contains("elapsed := t1.ET", back1);    // non-boolean output preserved (embedded)
        // the coil (boolean primary) precedes the embedded data output — the canonical order that keeps it stable
        Assert.True(back1.IndexOf("done := t1.Q", StringComparison.Ordinal) < back1.IndexOf("elapsed := t1.ET", StringComparison.Ordinal));
    }

    [Fact]
    public void Validate_is_pure_and_rejects_a_non_canonical_body_with_a_structured_code()
    {
        // GraphicalCode.Validate runs the language gate + parser + round-trip gate WITHOUT touching the IDE —
        // it is the check PushService runs before CreateChild so a refusal never leaves an orphan stub.
        var nonCanonical = "NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n    gX : BOOL;\n  END_VAR\n"
            + "  i1 := a;\n  i2 := b;\n  gX := (i1 AND i2);\n  out := gX;\nEND_NETWORK\n";
        var ex = Assert.Throws<VgParseException>(() => GraphicalCode.Validate(nonCanonical));
        Assert.Equal("VG_NOT_CANONICAL", ex.Code);
        Assert.NotNull(ex.Line);
        Assert.Contains("g1 := (i1 AND i2)", ex.Message);   // the canonical form is shown
    }

    [Theory]
    [InlineData("g2 := NOT g1", "VG_LEAF_REFERENCES_TEMP")]          // a NOT of a temp on its own line
    [InlineData("g3 := (i1 FOO i2)", "VG_UNKNOWN_OPERATOR")]         // not an operator
    [InlineData("g3 := (i1 AND i2 OR i1)", "VG_MIXED_OPERATORS")]    // two operators in one statement
    public void VgParser_throws_carry_a_stable_code_and_line(string stmt, string code)
    {
        var net = "NETWORK 1 FBD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n    g1 : BOOL;\n    g2 : BOOL;\n    g3 : BOOL;\n  END_VAR\n"
            + "  i1 := a;\n  i2 := b;\n  g1 := (i1 AND i2);\n  " + stmt + ";\n  out := g1;\nEND_NETWORK\n";
        var ex = Assert.Throws<VgParseException>(() => VgParser.Parse(net));
        Assert.Equal(code, ex.Code);
        Assert.NotNull(ex.Line);
    }
}
