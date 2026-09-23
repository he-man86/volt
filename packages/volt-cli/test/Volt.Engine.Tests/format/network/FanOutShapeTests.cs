using System.Linq;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Engine.Tests.Format.Network;

/// <summary>
/// A FAN-OUT WIRE AND A MULTI-OUTPUT ASSIGNMENT ARE DIFFERENT BODIES, AND THE TEXT NOW SAYS SO.
///
/// <para>The vendors hold both. A <c>BoxTreeDemux</c> is a real split point the editor draws; a
/// <c>BoxTreeAssign</c> with several <c>OutputItems</c> is ONE item driving several coils, which DIALECT D22
/// records the PLCopen importer producing ("fan-out survives as ONE assign with two targets").</para>
///
/// <para><b>They used to render identically</b> — both as <c>LET g1 := v; o1 := g1; o2 := g1;</c> — and the
/// reader decides by PREFIX, so every multi-output assign came back a Demux. A rung the engineer drew as one
/// item with twenty coils round-tripped into twenty-one items. Neither driver could do better than guess, and
/// they guessed opposite ways: TwinCAT folded every <c>g</c> back into one item, CODESYS built a Demux for
/// every one.</para>
///
/// <para><b>Measured before it was spelled</b> (<c>scripts/probe-nwl-assign-outputs.py</c>, four real customer
/// projects): Lenze holds 40 multi-output assigns — one the twenty-target <c>TrayFiller</c> rung — beside 573
/// real <c>BoxTreeDemux</c>. Both ordinary, in the same project.</para>
/// </summary>
public class FanOutShapeTests
{
    private static NetworkBody Body(params Node[] trees) =>
        new(BodyLanguage.Ld, new[] { new Volt.Engine.Format.Network.Network(0, null, null, null, false, trees) });

    /// <summary>ONE ITEM, TWO TARGETS — what an importer-built body holds.</summary>
    private static NetworkBody MultiOutputAssign() =>
        Body(new Assign(new Leaf(new Operand("a"), Flags.None),
                        new[] { new Operand("out1", IsLValue: true), new Operand("out2", IsLValue: true) },
                        Flags.None));

    /// <summary>A REAL SPLIT POINT feeding two single-target assigns — what the editor draws.</summary>
    private static NetworkBody DemuxAndTwoAssigns()
    {
        var demux = new Demux(1, new Leaf(new Operand("a"), Flags.None), Flags.None);
        return Body(demux,
                    new Assign(demux, new[] { new Operand("out1", IsLValue: true) }, Flags.None),
                    new Assign(demux, new[] { new Operand("out2", IsLValue: true) }, Flags.None));
    }

    [Fact]
    public void The_two_shapes_are_distinguishable_in_text()
    {
        var fromAssign = NetworkTextWriter.Write(MultiOutputAssign());
        var fromDemux = NetworkTextWriter.Write(DemuxAndTwoAssigns());

        Assert.True(fromAssign != fromDemux,
            "a multi-output assign and a real fan-out wire render to the SAME network text, so a pull cannot " +
            "say which the IDE holds and a push has to guess:\n" + fromAssign);
        Assert.Contains("LET m1 :=", fromAssign);
        Assert.Contains("LET g1 :=", fromDemux);
    }

    [Fact]
    public void A_multi_output_assign_reads_back_as_ONE_item()
    {
        var back = NetworkTextGate.Validate(NetworkTextWriter.Write(MultiOutputAssign()));

        var assign = Assert.IsType<Assign>(Assert.Single(back.Networks.Single().Trees));
        Assert.Equal(new[] { "out1", "out2" }, assign.Targets.Select(t => t.Text));
    }

    /// <summary>…and a real WIRE still reads back as a wire. The fold must not swallow the other shape.</summary>
    [Fact]
    public void A_fan_out_wire_still_reads_back_as_a_wire()
    {
        var back = NetworkTextGate.Validate(NetworkTextWriter.Write(DemuxAndTwoAssigns()));

        Assert.Contains(back.Networks.Single().Trees, t => t is Demux);
    }

    /// <summary>THE FIXED POINT, which is what makes a pull -> push round trip safe: writing the model that
    /// came back must reproduce the same text.</summary>
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Both_shapes_are_fixed_points(bool multiOutput)
    {
        var once = NetworkTextWriter.Write(multiOutput ? MultiOutputAssign() : DemuxAndTwoAssigns());
        var twice = NetworkTextWriter.Write(NetworkTextGate.Validate(once));

        Assert.Equal(once, twice);
    }

    /// <summary>EACH TARGET KEEPS ITS OWN OPERATOR through the fold — a rung whose coils disagree (one plain,
    /// one SET) is ordinary, and it is the reason the `LET` form exists rather than a trailing word.</summary>
    [Fact]
    public void A_fold_keeps_each_targets_own_operator()
    {
        var body = Body(new Assign(new Leaf(new Operand("a"), Flags.None),
                                   new[] { new Operand("out1", IsLValue: true),
                                           new Operand("out2", IsLValue: true, Flags: Flags.None with { Set = true }) },
                                   Flags.None));

        var back = NetworkTextGate.Validate(NetworkTextWriter.Write(body));
        var assign = Assert.IsType<Assign>(Assert.Single(back.Networks.Single().Trees));

        Assert.Equal(2, assign.Targets.Count);
        Assert.False(assign.Targets[0].Flags?.Set ?? false);
        Assert.True(assign.Targets[1].Flags?.Set ?? false);
    }

    /// <summary>AN ENABLED BOX DRIVING SEVERAL COILS IS ALSO ONE ITEM — the same shape in the sibling method.
    ///
    /// <para><c>EnabledAssign</c> has its own multi-target arm and it minted <c>g</c>, so an EN-gated box
    /// feeding two coils rebuilt as a `Demux` plus two assigns exactly as the plain case did. Found by
    /// sweeping for the assumption rather than by hitting it, which is the point of the sweep.</para></summary>
    [Fact]
    public void An_enabled_box_driving_several_coils_reads_back_as_ONE_item()
    {
        var box = new Box("AND", null, CallKind.Operator,
                          new[] { new Input(null, new Leaf(new Operand("a"), Flags.None), Flags.None),
                                  new Input(null, new Leaf(new Operand("b"), Flags.None), Flags.None) },
                          System.Array.Empty<Output>(),
                          new Leaf(new Operand("en"), Flags.None), null, Flags.None);
        var body = Body(new Assign(box,
                                   new[] { new Operand("out1", IsLValue: true), new Operand("out2", IsLValue: true) },
                                   Flags.None));

        var text = NetworkTextWriter.Write(body);
        Assert.Contains("LET m", text);

        var back = NetworkTextGate.Validate(text);
        var assign = Assert.IsType<Assign>(back.Networks.Single().Trees.Single(t => t is Assign));
        Assert.Equal(new[] { "out1", "out2" }, assign.Targets.Select(t => t.Text));
    }

    /// <summary>A FOLDED MULTI-OUTPUT ASSIGN MAY ITSELF BE FED BY A WIRE, and the fold must not lose it.
    ///
    /// <para>Every other tree in the reader's `Build` is emitted through `ReferencesToDemux`, which turns a
    /// reference to a wire NAME back into the `Demux` the archive holds. The fold arm emitted its `Assign`
    /// directly and skipped that step, so `LET m1 := g3;` kept a bare `Leaf("g3")` where a `Demux` belongs.
    /// Two consequences, and the second is the serious one: the body is no longer a FIXED POINT, so
    /// `NetworkTextGate` refuses the text Volt itself just pulled — that POU can be pulled and never pushed
    /// back — and if it were written, the CODESYS writer would emit an assignment sourced from the undeclared
    /// symbol `g3`, which is the "POU stops compiling" failure the reader's own prefix-rule comment
    /// documents.</para>
    ///
    /// <para>Not hypothetical: Lenze holds 40 multi-output assigns beside 573 `BoxTreeDemux`, so the two
    /// meeting in one network is ordinary. Found by review.</para></summary>
    [Fact]
    public void A_folded_assign_fed_by_a_WIRE_keeps_the_wire()
    {
        var wire = new Demux(3, new Leaf(new Operand("a"), Flags.None), Flags.None);
        var body = Body(
            wire,
            new Assign(wire, new[] { new Operand("single", IsLValue: true) }, Flags.None),
            new Assign(wire, new[] { new Operand("out1", IsLValue: true), new Operand("out2", IsLValue: true) },
                       Flags.None));

        var once = NetworkTextWriter.Write(body);
        var back = NetworkTextGate.Validate(once);

        var folded = back.Networks.Single().Trees.OfType<Assign>().Single(a => a.Targets.Count == 2);
        Assert.IsType<Demux>(folded.Value);

        // …and therefore still a fixed point, which is what makes a pull -> push round trip safe.
        Assert.Equal(once, NetworkTextWriter.Write(back));
    }
}
