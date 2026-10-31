using System;
using System.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Tests.Shared;
using Xunit;
using static Volt.Engine.Tests.NetworkModels;

namespace Volt.Engine.Tests.Format.Network;

/// <summary>
/// Plain-ST network text (openspec <c>network-text-st</c> 2.1/2.2; design.md "1.4 Mapping" and its revision): the writer's
/// spelling of each mapping row, read back to the same model by <see cref="StNetworkReader"/>, and the reader's refusals
/// by name. One small network per rule; the corpora are the oracle's (<see cref="StNetworkOracle"/>).
/// </summary>
public class StNetworkTextTests
{
    static NetworkScope Scope(NetworkBody body, params string[] names) => ScopeOf(body, names);

    /// <summary>Write, assert the text, read back, and assert the model is the one written (on the facts the text carries).</summary>
    static void RoundTrips(NetworkBody body, string expected, NetworkScope? scope = null)
    {
        scope ??= Scope(body);
        var text = StNetworkWriter.Write(body, scope);
        Assert.Equal(expected, text);
        var back = StNetworkReader.Read(text, scope);
        Assert.Null(NetworkModelEquality.FirstDifference(NetworkTextFacts.Carried(body), NetworkTextFacts.Carried(back)));
    }

    [Fact]
    public void Contacts_and_a_coil_are_an_assignment_by_ST_precedence() =>
        RoundTrips(Ld1(Set(Op("AND", L("start"), Op("OR", L("a"), L("b")), L("stop", Neg)), T("motor"))),
            "%LANGUAGE LD\n%NETWORK\nmotor := start AND (a OR b) AND NOT stop;\n");

    /// <summary>LD contacts: one unbracketed chain of one contact operator is ONE box; brackets nest.</summary>
    [Fact]
    public void One_unbracketed_contact_chain_is_one_box_and_brackets_nest() =>
        RoundTrips(Ld1(Set(Op("AND", Op("AND", L("a"), L("b")), L("c")), T("x")), Set(Op("AND", L("a"), L("b"), L("c")), T("y"))),
            "%LANGUAGE LD\n%NETWORK\nx := (a AND b) AND c;\ny := a AND b AND c;\n");

    /// <summary>The revision (owner): every box is a call, the keyword operators too; an extensible box is one call with all
    /// its inputs, a nested box a nested call. FBD's toolbox has no contacts, so FBD is calls only.</summary>
    [Fact]
    public void Every_box_is_a_call_and_FBD_has_no_contacts() =>
        RoundTrips(Fbd1(Set(Op("AND", Op("AND", L("a"), L("b")), L("c"), Op("GT", L("i"), L("3")) with { ConnectedSlot = 0 }), T("x")),
                        Set(Op("ADD", L("i"), L("j"), L("k")) with { ConnectedSlot = 0 }, T("n")), Set(Op("NOT", Op("XOR", L("a"), L("b"))), T("z"))),
            "%LANGUAGE FBD\n%NETWORK\nx := AND(AND(a, b), c, GT(i, 3));\nn := ADD(i, j, k);\nz := NOT(XOR(a, b));\n");

    /// <summary>In LD an AND/OR is a contact only where the IDE stores it as one (no output names, 1.3); a box drawn from
    /// the toolbox stores one unnamed output and is the call. A NOT box is <c>NOT(…)</c>, a negated contact <c>NOT a</c>.</summary>
    [Fact]
    public void A_drawn_AND_box_in_LD_is_the_call_and_contacts_are_infix()
    {
        var drawn = Op("AND", L("a"), L("b")) with { Members = NwlMembers.Of((NetworkMembers.OutputNames, MemberValue.Texts(new[] { "" }))) };
        var contact = Op("OR", L("c"), L("d", Neg)) with { Members = NwlMembers.Of((NetworkMembers.OutputNames, MemberValue.Texts(Array.Empty<string>()))) };
        RoundTrips(Ld1(Set(Op("AND", drawn, contact, Op("NOT", L("e"))), T("x"))),
            "%LANGUAGE LD\n%NETWORK\nx := AND(a, b) AND (c OR NOT d) AND NOT(e);\n");
    }

    [Fact]
    public void Set_reset_and_several_targets_are_ST_assignments() =>
        RoundTrips(Ld1(Set(L("a"), T("x", SetBit)), Set(L("b"), T("y", ResetBit), T("z"))),
            "%LANGUAGE LD\n%NETWORK\nx S= a;\ny R= z := b;\n");

    /// <summary>The call is the box (network-output-member): <c>EN :=</c> its shown EN, <c>.ENO</c> its shown ENO, the
    /// output it hands on; its value through <c>OUT =&gt;</c>; a chain nests as drawn.</summary>
    [Fact]
    public void An_EN_chain_nests_enabled_boxes_as_drawn()
    {
        var inner = Call("MOVE", new[] { In(L("1")) }, new[] { Out("x", 1) }, en: L("c"), connected: 0, eno: true);
        var outer = Call("MOVE", new[] { In(L("2")) }, new[] { Out("y", 1) }, en: inner, connected: 0, eno: true);
        RoundTrips(Ld1(Set(outer, T("done"))),
            "%LANGUAGE LD\n%NETWORK\ndone := MOVE(EN := MOVE(EN := c, 1, OUT => x).ENO, 2, OUT => y).ENO;\n");
    }

    [Fact]
    public void An_enabled_operator_is_its_enabled_function_with_positional_pins() =>
        RoundTrips(Ld1(Call("ADD", new[] { In(L("o")), In(L("1")) }, new[] { Out("o", 1) }, en: L("go"), eno: true, kind: CallKind.Operator)),
            "%LANGUAGE LD\n%NETWORK\nADD(EN := go, o, 1, OUT => o).ENO;\n");

    /// <summary>A box with EN and no ENO is its call with <c>EN :=</c> and no member, read by its value: CODESYS's enabled
    /// comparison read by its VALUE stores no ENO (1.3).</summary>
    [Fact]
    public void An_enabled_box_without_ENO_returns_its_value() =>
        RoundTrips(Ld1(Set(Op("AND", L("a"), Call("GT", new[] { In(L("i")), In(L("3")) }, en: L("en"), connected: 0, kind: CallKind.Operator)), T("out"))),
            "%LANGUAGE LD\n%NETWORK\nout := a AND GT(EN := en, i, 3);\n");

    /// <summary>A box with EN and ENO read by its value has no spelling: a box showing ENO hands its ENO on. Measured
    /// (network-text-st design.md "3.0"): CODESYS holds such a box, built read at its value, read by its ENO.</summary>
    [Fact]
    public void An_enabled_box_with_ENO_read_by_its_value_has_no_spelling()
    {
        var body = Ld1(Set(Call("MOVE", new[] { In(L("v")) }, en: L("en"), connected: 1, eno: true), T("out")));
        Assert.Equal("a box showing ENO read by another output", Assert.Throws<StNetworkUnspellableException>(() => StNetworkWriter.Write(body, Scope(body))).Reason);
    }

    /// <summary>A call read by a slot other than its value's, with no ENO to name it, has no spelling: the text reads a call
    /// by its value (found by the doubles oracle, network-text-st 3.2).</summary>
    [Fact]
    public void A_box_read_by_a_slot_other_than_its_value_has_no_spelling()
    {
        var body = Ld1(Set(Call("ADD", new[] { In(L("a")), In(L("b")) }, connected: 1, kind: CallKind.Operator), T("out")));
        Assert.Equal("a box read by an unstated slot", Assert.Throws<StNetworkUnspellableException>(() => StNetworkWriter.Write(body, Scope(body))).Reason);
    }

    /// <summary>A box with EN and no ENO at the root: its call with <c>EN :=</c>, its value to its targets through
    /// <c>OUT =&gt;</c>.</summary>
    [Fact]
    public void An_enabled_box_without_ENO_at_the_root_is_a_call_statement() =>
        RoundTrips(Ld1(Call("MOVE", new[] { In(L("b")) }, new[] { Out("a", 0) }, en: L("c"))),
            "%LANGUAGE LD\n%NETWORK\nMOVE(EN := c, b, OUT => a);\n");

    [Fact]
    public void An_enabled_comparison_read_by_its_ENO_returns_it() =>
        RoundTrips(Ld1(Set(Call("GT", new[] { In(L("i")), In(L("3")) }, new[] { Out("hot", 1) }, en: L("en"), connected: 0, eno: true, kind: CallKind.Operator), T("ok"))),
            "%LANGUAGE LD\n%NETWORK\nok := GT(EN := en, i, 3, OUT => hot).ENO;\n");

    /// <summary>1c: a callee that declares its own EN and ENO (Lenze <c>IDB_WSM</c>, box <c>En</c> false) has them as
    /// ordinary pins: <c>EN :=</c> its input, <c>.ENO</c> its declared output, named because it declares several.</summary>
    [Fact]
    public void A_callees_own_EN_and_ENO_are_its_pins()
    {
        var wsm = Call("WSM", new[] { In(L("run"), "EN"), In(L("a"), "IN") }, connected: 0, instance: new Operand("ws", IsInstance: true),
            kind: CallKind.FunctionBlock, name: "ENO");
        RoundTrips(Ld1(Set(Op("AND", wsm, L("b")), T("out"))),
            "%LANGUAGE LD\n%NETWORK\nout := ws(EN := run, IN := a).ENO AND b;\n",
            new NetworkScope(Array.Empty<string>(), Array.Empty<string>(), new System.Collections.Generic.Dictionary<string, string> { ["ws"] = "WSM" },
                signatures: new System.Collections.Generic.Dictionary<string, CalleeSignature>
                    { ["WSM"] = new(CalleeShape.Block, new[] { "EN", "IN" }, new[] { "ENO", "Busy" }) }));
    }

    /// <summary>An FB box is the call of its instance, <c>EN :=</c> its first pin.</summary>
    [Fact]
    public void An_enabled_FB_is_the_call_of_its_instance_with_EN() =>
        RoundTrips(Ld1(Set(Call("TON", new[] { In(L("a"), "IN") }, en: L("c"), connected: 0, eno: true,
                instance: new Operand("t1", IsInstance: true), kind: CallKind.FunctionBlock), T("lamp"))),
            "%LANGUAGE LD\n%NETWORK\nlamp := t1(EN := c, IN := a).ENO;\n", TonScope);

    /// <summary>TON as its declaration states it: inputs IN, PT; outputs Q, ET.</summary>
    static NetworkScope TonScope { get; } = new(new[] { "a", "b", "c", "x", "y", "z", "lamp" }, Array.Empty<string>(),
        new System.Collections.Generic.Dictionary<string, string> { ["t1"] = "TON" },
        signatures: new System.Collections.Generic.Dictionary<string, CalleeSignature> { ["TON"] = new(CalleeShape.Block, new[] { "IN", "PT" }, new[] { "Q", "ET" }) });

    /// <summary>A wire read twice or more is a Demux, declared on its network's <c>VAR_TEMP</c> line. Wires are numbered across
    /// the body in the order they are defined (design.md 1.4), not by the vendor's VarId, which the text does not spell:
    /// a read numbers each network's Demux nodes by where their definitions stand.</summary>
    [Fact]
    public void A_Demux_is_a_wire_on_the_WIRES_line_numbered_across_the_body()
    {
        var first = new Volt.Engine.Format.Network.Network(0, null, null, null, false, new Node[] { Def(4, Op("AND", L("a"), L("b"))), Set(Ref(4), T("x")), Set(Op("OR", Ref(4), L("c")), T("y")) });
        var second = new Volt.Engine.Format.Network.Network(1, null, null, null, false, new Node[] { Def(4, L("d")), Set(Ref(4), T("u")), Set(Ref(4), T("v")) });
        var body = new NetworkBody(BodyLanguage.Ld, new[] { first, second });
        var text = StNetworkWriter.Write(body, Scope(body));
        Assert.Equal("%LANGUAGE LD\n%NETWORK\nVAR_TEMP w1 : ANY; END_VAR\nw1 := a AND b;\nx := w1;\ny := w1 OR c;\n%NETWORK\nVAR_TEMP w2 : ANY; END_VAR\nw2 := d;\nu := w2;\nv := w2;\n", text);
        var back = StNetworkReader.Read(text, Scope(body));
        Assert.Equal(new[] { 1, 1 }, back.Networks.Select(n => ((Demux)n.Trees[0]).VarId));
    }

    /// <summary>An unconnected FB input (an empty operand) is the pin left out of the call: measured, the network runs as
    /// the call without it (the input keeps its value), not as the pin given its default (design.md "2.1").</summary>
    [Fact]
    public void An_unconnected_FB_input_is_the_pin_left_out()
    {
        var body = Fbd1(Fb("cnt", new[] { In(L("a"), "CU"), In(L(""), "RESET"), In(L("3"), "PV") }, type: "CTU"));
        Assert.Equal("%LANGUAGE FBD\n%NETWORK\ncnt(CU := a, PV := 3);\n", StNetworkWriter.Write(body, Scope(body)));
    }

    /// <summary>A consumed FB box is a call in its tree, closed by the output its consumer reads where its type declares
    /// several, by nothing where it declares one.</summary>
    [Fact]
    public void An_FB_box_read_by_its_output_is_its_call_closed_by_the_output()
    {
        RoundTrips(Fbd1(Set(Fb("t1", new[] { In(L("a"), "IN") }, type: "TON") with { MainOutputName = "Q" }, T("x"))),
            "%LANGUAGE FBD\n%NETWORK\nx := t1(IN := a).Q;\n", TonScope);
        var one = new NetworkScope(new[] { "a", "x" }, Array.Empty<string>(), new System.Collections.Generic.Dictionary<string, string> { ["r1"] = "R_TRIG" },
            signatures: new System.Collections.Generic.Dictionary<string, CalleeSignature> { ["R_TRIG"] = new(CalleeShape.Block, new[] { "CLK" }, new[] { "Q" }) });
        RoundTrips(Fbd1(Set(Fb("r1", new[] { In(L("a"), "CLK") }, type: "R_TRIG") with { MainOutputName = "Q" }, T("x"))),
            "%LANGUAGE FBD\n%NETWORK\nx := r1(CLK := a);\n", one);
    }

    /// <summary>A wire is read by its name, before its definition too (openspec network-text-st 3.0): an FB box in a tree
    /// reads a wire its own item defines inline before it, or one an earlier item defines.</summary>
    [Fact]
    public void An_FB_box_reads_a_wire_by_its_name()
    {
        var t1 = Fb("t1", new[] { In(Ref(1), "IN"), In(L("T#1S"), "PT") }, type: "TON") with { MainOutputName = "Q" };
        RoundTrips(Ld1(Set(Op("AND", Def(1, Op("OR", L("a"), L("b"))), t1), T("y")), Set(Ref(1), T("z"))),
            "%LANGUAGE LD\n%NETWORK\nVAR_TEMP w1 : ANY; END_VAR\ny := (w1 := a OR b) AND t1(IN := w1, PT := T#1S).Q;\nz := w1;\n", TonScope);
        RoundTrips(Ld1(Def(1, Op("OR", L("a"), L("b"))), Set(Op("AND", Ref(1), t1), T("y")), Set(Ref(1), T("z"))),
            "%LANGUAGE LD\n%NETWORK\nVAR_TEMP w1 : ANY; END_VAR\nw1 := a OR b;\ny := w1 AND t1(IN := w1, PT := T#1S).Q;\nz := w1;\n", TonScope);
        // a Demux read before the item that defines it (TwinCAT stores one): the previous scan's value
        RoundTrips(Ld1(Set(Ref(1), T("x")), Def(1, Op("AND", L("a"), L("b"))), Set(Ref(1), T("y"))),
            "%LANGUAGE LD\n%NETWORK\nVAR_TEMP w1 : ANY; END_VAR\nx := w1;\nw1 := a AND b;\ny := w1;\n");
    }

    [Fact]
    public void The_network_header_is_percent_lines_then_comment_then_label()
    {
        var net = new Volt.Engine.Format.Network.Network(0, "Start \"it\"", "l1", "first\r\nsecond $1", true, new Node[] { Set(L("a"), T("x")) });
        RoundTrips(Body(net, BodyLanguage.Ld), "%LANGUAGE LD\n%NETWORK \"Start $\"it$\"\"\n%DISABLED\n// first\n// second $$1\nl1:\nx := a;\n");
    }

    /// <summary>A jump and the return are TARGETS on their value; unconditional, on the rail, <c>RAIL()</c>.</summary>
    [Fact]
    public void A_jump_and_a_return_are_targets_and_unconditional_ones_on_the_rail() =>
        RoundTrips(Ld1(new Assign(L("a"), new[] { T("done", JumpBit) }, JumpBit),
                       new Assign(L("b"), new[] { T("???", ReturnBit) }, ReturnBit),
                       new Assign(Empty, new[] { T("done", JumpBit) }, JumpBit),
                       new Assign(Empty, new[] { T("???", ReturnBit) }, ReturnBit)),
            "%LANGUAGE LD\n%NETWORK\nJMP.done := a;\nRETURN := b;\nJMP.done := RAIL();\nRETURN := RAIL();\n");

    /// <summary>A jump inside a tree is a nested assignment to its target, its value passed on.</summary>
    [Fact]
    public void A_jump_inside_a_tree_is_a_nested_target() =>
        RoundTrips(Ld1(Set(Op("AND", new Assign(L("c"), new[] { T("done", JumpBit) }, JumpBit), L("d")), T("y"))),
            "%LANGUAGE LD\n%NETWORK\ny := (JMP.done := c) AND d;\n");

    /// <summary>A coil sharing its value with a jump or the return is ONE item, the value written once — whatever it reads
    /// (its own coil's variable) or holds (a box): no value is repeated, so neither has a refusal.</summary>
    [Fact]
    public void A_coil_sharing_its_value_with_a_jump_is_one_item_its_value_written_once()
    {
        RoundTrips(Ld1(new Assign(Op("NOT", L("a")), new[] { T("a"), T("skip", JumpBit) }, JumpBit)),
            "%LANGUAGE LD\n%NETWORK\na := JMP.skip := NOT(a);\n");
        RoundTrips(Ld1(new Assign(Op("AND", L("start"), L("seal.x[1]")), new[] { T("seal"), T("???", ReturnBit) }, ReturnBit)),
            "%LANGUAGE LD\n%NETWORK\nseal := RETURN := start AND seal.x[1];\n");
        RoundTrips(Ld1(new Assign(Op("AND", L("a"), L("x")), new[] { T("x", SetBit), T("skip", JumpBit) }, JumpBit)),
            "%LANGUAGE LD\n%NETWORK\nx S= JMP.skip := a AND x;\n");
    }

    /// <summary>The targets stand in the order the IDE stores them (TwinCAT's drawn rung stores its jump first).</summary>
    [Fact]
    public void A_coil_and_a_jump_on_one_value_are_one_item_in_stored_order()
    {
        var shared = Ld1(new Assign(Op("AND", L("a"), L("b")), new[] { T("lamp"), T("done", JumpBit), T("???", ReturnBit) }, JumpBit with { Return = true }));
        RoundTrips(shared, "%LANGUAGE LD\n%NETWORK\nlamp := JMP.done := RETURN := a AND b;\n");
        RoundTrips(Ld1(new Assign(Call("f", new[] { In(L("a"), "IN") }, connected: 0), new[] { T("lamp"), T("done", JumpBit) }, JumpBit)),
            "%LANGUAGE LD\n%NETWORK\nlamp := JMP.done := f(IN := a);\n");
        RoundTrips(Ld1(new Assign(L("a"), new[] { T("done", JumpBit), T("lamp") }, JumpBit)),
            "%LANGUAGE LD\n%NETWORK\nJMP.done := lamp := a;\n");
    }

    /// <summary>A mark is written where the model holds it (the drawn samples of network-rail-and-pin-negation): the rail,
    /// a pin's, EN's, an output's and a coil's own marks, a box's negated output, each stacked edge outside the negation.</summary>
    [Fact]
    public void Each_mark_is_written_where_the_model_holds_it()
    {
        RoundTrips(Ld1(Set(Empty, T("y"))), "%LANGUAGE LD\n%NETWORK\ny := RAIL();\n");
        RoundTrips(Ld1(Set(L("a"), T("y", Neg)), Set(L("a"), T("y", Rise)), Set(L("a"), T("y", Neg with { Falling = true })),
                       Set(L("a"), T("y", SetBit with { Rising = true }))),
            "%LANGUAGE LD\n%NETWORK\nNOT y := a;\nRISING y := a;\nFALLING NOT y := a;\nRISING y S= a;\n");
        RoundTrips(Ld1(new Assign(L("a"), new[] { T("y", Neg), T("x") }, Flags.None)), "%LANGUAGE LD\n%NETWORK\nNOT y := x := a;\n");
        RoundTrips(Fbd1(Set(Op("AND", L("a"), L("b")) with { Flags = Neg, ConnectedSlot = 0 }, T("x"))),
            "%LANGUAGE FBD\n%NETWORK\nx := NOT AND(a, b);\n");
    }

    /// <summary>A mark the model cannot hold where it stands is refused by name: a mark on a coil inside a chain (every target
    /// receives the power flow, measured), a negated set coil, a mark on a jump, the rail alone.</summary>
    [Fact]
    public void A_mark_the_text_cannot_hold_is_refused_by_name()
    {
        void Refused(NetworkBody body, string reason) =>
            Assert.Equal(reason, Assert.Throws<StNetworkUnspellableException>(() => StNetworkWriter.Write(body, Scope(body))).Reason);
        Refused(Ld1(new Assign(L("a"), new[] { T("y"), T("x", Neg) }, Flags.None)), StNetworkWriter.ChainMarkReason);
        Refused(Ld1(Set(L("a"), T("y", SetBit with { Negated = true }))), "a negated set or reset coil");
        Refused(Ld1(new Assign(L("a"), new[] { T("done", JumpBit with { Negated = true }) }, JumpBit)), "a mark on a jump or a return");
        Refused(Ld1(Empty), "a rail-only item");
        Refused(Ld1(Set(new Terminator(Neg), T("y"))), "a modifier on the rail");
    }

    [Fact]
    public void A_mid_rung_coil_is_an_assignment_expression() =>
        RoundTrips(Ld1(Set(Op("AND", Set(L("a"), T("out")), L("b")), T("out2"))),
            "%LANGUAGE LD\n%NETWORK\nout2 := (out := a) AND b;\n");

    [Fact]
    public void An_Execute_box_is_a_call_its_ST_the_string_CODE_with_its_line_breaks_as_they_stand() =>
        RoundTrips(Ld1(Exec("IF go THEN\r\n\to := o + 'i$';\r\nEND_IF", en: L("en"))),
            "%LANGUAGE LD\n%NETWORK\nEXECUTE(EN := en, 'IF go THEN\n\to := o + $'i$$$';\nEND_IF');\n");

    [Fact]
    public void An_Execute_box_read_twice_defines_a_wire_like_any_box() =>
        RoundTrips(Ld1(new Demux(1, Exec("k := 1;", en: L("go"), connected: 0)), Set(new Demux(1, null), T("x")),
                Set(new Demux(1, null), T("y"))),
            "%LANGUAGE LD\n%NETWORK\nVAR_TEMP w1 : ANY; END_VAR\nw1 := EXECUTE(EN := go, 'k := 1;');\nx := w1;\ny := w1;\n");

    /// <summary>The Execute box's spellings the writer refuses (2.6 review), each by its reason: EXECUTE declared in reach
    /// (anything of that name, a variable too: the text's own word), a lone CR in its ST, a consumer reading it by another
    /// output than its ENO, a modifier on it, and a box of type EXECUTE that is no Execute box.</summary>
    [Fact]
    public void An_Execute_box_the_text_cannot_spell_is_refused_by_its_reason()
    {
        void Refused(NetworkBody body, string reason, params string[] names) =>
            Assert.Equal(reason, Assert.Throws<StNetworkUnspellableException>(() => StNetworkWriter.Write(body, Scope(body, names))).Reason);
        Refused(Ld1(Exec("k := 1;", en: L("go"))), "an element whose function name is declared in reach", "Execute");
        Refused(Ld1(Exec("k := 1;\rn := 2;", en: L("go"))), "an Execute box's ST holding a lone carriage return");
        Refused(Ld1(Set(Op("AND", Exec("k := 1;", en: L("go"), connected: 0) with { HasEnoOutput = false }, L("a")), T("x"))),
            "a consumed box with no named connection");
        Refused(Ld1(Set(Op("AND", Exec("k := 1;", en: L("go"), connected: 0) with { Flags = Neg }, L("a")), T("x"))),
            "a modifier on an Execute box output");
        Refused(Fbd1(Set(Call("Execute", new[] { In(L("b"), "IN") }, connected: 0), T("x"))), "a box named like an element of the text");
    }

    /// <summary>A pull shows a network the text cannot spell as its <c>%UNSUPPORTED</c> line, its header kept; the other
    /// networks are text.</summary>
    [Fact]
    public void A_pull_shows_an_unspellable_network_as_its_UNSUPPORTED_line()
    {
        var jump = new Volt.Engine.Format.Network.Network(0, "jump", null, null, false,
            new Node[] { new Assign(L("c"), new[] { T("done", JumpBit with { Set = true }) }, JumpBit) });
        var plain = new Volt.Engine.Format.Network.Network(1, null, null, null, false, new Node[] { Set(L("a"), T("y")) });
        var body = new NetworkBody(BodyLanguage.Ld, new[] { jump, plain });
        var text = StNetworkWriter.WritePulled(body, Scope(body));
        Assert.Equal($"%LANGUAGE LD\n%NETWORK \"jump\"\n%UNSUPPORTED \"a mark on a jump or a return\" #{NetworkHash.Of(jump)}\n%NETWORK\ny := a;\n", text);
        var back = StNetworkReader.Read(text, Scope(body));
        Assert.Equal("a mark on a jump or a return", back.Networks[0].Unsupported);
        Assert.Throws<StNetworkUnspellableException>(() => StNetworkWriter.Write(body, Scope(body)));
    }

    /// <summary>3.0: the LD parallel branch is its own function, one per mode, its feed the formal <c>FEED</c> (absent at the
    /// rail); a branch holding a box is spelled as any other (the network runs it under the measured short-circuit rule).</summary>
    [Fact]
    public void A_parallel_branch_is_BRANCH_or_BRANCH_SHORTCIRCUIT_with_its_feed_as_FEED()
    {
        var fed = new Volt.Engine.Format.Network.Parallel(L("start"), new Node[] { L("a"), Op("AND", L("b"), L("c")) }, ParallelMode.Sequential);
        var rail = new Volt.Engine.Format.Network.Parallel(null, new Node[] { L("a"), Call("f", new[] { In(L("b"), "IN") }, connected: 0) }, ParallelMode.BoxShortCircuit);
        RoundTrips(Ld1(Set(fed, T("x")), Set(rail, T("y"))),
            "%LANGUAGE LD\n%NETWORK\nx := BRANCH(FEED := start, a, b AND c);\ny := BRANCH_SHORTCIRCUIT(a, f(IN := b));\n");
    }

    /// <summary>3.0: an edge is a call on the contact or the box it is on; the IDE negates before the edge (N17).</summary>
    [Fact]
    public void An_edge_is_RISING_or_FALLING_on_its_contact_or_box() =>
        RoundTrips(Ld1(Set(L("clk", Rise), T("a")), Set(L("clk", Neg with { Falling = true }), T("b")),
                       Set(Op("AND", L("x"), L("y")) with { Flags = Rise }, T("c"))),
            "%LANGUAGE LD\n%NETWORK\na := RISING(clk);\nb := FALLING(NOT clk);\nc := RISING(x AND y);\n");

    /// <summary>An FB box is the call of its instance (design "FB boxes: the instance is the call head"); one with no usable
    /// instance — the vendor's <c>???</c>, or one no declaration in reach holds (network-text-st 3.0: the build refuses both)
    /// — is the call of its TYPE, which names no instance; a type no declaration in reach states as an FB's has no such call.</summary>
    [Fact]
    public void An_FB_box_with_no_declared_instance_is_the_call_of_its_type()
    {
        var none = new System.Collections.Generic.Dictionary<string, string>();
        var scope = new NetworkScope(new[] { "go" }, Array.Empty<string>(), none, new[] { "Axis" });
        var undeclared = Fbd1(Fb("ax9", new[] { In(L("go"), "xEnable") }, type: "Axis"));
        Assert.Equal("%LANGUAGE FBD\n%NETWORK\nAxis(xEnable := go);\n", StNetworkWriter.Write(undeclared, scope));
        var back = Assert.IsType<Box>(StNetworkReader.Read(StNetworkWriter.Write(undeclared, scope), scope).Networks[0].Trees[0]);
        Assert.Equal((Box.UnnamedInstance, "Axis"), (back.Instance!.Text, back.Type));

        var unstated = Fbd1(Fb("???", new[] { In(L("go"), "xEnable") }, type: "Axis"));
        var e = Assert.Throws<StNetworkUnspellableException>(() => StNetworkWriter.Write(unstated, new NetworkScope(new[] { "go" }, Array.Empty<string>(), none)));
        Assert.Equal("an FB box with no instance whose type is no FB type in reach", e.Reason);
    }

    /// <summary>3.0: the vendor's unnamed instance (<c>???</c>) is the call of its type; a box showing ENO and no EN is its call
    /// closed by <c>.ENO</c>; the empty item is <c>;</c>.</summary>
    [Fact]
    public void The_unnamed_instance_the_ENO_only_box_and_the_empty_item_are_spelled()
    {
        var none = new System.Collections.Generic.Dictionary<string, string>();
        var scope = new NetworkScope(new[] { "go", "x", "a" }, new[] { "f" }, none, new[] { "Axis" });
        RoundTrips(Fbd1(Fb("???", new[] { In(L("go"), "xEnable") }, type: "Axis"),
                        Set(Call("f", new[] { In(L("a"), "IN") }, connected: 0, eno: true), T("x")),
                        new Leaf(new Operand(""), Flags.None)),
            "%LANGUAGE FBD\n%NETWORK\nAxis(xEnable := go);\nx := f(IN := a).ENO;\n;\n", scope);
    }

    /// <summary>3.0: each <c>OUT =&gt;</c> is the next unnamed output slot; <c>ENO =&gt;</c> a variable is the ENO pin wired;
    /// a box type is spelled in the case the IDE stores it.</summary>
    [Fact]
    public void Several_OUTs_an_ENO_variable_and_a_typed_case_are_spelled() =>
        RoundTrips(Fbd1(Call("MOVE", new[] { In(L("0")) }, new[] { Out("a", 0), Out("b", 1) }, kind: CallKind.Operator),
                        Call("MOVE", new[] { In(L("7")) }, new[] { new Output("ENO", new Operand("lamp", IsLValue: true)), Out("x", 1) }, en: L("c"), eno: true, kind: CallKind.Operator),
                        Set(Op("and", L("a"), L("b")), T("y"))),
            "%LANGUAGE FBD\n%NETWORK\nMOVE(0, OUT => a, OUT => b);\nMOVE(EN := c, 7, ENO => lamp, OUT => x).ENO;\ny := and(a, b);\n");


    [Fact]
    public void A_wire_name_skips_the_names_in_reach_and_one_declared_in_reach_is_refused_by_name()
    {
        var body = Ld1(Def(4, L("w1")), Set(Ref(4), T("x")), Set(Ref(4), T("y")));
        Assert.Equal("%LANGUAGE LD\n%NETWORK\nVAR_TEMP w3 : ANY; END_VAR\nw3 := w1;\nx := w3;\ny := w3;\n", StNetworkWriter.Write(body, Scope(body, "w2")));
        var twice = Assert.Throws<StNetworkReadException>(() =>
            StNetworkReader.Read("%LANGUAGE LD\n%NETWORK\nVAR_TEMP w1 : ANY; END_VAR\nw1 := a;\nx := w1;\ny := w1;\n%NETWORK\nVAR_TEMP w1 : ANY; END_VAR\nw1 := b;\nu := w1;\nv := w1;\n", NetworkScope.Empty));
        Assert.Contains("an earlier network too", twice.Message);
        var read = Assert.Throws<StNetworkReadException>(() =>
            StNetworkReader.Read("%LANGUAGE LD\n%NETWORK\nVAR_TEMP w4 : ANY; END_VAR\nw4 := a;\nx := w4;\ny := w4;\n", Scope(body, "w4")));
        Assert.Contains("declared in reach", read.Message);
    }

    [Theory]
    [InlineData("FOR i := 1 TO 2 DO x := a; END_FOR;", "cannot hold a FOR")]
    [InlineData("WHILE a DO x := b; END_WHILE;", "cannot hold a WHILE")]
    [InlineData("CASE i OF 1: x := a; END_CASE;", "cannot hold a CASE")]
    [InlineData("IF a THEN x := b; END_IF;", "holds no IF")]
    [InlineData("IF a THEN JMP l; END_IF;", "a jump on a value is JMP.label := value")]
    [InlineData("x := a; (* note *)", "comment")]
    [InlineData("MOVE(1, EN := c, OUT => x).ENO;", "EN := stands first")]
    [InlineData("x := i > 3;", "every box is a call")]
    [InlineData("x := a + b;", "every box is a call")]
    [InlineData("x := NOT RISING(a);", "NOT before an edge")]
    public void What_a_network_cannot_hold_is_refused_by_name_with_its_line(string code, string named)
    {
        var ex = Assert.Throws<StNetworkReadException>(() => StNetworkReader.Read("%LANGUAGE LD\n%NETWORK\n" + code + "\n", NetworkScope.Empty));
        Assert.Contains(named, ex.Message);
        Assert.Equal(3, ex.Line);
    }

    /// <summary>3.0: a Demux is a wire whatever its reads — once, or none (TwinCAT and the case set store both).</summary>
    [Fact]
    public void A_wire_read_once_or_never_is_a_Demux() =>
        RoundTrips(Ld1(Def(1, Op("AND", L("a"), L("b"))), Set(Ref(1), T("x")), Def(2, L("c"))),
            "%LANGUAGE LD\n%NETWORK\nVAR_TEMP w1 : ANY; w2 : ANY; END_VAR\nw1 := a AND b;\nx := w1;\nw2 := c;\n");

    /// <summary>A keyword operator heads a call wherever an operand or a statement starts (<c>AND(</c>, <c>XOR(</c>,
    /// <c>MOD(</c>, <c>NOT(</c>); after an operand it is the contact (<c>a AND b</c>).</summary>
    [Fact]
    public void A_keyword_operator_before_a_bracket_is_its_box()
    {
        var body = StNetworkReader.Read("%LANGUAGE FBD\n%NETWORK\nx := XOR(a, NOT(b)) AND MOD(i, 2);\nAND(a, b);\n", NetworkScope.Empty);
        var x = Assert.IsType<Assign>(body.Networks[0].Trees[0]);
        var and = Assert.IsType<Box>(x.Value);
        Assert.Equal(("AND", 2), (and.Type, and.Inputs.Count));
        Assert.Equal(new[] { "XOR", "MOD" }, and.Inputs.Select(i => ((Box)i.Value).Type));
        Assert.Equal("NOT", ((Box)((Box)and.Inputs[0].Value).Inputs[1].Value).Type);
        Assert.Equal("AND", Assert.IsType<Box>(body.Networks[0].Trees[1]).Type);
    }

    /// <summary>A box's output reaches no wire: a wire is defined by <c>w := &lt;box&gt;</c>, its box closed by the output it
    /// reads.</summary>
    [Theory]
    [InlineData("VAR_TEMP w1 : ANY; END_VAR\nMOVE(EN := c, 1, OUT => w1).ENO;\ny := w1;", "a wire is defined by")]
    [InlineData("VAR_TEMP w1 : ANY; END_VAR\ny := MOVE(EN := c, 1, OUT => w1).ENO;\nz := w1;", "a wire is defined by")]
    public void A_box_output_to_a_wire_is_refused_by_name(string code, string named)
    {
        var ex = Assert.Throws<StNetworkReadException>(() => StNetworkReader.Read("%LANGUAGE LD\n%NETWORK\n" + code + "\n", NetworkScope.Empty));
        Assert.Contains(named, ex.Message);
    }

    /// <summary>An enabled box other than a comparison is read by its value only as a coil's value (CODESYS: "A box with EN
    /// can be used for comparison operators only."): the writer shows every other read (inside a box, read once or
    /// through a wire read twice, or as a jump's condition) as <c>%UNSUPPORTED</c>, the text its reader refuses.</summary>
    [Fact]
    public void An_enabled_box_read_by_its_value_other_than_as_a_coil_has_no_spelling()
    {
        const string reason = "an enabled box read by its value outside a coil";
        Box Add() => Call("ADD", new[] { In(L("i")), In(L("3")) }, en: L("c"), connected: 0, kind: CallKind.Operator);
        var inBox = Fbd1(Set(Call("AND", new[] { In(Add()), In(L("a")) }, connected: 0, kind: CallKind.Operator), T("y")));
        var jump = Ld1(new Assign(Call("AND", new[] { In(L("a")), In(L("b")) }, en: L("c"), connected: 0, kind: CallKind.Operator),
            new[] { T("l", JumpBit) }, JumpBit));
        var throughWire = Fbd1(Def(1, Add()), Set(Call("MUL", new[] { In(Ref(1)), In(L("2")) }, connected: 0, kind: CallKind.Operator), T("x")),
            Set(Ref(1), T("y")));
        foreach (var body in new[] { inBox, jump, throughWire })
        {
            Assert.Equal(reason, Assert.Throws<StNetworkUnspellableException>(() => StNetworkWriter.Write(body, Scope(body))).Reason);
            Assert.Contains($"%UNSUPPORTED \"{reason}\"", StNetworkWriter.WritePulled(body, Scope(body)));
        }
        // read by coils only, through a wire read twice, it is spelled
        RoundTrips(Fbd1(Def(1, Add()), Set(Ref(1), T("x")), Set(Ref(1), T("y"))),
            "%LANGUAGE FBD\n%NETWORK\nVAR_TEMP w1 : ANY; END_VAR\nw1 := ADD(EN := c, i, 3);\nx := w1;\ny := w1;\n");
    }

    /// <summary>A callee that declares EN or ENO has them as its pins (1.2): a box showing the flag over a callee declaring
    /// the pin of that name has no spelling, nor a pin EN on a callee declaring none (the text reads it as the flag).</summary>
    [Fact]
    public void A_shown_flag_over_a_declared_pin_of_its_name_has_no_spelling()
    {
        var none = new System.Collections.Generic.Dictionary<string, string>();
        var declares = new NetworkScope(new[] { "a", "b", "x" }, Array.Empty<string>(), none,
            signatures: new System.Collections.Generic.Dictionary<string, CalleeSignature> { ["Foo"] = new(CalleeShape.Function, new[] { "EN", "IN" }, new[] { "ENO" }) });
        var shownEn = Fbd1(Set(Call("Foo", new[] { In(L("b"), "IN") }, en: L("a"), connected: 0), T("x")));
        Assert.Equal("a box showing EN whose callee declares EN", Assert.Throws<StNetworkUnspellableException>(() => StNetworkWriter.Write(shownEn, declares)).Reason);
        var plain = new NetworkScope(new[] { "a", "b", "x" }, Array.Empty<string>(), none,
            signatures: new System.Collections.Generic.Dictionary<string, CalleeSignature> { ["Foo"] = new(CalleeShape.Function, new[] { "IN" }, Array.Empty<string>()) });
        var enPin = Fbd1(Set(Call("Foo", new[] { In(L("a"), "EN"), In(L("b"), "IN") }, connected: 0), T("x")));
        Assert.Equal("a pin named EN its callee does not declare", Assert.Throws<StNetworkUnspellableException>(() => StNetworkWriter.Write(enPin, plain)).Reason);
    }
}
