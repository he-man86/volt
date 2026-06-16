using Volt.Bridge.Core.Graphical.Vg;
using Xunit;

namespace Volt.Bridge.Tests;

public class VgRoundTripTests
{
    private static string Round(string vg) => VgWriter.Write(VgParser.Parse(vg));

    [Theory]
    // Each network is a delimited block: NETWORK <index> <LANG> … END_NETWORK. Every node is its own
    // named statement; literals/variables are leaves (i*) declared in the per-network VAR_TEMP;
    // results are g*; FB instances keep their real name; sinks keep their target.
    [InlineData("NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n    i3 : BOOL;\n  END_VAR\n  i1 := FALSE;\n  i2 := TRUE;\n  i3 := TRUE;\n  Config(xFASTSystemInTaskMidPrio := i1, xLogErrorTypeInformation := i2, xLogErrorTypeWarning := i3);\nEND_NETWORK\n")]
    [InlineData("NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n    i3 : BOOL;\n    g1 : BOOL;\n    g2 : BOOL;\n  END_VAR\n  i1 := A;\n  i2 := B;\n  i3 := C;\n  g1 := (i1 AND i2);\n  g2 := (g1 OR i3);\n  result := g2;\nEND_NETWORK\n")]
    [InlineData("NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n  END_VAR\n  i1 := start;\n  i2 := pt;\n  t1(IN := i1, PT := i2);\n  running := t1.Q;\n  elapsed := t1.ET;\nEND_NETWORK\n")]
    [InlineData("NETWORK 0 FBD \"my label\"\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n    g1 : BOOL;\n  END_VAR\n  i1 := a;\n  i2 := b;\n  g1 := (i1 OR i2);\n  out := g1;\nEND_NETWORK\n")]
    // LD is the same structure as FBD — only the language token on the marker differs (view toggle).
    [InlineData("NETWORK 0 LD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n    g1 : BOOL;\n  END_VAR\n  i1 := a;\n  i2 := b;\n  g1 := (i1 AND i2);\n  out := g1;\nEND_NETWORK\n")]
    // modifiers ride on the REFERENCE: negation (NOT), edge (RISING/FALLING), storage (SET/RESET)
    [InlineData("NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n    g1 : BOOL;\n  END_VAR\n  i1 := a;\n  i2 := b;\n  g1 := (NOT i1 AND i2);\n  out := g1;\nEND_NETWORK\n")]
    [InlineData("NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n  END_VAR\n  i1 := clk;\n  t1(CLK := i1 RISING);\nEND_NETWORK\n")]
    [InlineData("NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n    g1 : BOOL;\n  END_VAR\n  i1 := a;\n  i2 := b;\n  g1 := (i1 OR i2);\n  out := g1 SET;\nEND_NETWORK\n")]
    [InlineData("NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n  END_VAR\n  i1 := x;\n  fb(IN := NOT i1);\nEND_NETWORK\n")]
    // a leaf's OWN modifier rides on its RHS
    [InlineData("NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n  END_VAR\n  i1 := NOT x;\n  fb(IN := i1);\nEND_NETWORK\n")]
    // an empty network (or one whose only content was a dropped opaque/vendor node) keeps its
    // delimiters and omits VAR_TEMP
    [InlineData("NETWORK 0 FBD\nEND_NETWORK\n")]
    // control flow: labels, jumps, returns (valid CODESYS ST) — conditions are named leaves
    [InlineData("NETWORK 0 FBD\n  myLabel:\nEND_NETWORK\n")]
    [InlineData("NETWORK 0 FBD\n  JMP myLabel;\nEND_NETWORK\n")]
    [InlineData("NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n  END_VAR\n  i1 := cond;\n  IF i1 THEN JMP myLabel; END_IF\nEND_NETWORK\n")]
    [InlineData("NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n  END_VAR\n  i1 := cond;\n  IF NOT i1 THEN JMP myLabel; END_IF\nEND_NETWORK\n")]
    [InlineData("NETWORK 0 FBD\n  RETURN;\nEND_NETWORK\n")]
    [InlineData("NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n  END_VAR\n  i1 := done;\n  IF i1 THEN RETURN; END_IF\nEND_NETWORK\n")]
    public void Vg_text_is_a_fixed_point(string vg) => Assert.Equal(vg, Round(vg));

    [Theory]
    [InlineData("NETWORK 0 FBD\n  result := A AND B OR C;\nEND_NETWORK\n")]                                       // multi-operator in one statement
    [InlineData("  x := y;\n")]                                                                                   // statement before any NETWORK
    [InlineData("NETWORK 0 FBD\n  VAR_TEMP\n    g1 : BOOL;\n  END_VAR\n  g1 := (TRUE AND FALSE);\nEND_NETWORK\n")]  // inline literal operand (must be its own leaf)
    [InlineData("NETWORK 0 FBD\n  VAR_TEMP\n    g1 : BOOL;\n  END_VAR\n  g1 := (i1 AND i2);\n  out := g1;\nEND_NETWORK\n")] // undeclared name reference
    public void Non_convertible_input_is_rejected(string vg)
        => Assert.ThrowsAny<System.Exception>(() => VgParser.Parse(vg));
}
