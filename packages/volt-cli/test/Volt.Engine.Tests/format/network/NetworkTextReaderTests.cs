using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Engine.Format.Network;
using static Volt.Engine.Tests.NetworkModels;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Engine.Tests;

/// <summary>
/// The network text reader (openspec <c>ld-fbd-coverage</c> 2R.6b): each construct reads to the model <c>v2-spec.md</c>
/// says it is, built here by hand in the shape the reader produces — the raw model, so a fact the oracle's
/// <see cref="NetworkTextFacts"/> would normalise away is still pinned. The grammar's breadth is the shared case set
/// (<see cref="NetworkTextCaseTests"/>); this file pins the model details a case's dump abbreviates.
/// </summary>
public class NetworkTextReaderTests
{
    static NetworkBody Read(string text, NetworkScope scope)
    {
        var r = NetworkTextReader.Read(text, scope);
        Assert.True(r.Ok, string.Join("\n", r.Diagnostics.Select(d => $"{d.Line}:{d.Column} {d.Code} {d.Message}")));
        return r.Body!;
    }

    static NetworkBody Read(string text) => Read(text, NetworkScope.Empty);

    static void AssertModel(NetworkBody expected, NetworkBody actual) =>
        Assert.Null(NetworkModelEquality.FirstDifference(expected, actual));

    /// <summary>A box read by its value: connected by slot 0, no ENO.</summary>
    static Box Consumed(string type, IEnumerable<Input> inputs, IEnumerable<Output>? outputs = null, Node? en = null) =>
        Call(type, inputs, outputs, en: en, connected: 0, kind: NetworkSpelling.KindOf(type, hasInstance: false));

    /// <summary>A bit operator's box (AND/OR/XOR/NOT) read by its value: connected by no stored slot (census 1.6).</summary>
    static Box ConsumedBitOp(string type, IEnumerable<Input> inputs) =>
        Call(type, inputs, kind: CallKind.Operator);

    /// <summary>A box at the top level: nothing connected, its ENO where the text shows it.</summary>
    static Box Top(string type, IEnumerable<Input> inputs, IEnumerable<Output>? outputs = null, Node? en = null, Flags? f = null,
                    bool eno = false) =>
        Call(type, inputs, outputs, en: en, f: f, kind: NetworkSpelling.KindOf(type, hasInstance: false), eno: eno);

    /// <summary>A box a consumer reads through its ENO: connected by slot 0, the ENO.</summary>
    static Box ByEno(string type, IEnumerable<Input> inputs, IEnumerable<Output>? outputs = null, Node? en = null) =>
        Call(type, inputs, outputs, en: en, connected: 0, eno: true, kind: NetworkSpelling.KindOf(type, hasInstance: false));

    static Operand Coil(string text, Flags? f = null) => new(text, IsLValue: true, Flags: f);

    static readonly NetworkScope Timers =
        new(Array.Empty<string>(), Array.Empty<string>(), new Dictionary<string, string> { ["t1"] = "TON", ["d1"] = "Dryer" });

    // ── the model oracle ────────────────────────────────────────────────────────────────────────

    [Fact]
    public void The_oracle_writes_against_a_scope_without_the_bodys_variables()
    {
        Assert.False(NetworkModelOracle.CallablesOf(Body(Set(L("split5"), T("out")))).Contains("split5"));
        Assert.Null(NetworkModelOracle.Check("split-shaped", Body(Set(L("split5"), T("out")))).Reason);
    }

    [Fact]
    public void The_oracle_sees_a_fact_the_text_dropped()
    {
        var with = Body(Set(L("a", Neg), T("out")));
        var without = Body(Set(L("a"), T("out")));
        Assert.NotNull(NetworkModelEquality.FirstDifference(NetworkTextFacts.Carried(with), NetworkTextFacts.Carried(without)));
    }

    // ── items ───────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_word_level_nested_in_brackets_is_two_nested_boxes() =>
        AssertModel(Body(Set(ConsumedBitOp("OR", new[] { In(ConsumedBitOp("AND", new[] { In(L("a")), In(L("b")) })), In(L("c")) }), Coil("out"))),
            Read(Src("out := (a AND b) OR c;")));

    [Fact]
    public void A_chained_assignment_is_one_assign_with_several_coils() =>
        AssertModel(Body(Set(L("v"), Coil("x"), Coil("y", SetBit))), Read(Src("x := y S= v;")));

    [Fact]
    public void A_nested_assignment_is_an_assign_in_the_value() =>
        AssertModel(Body(Set(Set(L("v"), Coil("x")), Coil("y"))), Read(Src("y := (x := v);")));

    [Fact]
    public void A_conditional_jump_is_one_item() =>
        AssertModel(Body(new Assign(L("a"), new[] { Coil("Done", JumpBit) }, JumpBit)), Read(Src("JMP Done := a;")));

    [Fact]
    public void The_empty_statement_is_the_empty_item()
    {
        var text = Src("out := a;", ";");
        AssertModel(Body(Net(Set(L("a"), Coil("out")), Empty)), Read(text));
        Assert.Equal(text, NetworkTextWriter.Write(Read(text), NetworkScope.Empty));
    }

    [Fact]
    public void A_flagged_top_level_call_is_a_value_item() =>
        AssertModel(Body(Top("f", new[] { In(L("x"), "IN") }, f: Neg)), Read(Src("NOT f(IN := x);")));

    [Fact]
    public void Top_level_leaf_split_and_parallel_are_value_items()
    {
        AssertModel(Body(L("a")), Read(Src("a;")));
        AssertModel(Body(new Parallel(null, new Node[] { L("a"), L("b") }, ParallelMode.BoxShortCircuit)),
            Read(Src("BRANCH (a, b) SHORTCIRCUIT;")));
        AssertModel(Body(Net(Def(1, L("TRUE")), Ref(1))), Read(Src("split1 := TRUE;", "split1;")));
    }

    /// <summary>A chain is one item: each box in the EN slot of the one above, root first — read in any layout.</summary>
    [Fact]
    public void A_chain_is_one_item_root_first()
    {
        var a = ByEno("MOVE", new[] { In(L("1")) }, new[] { Out("A", 1) }, en: L("c"));
        var b = ByEno("MOVE", new[] { In(L("2")) }, new[] { Out("B", 1) }, en: a);
        AssertModel(Body(Set(b, Coil("done"))), Read(Src("done := MOVE 2 => B ENO EN", "          MOVE 1 => A ENO EN c;")));
        AssertModel(Body(Set(b, Coil("done"))), Read(Src("done := MOVE 2 => B ENO EN MOVE 1 => A ENO EN c;")));
    }

    // ── splits ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_split_is_a_Demux_whatever_its_use_count() =>
        AssertModel(Body(Net(Def(28, ConsumedBitOp("AND", new[] { In(L("a")), In(L("b")) })), Set(Ref(28), Coil("out")))),
            Read(Src("split28 := a AND b;", "out := split28;")));

    [Fact]
    public void A_ladder_leaf_split_reads_untyped() =>
        AssertModel(Body(Net(Def(1, L("nSpeed")), Top("MOVE", new[] { In(Ref(1)) }, new[] { Out("nOut", 0) })), BodyLanguage.Ld),
            Read(LdMarker + "NETWORK\n  split1 := nSpeed;\n  MOVE split1 => nOut;\nEND_NETWORK\n"));

    // ── the header and its comment ──────────────────────────────────────────────────────────────

    [Fact]
    public void A_statement_after_the_header_line_is_a_statement()
    {
        var body = Read(FbdMarker + "NETWORK\n  DISABLED := x;\nEND_NETWORK\n");
        AssertModel(Body(Set(L("x"), Coil("DISABLED"))), body);
        Assert.False(body.Networks[0].Disabled);
    }

    [Fact]
    public void A_multi_line_comment_reads_back_line_for_line()
    {
        var body = Read(FbdMarker + "NETWORK\n  // step:\n  //\n\n  //     indented  \n  // // quoted\n  out := a;\nEND_NETWORK\n");
        Assert.Equal("step:\r\n\r\n    indented  \r\n// quoted", body.Networks[0].Comment);
    }

    [Fact]
    public void The_header_fields_and_the_title_escapes()
    {
        var body = Read(FbdMarker + "NETWORK LABEL: Done DISABLED TITLE: \"Tray $\"A$\" line 1$Lline 2 costs $$5 \"\n  ;\nEND_NETWORK\n");
        var n = body.Networks[0];
        Assert.Equal(("Done", "Tray \"A\" line 1\nline 2 costs $5 ", true), (n.Label, n.Title, n.Disabled));
    }

    // ── jumps and returns ───────────────────────────────────────────────────────────────────────

    /// <summary>The vendor's shapes: on the rail an empty Terminator (DIALECT C11), the bit on the target and the item
    /// (C13), a return's target <c>???</c>.</summary>
    [Fact]
    public void Jumps_and_returns_read_as_the_vendor_holds_them()
    {
        var ret = Coil("???", ReturnBit);
        AssertModel(new NetworkBody(BodyLanguage.Fbd, new[]
            {
                Net(new Assign(Empty, new[] { Coil("Done", JumpBit) }, JumpBit)),
                Net(new Assign(L("a"), new[] { ret }, ReturnBit)) with { Order = 1 },
                Net(new Assign(Empty, new[] { ret }, ReturnBit)) with { Order = 2 },
            }),
            Read(FbdMarker + "NETWORK\n  JMP Done := ;\nEND_NETWORK\nNETWORK\n  RETURN := a;\nEND_NETWORK\nNETWORK\n  RETURN := ;\nEND_NETWORK\n"));
    }

    // ── EN, ENO and output slots ────────────────────────────────────────────────────────────────

    [Fact]
    public void A_box_read_through_its_ENO() =>
        AssertModel(Body(Set(ByEno("MOVE", new[] { In(L("0")) }, new[] { Out("Status", 1) }, en: L("c")), Coil("lamp"))),
            Read(Src("lamp := MOVE 0 => Status ENO EN c;")));

    [Fact]
    public void An_enabled_box_read_by_its_value() =>
        AssertModel(Body(Set(Consumed("GT", new[] { In(L("a")), In(L("b")) }, en: L("c")), Coil("out"))),
            Read(Src("out := a GT b EN c;")));

    [Fact]
    public void A_top_level_enabled_box_shows_its_ENO_where_it_has_one()
    {
        AssertModel(Body(Top("MOVE", new[] { In(L("0")) }, new[] { Out("x", 1) }, en: L("c"), eno: true)), Read(Src("MOVE 0 => x ENO EN c;")));
        AssertModel(Body(Top("MOVE", new[] { In(L("0")) }, new[] { Out("x", 0) }, en: L("c"))), Read(Src("MOVE 0 => x EN c;")));
        AssertModel(Body(Top("MOVE", new[] { In(L("0")) }, new[] { Out("lamp", 0, "ENO"), Out("x", 1) }, en: L("c"), eno: true)),
            Read(Src("MOVE 0 => x ENO => lamp EN c;")));
    }

    /// <summary>An FB read with nothing after its call is read by its declared ENO; by <c>.name</c>, by that output.</summary>
    [Fact]
    public void An_FB_is_read_by_its_declared_ENO_or_by_its_named_output()
    {
        AssertModel(Body(Set(Fb("d1", new[] { In(L("a"), "iOn") }, type: "Dryer") with { ConnectedSlot = 0, HasEnoOutput = true }, Coil("out"))),
            Read(Src("out := d1 : Dryer(iOn := a);"), Timers));
        AssertModel(Body(Set(Fb("t1", new[] { In(L("a"), "IN") }, type: "TON") with { MainOutputName = "Q" }, Coil("out"))),
            Read(Src("out := t1 : TON(IN := a).Q;"), Timers));
    }

    [Fact]
    public void A_consumed_box_reads_its_positional_pin_on_the_next_slot() =>
        AssertModel(Body(Set(Consumed("f", new[] { In(L("src")) }, new[] { Out("err", 1) }), Coil("out"))),
            Read(Src("out := f(src, => err);")));

    [Fact]
    public void A_pin_named_like_a_word_of_the_text_is_a_backticked_pin() =>
        AssertModel(Body(Top("f", new[] { In(L("a"), "execute"), In(L("b"), "branch") }, new[] { Out("x", null, "not") })),
            Read(Src("f(`execute` := a, `branch` := b, `not` => x);")));

    [Fact]
    public void An_Execute_box_read_through_its_ENO() =>
        AssertModel(Body(Set(Exec("x := 1;", connected: 0), Coil("out"))),
            Read(FbdMarker + "NETWORK\n  out := EXECUTE\nx := 1;\n  END_EXECUTE;\nEND_NETWORK\n"));

    [Fact]
    public void A_bare_arrow_passes_an_output_slot_over() =>
        AssertModel(Body(Set(Consumed("f", new[] { In(L("src")) }, new[] { Out("b", 2) }), Coil("out"))),
            Read(Src("out := f(src, =>, => b);")));

    /// <summary>An FB call names its instance and its type; a head the scope declares an instance is refused without it.</summary>
    [Fact]
    public void An_FB_call_names_its_instance_and_its_type()
    {
        AssertModel(Body(Fb("t1", new[] { In(L("a"), "IN"), In(L("pt"), "PT") }, new[] { Out("el", null, "ET") }, "TON")),
            Read(Src("t1 : TON(IN := a, PT := pt, ET => el);"), Timers));
        AssertModel(Body(Top("t1", new[] { In(L("a"), "IN"), In(L("pt"), "PT") }, new[] { Out("el", null, "ET") })),
            Read(Src("t1(IN := a, PT := pt, ET => el);")));
        Assert.False(NetworkTextReader.Read(Src("t1(IN := a);"), Timers).Ok);
    }

    // ── brackets, NOT and edges ─────────────────────────────────────────────────────────────────

    [Fact]
    public void The_NOT_box_is_its_backticked_call_and_NOT_before_a_bracket_negates_it()
    {
        var body = Read(Src("o1 := `NOT`(a);", "o2 := NOT a;", "o3 := NOT (a AND b);", "o4 := `NOT`((a AND b));", "o5 := `NOT`(IN := a);"));
        var notBox = ConsumedBitOp("NOT", new[] { In(L("a")) });
        AssertModel(Body(Net(
            Set(notBox, Coil("o1")),
            Set(L("a", Neg), Coil("o2")),
            Set(ConsumedBitOp("AND", new[] { In(L("a")), In(L("b")) }) with { Flags = Neg }, Coil("o3")),
            Set(ConsumedBitOp("NOT", new[] { In(ConsumedBitOp("AND", new[] { In(L("a")), In(L("b")) })) }), Coil("o4")),
            Set(notBox, Coil("o5")))), body);
    }

    [Fact]
    public void Edges_are_prefixes_on_their_operand_never_a_box()
    {
        AssertModel(Body(Top("MOVE", new[] { In(L("1")) }, new[] { Out("nMode", 1) }, en: L("bStart", Rise), eno: true)),
            Read(Src("MOVE 1 => nMode ENO EN R_EDGE bStart;")));
        AssertModel(Body(Set(L("x", Neg with { Falling = true }), Coil("out"))), Read(Src("out := F_EDGE NOT x;")));
        AssertModel(Body(Set(ConsumedBitOp("AND", new[] { In(L("a")), In(L("b")) }) with { Flags = Rise }, Coil("lamp"))),
            Read(Src("lamp := R_EDGE (a AND b);")));
    }

    // ── empty slots, the parallel, EXECUTE, backticks ───────────────────────────────────────────

    [Fact]
    public void An_empty_argument_list_is_no_input_slot_and_a_named_empty_pin_is_one()
    {
        AssertModel(Body(Top("f", Array.Empty<Input>())), Read(Src("f();")));
        AssertModel(Body(Top("f", new[] { In(Empty, "IN") })), Read(Src("f(IN := );")));
        AssertModel(Body(Top("MOVE", new[] { In(Empty) }, new[] { Out("x", 0) })), Read(Src("MOVE => x;")));
    }

    [Fact]
    public void A_result_pin_and_an_assign_over_the_box_are_different_items()
    {
        AssertModel(Body(Top("MOVE", new[] { In(L("src")) }, new[] { Out("dst", 0) })), Read(Src("MOVE src => dst;")));
        AssertModel(Body(Set(Consumed("MOVE", new[] { In(L("src")) }), Coil("dst"))), Read(Src("dst := MOVE src;")));
    }

    [Fact]
    public void A_BRANCH_list_is_a_Parallel_fed_or_unfed()
    {
        AssertModel(Body(Net(Def(54, L("TRUE")), Set(new Parallel(Ref(54), new Node[] { L("a"), L("b") }, ParallelMode.BoxShortCircuit), Coil("out")))),
            Read(Src("split54 := TRUE;", "out := split54 BRANCH (a, b) SHORTCIRCUIT;")));
        AssertModel(Body(Set(new Parallel(null, new Node[] { L("a"), L("b") }, ParallelMode.Sequential), Coil("out"))),
            Read(Src("out := BRANCH (a, b);")));
        AssertModel(Body(Set(new Parallel(L("f"), new Node[] { L("a"), L("b") }, ParallelMode.Sequential), Coil("out"))),
            Read(Src("out := f BRANCH (a,", "                  b);")));
    }

    [Fact]
    public void EXECUTE_bodies_are_verbatim_lines()
    {
        AssertModel(Body(Exec("", L("bRun"))), Read(FbdMarker + "NETWORK\n  EXECUTE\n\n  END_EXECUTE ENO EN bRun;\nEND_NETWORK\n"));
        var text = FbdMarker + "NETWORK\n  EXECUTE\nNetworkState := 1; // $5 `x`\n  END_EXECUTE;\nEND_NETWORK\n";
        AssertModel(Body(Exec("NetworkState := 1; // $5 `x`")), Read(text));
        Assert.True(NetworkTextGate.Validate(text, NetworkScope.Empty).Ok);
    }

    [Fact]
    public void Backticked_text_is_one_operand_never_parsed()
    {
        var scope = new NetworkScope(Array.Empty<string>(), Array.Empty<string>(), new Dictionary<string, string> { ["fb"] = "FB" });
        AssertModel(Body(Fb("fb", new[] { In(L("fc_dinttotime(T.Start,2)"), "P") })),
            Read(Src("fb : FB(P := `fc_dinttotime(T.Start,2)`);"), scope));
        AssertModel(Body(Set(L("x"), Coil("arr[i + 1]"))), Read(Src("`arr[i + 1]` := x;")));
    }

    // ── diagnostics are findings, not exceptions ────────────────────────────────────────────────

    [Fact]
    public void A_bad_network_does_not_hide_the_next_ones_finding()
    {
        var r = NetworkTextReader.Read(
            FbdMarker + "NETWORK\n  out := (a AND b);\nEND_NETWORK\nNETWORK\n  out := a + b;\nEND_NETWORK\nNETWORK\n  ok := a;\nEND_NETWORK\n", NetworkScope.Empty);
        Assert.Null(r.Body);
        Assert.Equal(new[] { ("NETWORK_BAD_EXPRESSION", 3), ("NETWORK_BAD_EXPRESSION", 6) },
            r.Diagnostics.Select(d => (d.Code, d.Line)).ToArray());
    }

    /// <summary>A validator finding is a diagnostic at the node it names, and the next network is still read.</summary>
    [Fact]
    public void A_validator_finding_stands_at_its_node_and_the_next_network_is_read()
    {
        var r = NetworkTextReader.Read(
            FbdMarker + "NETWORK\n  x := a SUB b SUB c;\nEND_NETWORK\nNETWORK\n  y := a + b;\nEND_NETWORK\n", NetworkScope.Empty);
        Assert.Equal(new[] { ("NETWORK_UNSUPPORTED", 3, 8), ("NETWORK_BAD_EXPRESSION", 6, 10) },
            r.Diagnostics.Select(d => (d.Code, d.Line, d.Column)).ToArray());
    }

    // ── what the writer writes, the reader reads back unchanged ─────────────────────────────────

    static void RoundTrips(NetworkBody m, NetworkScope scope)
    {
        var text = NetworkTextWriter.Write(m, scope);
        AssertModel(m, Read(text, scope));
        var gate = NetworkTextGate.Validate(text, scope);
        Assert.True(gate.Ok, string.Join("\n", gate.Diagnostics.Select(x => x.Code + " " + x.Message)) + "\n\n" + text);
    }

    /// <summary>A JMP takes one label: after <c>JMP</c> a word can be nothing else, so a label spelled like a word of the
    /// text is read as the label.</summary>
    [Theory]
    [InlineData("Execute")]
    [InlineData("Branch")]
    [InlineData("Network")]
    [InlineData("Let")]
    [InlineData("END_IF")]
    public void A_jump_label_spelled_like_a_word_of_the_text_round_trips(string label) =>
        RoundTrips(new NetworkBody(BodyLanguage.Ld, new[]
        {
            Net(new Assign(L("x"), new[] { Coil(label, JumpBit) }, JumpBit)),
            new Network(1, null, label, null, false, new Node[] { Set(L("a"), Coil("out")) }),
            Net(new Assign(Empty, new[] { Coil(label, JumpBit) }, JumpBit)) with { Order = 2 },
        }), NetworkScope.Empty);

    [Fact]
    public void An_operand_named_LET_round_trips()
    {
        RoundTrips(Body(Set(L("a"), Coil("Let"))), NetworkScope.Empty);
        RoundTrips(Body(L("let")), NetworkScope.Empty);
    }

    [Fact]
    public void A_box_type_spelled_like_a_word_of_the_text_round_trips()
    {
        RoundTrips(Body(Top("Network", new[] { In(L("x")) }, new[] { Out("y", 0) })), NetworkScope.Empty);
        RoundTrips(Body(Set(Consumed("JMP", new[] { In(L("x")) }), Coil("out"))), NetworkScope.Empty);
        RoundTrips(Body(Top("EXECUTE", new[] { In(L("x")) })), NetworkScope.Empty);
    }

    [Fact]
    public void An_operator_type_in_another_case_round_trips() =>
        RoundTrips(Body(Set(ConsumedBitOp("and", new[] { In(L("a")), In(L("b")) }), Coil("o"))), NetworkScope.Empty);

    [Fact]
    public void An_EXECUTE_snippet_with_trailing_newlines_round_trips()
    {
        RoundTrips(Body(Exec("x := 1;\n")), NetworkScope.Empty);
        RoundTrips(Body(Exec("\n")), NetworkScope.Empty);
        RoundTrips(Body(Exec("")), NetworkScope.Empty);
    }

    /// <summary>≅ compares the output slots and the connection slot as stored.</summary>
    [Fact]
    public void The_oracle_sees_an_output_moved_to_another_slot()
    {
        var one = Body(Set(Call("f", new[] { In(L("src")) }, new[] { Out("err", 0) }, connected: 1), Coil("out")));
        var zero = Body(Set(Call("f", new[] { In(L("src")) }, new[] { Out("err", 1) }, connected: 0), Coil("out")));
        Assert.NotNull(NetworkModelEquality.FirstDifference(NetworkTextFacts.Carried(one), NetworkTextFacts.Carried(zero)));
    }

    [Fact]
    public void The_oracle_sees_a_trailing_newline() =>
        Assert.NotNull(NetworkModelEquality.FirstDifference(
            NetworkTextFacts.Carried(Body(Exec("x := 1;\n"))), NetworkTextFacts.Carried(Body(Exec("x := 1;")))));
}
