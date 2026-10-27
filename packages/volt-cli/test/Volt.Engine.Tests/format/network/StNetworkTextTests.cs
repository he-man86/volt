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

    /// <summary>The revision (owner): an enabled box is its own function, <c>&lt;name&gt;_EN</c>, EN first, returning ENO, its
    /// value through <c>OUT =&gt;</c>; a chain nests as drawn.</summary>
    [Fact]
    public void An_EN_chain_nests_enabled_boxes_as_drawn()
    {
        var inner = Call("MOVE", new[] { In(L("1")) }, new[] { Out("x", 1) }, en: L("c"), connected: 0, eno: true);
        var outer = Call("MOVE", new[] { In(L("2")) }, new[] { Out("y", 1) }, en: inner, connected: 0, eno: true);
        RoundTrips(Ld1(Set(outer, T("done"))),
            "%LANGUAGE LD\n%NETWORK\ndone := MOVE_EN(EN := MOVE_EN(EN := c, 1, OUT => x), 2, OUT => y);\n");
    }

    [Fact]
    public void An_enabled_operator_is_its_enabled_function_with_positional_pins() =>
        RoundTrips(Ld1(Call("ADD", new[] { In(L("o")), In(L("1")) }, new[] { Out("o", 1) }, en: L("go"), eno: true, kind: CallKind.Operator)),
            "%LANGUAGE LD\n%NETWORK\nADD_EN(EN := go, o, 1, OUT => o);\n");

    /// <summary>An enabled box returns its ENO, a comparison too (owner). CODESYS's enabled comparison read by its VALUE
    /// stores no ENO (1.3): its value leaves through <c>OUT =&gt;</c> a wire, the call standing where the wire is read.</summary>
    [Fact]
    public void An_enabled_comparison_read_by_its_value_is_its_OUT_wire() =>
        RoundTrips(Ld1(Set(Op("AND", L("a"), Call("GT", new[] { In(L("i")), In(L("3")) }, en: L("en"), connected: 0, kind: CallKind.Operator)), T("out"))),
            "%LANGUAGE LD\n%NETWORK\n%WIRES w1\nGT_EN(EN := en, i, 3, OUT => w1);\nout := a AND w1;\n");

    [Fact]
    public void An_enabled_comparison_read_by_its_ENO_returns_it() =>
        RoundTrips(Ld1(Set(Call("GT", new[] { In(L("i")), In(L("3")) }, new[] { Out("hot", 1) }, en: L("en"), connected: 0, eno: true, kind: CallKind.Operator), T("ok"))),
            "%LANGUAGE LD\n%NETWORK\nok := GT_EN(EN := en, i, 3, OUT => hot);\n");

    /// <summary>1c: a callee that declares its own EN (Lenze <c>IDB_WSM</c>, box <c>En</c> false) is a plain call whose
    /// <c>EN</c> is the callee's pin; its declared ENO is read by name.</summary>
    [Fact]
    public void A_callees_own_EN_and_ENO_are_formal_pins_of_a_plain_call()
    {
        var wsm = Call("WSM", new[] { In(L("run"), "EN"), In(L("a"), "IN") }, connected: 0, instance: new Operand("ws", IsInstance: true),
            kind: CallKind.FunctionBlock, name: "ENO");
        RoundTrips(Ld1(Set(Op("AND", wsm, L("b")), T("out"))),
            "%LANGUAGE LD\n%NETWORK\n%WIRES w1\nws(EN := run, IN := a, ENO => w1);\nout := w1 AND b;\n",
            new NetworkScope(Array.Empty<string>(), Array.Empty<string>(), new System.Collections.Generic.Dictionary<string, string> { ["ws"] = "WSM" }));
    }

    [Fact]
    public void An_enabled_FB_is_its_instance_with_EN() =>
        RoundTrips(Ld1(Set(Call("TON", new[] { In(L("a"), "IN") }, en: L("c"), connected: 0, eno: true,
                instance: new Operand("t1", IsInstance: true), kind: CallKind.FunctionBlock), T("lamp"))),
            "%LANGUAGE LD\n%NETWORK\n%WIRES w1\nt1_EN(EN := c, IN := a, ENO => w1);\nlamp := w1;\n");

    /// <summary>A wire read twice or more is a Demux, named on its network's <c>%WIRES</c> line. Wires are numbered across
    /// the body in the order they are defined (design.md 1.4), not by the vendor's VarId, which the text does not spell:
    /// a read numbers each network's Demux nodes by where their definitions stand.</summary>
    [Fact]
    public void A_Demux_is_a_wire_on_the_WIRES_line_numbered_across_the_body()
    {
        var first = new Volt.Engine.Format.Network.Network(0, null, null, null, false, new Node[] { Def(4, Op("AND", L("a"), L("b"))), Set(Ref(4), T("x")), Set(Op("OR", Ref(4), L("c")), T("y")) });
        var second = new Volt.Engine.Format.Network.Network(1, null, null, null, false, new Node[] { Def(4, L("d")), Set(Ref(4), T("u")), Set(Ref(4), T("v")) });
        var body = new NetworkBody(BodyLanguage.Ld, new[] { first, second });
        var text = StNetworkWriter.Write(body, Scope(body));
        Assert.Equal("%LANGUAGE LD\n%NETWORK\n%WIRES w1\nw1 := a AND b;\nx := w1;\ny := w1 OR c;\n%NETWORK\n%WIRES w2\nw2 := d;\nu := w2;\nv := w2;\n", text);
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

    [Fact]
    public void An_FB_box_read_by_its_output_is_a_statement_before_its_reader() =>
        RoundTrips(Fbd1(Set(Fb("t1", new[] { In(L("a"), "IN") }, type: "TON") with { MainOutputName = "Q" }, T("x"))),
            "%LANGUAGE FBD\n%NETWORK\n%WIRES w1\nt1(IN := a, Q => w1);\nx := w1;\n");

    /// <summary>A box written as a statement before its item (an FB, read once) reads only wires the text has defined by
    /// then: a wire defined INSIDE its own item (<c>(w1 := a OR b)</c>) is set after the call, so the call would read the
    /// previous scan's value where the network feeds this scan's. That shape has no spelling (0 in the corpora); a wire
    /// an earlier item defines is read as it stands.</summary>
    [Fact]
    public void A_statement_box_reading_a_wire_its_own_item_defines_has_no_spelling()
    {
        var t1 = Fb("t1", new[] { In(Ref(1), "IN"), In(L("T#1S"), "PT") }, type: "TON") with { MainOutputName = "Q" };
        var inline = Ld1(Set(Op("AND", Def(1, Op("OR", L("a"), L("b"))), t1), T("y")), Set(Ref(1), T("z")));
        var ex = Assert.Throws<StNetworkUnspellableException>(() => StNetworkWriter.Write(inline, Scope(inline)));
        Assert.Equal("a box before its item reading a wire its item defines", ex.Reason);
        Assert.StartsWith("%LANGUAGE LD\n%NETWORK\n%UNSUPPORTED \"a box before its item reading a wire its item defines\"",
            StNetworkWriter.WritePulled(inline, Scope(inline)));

        RoundTrips(Ld1(Def(1, Op("OR", L("a"), L("b"))), Set(Op("AND", Ref(1), t1), T("y")), Set(Ref(1), T("z"))),
            "%LANGUAGE LD\n%NETWORK\n%WIRES w1, w2\nw1 := a OR b;\nt1(IN := w1, PT := T#1S, Q => w2);\ny := w1 AND w2;\nz := w1;\n");
    }

    [Fact]
    public void The_network_header_is_percent_lines_then_comment_then_label()
    {
        var net = new Volt.Engine.Format.Network.Network(0, "Start \"it\"", "l1", "first\r\nsecond $1", true, new Node[] { Set(L("a"), T("x")) });
        RoundTrips(Body(net, BodyLanguage.Ld), "%LANGUAGE LD\n%NETWORK \"Start $\"it$\"\"\n%DISABLED\n// first\n// second $$1\nl1:\nx := a;\n");
    }

    [Fact]
    public void A_jump_and_a_return_are_IF_statements_and_unconditional_ones_bare() =>
        RoundTrips(Ld1(new Assign(L("a"), new[] { T("done", JumpBit) }, JumpBit),
                       new Assign(Empty, new[] { T("???", ReturnBit) }, ReturnBit)),
            "%LANGUAGE LD\n%NETWORK\nIF a THEN JMP done; END_IF;\nRETURN;\n");

    [Fact]
    public void A_mid_rung_coil_is_an_assignment_expression() =>
        RoundTrips(Ld1(Set(Op("AND", Set(L("a"), T("out")), L("b")), T("out2"))),
            "%LANGUAGE LD\n%NETWORK\nout2 := (out := a) AND b;\n");

    [Fact]
    public void An_Execute_box_is_its_ST_between_percent_lines() =>
        RoundTrips(Ld1(Exec("o := o + i;", en: L("en"))),
            "%LANGUAGE LD\n%NETWORK\n%EXECUTE(EN := en)\no := o + i;\n%END_EXECUTE\n");

    /// <summary>A pull shows a network the text cannot spell as its <c>%UNSUPPORTED</c> line, its header kept; the other
    /// networks are text.</summary>
    [Fact]
    public void A_pull_shows_an_unspellable_network_as_its_UNSUPPORTED_line()
    {
        var edge = new Volt.Engine.Format.Network.Network(0, "edge", null, null, false, new Node[] { Set(L("clk", Rise), T("x")) });
        var plain = new Volt.Engine.Format.Network.Network(1, null, null, null, false, new Node[] { Set(L("a"), T("y")) });
        var body = new NetworkBody(BodyLanguage.Ld, new[] { edge, plain });
        var text = StNetworkWriter.WritePulled(body, Scope(body));
        Assert.Equal($"%LANGUAGE LD\n%NETWORK \"edge\"\n%UNSUPPORTED \"an edge contact\" #{NetworkTextWriter.Hash(edge)}\n%NETWORK\ny := a;\n", text);
        var back = StNetworkReader.Read(text, Scope(body));
        Assert.Equal("an edge contact", back.Networks[0].Unsupported);
        Assert.Throws<StNetworkUnspellableException>(() => StNetworkWriter.Write(body, Scope(body)));
    }

    [Fact]
    public void A_wire_name_skips_the_names_in_reach_and_one_declared_in_reach_is_refused_by_name()
    {
        var body = Ld1(Def(4, L("w1")), Set(Ref(4), T("x")), Set(Ref(4), T("y")));
        Assert.Equal("%LANGUAGE LD\n%NETWORK\n%WIRES w3\nw3 := w1;\nx := w3;\ny := w3;\n", StNetworkWriter.Write(body, Scope(body, "w2")));
        var twice = Assert.Throws<StNetworkReadException>(() =>
            StNetworkReader.Read("%LANGUAGE LD\n%NETWORK\n%WIRES w1\nw1 := a;\nx := w1;\ny := w1;\n%NETWORK\n%WIRES w1\nw1 := b;\nu := w1;\nv := w1;\n", NetworkScope.Empty));
        Assert.Contains("an earlier network too", twice.Message);
        var read = Assert.Throws<StNetworkReadException>(() =>
            StNetworkReader.Read("%LANGUAGE LD\n%NETWORK\n%WIRES w4\nw4 := a;\nx := w4;\ny := w4;\n", Scope(body, "w4")));
        Assert.Contains("declared in reach", read.Message);
    }

    [Theory]
    [InlineData("FOR i := 1 TO 2 DO x := a; END_FOR;", "cannot hold a FOR")]
    [InlineData("WHILE a DO x := b; END_WHILE;", "cannot hold a WHILE")]
    [InlineData("CASE i OF 1: x := a; END_CASE;", "cannot hold a CASE")]
    [InlineData("IF a THEN x := b; END_IF;", "holds one JMP or RETURN")]
    [InlineData("IF a THEN JMP l; ELSE RETURN; END_IF;", "no ELSE")]
    [InlineData("x := a; (* note *)", "comment")]
    [InlineData("MOVE_EN(1, OUT => x);", "EN := as its first argument")]
    [InlineData("x := i > 3;", "every box is a call")]
    [InlineData("x := a + b;", "every box is a call")]
    [InlineData("x := NOT f(a);", "the NOT box is NOT(")]
    public void What_a_network_cannot_hold_is_refused_by_name_with_its_line(string code, string named)
    {
        var ex = Assert.Throws<StNetworkReadException>(() => StNetworkReader.Read("%LANGUAGE LD\n%NETWORK\n" + code + "\n", NetworkScope.Empty));
        Assert.Contains(named, ex.Message);
        Assert.Equal(3, ex.Line);
    }

    [Fact]
    public void A_wire_read_once_with_an_expression_definition_is_refused_by_name()
    {
        var ex = Assert.Throws<StNetworkReadException>(() =>
            StNetworkReader.Read("%LANGUAGE LD\n%NETWORK\n%WIRES w1\nw1 := a AND b;\nx := w1;\n", NetworkScope.Empty));
        Assert.Contains("read twice or more", ex.Message);
    }

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

    /// <summary>An enabled box has one value: <c>OUT</c> named twice is refused, and so is a call read by its return that
    /// also defines a wire.</summary>
    [Theory]
    [InlineData("%WIRES w1\nMOVE_EN(EN := c, 1, OUT => x, OUT => w1);\ny := w1;", "OUT twice")]
    [InlineData("%WIRES w1\ny := MOVE_EN(EN := c, 1, OUT => w1);\nz := w1;", "read by its return and defines the wire")]
    public void An_enabled_box_with_two_values_is_refused_by_name(string code, string named)
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
            "%LANGUAGE FBD\n%NETWORK\n%WIRES w1\nADD_EN(EN := c, i, 3, OUT => w1);\nx := w1;\ny := w1;\n");
    }

    /// <summary><c>X_EN(…)</c> is the enabled box of <c>X</c>: where anything declared in reach (a POU, an instance, a
    /// variable) is named <c>X_EN</c>, the writer shows the box as <c>%UNSUPPORTED</c> instead of a text its reader refuses.</summary>
    [Fact]
    public void An_enabled_box_whose_EN_name_is_declared_in_reach_has_no_spelling()
    {
        const string reason = "an enabled box whose name with _EN is declared in reach";
        var none = new System.Collections.Generic.Dictionary<string, string>();
        var body = Fbd1(Set(Call("Foo", new[] { In(L("b")) }, en: L("a"), connected: 0, eno: true), T("x")));
        foreach (var scope in new[] { new NetworkScope(Array.Empty<string>(), new[] { "Foo", "Foo_EN" }, none), new NetworkScope(new[] { "Foo_EN" }, new[] { "Foo" }, none) })
            Assert.Equal(reason, Assert.Throws<StNetworkUnspellableException>(() => StNetworkWriter.Write(body, scope)).Reason);
        var fb = Ld1(Set(Call("TON", new[] { In(L("a"), "IN") }, en: L("c"), connected: 0, eno: true,
            instance: new Operand("t1", IsInstance: true), kind: CallKind.FunctionBlock), T("lamp")));
        var fbScope = new NetworkScope(new[] { "t1_EN" }, Array.Empty<string>(), new System.Collections.Generic.Dictionary<string, string> { ["t1"] = "TON" });
        Assert.Equal(reason, Assert.Throws<StNetworkUnspellableException>(() => StNetworkWriter.Write(fb, fbScope)).Reason);
    }
}
