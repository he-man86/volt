using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Engine.Tests;

/// <summary>
/// The network text writer's goldens (openspec <c>ld-fbd-coverage</c> 2R.6b, <c>v2-spec.md</c>): a VENDOR MODEL in, the
/// text out — the facts a text cannot state from its own side (an ENO output, a stored slot, a box the vendor holds as no
/// text reads it) are what these pin, and every expected string is the grammar of <c>v2-spec.md</c>, not the writer's
/// output. The grammar's text-to-model side is the shared case set (<c>test/fixtures/network-text</c>).
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

    /// <summary>An operator box as its word: no EN, no instance, no outputs. A consumer of a bit operator is connected by
    /// no stored slot (census 1.6); any other's by slot 0, stated where it is consumed.</summary>
    static Box Op(string type, params Node[] inputs) =>
        new(type, null, CallKind.Operator, inputs.Select(i => In(i)).ToList(), new List<Output>(), null, null, Flags.None);

    static Box Val(string type, params Node[] inputs) => Op(type, inputs) with { ConnectedSlot = 0 };

    static Box Call(string type, IEnumerable<Input> inputs, IEnumerable<Output>? outputs = null, Node? en = null,
                    int? connected = null, Flags? f = null, Operand? instance = null,
                    CallKind kind = CallKind.Function, IReadOnlyList<string?>? types = null, bool eno = false, string? name = null) =>
        new(type, instance, kind, inputs.ToList(), (outputs ?? Array.Empty<Output>()).ToList(), en, null, f ?? Flags.None,
            ConnectedSlot: connected, OutputTypes: types, HasEnoOutput: eno, MainOutputName: name);

    static Box Fb(string instance, IEnumerable<Input> inputs, IEnumerable<Output>? outputs = null, string type = "FB",
                  Node? en = null, bool eno = false, int? connected = null, string? name = null) =>
        Call(type, inputs, outputs, en: en, instance: new Operand(instance, IsInstance: true), kind: CallKind.FunctionBlock,
            eno: eno, connected: connected, name: name);

    static Box Exec(string st, Node? en = null, int? connected = null) =>
        new("EXECUTE", null, CallKind.Function, new List<Input>(), new List<Output>(), en, st, Flags.None,
            ConnectedSlot: connected, HasEnoOutput: true);

    static Output Out(string target, int? slot, string? formal = null) => new(formal, new Operand(target, IsLValue: true), slot);

    static Network Net(params Node[] trees) => new(0, null, null, null, false, trees);

    /// <summary>Write one network against a scope declaring <paramref name="names"/> and the body's own FB instances — and,
    /// where it writes, hold the model to the oracle <c>Read(Write(m)) ≅ m</c> (<see cref="NetworkModelOracle"/>).</summary>
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

    // ── the body marker, the header, the comment ────────────────────────────────────────────────

    [Fact]
    public void The_language_rides_on_the_implementation_marker_and_the_header_has_no_order_number()
    {
        Assert.Equal(Ld + "NETWORK\n  ;\nEND_NETWORK\n", Write(Empty, BodyLanguage.Ld));
        Assert.Equal(Fbd + "NETWORK\n  ;\nEND_NETWORK\n", Write(new Network(7, null, null, null, false, new Node[] { Empty })));
    }

    /// <summary><c>NETWORK [LABEL: x] [DISABLED] [TITLE: "…"]</c>, the title with IEC's escapes; the comment its CR LF lines,
    /// `// ` and one space syntax, a `$` written `$$`.</summary>
    [Fact]
    public void Header_comment_and_items_in_that_order()
    {
        var net = new Network(0, "Tray \"A\" ready", "Done",
            "Indented notes keep their indentation:\r\n    step 1 — costs $5\r\n\r\n// a line that itself starts with two slashes",
            true, new Node[] { Def(0, L("TRUE")) });
        Assert.Equal(
            Fbd +
            "NETWORK LABEL: Done DISABLED TITLE: \"Tray $\"A$\" ready\"\n" +
            "  // Indented notes keep their indentation:\n" +
            "  //     step 1 — costs $$5\n" +
            "  //\n" +
            "  // // a line that itself starts with two slashes\n" +
            "  split0 := TRUE;\n" +
            "END_NETWORK\n",
            Write(net));
    }

    /// <summary>A comment exactly as stored — a trailing CR LF is a final bare `//` line, trailing spaces stay; a bare LF
    /// or CR within a line is <c>$L</c> / <c>$R</c>.</summary>
    [Fact]
    public void A_comment_is_written_exactly_as_stored()
    {
        var net = new Network(0, null, null, "step:\r\n\r\n    indented  \r\n// quoted\r\n", false, new Node[] { Set(L("a"), T("out")) });
        Assert.Equal(Fbd + "NETWORK\n  // step:\n  //\n  //     indented  \n  // // quoted\n  //\n  out := a;\nEND_NETWORK\n", Write(net));
        Assert.Equal(Fbd + "NETWORK\n  // line1$Lline2$Rend\n  ;\nEND_NETWORK\n",
            Write(new Network(0, null, null, "line1\nline2\rend", false, new Node[] { Empty })));
    }

    /// <summary>A title exactly as stored, with IEC's escapes: <c>$L</c>, <c>$R</c>, <c>$"</c>, <c>$$</c>; an empty title or
    /// comment is none (the two stored values have one text).</summary>
    [Fact]
    public void A_title_is_written_exactly_as_stored()
    {
        Assert.Equal(Fbd + "NETWORK TITLE: \"line 1$Lline 2 costs $$5\"\n  ;\nEND_NETWORK\n",
            Write(new Network(0, "line 1\nline 2 costs $5", null, null, false, new Node[] { Empty })));
        Assert.Equal(Fbd + "NETWORK TITLE: \"TODO Network 4: \"\n  ;\nEND_NETWORK\n",
            Write(new Network(0, "TODO Network 4: ", null, null, false, new Node[] { Empty })));
        Assert.Equal(Fbd + "NETWORK TITLE: \"testlabel$R$L\"\n  ;\nEND_NETWORK\n",
            Write(new Network(0, "testlabel\r\n", null, null, false, new Node[] { Empty })));
        Assert.Equal(Fbd + "NETWORK\n  ;\nEND_NETWORK\n",
            NetworkTextWriter.Write(new NetworkBody(BodyLanguage.Fbd, new[] { new Network(0, "", null, "", false, new Node[] { Empty }) }), NetworkScope.Empty));
    }

    [Fact]
    public void A_label_that_is_no_identifier_hides_the_body() =>
        Assert.Equal("a label that is not an identifier",
            Refused(() => Write(new Network(0, null, "a b", null, false, new Node[] { Empty }))).Reason);

    // ── items ───────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_flagged_top_level_call_is_a_term() =>
        Assert.Equal(Body("NOT f(x);"), Write(Call("f", new[] { In(L("x")) }, f: Neg)));

    [Fact]
    public void A_box_with_no_input_slot() =>
        Assert.Equal(Body("GetTime();"), Write(Call("GetTime", Array.Empty<Input>())));

    [Fact]
    public void A_top_level_leaf_split_reference_and_parallel_are_value_items()
    {
        Assert.Equal(Body("a;"), Write(L("a")));
        Assert.Equal(Body("BRANCH (a, b) SHORTCIRCUIT;"),
            Write(new Parallel(null, new Node[] { L("a"), L("b") }, ParallelMode.BoxShortCircuit)));
        Assert.Equal(Body("split1 := TRUE;", "split1;"), Write(Net(Def(1, L("TRUE")), Ref(1))));
    }

    [Fact]
    public void The_empty_item_is_a_semicolon_on_its_own_line() =>
        Assert.Equal(Body("out := a;", ";"), Write(Net(Set(L("a"), T("out")), Empty)));

    // ── operands: a token, else backticks ───────────────────────────────────────────────────────

    [Fact]
    public void An_operand_that_is_not_one_token_is_backticked_in_place()
    {
        Assert.Equal(Body("t1 : TON(IN := `DINT_TO_REAL(x)`);"),
            Write(Fb("t1", new[] { In(L("DINT_TO_REAL(x)"), "IN") }, type: "TON")));
        Assert.Equal(Body("`arr[i + 1]` := x;"), Write(Set(L("x"), T("arr[i + 1]"))));
        Assert.Equal(Body("`a .b` := x;"), Write(Set(L("x"), T("a .b"))));
    }

    /// <summary>Backticked text has the one escape: a backtick doubled, a `$` as `$$`, a line break `$L` / `$R`.</summary>
    [Fact]
    public void Backticked_text_escapes_its_backtick_dollar_and_line_breaks()
    {
        Assert.Equal(Body("out := `a``b`;"), Write(Set(L("a`b"), T("out"))));
        Assert.Equal(Body("out := `f('$$N')`;"), Write(Set(L("f('$N')"), T("out"))));
        Assert.Equal(Body("out := `a$Lb`;"), Write(Set(L("a\nb"), T("out"))));
    }

    [Fact]
    public void Tokens_and_literals_stay_bare()
    {
        Assert.Equal(Body("out := (s.f AND T#1S) OR ???;"),
            Write(Set(Op("OR", Op("AND", L("s.f"), L("T#1S")), L("???")), T("out"))));
        Assert.Equal(Body("sName := 'Recipes';"), Write(Set(L("'Recipes'"), T("sName"))));
        Assert.Equal(Body("n := -1;"), Write(Set(L("-1"), T("n"))));
        Assert.Equal(Body("w := \"wide\";"), Write(Set(L("\"wide\""), T("w"))));
    }

    // ── modifiers ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Box_words_the_NOT_box_and_a_modified_box()
    {
        Assert.Equal(Body("out := (a AND b) OR c;"), Write(Set(Op("OR", Op("AND", L("a"), L("b")), L("c")), T("out"))));
        Assert.Equal(Body("out := NOT a;"), Write(Set(L("a", Neg), T("out"))));
        Assert.Equal(Body("out := NOT (a AND b);"), Write(Set(Op("AND", L("a"), L("b")) with { Flags = Neg }, T("out"))));
        Assert.Equal(Body("out := `NOT`(a);"), Write(Set(Op("NOT", L("a")), T("out"))));
        Assert.Equal(Body("out := `NOT`((a AND b));"), Write(Set(Op("NOT", Op("AND", L("a"), L("b"))), T("out"))));
    }

    /// <summary>Edges are prefixes: <c>R_EDGE x</c>; the vendor negates before it detects the edge (N17), so the edge comes
    /// first, <c>F_EDGE NOT x</c>; a box after a modifier is bracketed.</summary>
    [Fact]
    public void Edges_are_prefixes_and_the_edge_comes_before_its_NOT()
    {
        Assert.Equal(Body("MOVE 1 => nMode ENO EN R_EDGE bStart;"),
            Write(Call("MOVE", new[] { In(L("1")) }, new[] { Out("nMode", 1) }, en: L("bStart", Rise), eno: true)));
        Assert.Equal(Body("lamp := R_EDGE (a AND b);"), Write(Set(Op("AND", L("a"), L("b")) with { Flags = Rise }, T("lamp"))));
        Assert.Equal(Body("out := F_EDGE NOT x;"), Write(Set(L("x", Neg with { Falling = true }), T("out"))));
        Assert.Equal(Body("out := R_EDGE NOT (a AND b);"), Write(Set(Op("AND", L("a"), L("b")) with { Flags = Neg with { Rising = true } }, T("out"))));
    }

    [Fact]
    public void Rising_and_falling_on_one_node_goes_to_the_marker() =>
        Assert.Equal("rising and falling on one node",
            Refused(() => Write(Set(L("x", Rise with { Falling = true }), T("out")))).Reason);

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
    }

    /// <summary>A pin's modifier stands before its name; an operator with one is its backticked call, its pins named.</summary>
    [Fact]
    public void A_pins_modifier_stands_before_its_name()
    {
        Assert.Equal(Body("f(NOT IN1 := x);"), Write(Call("f", new[] { new Input("IN1", L("x"), Neg) })));
        Assert.Equal(Body("o := `AND`(IN1 := a, NOT IN2 := b);"),
            Write(Set(Op("AND", L("a"), L("b")) with { Inputs = new[] { In(L("a")), new Input(null, L("b"), Neg) } }, T("o"))));
        Assert.Equal(Body("f(R_EDGE IN1 := x);"), Write(Call("f", new[] { new Input("IN1", L("x"), Rise) })));
        Assert.Equal(Body("f(F_EDGE NOT IN1 := x);"), Write(Call("f", new[] { new Input("IN1", L("x"), Neg with { Falling = true }) })));
        Assert.Equal("a flag on a box input pin", Refused(() => Write(Call("f", new[] { new Input("IN1", L("x"), Flags.None with { Set = true }) }))).Reason);
        Assert.Equal("a modified unnamed pin of a call", Refused(() => Write(Call("f", new[] { new Input(null, L("x"), Neg) }))).Reason);
    }

    [Fact]
    public void A_flag_on_an_Assign_item_goes_to_the_marker() =>
        Assert.Equal("a flag on an Assign item", Refused(() => Write(new Assign(L("a"), new[] { T("out") }, Neg))).Reason);

    /// <summary>A negated empty slot is a plain coil's value, `x := NOT;` (2R.5 #6a); anywhere else it goes to the marker.</summary>
    [Fact]
    public void A_negated_empty_slot_is_a_lone_coils_value_only()
    {
        Assert.Equal(Body("x := NOT;"), Write(Set(new Terminator(Neg), T("x"))));
        Assert.Equal("a negated empty slot outside a lone coil value",
            Refused(() => Write(Call("f", new[] { In(new Terminator(Neg)), In(L("a")) }))).Reason);
        Assert.Equal("a negated empty slot outside a lone coil value",
            Refused(() => Write(new Assign(new Terminator(Neg), new[] { T("Done", Flags.None with { Jump = true }) }, Flags.None with { Jump = true }))).Reason);
        Assert.Equal("a flag on an empty slot", Refused(() => Write(Call("f", new[] { In(new Terminator(Rise)), In(L("a")) }))).Reason);
        Assert.Equal("a negated empty slot outside a lone coil value",
            Refused(() => Write(Set(new Terminator(Neg), T("x", Flags.None with { Set = true })))).Reason);
        Assert.Equal("a negated empty slot outside a lone coil value",
            Refused(() => Write(new Assign(new Terminator(Neg), new[] { T("x"), T("y") }, Flags.None))).Reason);
    }

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

    // ── calls, instances, ??? ───────────────────────────────────────────────────────────────────

    /// <summary>Every FB call names its type, <c>inst : TYPE(…)</c>; an FB read by a data output names it, <c>.Q</c>; a
    /// function's pins are named where they are stored named, positional where not.</summary>
    [Fact]
    public void Calls_FB_instances_and_functions()
    {
        Assert.Equal(Body("t1 : TON(IN := a, PT := pt, ET => el);"),
            Write(Fb("t1", new[] { In(L("a"), "IN"), In(L("pt"), "PT") }, new[] { Out("el", null, "ET") }, "TON")));
        Assert.Equal(Body("q := t1 : TON(IN := a, PT := pt).Q;"),
            Write(Set(Fb("t1", new[] { In(L("a"), "IN"), In(L("pt"), "PT") }, type: "TON", connected: 0, name: "Q"), T("q"))));
        Assert.Equal(Body("dst := f(src, oErr => err);"),
            Write(Set(Call("f", new[] { In(L("src")) }, new[] { Out("err", null, "oErr") }, connected: 0), T("dst"))));
        Assert.Equal(Body("out := MAX(a, b);"),
            Write(Set(Call("MAX", new[] { In(L("a")), In(L("b")) }, connected: 0), T("out"))));
    }

    [Fact]
    public void Unnamed_instances_carry_their_type_and_question_marks_are_content()
    {
        var unnamed = Call("TON", new[] { In(L("a"), "IN"), In(L("t"), "PT") },
            instance: new Operand("???", IsInstance: true), kind: CallKind.FunctionBlock);
        Assert.Equal(Body("??? : TON(IN := a, PT := t);"), Write(unnamed));
        Assert.Equal(Body("??? := ioAxis.xVirtual;"), Write(Set(L("ioAxis.xVirtual"), T("???"))));
        Assert.Equal(Body("out := ??? AND a;"), Write(Set(Op("AND", L("???"), L("a")), T("out"))));
    }

    /// <summary>An operator's default formals are no fact of the text; a non-default one is its backticked call's.</summary>
    [Fact]
    public void Default_formals_are_the_word_and_a_non_default_one_is_the_backticked_call()
    {
        Assert.Equal(Body("out := a AND b;"),
            Write(Set(Op("AND", L("a"), L("b")) with { Inputs = new[] { In(L("a"), "IN1"), In(L("b"), "IN2") } }, T("out"))));
        Assert.Equal(Body("out := `ADD`(X := a, IN2 := b);"),
            Write(Set(Val("ADD", L("a"), L("b")) with { Inputs = new[] { In(L("a"), "X"), In(L("b")) } }, T("out"))));
    }

    /// <summary>A name spelled like a word of the text heads its call between backticks.</summary>
    [Fact]
    public void A_box_type_spelled_like_a_word_of_the_text_is_a_backticked_head()
    {
        Assert.Equal(Body("`Network`(x, => y);"), Write(Call("Network", new[] { In(L("x")) }, new[] { Out("y", 0) })));
        Assert.Equal(Body("out := `JMP`(x);"), Write(Set(Call("JMP", new[] { In(L("x")) }, connected: 0), T("out"))));
        Assert.Equal(Body("`EXECUTE`(x);"), Write(Call("EXECUTE", new[] { In(L("x")) })));
        Assert.Equal(Body("`R_EDGE`(x);"), Write(Call("R_EDGE", new[] { In(L("x")) })));
        Assert.Equal(Body("Let(x);"), Write(Call("Let", new[] { In(L("x")) })));
        Assert.Equal(Body("parallel : FB(IN := x);"), Write(Fb("parallel", new[] { In(L("x"), "IN") })));
    }

    [Fact]
    public void An_FB_instance_declared_with_another_type_goes_to_the_marker() =>
        Assert.Equal("an FB instance declared with another type",
            Refused(() => NetworkTextWriter.Write(new NetworkBody(BodyLanguage.Fbd, new[] { Net(Fb("t1", new[] { In(L("a"), "IN") }, type: "TON")) }),
                new NetworkScope(Array.Empty<string>(), Array.Empty<string>(), new Dictionary<string, string> { ["t1"] = "TOF" }))).Reason);

    // ── EN and ENO ──────────────────────────────────────────────────────────────────────────────

    /// <summary>A box's outputs, then <c>ENO</c> where it has the pin and EN, then <c>EN</c> and its source.</summary>
    [Fact]
    public void EN_follows_the_box_and_ENO_shows_the_pin()
    {
        Assert.Equal(Body("MOVE b EN a;"), Write(Call("MOVE", new[] { In(L("b")) }, en: L("a"))));
        Assert.Equal(Body("MOVE 0 => Status ENO EN c;"),
            Write(Call("MOVE", new[] { In(L("0")) }, new[] { Out("Status", 1) }, en: L("c"), eno: true)));
        Assert.Equal(Body("MOVE 0 => Status EN c;"),
            Write(Call("MOVE", new[] { In(L("0")) }, new[] { Out("Status", 0) }, en: L("c"))));
        Assert.Equal(Body("a AND b => out ENO EN go;"),
            Write(Call("AND", new[] { In(L("a")), In(L("b")) }, new[] { Out("out", 1) }, en: L("go"), eno: true, kind: CallKind.Operator)));
    }

    /// <summary>A consumer of a box that shows ENO reads its ENO; one that shows none reads its value (5, 6).</summary>
    [Fact]
    public void A_consumed_enabled_box_is_read_through_ENO_or_by_its_value()
    {
        Assert.Equal(Body("lamp := MOVE 0 => Status ENO EN c;"),
            Write(Set(Call("MOVE", new[] { In(L("0")) }, new[] { Out("Status", 1) }, en: L("c"), connected: 0, eno: true), T("lamp"))));
        Assert.Equal(Body("out := a GT b EN c;"),
            Write(Set(Call("GT", new[] { In(L("a")), In(L("b")) }, en: L("c"), connected: 0, kind: CallKind.Operator), T("out"))));
        Assert.Equal(Body("y := MOVE k EN c;"),
            Write(Set(Call("MOVE", new[] { In(L("k")) }, en: L("c"), connected: 0), T("y"))));
    }

    /// <summary>A box in the EN slot that is itself enabled goes on the next line, one step deeper (the staircase).</summary>
    [Fact]
    public void A_chain_is_written_root_first_as_a_staircase()
    {
        var sub = Call("SUB", new[] { In(L("light")), In(L("deviation")) }, new[] { Out("diff", 1) }, en: L("rung"), connected: 0, eno: true);
        Assert.Equal(Body("sensor GT diff => out ENO EN", "  light SUB deviation => diff ENO EN rung;"),
            Write(Call("GT", new[] { In(L("sensor")), In(L("diff")) }, new[] { Out("out", 1) }, en: sub, eno: true)));
        var inner = Call("MOVE", new[] { In(L("1")) }, new[] { Out("a", 1) }, en: L("start"), connected: 0, eno: true);
        var mid = Call("MOVE", new[] { In(L("2")) }, new[] { Out("b", 1) }, en: inner, connected: 0, eno: true);
        var top = Call("MOVE", new[] { In(L("3")) }, new[] { Out("c", 1) }, en: mid, connected: 0, eno: true);
        Assert.Equal(Body("lamp := MOVE 3 => c ENO EN", "          MOVE 2 => b ENO EN", "            MOVE 1 => a ENO EN start;"),
            Write(Set(top, T("lamp"))));
    }

    [Fact]
    public void An_EN_shown_but_unwired_is_the_bare_EN()
    {
        Assert.Equal(Body("out := stActHeightElevator GE tInt EN;"),
            Write(Set(Call("GE", new[] { In(L("stActHeightElevator")), In(L("tInt")) }, en: Empty, connected: 0, kind: CallKind.Operator), T("out"))));
        Assert.Equal(Body("out := a MUL b => t ENO EN;"),
            Write(Set(Call("MUL", new[] { In(L("a")), In(L("b")) }, new[] { Out("t", 1) }, en: Empty, connected: 0, eno: true, kind: CallKind.Operator), T("out"))));
    }

    [Fact]
    public void Positional_outputs_fill_the_slots_left_after_ENO_and_the_connected_one()
    {
        Assert.Equal(Body("MOVE src => dst;"), Write(Call("MOVE", new[] { In(L("src")) }, new[] { Out("dst", 0) })));
        Assert.Equal(Body("out := f(src, => err);"),
            Write(Set(Call("f", new[] { In(L("src")) }, new[] { Out("err", 1) }, connected: 0), T("out"))));
        // A slot passed over is a bare `=>` in a call.
        Assert.Equal(Body("out := f(src, =>, => b);"),
            Write(Set(Call("f", new[] { In(L("src")) }, new[] { Out("b", 2) }, connected: 0), T("out"))));
        Assert.Equal("an output pin with no stored slot",
            Refused(() => Write(Call("f", new[] { In(L("src")) }, new[] { Out("dst", null) }))).Reason);
    }

    /// <summary>X3, X9, X10, X12: the connections that store and do not build, refused by name.</summary>
    [Fact]
    public void The_connections_no_build_accepts_go_to_the_marker()
    {
        // X10 (3a): a box with EN and ENO read by its value.
        Assert.Equal("a box with EN and ENO read by its value",
            Refused(() => Write(Set(Call("MOVE", new[] { In(L("0")) }, new[] { Out("x", 0) }, en: L("c"), connected: 1, eno: true), T("out")))).Reason);
        // X3 (3c): an operator read through its ENO, its value wired nowhere.
        Assert.Equal("an operator box read through its ENO with no output wired",
            Refused(() => Write(Set(Call("MOVE", new[] { In(L("0")) }, en: L("c"), connected: 0, eno: true), T("out")))).Reason);
        // X9 (4c): an ENO output with no EN on an operator.
        Assert.Equal("an ENO output without EN",
            Refused(() => Write(Set(Call("ADD", new[] { In(L("a")), In(L("b")) }, connected: 0, eno: true, kind: CallKind.Operator), T("out")))).Reason);
        // X12 (7b): the ENO pin wired beside a consumer.
        Assert.Equal("an ENO pin wired beside a consumer",
            Refused(() => Write(Set(Call("MOVE", new[] { In(L("0")) }, new[] { Out("lamp", null, "ENO"), Out("x", 1) }, en: L("c"), connected: 0, eno: true), T("out")))).Reason);
        // A function read by another output than its value: not measured.
        Assert.Equal("a function read by a declared output",
            Refused(() => Write(Set(Call("FC", new[] { In(L("src")) }, new[] { Out("x", 0) }, connected: 1), T("out")))).Reason);
    }

    /// <summary>An FB that declares ENO without EN (Lenze <c>Dryer</c>), read through it: nothing after its call (4a).</summary>
    [Fact]
    public void An_FB_read_through_its_declared_ENO_writes_nothing_after_its_call() =>
        Assert.Equal(Body("out := d1 : Dryer(a := x, speed => s);"),
            Write(Set(Fb("d1", new[] { In(L("x"), "a") }, new[] { Out("s", null, "speed") }, "Dryer", connected: 0, eno: true), T("out"))));

    /// <summary><c>ENO =&gt; v</c>: the ENO pin wired to a variable, after the outputs, at the top level (7a).</summary>
    [Fact]
    public void The_wired_ENO_pin_follows_the_outputs()
    {
        Assert.Equal(Body("MOVE 0 => x ENO => lamp EN c;"),
            Write(Call("MOVE", new[] { In(L("0")) }, new[] { Out("lamp", null, "ENO"), Out("x", 1) }, en: L("c"), eno: true)));
        Assert.Equal("an ENO output pin on a box without ENO",
            Refused(() => Write(Call("f", new[] { In(L("0")) }, new[] { Out("lamp", null, "ENO") }))).Reason);
    }

    // ── empty slots ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Empty_slots_are_positions()
    {
        Assert.Equal(Body("MUL iRPM MUL 6;"), Write(Op("MUL", Empty, L("iRPM"), L("6"))));
        Assert.Equal(Body("ctu : CTU(CU := a, RESET := , PV := );"),
            Write(Fb("ctu", new[] { In(L("a"), "CU"), In(Empty, "RESET"), In(Empty, "PV") }, type: "CTU")));
        Assert.Equal(Body("f(, a);"), Write(Call("f", new[] { In(Empty), In(L("a")) })));
        Assert.Equal(Body("f(a, );"), Write(Call("f", new[] { In(L("a")), In(Empty) })));
        Assert.Equal(Body("MOVE => x;"), Write(Call("MOVE", new[] { In(Empty) }, new[] { Out("x", 0) })));
        Assert.Equal(Body("coil := ;"), Write(Set(Empty, T("coil"))));
        Assert.Equal("a lone unconnected input slot with no formal", Refused(() => Write(Call("f", new[] { In(Empty) }))).Reason);
    }

    // ── EXECUTE ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void An_Execute_box_ends_its_line_and_its_pin_state_follows_END_EXECUTE()
    {
        Assert.Equal(
            Fbd + "NETWORK\n  EXECUTE\nIF bStart THEN\n\ttarget := 40 + 2;\nEND_IF\n  END_EXECUTE ENO EN bRun;\nEND_NETWORK\n",
            Write(Exec("IF bStart THEN\n\ttarget := 40 + 2;\nEND_IF", L("bRun"))));
        Assert.Equal(Fbd + "NETWORK\n  EXECUTE\n\n  END_EXECUTE ENO EN bRun;\nEND_NETWORK\n", Write(Exec("", L("bRun"))));
        Assert.Equal(Fbd + "NETWORK\n  out := EXECUTE\nx := 1;\n         END_EXECUTE ENO EN bRun;\nEND_NETWORK\n",
            Write(Set(Exec("x := 1;", L("bRun"), connected: 0), T("out"))));
        Assert.Equal(Fbd + "NETWORK\n  out := EXECUTE\nx := 1;\n         END_EXECUTE;\nEND_NETWORK\n",
            Write(Set(Exec("x := 1;", connected: 0), T("out"))));
    }

    [Fact]
    public void An_Execute_body_is_verbatim_and_has_no_text_for_its_own_end_or_a_lone_CR()
    {
        Assert.Equal("a snippet line starting with END_EXECUTE",
            Refused(() => Write(Exec("x := 1;\n  END_EXECUTE y", L("bRun")))).Reason);
        Assert.Equal(Fbd + "NETWORK\n  EXECUTE\nNetworkState := 1; // `x` $5\n  END_EXECUTE;\nEND_NETWORK\n",
            Write(Exec("NetworkState := 1; // `x` $5")));
        Assert.Equal(Fbd + "NETWORK\n  EXECUTE\nx := 1;\ny := 2;\n\n  END_EXECUTE;\nEND_NETWORK\n", Write(Exec("x := 1;\r\ny := 2;\r\n")));
        Assert.Equal("a snippet line ending in a carriage return", Refused(() => Write(Exec("x := 1;\ry := 2;"))).Reason);
        Assert.Equal("a flag on an Execute box", Refused(() => Write(Set(Exec("x := 1;", L("go"), 0) with { Flags = Neg }, T("o")))).Reason);
    }

    // ── coils, jumps, returns ───────────────────────────────────────────────────────────────────

    [Fact]
    public void One_assign_several_coils_in_stored_order()
    {
        var set = Flags.None with { Set = true };
        var reset = Flags.None with { Reset = true };
        Assert.Equal(
            Body("split0 := TRUE;", "lamp := x;", "stRestposition S= stLowerInpusher R= stInfeedTray R= split0;"),
            Write(Net(Def(0, L("TRUE")), Set(L("x"), T("lamp")),
                Set(Ref(0), T("stRestposition", set), T("stLowerInpusher", reset), T("stInfeedTray", reset)))));
        Assert.Equal(Body("y := (x := a);"), Write(Set(Set(L("a"), T("x")), T("y"))));
        Assert.Equal(Body("y := x := a;"), Write(Set(L("a"), T("y"), T("x"))));
    }

    [Fact]
    public void Negated_and_edge_coils_are_written_before_their_target()
    {
        Assert.Equal(Body("NOT out := a;"), Write(Set(L("a"), T("out", Neg))));
        Assert.Equal(Body("R_EDGE out := a;"), Write(Set(L("a"), T("out", Rise))));
        Assert.Equal(Body("F_EDGE NOT out := a;"), Write(Set(L("a"), T("out", Fall with { Negated = true }))));
        Assert.Equal("an edge beside a set or reset coil", Refused(() => Write(Set(L("a"), T("out", Rise with { Set = true })))).Reason);
        Assert.Equal("a negated set or reset coil", Refused(() => Write(Set(L("a"), T("out", Neg with { Set = true })))).Reason);
        Assert.Equal("a coil both set and reset", Refused(() => Write(Set(L("a"), T("x", Flags.None with { Set = true, Reset = true })))).Reason);
    }

    /// <summary>A jump and a return are coils: <c>JMP l := c;</c>, <c>RETURN := ;</c> (C11: on the rail its value is the
    /// empty slot).</summary>
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
            "NETWORK\n  JMP Done := ;\nEND_NETWORK\n" +
            "NETWORK\n  RETURN := a;\nEND_NETWORK\n" +
            "NETWORK\n  RETURN := ;\nEND_NETWORK\n",
            NetworkTextWriter.Write(body, NetworkScope.Empty));
    }

    [Fact]
    public void A_rung_with_several_control_flow_targets_writes_each_as_a_coil()
    {
        var jumpBit = Flags.None with { Jump = true };
        Assert.Equal(Body("JMP A := JMP B := a;"), Write(new Assign(L("a"), new[] { T("A", jumpBit), T("B", jumpBit) }, jumpBit)));
        Assert.Equal(Body("JMP A := out := a;"), Write(new Assign(L("a"), new[] { T("A", jumpBit), T("out") }, Flags.None)));
        Assert.Equal("a jump bit on an item no target carries",
            Refused(() => Write(new Assign(L("a"), new[] { T("A"), T("out") }, jumpBit))).Reason);
    }

    [Fact]
    public void A_jump_or_return_takes_S_and_no_unmeasured_modifier()
    {
        var jump = Flags.None with { Jump = true };
        var ret = Flags.None with { Return = true };
        Assert.Equal(Body("RETURN S= c;"), Write(new Assign(L("c"), new[] { T("???", ret with { Set = true }) }, ret)));
        Assert.Equal(Body("JMP Done S= c;"), Write(new Assign(L("c"), new[] { T("Done", jump with { Set = true }) }, jump)));
        Assert.Equal("a modified jump or return", Refused(() => Write(new Assign(L("c"), new[] { T("Done", jump with { Negated = true }) }, jump))).Reason);
        Assert.Equal("a modified jump or return", Refused(() => Write(new Assign(L("c"), new[] { T("Done", jump with { Reset = true }) }, jump))).Reason);
        Assert.Equal("a return with a named target", Refused(() => Write(new Assign(L("a"), new[] { T("out", ret) }, Flags.None))).Reason);
    }

    // ── splits ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_split_is_its_VarId_and_needs_no_declaration()
    {
        var net = new Network(0, "Activate", null, null, false, new Node[]
        {
            Def(0, L("TRUE")),
            Def(1, Op("AND", Ref(0), L("disabled", Neg))),
            Set(Ref(1), T("active")),
            Set(Ref(1), T("hmi.active")),
            Set(Op("AND", Ref(0), L("TRUE")), T("on")),
        });
        Assert.Equal(
            Ld + "NETWORK TITLE: \"Activate\"\n" +
            "  split0 := TRUE;\n" +
            "  split1 := split0 AND NOT disabled;\n" +
            "  active := split1;\n" +
            "  hmi.active := split1;\n" +
            "  on := split0 AND TRUE;\n" +
            "END_NETWORK\n",
            Write(net, BodyLanguage.Ld));
    }

    /// <summary>A split's type is its feeder's: the text writes none, whatever the vendor stored (B6, B7).</summary>
    [Fact]
    public void A_split_writes_no_type()
    {
        var gt = Val("GT", L("a"), L("b")) with { OutputTypes = new[] { "STRING (80)" } };
        Assert.Equal(Body("split1 := a GT b;", "o := split1;"), Write(Net(Def(1, gt), Set(Ref(1), T("o")))));
        Assert.Equal(Ld + "NETWORK\n  split1 := x;\n  o := split1;\nEND_NETWORK\n",
            Write(Net(Def(1, LT("x", "BOOL")), Set(Ref(1), T("o"))), BodyLanguage.Ld));
    }

    /// <summary>The writer never reorders: a reference stored above its definition and a definition below the top level
    /// are written where they stand; a reference no item defines, or a second definition, goes to the marker.</summary>
    [Fact]
    public void The_writer_never_reorders_a_definition()
    {
        Assert.Equal(Body("out := split1;", "split1 := TRUE;"), Write(Net(Set(Ref(1), T("out")), Def(1, L("TRUE")))));
        Assert.Equal(Body("out := (split1 := TRUE) AND a;"), Write(Set(Op("AND", Def(1, L("TRUE")), L("a")), T("out"))));
        Assert.Equal("a split referenced and never defined", Refused(() => Write(Set(Ref(1), T("out")))).Reason);
        Assert.Equal("a split defined twice", Refused(() => Write(Net(Def(1, L("a")), Def(1, L("b"))))).Reason);
    }

    [Fact]
    public void A_split_shaped_variable_is_backticked()
    {
        Assert.Equal(Body("out := `split5`;"), Write(Set(L("split5"), T("out"))));
        Assert.Equal(Body("`split5` := a;"), Write(Set(L("a"), T("split5"))));
        Assert.Equal(Body("F(a, => `split5`);"), Write(Call("F", new[] { In(L("a")) }, new[] { Out("split5", 0) })));
    }

    // ── parallels ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_parallel_is_its_feed_BRANCH_and_its_branch_list()
    {
        Assert.Equal(Body("split54 := TRUE;", "reset S= split54 BRANCH (start, tReset) SHORTCIRCUIT;"),
            Write(Net(Def(54, L("TRUE")),
                Set(new Parallel(Ref(54), new Node[] { L("start"), L("tReset") }, ParallelMode.BoxShortCircuit),
                    T("reset", Flags.None with { Set = true })))));
        Assert.Equal(Body("out := f BRANCH (g BRANCH (x, y), b);"),
            Write(Set(new Parallel(L("f"), new Node[] { new Parallel(L("g"), new Node[] { L("x"), L("y") }, ParallelMode.Sequential), L("b") }, ParallelMode.Sequential), T("out"))));
        Assert.Equal(Body("out := (BRANCH (a, b)) AND (BRANCH (c, d));"),
            Write(Set(Op("AND", new Parallel(null, new Node[] { L("a"), L("b") }, ParallelMode.Sequential),
                new Parallel(null, new Node[] { L("c"), L("d") }, ParallelMode.Sequential)), T("out"))));
        Assert.Equal(Body("out := f BRANCH (a, );"),
            Write(Set(new Parallel(L("f"), new Node[] { L("a"), Empty }, ParallelMode.Sequential), T("out"))));
        Assert.Equal("a Parallel fed by the empty terminator",
            Refused(() => Write(Set(new Parallel(Empty, new Node[] { L("a"), L("b") }, ParallelMode.BoxShortCircuit), T("out")))).Reason);
        Assert.Equal("a Parallel with one branch",
            Refused(() => Write(Set(new Parallel(L("f"), new Node[] { L("a") }, ParallelMode.Sequential), T("out")))).Reason);
    }

    /// <summary>A branch holding a chain: one branch per line, each aligned under the first.</summary>
    [Fact]
    public void A_parallel_holding_a_chain_is_written_one_branch_per_line()
    {
        var inner = Call("MOVE", new[] { In(L("2")) }, new[] { Out("u", 1) }, en: L("c"), connected: 0, eno: true);
        var chain = Call("MOVE", new[] { In(L("1")) }, new[] { Out("t", 1) }, en: inner, connected: 0, eno: true);
        Assert.Equal(Ld + "NETWORK\n" +
                     "  lamp := start BRANCH (a,\n" +
                     "                        MOVE 1 => t ENO EN\n" +
                     "                          MOVE 2 => u ENO EN c,\n" +
                     "                        d);\n" +
                     "END_NETWORK\n",
            Write(Set(new Parallel(L("start"), new Node[] { L("a"), chain, L("d") }, ParallelMode.Sequential), T("lamp")), BodyLanguage.Ld));
    }

    // ── the hash an UNSUPPORTED line carries ────────────────────────────────────────────────────

    [Fact]
    public void The_hash_tells_two_networks_apart_and_is_stable()
    {
        var a = Net(Set(L("a"), T("x")));
        var b = Net(Set(L("b"), T("x")));
        Assert.Matches("^[0-9a-f]{8}$", NetworkTextWriter.Hash(a));
        Assert.Equal(NetworkTextWriter.Hash(a), NetworkTextWriter.Hash(Net(Set(L("a"), T("x")))));
        Assert.NotEqual(NetworkTextWriter.Hash(a), NetworkTextWriter.Hash(b));
    }
}
