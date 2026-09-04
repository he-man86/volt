using System.Linq;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// Reading a CODESYS graphical body, offline.
///
/// <para><b>Why this project exists at all.</b> A POU in a user's project was ABSENT from the workspace — not an
/// item, not a folder, no error at the wire. The cause was one member: an unwired <c>En</c> pin reads as
/// <c>System.Boolean false</c>, not null (DIALECT C7), and the reader took any non-null <c>En</c> as a wired
/// enable. The resulting throw made the body unreadable, an unreadable body made the ITEM unreadable, and the
/// fetch skipped it — so a whole POU silently vanished from git.</para>
///
/// <para><b>It reached a user before a test because every graphical fixture Volt owns is one Volt itself
/// created</b>, and those carry a null <c>En</c>. Only a body an ENGINEER drew in the IDE has the boolean. That
/// used to mean the shape had no gate short of a live CODESYS with a hand-drawn network. It does now: the reader
/// reaches every vendor member by reflection and dispatches on <c>GetType().Name</c>, so a plain C# class named
/// <c>BoxTreeBox</c> reproduces the exact shape in microseconds.</para>
/// </summary>
public class CodesysNetworkReaderTests
{
    /// <summary>THE REGRESSION. `En = false` means "nothing is wired to the EN pin", and must read as no enable
    /// — not as an enable whose expression is a boolean.
    ///
    /// <para>Before the fix this did not merely mis-read the pin: <c>ReadNode</c> dispatched on the runtime type
    /// name, found <c>Boolean</c>, and threw "the graphical item 'Boolean' has no network-text form yet",
    /// costing the entire POU.</para></summary>
    [Fact]
    public void An_unwired_EN_pin_reads_as_no_enable()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "AND",
            InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("b") },
            En = false,   // the vendor's answer for "nothing wired here"
        };

        var body = CodesysNetworkReader.Read(Nwl.Body(box), BodyLanguage.Fbd);

        var read = Assert.IsType<Box>(body.Networks.Single().Trees.Single());
        Assert.Null(read.Enable);
        Assert.Equal("AND", read.Type);
        Assert.Equal(new[] { "a", "b" }, read.Inputs.Select(i => ((Leaf)i.Value).Operand.Text));
    }

    /// <summary>The same rule on every other node-valued member. They are read the same way and nothing says the
    /// vendor is consistent about which of them answers <c>false</c>, so the guard is applied to all of them and
    /// gated here rather than only where it happened to bite.</summary>
    [Fact]
    public void A_boolean_where_a_node_belongs_is_never_a_node()
    {
        var assign = new Nwl.BoxTreeAssign { RValue = false };
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out" });

        var body = CodesysNetworkReader.Read(Nwl.Body(assign), BodyLanguage.Ld);

        var read = Assert.IsType<Assign>(body.Networks.Single().Trees.Single());
        Assert.Null(read.Value);
        Assert.Equal(new[] { "out" }, read.Targets.Select(t => t.Text));
    }

    /// <summary>A WIRED ENABLE ARRIVES FROM INPUT SLOT 0, which is where the vendor puts it.
    ///
    /// <para><b>This test used to hand the double a shape no vendor emits</b> — <c>En = Leaf("enable")</c>, a
    /// TREE in the <c>En</c> member — and passed, which is worse than failing: it certified a read that could
    /// never fire. Across 373 real networks <c>En</c> is a Boolean on 468 boxes, null on 814, and a tree on
    /// none (<c>scripts/probe-nwl-census.py</c>); live CODESYS says the same from the write side, refusing a
    /// tree with "cannot be converted to type System.Nullable`1[System.Boolean]". <c>En</c> is the "EN/ENO is
    /// shown on this box" flag. The WIRE is an ordinary input item in slot 0, and the vendor names that slot
    /// <c>EN</c> — 220 of 220 boxes that have one.</para>
    ///
    /// <para>So the shape below is the ladder shape: a rung feeding a box's enable, with the box's own data
    /// pins after it. Read as a data pin instead, the rung became a leading BOOLEAN operand — `MOVE(g185, 0)`
    /// for `MOVE(EN := rung, IN := 0)` — and the build oracle saw the type error that followed.</para></summary>
    [Fact]
    public void A_wired_EN_pin_is_read_from_input_slot_zero()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "MOVE",
            InputItemList = new object[] { Nwl.Leaf("rung"), Nwl.Leaf("value") },
            InputParams = new Nwl.ParamList { Names = new[] { "EN" }, Types = new[] { "BOOL" } },
            En = true,   // the vendor's flag: EN/ENO is SHOWN. Never the wire.
        };

        var body = CodesysNetworkReader.Read(Nwl.Body(box), BodyLanguage.Fbd);

        var read = Assert.IsType<Box>(body.Networks.Single().Trees.Single());
        Assert.Equal("rung", Assert.IsType<Leaf>(read.Enable).Operand.Text);
        // The enable is NOT also a data pin, and the one real pin keeps its position.
        Assert.Equal(new[] { "value" }, read.Inputs.Select(i => ((Leaf)i.Value).Operand.Text));
        Assert.All(read.Inputs, i => Assert.Null(i.Formal));   // MOVE's data pin is positional
    }

    /// <summary>A box with no EN slot keeps every input as data — the guard must not eat a real first pin just
    /// because the box has a name in slot 0.</summary>
    [Fact]
    public void A_box_whose_first_pin_is_not_EN_keeps_all_of_its_inputs()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "TON",
            Instance = new Nwl.Operand { OperandExpr = "t1", IsInstance = true },
            InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("pt") },
            InputParams = new Nwl.ParamList { Names = new[] { "IN", "PT" }, Types = new[] { "BOOL", "TIME" } },
        };

        var read = Assert.IsType<Box>(
            CodesysNetworkReader.Read(Nwl.Body(box), BodyLanguage.Fbd).Networks.Single().Trees.Single());

        Assert.Null(read.Enable);
        Assert.Equal(new[] { "IN", "PT" }, read.Inputs.Select(i => i.Formal));
    }

    /// <summary>FORMAL PIN NAMES COME OFF `Names`, a STRING ARRAY — the vendor's <c>IParamList</c> has no list of
    /// named objects to enumerate. Reading it the other way answered empty EVERY time, so a function-block call
    /// pulled as <c>t1( := a,  := pt)</c>: text that does not parse, which means such a POU could be pulled and
    /// never pushed back.</summary>
    [Fact]
    public void Formal_pin_names_are_read_from_the_param_list()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "TON",
            Instance = new Nwl.Operand { OperandExpr = "t1", IsInstance = true },
            InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("pt") },
            InputParams = new Nwl.ParamList { Names = new[] { "IN", "PT" }, Types = new[] { "BOOL", "TIME" } },
        };

        var body = CodesysNetworkReader.Read(Nwl.Body(box), BodyLanguage.Fbd);

        var read = Assert.IsType<Box>(body.Networks.Single().Trees.Single());
        Assert.Equal(new[] { "IN", "PT" }, read.Inputs.Select(i => i.Formal));
        Assert.Equal("t1", read.Instance?.Text);
    }

    /// <summary>A SHORTER `Names` ARRAY IS INDEX-ALIGNED, not a partial list to throw away.
    ///
    /// <para>This used to assert the opposite — "the reader only applies formals when there is exactly one per
    /// input, so a partial list leaves them all unnamed rather than sliding the names onto the wrong pins".
    /// The worry was right and the remedy was not: the array is aligned by INDEX, so nothing can slide, and a
    /// short one is how an EXTENSIBLE operator says its trailing pins are positional. Requiring equality split
    /// one real project's boxes in half on that accident — 50 matched and rendered their enable as
    /// <c>f(EN := g0, …)</c>, a data argument that is not one; 169 matched on nothing and lost every pin name
    /// the vendor had given them.</para></summary>
    [Fact]
    public void A_short_param_list_names_the_pins_it_covers_and_no_others()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "ADD",
            InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("b"), Nwl.Leaf("c") },
            InputParams = new Nwl.ParamList { Names = new[] { "In1" }, Types = new[] { "BOOL" } },
        };

        var body = CodesysNetworkReader.Read(Nwl.Body(box), BodyLanguage.Fbd);

        var read = Assert.IsType<Box>(body.Networks.Single().Trees.Single());
        Assert.Equal(new string?[] { "In1", null, null }, read.Inputs.Select(i => i.Formal));
    }

    /// <summary>An EMPTY name is positional too — the vendor writes `""` for a pin it does not name (`MOVE`'s
    /// data output is one), and an empty formal would render as `f( := a)`, which does not parse.</summary>
    [Fact]
    public void An_empty_pin_name_is_positional()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "MOVE",
            InputItemList = new object[] { Nwl.Leaf("a") },
            InputParams = new Nwl.ParamList { Names = new[] { "" }, Types = new[] { "" } },
        };

        var read = Assert.IsType<Box>(
            CodesysNetworkReader.Read(Nwl.Body(box), BodyLanguage.Fbd).Networks.Single().Trees.Single());

        Assert.Null(read.Inputs.Single().Formal);
    }

    /// <summary>A NETWORK TITLE IS NOT A VENDOR SENTINEL. The archive layer's placeholders
    /// (<c>Constant_Address_Serialization_Value</c>, <c>Constant_SymbolComment_Serialization_Value</c>) are
    /// measured on OPERAND members, but the filter that drops them was applied to every string the reader
    /// cleans — including a network's Title, Label and Comment. So an engineer's network called
    /// <c>Constant_Torque</c> read back as null, and the writer's `SetIfChanged(net, "Title", model.Title ?? "")`
    /// then wrote "" into the live project: a title deleted from the IDE by a pull, with nothing in git to show
    /// for it.</summary>
    [Theory]
    [InlineData("Constant_Torque")]
    [InlineData("Constant_Speed_Setpoint")]
    [InlineData("Constant_")]
    public void A_network_title_beginning_with_the_sentinel_prefix_survives(string title)
    {
        var assign = new Nwl.BoxTreeAssign();
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out" });
        var net = new Nwl.Network { Title = title, Comment = title, Label = title }.With(assign);

        var read = CodesysNetworkReader.ReadNetwork(net, 0);

        Assert.Equal(title, read.Title);
        Assert.Equal(title, read.Comment);
        Assert.Equal(title, read.Label);
    }

    /// <summary>…while the sentinel IS still dropped where it was actually measured: an operand's SymbolComment.
    /// Narrowing the filter must not stop it doing its job, or a vendor internal lands in an engineer's file.</summary>
    [Fact]
    public void An_operands_symbol_comment_sentinel_is_still_dropped()
    {
        var assign = new Nwl.BoxTreeAssign();
        assign.Outputs.List.Add(new Nwl.Operand
        {
            OperandExpr = "out",
            SymbolComment = "Constant_SymbolComment_Serialization_Value",
        });

        var read = CodesysNetworkReader.ReadNetwork(new Nwl.Network().With(assign), 0);

        var target = Assert.IsType<Assign>(read.Trees.Single()).Targets.Single();
        Assert.Null(target.Comment);
    }

    /// <summary>A NETWORK THAT CANNOT SAY HOW MANY ITEMS IT HAS IS A BROKEN OBJECT MODEL, NOT AN EMPTY BODY.
    ///
    /// <para><c>NwlInterop.Int</c> answered 0 for an absent member, and 0 is the loop bound for reading every
    /// tree. At 0 the reader never calls <c>GetTree</c>, so the <c>Missing</c> throw that every other member
    /// access in that class provides was bypassed by the one soft read deciding whether it runs — and the body
    /// materialized as a network with a header and no logic. The same 0 gates the WRITER's clear-before-rebuild,
    /// where it leaves the old trees in place and stacks the new ones on top.</para>
    ///
    /// <para>The documented robustness fact is that <c>NetworkItemCount</c> can EXCEED the tree count, never
    /// that it can be missing — so absence is a version story and must be said out loud.</para></summary>
    [Fact]
    public void A_network_missing_its_item_count_throws_rather_than_reading_as_empty()
    {
        var ex = Assert.ThrowsAny<System.Exception>(
            () => CodesysNetworkReader.ReadNetwork(new NetworkWithoutCount(), 0));

        Assert.Contains("NetworkItemCount", ex.Message);
    }

    /// <summary>A network object shaped like the vendor's EXCEPT that it cannot report its item count.</summary>
    private sealed class NetworkWithoutCount
    {
        public string Title { get; set; } = "";
        public string Label { get; set; } = "";
        public string Comment { get; set; } = "";
        public bool OutCommented { get; set; }
        public object? GetTree(int i) => null;
        public object? GetSplitPoint(int i) => null;
    }

    /// <summary>A SET COIL MUST SURVIVE THE PULL, on the TARGET — where the vendor keeps it (measured on a real
    /// ladder: 246 Set flags across 356 networks) and where the format now spells it, `out S= a;`. This reader
    /// dropped the targets' flags entirely, so a SET coil pulled as a PLAIN coil: invisible in git, and
    /// silently downgraded on the next push.</summary>
    [Fact]
    public void A_set_coil_keeps_its_storage_on_the_target()
    {
        var assign = new Nwl.BoxTreeAssign { RValue = new Nwl.BoxTreeOperand { Operand = new Nwl.Operand { OperandExpr = "a" } } };
        assign.Outputs.List.Add(new Nwl.Operand
        {
            OperandExpr = "out",
            IsLValue = true,
            Flags = new Nwl.Flags { Set = true },
        });

        var read = CodesysNetworkReader.ReadNetwork(new Nwl.Network().With(assign), 0);

        var a = Assert.IsType<Assign>(read.Trees.Single());
        Assert.True(a.Targets.Single().Flags!.Set, "the coil's SET must stay on the coil");
        Assert.False(a.Value!.Flags.Set, "storage no longer moves onto the value — CoilStorage is deleted");
        Assert.Equal("out", a.Targets.Single().Text);
    }

    /// <summary>A RESET COIL IS `Negation + Set` ON THE TARGET, and reading those two bits as two independent
    /// modifiers is what made every reset coil in a project pull as a SET coil.
    ///
    /// <para>The vendor names the encoding itself: exporting each of the 17 POUs in `Lenze_MID-S100` that has a
    /// non-plain coil gives <c>storage="reset"</c> for exactly this bit pair, counts matching on both sides
    /// with no residue (<c>scripts/probe-nwl-coils.py</c>). <c>negated="true"</c> never appears on a coil
    /// there, which is why the fourth bit combination is unobserved rather than merely rare.</para>
    ///
    /// <para>The cost of the old reading was not subtle. `GeneralProgramFlags` network 0, whose comment is
    /// "Always Off", pulled as <c>AlwaysOff := AlwaysOff SET;</c> — a reset coil written as a set coil, in a
    /// program whose job is to hold that flag false. Pushed back, it latches true.</para></summary>
    [Fact]
    public void A_reset_coil_reads_as_a_reset_and_not_as_a_negated_set()
    {
        var assign = new Nwl.BoxTreeAssign { RValue = new Nwl.BoxTreeOperand { Operand = new Nwl.Operand { OperandExpr = "a" } } };
        // The vendor's own spelling of a reset coil.
        assign.Outputs.List.Add(new Nwl.Operand
        {
            OperandExpr = "out",
            IsLValue = true,
            Flags = new Nwl.Flags { Negation = true, Set = true },
        });

        var read = CodesysNetworkReader.ReadNetwork(new Nwl.Network().With(assign), 0);

        var target = Assert.IsType<Assign>(read.Trees.Single()).Targets.Single();
        Assert.True(target.Flags!.Reset);
        Assert.False(target.Flags!.Set, "a reset coil is not a set coil");
        Assert.False(target.Flags!.Negated, "the Negation bit is half the coil KIND, not a modifier on it");
    }

    /// <summary>A plain coil stays plain — the translation must not invent storage.</summary>
    [Fact]
    public void A_plain_coil_gains_no_storage()
    {
        var assign = new Nwl.BoxTreeAssign { RValue = new Nwl.BoxTreeOperand { Operand = new Nwl.Operand { OperandExpr = "a" } } };
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out", IsLValue = true });

        var read = CodesysNetworkReader.ReadNetwork(new Nwl.Network().With(assign), 0);

        Assert.False(Assert.IsType<Assign>(read.Trees.Single()).Value!.Flags.Set);
    }

    /// <summary>A NEGATED CONTACT MUST PULL AS NEGATED. A contact's modifiers live on the OPERAND, not on the
    /// item holding it — DIALECT N4 measured the vendor shape as `BoxTreeOperand carries Operand, Id and NO
    /// Flags`. This reader took them off the ITEM, which therefore always yielded None, so a negated contact
    /// reached the workspace as a PLAIN one: the wrong logic, committed to git, with nothing to show it.
    ///
    /// <para>TwinCAT's reader has always done this correctly (`operand.Flags ?? flags`, with a comment naming
    /// the same fact). This is the same rule reached through the other vendor's spelling.</para>
    ///
    /// <para>It stayed invisible offline because the DOUBLE declared a `Flags` property the vendor type does not
    /// have, so reading the item worked in the test and only in the test.</para></summary>
    [Fact]
    public void A_negated_contact_pulls_as_negated()
    {
        var leaf = new Nwl.BoxTreeOperand
        {
            Operand = new Nwl.Operand { OperandExpr = "a", Flags = new Nwl.Flags { Negation = true } },
        };
        var assign = new Nwl.BoxTreeAssign { RValue = leaf };
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out", IsLValue = true });

        var read = CodesysNetworkReader.ReadNetwork(new Nwl.Network().With(assign), 0);

        var value = Assert.IsType<Leaf>(Assert.IsType<Assign>(read.Trees.Single()).Value);
        Assert.True(value.Flags.Negated, "the contact's negation lives on its operand and must reach the model");
    }

    /// <summary>An edge-triggered contact travels the same way — the fix is about WHERE flags are read, not
    /// about one bit.</summary>
    [Fact]
    public void A_rising_edge_contact_keeps_its_edge()
    {
        var leaf = new Nwl.BoxTreeOperand
        {
            Operand = new Nwl.Operand { OperandExpr = "a", Flags = new Nwl.Flags { Rtrig = true } },
        };
        var assign = new Nwl.BoxTreeAssign { RValue = leaf };
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out", IsLValue = true });

        var read = CodesysNetworkReader.ReadNetwork(new Nwl.Network().With(assign), 0);

        Assert.True(Assert.IsType<Leaf>(Assert.IsType<Assign>(read.Trees.Single()).Value).Flags.Rising);
    }

    /// <summary>A RETURN COIL IS CONTROL FLOW, and the bit that says so is on the TARGET OPERAND.
    ///
    /// <para><b>Ground truth, measured on a live SP21 project</b> (Lenze_MID-S100, POU <c>ATD_FQI</c> network 0,
    /// titled "Return when virtual axis"). The probe read back exactly this shape:</para>
    /// <code>
    /// tree[0]: BoxTreeAssign  itemflags=none
    ///   RValue: BoxTreeOperand  Operand = 'ioAxis.xVirtual' type='BOOL' flags=none
    ///   out[0] = '???' type='BOOL' flags=Return
    /// </code>
    ///
    /// <para><b>The bit was read off the ITEM, which never carries it</b>, so the network materialized as
    /// <c>??? := ioAxis.xVirtual;</c>. That is not a near-miss: a return coil has no operand to name, so the
    /// vendor writes its unresolved-instance marker <c>???</c> in the slot, and the marker is REFUSED on push —
    /// the POU could be pulled and never pushed back. It also read as a compile error to the graphical build
    /// oracle on a project that builds clean, which is how it was found.</para>
    ///
    /// <para><see cref="Flags.Jump"/> had already been moved to the operand for exactly this reason;
    /// <see cref="Flags.Return"/> shares its bit-field and its operand and was left behind. Both now come from
    /// one call, so the next control-flow bit cannot be half-fixed.</para></summary>
    [Fact]
    public void A_return_coil_reads_as_control_flow_not_as_an_assignment_to_the_marker()
    {
        var assign = new Nwl.BoxTreeAssign
        {
            RValue = new Nwl.BoxTreeOperand { Operand = new Nwl.Operand { OperandExpr = "ioAxis.xVirtual", Type = "BOOL" } },
        };
        // The vendor's own spelling: the marker in the operand, the Return bit on it, nothing on the item.
        assign.Outputs.List.Add(new Nwl.Operand
        {
            OperandExpr = "???",
            Type = "BOOL",
            IsLValue = true,
            Flags = new Nwl.Flags { Return = true },
        });

        var read = CodesysNetworkReader.ReadNetwork(new Nwl.Network().With(assign), 0);

        var a = Assert.IsType<Assign>(read.Trees.Single());
        Assert.True(a.Flags.Return, "the Return bit lives on the target operand, and must reach the item");
        Assert.False(a.Flags.Jump);
        Assert.Equal("ioAxis.xVirtual", ((Leaf)a.Value!).Operand.Text);
    }

    /// <summary>The writer's half of the same fact, so the fix is gated end-to-end rather than at the model:
    /// a conditional return renders as control flow, and the <c>???</c> marker never reaches the text.</summary>
    [Fact]
    public void A_return_coil_renders_as_a_conditional_RETURN()
    {
        var assign = new Nwl.BoxTreeAssign
        {
            RValue = new Nwl.BoxTreeOperand { Operand = new Nwl.Operand { OperandExpr = "ioAxis.xVirtual", Type = "BOOL" } },
        };
        assign.Outputs.List.Add(new Nwl.Operand
        {
            OperandExpr = "???",
            Type = "BOOL",
            IsLValue = true,
            Flags = new Nwl.Flags { Return = true },
        });

        var body = CodesysNetworkReader.Read(Nwl.Body(assign), BodyLanguage.Ld);
        var text = NetworkTextWriter.Write(body);

        Assert.Contains("IF ioAxis.xVirtual THEN RETURN; END_IF", text);
        Assert.DoesNotContain("???", text);
    }
}
