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
            CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), live, model, null, language);
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
        Assign a => a with { Value = a.Value == null ? null : Rename(a.Value, from, to) },
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
    /// <summary>Rebuild a network from <paramref name="model"/> and hand back the operand the coil ended up as.
    ///
    /// <para>The live network deliberately holds something DIFFERENT, so the change gate opens and the
    /// destroy-and-rebuild path — the one that writes target flags — actually runs.</para></summary>
    private static Nwl.Operand Coil(Network model)
    {
        var live = new Nwl.Network().With(new Nwl.BoxTreeAssign());
        CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), live, model, null, BodyLanguage.Ld);

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
                    System.Array.Empty<Operand>(),
                    new Leaf(new Operand("rung"), Flags.None),
                    null, Flags.None),
        });

        var live = new Nwl.Network().With(new Nwl.BoxTreeAssign());
        CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), live, model, null, BodyLanguage.Ld);
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
                    System.Array.Empty<Operand>(),
                    new Leaf(new Operand("rung"), Flags.None),
                    null, Flags.None),
        });

        var live = new Nwl.Network().With(new Nwl.BoxTreeAssign());
        CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), live, model, null, BodyLanguage.Ld);

        var written = Assert.IsType<Nwl.BoxTreeBox>(live.GetTree(live.NetworkItemCount - 1));
        var names = Assert.IsType<Nwl.ParamList>(written.InputParams).Names;
        Assert.Equal("EN", names[0]);
        Assert.True((bool?)written.En, "the vendor's `En` flag says the pin is SHOWN, and it must be set");
    }
}
