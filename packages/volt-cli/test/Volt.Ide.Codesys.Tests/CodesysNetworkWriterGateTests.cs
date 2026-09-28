using System;
using System.Linq;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// The graphical write's CHANGE GATE — the thing that decides whether a live network is rebuilt at all.
///
/// <para><b>Why it has to exist.</b> <c>WriteNetwork</c> is destroy-and-rebuild: it removes every
/// <c>NetworkItem</c> and re-appends trees built from the pushed text. That makes the write lossy by
/// construction for anything the reader does not capture or the builder does not set. Without a gate, a push
/// that touched only the DECLARATION still re-minted every rung in the POU — <c>PushService</c> always sends the
/// whole body — so each unrelated push quietly re-created logic the engineer had not edited, losing whatever the
/// round trip cannot carry. The class header had claimed "a network whose text is unchanged is simply not
/// written here" since it was written; nothing enforced it. TwinCAT's <c>TcNetworkWriter.Apply</c> has always
/// returned null on no-change, so this is also the two vendors agreeing.</para>
///
/// <para><b>Everything here goes through <c>WriteNetwork</c>, the production entry point</b>, and asserts on
/// what the live network RECORDED. Testing the gate's predicate directly would prove it computes the right
/// answer while saying nothing about whether that answer is consumed — and it would put a method in <c>src/</c>
/// whose only outside caller is a test, which this repo has a standing gate against.</para>
/// </summary>
public class CodesysNetworkWriterGateTests
{


    /// <summary>The scope the pushed model was read against â€” here the model's own names and FB instances, as the
    /// declarations of the POU it came from would state them (<c>NetworkModelOracle.ScopeOf</c>). The change gate
    /// renders both sides with it: "the same file" is only defined for one scope.</summary>
    private static NetworkScope ScopeOf(Network model, BodyLanguage language) =>
        Volt.Tests.Shared.NetworkModelOracle.ScopeOf(new NetworkBody(language, new[] { model }));
    /// <summary>A live network holding `out := (a AND b)`, as the vendor would present it.</summary>
    private static Nwl.Network LiveAndRung()
    {
        var and = new Nwl.BoxTreeBox
        {
            BoxType = "AND",
            InputItemList = new object[]
            {
                new Nwl.BoxTreeOperand { Operand = new Nwl.Operand { OperandExpr = "a" } },
                new Nwl.BoxTreeOperand { Operand = new Nwl.Operand { OperandExpr = "b" } },
            },
        };
        var assign = new Nwl.BoxTreeAssign { RValue = and };
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out", IsLValue = true });
        return new Nwl.Network().With(assign);
    }

    /// <summary>Push the model straight back through the writer. The rebuild path needs the vendor's own object
    /// construction, which no double can supply, so a genuine change surfaces as a throw AFTER the tear-down —
    /// which is exactly the signal these tests want: did the gate let it through or not?</summary>
    private static Exception? Push(Nwl.Network live, Network model, BodyLanguage language = BodyLanguage.Fbd)
    {
        try
        {
            CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), live, model, language, ScopeOf(model, language));
            return null;
        }
        catch (Exception ex) { return ex; }
    }

    /// <summary>THE POINT. Pushing back exactly what is already there must touch the live network in no way at
    /// all — no <c>RemoveNetworkItem</c>, no <c>AppendTree</c>, and the engineer's rung still in place.</summary>
    [Fact]
    public void A_network_pushed_back_unchanged_is_not_rebuilt()
    {
        var live = LiveAndRung();

        var thrown = Push(live, CodesysNetworkReader.ReadNetwork(live, 0));

        Assert.Null(thrown);
        Assert.Empty(live.Calls);
        Assert.Equal(1, live.NetworkItemCount);
    }

    /// <summary>…and a REAL edit still reaches the destructive path, or the gate would be a way to lose every
    /// push. The tear-down is observable; the rebuild then needs vendor types the doubles cannot provide.</summary>
    [Fact]
    public void A_changed_operand_is_rebuilt()
    {
        var live = LiveAndRung();
        var edited = Rename(CodesysNetworkReader.ReadNetwork(live, 0), "b", "c");

        Push(live, edited);

        Assert.Contains("RemoveNetworkItem", live.Calls);
    }

    /// <summary>METADATA IS NOT LOGIC. Title and comment are written through an idempotent setter, so changing
    /// one must not drag the trees into a destroy-and-rebuild.</summary>
    [Fact]
    public void A_title_change_alone_does_not_rebuild_the_trees()
    {
        var live = LiveAndRung();
        var titled = CodesysNetworkReader.ReadNetwork(live, 0) with { Title = "Interlock", Comment = "checked" };

        var thrown = Push(live, titled);

        Assert.Null(thrown);
        Assert.Empty(live.Calls);          // the rung was left alone…
        Assert.Equal("Interlock", live.Title);   // …and the metadata still landed
        Assert.Equal("checked", live.Comment);
    }

    /// <summary>An EMPTY live network against a body with logic is a change — the create path must not be gated
    /// out, or a graphical create would land nothing at all.</summary>
    [Fact]
    public void An_empty_live_network_against_real_logic_is_a_change()
    {
        var model = CodesysNetworkReader.ReadNetwork(LiveAndRung(), 0);
        var live = new Nwl.Network();

        var thrown = Push(live, model);

        // Nothing to tear down, so the proof it got past the gate is what it BUILT. This used to assert a
        // throw — the doubles could not construct a box, so "it threw" stood in for "it tried" — which is a
        // proxy that stops being true the moment the doubles get more complete. They did (the box build path
        // is exercised now), so the test asserts the outcome instead of the symptom.
        Assert.Null(thrown);
        Assert.Equal(1, live.NetworkItemCount);
    }

    /// <summary>And empty-to-empty writes nothing, so re-pushing an untouched empty body is a true no-op.</summary>
    [Fact]
    public void An_empty_network_pushed_empty_is_not_rebuilt()
    {
        var empty = new Nwl.Network();

        var thrown = Push(empty, CodesysNetworkReader.ReadNetwork(empty, 0));

        Assert.Null(thrown);
        Assert.Empty(empty.Calls);
    }

    /// <summary>The gate is language-aware only in how it RENDERS; the same trees in LD compare equal too.</summary>
    [Fact]
    public void The_gate_holds_for_ladder_as_well()
    {
        var live = LiveAndRung();

        var thrown = Push(live, CodesysNetworkReader.ReadNetwork(live, 0), BodyLanguage.Ld);

        Assert.Null(thrown);
        Assert.Empty(live.Calls);
    }

    private static Network Rename(Network n, string from, string to) =>
        n with { Trees = n.Trees.Select(t => Rename(t, from, to)).ToList() };

    private static Node Rename(Node n, string from, string to) => n switch
    {
        Leaf l => l.Operand.Text == from ? l with { Operand = l.Operand with { Text = to } } : l,
        Box b => b with { Inputs = b.Inputs.Select(i => i with { Value = Rename(i.Value, from, to) }).ToList() },
        Assign a => a with { Value = Rename(a.Value, from, to) },
        _ => n,
    };
}


/// <summary>
/// WHAT LANDS ON A COIL — the flags the writer puts on an assignment's TARGET operand.
///
/// <para><b>There was no CODESYS writer test at all before this one</b>, and the gap had a cost. The writer
/// took the VALUE's whole flag record as "the storage" and applied every bit of it to each target, so the NOT
/// in <c>out := NOT a;</c> landed on the COIL as well as on the input and the IDE ran <c>out := NOT NOT a</c> —
/// the inverse of the committed source, on the vendor's own canonical FBD fixture.</para>
///
/// <para><b>Nothing Volt had could see it.</b> The reader lifts only STORAGE back off a target
/// (<c>CoilStorage.OntoValue</c>) and <c>NetworkTextWriter.Lhs</c> renders a target with no modifiers at all,
/// so the next pull was byte-identical and the change gate then said "unchanged". A negated BOOL coil also
/// COMPILES, so the build oracle was blind to it too. The only instrument that can see a flag landing on the
/// wrong object is a test that looks at the object — which is this one.</para>
///
/// <para>DIALECT D26 already required the write to be bit-precise, and TwinCAT obeyed it. This is the same rule
/// asserted on the vendor that did not.</para>
/// </summary>
public class CodesysCoilFlagTests
{


    /// <summary>The scope the pushed model was read against â€” here the model's own names and FB instances, as the
    /// declarations of the POU it came from would state them (<c>NetworkModelOracle.ScopeOf</c>). The change gate
    /// renders both sides with it: "the same file" is only defined for one scope.</summary>
    private static NetworkScope ScopeOf(Network model, BodyLanguage language) =>
        Volt.Tests.Shared.NetworkModelOracle.ScopeOf(new NetworkBody(language, new[] { model }));
    /// <summary>A live network holding a rung unlike any this class pushes — <c>elsewhere := TRUE;</c> — so the
    /// change gate opens and the destroy-and-rebuild path runs. It must be a rung network text can SPELL: the gate
    /// renders the live network to compare, and a live network the text cannot hold is refused rather than rebuilt,
    /// because a rebuild would delete the fact it could not carry (network text v2: an assign item driving no
    /// target is such a fact — <c>value;</c> is the value item itself).</summary>
    private static Nwl.Network Different()
    {
        var assign = new Nwl.BoxTreeAssign
        {
            RValue = new Nwl.BoxTreeOperand { Operand = new Nwl.Operand { OperandExpr = "TRUE" } },
        };
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "elsewhere", IsLValue = true });
        return new Nwl.Network().With(assign);
    }

    /// <summary>Rebuild a network from <paramref name="model"/> and hand back the operand the coil ended up as.
    ///
    /// <para>The live network deliberately holds something DIFFERENT, so the change gate opens and the
    /// destroy-and-rebuild path — the one that writes target flags — actually runs.</para></summary>
    private static Nwl.Operand Coil(Network model)
    {
        var live = Different();
        CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), live, model, BodyLanguage.Ld, ScopeOf(model, BodyLanguage.Ld));

        var assign = Assert.IsType<Nwl.BoxTreeAssign>(live.GetTree(live.NetworkItemCount - 1));
        return Assert.IsType<Nwl.Operand>(Assert.Single(assign.Outputs.List));
    }

    private static Nwl.Flags FlagsOf(Nwl.Operand o) => Assert.IsType<Nwl.Flags>(o.Flags);

    /// <summary>`out := <value>;` — one coil driven by one leaf carrying <paramref name="onValue"/>.</summary>
    private static Network Rung(Flags onValue) =>
        new Network(0, null, null, null, false, new Node[]
        {
            new Assign(new Leaf(new Operand("a"), onValue), new[] { new Operand("out") }, Flags.None),
        });

    /// <summary>The other side of the same statement: one coil whose TARGET carries <paramref name="onTarget"/>
    /// — the coil kind (`:=` / `S=` / `R=`), which is where storage lives now.</summary>
    private static Network CoilRung(Flags onTarget) =>
        new Network(0, null, null, null, false, new Node[]
        {
            new Assign(new Leaf(new Operand("a"), Flags.None),
                       new[] { new Operand("out", Flags: onTarget) }, Flags.None),
        });

    /// <summary>THE REGRESSION. A negated INPUT must not negate the COIL.</summary>
    [Fact]
    public void A_negated_value_does_not_negate_the_coil()
    {
        var coil = Coil(Rung(Flags.None with { Negated = true }));

        Assert.Equal("out", coil.OperandExpr);
        Assert.False(FlagsOf(coil).Negation, "`out := NOT a;` negated the COIL as well as the input");
    }

    /// <summary>The same leak, one bit over: an edge on the value is not an edge on the coil.</summary>
    [Fact]
    public void A_rising_edge_on_the_value_does_not_reach_the_coil()
    {
        var coil = Coil(Rung(Flags.None with { Rising = true }));

        Assert.False(FlagsOf(coil).Rtrig, "`out := a RISING;` put a rising edge on the COIL");
        Assert.False(FlagsOf(coil).Ftrig);
    }

    /// <summary>And the bit that genuinely DOES belong there still arrives. `out S= a;` is a SET COIL — the
    /// format spells storage as the assignment OPERATOR now, and the model carries it on the target, so this
    /// is a straight write rather than the translation <c>CoilStorage</c> used to perform.</summary>
    [Fact]
    public void A_set_coil_reaches_the_target_as_the_Set_bit()
    {
        var coil = Coil(CoilRung(Flags.None with { Set = true }));

        Assert.True(FlagsOf(coil).Set, "`out S= a;` lost the SET on the way to the coil");
        Assert.False(FlagsOf(coil).Negation);
    }

    /// <summary>A RESET COIL IS `Negation + Set`, and writing it is what this vendor used to REFUSE.
    ///
    /// <para><c>ApplyFlags</c> threw on any <c>Reset</c> — "a RESET modifier has no representation in the IDE's
    /// flag set" — which was the same wrong belief that made every reset coil PULL as a set coil. The vendor's
    /// own PLCopen export names the encoding (<c>storage="reset"</c> for exactly this bit pair, 17 POUs,
    /// exact counts); <see cref="Flags.CoilFromVendor"/> holds it and this asserts the write half.</para></summary>
    [Fact]
    public void A_reset_coil_is_written_as_the_vendors_two_bits()
    {
        var coil = Coil(CoilRung(Flags.None with { Reset = true }));

        Assert.True(FlagsOf(coil).Set, "a reset coil sets BOTH bits — Negation alone is not a reset");
        Assert.True(FlagsOf(coil).Negation);
    }

    /// <summary>A plain coil sets neither bit, so the encoding cannot drift into writing storage nobody asked
    /// for — the failure mode that turns a monitoring coil into a latch.</summary>
    [Fact]
    public void A_plain_coil_carries_neither_coil_bit()
    {
        var coil = Coil(CoilRung(Flags.None));

        Assert.False(FlagsOf(coil).Set);
        Assert.False(FlagsOf(coil).Negation);
    }

    /// <summary>A jump's destination carries the Jump bit — the OTHER thing that legitimately rides on a target
    /// operand (DIALECT C13), and the reason this code path takes an `extra` flag set at all.</summary>
    [Fact]
    public void A_jumps_destination_carries_the_jump_bit()
    {
        var model = new Network(0, null, null, null, false, new Node[]
        {
            new Assign(new Leaf(new Operand("go"), Flags.None), new[] { new Operand("Done") },
                       Flags.None with { Jump = true }),
        });

        var target = Coil(model);

        Assert.Equal("Done", target.OperandExpr);
        Assert.True(FlagsOf(target).Jump, "the jump's destination operand lost its Jump bit");
        Assert.False(FlagsOf(target).Negation);
    }

    /// <summary>A RETURN'S `???` TARGET CARRIES THE RETURN BIT — DIALECT C13's correction, on the write side. Network
    /// text v2 reads `IF cond THEN RETURN; END_IF;` as the vendor draws a return: an Assign whose one target is the
    /// unresolved-instance marker `???` with `Return` on it (and on the item). The writer carried only the coil bits and
    /// `Jump` onto a target, so the IDE got a COIL assigning to `???`: the conformance fixture
    /// `ng_conditional_jump_and_return`, recorded clean from v1 text (which built a return with no target at all), built
    /// with "The assignment target is not specified." twice when re-recorded from v2 text (2026-09-27, live SP21).</summary>
    [Fact]
    public void A_returns_marker_target_carries_the_return_bit()
    {
        var ret = Flags.None with { Return = true };
        var model = new Network(0, null, null, null, false, new Node[]
        {
            new Assign(new Leaf(new Operand("cond"), Flags.None),
                       new[] { new Operand(Box.UnnamedInstance, IsLValue: true, Flags: ret) }, ret),
        });

        var target = Coil(model);

        Assert.Equal(Box.UnnamedInstance, target.OperandExpr);
        Assert.True(FlagsOf(target).Return, "a RETURN's target lost its Return bit and became a coil assigning to ???");
        Assert.False(FlagsOf(target).Jump);
    }

    /// <summary>A BUILT PARALLEL CARRIES THE MODEL'S MODE. DIALECT N20: a freshly constructed <c>BoxTreeParallel</c> is
    /// <c>Sequential</c>, while 16 of 17 real ones are <c>BoxShortCircuit</c> (census 1.3). The writer never set it, so
    /// every Parallel a push rebuilt changed evaluation mode — invisible, because no reader read it. Both modes, so a
    /// writer that sets a constant cannot pass.</summary>
    [Theory]
    [InlineData(ParallelMode.BoxShortCircuit, "BoxShortCircuit")]
    [InlineData(ParallelMode.Sequential, "Sequential")]
    public void A_built_Parallel_carries_the_models_mode(ParallelMode mode, string vendor)
    {
        var model = new Network(0, null, null, null, false, new Node[]
        {
            new Assign(new Volt.Engine.Format.Network.Parallel(null,
                           new Node[] { new Leaf(new Operand("a"), Flags.None), new Leaf(new Operand("b"), Flags.None) }, mode),
                       new[] { new Operand("out") }, Flags.None),
        });

        var live = Different();
        CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), live, model, BodyLanguage.Ld, ScopeOf(model, BodyLanguage.Ld));

        var par = Assert.IsType<Nwl.BoxTreeParallel>(Assert.IsType<Nwl.BoxTreeAssign>(live.GetTree(live.NetworkItemCount - 1)).RValue);
        Assert.Equal(vendor, par.Mode.ToString());
        Assert.Equal(mode, Assert.IsType<Volt.Engine.Format.Network.Parallel>(
            Assert.IsType<Assign>(CodesysNetworkReader.ReadNetwork(live, 0).Trees.Last()).Value).Mode);
    }

    /// <summary>A MODE CHANGE IS A CHANGE. The no-change gate compares v1 TEXT, which carries no Parallel mode, so a
    /// model differing from the live network only in its mode was called unchanged and never rebuilt — the writer's
    /// <c>Mode</c> set above was unreachable for exactly the edit it exists for, and the push reported success.</summary>
    [Fact]
    public void A_Parallel_whose_only_change_is_its_mode_is_rebuilt()
    {
        Network Rung(ParallelMode mode) => new(0, null, null, null, false, new Node[]
        {
            new Assign(new Volt.Engine.Format.Network.Parallel(null,
                           new Node[] { new Leaf(new Operand("a"), Flags.None), new Leaf(new Operand("b"), Flags.None) }, mode),
                       new[] { new Operand("out") }, Flags.None),
        });
        var impl = new Nwl.NWLImplementationObject();
        var live = Different();
        CodesysNetworkWriter.WriteNetwork(impl, live, Rung(ParallelMode.BoxShortCircuit), BodyLanguage.Ld, ScopeOf(Rung(ParallelMode.BoxShortCircuit), BodyLanguage.Ld));

        CodesysNetworkWriter.WriteNetwork(impl, live, Rung(ParallelMode.Sequential), BodyLanguage.Ld, ScopeOf(Rung(ParallelMode.Sequential), BodyLanguage.Ld));

        Assert.Equal(ParallelMode.Sequential, Assert.IsType<Volt.Engine.Format.Network.Parallel>(
            Assert.IsType<Assign>(CodesysNetworkReader.ReadNetwork(live, 0).Trees.Last()).Value).Mode);
    }

    /// <summary>A WIRED ENABLE ROUND-TRIPS, and this is the write half of a refusal that turned out to be
    /// wrong.
    ///
    /// <para>The writer used to throw on any <c>Box.Enable</c>: "the vendor's `En` member is a nullable
    /// BOOLEAN, not a wired expression, so there is nowhere to put the enable's tree." The premise was
    /// measured and correct; the conclusion was not. The enable's expression is an ordinary INPUT ITEM in
    /// slot 0, named <c>EN</c> in the param list — 220 of 220 boxes with one, in a real project — and `En`
    /// is the flag saying the pin is shown. So every push carrying an enable was refused for want of looking
    /// one slot over, and this asserts the two halves now agree by reading back what was written.</para></summary>
    [Fact]
    public void A_wired_enable_round_trips_through_input_slot_zero()
    {
        var model = new Network(0, null, null, null, false, new Node[]
        {
            new Box("MOVE", null, CallKind.Function,
                    new[] { new Input(null, new Leaf(new Operand("value"), Flags.None), Flags.None) },
                    System.Array.Empty<Output>(),
                    new Leaf(new Operand("rung"), Flags.None),
                    null, Flags.None),
        });

        var live = Different();
        CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), live, model, BodyLanguage.Ld, ScopeOf(model, BodyLanguage.Ld));
        var back = CodesysNetworkReader.ReadNetwork(live, 0);

        var box = Assert.IsType<Box>(back.Trees.Last());
        Assert.Equal("rung", Assert.IsType<Leaf>(box.Enable).Operand.Text);
        Assert.Equal(new[] { "value" }, box.Inputs.Select(i => ((Leaf)i.Value).Operand.Text));
    }

    /// <summary>The enable NAMES ITS OWN SLOT, even on a box whose data pins are positional. Without the name
    /// the reader cannot tell the rung from a data operand, and `MOVE` — the commonest enabled box in a
    /// ladder — has exactly that shape: one unnamed data pin.</summary>
    [Fact]
    public void An_enabled_operator_still_writes_the_EN_pin_name()
    {
        var model = new Network(0, null, null, null, false, new Node[]
        {
            new Box("MOVE", null, CallKind.Function,
                    new[] { new Input(null, new Leaf(new Operand("value"), Flags.None), Flags.None) },
                    System.Array.Empty<Output>(),
                    new Leaf(new Operand("rung"), Flags.None),
                    null, Flags.None),
        });

        var live = Different();
        CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), live, model, BodyLanguage.Ld, ScopeOf(model, BodyLanguage.Ld));

        var written = Assert.IsType<Nwl.BoxTreeBox>(live.GetTree(live.NetworkItemCount - 1));
        var names = Assert.IsType<Nwl.ParamList>(written.InputParams).Names;
        Assert.Equal("EN", names[0]);
        Assert.True((bool?)written.En, "the vendor's `En` flag says the pin is SHOWN, and it must be set");
    }

    /// <summary>A POSITIONAL OUTPUT PIN IS WRITTEN AT ITS SLOT (task 3.10). <c>f(a, =&gt;, =&gt; x)</c> puts <c>x</c> on
    /// output slot 1 with slot 0 passed over; writing the pins one after another put <c>x</c> on slot 0 — another
    /// output, a different program — and the next pull read it back there. A slot passed over is the empty operand
    /// an unwired pin is (the reader skips it), and an enabled box's ENO echo stays in front of the data slots.</summary>
    [Theory]
    [InlineData(false, new[] { "", "x" })]
    [InlineData(true, new[] { "", "", "x" })]
    public void A_positional_output_pin_is_written_at_its_slot(bool enabled, string[] slots)
    {
        var model = new Network(0, null, null, null, false, new Node[]
        {
            new Box("f", null, CallKind.Function,
                    new[] { new Input(null, new Leaf(new Operand("a"), Flags.None), Flags.None) },
                    new[] { new Output(null, new Operand("x", IsLValue: true), slots.Length - 1) },
                    enabled ? new Leaf(new Operand("rung"), Flags.None) : null,
                    null, Flags.None, MainOutputIndex: 0, HasEnoOutput: enabled),
        });

        var live = Different();
        CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), live, model, BodyLanguage.Fbd, ScopeOf(model, BodyLanguage.Fbd));

        var written = Assert.IsType<Nwl.BoxTreeBox>(live.GetTree(live.NetworkItemCount - 1));
        Assert.Equal(slots, written.Outputs.List.Select(o => Assert.IsType<Nwl.Operand>(o).OperandExpr ?? "").ToArray());
    }

    /// <summary>A box that does not record whether it has an ENO output, where the text DOES state it (a positional
    /// <c>=&gt;</c> pin's slot depends on it), is refused by that name before anything is built: the change gate renders
    /// the model through the text writer, which refuses the missing fact. The build below it derives the fact only
    /// where the text does not state it, so it never has to guess one the text states.</summary>
    [Fact]
    public void A_box_whose_ENO_output_was_not_read_is_refused_by_that_name()
    {
        var model = new Network(0, null, null, null, false, new Node[]
        {
            new Box("ADD", null, CallKind.Operator,
                    new[] { new Input(null, new Leaf(new Operand("a"), Flags.None), Flags.None),
                            new Input(null, new Leaf(new Operand("b"), Flags.None), Flags.None) },
                    new[] { new Output(null, new Operand("x", IsLValue: true), 0) },
                    new Leaf(new Operand("c"), Flags.None),
                    null, Flags.None, HasEnoOutput: null),
        });

        var ex = Record.Exception(() => CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), Different(),
                                            model, BodyLanguage.Fbd, ScopeOf(model, BodyLanguage.Fbd)));

        Assert.NotNull(ex);
        Assert.Contains("does not record whether it has an ENO output", ex!.Message);
    }

    /// <summary>…and where the text does NOT state it, the box is built as the text reads it (<c>TextHasEno</c>): a
    /// top-level box by its EN, a consumed operator group with neither EN nor a stored slot with no ENO echo.</summary>
    [Fact]
    public void A_box_the_text_states_no_ENO_for_is_built_as_the_text_reads_it()
    {
        var model = new Network(0, null, null, null, false, new Node[]
        {
            new Assign(new Box("AND", null, CallKind.Operator,
                           new[] { new Input(null, new Leaf(new Operand("a"), Flags.None), Flags.None),
                                   new Input(null, new Leaf(new Operand("b"), Flags.None), Flags.None) },
                           System.Array.Empty<Output>(), null, null, Flags.None, HasEnoOutput: null),
                       new[] { new Operand("out", IsLValue: true) }, Flags.None),
        });

        var live = Different();
        CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), live, model, BodyLanguage.Fbd, ScopeOf(model, BodyLanguage.Fbd));

        var assign = Assert.IsType<Nwl.BoxTreeAssign>(live.GetTree(live.NetworkItemCount - 1));
        var box = Assert.IsType<Nwl.BoxTreeBox>(assign.RValue);
        Assert.Empty(box.Outputs.List);
    }

    /// <summary>THE ENO ECHO IS WRITTEN FOR A BOX THAT HAS AN ENO OUTPUT, and for no other — the model's
    /// <see cref="Box.HasEnoOutput"/>, not its EN. The two are independent (DIALECT N16), and the writer once keyed on
    /// EN and gave every enabled box the same ENO slot. The rows were an enabled GT with and without <c>.ENO</c> until
    /// DIALECT N21 measured that a consumed enabled comparison Volt builds does not compile in EITHER form (its
    /// implicit result variable is declared from the <c>MainOutputIndex</c> Volt cannot set) — those two are refusals
    /// now (below), and these rows are the consumed shapes that build: an enabled MOVE read by its ENO, and a function
    /// without EN read by its main output.</summary>
    [Theory]
    [InlineData("x := MOVE(EN := c, a).ENO;", true)]
    [InlineData("n := LIMIT(a, b, n);", false)]
    public void The_ENO_slot_is_written_for_the_box_that_has_one_not_for_every_enabled_box(string statement, bool eno)
    {
        var (model, scope) = Pushed(statement);
        Assert.Equal(eno, Assert.IsType<Box>(Assert.IsType<Assign>(model.Trees[0]).Value).HasEnoOutput);

        var live = Different();
        CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), live, model, BodyLanguage.Fbd, scope);

        var written = Assert.IsType<Nwl.BoxTreeBox>(Assert.IsType<Nwl.BoxTreeAssign>(live.GetTree(live.NetworkItemCount - 1)).RValue);
        Assert.Equal(eno ? new[] { "ENO" } : Array.Empty<string>(), Assert.IsType<Nwl.ParamList>(written.OutputParams).Names);
        Assert.Equal(eno ? 1 : 0, written.Outputs.List.Count);
    }

    /// <summary>One statement as the push reads it: validated against a declaration, as <c>PushService</c> does.</summary>
    private static (Network Model, NetworkScope Scope) Pushed(string statement)
    {
        const string declaration = "PROGRAM P\nVAR\n  x : BOOL;\n  c : BOOL;\n  a : INT;\n  b : INT;\n  n : INT;\n  lamp : BOOL;\n  sv : INT;\nEND_VAR";
        var scope = NetworkScope.FromDeclarations(declaration, _ => null, () => Array.Empty<string>());
        return (NetworkText.Validate("IMPLEMENTATION FBD\nNETWORK\n  " + statement + "\nEND_NETWORK\n", scope).Networks[0], scope);
    }

    /// <summary>THE PUSH HALF OF "EN IS A PIN, ENO IS SPELLED" (task 4.1; spec "ENO is the main output", "a box that has
    /// no ENO output says .ENO"). The text states which output a consumer reads; the box CODESYS builds from Volt's
    /// object model decides which one it actually reads — by EN, not by the output list Volt writes, which the vendor
    /// neither derives nor consults (DIALECT N21, run in simulation). Each shape below builds a program other than the
    /// text, or none, so each is refused naming the box — and refused BEFORE the live network is destroyed, so the
    /// IDE is left as it was:
    /// <list type="bullet">
    /// <item>a consumed enabled MOVE without <c>.ENO</c>: the IDE reads it through ENO (<c>lamp = TRUE</c> over a data
    /// output of 0), whatever list Volt writes;</item>
    /// <item>a consumed enabled comparison, with or without <c>.ENO</c>: it does not compile (<c>ImpVar … not
    /// defined</c>);</item>
    /// <item><c>.ENO</c> on an operator with no EN: "Missing EN pin".</item>
    /// </list></summary>
    [Theory]
    [InlineData("lamp := MOVE(EN := c, a, => sv);", "MOVE", "`.ENO`")]
    [InlineData("x := GT(EN := c, a, b);", "GT", "comparison")]
    [InlineData("x := GT(EN := c, a, b).ENO;", "GT", "comparison")]
    [InlineData("x := ADD(a, b).ENO;", "ADD", "no EN")]
    public void A_consumer_the_built_box_would_read_otherwise_is_refused_by_name_before_anything_is_destroyed(
        string statement, string box, string why)
    {
        var (model, scope) = Pushed(statement);
        var live = Different();

        var ex = Assert.Throws<NotSupportedException>(() =>
            CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), live, model, BodyLanguage.Fbd, scope));

        Assert.Contains($"'{box}'", ex.Message);
        Assert.Contains(why, ex.Message);
        var kept = Assert.IsType<Nwl.BoxTreeAssign>(Assert.Single(Enumerable.Range(0, live.NetworkItemCount).Select(live.GetTree)));
        Assert.Equal("elsewhere", Assert.IsType<Nwl.Operand>(Assert.Single(kept.Outputs.List)).OperandExpr);
    }

    /// <summary>…for EVERY comparison the engine knows, not for a copy of the list: N21's refusal once read its own
    /// hand-kept set, so an operator the engine gained or lost would have built the unbuildable shape unnoticed.</summary>
    [Fact]
    public void Every_comparison_the_engine_knows_is_refused_consumed_and_enabled()
    {
        Assert.NotEmpty(NetworkSpelling.Comparisons);
        foreach (var op in NetworkSpelling.Comparisons)
        {
            var (model, scope) = Pushed($"x := {op}(EN := c, a, b);");
            var ex = Assert.Throws<NotSupportedException>(() =>
                CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), Different(), model, BodyLanguage.Fbd, scope));
            Assert.Contains($"'{op}'", ex.Message);
            Assert.Contains("comparison", ex.Message);
        }
    }

    /// <summary>…and the shapes that DO build are not refused: at the top level every enabled box builds (N21), and an
    /// FB call may declare <c>ENO</c> without EN (Lenze <c>Dryer</c>, N16), so <c>.ENO</c> on one is the FB's own output.</summary>
    [Theory]
    [InlineData("MOVE(EN := c, a, => sv);")]
    [InlineData("GT(EN := c, a, b, => x);")]
    [InlineData("lamp := MOVE(EN := c, a, => sv).ENO;")]
    public void A_consumer_the_built_box_reads_as_written_is_built(string statement)
    {
        var (model, scope) = Pushed(statement);
        var live = Different();

        CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), live, model, BodyLanguage.Fbd, scope);

        var built = live.GetTree(live.NetworkItemCount - 1);
        Assert.False(built is Nwl.BoxTreeAssign { RValue: Nwl.BoxTreeOperand }, "the network was not rebuilt from the push");
        Assert.Equal(1, live.NetworkItemCount);
    }

    /// <summary>A WIRE IS WRITTEN UNDER THE VARID THE MODEL CARRIES (task 4.1), definition and every reference: ids are
    /// network-scoped, and the writer once minted fresh ones from the aspect's allocator, so an edit renumbered every
    /// fan-out in the network it touched. The id is deliberately not 0 or 1, which a counter would produce too.</summary>
    [Fact]
    public void A_wire_is_written_under_the_models_VarId_verbatim()
    {
        var (model, scope) = Pushed("VAR_TEMP g28 : BOOL; END_VAR\n  g28 := (x AND lamp);\n  x := g28;\n  lamp := g28;");
        Assert.Equal(28, Assert.IsType<Demux>(model.Trees[0]).VarId);
        var live = Different();

        CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), live, model, BodyLanguage.Fbd, scope);

        var ids = Enumerable.Range(0, live.NetworkItemCount).Select(live.GetTree)
            .Select(t => t is Nwl.BoxTreeAssign a ? a.RValue : t).OfType<Nwl.BoxTreeDemux>().Select(d => d.VarId).ToList();
        Assert.Equal(new[] { 28, 28, 28 }, ids);
    }

    /// <summary>A DATA WIRE A PUSH BUILDS COMES BACK AS THE TEXT DECLARED IT, and pushes again unchanged. The text says
    /// the wire's type only in <c>VAR_TEMP g1 : INT</c>; the vendor keeps a box's output type in <c>OutputParams.Types</c>
    /// and derives none itself (DIALECT N21), so a writer that appended no type built an ADD whose re-read stored none —
    /// the next pull turned the body into the marker ("a wire of unknown type") and the next push of the very same text
    /// was refused by the change gate rendering the live network. Spec: "on push the declared type is taken as
    /// written".</summary>
    [Fact]
    public void A_data_wire_a_push_built_reads_back_with_its_declared_type_and_pushes_again()
    {
        var (model, scope) = Pushed("VAR_TEMP g1 : INT; END_VAR\n  g1 := (a + b);\n  n := g1;\n  sv := g1;");
        var live = Different();

        CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), live, model, BodyLanguage.Fbd, scope);

        // The type rides the param list, and the connected slot holds NO output item: an empty operand there is an
        // assignment to nothing, which the live build refused ("The assignment target is not specified").
        var add = Assert.IsType<Nwl.BoxTreeBox>(Assert.IsType<Nwl.BoxTreeDemux>(live.GetTree(0)).Input);
        Assert.Equal(new[] { "INT" }, Assert.IsType<Nwl.ParamList>(add.OutputParams).Types);
        Assert.Empty(add.Outputs.List);

        var reread = CodesysNetworkReader.ReadNetwork(live, 0);
        var body = new NetworkBody(BodyLanguage.Fbd, new[] { reread });
        Assert.Contains("VAR_TEMP g1 : INT; END_VAR", NetworkTextWriter.Write(body, scope));
        Assert.Null(Record.Exception(() =>
            CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), live, model, BodyLanguage.Fbd, scope)));
    }

    /// <summary>A MODIFIER ON A BOX INPUT PIN (task 4.1: the reader fills <see cref="Input.Flags"/>) is never written
    /// without its bit and never dropped: the change gate renders the model through the text writer first, which has no
    /// spelling for a pin flag (phase-1 decision) and refuses it by name — so such a model reaches no rebuild.</summary>
    [Fact]
    public void A_pin_flag_in_the_model_is_refused_by_name_not_dropped()
    {
        var model = new Network(0, null, null, null, false, new Node[]
        {
            new Assign(new Box("AND", null, CallKind.Operator,
                           new[] { new Input(null, new Leaf(new Operand("a"), Flags.None), Flags.None),
                                   new Input(null, new Leaf(new Operand("b"), Flags.None), Flags.None with { Negated = true }) },
                           System.Array.Empty<Output>(), null, null, Flags.None),
                       new[] { new Operand("out", IsLValue: true) }, Flags.None),
        });
        var live = Different();

        var ex = Assert.Throws<NetworkUnrepresentableException>(() =>
            CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), live, model, BodyLanguage.Fbd, ScopeOf(model, BodyLanguage.Fbd)));

        Assert.Equal("a flag on a box input pin", ex.Marker);
        Assert.Equal(1, live.NetworkItemCount);
    }

    /// <summary>A BOX WITH NO INSTANCE CLEARS THE VENDOR'S MARKER, and this is the test that was missing.
    ///
    /// <para>A freshly constructed <c>BoxTreeBox</c> does not arrive blank: its <c>Instance</c> operand holds
    /// <c>???</c>, the vendor's unresolved-instance marker (measured by dumping a created box beside an
    /// engineer-drawn one — created <c>'???'</c>, real <c>None</c>). The writer only touched <c>Instance</c>
    /// when the model HAD one, so every box Volt created without one carried a marker the engineer never drew.
    /// The build answers `Expression expected instead of '?'` on a body that LOADS and round-trips
    /// byte-for-byte — invisible to the text, the reader and the canonical gate alike.</para>
    ///
    /// <para>The double defaulted <c>Instance</c> to NULL, which is why no offline test could see it. It is
    /// present-but-empty now (a box READ from a project), and this test sets the construction default
    /// explicitly.</para></summary>
    [Fact]
    public void A_box_with_no_instance_clears_the_vendors_marker()
    {
        var live = Different();
        var model = new Network(0, null, null, null, false, new Node[]
        {
            new Box("AND", null, CallKind.Operator,
                    new[]
                    {
                        new Input(null, new Leaf(new Operand("a"), Flags.None), Flags.None),
                        new Input(null, new Leaf(new Operand("b"), Flags.None), Flags.None),
                    },
                    System.Array.Empty<Output>(), null, null, Flags.None),
        });

        CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), live, model, BodyLanguage.Fbd, ScopeOf(model, BodyLanguage.Fbd));

        var written = Assert.IsType<Nwl.BoxTreeBox>(live.GetTree(live.NetworkItemCount - 1));
        var instance = Assert.IsType<Nwl.Operand>(written.Instance);
        Assert.Equal("", instance.OperandExpr);
    }

    /// <summary>AN EXECUTE BOX IS CREATED WITH ITS ST. The writer refused one until the construction was
    /// measured; it is measured now (`scripts/probe-nwl-execute-create.py`), and a live push of one builds
    /// clean in an empty project. This pins the shape offline: the snippet is hung on the box, and the box
    /// reports itself as providing one.</summary>
    [Fact]
    public void An_execute_box_is_created_carrying_its_ST()
    {
        const string st = "iCount := iCount + 1;";
        var live = Different();
        var model = new Network(0, null, null, null, false, new Node[]
        {
            new Box("EXECUTE", null, CallKind.Function, System.Array.Empty<Input>(),
                    System.Array.Empty<Output>(), null, st, Flags.None),
        });

        CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), live, model, BodyLanguage.Fbd, ScopeOf(model, BodyLanguage.Fbd));

        var written = Assert.IsType<Nwl.BoxTreeBox>(live.GetTree(live.NetworkItemCount - 1));
        Assert.Equal("EXECUTE", written.BoxType);
        Assert.True(written.ProvidesSTSnippet, "the box must report that it carries ST");

        // AND THE ST ITSELF LANDED. `Assert.NotNull(written.STSnippet)` used to stand here and proved
        // nothing beyond the line above it — the double defines `ProvidesSTSnippet => STSnippet != null`,
        // so the two assertions were the same boolean read twice. Read the text back instead.
        Assert.Equal(st, StTextOf(written));
    }

    /// <summary>THE POSTCONDITION CHECK IS REAL. The vendor's `Insert` throws AFTER landing the text, so the
    /// writer catches that throw and then verifies the document by reading it back. If the text did NOT land,
    /// the write must fail rather than create a box whose code is gone.
    ///
    /// <para>Neither half was reachable before: the double's `Insert` never threw, so the catch was dead and
    /// the verification could never fire. Deleting the writer's `catch` left every test green. It does not
    /// now — proven by making it rethrow, which fails this file.</para></summary>
    [Fact]
    public void An_execute_box_whose_ST_does_not_land_is_refused()
    {
        Nwl.TextDocument.DropsText = true;
        try
        {
            var live = Different();
            var model = new Network(0, null, null, null, false, new Node[]
            {
                new Box("EXECUTE", null, CallKind.Function, System.Array.Empty<Input>(),
                        System.Array.Empty<Output>(), null, "iCount := iCount + 1;", Flags.None),
            });

            var ex = Assert.Throws<System.InvalidOperationException>(() =>
                CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), live, model, BodyLanguage.Fbd, ScopeOf(model, BodyLanguage.Fbd)));
            Assert.Contains("did not take its ST", ex.Message);
        }
        finally { Nwl.TextDocument.DropsText = false; }
    }

    /// <summary>The ST a written Execute box carries, through the same members the writer used to put it there.</summary>
    private static string StTextOf(Nwl.BoxTreeBox box)
    {
        var snippet = Assert.IsType<Nwl.STSnippet>(box.STSnippet);
        var impl = Assert.IsType<_3S.CoDeSys.STObject.STImplementationObject>(snippet.Snippet);
        return impl.TextDocument.Text;
    }
}

/// <summary>The write's refusal of a view change, reached offline through <c>CodesysNetworkWriter.Write</c> — the
/// write into the object the IDE hands out, without the vendor's ObjectManager transaction around it.</summary>
public class CodesysViewModeTests
{
    /// <summary>Spec, "a view change is one comparison": the pushed marker says FBD and the IDE's body is a ladder, so
    /// the push is refused — through the write the push runs, the one place that compares the two now that the reader
    /// takes the language from the marker alone.</summary>
    [Fact]
    public void A_marker_naming_the_other_view_is_refused_by_the_write()
    {
        var ex = Assert.Throws<NotSupportedException>(() =>
            CodesysNetworkWriter.Write(new LadderPou(), new NetworkBody(BodyLanguage.Fbd, Array.Empty<Network>()),
                                             NetworkScope.Empty));
        Assert.Contains("view is LD and the pushed text says FBD", ex.Message);
    }

    /// <summary>The object the IDE hands out to modify, holding a ladder: its <c>Implementation</c> aspect, whose
    /// <c>DefaultViewMode</c> is what <c>CodesysDriver.ReadViewMode</c> reads.</summary>
    private sealed class LadderPou
    {
        public LadderImplementation Implementation { get; } = new LadderImplementation();
    }

    private sealed class LadderImplementation
    {
        public string DefaultViewMode => "Ld";
        public System.Collections.Generic.List<object> NetworkList { get; } = new System.Collections.Generic.List<object>();
    }
}
