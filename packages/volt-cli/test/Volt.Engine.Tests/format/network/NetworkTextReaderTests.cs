using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Engine.Format.Network;
using static Volt.Engine.Tests.NetworkModels;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Engine.Tests;

/// <summary>
/// The network text reader (openspec <c>ld-fbd-coverage</c> 2R.3): each construct reads to the model
/// <c>readability.md</c> says it is, built here by hand in the shape the reader produces — the raw model, so a fact the
/// oracle's <see cref="NetworkTextFacts"/> would normalise away is still pinned. The grammar's breadth is the shared case
/// set (<see cref="NetworkTextCaseTests"/>); this file pins the model details a case's dump abbreviates.
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

    /// <summary>A box as the reader builds it read by its data: connected by its main output, slot 0, which is no ENO.</summary>
    static Box Consumed(string type, IEnumerable<Input> inputs, IEnumerable<Output>? outputs = null) =>
        Call(type, inputs, outputs, main: 0, connected: 0, eno: false, kind: NetworkSpelling.KindOf(type, hasInstance: false));

    /// <summary>A bit operator's box (AND/OR/XOR/NOT) read by its data: connected by no stored slot (census 1.6).</summary>
    static Box ConsumedBitOp(string type, IEnumerable<Input> inputs) =>
        Call(type, inputs, main: null, connected: null, kind: CallKind.Operator);

    /// <summary>A box as the reader builds it at the top level: nothing connected, its ENO stated only where positional
    /// pins make the text say it (<paramref name="eno"/>).</summary>
    static Box Top(string type, IEnumerable<Input> inputs, IEnumerable<Output>? outputs = null, Node? en = null, Flags? f = null,
                    bool? eno = null) =>
        Call(type, inputs, outputs, en: en, main: null, connected: null, f: f, kind: NetworkSpelling.KindOf(type, hasInstance: false), eno: eno);

    /// <summary>A box read by the next line's ENO (B4): connected by its ENO slot, which it has.</summary>
    static Box ByEno(string type, IEnumerable<Input> inputs, IEnumerable<Output>? outputs = null, Node? en = null) =>
        Call(type, inputs, outputs, en: en, main: null, connected: 0, eno: true, kind: NetworkSpelling.KindOf(type, hasInstance: false));

    static Operand Coil(string text, Flags? f = null) => new(text, IsLValue: true, Flags: f);

    // ── the model oracle ────────────────────────────────────────────────────────────────────────

    /// <summary>The oracle writes a body against the scope of its callables only too — so a writer that leaves a
    /// split-shaped variable bare for its own reader to read as a split fails here.</summary>
    [Fact]
    public void The_oracle_writes_against_a_scope_without_the_bodys_variables()
    {
        Assert.False(NetworkModelOracle.CallablesOf(Body(Set(L("split5"), T("out")))).Contains("split5"));
        foreach (var (tree, line) in NetworkTextWriterTests.SplitShapedNames)
            Assert.Null(NetworkModelOracle.Check(line, Body(tree)).Reason);
    }

    /// <summary>"Pull-side loss is caught": the oracle fails on a dropped fact even where the text is a fixed point.</summary>
    [Fact]
    public void The_oracle_sees_a_fact_the_text_dropped()
    {
        var with = Body(Set(L("a", Neg), T("out")));
        var without = Body(Set(L("a"), T("out")));
        Assert.NotNull(NetworkModelEquality.FirstDifference(NetworkTextFacts.Carried(with), NetworkTextFacts.Carried(without)));
    }

    // ── one ; per NWL item (B4) ─────────────────────────────────────────────────────────────────

    [Fact]
    public void A_word_level_nested_in_brackets_is_two_nested_boxes() =>
        AssertModel(Body(Set(Op("OR", Op("AND", L("a"), L("b")), L("c")), Coil("out"))),
            Read(Src("out := (a AND b) OR c;")));

    [Fact]
    public void A_chained_assignment_is_one_assign_with_several_coils() =>
        AssertModel(Body(Set(L("v"), Coil("x"), Coil("y", SetBit))), Read(Src("x := y S= v;")));

    [Fact]
    public void A_conditional_jump_is_one_item() =>
        AssertModel(Body(new Assign(L("a"), new[] { Coil("Done", JumpBit) }, JumpBit)),
            Read(Src("JMP Done := a;")));

    [Fact]
    public void The_empty_statement_is_the_empty_item()
    {
        var text = Src("out := a;", ";");
        AssertModel(Body(Net(Set(L("a"), Coil("out")), Empty)), Read(text));
        Assert.Equal(text, NetworkTextWriter.Write(Read(text), NetworkScope.Empty));
    }

    [Fact]
    public void A_flagged_top_level_box_is_a_value_statement() =>
        AssertModel(Body(Top("f", new[] { In(L("x")) }, f: Neg)), Read(Src("NOT f(x);")));

    [Fact]
    public void Top_level_leaf_split_and_parallel_are_value_items()
    {
        AssertModel(Body(L("a")), Read(Src("a;")));
        AssertModel(Body(new Parallel(null, new Node[] { L("a"), L("b") }, ParallelMode.BoxShortCircuit)),
            Read(Src("BRANCH (a, b) SHORTCIRCUIT;")));
        AssertModel(Body(Net(Def(1, L("TRUE")), Ref(1))), Read(Src("split1 := TRUE;", "split1;")));
    }

    /// <summary>B4: the ENO lines of one item — every line without <c>;</c> is a box the next line reads, so the item is
    /// one tree whatever its line count.</summary>
    [Fact]
    public void Lines_without_a_semicolon_are_one_item_read_through_ENO()
    {
        var a = ByEno("MOVE", new[] { In(L("1")) }, new[] { Out("A", 1) }, en: L("c"));
        var b = ByEno("MOVE", new[] { In(L("2")) }, new[] { Out("B", 1) }, en: a);
        AssertModel(Body(Set(b, Coil("done"))), Read(Src("MOVE 1 => A EN c", "MOVE 2 => B EN ENO", "done := ENO;")));
    }

    // ── splits (B6) ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_split_is_a_Demux_whatever_its_use_count() =>
        AssertModel(Body(Net(Def(28, Op("AND", L("a"), L("b"))), Set(Ref(28), Coil("out")))),
            Read(Src("split28 := a AND b;", "out := split28;")));

    /// <summary>B6: a leaf split's leaf stores no type from the text — the push's derivation is the IDE's.</summary>
    [Fact]
    public void A_ladder_leaf_split_reads_untyped() =>
        AssertModel(Body(Net(Def(1, L("nSpeed")), Top("MOVE", new[] { In(Ref(1)) }, new[] { Out("nOut", 0) }, eno: false)), BodyLanguage.Ld),
            Read(LdMarker + "NETWORK\n  split1 := nSpeed;\n  MOVE split1 => nOut;\nEND_NETWORK\n"));

    // ── the header and its comment (P12) ────────────────────────────────────────────────────────

    [Fact]
    public void A_statement_after_the_header_line_is_a_statement()
    {
        var body = Read(FbdMarker + "NETWORK\n  DISABLED := x;\nEND_NETWORK\n");
        AssertModel(Body(Set(L("x"), Coil("DISABLED"))), body);
        Assert.False(body.Networks[0].Disabled);
    }

    /// <summary>P12: the comment's lines, joined as the IDE stores them (CR LF); a blank line between `//` lines is layout.</summary>
    [Fact]
    public void A_multi_line_comment_reads_back_line_for_line()
    {
        var body = Read(FbdMarker + "NETWORK\n  // step:\n  //\n\n  //     indented  \n  // // quoted\n  out := a;\nEND_NETWORK\n");
        Assert.Equal("step:\r\n\r\n    indented  \r\n// quoted", body.Networks[0].Comment);
    }

    [Fact]
    public void The_header_fields_and_the_title_escapes()
    {
        var body = Read(FbdMarker + "NETWORK LABEL: Done DISABLED TITLE: \"Tray $\"A$\" line 1$Nline 2 costs $$5 \"\n  ;\nEND_NETWORK\n");
        var n = body.Networks[0];
        Assert.Equal(("Done", "Tray \"A\" line 1\nline 2 costs $5 ", true), (n.Label, n.Title, n.Disabled));
    }

    // ── jumps and returns (B4b) ─────────────────────────────────────────────────────────────────

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
            Read(FbdMarker + "NETWORK\n  JMP Done;\nEND_NETWORK\nNETWORK\n  RETURN := a;\nEND_NETWORK\nNETWORK\n  RETURN;\nEND_NETWORK\n"));
    }

    // ── EN, ENO and output slots ────────────────────────────────────────────────────────────────

    [Fact]
    public void An_enabled_box_consumed_by_its_ENO() =>
        AssertModel(Body(Set(ByEno("MOVE", new[] { In(L("0")) }, new[] { Out("Status", 1) }, en: L("c")), Coil("lamp"))),
            Read(Src("MOVE 0 => Status EN c", "lamp := ENO;")));

    /// <summary>B4, P4 (2): an enabled comparison is the one enabled VALUE, bracketed, connected by its main output, with no ENO.</summary>
    [Fact]
    public void An_enabled_comparison_read_as_a_value_reads_its_main_output() =>
        AssertModel(Body(Set(Call("GT", new[] { In(L("a")), In(L("b")) }, en: L("c"), main: 0, connected: 0, eno: false,
                kind: CallKind.Operator), Coil("out"))),
            Read(Src("out := (a GT b EN c);")));

    /// <summary>P3: a call with an ENO and no EN hands its ENO on; a positional pin fills the slot after it.</summary>
    [Fact]
    public void A_call_without_EN_read_by_ENO_has_an_ENO_output() =>
        AssertModel(Body(Set(ByEno("Dryer", new[] { In(L("a")) }, new[] { Out("speed", 1) }), Coil("out"))),
            Read(Src("Dryer(a, => speed)", "out := ENO;")));

    [Fact]
    public void A_consumed_box_without_EN_reads_its_positional_pin_on_slot_1() =>
        AssertModel(Body(Set(Consumed("f", new[] { In(L("src")) }, new[] { Out("err", 1) }), Coil("out"))),
            Read(Src("out := f(src, => err);")));

    /// <summary>P1/P16: a pin named like a word of the text is backticked — and is a pin.</summary>
    [Fact]
    public void A_pin_named_like_a_word_of_the_text_is_a_backticked_pin() =>
        AssertModel(Body(Top("f", new[] { In(L("a"), "execute"), In(L("b"), "branch") }, new[] { Out("x", null, "not") })),
            Read(Src("f(`execute` := a, `branch` := b, `not` => x);")));

    /// <summary>B1, B3: an operator box with an output pin and EN is its word, the pin before the EN.</summary>
    [Fact]
    public void An_operator_word_with_an_output_and_EN() =>
        AssertModel(Body(Call("AND", new[] { In(L("a")), In(L("b")) }, new[] { Out("out", 1) }, en: L("go"), main: null, kind: CallKind.Operator, eno: true)),
            Read(Src("a AND b => out EN go;")));

    [Fact]
    public void A_consumed_execute_box_without_EN() =>
        AssertModel(Body(Set(Exec("x := 1;", connected: 0), Coil("out"))),
            Read(FbdMarker + "NETWORK\n  EXECUTE\nx := 1;\n  END_EXECUTE\n  out := ENO;\nEND_NETWORK\n"));

    [Fact]
    public void A_bare_arrow_passes_an_output_slot_over() =>
        AssertModel(Body(Set(Consumed("f", new[] { In(L("src")) }, new[] { Out("b", 2) }), Coil("out"))),
            Read(Src("out := f(src, =>, => b);")));

    [Fact]
    public void An_FB_head_is_the_instance_the_scope_declares_and_its_type_comes_from_there()
    {
        var scope = new NetworkScope(Array.Empty<string>(), Array.Empty<string>(), new Dictionary<string, string> { ["t1"] = "TON" });
        AssertModel(Body(Fb("t1", new[] { In(L("a"), "IN"), In(L("pt"), "PT") }, new[] { Out("el", null, "ET") }, "TON")),
            Read(Src("t1(IN := a, PT := pt, ET => el);"), scope));
        AssertModel(Body(Top("t1", new[] { In(L("a"), "IN"), In(L("pt"), "PT") }, new[] { Out("el", null, "ET") })),
            Read(Src("t1(IN := a, PT := pt, ET => el);")));
    }

    // ── brackets, NOT and edges ─────────────────────────────────────────────────────────────────

    /// <summary>P5: <c>NOT(IN := a)</c> is the NOT box, <c>NOT (</c> + anything else negates that bracket; spacing plays no
    /// part.</summary>
    [Fact]
    public void The_NOT_box_names_its_input_and_NOT_before_a_bracket_negates_it()
    {
        var notBox = ConsumedBitOp("NOT", new[] { In(L("a")) });
        var body = Read(Src("o1 := NOT(IN := a);", "o2 := NOT a;", "o3 := NOT (a AND b);", "o4 := NOT(IN := a AND b);", "o5 := NOT (IN := a);"));
        AssertModel(Body(Net(
            Set(notBox, Coil("o1")),
            Set(L("a", Neg), Coil("o2")),
            Set(Op("AND", L("a"), L("b")) with { Flags = Neg }, Coil("o3")),
            Set(ConsumedBitOp("NOT", new[] { In(Op("AND", L("a"), L("b"))) }), Coil("o4")),
            Set(notBox, Coil("o5")))), body);
    }

    [Fact]
    public void Edges_are_flags_on_their_operand_never_a_box()
    {
        AssertModel(Body(Top("MOVE", new[] { In(L("1")) }, new[] { Out("nMode", 1) }, en: L("bStart", Rise), eno: true)),
            Read(Src("MOVE 1 => nMode EN R_EDGE(bStart);")));
        AssertModel(Body(Set(L("x", Neg with { Falling = true }), Coil("out"))), Read(Src("out := F_EDGE(NOT x);")));
        AssertModel(Body(Set(Op("AND", L("a"), L("b")) with { Flags = Rise }, Coil("lamp"))), Read(Src("lamp := R_EDGE(a AND b);")));
    }

    // ── empty slots, the parallel, EXECUTE, backticks ───────────────────────────────────────────

    [Fact]
    public void An_empty_argument_list_is_no_input_slot_and_a_named_empty_pin_is_one()
    {
        AssertModel(Body(Top("MOVE", Array.Empty<Input>())), Read(Src("MOVE();")));
        AssertModel(Body(Top("MOVE", new[] { In(Empty) })), Read(Src("MOVE(IN := );")));
    }

    /// <summary>B2: <c>MOVE b =&gt; a</c> is a result pin, <c>a := MOVE b</c> a coil over the box — two items.</summary>
    [Fact]
    public void A_result_pin_and_an_assign_over_the_box_are_different_items()
    {
        AssertModel(Body(Top("MOVE", new[] { In(L("src")) }, new[] { Out("dst", 0) }, eno: false)), Read(Src("MOVE src => dst;")));
        AssertModel(Body(Set(Consumed("MOVE", new[] { In(L("src")) }), Coil("dst"))), Read(Src("dst := MOVE src;")));
    }

    /// <summary>B8: a parallel is <c>[feed] BRANCH (a, b)</c>, fed or unfed; the editor's Sequential mode is written as nothing.</summary>
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
        AssertModel(Body(Exec("", L("bRun"))), Read(FbdMarker + "NETWORK\n  EXECUTE EN bRun\n\n  END_EXECUTE;\nEND_NETWORK\n"));
        var text = FbdMarker + "NETWORK\n  EXECUTE\nNetworkState := 1;\n  END_EXECUTE;\nEND_NETWORK\n";
        AssertModel(Body(Exec("NetworkState := 1;")), Read(text));
        Assert.True(NetworkTextGate.Validate(text, NetworkScope.Empty).Ok);
    }

    [Fact]
    public void Backticked_text_is_one_operand_never_parsed()
    {
        var scope = new NetworkScope(Array.Empty<string>(), Array.Empty<string>(), new Dictionary<string, string> { ["fb"] = "FB" });
        AssertModel(Body(Fb("fb", new[] { In(L("fc_dinttotime(T.Start,2)"), "P") })),
            Read(Src("fb(P := `fc_dinttotime(T.Start,2)`);"), scope));
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
        RoundTrips(Body(Top("Network", new[] { In(L("x")) }, new[] { Out("y", 0) }, eno: false)), NetworkScope.Empty);
        RoundTrips(Body(Set(Consumed("JMP", new[] { In(L("x")) }), Coil("out"))), NetworkScope.Empty);
        RoundTrips(Body(Top("EXECUTE", new[] { In(L("x")) })), NetworkScope.Empty);
    }

    [Fact]
    public void An_operator_type_in_another_case_round_trips() =>
        RoundTrips(Body(Set(Call("and", new[] { In(L("a")), In(L("b")) }, main: null, kind: CallKind.Operator), Coil("o"))), NetworkScope.Empty);

    [Fact]
    public void An_EXECUTE_snippet_with_trailing_newlines_round_trips()
    {
        RoundTrips(Body(Exec("x := 1;\n")), NetworkScope.Empty);
        RoundTrips(Body(Exec("\n")), NetworkScope.Empty);
        RoundTrips(Body(Exec("")), NetworkScope.Empty);
    }

    /// <summary>≅ compares the output slots and the connection slot as stored: main output slot 1 and slot 0 print the
    /// same text, and must not compare equal.</summary>
    [Fact]
    public void The_oracle_sees_an_output_moved_to_another_slot()
    {
        var one = Body(Set(Call("f", new[] { In(L("src")) }, new[] { Out("err", 0) }, main: 1, connected: 1), Coil("out")));
        var zero = Body(Set(Call("f", new[] { In(L("src")) }, new[] { Out("err", 1) }, main: 0, connected: 0), Coil("out")));
        Assert.NotNull(NetworkModelEquality.FirstDifference(NetworkTextFacts.Carried(one), NetworkTextFacts.Carried(zero)));
    }

    [Fact]
    public void The_oracle_sees_a_trailing_newline()
    {
        Assert.NotNull(NetworkModelEquality.FirstDifference(
            NetworkTextFacts.Carried(Body(Exec("x := 1;\n"))), NetworkTextFacts.Carried(Body(Exec("x := 1;")))));
    }

    /// <summary>Census 1.12: the oracle's scope holds only what a declaration can name — <c>SUPER^</c> is refused by name.</summary>
    [Fact]
    public void The_oracle_does_not_declare_an_instance_no_declaration_names()
    {
        var super = Body(Call("ATD_Base", new[] { In(L("ioAxis"), "ioAxis") }, main: null,
            instance: new Operand("SUPER^", IsInstance: true), kind: CallKind.FunctionBlock));
        Assert.Equal("an FB instance the declarations do not name", NetworkModelOracle.Check("SUPER^", super).Reason);
    }
}
