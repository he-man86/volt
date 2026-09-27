using System.Linq;
using Volt.Engine.Format.Body;
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

        // Not read as a node, so the assignment holds no value — which the model no longer has a spelling for
        // (census 1.2, task 1.10): refused by name, never read as a value and never a crash of another kind.
        var ex = Assert.Throws<UnrepresentableBodyException>(() => CodesysNetworkReader.Read(Nwl.Body(assign), BodyLanguage.Ld));
        Assert.Equal("an assignment with no value", ex.Marker);
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

    /// <summary>…AND AN OPERAND'S OWN COMMENT IS NOT ONE EITHER, when it merely begins the same way.
    ///
    /// <para>The filter had been narrowed to operands, which fixed the network title. It still matched a bare
    /// <c>Constant_</c> prefix, so an operand commented <c>Constant_Torque</c> — an ordinary thing to write
    /// beside a constant — read back as null and was erased from the project on the next push.</para>
    ///
    /// <para>The sentinel has a shape: <c>Constant_&lt;Member&gt;_Serialization_Value</c>. Matching it costs
    /// nothing (a third member's placeholder is still caught) and stops the filter eating text an engineer
    /// typed. Between leaking vendor noise into a file, which is visible, and deleting a comment, which is
    /// not, only one is recoverable.</para></summary>
    [Theory]
    [InlineData("Constant_Torque")]
    [InlineData("Constant_Speed_Setpoint")]
    [InlineData("Constant_")]
    [InlineData("Constant_Serialization_Value_but_not_really")]
    public void An_operand_comment_that_only_LOOKS_like_the_sentinel_survives(string comment)
    {
        var assign = new Nwl.BoxTreeAssign();
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out", SymbolComment = comment });

        var read = CodesysNetworkReader.ReadNetwork(new Nwl.Network().With(assign), 0);

        var target = Assert.IsType<Assign>(read.Trees.Single()).Targets.Single();
        Assert.Equal(comment, target.Comment);
    }

    /// <summary>A placeholder for a member nobody has measured yet still goes — it is the SHAPE that is
    /// recognised, so the narrowing did not cost the filter its reach.</summary>
    [Fact]
    public void An_unmeasured_third_sentinel_is_still_dropped()
    {
        var assign = new Nwl.BoxTreeAssign();
        assign.Outputs.List.Add(new Nwl.Operand
        {
            OperandExpr = "out",
            SymbolComment = "Constant_SomeNewMember_Serialization_Value",
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

    /// <summary>CENSUS 1.4 AND 1.10: a terminator carrying an input occurs in no measured project (0 across five
    /// CODESYS projects), so the model has no field for one. The reader refuses it by name, so the body reaches the
    /// marker — never a dropped input, never a throw of another kind.</summary>
    [Fact]
    public void A_terminator_with_an_input_is_refused_by_name()
    {
        var assign = new Nwl.BoxTreeAssign { RValue = new Nwl.BoxTreeTerminator { Input = Nwl.Leaf("a") } };
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out", IsLValue = true });

        var ex = Assert.Throws<UnrepresentableBodyException>(() => CodesysNetworkReader.Read(Nwl.Body(assign), BodyLanguage.Ld));
        Assert.Equal("a terminator with an input", ex.Marker);
    }

    /// <summary>CENSUS 1.2 AND 1.10: "unconnected" has ONE representation, the empty terminator (RValue null 0,
    /// Terminator 3), so an assignment's value is never null in the model and a vendor null is refused by name.</summary>
    [Fact]
    public void An_assignment_holding_no_value_is_refused_by_name()
    {
        var assign = new Nwl.BoxTreeAssign { RValue = null };
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out", IsLValue = true });

        var ex = Assert.Throws<UnrepresentableBodyException>(() => CodesysNetworkReader.Read(Nwl.Body(assign), BodyLanguage.Ld));
        Assert.Equal("an assignment with no value", ex.Marker);
    }

    /// <summary>CENSUS 1.2, the Parallel half: an unfed Parallel has ONE representation, the null feed (5 of 17 in
    /// Lenze; a feed that is the empty terminator: 0 in five projects, <c>scripts/nwl-census-v2.log</c>). The reader
    /// refuses the unmeasured one by name, so it reaches the marker instead of a second spelling of "no feed".</summary>
    [Fact]
    public void A_Parallel_fed_by_the_empty_terminator_is_refused_by_name()
    {
        var par = new Nwl.BoxTreeParallel { Input = new Nwl.BoxTreeTerminator() };
        par.Trees.Add(Nwl.Leaf("a"));
        par.Trees.Add(Nwl.Leaf("b"));
        var assign = new Nwl.BoxTreeAssign { RValue = par };
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out", IsLValue = true });

        var ex = Assert.Throws<UnrepresentableBodyException>(() => CodesysNetworkReader.Read(Nwl.Body(assign), BodyLanguage.Ld));
        Assert.Equal("a Parallel fed by the empty terminator", ex.Marker);
    }

    /// <summary>And the one representation of an unfed Parallel reads, with no feed.</summary>
    [Fact]
    public void An_unfed_Parallel_reads_with_no_feed()
    {
        var par = new Nwl.BoxTreeParallel();
        par.Trees.Add(Nwl.Leaf("a"));
        par.Trees.Add(Nwl.Leaf("b"));
        var assign = new Nwl.BoxTreeAssign { RValue = par };
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out", IsLValue = true });

        var a = Assert.IsType<Assign>(Assert.Single(CodesysNetworkReader.Read(Nwl.Body(assign), BodyLanguage.Ld).Networks).Trees.Single());
        Assert.Null(Assert.IsType<Volt.Engine.Format.Network.Parallel>(a.Value).Input);
    }

    /// <summary>CENSUS 1.3: a real Parallel is <c>BoxShortCircuit</c> 16 times and <c>Sequential</c> once, so the mode
    /// is a fact of the body and is READ — not left to the model's constructor, which would pull the Sequential one as
    /// BoxShortCircuit and hand that to the next push.</summary>
    [Theory]
    [InlineData("BoxShortCircuit", ParallelMode.BoxShortCircuit)]
    [InlineData("Sequential", ParallelMode.Sequential)]
    public void A_Parallel_reads_its_mode(string vendor, ParallelMode expected)
    {
        var par = new Nwl.BoxTreeParallel { Mode = (Nwl.OperationMode)System.Enum.Parse(typeof(Nwl.OperationMode), vendor) };
        par.Trees.Add(Nwl.Leaf("a"));
        par.Trees.Add(Nwl.Leaf("b"));
        var assign = new Nwl.BoxTreeAssign { RValue = par };
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out", IsLValue = true });

        var a = Assert.IsType<Assign>(Assert.Single(CodesysNetworkReader.Read(Nwl.Body(assign), BodyLanguage.Ld).Networks).Trees.Single());
        Assert.Equal(expected, Assert.IsType<Volt.Engine.Format.Network.Parallel>(a.Value).Mode);
    }

    /// <summary>DIALECT N20: the IDE holds no flag on a Parallel or a wire, so the model has no place for one. A
    /// vendor object that nonetheless answers a bit is refused by name — never dropped on the way into the model.</summary>
    [Fact]
    public void A_flag_on_a_Parallel_is_refused_by_name()
    {
        var par = new Nwl.BoxTreeParallel { Mode = Nwl.OperationMode.BoxShortCircuit, Flags = new Nwl.Flags { Negation = true } };
        par.Trees.Add(Nwl.Leaf("a"));
        par.Trees.Add(Nwl.Leaf("b"));
        var assign = new Nwl.BoxTreeAssign { RValue = par };
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out", IsLValue = true });

        var ex = Assert.Throws<UnrepresentableBodyException>(() => CodesysNetworkReader.Read(Nwl.Body(assign), BodyLanguage.Ld));
        Assert.Equal("a flag on a Parallel", ex.Marker);
    }

    /// <summary>The same fact on a wire (<c>BoxTreeDemux</c>), definition or reference.</summary>
    [Fact]
    public void A_flag_on_a_wire_is_refused_by_name()
    {
        var def = new Nwl.BoxTreeDemux { VarId = 1, Input = Nwl.Leaf("a") };
        var assign = new Nwl.BoxTreeAssign { RValue = new Nwl.BoxTreeDemux { VarId = 1, Flags = new Nwl.Flags { Rtrig = true } } };
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out", IsLValue = true });

        var ex = Assert.Throws<UnrepresentableBodyException>(() => CodesysNetworkReader.Read(Nwl.Body(def, assign), BodyLanguage.Ld));
        Assert.Equal("a flag on a wire", ex.Marker);
    }

    /// <summary>Task 1.10 / 4.1: <c>Mode</c> is read, never defaulted, so a value outside the two measured members — or
    /// no member at all — is refused by name rather than mapped onto either (which would push the other mode).</summary>
    [Fact]
    public void A_Parallel_with_an_unmeasured_mode_is_refused_by_name()
    {
        var unknown = new Nwl.BoxTreeParallel { Mode = (Nwl.OperationMode)7 };
        unknown.Trees.Add(Nwl.Leaf("a"));
        var absent = new NoMode.BoxTreeParallel();
        absent.Trees.Add(Nwl.Leaf("a"));

        foreach (var par in new object[] { unknown, absent })
        {
            var assign = new Nwl.BoxTreeAssign { RValue = par };
            assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out", IsLValue = true });
            var ex = Assert.Throws<UnrepresentableBodyException>(() => CodesysNetworkReader.Read(Nwl.Body(assign), BodyLanguage.Ld));
            Assert.Equal("an unmeasured Parallel mode", ex.Marker);
        }
    }

    /// <summary>A vendor Parallel with no <c>Mode</c> member at all — the double's own type name is what the reader
    /// dispatches on, so it lives in its own scope.</summary>
    private static class NoMode
    {
        internal sealed class BoxTreeParallel
        {
            public object? Input { get; set; }
            public System.Collections.Generic.List<object> Trees { get; } = new();
            public object? Flags { get; set; } = new Nwl.Flags();
        }
    }

    /// <summary>Census 1.1: no Assign ITEM carries a negation or an edge — only operands do — and the model's
    /// <c>Assign.Flags</c> is where Jump/Return ride. A bit found there has no position in the text: v1 printed it on
    /// the VALUE (<c>out := NOT g1;</c>, which its own push refuses since N20), so it is refused by name at the read.</summary>
    [Theory]
    [InlineData(true, false, false, false)]
    [InlineData(false, true, false, false)]
    [InlineData(false, false, true, false)]
    [InlineData(true, false, false, true)]   // the value a wire reference: pulled text its own push would refuse
    public void A_negation_or_edge_on_an_Assign_item_is_refused_by_name(bool negation, bool rtrig, bool ftrig, bool wire)
    {
        var trees = new System.Collections.Generic.List<object>();
        if (wire) trees.Add(new Nwl.BoxTreeDemux { VarId = 1, Input = Nwl.Leaf("a") });
        var assign = new Nwl.BoxTreeAssign
        {
            RValue = wire ? new Nwl.BoxTreeDemux { VarId = 1 } : Nwl.Leaf("a"),
            Flags = new Nwl.Flags { Negation = negation, Rtrig = rtrig, Ftrig = ftrig },
        };
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out", IsLValue = true });
        trees.Add(assign);

        var ex = Assert.Throws<UnrepresentableBodyException>(() => CodesysNetworkReader.Read(Nwl.Body(trees.ToArray()), BodyLanguage.Ld));
        Assert.Equal("a flag on an Assign item", ex.Marker);
    }

    /// <summary>The one representation of "unconnected" still reads.</summary>
    [Fact]
    public void An_assignment_fed_by_the_empty_terminator_reads()
    {
        var assign = new Nwl.BoxTreeAssign { RValue = new Nwl.BoxTreeTerminator() };
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out", IsLValue = true });

        var a = Assert.IsType<Assign>(Assert.Single(CodesysNetworkReader.Read(Nwl.Body(assign), BodyLanguage.Ld).Networks).Trees.Single());
        Assert.IsType<Terminator>(a.Value);
    }

    /// <summary>A NEGATION ON A BOX INPUT PIN IS READ INTO THE MODEL, AND THE PULL NAMES IT — NEVER DROPS IT (task 4.1).
    ///
    /// <para><b>The regression.</b> CODESYS can keep a negated FBD input on the box's own <c>InputFlags</c>, with the
    /// operand feeding it unflagged — measured 2026-09-26 (<c>scripts/probe-nwl-census-v2.py</c>): six such pins, three
    /// in Lenze's <c>call_FirstErrorCapture_FB</c> and three in pro2193's <c>SetAlarm</c>. The reader never read the
    /// member (it wrote <c>Flags.None</c> on the strength of a TwinCAT-only measurement), so those contacts were
    /// pulled as PLAIN — inverted logic in git, and a push would have written it back into the PLC without the
    /// negation. The v1 hotfix made the READER refuse; the model now carries the pin flag (<see cref="Input.Flags"/>)
    /// and the text, which has no spelling for one yet (owner decision, phase 1), refuses it by name — so the pull
    /// still materializes the marker, naming the box and the pin by what feeds it.</para></summary>
    [Fact]
    public void A_negation_on_a_box_input_pin_is_read_into_the_model_and_the_pull_names_it()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "AND",
            InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("xIsWarningInfo") },
            InputFlags = new object[] { new Nwl.Flags(), new Nwl.Flags { Negation = true } },
        };
        var assign = new Nwl.BoxTreeAssign { RValue = box };
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out", IsLValue = true });

        var read = CodesysNetworkReader.ReadNetwork(new Nwl.Network().With(assign), 0);
        var pins = Assert.IsType<Box>(Assert.IsType<Assign>(read.Trees.Single()).Value).Inputs;
        Assert.Equal(new[] { false, true }, pins.Select(p => p.Flags.Negated));
        Assert.True(((Leaf)pins[1].Value).Flags.IsNone, "the bit belongs to the pin, not to the operand feeding it");

        var body = new NetworkBody(BodyLanguage.Fbd, new[] { read });
        var ex = Assert.Throws<NetworkUnrepresentableException>(() =>
            NetworkTextWriter.Write(body, Volt.Tests.Shared.NetworkModelOracle.ScopeOf(body)));
        Assert.Equal("a flag on a box input pin", ex.Marker);
        Assert.Contains("AND", ex.Message);             // which box
        Assert.Contains("xIsWarningInfo", ex.Message);  // which pin, by what feeds it
    }

    /// <summary>An edge on a pin is the same fact through another bit — read onto the pin it sits on.</summary>
    [Fact]
    public void An_edge_on_a_box_input_pin_is_read_onto_that_pin()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "TON",
            InputItemList = new object[] { Nwl.Leaf("start"), Nwl.Leaf("pt") },
            InputParams = new Nwl.ParamList { Names = new[] { "IN", "PT" }, Types = new[] { "BOOL", "TIME" } },
            InputFlags = new object[] { new Nwl.Flags { Rtrig = true }, new Nwl.Flags() },
        };

        var pins = Assert.IsType<Box>(CodesysNetworkReader.Read(Nwl.Body(box), BodyLanguage.Fbd).Networks.Single().Trees.Single()).Inputs;
        Assert.Equal(("IN", true), (pins[0].Formal, pins[0].Flags.Rising));
        Assert.True(pins[1].Flags.IsNone);
    }

    /// <summary>A flag on the EN pin has no place in the model — the enable is a tree, not an <see cref="Input"/> — so
    /// it stays refused by the reader, under the same name, and the slot after it keeps its own flags aligned.</summary>
    [Fact]
    public void A_flag_on_the_enable_pin_is_refused_by_name()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "MOVE",
            InputItemList = new object[] { Nwl.Leaf("rung"), Nwl.Leaf("value") },
            InputParams = new Nwl.ParamList { Names = new[] { "EN", "" }, Types = new[] { "BOOL", "" } },
            InputFlags = new object[] { new Nwl.Flags { Negation = true }, new Nwl.Flags() },
        };

        var ex = Assert.Throws<UnrepresentableBodyException>(() => CodesysNetworkReader.Read(Nwl.Body(box), BodyLanguage.Fbd));
        Assert.Equal("a flag on a box input pin", ex.Marker);
        Assert.Contains("EN pin", ex.Message);
    }

    /// <summary>…and with the enable's flag clear, a flag on the data pin after it lands on THAT pin — the EN slot is
    /// taken off the flag list with the item and the name, or every pin flag would shift one pin to the left.</summary>
    [Fact]
    public void Pin_flags_stay_aligned_past_the_enable()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "MOVE",
            InputItemList = new object[] { Nwl.Leaf("rung"), Nwl.Leaf("value") },
            InputParams = new Nwl.ParamList { Names = new[] { "EN", "" }, Types = new[] { "BOOL", "" } },
            InputFlags = new object[] { new Nwl.Flags(), new Nwl.Flags { Negation = true } },
        };

        var read = Assert.IsType<Box>(CodesysNetworkReader.Read(Nwl.Body(box), BodyLanguage.Fbd).Networks.Single().Trees.Single());
        Assert.Equal("rung", Assert.IsType<Leaf>(read.Enable).Operand.Text);
        Assert.True(Assert.Single(read.Inputs).Flags.Negated);
    }

    /// <summary>Pin flags that carry nothing are the ordinary case (every box in a real project has the array) and
    /// must read exactly as before.</summary>
    [Fact]
    public void Empty_pin_flags_read_as_before()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "AND",
            InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("b") },
            InputFlags = new object[] { new Nwl.Flags(), new Nwl.Flags() },
        };

        var read = Assert.IsType<Box>(CodesysNetworkReader.Read(Nwl.Body(box), BodyLanguage.Fbd).Networks.Single().Trees.Single());
        Assert.Equal(new[] { "a", "b" }, read.Inputs.Select(i => ((Leaf)i.Value).Operand.Text));
    }

    /// <summary>A PRESENT <c>InputFlags</c> THAT DOES NOT ALIGN WITH THE PINS IS REFUSED BY NAME. The list is index-aligned
    /// with <c>InputItemList</c>; census 2026-09-26 measured it on every box (~1,300) and never measured one shorter.
    /// Reading the missing tail as "no flag" was the same silent default that pulled six negated pins as plain
    /// contacts before 1.13: a pin whose modifier the reader cannot locate is not a pin without one.</summary>
    [Theory]
    [InlineData(1)]
    [InlineData(3)]
    public void Pin_flags_that_do_not_align_with_the_pins_are_refused_by_name(int flagCount)
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "AND",
            InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("b") },
            InputFlags = Enumerable.Range(0, flagCount).Select(_ => (object)new Nwl.Flags()).ToArray(),
        };

        var ex = Assert.Throws<UnrepresentableBodyException>(() => CodesysNetworkReader.Read(Nwl.Body(box), BodyLanguage.Fbd));
        Assert.Equal("a flag on a box input pin", ex.Marker);
        Assert.Contains("'AND'", ex.Message);
        Assert.Contains($"{flagCount} pin flag", ex.Message);
        Assert.Contains("2 input", ex.Message);
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
        var text = NetworkTextWriter.Write(body, NetworkScope.Empty);

        Assert.Contains("IF ioAxis.xVirtual THEN RETURN; END_IF;", text);
        Assert.DoesNotContain("???", text);
    }

    /// <summary>A BOX'S OUTPUT PINS ARRIVE, and the ENO slot is not one of them.
    ///
    /// <para>The shape is the vendor's, measured across 373 networks: <c>OutputParams.Names</c> is
    /// index-aligned with <c>Outputs</c>, slot 0 is <c>ENO</c> when the vendor names it so and is null on every
    /// box that has one, and an UNWIRED pin is an EMPTY operand rather than an absent slot (one 30-pin box in
    /// a real project carries 29 empty ones).</para>
    ///
    /// <para>Reading them at all is the fix: <c>Box.Outputs</c> was never rendered, so `TempI` in
    /// <c>MOVE(EN := rung, IN := 0) -> TempI</c> was simply not in the file, 208 times in one project
    /// (`scripts/nwl-census.log`: 208 wired output pins on 171 boxes).</para></summary>
    [Fact]
    public void A_box_output_pin_is_read_without_the_ENO_slot_or_the_unwired_ones()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "fc_MeanValue",
            InputItemList = new object[] { Nwl.Leaf("rung"), Nwl.Leaf("len") },
            InputParams = new Nwl.ParamList { Names = new[] { "EN", "iLength" }, Types = new[] { "BOOL", "INT" } },
            OutputParams = new Nwl.ParamList { Names = new[] { "ENO", "oMeanValue", "oSpare" }, Types = new[] { "", "", "" } },
            En = true,
        };
        box.Outputs.List.Add(null);                                              // the ENO echo, never wired
        box.Outputs.List.Add(new Nwl.Operand { OperandExpr = "measured" });      // the pin the engineer wired
        box.Outputs.List.Add(new Nwl.Operand { OperandExpr = "" });              // a declared pin left unwired

        var read = Assert.IsType<Box>(
            CodesysNetworkReader.Read(Nwl.Body(box), BodyLanguage.Fbd).Networks.Single().Trees.Single());

        var pin = Assert.Single(read.Outputs);
        Assert.Equal("oMeanValue", pin.Formal);
        Assert.Equal("measured", pin.Value.Text);
    }

    /// <summary>A box with no ENO slot keeps output slot 0 — the guard must key on the NAME, not the position.
    /// Measured: one box in a real project has a real, named data output sitting in slot 0.</summary>
    [Fact]
    public void A_box_without_an_ENO_slot_keeps_its_first_output()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "BLINK",
            InputItemList = new object[] { Nwl.Leaf("enable") },
            InputParams = new Nwl.ParamList { Names = new[] { "ENABLE" }, Types = new[] { "BOOL" } },
            OutputParams = new Nwl.ParamList { Names = new[] { "OUT" }, Types = new[] { "BOOL" } },
        };
        box.Outputs.List.Add(new Nwl.Operand { OperandExpr = "pulse" });

        var read = Assert.IsType<Box>(
            CodesysNetworkReader.Read(Nwl.Body(box), BodyLanguage.Fbd).Networks.Single().Trees.Single());

        var pin = Assert.Single(read.Outputs);
        Assert.Equal("OUT", pin.Formal);
        Assert.Equal("pulse", pin.Value.Text);
    }

    /// <summary>An UNNAMED output pin on a top-level box is the box's OWN RESULT PIN, spelled <c>=&gt; dst</c>
    /// inside the call — never <c>dst := MOVE(src);</c>, which is a different NWL item, an Assign over the box
    /// (spec, "a result pin is not an assign"; v1 spelled both alike and read the pin back as the Assign). The
    /// slot travels with the pin (task 3.10): a MOVE with EN/ENO hidden has one output, unnamed
    /// (<c>OutputParams.Names = ['']</c>, measured — <c>nwl-slots.log</c>), so <c>dst</c> is slot 0 and the box has
    /// no ENO output.</summary>
    [Fact]
    public void An_unnamed_output_pin_is_the_boxs_own_result_pin_not_an_assign()
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "MOVE",
            InputItemList = new object[] { Nwl.Leaf("src") },
            InputParams = new Nwl.ParamList { Names = new[] { "" }, Types = new[] { "" } },
            OutputParams = new Nwl.ParamList { Names = new[] { "" }, Types = new[] { "" } },
            MainOutputIndex = 0,
        };
        box.Outputs.List.Add(new Nwl.Operand { OperandExpr = "dst" });

        var body = CodesysNetworkReader.Read(Nwl.Body(box), BodyLanguage.Fbd);

        var read = Assert.IsType<Box>(body.Networks.Single().Trees.Single());
        Assert.Equal(0, Assert.Single(read.Outputs).Slot);
        Assert.False(read.HasEnoOutput);
        Assert.Null(read.ConnectedSlot);   // a top-level box has no consumer
        Assert.Contains("  MOVE(src, => dst);\n", NetworkTextWriter.Write(body, NetworkScope.Empty));
    }

    /// <summary>A CONSUMED box records the slot its consumer reads (task 3.10). NWL stores no connection slot — the
    /// consumer reads the box's output at <c>MainOutputIndex</c> (DIALECT N16: 338 connections checked against the
    /// vendor's own export, none disagreeing) — so that IS the connection; an AND/OR box stores no main output and
    /// is connected by none. Whether a box has an ENO output is its output list's first name, not its EN.</summary>
    [Fact]
    public void A_consumed_box_is_connected_by_its_main_output_and_an_operator_by_none()
    {
        var ge = new Nwl.BoxTreeBox
        {
            BoxType = "GE",
            InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("b") },
            OutputParams = new Nwl.ParamList { Names = new[] { "" }, Types = new[] { "" } },
            MainOutputIndex = 0,
        };
        var and = new Nwl.BoxTreeBox { BoxType = "AND", InputItemList = new object[] { ge, Nwl.Leaf("c") } };
        var assign = new Nwl.BoxTreeAssign { RValue = and };
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out", IsLValue = true });

        var read = Assert.IsType<Assign>(CodesysNetworkReader.Read(Nwl.Body(assign), BodyLanguage.Ld).Networks.Single().Trees.Single());

        var readAnd = Assert.IsType<Box>(read.Value);
        Assert.Null(readAnd.MainOutputIndex);
        Assert.Null(readAnd.ConnectedSlot);
        var readGe = Assert.IsType<Box>(readAnd.Inputs[0].Value);
        Assert.Equal(0, readGe.MainOutputIndex);
        Assert.Equal(0, readGe.ConnectedSlot);
        Assert.False(readGe.HasEnoOutput);
    }

    /// <summary>A BOX VOLT BUILT STORES NO MAIN OUTPUT, AND ITS CONSUMER STILL READS ONE (DIALECT N21). <c>MainOutputIndex</c>
    /// is read-only on <c>BoxTreeBox</c>, so every box a push constructs keeps it <c>None</c> — and the pull read a
    /// consumed <c>MAX</c> of Volt's own making as "a consumed box with no stored connection slot": the marker, for the
    /// body Volt had just written (found live, <c>parity-fixes.test.ts</c>, on both vendors). What the compiler does
    /// with such a box is measured by running it: without EN it reads the data output, slot 0 (<c>MAX(1, 2) = 2</c>,
    /// <c>ADD(1, 2) = 3</c>); with EN it reads the ENO — so that is the slot, where the box has one. A bit operator
    /// without EN keeps the text's reading (connected by none), and an enabled box with no ENO in its list has no slot
    /// the text could state: it stays unread, and the writer names it.</summary>
    [Theory]
    [InlineData("MAX", false, new string[0], 0, "n := MAX(a, b);")]
    [InlineData("ADD", false, new string[0], 0, "n := (a + b);")]
    [InlineData("AND", true, new[] { "ENO" }, 0, "n := AND(EN := c, a, b).ENO;")]
    [InlineData("MOVE", true, new[] { "ENO", "" }, 0, "n := MOVE(EN := c, a, b).ENO;")]
    [InlineData("MOVE", true, new string[0], null, null)]
    public void A_consumed_box_Volt_built_is_connected_as_the_compiler_reads_it(
        string type, bool enabled, string[] outputNames, int? slot, string? text)
    {
        var inputs = new List<object>();
        if (enabled) inputs.Add(Nwl.Leaf("c"));
        inputs.Add(Nwl.Leaf("a"));
        inputs.Add(Nwl.Leaf("b"));
        var box = new Nwl.BoxTreeBox
        {
            BoxType = type,
            InputItemList = inputs.ToArray(),
            InputParams = enabled ? new Nwl.ParamList { Names = new[] { "EN", "", "" }, Types = new[] { "", "", "" } } : new Nwl.ParamList(),
            OutputParams = new Nwl.ParamList { Names = outputNames, Types = outputNames.Select(_ => "").ToArray() },
        };
        foreach (var _ in outputNames) box.Outputs.List.Add(new Nwl.Operand { OperandExpr = "" });
        var assign = new Nwl.BoxTreeAssign { RValue = box };
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "n", IsLValue = true });

        var body = CodesysNetworkReader.Read(Nwl.Body(assign), BodyLanguage.Fbd);
        var read = Assert.IsType<Box>(Assert.IsType<Assign>(body.Networks.Single().Trees.Single()).Value);

        Assert.Equal(slot, read.ConnectedSlot);
        if (text is null)
            Assert.Throws<NetworkUnrepresentableException>(() => NetworkTextWriter.Write(body, Volt.Tests.Shared.NetworkModelOracle.ScopeOf(body)));
        else
            Assert.Contains("  " + text + "\n", NetworkTextWriter.Write(body, Volt.Tests.Shared.NetworkModelOracle.ScopeOf(body)));
    }

    /// <summary>THE STORED OUTPUT TYPES (spec, "a stored output type"): <c>OutputParams.Types</c>, the array beside
    /// the <c>Names</c> this reader already reads (<c>scripts/nwl-oracle-rungs.log</c>: <c>Names=['ENO', '']
    /// Types=['BOOL', 'INT']</c>). No reader filled <see cref="Box.OutputTypes"/>, so every wire a data box feeds went
    /// to the marker as "a wire of unknown type" although the vendor stores it. An empty entry is an unresolved slot,
    /// an unknown type — null, never a default.</summary>
    [Fact]
    public void A_wire_fed_by_a_data_box_is_declared_with_its_stored_output_type()
    {
        var add = new Nwl.BoxTreeBox
        {
            BoxType = "ADD",
            InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("b") },
            OutputParams = new Nwl.ParamList { Names = new[] { "", "" }, Types = new[] { "INT", "" } },
            MainOutputIndex = 0,
        };
        var use = new Nwl.BoxTreeAssign { RValue = new Nwl.BoxTreeDemux { VarId = 1 } };
        use.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out", IsLValue = true });

        var body = CodesysNetworkReader.Read(Nwl.Body(new Nwl.BoxTreeDemux { VarId = 1, Input = add }, use), BodyLanguage.Fbd);

        var read = Assert.IsType<Box>(Assert.IsType<Demux>(body.Networks.Single().Trees[0]).Input);
        Assert.Equal(new[] { "INT", null }, read.OutputTypes);
        Assert.Contains("  VAR_TEMP g1 : INT; END_VAR\n  g1 := (a + b);\n",
            NetworkTextWriter.Write(body, Volt.Tests.Shared.NetworkModelOracle.ScopeOf(body)));
    }
    /// <summary>A NETWORK THAT REPORTS MORE ITEMS THAN IT HAS reads as the trees it really has — the phantom slot
    /// is SKIPPED, not thrown on and not rendered as an empty body.
    ///
    /// <para>Measured: "a network reported 2 with one tree, the second slot being an item the IDE had dropped".
    /// The reader answers that with `TryCall` + a null skip, and that path had no test at all, because the double
    /// defined `NetworkItemCount => _trees.Count` and so could never disagree with itself. The failure it guards
    /// is the ugly kind: a POU materializing with a header and no logic.</para></summary>
    [Fact]
    public void A_network_reporting_a_dropped_item_skips_the_phantom_slot()
    {
        var assign = new Nwl.BoxTreeAssign();
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out" });
        var net = new Nwl.Network().With(assign);
        net.PhantomItemCount = 2;   // the vendor says two items; only one is really there

        var read = CodesysNetworkReader.ReadNetwork(net, 0);

        // The real tree survived, and nothing was invented for the phantom slot.
        Assert.Single(read.Trees);
        Assert.IsType<Assign>(read.Trees.Single());
    }

    /// <summary>A NETWORK CARRYING A VENDOR SPLIT POINT IS REFUSED, naming the operand. Volt has no text form for
    /// one, and rendering a body silently missing it is the loss this refusal exists to prevent.
    ///
    /// <para>The refusal had no test either: the double's `GetSplitPoint` was hardcoded to null, so the throw was
    /// unreachable. Rare — zero across all 356 networks of the one real project surveyed — but "rare" is not
    /// "cannot happen", and an untested throw is one nobody knows the wording of until a customer hits it.</para></summary>
    [Fact]
    public void A_network_carrying_a_vendor_split_point_is_refused_by_name()
    {
        var assign = new Nwl.BoxTreeAssign();
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out" });
        var net = new Nwl.Network().With(assign);
        net.SplitPoint = new Nwl.Operand { OperandExpr = "gSplit" };

        // AND IT REFUSES AS A MARKER, not as a bare throw. A bare `NotSupportedException` escapes the reader,
        // reaches `Versioning.SafeVersion`, and is isolated by stamping the item Unreadable — `FetchService`
        // then drops the POU from `changed`, `items` AND `folders`, so the engineer loses the whole file from
        // the workspace and from git over one construct in one network. The marker says what the body holds
        // and keeps the POU; `VendorCapabilityParityTests` gates the distinction, because it is invisible at
        // the throw site.
        var ex = Assert.Throws<UnrepresentableBodyException>(() => CodesysNetworkReader.ReadNetwork(net, 0));
        Assert.Equal("a vendor split point", ex.Marker);
        Assert.Contains("split point", ex.Message);
        Assert.Contains("gSplit", ex.Message);   // the engineer needs to know WHICH one
    }
    /// <summary>AN EMPTY EXECUTE BOX IS STILL AN EXECUTE BOX — <c>StCode</c> is <c>""</c>, never null.
    ///
    /// <para>`ReadStCode` trailed with <c>is { Length: &gt; 0 } t ? t : null</c>, so a box whose ST the engineer
    /// had blanked came back with a NULL <c>StCode</c> and the writer skipped its <c>EXECUTE … END_EXECUTE</c>
    /// arm entirely, rendering the box as <c>EXECUTE();</c> — a call to a function that does not exist. That is
    /// the same bad shape this file's main comment describes, reached by a second route.</para>
    ///
    /// <para>It also broke the parity boundary: TwinCAT joins the archive's TextLines and answers <c>""</c> for
    /// the identical box, so the two vendors served different sourceText for the same POU. And it did not stop
    /// at the pull — pushing the pulled <c>EXECUTE();</c> back rebuilds the network with <c>StCode is null</c>,
    /// so no STSnippet is written at all and the Execute box returns as an ordinary box named EXECUTE.</para>
    /// </summary>
    [Fact]
    public void An_execute_box_with_empty_ST_reads_as_empty_not_missing()
    {
        var box = Nwl.ExecuteBox(new Nwl.STSnippet { Snippet = new _3S.CoDeSys.STObject.STImplementationObject() });

        var body = CodesysNetworkReader.Read(Nwl.Body(box), BodyLanguage.Fbd);

        var read = Assert.IsType<Box>(body.Networks.Single().Trees.Single());
        Assert.Equal("", read.StCode);
        Assert.Contains("END_EXECUTE", NetworkTextWriter.Write(body, NetworkScope.Empty));
    }

    /// <summary>The complement, so the rule above cannot decay into "always empty": a snippet WITH text still
    /// reads its text.</summary>
    [Fact]
    public void An_execute_box_reads_its_ST()
    {
        var impl = new _3S.CoDeSys.STObject.STImplementationObject();
        Nwl.TextDocument.ThrowsAfterInsert = false;
        try { impl.TextDocument.Insert(0, "n := n + 1;"); }
        finally { Nwl.TextDocument.ThrowsAfterInsert = true; }

        var box = Nwl.ExecuteBox(new Nwl.STSnippet { Snippet = impl });

        var read = Assert.IsType<Box>(
            CodesysNetworkReader.Read(Nwl.Body(box), BodyLanguage.Fbd).Networks.Single().Trees.Single());
        Assert.Equal("n := n + 1;", read.StCode);
    }

    /// <summary>AND UNREADABLE IS NOT EMPTY. A box that says it provides a snippet and hands over one with no
    /// text document is an object-model mismatch — the loud failure, not an empty box. TwinCAT's reader already
    /// throws for its own unwalkable snippet; this is the same refusal on the same wire.</summary>
    [Fact]
    public void An_execute_box_whose_snippet_has_no_document_throws()
    {
        var box = Nwl.ExecuteBox(new Nwl.STSnippet());   // ProvidesSTSnippet is true; the Snippet aspect is absent

        // THE TYPE IS THE CONTRACT, not the wording. This asserted a bare `NotSupportedException`, and the
        // driver above it had no way to tell this refusal from any other — so it did not try, and the throw
        // reached `Versioning.SafeVersion`, which stamps the item UNREADABLE and drops the whole POU from the
        // workspace and from git. TwinCAT answered the same body with a marker. The exception now carries the
        // marker the driver should materialize, and `VendorCapabilityParityTests` holds both drivers to
        // catching it.
        var ex = Assert.Throws<UnrepresentableBodyException>(
            () => CodesysNetworkReader.Read(Nwl.Body(box), BodyLanguage.Fbd));
        Assert.Equal("EXECUTE", ex.Marker);
    }
}
