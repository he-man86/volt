using System;
using Xunit;
using Volt.Engine.Format.Network;

namespace Volt.Cli.Tests;

public class NetworkTextRoundTripTests
{
    private static string Round(string net) => NetworkTextWriter.Write(NetworkTextReader.Parse(net));

    [Theory]
    // Each of these shapes must CONVERGE to a fixed point through the readable-network-text round-trip. We assert
    // idempotence — Round(Round(x)) == Round(x) — not equality to a hardcoded canonical string: the canonical
    // form is implementation-defined (the writer inlines single-use wires, names only fan-out), so pinning an
    // exact string is brittle. Inputs here introduce internal wires with the inline `LET <name> := …` form —
    // they must still parse and settle. (The exact canonical text is pinned separately in NetworkTextWriterTests.)
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
    public void Network_text_converges_to_a_fixed_point(string net) => Assert.Equal(Round(net), Round(Round(net)));

    [Theory]
    [InlineData("  x := y;\n")]                                                       // statement before any NETWORK
    [InlineData("NETWORK 0 FBD\n  out := (a AND b OR c);\nEND_NETWORK\n")]             // mixed operators in one parenthesised group
    [InlineData("NETWORK 0 FBD\n  out := ((a AND b);\nEND_NETWORK\n")]                 // unbalanced parens
    public void Malformed_input_is_rejected(string net)
        => Assert.ThrowsAny<System.Exception>(() => NetworkTextReader.Parse(net));

    /// <summary>A MODIFIER never forces a hoist. The writer used to test the RENDERED operand for inline
    /// safety, and "NOT b" contains a space, so every negated operand at operand position was hoisted to
    /// `LET i1 := NOT b;`. Per network-text.md §6 an `i*` name is minted for an OPAQUE LEAF - arbitrary
    /// inlined ST - and a modifier is grammar the parser reads inline (Cursor.Operand), so no name was due.
    /// <para>Found by the live splice e2e: an engineer editing a rung to `(a AND NOT b)` had their push
    /// refused by the canonical-form gate, which told them to write Volt's spelling instead.</para></summary>
    [Theory]
    [InlineData("out := (a AND NOT b);")]
    [InlineData("out := (NOT a AND b);")]
    [InlineData("out := (a AND b RISING);")]
    [InlineData("out := (NOT a AND NOT b);")]
    public void A_modifier_on_an_operand_does_not_force_a_hoisted_LET(string statement)
    {
        var text = "NETWORK 0 FBD\n  " + statement + "\nEND_NETWORK\n";

        var written = Round(text);

        Assert.DoesNotContain("LET i", written);
        Assert.Equal(text.Trim(), written.Trim());
    }

    /// <summary>The hoist still happens for what it is FOR: an operand whose OWN text cannot sit inline,
    /// because it would mis-split the operator group or mis-parse as a call. Such a leaf comes from the IDE,
    /// not from text - network text has no precedence, so `arr[j + 1]` does not parse as a source - so the
    /// model is built directly here rather than read.</summary>
    [Fact]
    public void An_operand_whose_own_text_is_unsafe_is_still_hoisted()
    {
        var opaque = new Leaf(new Operand("arr[j + 1]"), Flags.None);
        var body = new NetworkBody(BodyLanguage.Fbd, new[]
        {
            new Network(0, null, null, null, false, new Node[]
            {
                new Assign(
                    new Box("AND", null, CallKind.Operator,
                            new[] { new Input(null, new Leaf(new Operand("a"), Flags.None), Flags.None),
                                    new Input(null, opaque, Flags.None) },
                            Array.Empty<Operand>(), null, null, Flags.None),
                    new[] { new Operand("out") },
                    Flags.None),
            }, Array.Empty<Operand>()),
        });

        var written = NetworkTextWriter.Write(body);

        Assert.Contains("LET i1 := arr[j + 1];", written);
        Assert.Contains("out := (a AND i1);", written);
    }
}
