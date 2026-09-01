using System;
using Xunit;
using Volt.Engine.Format.Network;

namespace Volt.Engine.Tests;

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
    // -- SHAPES A REAL PROJECT ACTUALLY CONTAINS --------------------------------------------------
    //
    // Every case below comes from Lenze_MID-S100_V5_00_602_T51 - 373 graphical networks drawn by
    // engineers, not by Volt. Pulled through the CODESYS bridge and fed straight back into this gate,
    // 152 of them were REFUSED by Volt's own reader: text the writer had just produced and could not read
    // back, which means those POUs could be pulled and never pushed again. That is what this theory
    // exists to keep out.
    //
    // These assert EXACT canonical text rather than convergence. Idempotence would have passed on most of
    // them while quietly changing the body - an unconnected pin dropped, a wire dissolved, a NOT box
    // turned into a flag - which is a good part of why several survived as long as they did.
    //
    // AN UNCONNECTED PIN renders as an empty slot, and reads back as the terminator the vendor holds.
    // There is no magic token for it: `?` was tried and withdrawn, because CODESYS writes `???` into a
    // box whose instance is unresolved - a real compile error the engineer must SEE - and this project
    // holds five of them, one of them an assignment target.
    [InlineData("NETWORK 0 LD\n  ( * iRPM * 6);\nEND_NETWORK\n")]   // pin 0 of a MUL box: 14 in the project
    [InlineData("NETWORK 0 FBD\n  ctu(CU := a, RESET := , PV := );\nEND_NETWORK\n")]   // named pins with nothing on them: 12
    [InlineData("NETWORK 0 FBD\n  f(, a);\nEND_NETWORK\n")]   // a leading positional slot
    [InlineData("NETWORK 0 FBD\n  f(a, );\nEND_NETWORK\n")]   // a TRAILING slot - dropped until the arg loop followed commas
    [InlineData("NETWORK 0 LD\n  coil := ;\nEND_NETWORK\n")]   // a rung nothing drives
    [InlineData("NETWORK 0 LD\n  ;\nEND_NETWORK\n")]   // an item wired to nothing at all
    //
    // A POSITIONAL CALL STANDS ALONE. `MOVE(g0, iDec);` - a box with EN wired and its output connected
    // to nothing - is a bare statement in 34 networks; the reader used to refuse every one of them.
    [InlineData("NETWORK 0 LD\n  MOVE(a, b);\nEND_NETWORK\n")]
    //
    // A NOT BOX IS NOT THE NEGATION MODIFIER. Both are FBD and they draw differently - a box item versus
    // a dot on a pin - and they are told apart by the parenthesis being adjacent, which is exactly how
    // the two emitters already write them.
    [InlineData("NETWORK 0 FBD\n  out := NOT(a);\nEND_NETWORK\n")]   // the box
    [InlineData("NETWORK 0 FBD\n  out := NOT a;\nEND_NETWORK\n")]   // the modifier
    //
    // A FAN-OUT WIRE USED ONCE IS STILL A WIRE - the vendor holds a `BoxTreeDemux`, a branch point drawn
    // on the rung, and a use-count heuristic deleted it whenever only one consumer read it.
    [InlineData("NETWORK 0 LD\n  LET g28 := (a AND b);\n  out := f(IN := g28);\nEND_NETWORK\n")]
    //
    // AN OPAQUE LEAF STAYS A LEAF. `LET i<n> := <text>` is ONE `inVariable` whose text is not a safe
    // token; parsing it turned that single variable into a whole call box, which the next push would
    // then have BUILT in the IDE.
    [InlineData("NETWORK 0 FBD\n  LET i1 := DINT_TO_REAL(x);\n  t1(IN := i1);\nEND_NETWORK\n")]   // 23 networks
    //
    // A QUOTED TITLE, A DOTTED NAME AN ENGINEER SPACED OUT, AND A COMMENT THEY INDENTED. All three are
    // text the engineer typed, and all three came back changed.
    [InlineData("NETWORK 0 LD \"Muting of alarm \"\"No bunch\"\"\"\n  out := a;\nEND_NETWORK\n")]   // a quote in the title, doubled
    [InlineData("NETWORK 0 FBD\n  out := scSimulationDowntimes .uiMaxSimulationEvents;\nEND_NETWORK\n")]   // the space is the engineer's
    [InlineData("NETWORK 0 FBD\n  //     indented on purpose\n  out := a;\nEND_NETWORK\n")]   // alignment is content
    //
    // DISABLED IS A HEADER KEYWORD, not a word in a title - a network titled with it used to switch
    // itself off on the way back in.
    [InlineData("NETWORK 0 LD \"DISABLED during commissioning\"\n  out := a;\nEND_NETWORK\n")]
    //
    //
    // A NETWORK'S LABEL COMES BEFORE ITS COMMENT, mirroring the IDE's own header layout (the label above the
    // single comment box). The reader takes them in either order, so this pins the CANONICAL one — and it is
    // canonical this way round so that writing a network the way the IDE displays it is not refused. It was
    // the other way for a while, which made the one thing engineers hand-write the one thing the gate
    // rejected, for no reason the model or either vendor had an opinion about.
    [InlineData("NETWORK 0 LD \"interlock\"\n  Guard:\n  // holds the drive off while the guard is open\n  // second line of the same comment\n  out := (a AND b);\nEND_NETWORK\n")]
    public void A_real_projects_shapes_round_trip_byte_for_byte(string net) => Assert.Equal(net, Round(net));

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
            }),
        });

        var written = NetworkTextWriter.Write(body);

        Assert.Contains("LET i1 := arr[j + 1];", written);
        Assert.Contains("out := (a AND i1);", written);
    }

    /// <summary>FAN-OUT ROUND-TRIPS. One wire feeding two consumers is the vendor's `BoxTreeDemux`, and the
    /// format spells it `LET g&lt;VarId&gt; := producer;` with every consumer naming it (network-text.md §5).
    ///
    /// <para>THE BUG this pins (audit, 2026-08-29): the writer had no `Demux` arm and fell to
    /// `default: return ""`, so a branch off a gate output PULLED as `out := ( AND b);` — the wire silently
    /// gone, `volt status` clean, and the file then unparseable so it could never be pushed back. 573 of these
    /// in the one real ladder project surveyed. No test caught it because every test round-tripped
    /// text -> model -> text and the reader never built a Demux; this one builds the model DIRECTLY, which is
    /// the shape the live IDE hands over.</para></summary>
    [Fact]
    public void A_fan_out_wire_renders_as_a_named_LET_and_its_references_name_it()
    {
        var wire = new Demux(7, new Box("AND", null, CallKind.Operator,
                                        new[] { new Input(null, new Leaf(new Operand("a"), Flags.None), Flags.None),
                                                new Input(null, new Leaf(new Operand("b"), Flags.None), Flags.None) },
                                        Array.Empty<Operand>(), null, null, Flags.None),
                             Flags.None);

        var body = new NetworkBody(BodyLanguage.Fbd, new[]
        {
            new Network(0, null, null, null, false, new Node[]
            {
                wire,
                new Assign(new Demux(7, null, Flags.None), new[] { new Operand("out1") }, Flags.None),
                new Assign(new Demux(7, null, Flags.None), new[] { new Operand("out2") }, Flags.None),
            }),
        });

        var text = NetworkTextWriter.Write(body);

        Assert.Contains("LET g7 := (a AND b);", text);
        Assert.Contains("out1 := g7;", text);
        Assert.Contains("out2 := g7;", text);
    }

    /// <summary>AND A WIRE WHOSE NAME THE ENGINEER ALREADY USES IS RENAMED, NOT REFUSED.
    ///
    /// <para>`g&lt;VarId&gt;` is the vendor's id and Volt reuses it verbatim so an edit does not renumber every
    /// wire in the rung (C9) — but when a real variable is spelled the same, the two meanings cannot both be
    /// written and one has to move. It is the wire that moves, because the variable is the engineer's.</para>
    ///
    /// <para>THE BUG this pins: this used to THROW, and the throw ran on the PULL path — `Write` renders every
    /// body Volt reads out of the IDE, so the exception did not report a limit to anyone. The item failed to
    /// materialize and the POU was simply missing from the workspace, the same failure shape that cost six POUs
    /// and 187 networks when a fed parallel was refused. The variable read has to survive byte for byte: if
    /// `g5` were still emitted for the wire, the reader would take the ENGINEER's `g5` for a reference to it and
    /// the next push would delete their variable.</para></summary>
    [Fact]
    public void A_wire_whose_name_a_variable_already_holds_is_renamed_not_refused()
    {
        // The engineer's own variable is called `g5`; the vendor's wire id is 5.
        var body = new NetworkBody(BodyLanguage.Fbd, new[]
        {
            new Network(0, null, null, null, false, new Node[]
            {
                new Demux(5, new Box("AND", null, CallKind.Operator,
                                     new[] { new Input(null, new Leaf(new Operand("g5"), Flags.None), Flags.None),
                                             new Input(null, new Leaf(new Operand("b"), Flags.None), Flags.None) },
                                     Array.Empty<Operand>(), null, null, Flags.None),
                          Flags.None),
                new Assign(new Demux(5, null, Flags.None), new[] { new Operand("out1") }, Flags.None),
                new Assign(new Demux(5, null, Flags.None), new[] { new Operand("out2") }, Flags.None),
            }),
        });

        var text = NetworkTextWriter.Write(body);

        // It rendered at all, the variable is untouched, and the wire took a name nothing else holds.
        Assert.Contains("(g5 AND b)", text);
        Assert.DoesNotContain("LET g5 :=", text);

        var wire = System.Text.RegularExpressions.Regex.Match(text, @"LET (g\d+) :=").Groups[1].Value;
        Assert.NotEqual("g5", wire);
        Assert.Contains($"out1 := {wire};", text);
        Assert.Contains($"out2 := {wire};", text);

        // AND IT READS BACK AS THE SAME GRAPH — the renamed wire is a wire again, `g5` is still a leaf.
        var back = NetworkTextReader.Parse(text);
        var net = Assert.Single(back.Networks);
        var def = Assert.IsType<Demux>(net.Trees[0]);
        var and = Assert.IsType<Box>(def.Input);
        Assert.Equal("g5", Assert.IsType<Leaf>(and.Inputs[0].Value).Operand.Text);
    }

    /// <summary>And it comes back as a Demux, not as an assignment to an undeclared symbol — which is what the
    /// reader used to build (a `SplitPoints` entry plus a plain `Assign` to the name), landing a real assignment
    /// to `g7` in the project and leaving the POU uncompilable. The two halves of the model now agree.</summary>
    [Fact]
    public void A_named_fan_out_wire_reads_back_as_a_Demux_carrying_its_VarId()
    {
        var read = NetworkTextReader.Parse(
            "NETWORK 0 FBD\n  LET g7 := (a AND b);\n  out1 := g7;\n  out2 := g7;\nEND_NETWORK\n");

        var trees = read.Networks[0].Trees;
        var def = Assert.IsType<Demux>(trees[0]);
        Assert.Equal(7, def.VarId);
        Assert.NotNull(def.Input);

        foreach (var t in trees.Skip(1))
        {
            var use = Assert.IsType<Demux>(Assert.IsType<Assign>(t).Value);
            Assert.Equal(7, use.VarId);
            Assert.Null(use.Input);      // a REFERENCE carries no producer
        }
    }

    /// <summary>And the whole thing is a fixed point: what the writer emits, the reader reads back, and the
    /// writer emits identically. That is what makes pull -> push safe.</summary>
    [Fact]
    public void Fan_out_is_a_fixed_point_through_the_text()
    {
        var text = "NETWORK 0 FBD\n  LET g7 := (a AND b);\n  out1 := g7;\n  out2 := g7;\nEND_NETWORK\n";
        Assert.Equal(text.Trim(), Round(text).Trim());
    }

    /// <summary>A RUNG WITH NOTHING ON IT round-trips — `coil := ;`.
    ///
    /// <para>Measured in a user's ladder: a SET coil whose <c>BoxTreeAssign.RValue</c> is a
    /// <c>BoxTreeTerminator</c> with no input — a coil the engineer placed on a rung nothing drives. The writer
    /// renders a bare terminator as the empty string, so it always EMITTED this text; the reader refused it with
    /// "expected an operand", so the POU could be pulled and never pushed back. It reads back as the TERMINATOR
    /// the vendor holds, not as a null: a null would make the in-place archive writer refuse the RValue as
    /// removed and lose the rung.</para></summary>
    [Fact]
    public void An_empty_right_hand_side_is_a_rung_with_nothing_on_it()
    {
        var text = "NETWORK 0 LD\n  coil := ;\nEND_NETWORK\n";

        var model = NetworkTextGate.Validate(text);

        var assign = Assert.IsType<Assign>(model.Networks.Single().Trees.Single());
        Assert.Equal(new[] { "coil" }, assign.Targets.Select(t => t.Text));
        var terminator = Assert.IsType<Terminator>(assign.Value);
        Assert.Null(terminator.Input);

        // …and it survives being written back out, which is the half that was broken.
        Assert.Equal(text.TrimEnd(), NetworkTextWriter.Write(model).TrimEnd());
    }
}


/// <summary>
/// A LADDER PARALLEL'S FEEDING RUNG — the half that was rendered as nothing.
///
/// <para><c>Parallel.Input</c> is "the rung feeding the branch" and <c>Branches</c> are the parallel paths, so
/// the logic is <c>Input AND (b1 OR b2)</c>. The writer rendered the branches ALONE and left the feeding element
/// out of the committed file — not a drawing detail but a change to what the program computes, and silent,
/// because the text it produced was a fixed point that the canonical gate accepted.</para>
///
/// <para>Measured on a real project: six POUs pulled with whole sub-expressions missing, including
/// <c>(((g2 AND stDecendTray) * ioActNumberOfRows * iRowHeight) + tInt + iInitialDescentValue)</c> feeding a
/// single branch. Both readers populate <c>Input</c>; this render arm was the one place it went missing, which
/// is why no round-trip test could see it — there is no reader arm that builds a <c>Parallel</c> at all, so the
/// text reparses to boxes and re-emits identically either way.</para>
/// </summary>
public class ParallelRenderTests
{
    private static string Render(Node tree) =>
        NetworkTextWriter.Write(new NetworkBody(BodyLanguage.Ld, new[]
        {
            new Network(0, null, null, null, false, new[] { tree }),
        }));

    private static Node Leaf(string name) => new Leaf(new Operand(name), Flags.None);

    /// <summary>THE REGRESSION: the feeding rung is in SERIES with the branches, and must appear.</summary>
    [Fact]
    public void A_fed_parallel_renders_its_feeding_rung()
    {
        var text = Render(new Assign(
            new Volt.Engine.Format.Network.Parallel(Leaf("c"), new[] { Leaf("a"), Leaf("b") }, Flags.None),
            new[] { new Operand("out") }, Flags.None));

        Assert.Contains("out := (c AND (a OR b));", text);
    }

    /// <summary>An UNFED parallel is still a plain OR — the fix must not invent a series that is not there.</summary>
    [Fact]
    public void An_unfed_parallel_is_still_a_plain_or()
    {
        var text = Render(new Assign(
            new Volt.Engine.Format.Network.Parallel(null, new[] { Leaf("a"), Leaf("b") }, Flags.None),
            new[] { new Operand("out") }, Flags.None));

        Assert.Contains("out := (a OR b);", text);
    }

    /// <summary>A MINTED WIRE MUST NOT CAPTURE A VARIABLE THE ENGINEER DECLARED.
    ///
    /// <para>The reservation set collected FB INSTANCE names only — no leaf, no assignment target — so a network
    /// needing one minted wire, beside an ordinary variable an engineer had called `g1`, emitted
    /// `LET g1 := …;` and then `outC := (g1 OR c);` meaning Volt's wire. Re-emitting reproduces that text
    /// byte-for-byte, so the canonical gate passes; the push deletes their inVariable and changes what `outC`
    /// computes.</para></summary>
    [Fact]
    public void A_minted_wire_does_not_capture_a_declared_variable()
    {
        var text = NetworkTextWriter.Write(new NetworkBody(BodyLanguage.Ld, new[]
        {
            new Network(0, null, null, null, false, new Node[]
            {
                // two targets on one value — this is what forces a `g` to be minted
                new Assign(Leaf("a"), new[] { new Operand("out1"), new Operand("out2") }, Flags.None),
                // …beside a real variable that is already spelled like one
                new Assign(Leaf("g1"), new[] { new Operand("outC") }, Flags.None),
            }),
        }));

        Assert.Contains("outC := g1;", text);                      // the engineer's variable, untouched
        Assert.DoesNotContain("LET g1 :=", text);                  // and the mint went elsewhere
    }

    /// <summary>And the parallel's OWN modifiers reach the text, which this arm also used to drop.</summary>
    [Fact]
    public void A_negated_parallel_says_so()
    {
        var text = Render(new Assign(
            new Volt.Engine.Format.Network.Parallel(null, new[] { Leaf("a"), Leaf("b") }, Flags.None with { Negated = true }),
            new[] { new Operand("out") }, Flags.None));

        Assert.Contains("NOT (a OR b)", text);
    }
}
