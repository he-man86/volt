using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.Network.Next;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Engine.Tests;

/// <summary>
/// Network text v2 writer goldens. Every expected string is taken from <c>docs/network-text-next.html</c> (the
/// #nwl table and the Constructs section) or from a scenario in
/// <c>openspec/changes/network-text-literal-nwl/specs/network-text/spec.md</c> — NOT from the writer's output.
/// Where the page's example is a fragment, it is placed in a one-network body; the network wrapper and the
/// two-space statement indentation are the page's own layout (its Header and Wires examples).
/// </summary>
public class NextNetworkTextWriterTests
{
    // ── builders ────────────────────────────────────────────────────────────────────────────────

    static Leaf L(string text, Flags? f = null) => new(new Operand(text), f ?? Flags.None);
    static Operand T(string text, Flags? f = null) => new(text, IsLValue: true, Flags: f);
    static Terminator Empty => new(null, Flags.None);
    static Input In(Node v, string? formal = null) => new(formal, v, Flags.None);
    static Demux Ref(int id, Flags? f = null) => new(id, null, f ?? Flags.None);
    static Demux Def(int id, Node v) => new(id, v, Flags.None);
    static Assign Set(Node v, params Operand[] targets) => new(v, targets, Flags.None);
    static readonly Flags Neg = Flags.None with { Negated = true };
    static readonly Flags Rise = Flags.None with { Rising = true };
    static readonly Flags Fall = Flags.None with { Falling = true };

    /// <summary>An operator box written infix: no EN, no instance, no outputs. The vendor stores no main output
    /// index on AND/OR (census 1.6: None on 823 boxes), so a consumer's connection is null == null.</summary>
    static Box Op(string type, params Node[] inputs) =>
        new(type, null, CallKind.Operator, inputs.Select(i => In(i)).ToList(), new List<Output>(), null, null, Flags.None);

    static Box Call(string type, IEnumerable<Input> inputs, IEnumerable<Output>? outputs = null, Node? en = null,
                    int? main = 0, int? connected = null, Flags? f = null, Operand? instance = null,
                    CallKind kind = CallKind.Function, IReadOnlyList<string?>? types = null) =>
        new(type, instance, kind, inputs.ToList(), (outputs ?? Array.Empty<Output>()).ToList(), en, null, f ?? Flags.None,
            MainOutputIndex: main, ConnectedSlot: connected, OutputTypes: types);

    static Box Fb(string instance, IEnumerable<Input> inputs, IEnumerable<Output>? outputs = null, string type = "FB") =>
        Call(type, inputs, outputs, main: null, instance: new Operand(instance, IsInstance: true), kind: CallKind.FunctionBlock);

    static Box Exec(string st, Node? en = null, int? connected = null) =>
        new("EXECUTE", null, CallKind.Function, new List<Input>(), new List<Output>(), en, st, Flags.None,
            ConnectedSlot: connected);

    static Output Out(string target, int? slot, string? formal = null) => new(formal, new Operand(target, IsLValue: true), slot);

    static Network Net(params Node[] trees) => new(0, null, null, null, false, trees);

    /// <summary>Write one network against a scope declaring <paramref name="names"/> and the body's own FB
    /// instances — every instance these goldens call is one a POU declares (<see cref="NextModelOracle.Instances"/>).</summary>
    static string Write(Network net, BodyLanguage lang = BodyLanguage.Fbd, params string[] names)
    {
        var body = new NetworkBody(lang, new[] { net });
        return NextNetworkTextWriter.Write(body, new NextNetworkScope(names, NextModelOracle.Instances(body)));
    }

    static string Write(Node tree, BodyLanguage lang = BodyLanguage.Fbd) => Write(Net(tree), lang);

    const string Fbd = "(* @volt-implementation FBD *)\n";
    const string Ld = "(* @volt-implementation LD *)\n";

    /// <summary>A one-network FBD body holding exactly these statement lines.</summary>
    static string Body(params string[] lines) =>
        Fbd + "NETWORK\n" + string.Concat(lines.Select(l => "  " + l + "\n")) + "END_NETWORK\n";

    static UnrepresentableBodyException Refused(Func<string> write) =>
        Assert.ThrowsAny<UnrepresentableBodyException>(() => write());   // the v2 refusal is a subtype that also says where

    // ── the body marker and the Network item ────────────────────────────────────────────────────

    [Fact]
    public void The_language_rides_on_the_implementation_marker_and_the_header_has_no_order_number()
    {
        Assert.Equal(Ld + "NETWORK\n  ;\nEND_NETWORK\n", Write(Empty, BodyLanguage.Ld));
        Assert.Equal(Fbd + "NETWORK\n  ;\nEND_NETWORK\n", Write(new Network(7, null, null, null, false, new Node[] { Empty })));
    }

    /// <summary>Page, "Header and comment" — with the owner's 2026-09-26 title escape (<c>$"</c>) in place of the
    /// page's doubled quote.</summary>
    [Fact]
    public void Header_comment_wire_block_and_statements_in_that_order()
    {
        var net = new Network(0, "Tray \"A\" ready", "Done",
            "Indented notes keep their indentation:\n    step 1 — wait for the tray\n\n// a line that itself starts with two slashes",
            true, new Node[] { Def(0, L("TRUE")) });
        Assert.Equal(
            Fbd +
            "NETWORK LABEL: Done TITLE: \"Tray $\"A$\" ready\" DISABLED\n" +
            "  // Indented notes keep their indentation:\n" +
            "  //     step 1 — wait for the tray\n" +
            "  //\n" +
            "  // // a line that itself starts with two slashes\n" +
            "  VAR_TEMP g0 : BOOL; END_VAR\n" +
            "  g0 := TRUE;\n" +
            "END_NETWORK\n",
            Write(net));
    }

    /// <summary>Spec, "a multi-line comment keeps its shape".</summary>
    [Fact]
    public void A_multi_line_comment_keeps_its_shape()
    {
        var net = new Network(0, null, null, "step:\n\n    indented\n// quoted", false, new Node[] { Set(L("a"), T("out")) });
        Assert.Equal(Fbd + "NETWORK\n  // step:\n  //\n  //     indented\n  // // quoted\n  out := a;\nEND_NETWORK\n", Write(net));
    }

    /// <summary>Owner decision: a TITLE with a newline is written with ST's escapes, never the marker.</summary>
    [Fact]
    public void A_title_with_a_newline_and_a_dollar_is_escaped()
    {
        var net = new Network(0, "line 1\nline 2 costs $5", null, null, false, new Node[] { Empty });
        Assert.Equal(Fbd + "NETWORK TITLE: \"line 1$Nline 2 costs $$5\"\n  ;\nEND_NETWORK\n", Write(net));
    }

    // ── value; and the empty item ───────────────────────────────────────────────────────────────

    /// <summary>Spec, "a top-level box with nothing connected".</summary>
    [Fact]
    public void A_flagged_top_level_box_is_a_value_statement() =>
        Assert.Equal(Body("NOT f(x);"), Write(Call("f", new[] { In(L("x")) }, f: Neg)));

    /// <summary>Page, Calls: <c>GetTime();</c> — a top-level box with no input slot.</summary>
    [Fact]
    public void A_box_with_no_input_slot() =>
        Assert.Equal(Body("GetTime();"), Write(Call("GetTime", Array.Empty<Input>())));

    [Fact]
    public void A_top_level_leaf_wire_reference_and_parallel_are_value_statements()
    {
        Assert.Equal(Body("a;"), Write(L("a")));
        Assert.Equal(Body("PARALLEL(a, b);"), Write(new Parallel(null, new Node[] { L("a"), L("b") }, Flags.None)));
        Assert.Equal(
            Body("VAR_TEMP g1 : BOOL; END_VAR", "g1 := TRUE;", "g1;"),
            Write(Net(Def(1, L("TRUE")), Ref(1))));
    }

    /// <summary>Spec, "the empty statement is the empty item".</summary>
    [Fact]
    public void The_empty_item_is_a_semicolon_on_its_own_line() =>
        Assert.Equal(Body("out := a;", ";"), Write(Net(Set(L("a"), T("out")), Empty)));

    // ── BoxTreeOperand: a token, else backticks ─────────────────────────────────────────────────

    /// <summary>Page, "Backticked operands"; spec, "a typed call stays one operand".</summary>
    [Fact]
    public void An_operand_that_is_not_one_token_is_backticked_in_place()
    {
        Assert.Equal(Body("t1(IN := `DINT_TO_REAL(x)`);"),
            Write(Fb("t1", new[] { In(L("DINT_TO_REAL(x)"), "IN") })));
        Assert.Equal(Body("fb(P := `fc_dinttotime(T.Start,2)`);"),
            Write(Fb("fb", new[] { In(L("fc_dinttotime(T.Start,2)"), "P") })));
    }

    /// <summary>Grammar: an lvalue is a token or a backtick (<c>`arr[i + 1]` := x;</c>, <c>`a .b` := x;</c>),
    /// and an instance that is not a token is a backticked call head (<c>`fbs[1]`(IN := a)</c>) — where the
    /// declarations name it, since the text takes an FB's type from there.</summary>
    [Fact]
    public void Lvalues_and_call_heads_are_backticked_by_the_same_rule()
    {
        Assert.Equal(Body("`arr[i + 1]` := x;"), Write(Set(L("x"), T("arr[i + 1]"))));
        Assert.Equal(Body("`a .b` := x;"), Write(Set(L("x"), T("a .b"))));
        Assert.Equal(Body("`fbs[1]`(IN := a);"), NextNetworkTextWriter.Write(
            new NetworkBody(BodyLanguage.Fbd, new[] { Net(Fb("fbs[1]", new[] { In(L("a"), "IN") })) }),
            new NextNetworkScope(new[] { "a" }, new Dictionary<string, string> { ["fbs[1]"] = "FB" })));
    }

    [Fact]
    public void Tokens_stay_bare()
    {
        Assert.Equal(Body("out := ((s.f AND T#1S) OR ???);"),
            Write(Set(Op("OR", Op("AND", L("s.f"), L("T#1S")), L("???")), T("out"))));
    }

    /// <summary>Spec, "a backtick in operand text": the marker, and no other exception.</summary>
    [Fact]
    public void Operand_text_holding_a_backtick_goes_to_the_marker() =>
        Assert.Equal("operand text containing a backtick", Refused(() => Write(Set(L("a`b"), T("out")))).Marker);

    // ── IFlags on a value: NOT, R_EDGE, F_EDGE ──────────────────────────────────────────────────

    /// <summary>Page, "Infix groups and the NOT box"; spec, "the NOT box and the modifier".</summary>
    [Fact]
    public void Infix_groups_and_the_NOT_box()
    {
        Assert.Equal(Body("out := ((a AND b) OR c);"), Write(Set(Op("OR", Op("AND", L("a"), L("b")), L("c")), T("out"))));
        Assert.Equal(Body("out := NOT a;"), Write(Set(L("a", Neg), T("out"))));
        Assert.Equal(Body("out := NOT (a AND b);"),
            Write(Set(new Box("AND", null, CallKind.Operator, new[] { In(L("a")), In(L("b")) }, new Output[0], null, null, Neg), T("out"))));
        Assert.Equal(Body("out := NOT(a);"), Write(Set(Call("NOT", new[] { In(L("a")) }, main: null), T("out"))));
        Assert.Equal(Body("out := NOT((a AND b));"),
            Write(Set(Call("NOT", new[] { In(Op("AND", L("a"), L("b"))) }, main: null), T("out"))));
    }

    /// <summary>Page, "Edges".</summary>
    [Fact]
    public void Edges_are_flags_spelled_R_EDGE_and_F_EDGE()
    {
        var move = Call("MOVE", new[] { In(L("1")) }, new[] { Out("nMode", 1) }, en: L("bStart", Rise));
        Assert.Equal(Body("MOVE(EN := R_EDGE(bStart), 1, => nMode);"), Write(move));

        Assert.Equal(
            Body("VAR_TEMP g3 : BOOL; END_VAR", "g3 := TRUE;", "out := NOT F_EDGE(g3);"),
            Write(Net(Def(3, L("TRUE")), Set(Ref(3, Neg with { Falling = true }), T("out")))));

        Assert.Equal(Body("lamp := R_EDGE((a AND b));"),
            Write(Set(new Box("AND", null, CallKind.Operator, new[] { In(L("a")), In(L("b")) }, new Output[0], null, null, Rise), T("lamp"))));
    }

    /// <summary>Spec, "negation with an edge": the one order.</summary>
    [Fact]
    public void Negation_with_an_edge_is_NOT_outside() =>
        Assert.Equal(Body("out := NOT F_EDGE(x);"), Write(Set(L("x", Neg with { Falling = true }), T("out"))));

    /// <summary>Spec, "rising and falling on one operand".</summary>
    [Fact]
    public void Rising_and_falling_on_one_operand_goes_to_the_marker() =>
        Assert.Equal("rising and falling on one operand",
            Refused(() => Write(Set(L("x", Rise with { Falling = true }), T("out")))).Marker);

    // ── flags with no spelling in this phase ────────────────────────────────────────────────────

    /// <summary>Spec, "a pin flag on CODESYS"; phase-1 decision: the v2 writer refuses it by name as the v1
    /// drivers do.</summary>
    [Fact]
    public void A_flag_on_a_box_input_pin_goes_to_the_marker()
    {
        var box = Call("f", new[] { new Input("IN1", L("x"), Neg) });
        Assert.Equal("a flag on a box input pin", Refused(() => Write(box)).Marker);
    }

    /// <summary>Census 1.1: no item-level flag on a Demux or Assign item; none has a position.</summary>
    [Fact]
    public void A_flag_on_a_Demux_or_Assign_item_goes_to_the_marker()
    {
        Assert.Equal("a flag on a Demux item", Refused(() => Write(new Demux(1, L("TRUE"), Neg))).Marker);
        Assert.Equal("a flag on an Assign item", Refused(() => Write(new Assign(L("a"), new[] { T("out") }, Neg))).Marker);
    }

    /// <summary>Page, "Empty slots": a flag on an empty slot has no spelling.</summary>
    [Fact]
    public void A_flag_on_an_empty_slot_goes_to_the_marker() =>
        Assert.Equal("a flag on an empty slot",
            Refused(() => Write(Call("f", new[] { In(new Terminator(null, Neg)), In(L("a")) }))).Marker);

    // ── BoxTreeBox: calls, instances, ??? ───────────────────────────────────────────────────────

    /// <summary>Page, "Calls — FB instances and functions".</summary>
    [Fact]
    public void Calls_FB_instances_and_functions()
    {
        Assert.Equal(Body("t1(IN := a, PT := pt, ET => el);"),
            Write(Fb("t1", new[] { In(L("a"), "IN"), In(L("pt"), "PT") }, new[] { Out("el", 2, "ET") }, "TON")));
        Assert.Equal(Body("dst := f(src, oErr => err);"),
            Write(Set(Call("f", new[] { In(L("src")) }, new[] { Out("err", 1, "oErr") }, connected: 0), T("dst"))));
        Assert.Equal(Body("out := MAX(a, b);"),
            Write(Set(Call("MAX", new[] { In(L("a")), In(L("b")) }, connected: 0), T("out"))));
    }

    /// <summary>Page, "Unnamed instances and ???".</summary>
    [Fact]
    public void Unnamed_instances_carry_their_type_and_question_marks_are_content()
    {
        var unnamed = Call("TON", new[] { In(L("a"), "IN"), In(L("t"), "PT") }, main: null,
            instance: new Operand("???", IsInstance: true), kind: CallKind.FunctionBlock);
        Assert.Equal(Body("??? : TON(IN := a, PT := t);"), Write(unnamed));
        Assert.Equal(Body("??? := ioAxis.xVirtual;"), Write(Set(L("ioAxis.xVirtual"), T("???"))));
        Assert.Equal(Body("t1(IN := ???, PT := pt, ET => ???);"),
            Write(Fb("t1", new[] { In(L("???"), "IN"), In(L("pt"), "PT") }, new[] { Out("???", 2, "ET") }, "TON")));
        Assert.Equal(Body("out := (??? AND a);"), Write(Set(Op("AND", L("???"), L("a")), T("out"))));
    }

    /// <summary>Spec, "infix treats absent and default formals as one".</summary>
    [Fact]
    public void Default_formals_stay_infix_and_a_non_default_one_forces_call_form()
    {
        Assert.Equal(Body("out := (a AND b);"),
            Write(Set(Call("AND", new[] { In(L("a"), "IN1"), In(L("b"), "IN2") }, main: null), T("out"))));
        Assert.Equal(Body("out := ADD(X := a, b);"),
            Write(Set(Call("ADD", new[] { In(L("a"), "X"), In(L("b")) }, connected: 0), T("out"))));
    }

    // ── input and output slots, EN and ENO ──────────────────────────────────────────────────────

    /// <summary>Page, "EN, ENO and output slots".</summary>
    [Fact]
    public void EN_is_a_pin_and_a_box_writes_its_own_result_pins()
    {
        Assert.Equal(Body("MOVE(EN := a, b);"), Write(Call("MOVE", new[] { In(L("b")) }, en: L("a"))));
        Assert.Equal(Body("MOVE(EN := c, 0, => Status);"),
            Write(Call("MOVE", new[] { In(L("0")) }, new[] { Out("Status", 1) }, en: L("c"))));
        Assert.Equal(Body("AND(EN := go, a, b, => out);"),
            Write(Call("AND", new[] { In(L("a")), In(L("b")) }, new[] { Out("out", 1) }, en: L("go"), main: null)));

        var sub = Call("SUB", new[] { In(L("light")), In(L("deviation")) }, new[] { Out("diff", 1) }, en: L("rung"), connected: 0);
        Assert.Equal(Body("GT(EN := SUB(EN := rung, light, deviation, => diff).ENO, sensor, diff, => out);"),
            Write(Call("GT", new[] { In(L("sensor")), In(L("diff")) }, new[] { Out("out", 1) }, en: sub)));
    }

    /// <summary>Spec, "an enabled box drives a lamp".</summary>
    [Fact]
    public void An_enabled_box_consumed_by_its_ENO() =>
        Assert.Equal(Body("lamp := MOVE(EN := c, 0, => Status).ENO;"),
            Write(Set(Call("MOVE", new[] { In(L("0")) }, new[] { Out("Status", 1) }, en: L("c"), connected: 0), T("lamp"))));

    /// <summary>Page, the TrayFiller N8 oracle: <c>GE(EN := , stActHeightElevator, tInt).ENO</c> — an EN shown and
    /// unwired.</summary>
    [Fact]
    public void An_EN_shown_but_unwired_is_an_empty_EN_pin() =>
        Assert.Equal(Body("out := GE(EN := , stActHeightElevator, tInt).ENO;"),
            Write(Set(Call("GE", new[] { In(L("stActHeightElevator")), In(L("tInt")) }, en: Empty, connected: 0), T("out"))));

    /// <summary>Spec, "a result pin is not an assign" and "a consumed box without EN keeps its main output".</summary>
    [Fact]
    public void Positional_result_pins_fill_the_slots_left_after_the_connected_one()
    {
        Assert.Equal(Body("MOVE(src, => dst);"), Write(Call("MOVE", new[] { In(L("src")) }, new[] { Out("dst", 0) })));
        Assert.Equal(Body("out := f(src, => err);"),
            Write(Set(Call("f", new[] { In(L("src")) }, new[] { Out("err", 1) }, connected: 0), T("out"))));
        // A slot passed over is a bare `=>`: slot 0 connected, slot 1 unwired, slot 2 to `b`.
        Assert.Equal(Body("out := f(src, =>, => b);"),
            Write(Set(Call("f", new[] { In(L("src")) }, new[] { Out("b", 2) }, connected: 0), T("out"))));
    }

    /// <summary>Spec, "a connection by an unspellable slot".</summary>
    [Fact]
    public void A_connection_by_neither_the_main_output_nor_ENO_goes_to_the_marker()
    {
        Assert.Equal("a connection by an unspellable output slot",
            Refused(() => Write(Set(Call("f", new[] { In(L("src")) }, main: 0, connected: 1), T("out")))).Marker);
        Assert.Equal("an enabled box connected by a slot other than ENO",
            Refused(() => Write(Set(Call("MOVE", new[] { In(L("0")) }, en: L("c"), main: 1, connected: 1), T("out")))).Marker);
    }

    [Fact]
    public void An_unnamed_output_with_no_stored_slot_goes_to_the_marker() =>
        Assert.Equal("an output pin with no stored slot",
            Refused(() => Write(Call("MOVE", new[] { In(L("src")) }, new[] { Out("dst", null) }))).Marker);

    // ── empty slots ─────────────────────────────────────────────────────────────────────────────

    /// <summary>Page, "Empty slots".</summary>
    [Fact]
    public void Empty_slots_are_positions()
    {
        Assert.Equal(Body("( * iRPM * 6);"), Write(Op("MUL", Empty, L("iRPM"), L("6"))));
        Assert.Equal(Body("ctu(CU := a, RESET := , PV := );"),
            Write(Fb("ctu", new[] { In(L("a"), "CU"), In(Empty, "RESET"), In(Empty, "PV") })));
        Assert.Equal(Body("f(, a);"), Write(Call("f", new[] { In(Empty), In(L("a")) })));
        Assert.Equal(Body("f(a, );"), Write(Call("f", new[] { In(L("a")), In(Empty) })));
        Assert.Equal(Body("MOVE(IN := );"), Write(Call("MOVE", new[] { In(Empty, "IN") })));
        Assert.Equal(Body("coil := ;"), Write(Set(Empty, T("coil"))));
    }

    [Fact]
    public void A_lone_unwired_slot_without_a_formal_goes_to_the_marker() =>
        Assert.Equal("a lone unconnected input slot with no formal",
            Refused(() => Write(Call("MOVE", new[] { In(Empty) }))).Marker);

    // ── EXECUTE ─────────────────────────────────────────────────────────────────────────────────

    /// <summary>Page, "EXECUTE" — its three examples.</summary>
    [Fact]
    public void Execute_boxes_statement_empty_and_value_forms()
    {
        Assert.Equal(
            Fbd + "NETWORK\n  EXECUTE(EN := bRun)\nIF bStart THEN\n\ttarget := 40 + 2;\nEND_IF\n  END_EXECUTE;\nEND_NETWORK\n",
            Write(Exec("IF bStart THEN\n\ttarget := 40 + 2;\nEND_IF", L("bRun"))));
        Assert.Equal(
            Fbd + "NETWORK\n  EXECUTE(EN := bRun)\n\n  END_EXECUTE;\nEND_NETWORK\n",
            Write(Exec("", L("bRun"))));
        Assert.Equal(
            Fbd + "NETWORK\n  out := EXECUTE(EN := bRun)\nx := 1;\n  END_EXECUTE.ENO;\nEND_NETWORK\n",
            Write(Set(Exec("x := 1;", L("bRun"), connected: 0), T("out"))));
    }

    /// <summary>Spec, "a consumed Execute box without EN".</summary>
    [Fact]
    public void A_consumed_execute_box_without_EN_says_ENO() =>
        Assert.Equal(Fbd + "NETWORK\n  out := EXECUTE\nx := 1;\n  END_EXECUTE.ENO;\nEND_NETWORK\n",
            Write(Set(Exec("x := 1;", connected: 0), T("out"))));

    /// <summary>Spec, "a snippet line starting with END_EXECUTE" / "… starting with Network".</summary>
    [Fact]
    public void A_snippet_line_starting_END_EXECUTE_goes_to_the_marker_and_one_starting_Network_does_not()
    {
        Assert.Equal("a snippet line starting with END_EXECUTE",
            Refused(() => Write(Exec("x := 1;\n  END_EXECUTE y", L("bRun")))).Marker);
        Assert.Equal(Fbd + "NETWORK\n  EXECUTE\nNetworkState := 1;\n  END_EXECUTE;\nEND_NETWORK\n",
            Write(Exec("NetworkState := 1;")));
    }

    // ── BoxTreeAssign: coils ────────────────────────────────────────────────────────────────────

    /// <summary>Page, "Assignment — coils"; spec, "a multi-output assign is one statement".</summary>
    [Fact]
    public void One_assign_several_coils_is_one_chained_statement()
    {
        var set = Flags.None with { Set = true };
        var reset = Flags.None with { Reset = true };
        Assert.Equal(
            Body("VAR_TEMP g0 : BOOL; END_VAR", "g0 := TRUE;", "lamp := x;", "stRestposition S=", "stLowerInpusher R=", "stInfeedTray R= g0;"),
            Write(Net(Def(0, L("TRUE")), Set(L("x"), T("lamp")),
                Set(Ref(0), T("stRestposition", set), T("stLowerInpusher", reset), T("stInfeedTray", reset)))));
    }

    [Fact]
    public void Negated_and_edge_coils_go_to_the_marker()
    {
        Assert.Equal("negated coil", Refused(() => Write(Set(L("a"), T("out", Neg)))).Marker);
        Assert.Equal("rising-edge coil", Refused(() => Write(Set(L("a"), T("out", Rise)))).Marker);
        Assert.Equal("falling-edge coil", Refused(() => Write(Set(L("a"), T("out", Fall)))).Marker);
    }

    // ── Jump and Return ─────────────────────────────────────────────────────────────────────────

    /// <summary>Page, "LABEL, JMP and RETURN" — the five networks. Unconditional is the empty Terminator
    /// (census 1.2, DIALECT C11).</summary>
    [Fact]
    public void Labels_jumps_and_returns()
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
            "NETWORK\n  IF a THEN JMP Done; END_IF;\nEND_NETWORK\n" +
            "NETWORK LABEL: Done\n  out := a;\nEND_NETWORK\n" +
            "NETWORK\n  JMP Done;\nEND_NETWORK\n" +
            "NETWORK\n  IF a THEN RETURN; END_IF;\nEND_NETWORK\n" +
            "NETWORK\n  RETURN;\nEND_NETWORK\n",
            NextNetworkTextWriter.Write(body, NextNetworkScope.Empty));
    }

    /// <summary>Spec, "marker-only shapes": a rung with several control-flow targets.</summary>
    [Fact]
    public void A_rung_with_several_control_flow_targets_goes_to_the_marker()
    {
        var jumpBit = Flags.None with { Jump = true };
        Assert.Equal("a rung driving several jumps",
            Refused(() => Write(new Assign(L("a"), new[] { T("A", jumpBit), T("B", jumpBit) }, jumpBit))).Marker);
        Assert.Equal("a rung driving a coil and a jump together",
            Refused(() => Write(new Assign(L("a"), new[] { T("A", jumpBit), T("out") }, Flags.None))).Marker);
    }

    /// <summary>Found by the model oracle (UnspellableCoilTests' return coil): RETURN takes no target, so a
    /// return whose target names anything but the vendor's constant <c>???</c> is refused, never written as a
    /// bare RETURN that drops the name.</summary>
    [Fact]
    public void A_return_with_a_named_target_goes_to_the_marker()
    {
        var returnBit = Flags.None with { Return = true };
        Assert.Equal("a return with a named target",
            Refused(() => Write(new Assign(L("a"), new[] { T("out", returnBit) }, Flags.None))).Marker);
    }

    // ── BoxTreeDemux: the VAR_TEMP wire ─────────────────────────────────────────────────────────

    /// <summary>Page, "Wires — the one named thing" (Mach1_MIDS network 0).</summary>
    [Fact]
    public void Wires_are_declared_in_the_network_VAR_TEMP_block()
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
            "  VAR_TEMP g0, g1 : BOOL; END_VAR\n" +
            "  g0 := TRUE;\n" +
            "  g1 := (g0 AND NOT Mach1_Safety.Status.Custom_ATF_Disabled);\n" +
            "  Mach1_AuxData.TrayfillerActive := g1;\n" +
            "  HMI_Var.TrayfillerActive := g1;\n" +
            "  Mach1_AuxData.MIDS_Active := (g0 AND TRUE);\n" +
            "END_NETWORK\n",
            Write(net, BodyLanguage.Ld));
    }

    /// <summary>Spec, "a single-consumer Demux survives": the VarId is the name, whatever the use count.</summary>
    [Fact]
    public void A_single_consumer_wire_keeps_its_VarId() =>
        Assert.Equal(Body("VAR_TEMP g28 : BOOL; END_VAR", "g28 := (a AND b);", "out := g28;"),
            Write(Net(Def(28, Op("AND", L("a"), L("b"))), Set(Ref(28), T("out")))));

    /// <summary>Spec, "a boolean producer" / "a data producer"; owner decision: a box producer is declared with
    /// the type the vendor stores for the connected output, and an unknown type goes to the marker.</summary>
    [Fact]
    public void A_wire_is_typed_from_its_producer_and_never_guessed()
    {
        var add = Call("ADD", new[] { In(L("a"), "X"), In(L("b")) }, connected: 0, types: new[] { "INT" });
        Assert.Equal(Body("VAR_TEMP g1 : INT; END_VAR", "g1 := ADD(X := a, b);", "o1 := (g1 > c);", "o2 := (g1 < d);"),
            Write(Net(Def(1, add), Set(Op("GT", Ref(1), L("c")), T("o1")), Set(Op("LT", Ref(1), L("d")), T("o2")))));

        var untyped = Call("ADD", new[] { In(L("a"), "X"), In(L("b")) }, connected: 0);
        Assert.Equal("a wire of unknown type", Refused(() => Write(Net(Def(1, untyped), Set(Ref(1), T("o"))))).Marker);

        // An FBD leaf that is not TRUE/FALSE says nothing about its type; the same leaf in LD is a contact.
        Assert.Equal("a wire of unknown type", Refused(() => Write(Net(Def(1, L("x")), Set(Ref(1), T("o"))))).Marker);
        Assert.Equal(Ld + "NETWORK\n  VAR_TEMP g1 : BOOL; END_VAR\n  g1 := x;\n  o := g1;\nEND_NETWORK\n",
            Write(Net(Def(1, L("x")), Set(Ref(1), T("o"))), BodyLanguage.Ld));
    }

    [Fact]
    public void Wires_of_several_types_are_one_block_one_declaration_per_type()
    {
        var add = Call("ADD", new[] { In(L("a"), "X"), In(L("b")) }, connected: 0, types: new[] { "INT" });
        Assert.Equal(
            Body("VAR_TEMP g1, g3 : BOOL; g2 : INT; END_VAR", "g1 := TRUE;", "g2 := ADD(X := a, b);", "g3 := (g1 AND c);",
                 "o := g2;", "p := g3;"),
            Write(Net(Def(1, L("TRUE")), Def(2, add), Def(3, Op("AND", Ref(1), L("c"))), Set(Ref(2), T("o")), Set(Ref(3), T("p")))));
    }

    /// <summary>Spec, "the writer avoids a collision" — case-insensitively, against the scope and the body.</summary>
    [Fact]
    public void A_wire_whose_name_is_taken_is_renamed_to_the_lowest_free_g()
    {
        Assert.Equal(Body("VAR_TEMP g0 : BOOL; END_VAR", "g0 := TRUE;", "out := g0;"),
            Write(Net(Def(3, L("TRUE")), Set(Ref(3), T("out"))), BodyLanguage.Fbd, "G3"));
        // g0 is a variable the body reads, g1 is another wire's own id: g3 lands on g2.
        Assert.Equal(Body("VAR_TEMP g1, g2 : BOOL; END_VAR", "g1 := TRUE;", "g2 := (g1 AND G0);", "G3 := g2;"),
            Write(Net(Def(1, L("TRUE")), Def(3, Op("AND", Ref(1), L("G0"))), Set(Ref(3), T("G3")))));
    }

    /// <summary>Spec, "the vendor stores a reference before its definition"; census 1.8.</summary>
    [Fact]
    public void The_writer_never_reorders_and_never_nests_a_definition()
    {
        Assert.Equal("a wire referenced before its definition",
            Refused(() => Write(Net(Set(Ref(1), T("out")), Def(1, L("TRUE"))))).Marker);
        Assert.Equal("a Demux definition below the top level",
            Refused(() => Write(Set(Op("AND", Def(1, L("TRUE")), L("a")), T("out")))).Marker);
    }

    // ── BoxTreeParallel ─────────────────────────────────────────────────────────────────────────

    /// <summary>Page, "PARALLEL"; spec, "an unwired Parallel feed"; owner decision on Mode.</summary>
    [Fact]
    public void Parallel_fed_unfed_unwired_and_sequential()
    {
        Assert.Equal(
            Body("VAR_TEMP g54 : BOOL; END_VAR", "g54 := TRUE;", "ResetSafetyGuard S= PARALLEL(IN := g54, StartFlag, tResetSafetyGuard);"),
            Write(Net(Def(54, L("TRUE")),
                Set(new Parallel(Ref(54), new Node[] { L("StartFlag"), L("tResetSafetyGuard") }, Flags.None),
                    T("ResetSafetyGuard", Flags.None with { Set = true })))));
        Assert.Equal(Body("out := PARALLEL(a, b);"),
            Write(Set(new Parallel(null, new Node[] { L("a"), L("b") }, Flags.None), T("out"))));
        Assert.Equal(Body("out := PARALLEL(IN := , a, b);"),
            Write(Set(new Parallel(Empty, new Node[] { L("a"), L("b") }, Flags.None), T("out"))));
        Assert.Equal(Body("out := PARALLEL(MODE := Sequential, IN := f, a, b);"),
            Write(Set(new Parallel(L("f"), new Node[] { L("a"), L("b") }, Flags.None, ParallelMode.Sequential), T("out"))));
    }

    // ── BoxTreeTerminator with an input ─────────────────────────────────────────────────────────

    /// <summary>Census 1.4: 0 occurrences, refused by name.</summary>
    [Fact]
    public void A_terminator_with_an_input_goes_to_the_marker() =>
        Assert.Equal("a terminator with an input", Refused(() => Write(new Terminator(L("a"), Flags.None))).Marker);

    // ── reserved words ──────────────────────────────────────────────────────────────────────────

    /// <summary>Spec, "a POU named like an edge word".</summary>
    [Fact]
    public void A_function_or_instance_named_like_an_edge_word_goes_to_the_marker()
    {
        Assert.Equal("a POU or instance named R_EDGE", Refused(() => Write(Call("R_EDGE", new[] { In(L("x")) }))).Marker);
        Assert.Equal("a POU or instance named PARALLEL", Refused(() => Write(Fb("parallel", new[] { In(L("x"), "IN") }))).Marker);
    }
    // ── review 2026-09-26: facts the text cannot carry are refused by name, never dropped ──────

    /// <summary>Spec, "marker-only shapes": a jump or return TARGET with a Negation or edge bit (or any other
    /// flag than its own Jump/Return) goes to the marker. <c>JMP Done</c> and <c>RETURN</c> have nowhere to put it.</summary>
    [Fact]
    public void A_flag_on_a_jump_or_return_target_goes_to_the_marker()
    {
        var jump = Flags.None with { Jump = true };
        var ret = Flags.None with { Return = true };
        Assert.Equal("a flag on a jump or return target",
            Refused(() => Write(new Assign(L("c"), new[] { T("Done", jump with { Negated = true }) }, jump))).Marker);
        Assert.Equal("a flag on a jump or return target",
            Refused(() => Write(new Assign(L("c"), new[] { T("???", ret with { Set = true }) }, ret))).Marker);
        Assert.Equal("a flag on a jump or return target",
            Refused(() => Write(new Assign(L("c"), new[] { T("Done", jump with { Rising = true }) }, jump))).Marker);
    }

    /// <summary>A coil is ONE of <c>:=</c>, <c>S=</c>, <c>R=</c>; a target carrying both Set and Reset has no
    /// spelling, and writing <c>R=</c> would drop the Set.</summary>
    [Fact]
    public void A_coil_both_set_and_reset_goes_to_the_marker() =>
        Assert.Equal("a coil both set and reset",
            Refused(() => Write(Set(L("a"), T("x", Flags.None with { Set = true, Reset = true })))).Marker);

    /// <summary>Census 1.2 and DIALECT C11: "unconnected" is the empty Terminator, never a null value — an item
    /// holding nothing is what neither IDE would save. The control-flow arm refuses a null value as the plain
    /// assign arm does.</summary>
    [Fact]
    public void A_jump_or_return_with_a_null_value_goes_to_the_marker()
    {
        Assert.Equal("an assign with a null value",
            Refused(() => Write(new Assign(null, new[] { T("Done", Flags.None with { Jump = true }) }, Flags.None with { Jump = true }))).Marker);
        Assert.Equal("an assign with a null value",
            Refused(() => Write(new Assign(null, new[] { T("???", Flags.None with { Return = true }) }, Flags.None with { Return = true }))).Marker);
    }

    /// <summary>Spec, "EN is a pin …": a consumed box connected by its main output has no suffix, and the text
    /// reads that main output as slot 0 (spec, "err reads back on slot 1"). A box whose main output is stored as
    /// another slot (census 1.6: 3 Lenze call boxes store 1), or whose connection slot is not stored at all, would
    /// read back with its positional outputs on other slots — refused by name, never renumbered.</summary>
    [Fact]
    public void A_consumed_box_whose_main_output_the_text_would_misread_goes_to_the_marker()
    {
        Assert.Equal("a main output other than slot 0",
            Refused(() => Write(Set(Call("FC", new[] { In(L("src")) }, new[] { Out("x", 0) }, main: 1, connected: 1), T("out")))).Marker);
        Assert.Equal("a consumed box with no stored connection slot",
            Refused(() => Write(Set(Call("FC", new[] { In(L("src")) }, new[] { Out("x", 1) }, main: null, connected: null), T("out")))).Marker);
        // Slot 0 as main output is the text's own reading: written, and x keeps slot 1.
        Assert.Equal(Body("out := FC(src, => x);"),
            Write(Set(Call("FC", new[] { In(L("src")) }, new[] { Out("x", 1) }, main: 0, connected: 0), T("out"))));
    }

    /// <summary>Spec, "a call's head SHALL be its BoxType verbatim": a type that is a word of the text (other than
    /// the operators, which head their own call form) is written verbatim between backticks, so it can never be
    /// read as the construct — <c>Network(x)</c> at a line start would open a network.</summary>
    [Fact]
    public void A_box_type_spelled_like_a_word_of_the_text_is_a_backticked_head()
    {
        Assert.Equal(Body("`Network`(x, => y);"), Write(Call("Network", new[] { In(L("x")) }, new[] { Out("y", 0) })));
        Assert.Equal(Body("out := `JMP`(x);"), Write(Set(Call("JMP", new[] { In(L("x")) }, connected: 0), T("out"))));
        Assert.Equal(Body("`EXECUTE`(x);"), Write(Call("EXECUTE", new[] { In(L("x")) })));
        Assert.Equal(Body("`Let`(x);"), Write(Call("Let", new[] { In(L("x")) })));
    }

    /// <summary>The text does not repeat an FB's type — the reader takes it from the instance's declaration. An
    /// instance the declarations do not name (census 1.12: <c>SUPER^</c>; an element or member path such as
    /// <c>st.fbT</c>) would read back as a FUNCTION named like the instance, so it goes to the marker.</summary>
    [Fact]
    public void An_FB_instance_the_declarations_do_not_name_goes_to_the_marker()
    {
        var super = Call("ATD_Base", new[] { In(L("ioAxis"), "ioAxis") }, main: null,
            instance: new Operand("SUPER^", IsInstance: true), kind: CallKind.FunctionBlock);
        Assert.Equal("an FB instance the declarations do not name",
            Refused(() => NextNetworkTextWriter.Write(new NetworkBody(BodyLanguage.Fbd, new[] { Net(super) }),
                new NextNetworkScope(new[] { "ioAxis" }, new Dictionary<string, string>()))).Marker);
        var path = Call("TON", new[] { In(L("a"), "IN") }, main: null,
            instance: new Operand("st.fbT", IsInstance: true), kind: CallKind.FunctionBlock);
        Assert.Equal("an FB instance the declarations do not name",
            Refused(() => NextNetworkTextWriter.Write(new NetworkBody(BodyLanguage.Fbd, new[] { Net(path) }),
                new NextNetworkScope(new[] { "st", "a" }, new Dictionary<string, string>()))).Marker);
        // Declared with another type: the reader would take the declaration's.
        Assert.Equal("an FB instance declared with another type",
            Refused(() => NextNetworkTextWriter.Write(new NetworkBody(BodyLanguage.Fbd, new[] { Net(Fb("t1", new[] { In(L("a"), "IN") }, type: "TON")) }),
                new NextNetworkScope(Array.Empty<string>(), new Dictionary<string, string> { ["t1"] = "TOF" }))).Marker);
    }

    /// <summary>The vendor's stored output type is the wire's type: a bitwise AND on WORDs feeding a wire is a
    /// WORD, and the "AND is boolean" reading applies only where the vendor stored nothing.</summary>
    [Fact]
    public void A_wire_fed_by_a_bit_operator_takes_the_vendors_stored_type() =>
        Assert.Equal(Body("VAR_TEMP g5 : WORD; END_VAR", "g5 := (w1 AND w2);", "o1 := g5;", "o2 := g5;"),
            Write(Net(Def(5, new Box("AND", null, CallKind.Operator, new[] { In(L("w1")), In(L("w2")) }, new Output[0], null, null, Flags.None,
                    OutputTypes: new[] { "WORD" })),
                Set(Ref(5), T("o1")), Set(Ref(5), T("o2")))));

    /// <summary>Task 1.17: a leaf producer is boolean only when it is TRUE/FALSE or EVERY use is boolean — in
    /// ladder a leaf feeding a data pin is a data value, and its type is never guessed.</summary>
    [Fact]
    public void A_ladder_leaf_wire_feeding_data_pins_is_of_unknown_type() =>
        Assert.Equal("a wire of unknown type",
            Refused(() => Write(Net(Def(1, L("nSpeed")),
                Call("MOVE", new[] { In(Ref(1)) }, new[] { Out("nOut", 0) }),
                Call("MOVE", new[] { In(Ref(1)) }, new[] { Out("y", 0) })), BodyLanguage.Ld)).Marker);

    /// <summary>A head is the BoxType verbatim: an operator type not spelled as the table's own word (<c>and</c>)
    /// is written in call form with that spelling, never as the infix group that reads back as <c>AND</c>.</summary>
    [Fact]
    public void An_operator_type_in_another_case_keeps_its_spelling() =>
        Assert.Equal(Body("o := and(a, b);"),
            Write(Set(Call("and", new[] { In(L("a")), In(L("b")) }, main: null, kind: CallKind.Operator), T("o"))));

    /// <summary>An EXECUTE body is verbatim text: its trailing newlines are content and are written as the
    /// empty lines they are; only the CR of a CR LF line ending is layout (the file's, not the snippet's).</summary>
    [Fact]
    public void An_EXECUTE_snippet_keeps_its_trailing_newlines()
    {
        Assert.Equal(Fbd + "NETWORK\n  EXECUTE\nx := 1;\n\n  END_EXECUTE;\nEND_NETWORK\n", Write(Exec("x := 1;\n")));
        Assert.Equal(Fbd + "NETWORK\n  EXECUTE\nx := 1;\ny := 2;\n\n  END_EXECUTE;\nEND_NETWORK\n", Write(Exec("x := 1;\r\ny := 2;\r\n")));
        Assert.Equal("a snippet line ending in a carriage return", Refused(() => Write(Exec("x := 1;\r"))).Marker);
    }

    /// <summary>A comment is text: only the CR of a CR LF line ending is layout, and a CR the reader would read
    /// as layout (a line ending in a lone CR) has no spelling.</summary>
    [Fact]
    public void A_comment_keeps_everything_but_the_CR_of_a_CRLF()
    {
        Assert.Equal(Fbd + "NETWORK\n  // line1\n  // line2\n  ;\nEND_NETWORK\n",
            Write(new Network(0, null, null, "line1\r\nline2", false, new Node[] { Empty })));
        Assert.Equal("a comment line ending in a carriage return",
            Refused(() => Write(new Network(0, null, null, "line1\r", false, new Node[] { Empty }))).Marker);
    }

    /// <summary>A name the reader takes for a v1 <c>LET</c> statement is backticked like every other word of the text.</summary>
    [Fact]
    public void An_operand_named_LET_is_backticked()
    {
        Assert.Equal(Body("`Let` := a;"), Write(Set(L("a"), T("Let"))));
        Assert.Equal(Body("`let`;"), Write(L("let")));
    }
}
