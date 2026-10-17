using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Engine.Tests;

/// <summary>
/// The network text writer's goldens (openspec <c>ld-fbd-coverage</c> 2R.3): a VENDOR MODEL in, the text out — the
/// facts a text cannot state (an ENO output, a stored slot, a box the vendor holds with no ENO read) are what these pin,
/// and every expected string is the grammar of <c>readability.md</c> (B1–B8, P1–P16), not the writer's output. The
/// grammar's text-to-model side is the shared case set (<c>test/fixtures/network-text</c>, <see cref="NetworkTextCaseTests"/>).
/// </summary>
public class NetworkTextWriterTests
{
    // ── builders ────────────────────────────────────────────────────────────────────────────────

    static Leaf L(string text, Flags? f = null) => new(new Operand(text), f ?? Flags.None);
    static Leaf LT(string text, string type) => new(new Operand(text, Type: type), Flags.None);
    static Operand T(string text, Flags? f = null) => new(text, IsLValue: true, Flags: f);
    static Terminator Empty => new(Flags.None);
    static Input In(Node v, string? formal = null) => new(formal, v, Flags.None);
    static Demux Ref(int id) => new(id, null);
    static Demux Def(int id, Node v) => new(id, v);
    static Assign Set(Node v, params Operand[] targets) => new(v, targets, Flags.None);
    static readonly Flags Neg = Flags.None with { Negated = true };
    static readonly Flags Rise = Flags.None with { Rising = true };
    static readonly Flags Fall = Flags.None with { Falling = true };

    /// <summary>An operator box as its word: no EN, no instance, no outputs. The vendor stores no main output index on
    /// AND/OR (census 1.6: None on 823 boxes), so a consumer's connection is null == null.</summary>
    static Box Op(string type, params Node[] inputs) =>
        new(type, null, CallKind.Operator, inputs.Select(i => In(i)).ToList(), new List<Output>(), null, null, Flags.None);

    static Box Call(string type, IEnumerable<Input> inputs, IEnumerable<Output>? outputs = null, Node? en = null,
                    int? main = 0, int? connected = null, Flags? f = null, Operand? instance = null,
                    CallKind kind = CallKind.Function, IReadOnlyList<string?>? types = null, bool? eno = null) =>
        new(type, instance, kind, inputs.ToList(), (outputs ?? Array.Empty<Output>()).ToList(), en, null, f ?? Flags.None,
            MainOutputIndex: main, ConnectedSlot: connected, OutputTypes: types, HasEnoOutput: eno);

    static Box Fb(string instance, IEnumerable<Input> inputs, IEnumerable<Output>? outputs = null, string type = "FB") =>
        Call(type, inputs, outputs, main: null, instance: new Operand(instance, IsInstance: true), kind: CallKind.FunctionBlock);

    static Box Exec(string st, Node? en = null, int? connected = null) =>
        new("EXECUTE", null, CallKind.Function, new List<Input>(), new List<Output>(), en, st, Flags.None,
            ConnectedSlot: connected);

    static Output Out(string target, int? slot, string? formal = null) => new(formal, new Operand(target, IsLValue: true), slot);

    static Network Net(params Node[] trees) => new(0, null, null, null, false, trees);

    /// <summary>Write one network against a scope declaring <paramref name="names"/> and the body's own FB instances — and,
    /// where it writes, hold the model to the oracle <c>Read(Write(m)) ≅ m</c> (<see cref="NetworkModelOracle"/>): every
    /// golden here is one the text carries whole.</summary>
    static string Write(Network net, BodyLanguage lang = BodyLanguage.Fbd, params string[] names)
    {
        var body = new NetworkBody(lang, new[] { net });
        var text = NetworkTextWriter.Write(body, new NetworkScope(names, Array.Empty<string>(), NetworkModelOracle.Instances(body)));
        Assert.Null(NetworkModelOracle.Check("writer golden", body).Reason);
        return text;
    }

    static string Write(Node tree, BodyLanguage lang = BodyLanguage.Fbd) => Write(Net(tree), lang);

    const string Fbd = "IMPLEMENTATION FBD\n";
    const string Ld = "IMPLEMENTATION LD\n";

    /// <summary>A one-network FBD body holding exactly these lines.</summary>
    static string Body(params string[] lines) =>
        Fbd + "NETWORK\n" + string.Concat(lines.Select(l => "  " + l + "\n")) + "END_NETWORK\n";

    static UnrepresentableBodyException Refused(Func<string> write) =>
        Assert.ThrowsAny<UnrepresentableBodyException>(() => write());

    // ── the body marker and the Network item ────────────────────────────────────────────────────

    [Fact]
    public void The_language_rides_on_the_implementation_marker_and_the_header_has_no_order_number()
    {
        Assert.Equal(Ld + "NETWORK\n  ;\nEND_NETWORK\n", Write(Empty, BodyLanguage.Ld));
        Assert.Equal(Fbd + "NETWORK\n  ;\nEND_NETWORK\n", Write(new Network(7, null, null, null, false, new Node[] { Empty })));
    }

    /// <summary>P12: <c>NETWORK [LABEL: x] [DISABLED] [TITLE: "…"]</c>, in that order, the title in ST's escapes; the comment
    /// its CR LF lines, `// ` and one space syntax, everything after it text.</summary>
    [Fact]
    public void Header_comment_and_items_in_that_order()
    {
        var net = new Network(0, "Tray \"A\" ready", "Done",
            "Indented notes keep their indentation:\r\n    step 1 — wait for the tray\r\n\r\n// a line that itself starts with two slashes",
            true, new Node[] { Def(0, L("TRUE")) });
        Assert.Equal(
            Fbd +
            "NETWORK LABEL: Done DISABLED TITLE: \"Tray $\"A$\" ready\"\n" +
            "  // Indented notes keep their indentation:\n" +
            "  //     step 1 — wait for the tray\n" +
            "  //\n" +
            "  // // a line that itself starts with two slashes\n" +
            "  split0 := TRUE;\n" +
            "END_NETWORK\n",
            Write(net));
    }

    /// <summary>P12: a comment exactly as stored — a trailing CR LF is a final bare `//` line, trailing spaces stay.</summary>
    [Fact]
    public void A_comment_is_written_exactly_as_stored()
    {
        var net = new Network(0, null, null, "step:\r\n\r\n    indented  \r\n// quoted\r\n", false, new Node[] { Set(L("a"), T("out")) });
        Assert.Equal(Fbd + "NETWORK\n  // step:\n  //\n  //     indented  \n  // // quoted\n  //\n  out := a;\nEND_NETWORK\n", Write(net));
    }

    /// <summary>P12: lines are separated by CR LF in the stored comment; a LF on its own has no spelling.</summary>
    [Fact]
    public void A_comment_line_ending_in_a_bare_line_feed_has_no_spelling() =>
        Assert.Equal("a comment line ending in a bare line feed",
            Refused(() => Write(new Network(0, null, null, "line1\nline2", false, new Node[] { Empty }))).Reason);

    /// <summary>2R.2 S: the title exactly as stored — a trailing space or the newline an engineer typed after it included.</summary>
    [Fact]
    public void A_title_is_written_exactly_as_stored()
    {
        Assert.Equal(Fbd + "NETWORK TITLE: \"line 1$Nline 2 costs $$5\"\n  ;\nEND_NETWORK\n",
            Write(new Network(0, "line 1\nline 2 costs $5", null, null, false, new Node[] { Empty })));
        Assert.Equal(Fbd + "NETWORK TITLE: \"TODO Network 4: \"\n  ;\nEND_NETWORK\n",
            Write(new Network(0, "TODO Network 4: ", null, null, false, new Node[] { Empty })));
        Assert.Equal(Fbd + "NETWORK TITLE: \"testlabel$R$N\"\n  ;\nEND_NETWORK\n",
            Write(new Network(0, "testlabel\r\n", null, null, false, new Node[] { Empty })));
    }

    // ── value; and the empty item ───────────────────────────────────────────────────────────────

    [Fact]
    public void A_flagged_top_level_box_is_a_value_statement() =>
        Assert.Equal(Body("NOT f(x);"), Write(Call("f", new[] { In(L("x")) }, f: Neg)));

    [Fact]
    public void A_box_with_no_input_slot() =>
        Assert.Equal(Body("GetTime();"), Write(Call("GetTime", Array.Empty<Input>())));

    /// <summary>A top-level leaf, split reference and parallel are value items; the parallel is `BRANCH (a, b)` (B8).</summary>
    [Fact]
    public void A_top_level_leaf_split_reference_and_parallel_are_value_items()
    {
        Assert.Equal(Body("a;"), Write(L("a")));
        Assert.Equal(Body("BRANCH (a,", "        b) SHORTCIRCUIT;"),
            Write(new Parallel(null, new Node[] { L("a"), L("b") }, ParallelMode.BoxShortCircuit)));
        Assert.Equal(Body("split1 := TRUE;", "split1;"), Write(Net(Def(1, L("TRUE")), Ref(1))));
    }

    [Fact]
    public void The_empty_item_is_a_semicolon_on_its_own_line() =>
        Assert.Equal(Body("out := a;", ";"), Write(Net(Set(L("a"), T("out")), Empty)));

    // ── BoxTreeOperand: a token, else backticks ─────────────────────────────────────────────────

    [Fact]
    public void An_operand_that_is_not_one_token_is_backticked_in_place()
    {
        Assert.Equal(Body("t1(IN := `DINT_TO_REAL(x)`);"),
            Write(Fb("t1", new[] { In(L("DINT_TO_REAL(x)"), "IN") })));
        Assert.Equal(Body("fb(P := `fc_dinttotime(T.Start,2)`);"),
            Write(Fb("fb", new[] { In(L("fc_dinttotime(T.Start,2)"), "P") })));
    }

    [Fact]
    public void Lvalues_that_are_not_one_token_are_backticked()
    {
        Assert.Equal(Body("`arr[i + 1]` := x;"), Write(Set(L("x"), T("arr[i + 1]"))));
        Assert.Equal(Body("`a .b` := x;"), Write(Set(L("x"), T("a .b"))));
    }

    /// <summary>P14: a literal is bare — a string, a negative number with its minus touching it, a typed literal.</summary>
    [Fact]
    public void Tokens_and_literals_stay_bare()
    {
        Assert.Equal(Body("out := (s.f AND T#1S) OR ???;"),
            Write(Set(Op("OR", Op("AND", L("s.f"), L("T#1S")), L("???")), T("out"))));
        Assert.Equal(Body("sName := 'Recipes';"), Write(Set(L("'Recipes'"), T("sName"))));
        Assert.Equal(Body("n := -1;"), Write(Set(L("-1"), T("n"))));
        Assert.Equal(Body("w := \"wide\";"), Write(Set(L("\"wide\""), T("w"))));
    }

    [Fact]
    public void Operand_text_holding_a_backtick_goes_to_the_marker() =>
        Assert.Equal("operand text containing a backtick", Refused(() => Write(Set(L("a`b"), T("out")))).Reason);

    // ── IFlags on a value: NOT, R_EDGE, F_EDGE ──────────────────────────────────────────────────

    /// <summary>B1 and the NOT box (P5: it names its input, <c>NOT(IN := a)</c>; its pin is a slot, P4).</summary>
    [Fact]
    public void Box_words_and_the_NOT_box()
    {
        Assert.Equal(Body("out := (a AND b) OR c;"), Write(Set(Op("OR", Op("AND", L("a"), L("b")), L("c")), T("out"))));
        Assert.Equal(Body("out := NOT a;"), Write(Set(L("a", Neg), T("out"))));
        Assert.Equal(Body("out := NOT (a AND b);"),
            Write(Set(new Box("AND", null, CallKind.Operator, new[] { In(L("a")), In(L("b")) }, new Output[0], null, null, Neg), T("out"))));
        Assert.Equal(Body("out := NOT(IN := a);"), Write(Set(Call("NOT", new[] { In(L("a")) }, main: null), T("out"))));
        Assert.Equal(Body("out := NOT(IN := a AND b);"),
            Write(Set(Call("NOT", new[] { In(Op("AND", L("a"), L("b"))) }, main: null), T("out"))));
    }

    [Fact]
    public void Edges_are_flags_spelled_R_EDGE_and_F_EDGE()
    {
        var move = Call("MOVE", new[] { In(L("1")) }, new[] { Out("nMode", 1) }, en: L("bStart", Rise), eno: true);
        Assert.Equal(Body("MOVE 1 => nMode EN R_EDGE(bStart);"), Write(move));

        Assert.Equal(Body("lamp := R_EDGE(a AND b);"),
            Write(Set(new Box("AND", null, CallKind.Operator, new[] { In(L("a")), In(L("b")) }, new Output[0], null, null, Rise), T("lamp"))));
    }

    /// <summary>A FLAG ON A SPLIT OR A PARALLEL HAS NO VENDOR FORM (DIALECT N20): the model cannot carry one.</summary>
    [Fact]
    public void A_split_or_a_Parallel_cannot_carry_a_flag()
    {
        var par = new Parallel(null, new Node[] { L("a"), L("b") }, ParallelMode.BoxShortCircuit);
        Assert.Equal(Flags.None, Ref(3).Flags);
        Assert.Equal(Flags.None, par.Flags);
        foreach (var t in new[] { typeof(Demux), typeof(Parallel) })
            Assert.DoesNotContain(t.GetConstructors().SelectMany(c => c.GetParameters()), p => p.ParameterType == typeof(Flags));

        Assert.Throws<ArgumentException>(() => Ref(3) with { Flags = Neg });
        Assert.Throws<ArgumentException>(() => par with { Flags = Neg });
        Assert.Throws<ArgumentException>(() => (Node)Def(3, L("a")) with { Flags = Rise });
        Assert.Throws<ArgumentException>(() => (Node)par with { Flags = Fall });
        Assert.Equal(Ref(3).Flags, (Ref(3) with { Flags = Flags.None }).Flags);
    }

    /// <summary>The one order is the vendor's — it negates before it detects the edge (DIALECT N17).</summary>
    [Fact]
    public void Negation_with_an_edge_is_NOT_inside()
    {
        Assert.Equal(Body("out := F_EDGE(NOT x);"), Write(Set(L("x", Neg with { Falling = true }), T("out"))));
        Assert.Equal(Body("out := R_EDGE(NOT (a AND b));"),
            Write(Set(new Box("AND", null, CallKind.Operator, new[] { In(L("a")), In(L("b")) }, new Output[0], null, null, Neg with { Rising = true }), T("out"))));
    }

    [Fact]
    public void Rising_and_falling_on_one_operand_goes_to_the_marker() =>
        Assert.Equal("rising and falling on one operand",
            Refused(() => Write(Set(L("x", Rise with { Falling = true }), T("out")))).Reason);

    /// <summary>S6 / P10: a negated pin is spelled on its formal, an operator's in its call form.</summary>
    [Fact]
    public void A_pins_modifier_is_spelled_on_its_formal()
    {
        Assert.Equal(Body("f(NOT IN1 := x);"), Write(Call("f", new[] { new Input("IN1", L("x"), Neg) })));
        Assert.Equal(Body("o := AND(a, NOT IN2 := b);"),
            Write(Set(Call("AND", new[] { In(L("a")), new Input(null, L("b"), Neg) }, main: null), T("o"))));
        // 2R.5 (#15): an edge on a pin stores, builds and runs — before its formal. With a negation it is not measured.
        Assert.Equal(Body("f(R_EDGE IN1 := x);"), Write(Call("f", new[] { new Input("IN1", L("x"), Rise) })));
        Assert.Equal("a flag on a box input pin",
            Refused(() => Write(Set(Call("AND", new[] { new Input(null, L("a"), Flags.None with { Falling = true, Negated = true }), In(L("b")) }, main: null), T("o")))).Reason);
        Assert.Equal("a flag on a box input pin", Refused(() => Write(Call("f", new[] { new Input("IN1", L("x"), Flags.None with { Set = true }) }))).Reason);
        Assert.Equal("a modified unnamed pin of a call", Refused(() => Write(Call("f", new[] { new Input(null, L("x"), Neg) }))).Reason);
    }

    [Fact]
    public void A_flag_on_an_Assign_item_goes_to_the_marker() =>
        Assert.Equal("a flag on an Assign item", Refused(() => Write(new Assign(L("a"), new[] { T("out") }, Neg))).Reason);

    /// <summary>2R.5 (#6a): a negated empty slot is written `NOT` before a plain coil's `;`, the one place it is measured;
    /// elsewhere, and an edge on one, it goes to the marker.</summary>
    [Fact]
    public void A_negated_empty_slot_is_written_and_an_edge_on_one_goes_to_the_marker()
    {
        Assert.Equal(Body("x := NOT ;"), Write(Set(new Terminator(Neg), T("x"))));
        Assert.Equal("a negated empty slot outside a coil value",
            Refused(() => Write(Call("f", new[] { In(new Terminator(Neg)), In(L("a")) }))).Reason);
        Assert.Equal("a negated empty slot outside a coil value",
            Refused(() => Write(new Assign(new Terminator(Neg), new[] { T("Done", Flags.None with { Jump = true }) }, Flags.None with { Jump = true }))).Reason);
        Assert.Equal("a flag on an empty slot",
            Refused(() => Write(Call("f", new[] { In(new Terminator(Rise)), In(L("a")) }))).Reason);
        // …and only one PLAIN coil's (gate 2R.5): a set coil's, and a fan-out's, are unmeasured.
        Assert.Equal("a negated empty slot outside a coil value",
            Refused(() => Write(Set(new Terminator(Neg), T("x", Flags.None with { Set = true })))).Reason);
        Assert.Equal("a negated empty slot outside a coil value",
            Refused(() => Write(new Assign(new Terminator(Neg), new[] { T("x"), T("y") }, Flags.None))).Reason);
    }

    /// <summary>Gate 2R.5: a negated or edge coil is measured alone on its item; beside another coil (a coil, a set or
    /// reset coil, a jump) it goes to the marker.</summary>
    [Fact]
    public void A_modified_coil_beside_another_coil_goes_to_the_marker()
    {
        var jump = Flags.None with { Jump = true };
        Assert.Equal("a modified coil beside another coil", Refused(() => Write(new Assign(L("c"), new[] { T("y"), T("xn", Neg) }, Flags.None))).Reason);
        Assert.Equal("a modified coil beside another coil",
            Refused(() => Write(new Assign(L("c"), new[] { T("x", Rise), T("y", Flags.None with { Set = true }) }, Flags.None))).Reason);
        Assert.Equal("a modified coil beside another coil",
            Refused(() => Write(new Assign(L("c"), new[] { T("x", Rise), T("Done", jump) }, Flags.None))).Reason);
    }

    // ── BoxTreeBox: calls, instances, ??? ───────────────────────────────────────────────────────

    [Fact]
    public void Calls_FB_instances_and_functions()
    {
        Assert.Equal(Body("t1(IN := a, PT := pt, ET => el);"),
            Write(Fb("t1", new[] { In(L("a"), "IN"), In(L("pt"), "PT") }, new[] { Out("el", 2, "ET") }, "TON")));
        Assert.Equal(Body("dst := f(src, oErr => err);"),
            Write(Set(Call("f", new[] { In(L("src")) }, new[] { Out("err", 1, "oErr") }, connected: 0, eno: false), T("dst"))));
        Assert.Equal(Body("out := MAX(a, b);"),
            Write(Set(Call("MAX", new[] { In(L("a")), In(L("b")) }, connected: 0, eno: false), T("out"))));
    }

    [Fact]
    public void Unnamed_instances_carry_their_type_and_question_marks_are_content()
    {
        var unnamed = Call("TON", new[] { In(L("a"), "IN"), In(L("t"), "PT") }, main: null,
            instance: new Operand("???", IsInstance: true), kind: CallKind.FunctionBlock);
        Assert.Equal(Body("??? : TON(IN := a, PT := t);"), Write(unnamed));
        Assert.Equal(Body("??? := ioAxis.xVirtual;"), Write(Set(L("ioAxis.xVirtual"), T("???"))));
        Assert.Equal(Body("t1(IN := ???, PT := pt, ET => ???);"),
            Write(Fb("t1", new[] { In(L("???"), "IN"), In(L("pt"), "PT") }, new[] { Out("???", 2, "ET") }, "TON")));
        Assert.Equal(Body("out := ??? AND a;"), Write(Set(Op("AND", L("???"), L("a")), T("out"))));
    }

    /// <summary>An operator's default formals are no fact of the text (its word); a non-default one forces the call form.</summary>
    [Fact]
    public void Default_formals_are_the_word_and_a_non_default_one_forces_call_form()
    {
        Assert.Equal(Body("out := a AND b;"),
            Write(Set(Call("AND", new[] { In(L("a"), "IN1"), In(L("b"), "IN2") }, main: null), T("out"))));
        Assert.Equal(Body("out := ADD(X := a, b);"),
            Write(Set(Call("ADD", new[] { In(L("a"), "X"), In(L("b")) }, connected: 0, eno: false), T("out"))));
    }

    // ── EN after the box, ENO on the line below (B3, B4) ────────────────────────────────────────

    [Fact]
    public void EN_follows_the_box_and_a_box_writes_its_own_result_pins()
    {
        Assert.Equal(Body("MOVE b EN a;"), Write(Call("MOVE", new[] { In(L("b")) }, en: L("a"))));
        Assert.Equal(Body("MOVE 0 => Status EN c;"),
            Write(Call("MOVE", new[] { In(L("0")) }, new[] { Out("Status", 1) }, en: L("c"), eno: true)));
        Assert.Equal(Body("a AND b => out EN go;"),
            Write(Call("AND", new[] { In(L("a")), In(L("b")) }, new[] { Out("out", 1) }, en: L("go"), main: null, eno: true)));

        var sub = Call("SUB", new[] { In(L("light")), In(L("deviation")) }, new[] { Out("diff", 1) }, en: L("rung"), connected: 0, eno: true);
        Assert.Equal(Body("light SUB deviation => diff EN rung", "sensor GT diff => out EN ENO;"),
            Write(Call("GT", new[] { In(L("sensor")), In(L("diff")) }, new[] { Out("out", 1) }, en: sub, eno: true)));
    }

    /// <summary>B4: a box read through its ENO is its own line without <c>;</c>, read on the next line by ENO.</summary>
    [Fact]
    public void An_enabled_box_consumed_by_its_ENO_is_the_line_above() =>
        Assert.Equal(Body("MOVE 0 => Status EN c", "lamp := ENO;"),
            Write(Set(Call("MOVE", new[] { In(L("0")) }, new[] { Out("Status", 1) }, en: L("c"), connected: 0, eno: true), T("lamp"))));

    /// <summary>The empty enable (2R.1 Open item 1): <c>EN</c> with nothing after it.</summary>
    [Fact]
    public void An_EN_shown_but_unwired_is_the_bare_EN()
    {
        Assert.Equal(Body("out := (stActHeightElevator GE tInt EN);"),
            Write(Set(Call("GE", new[] { In(L("stActHeightElevator")), In(L("tInt")) }, en: Empty, connected: 0, eno: false), T("out"))));
        Assert.Equal(Body("a MUL b EN", "out := ENO;"),
            Write(Set(Call("MUL", new[] { In(L("a")), In(L("b")) }, en: Empty, connected: 0, eno: true), T("out"))));
    }

    [Fact]
    public void Positional_result_pins_fill_the_slots_left_after_the_connected_one()
    {
        Assert.Equal(Body("MOVE src => dst;"), Write(Call("MOVE", new[] { In(L("src")) }, new[] { Out("dst", 0) }, eno: false)));
        Assert.Equal(Body("out := f(src, => err);"),
            Write(Set(Call("f", new[] { In(L("src")) }, new[] { Out("err", 1) }, connected: 0, eno: false), T("out"))));
        // A slot passed over is a bare `=>` in a call.
        Assert.Equal(Body("out := f(src, =>, => b);"),
            Write(Set(Call("f", new[] { In(L("src")) }, new[] { Out("b", 2) }, connected: 0, eno: false), T("out"))));
    }

    /// <summary>P5: a consumer of an enabled box reads its ENO; read by its data, it has no spelling.</summary>
    [Fact]
    public void A_connection_by_neither_the_main_output_nor_ENO_goes_to_the_marker()
    {
        Assert.Equal("a connection by an unspellable output slot",
            Refused(() => Write(Set(Call("f", new[] { In(L("src")) }, main: 0, connected: 1, eno: false), T("out")))).Reason);
        Assert.Equal("an enabled box read as a value",
            Refused(() => Write(Set(Call("MOVE", new[] { In(L("0")) }, en: L("c"), main: 1, connected: 1, eno: true), T("out")))).Reason);
    }

    /// <summary>An enabled comparison consumed by its main output: EN wired, one data output, no ENO (40 such boxes) —
    /// the one enabled VALUE (B4), bracketed in every slot (P4 (2)).</summary>
    [Fact]
    public void An_enabled_comparison_consumed_by_its_main_output_is_a_value() =>
        Assert.Equal(Body("out := (a GT b EN c);"),
            Write(Set(Call("GT", new[] { In(L("a")), In(L("b")) }, en: L("c"), main: 0, connected: 0, eno: false), T("out"))));

    /// <summary>A MOVE showing EN/ENO consumed by its main output (MainOutputIndex 0) is read through its ENO.</summary>
    [Fact]
    public void ENO_wins_where_it_is_also_the_main_output() =>
        Assert.Equal(Body("MOVE 0 => Status EN c", "lamp := ENO;"),
            Write(Set(Call("MOVE", new[] { In(L("0")) }, new[] { Out("Status", 1) }, en: L("c"), main: 0, connected: 0, eno: true), T("lamp"))));

    /// <summary>An FB declaring ENO without EN (Lenze <c>Dryer</c>) hands its ENO on with no EN (P3).</summary>
    [Fact]
    public void A_box_with_ENO_and_no_EN_consumed_by_its_ENO() =>
        Assert.Equal(Body("Dryer(a, => speed)", "out := ENO;"),
            Write(Set(Call("Dryer", new[] { In(L("a")) }, new[] { Out("speed", 1) }, main: 0, connected: 0, eno: true), T("out"))));

    /// <summary>P3, N21: an OPERATOR box shows ENO only with EN — one consumed by its ENO without EN has no text (0 in the
    /// corpora); read by its main output it is its word.</summary>
    [Fact]
    public void An_operator_box_without_EN_consumed_by_its_ENO_goes_to_the_marker()
    {
        var byEno = Set(Call("ADD", new[] { In(L("a")), In(L("b")) }, main: 0, connected: 0, eno: true, kind: CallKind.Operator), T("out"));
        var byMain = Set(Call("ADD", new[] { In(L("a")), In(L("b")) }, main: 0, connected: 0, eno: false, kind: CallKind.Operator), T("out"));
        var andByEno = Set(Call("AND", new[] { In(L("a")), In(L("b")) }, main: null, connected: 0, eno: true, kind: CallKind.Operator), T("out"));

        Assert.Equal("an operator box without EN read through its ENO", Refused(() => Write(byEno)).Reason);
        Assert.Equal(Body("out := a ADD b;"), Write(byMain));
        Assert.Equal("an operator box without EN read through its ENO", Refused(() => Write(andByEno)).Reason);
        Assert.Null(NetworkModelOracle.Check("add-by-main", new NetworkBody(BodyLanguage.Fbd, new[] { Net(byMain) })).Reason);
    }

    /// <summary>P5: the named ENO pin — a variable stored on a box's ENO output — is the call form's <c>ENO =&gt; v</c>;
    /// a box without ENO has none to wire, and a positional pin skips the ENO slot.</summary>
    [Fact]
    public void The_named_ENO_pin_is_the_call_forms()
    {
        Assert.Equal(Body("MOVE(0, ENO => lamp) EN c;"),
            Write(Call("MOVE", new[] { In(L("0")) }, new[] { Out("lamp", null, "ENO") }, en: L("c"), eno: true)));
        Assert.Equal("an ENO output pin on a box without ENO",
            Refused(() => Write(Call("f", new[] { In(L("0")) }, new[] { Out("lamp", null, "ENO") }, eno: false))).Reason);
        Assert.Equal(Body("MOVE 0 => Status EN c;"),
            Write(Call("MOVE", new[] { In(L("0")) }, new[] { Out("Status", 1) }, en: L("c"), eno: true)));
        Assert.Equal("a connection by an unspellable output slot",
            Refused(() => Write(Call("MOVE", new[] { In(L("0")) }, new[] { Out("Status", 0) }, en: L("c"), eno: true))).Reason);
    }

    /// <summary>Where the ENO decides the text and the model does not say, it has no spelling. Null is "not read".</summary>
    [Fact]
    public void A_box_whose_ENO_output_was_not_read_goes_to_the_marker()
    {
        Assert.Equal("a box whose ENO output was not read",
            Refused(() => Write(Set(Call("f", new[] { In(L("src")) }, connected: 0), T("out")))).Reason);
        Assert.Equal("a box whose ENO output was not read",
            Refused(() => Write(Call("MOVE", new[] { In(L("src")) }, new[] { Out("dst", 1) }, en: L("c")))).Reason);
        Assert.Equal("a box whose ENO output was not read",
            Refused(() => Write(Set(Call("MOVE", new[] { In(L("0")) }, en: L("c"), main: null, connected: 0), T("lamp")))).Reason);
        // …and where it decides nothing, it is not asked: a top-level box with no positional pin.
        Assert.Equal(Body("MOVE b EN a;"), Write(Call("MOVE", new[] { In(L("b")) }, en: L("a"))));
    }

    /// <summary>A top-level box is read by its EN (<see cref="NetworkSpelling.TextHasEno"/>); one that rule misreads where it
    /// matters — its positional pins — has no spelling.</summary>
    [Fact]
    public void A_top_level_box_whose_ENO_the_text_would_misread_goes_to_the_marker()
    {
        Assert.Equal("an ENO output the text reads otherwise",
            Refused(() => Write(Call("GT", new[] { In(L("a")), In(L("b")) }, new[] { Out("x", 0) }, en: L("c"), eno: false))).Reason);
        Assert.Equal("an ENO output the text reads otherwise",
            Refused(() => Write(Call("Dryer", new[] { In(L("a")) }, new[] { Out("speed", 1) }, eno: true))).Reason);
    }

    [Fact]
    public void An_unnamed_output_with_no_stored_slot_goes_to_the_marker() =>
        Assert.Equal("an output pin with no stored slot",
            Refused(() => Write(Call("MOVE", new[] { In(L("src")) }, new[] { Out("dst", null) }, eno: false))).Reason);

    // ── empty slots ─────────────────────────────────────────────────────────────────────────────

    /// <summary>An empty slot is a position: the call form carries it (P5: <c>MUL(, m, 6)</c>, <c>MOVE(IN := , => x)</c>).</summary>
    [Fact]
    public void Empty_slots_are_positions()
    {
        Assert.Equal(Body("MUL(, iRPM, 6);"), Write(Op("MUL", Empty, L("iRPM"), L("6"))));
        Assert.Equal(Body("ctu(CU := a, RESET := , PV := );"),
            Write(Fb("ctu", new[] { In(L("a"), "CU"), In(Empty, "RESET"), In(Empty, "PV") })));
        Assert.Equal(Body("f(, a);"), Write(Call("f", new[] { In(Empty), In(L("a")) })));
        Assert.Equal(Body("f(a, );"), Write(Call("f", new[] { In(L("a")), In(Empty) })));
        Assert.Equal(Body("MOVE(IN := );"), Write(Call("MOVE", new[] { In(Empty, "IN") })));
        Assert.Equal(Body("MOVE(IN := , => x);"), Write(Call("MOVE", new[] { In(Empty) }, new[] { Out("x", 0) }, eno: false)));
        Assert.Equal(Body("coil := ;"), Write(Set(Empty, T("coil"))));
    }

    /// <summary>A lone unwired slot of a POU's call has no formal to stand on; an operator's takes its default (P6).</summary>
    [Fact]
    public void A_lone_unwired_slot_without_a_formal_goes_to_the_marker()
    {
        Assert.Equal("a lone unconnected input slot with no formal", Refused(() => Write(Call("f", new[] { In(Empty) }))).Reason);
        Assert.Equal(Body("MOVE(IN := );"), Write(Call("MOVE", new[] { In(Empty) })));
    }

    // ── EXECUTE (P9) ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Execute_boxes_on_their_line_and_read_by_ENO()
    {
        Assert.Equal(
            Fbd + "NETWORK\n  EXECUTE EN bRun\nIF bStart THEN\n\ttarget := 40 + 2;\nEND_IF\n  END_EXECUTE;\nEND_NETWORK\n",
            Write(Exec("IF bStart THEN\n\ttarget := 40 + 2;\nEND_IF", L("bRun"))));
        Assert.Equal(
            Fbd + "NETWORK\n  EXECUTE EN bRun\n\n  END_EXECUTE;\nEND_NETWORK\n",
            Write(Exec("", L("bRun"))));
        Assert.Equal(
            Fbd + "NETWORK\n  EXECUTE EN bRun\nx := 1;\n  END_EXECUTE\n  out := ENO;\nEND_NETWORK\n",
            Write(Set(Exec("x := 1;", L("bRun"), connected: 0), T("out"))));
    }

    [Fact]
    public void A_consumed_execute_box_without_EN_hands_its_ENO_on() =>
        Assert.Equal(Fbd + "NETWORK\n  EXECUTE\nx := 1;\n  END_EXECUTE\n  out := ENO;\nEND_NETWORK\n",
            Write(Set(Exec("x := 1;", connected: 0), T("out"))));

    [Fact]
    public void A_snippet_line_starting_END_EXECUTE_goes_to_the_marker_and_one_starting_Network_does_not()
    {
        Assert.Equal("a snippet line starting with END_EXECUTE",
            Refused(() => Write(Exec("x := 1;\n  END_EXECUTE y", L("bRun")))).Reason);
        Assert.Equal(Fbd + "NETWORK\n  EXECUTE\nNetworkState := 1;\n  END_EXECUTE;\nEND_NETWORK\n",
            Write(Exec("NetworkState := 1;")));
    }

    // ── BoxTreeAssign: coils ────────────────────────────────────────────────────────────────────

    [Fact]
    public void One_assign_several_coils_is_one_line()
    {
        var set = Flags.None with { Set = true };
        var reset = Flags.None with { Reset = true };
        Assert.Equal(
            Body("split0 := TRUE;", "lamp := x;", "stRestposition S= stLowerInpusher R= stInfeedTray R= split0;"),
            Write(Net(Def(0, L("TRUE")), Set(L("x"), T("lamp")),
                Set(Ref(0), T("stRestposition", set), T("stLowerInpusher", reset), T("stInfeedTray", reset)))));
    }

    /// <summary>2R.5 (#13, #14): a negated and an edge coil store and build; the modifier stands before the coil.</summary>
    [Fact]
    public void Negated_and_edge_coils_are_written_before_their_target()
    {
        Assert.Equal(Body("NOT out := a;"), Write(Set(L("a"), T("out", Neg))));
        Assert.Equal(Body("R_EDGE out := a;"), Write(Set(L("a"), T("out", Rise))));
        Assert.Equal(Body("F_EDGE out := a;"), Write(Set(L("a"), T("out", Fall))));
        Assert.Equal("an edge on a negated set or reset coil", Refused(() => Write(Set(L("a"), T("out", Rise with { Set = true })))).Reason);
        Assert.Equal("an edge on a negated set or reset coil", Refused(() => Write(Set(L("a"), T("out", Rise with { Negated = true })))).Reason);
        Assert.Equal("a negated set or reset coil", Refused(() => Write(Set(L("a"), T("out", Neg with { Set = true })))).Reason);
    }


    // ── Jump and Return (B4b) ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Labels_jumps_and_returns_are_coils()
    {
        var jumpBit = Flags.None with { Jump = true };
        var returnBit = Flags.None with { Return = true };
        var body = new NetworkBody(BodyLanguage.Fbd, new[]
        {
            Net(new Assign(L("a"), new[] { T("Done", jumpBit) }, jumpBit)),
            new Network(1, null, "Done", null, false, new Node[] { Set(L("a"), T("out")) }),
            Net(new Assign(Empty, new[] { T("Done", jumpBit) }, jumpBit)),
            Net(new Assign(L("a"), new Operand[0], returnBit)),
            Net(new Assign(Empty, new Operand[0], returnBit)),
        });
        Assert.Equal(
            Fbd +
            "NETWORK\n  JMP Done := a;\nEND_NETWORK\n" +
            "NETWORK LABEL: Done\n  out := a;\nEND_NETWORK\n" +
            "NETWORK\n  JMP Done;\nEND_NETWORK\n" +
            "NETWORK\n  RETURN := a;\nEND_NETWORK\n" +
            "NETWORK\n  RETURN;\nEND_NETWORK\n",
            NetworkTextWriter.Write(body, NetworkScope.Empty));
    }

    /// <summary>2R.5 (#9, #11): a jump is a coil — several on one rung, or beside a coil, each where it stands.</summary>
    [Fact]
    public void A_rung_with_several_control_flow_targets_writes_each_as_a_coil()
    {
        var jumpBit = Flags.None with { Jump = true };
        Assert.Equal(Body("JMP A := JMP B := a;"),
            Write(new Assign(L("a"), new[] { T("A", jumpBit), T("B", jumpBit) }, jumpBit)));
        Assert.Equal(Body("JMP A := out := a;"),
            Write(new Assign(L("a"), new[] { T("A", jumpBit), T("out") }, Flags.None)));
        Assert.Equal("a jump bit on an item no target carries",
            Refused(() => Write(new Assign(L("a"), new[] { T("A"), T("out") }, jumpBit))).Reason);
    }

    [Fact]
    public void A_return_with_a_named_target_goes_to_the_marker()
    {
        var returnBit = Flags.None with { Return = true };
        Assert.Equal("a return with a named target",
            Refused(() => Write(new Assign(L("a"), new[] { T("out", returnBit) }, Flags.None))).Reason);
    }

    // ── BoxTreeDemux: the split (B6) ────────────────────────────────────────────────────────────

    /// <summary>B6 (Mach1_MIDS network 0): a split is its VarId, defined once before its references, with no VAR_TEMP.</summary>
    [Fact]
    public void A_split_is_its_VarId_and_needs_no_declaration()
    {
        var net = new Network(0, "DONE Network 1: Activating/deactivating MID-S/Trayfiller", null, null, false, new Node[]
        {
            Def(0, L("TRUE")),
            Def(1, Op("AND", Ref(0), L("Mach1_Safety.Status.Custom_ATF_Disabled", Neg))),
            Set(Ref(1), T("Mach1_AuxData.TrayfillerActive")),
            Set(Ref(1), T("HMI_Var.TrayfillerActive")),
            Set(Op("AND", Ref(0), L("TRUE")), T("Mach1_AuxData.MIDS_Active")),
        });
        Assert.Equal(
            Ld +
            "NETWORK TITLE: \"DONE Network 1: Activating/deactivating MID-S/Trayfiller\"\n" +
            "  split0 := TRUE;\n" +
            "  split1 := split0 AND NOT Mach1_Safety.Status.Custom_ATF_Disabled;\n" +
            "  Mach1_AuxData.TrayfillerActive := split1;\n" +
            "  HMI_Var.TrayfillerActive := split1;\n" +
            "  Mach1_AuxData.MIDS_Active := split0 AND TRUE;\n" +
            "END_NETWORK\n",
            Write(net, BodyLanguage.Ld));
    }

    [Fact]
    public void A_single_consumer_split_keeps_its_VarId() =>
        Assert.Equal(Body("split28 := a AND b;", "out := split28;"),
            Write(Net(Def(28, Op("AND", L("a"), L("b"))), Set(Ref(28), T("out")))));

    /// <summary>B6, B7: a split's type is its feeder's, so the text writes none where the text's own rule cannot
    /// contradict the stored one — a box's stored type, an untyped box, a leaf with or without its type alike (the push's
    /// derivation; lost on rebuild where it differs).</summary>
    [Fact]
    public void A_split_writes_no_type_its_feeder_does_not_contradict()
    {
        var add = Call("ADD", new[] { In(L("a"), "X"), In(L("b")) }, connected: 0, eno: false, types: new[] { "INT" });
        Assert.Equal(Body("split1 := ADD(X := a, b);", "o1 := split1 GT c;", "o2 := split1 LT d;"),
            Write(Net(Def(1, add), Set(Call("GT", new[] { In(Ref(1)), In(L("c")) }, connected: 0, eno: false), T("o1")),
                Set(Call("LT", new[] { In(Ref(1)), In(L("d")) }, connected: 0, eno: false), T("o2")))));

        var untyped = Call("ADD", new[] { In(L("a"), "X"), In(L("b")) }, connected: 0, eno: false);
        Assert.Equal(Body("split1 := ADD(X := a, b);", "o := split1;"), Write(Net(Def(1, untyped), Set(Ref(1), T("o")))));
        Assert.Equal(Body("split1 := x;", "o := split1;"), Write(Net(Def(1, L("x")), Set(Ref(1), T("o")))));
        Assert.Equal(Ld + "NETWORK\n  split1 := x;\n  o := split1;\nEND_NETWORK\n",
            Write(Net(Def(1, LT("x", "BOOL")), Set(Ref(1), T("o"))), BodyLanguage.Ld));
        // A bitwise AND stored WORD agrees with "BOOL or another bit string": nothing written.
        Assert.Equal(Body("split5 := w1 AND w2;", "o1 := split5;", "o2 := split5;"),
            Write(Net(Def(5, new Box("AND", null, CallKind.Operator, new[] { In(L("w1")), In(L("w2")) }, new Output[0], null, null, Flags.None,
                    OutputTypes: new[] { "WORD" })),
                Set(Ref(5), T("o1")), Set(Ref(5), T("o2")))));
    }

    /// <summary>A split (readability.md, the split rule) stores no type the derivation would not give; the build ignores one (DIALECT N25),
    /// so no type is ever written: it is lost on rebuild (L, 0 in the corpora).</summary>
    [Fact]
    public void A_split_whose_stored_type_contradicts_its_feeder_writes_none()
    {
        var gt = Call("GT", new[] { In(L("a")), In(L("b")) }, connected: 0, eno: false, types: new[] { "STRING (80)" });
        Assert.Equal(Body("split1 := a GT b;", "o := split1;"), Write(Net(Def(1, gt), Set(Ref(1), T("o")))));
        var and = new Box("AND", null, CallKind.Operator, new[] { In(L("c")), In(L("d")) }, new Output[0], null, null, Flags.None,
            OutputTypes: new[] { "INT" });
        Assert.Equal(Body("split2 := c AND d;", "o := split2;"), Write(Net(Def(2, and), Set(Ref(2), T("o")))));
    }

    /// <summary>B6/P1: a split's name IS its VarId and the pattern is reserved, so a declaration of that name is no
    /// collision: the split is written bare, the variable backticked (<c>rcc_network_wire_named_like_variable</c>: both
    /// IDEs build it clean). It went to the marker until the 2R.3 review.</summary>
    [Fact]
    public void A_split_beside_a_declaration_of_its_name_is_written() =>
        Assert.Equal(Body("split3 := TRUE;", "out := split3;", "`split3` := split3;"),
            Write(Net(Def(3, L("TRUE")), Set(Ref(3), T("out")), Set(Ref(3), T("split3"))), BodyLanguage.Fbd, "SPLIT3"));

    /// <summary>2R.5 (#19, #20): the writer never reorders — a reference stored above its definition, and a definition
    /// below the top level, are written where they stand; a reference no item defines has no spelling.</summary>
    [Fact]
    public void The_writer_never_reorders_a_definition()
    {
        Assert.Equal(Body("out := split1;", "split1 := TRUE;"), Write(Net(Set(Ref(1), T("out")), Def(1, L("TRUE")))));
        Assert.Equal(Body("out := (split1 := TRUE) AND a;"), Write(Set(Op("AND", Def(1, L("TRUE")), L("a")), T("out"))));
        Assert.Equal("a split referenced and never defined", Refused(() => Write(Set(Ref(1), T("out")))).Reason);
    }

    // ── BoxTreeParallel (B8) ────────────────────────────────────────────────────────────────────

    /// <summary>B8: <c>[feed] BRANCH (a, b) [SHORTCIRCUIT]</c> — the outermost parallel of a line one branch per line,
    /// aligned under the first (P2); the editor's mode written as nothing (B7).</summary>
    [Fact]
    public void A_parallel_is_its_feed_BRANCH_and_its_branch_list()
    {
        Assert.Equal(
            Body("split54 := TRUE;", "ResetSafetyGuard S= split54 BRANCH (StartFlag,", "                                    tResetSafetyGuard) SHORTCIRCUIT;"),
            Write(Net(Def(54, L("TRUE")),
                Set(new Parallel(Ref(54), new Node[] { L("StartFlag"), L("tResetSafetyGuard") }, ParallelMode.BoxShortCircuit),
                    T("ResetSafetyGuard", Flags.None with { Set = true })))));
        Assert.Equal(Body("out := BRANCH (a,", "               b) SHORTCIRCUIT;"),
            Write(Set(new Parallel(null, new Node[] { L("a"), L("b") }, ParallelMode.BoxShortCircuit), T("out"))));
        Assert.Equal("a Parallel fed by the empty terminator",
            Refused(() => Write(Set(new Parallel(Empty, new Node[] { L("a"), L("b") }, ParallelMode.BoxShortCircuit), T("out")))).Reason);
        Assert.Equal(Body("out := f BRANCH (a,", "                 b);"),
            Write(Set(new Parallel(L("f"), new Node[] { L("a"), L("b") }, ParallelMode.Sequential), T("out"))));
    }

    /// <summary>B8, P4, P6: a parallel inside a branch is the same form, inline; two parallels in one line each stand
    /// where they are (a word's operands bracketed); one branch pushes and does not compile (C0023); an empty branch is
    /// refused.</summary>
    [Fact]
    public void A_parallel_inside_a_branch_is_inline_and_two_in_one_line_each_stand_where_they_are()
    {
        var inner = new Parallel(L("g"), new Node[] { L("x"), L("y") }, ParallelMode.Sequential);
        Assert.Equal(Body("out := f BRANCH (g BRANCH (x, y),", "                 b);"),
            Write(Set(new Parallel(L("f"), new Node[] { inner, L("b") }, ParallelMode.Sequential), T("out"))));
        Assert.Equal(Body("out := (BRANCH (a,", "                b)) AND (BRANCH (c,", "                                 d));"),
            Write(Set(Op("AND", new Parallel(null, new Node[] { L("a"), L("b") }, ParallelMode.Sequential),
                new Parallel(null, new Node[] { L("c"), L("d") }, ParallelMode.Sequential)), T("out"))));
        Assert.Equal("a Parallel with one branch",
            Refused(() => Write(Set(new Parallel(L("f"), new Node[] { L("a") }, ParallelMode.Sequential), T("out")))).Reason);
        // 2R.5 (readability Open c): an empty branch stores, builds and runs (a shorted branch) — nothing between its commas.
        Assert.Equal(Body("out := f BRANCH (a,", "                 );"),
            Write(Set(new Parallel(L("f"), new Node[] { L("a"), Empty }, ParallelMode.Sequential), T("out"))));
    }


    // ── reserved words (P1) ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_function_or_instance_named_like_an_edge_word_goes_to_the_marker_and_PARALLEL_is_a_name()
    {
        Assert.Equal("a POU or instance named R_EDGE", Refused(() => Write(Call("R_EDGE", new[] { In(L("x")) }))).Reason);
        Assert.Equal(Body("parallel(IN := x);"), Write(Fb("parallel", new[] { In(L("x"), "IN") })));
    }

    /// <summary>2R.5 (#12): a jump and a return are coils, so they take a coil's `S=` — the one storage measured on them; a
    /// jump's or return's NOT, edge or R= is not measured and goes to the marker.</summary>
    [Fact]
    public void A_jump_or_return_target_takes_a_coils_set_storage_and_no_unmeasured_modifier()
    {
        var jump = Flags.None with { Jump = true };
        var ret = Flags.None with { Return = true };
        Assert.Equal(Body("RETURN S= c;"), Write(new Assign(L("c"), new[] { T("???", ret with { Set = true }) }, ret)));
        Assert.Equal(Body("JMP Done S= c;"), Write(new Assign(L("c"), new[] { T("Done", jump with { Set = true }) }, jump)));
        Assert.Equal("a modified jump or return", Refused(() => Write(new Assign(L("c"), new[] { T("Done", jump with { Negated = true }) }, jump))).Reason);
        Assert.Equal("a modified jump or return", Refused(() => Write(new Assign(L("c"), new[] { T("Done", jump with { Rising = true }) }, jump))).Reason);
        Assert.Equal("a modified jump or return", Refused(() => Write(new Assign(L("c"), new[] { T("???", ret with { Falling = true }) }, ret))).Reason);
        Assert.Equal("a modified jump or return", Refused(() => Write(new Assign(L("c"), new[] { T("Done", jump with { Reset = true }) }, jump))).Reason);
    }

    [Fact]
    public void A_coil_both_set_and_reset_goes_to_the_marker() =>
        Assert.Equal("a coil both set and reset",
            Refused(() => Write(Set(L("a"), T("x", Flags.None with { Set = true, Reset = true })))).Reason);

    [Fact]
    public void A_consumed_box_whose_main_output_the_text_would_misread_goes_to_the_marker()
    {
        Assert.Equal("a main output other than slot 0 with no output name",
            Refused(() => Write(Set(Call("FC", new[] { In(L("src")) }, new[] { Out("x", 0) }, main: 1, connected: 1, eno: false), T("out")))).Reason);
        Assert.Equal("a consumed box with no stored connection slot",
            Refused(() => Write(Set(Call("FC", new[] { In(L("src")) }, new[] { Out("x", 1) }, main: null, connected: null, eno: false), T("out")))).Reason);
        Assert.Equal(Body("out := FC(src, => x);"),
            Write(Set(Call("FC", new[] { In(L("src")) }, new[] { Out("x", 1) }, main: 0, connected: 0, eno: false), T("out"))));
    }

    /// <summary>P1: a box type spelled like a reserved word is a backticked head; a word that left the list is a name.</summary>
    [Fact]
    public void A_box_type_spelled_like_a_word_of_the_text_is_a_backticked_head()
    {
        Assert.Equal(Body("`Network`(x, => y);"), Write(Call("Network", new[] { In(L("x")) }, new[] { Out("y", 0) }, eno: false)));
        Assert.Equal(Body("out := `JMP`(x);"), Write(Set(Call("JMP", new[] { In(L("x")) }, connected: 0, eno: false), T("out"))));
        Assert.Equal(Body("`EXECUTE`(x);"), Write(Call("EXECUTE", new[] { In(L("x")) })));
        Assert.Equal(Body("`Branch`(x);"), Write(Call("Branch", new[] { In(L("x")) })));
        Assert.Equal(Body("Let(x);"), Write(Call("Let", new[] { In(L("x")) })));
    }

    [Fact]
    public void An_FB_instance_the_declarations_do_not_name_goes_to_the_marker()
    {
        var super = Call("ATD_Base", new[] { In(L("ioAxis"), "ioAxis") }, main: null,
            instance: new Operand("SUPER^", IsInstance: true), kind: CallKind.FunctionBlock);
        Assert.Equal("an FB instance the declarations do not name",
            Refused(() => NetworkTextWriter.Write(new NetworkBody(BodyLanguage.Fbd, new[] { Net(super) }),
                new NetworkScope(new[] { "ioAxis" }, Array.Empty<string>(), new Dictionary<string, string>()))).Reason);
        var path = Call("TON", new[] { In(L("a"), "IN") }, main: null,
            instance: new Operand("st.fbT", IsInstance: true), kind: CallKind.FunctionBlock);
        Assert.Equal("an FB instance the declarations do not name",
            Refused(() => NetworkTextWriter.Write(new NetworkBody(BodyLanguage.Fbd, new[] { Net(path) }),
                new NetworkScope(new[] { "st", "a" }, Array.Empty<string>(), new Dictionary<string, string>()))).Reason);
        Assert.Equal("an FB instance declared with another type",
            Refused(() => NetworkTextWriter.Write(new NetworkBody(BodyLanguage.Fbd, new[] { Net(Fb("t1", new[] { In(L("a"), "IN") }, type: "TON")) }),
                new NetworkScope(Array.Empty<string>(), Array.Empty<string>(), new Dictionary<string, string> { ["t1"] = "TOF" }))).Reason);
    }

    /// <summary>A leaf split read by enabled MOVEs is a data value; the text writes no type for it either way (B6).</summary>
    [Fact]
    public void A_ladder_leaf_split_is_written_without_a_type()
    {
        Assert.Equal(Ld + "NETWORK\n  split1 := nSpeed;\n  MOVE split1 => y EN x;\n  MOVE split1 => z EN x;\nEND_NETWORK\n",
            Write(Net(Def(1, LT("nSpeed", "INT")),
                Call("MOVE", new[] { In(Ref(1)) }, new[] { Out("y", 1) }, en: L("x"), eno: true),
                Call("MOVE", new[] { In(Ref(1)) }, new[] { Out("z", 1) }, en: L("x"), eno: true)), BodyLanguage.Ld));
        Assert.Equal(Ld + "NETWORK\n  split1 := nSpeed;\n  MOVE split1 => nOut;\n  MOVE split1 => y;\nEND_NETWORK\n",
            Write(Net(Def(1, L("nSpeed")),
                Call("MOVE", new[] { In(Ref(1)) }, new[] { Out("nOut", 0) }, eno: false),
                Call("MOVE", new[] { In(Ref(1)) }, new[] { Out("y", 0) }, eno: false)), BodyLanguage.Ld));
    }

    /// <summary>P10: an operator type not spelled as the table's own word (<c>and</c>) keeps its call form and its spelling.</summary>
    [Fact]
    public void An_operator_type_in_another_case_keeps_its_spelling() =>
        Assert.Equal(Body("o := and(a, b);"),
            Write(Set(Call("and", new[] { In(L("a")), In(L("b")) }, main: null, kind: CallKind.Operator), T("o"))));

    [Fact]
    public void An_EXECUTE_snippet_keeps_its_trailing_newlines()
    {
        Assert.Equal(Fbd + "NETWORK\n  EXECUTE\nx := 1;\n\n  END_EXECUTE;\nEND_NETWORK\n", Write(Exec("x := 1;\n")));
        Assert.Equal(Fbd + "NETWORK\n  EXECUTE\nx := 1;\ny := 2;\n\n  END_EXECUTE;\nEND_NETWORK\n", Write(Exec("x := 1;\r\ny := 2;\r\n")));
        Assert.Equal("a snippet line ending in a carriage return", Refused(() => Write(Exec("x := 1;\r"))).Reason);
    }

    [Fact]
    public void A_comment_line_with_a_lone_CR_goes_to_the_marker()
    {
        Assert.Equal(Fbd + "NETWORK\n  // line1\n  // line2\n  ;\nEND_NETWORK\n",
            Write(new Network(0, null, null, "line1\r\nline2", false, new Node[] { Empty })));
        Assert.Equal("a comment line ending in a carriage return",
            Refused(() => Write(new Network(0, null, null, "line1\r", false, new Node[] { Empty }))).Reason);
        Assert.Equal("a comment line ending in a carriage return",
            Refused(() => Write(new Network(0, null, null, "step 1\rout := x;", false, new Node[] { Set(L("a"), T("o")) }))).Reason);
        Assert.Equal("a snippet line ending in a carriage return", Refused(() => Write(Exec("x := 1;\ry := 2;"))).Reason);
    }

    /// <summary>P1: LET left the word list — a name like any other.</summary>
    [Fact]
    public void An_operand_named_LET_is_a_name()
    {
        Assert.Equal(Body("Let := a;"), Write(Set(L("a"), T("Let"))));
        Assert.Equal(Body("let;"), Write(L("let")));
    }

    /// <summary>P1: the split pattern is reserved, so a variable of that shape is backticked in every position — and reads
    /// back as the variable.</summary>
    [Fact]
    public void A_split_shaped_variable_is_backticked()
    {
        foreach (var (tree, line) in SplitShapedNames)
        {
            var body = new NetworkBody(BodyLanguage.Fbd, new[] { Net(tree) });
            var text = NetworkTextWriter.Write(body, NetworkScope.Empty);
            Assert.Equal(Body(line), text);
            var back = NetworkTextReader.Read(text, NetworkScope.Empty);
            Assert.True(back.Ok, line + ": " + string.Join("\n", back.Diagnostics.Select(d => d.Code + " " + d.Message)));
            Assert.Null(NetworkModelEquality.FirstDifference(NetworkTextFacts.Carried(body), NetworkTextFacts.Carried(back.Body!)));
            Assert.True(NetworkTextGate.Validate(text, NetworkScope.Empty).Ok, line);
        }
        Assert.Equal(Body("out := g5;"), Write(Net(Set(L("g5"), T("out")))));
    }

    internal static readonly (Node Tree, string Line)[] SplitShapedNames =
    {
        (Set(L("split5"), T("out")), "out := `split5`;"),
        (Set(L("SPLIT12"), T("out")), "out := `SPLIT12`;"),
        (Set(L("a"), T("split5")), "`split5` := a;"),
        (Call("F", new[] { In(L("a")) }, new[] { Out("split5", 0) }, eno: false), "F(a, => `split5`);"),
        (Call("MOVE", new[] { In(L("b")) }, en: L("split5")), "MOVE b EN `split5`;"),
    };

    [Fact]
    public void A_consumed_box_whose_main_output_was_not_read_goes_to_the_marker() =>
        Assert.Equal("a consumed box whose main output was not read",
            Refused(() => Write(Set(Call("MOVE", new[] { In(L("a")) }, main: null, connected: 0, eno: false), T("out")))).Reason);
}
