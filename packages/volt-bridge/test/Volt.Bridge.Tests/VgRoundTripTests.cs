using Volt.Bridge.Core.Graphical.Vg;
using Xunit;

namespace Volt.Bridge.Tests;

public class VgRoundTripTests
{
    private static string Round(string vg) => VgWriter.Write(VgParser.Parse(vg));

    [Theory]
    // Each of these shapes must CONVERGE to a fixed point through the readable-VG round-trip. We assert
    // idempotence — Round(Round(x)) == Round(x) — not equality to a hardcoded canonical string: the canonical
    // form is implementation-defined (the writer inlines single-use wires, names only fan-out), so pinning an
    // exact string is brittle. Inputs here introduce internal wires with the inline `LET <name> := …` form —
    // they must still parse and settle. (The exact canonical text is pinned separately in VgWriterTests.)
    [InlineData("NETWORK 0 FBD\n  LET i1 := FALSE;\n  LET i2 := TRUE;\n  LET i3 := TRUE;\n  Config(xFASTSystemInTaskMidPrio := i1, xLogErrorTypeInformation := i2, xLogErrorTypeWarning := i3);\nEND_NETWORK\n")]
    [InlineData("NETWORK 0 FBD\n  LET i1 := A;\n  LET i2 := B;\n  LET i3 := C;\n  LET g1 := (i1 AND i2);\n  LET g2 := (g1 OR i3);\n  result := g2;\nEND_NETWORK\n")]
    [InlineData("NETWORK 0 FBD\n  LET i1 := start;\n  LET i2 := pt;\n  t1(IN := i1, PT := i2);\n  running := t1.Q;\n  elapsed := t1.ET;\nEND_NETWORK\n")]
    [InlineData("NETWORK 0 FBD \"my label\"\n  LET i1 := a;\n  LET i2 := b;\n  LET g1 := (i1 OR i2);\n  out := g1;\nEND_NETWORK\n")]
    // LD is the same structure as FBD — only the language token on the marker differs (view toggle).
    [InlineData("NETWORK 0 LD\n  LET i1 := a;\n  LET i2 := b;\n  LET g1 := (i1 AND i2);\n  out := g1;\nEND_NETWORK\n")]
    // modifiers ride on the REFERENCE: negation (NOT), edge (RISING/FALLING), storage (SET/RESET)
    [InlineData("NETWORK 0 FBD\n  LET i1 := a;\n  LET i2 := b;\n  LET g1 := (NOT i1 AND i2);\n  out := g1;\nEND_NETWORK\n")]
    [InlineData("NETWORK 0 FBD\n  LET i1 := clk;\n  t1(CLK := i1 RISING);\nEND_NETWORK\n")]
    [InlineData("NETWORK 0 FBD\n  LET i1 := a;\n  LET i2 := b;\n  LET g1 := (i1 OR i2);\n  out := g1 SET;\nEND_NETWORK\n")]
    [InlineData("NETWORK 0 FBD\n  LET i1 := x;\n  fb(IN := NOT i1);\nEND_NETWORK\n")]
    // a leaf's OWN modifier rides on its RHS
    [InlineData("NETWORK 0 FBD\n  LET i1 := NOT x;\n  fb(IN := i1);\nEND_NETWORK\n")]
    // an empty network (or one whose only content was a dropped opaque/vendor node) keeps its
    // delimiters and has no internal wires
    [InlineData("NETWORK 0 FBD\nEND_NETWORK\n")]
    // control flow: labels, jumps, returns (valid CODESYS ST) — conditions are named leaves
    [InlineData("NETWORK 0 FBD\n  myLabel:\nEND_NETWORK\n")]
    [InlineData("NETWORK 0 FBD\n  JMP myLabel;\nEND_NETWORK\n")]
    [InlineData("NETWORK 0 FBD\n  LET i1 := cond;\n  IF i1 THEN JMP myLabel; END_IF\nEND_NETWORK\n")]
    [InlineData("NETWORK 0 FBD\n  LET i1 := cond;\n  IF NOT i1 THEN JMP myLabel; END_IF\nEND_NETWORK\n")]
    [InlineData("NETWORK 0 FBD\n  RETURN;\nEND_NETWORK\n")]
    [InlineData("NETWORK 0 FBD\n  LET i1 := done;\n  IF i1 THEN RETURN; END_IF\nEND_NETWORK\n")]
    public void Vg_text_converges_to_a_fixed_point(string vg) => Assert.Equal(Round(vg), Round(Round(vg)));

    [Theory]
    [InlineData("  x := y;\n")]                                                       // statement before any NETWORK
    [InlineData("NETWORK 0 FBD\n  out := (a AND b OR c);\nEND_NETWORK\n")]             // mixed operators in one parenthesised group
    [InlineData("NETWORK 0 FBD\n  out := ((a AND b);\nEND_NETWORK\n")]                 // unbalanced parens
    public void Malformed_input_is_rejected(string vg)
        => Assert.ThrowsAny<System.Exception>(() => VgParser.Parse(vg));
}
