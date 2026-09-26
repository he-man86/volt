using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.Network.Next;
using static Volt.Engine.Tests.NextModels;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Engine.Tests;

/// <summary>
/// Network text v2 reader: each construct parses to the model the spec and the page say it is, and the model
/// oracle <c>Read(Write(m)) ≅ m</c> holds over every model the writer goldens pin. Expected texts come from
/// <c>docs/network-text-next.html</c> and the scenarios in
/// <c>openspec/changes/network-text-literal-nwl/specs/network-text/spec.md</c>; expected models are built by hand
/// in the shape the reader produces (<see cref="NextNetworkTextFacts"/> lists what the text does not carry).
/// </summary>
public class NextNetworkTextReaderTests
{
    const string FbdMarker = "(* @volt-implementation FBD *)\n";
    const string LdMarker = "(* @volt-implementation LD *)\n";

    /// <summary>A one-network FBD body holding these statement lines.</summary>
    static string Src(params string[] lines) =>
        FbdMarker + "NETWORK\n" + string.Concat(lines.Select(l => "  " + l + "\n")) + "END_NETWORK\n";

    static NetworkBody Read(string text, NextNetworkScope scope, BodyLanguage lang = BodyLanguage.Fbd)
    {
        var r = NextNetworkTextReader.Read(text, lang, scope);
        Assert.True(r.Ok, string.Join("\n", r.Diagnostics.Select(d => $"{d.Line}:{d.Column} {d.Code} {d.Message}")));
        return r.Body!;
    }

    static NetworkBody Read(string text, BodyLanguage lang = BodyLanguage.Fbd) => Read(text, NextNetworkScope.Empty, lang);

    static void AssertModel(NetworkBody expected, NetworkBody actual) =>
        Assert.Null(NetworkModelEquality.FirstDifference(expected, actual));

    /// <summary>A box as the reader builds it from a call consumed by its main output: the text reads that as
    /// slot 0 (spec, "a consumed box without EN keeps its main output").</summary>
    static Box Consumed(string type, IEnumerable<Input> inputs, IEnumerable<Output>? outputs = null) =>
        Call(type, inputs, outputs, main: 0, connected: 0, kind: NextSpelling.KindOf(type, hasInstance: false));

    /// <summary>A bit operator's box (AND/OR/XOR/NOT) as the reader builds it from a call consumed by its main
    /// output: connected by no stored slot, as the vendor keeps no main output index on these boxes (census 1.6:
    /// None on the AND/OR boxes) — the same model the writer goldens build for the NOT box.</summary>
    static Box ConsumedBitOp(string type, IEnumerable<Input> inputs) =>
        Call(type, inputs, main: null, connected: null, kind: CallKind.Operator);

    /// <summary>A box as the reader builds it at the top level: nothing connected, no main output read.</summary>
    static Box Top(string type, IEnumerable<Input> inputs, IEnumerable<Output>? outputs = null, Node? en = null, Flags? f = null) =>
        Call(type, inputs, outputs, en: en, main: null, connected: null, f: f, kind: NextSpelling.KindOf(type, hasInstance: false));

    static Operand Coil(string text, Flags? f = null) => new(text, IsLValue: true, Flags: f);

    // ── the model oracle: Read(Write(m)) ≅ m ────────────────────────────────────────────────────

    public static TheoryData<string> Goldens()
    {
        var d = new TheoryData<string>();
        foreach (var k in WriterGoldens.Keys) d.Add(k);
        return d;
    }

    /// <summary>Spec, "the round trip is checked on tokens and on models": the writer's output reads back to the
    /// model it was written from, up to what the text does not carry — and the gate accepts it as canonical.</summary>
    [Theory]
    [MemberData(nameof(Goldens))]
    public void Every_writer_golden_reads_back_to_its_model(string name)
    {
        var m = WriterGoldens[name];
        var scope = ScopeOf(m);
        var text = NextNetworkTextWriter.Write(m, scope);
        var back = Read(text, scope, m.Language);
        Assert.Null(NetworkModelEquality.FirstDifference(NextNetworkTextFacts.Carried(m), NextNetworkTextFacts.Carried(back)));

        var gate = NextNetworkTextGate.Validate(text, m.Language, scope);
        Assert.True(gate.Ok, string.Join("\n", gate.Diagnostics.Select(x => x.Code + " " + x.Message)));
    }

    /// <summary>Spec, "pull-side loss is caught": the oracle fails on a dropped fact even where the text is a
    /// fixed point. A model whose flag the writer would not carry must not compare equal to one without it.</summary>
    [Fact]
    public void The_oracle_sees_a_fact_the_text_dropped()
    {
        var with = Body(Set(L("a", Neg), T("out")));
        var without = Body(Set(L("a"), T("out")));
        Assert.NotNull(NetworkModelEquality.FirstDifference(NextNetworkTextFacts.Carried(with), NextNetworkTextFacts.Carried(without)));
    }

    /// <summary>Spec, "the writer avoids a collision": the renamed wire reads back, carrying the new VarId the
    /// push then writes.</summary>
    [Fact]
    public void A_renamed_wire_reads_back_under_its_new_VarId()
    {
        var scope = new NextNetworkScope(new[] { "G3" }, Array.Empty<string>(), new Dictionary<string, string>());
        var text = NextNetworkTextWriter.Write(Body(Net(Def(3, L("TRUE")), Set(Ref(3), T("out")))), scope);
        AssertModel(Body(Net(Def(0, L("TRUE"), "BOOL"), Set(Ref(0), Coil("out")))), Read(text, scope));

        var scope2 = new NextNetworkScope(new[] { "G0", "G3" }, Array.Empty<string>(), new Dictionary<string, string>());
        var text2 = NextNetworkTextWriter.Write(
            Body(Net(Def(1, L("TRUE")), Def(3, Op("AND", Ref(1), L("G0"))), Set(Ref(3), T("G3")))), scope2);
        AssertModel(Body(Net(Def(1, L("TRUE"), "BOOL"), Def(2, Op("AND", Ref(1), L("G0")), "BOOL"), Set(Ref(2), Coil("G3")))),
            Read(text2, scope2));
    }

    // ── one statement per NWL item ──────────────────────────────────────────────────────────────

    /// <summary>Spec, "a single-consumer producer is nested".</summary>
    [Fact]
    public void A_nested_group_is_two_nested_boxes() =>
        AssertModel(Body(Set(Op("OR", Op("AND", L("a"), L("b")), L("c")), Coil("out"))),
            Read(Src("out := ((a AND b) OR c);")));

    /// <summary>Spec, "a multi-output assign is one statement".</summary>
    [Fact]
    public void A_chained_assignment_is_one_assign_with_several_coils() =>
        AssertModel(Body(Set(L("v"), Coil("x"), Coil("y", SetBit))), Read(Src("x :=", "y S= v;")));

    /// <summary>Spec, "END_IF; is one item, not two".</summary>
    [Fact]
    public void END_IF_semicolon_is_one_item() =>
        AssertModel(Body(new Assign(L("a"), new[] { Coil("Done", JumpBit) }, JumpBit)),
            Read(Src("IF a THEN JMP Done; END_IF;")));

    /// <summary>Spec, "the empty statement is the empty item".</summary>
    [Fact]
    public void The_empty_statement_is_the_empty_item()
    {
        var text = Src("out := a;", ";");
        AssertModel(Body(Net(Set(L("a"), Coil("out")), Empty)), Read(text));
        Assert.Equal(text, NextNetworkTextWriter.Write(Read(text), NextNetworkScope.Empty));
    }

    /// <summary>Spec, "a top-level box with nothing connected".</summary>
    [Fact]
    public void A_flagged_top_level_box_is_a_value_statement() =>
        AssertModel(Body(Top("f", new[] { In(L("x")) }, f: Neg)), Read(Src("NOT f(x);")));

    [Fact]
    public void Top_level_leaf_wire_and_parallel_are_value_statements()
    {
        AssertModel(Body(L("a")), Read(Src("a;")));
        AssertModel(Body(new Parallel(null, new Node[] { L("a"), L("b") }, Flags.None)), Read(Src("PARALLEL(a, b);")));
        AssertModel(Body(Net(Def(1, L("TRUE"), "BOOL"), Ref(1))), Read(Src("VAR_TEMP g1 : BOOL; END_VAR", "g1 := TRUE;", "g1;")));
    }

    // ── the VAR_TEMP wire ───────────────────────────────────────────────────────────────────────

    /// <summary>Spec, "a single-consumer Demux survives": the declaration alone makes it a wire.</summary>
    [Fact]
    public void A_declared_wire_is_a_Demux_whatever_its_use_count() =>
        AssertModel(Body(Net(Def(28, Op("AND", L("a"), L("b")), "BOOL"), Set(Ref(28), Coil("out")))),
            Read(Src("VAR_TEMP g28 : BOOL; END_VAR", "g28 := (a AND b);", "out := g28;")));

    /// <summary>Spec, "the block across lines": read, and accepted by the gate.</summary>
    [Fact]
    public void The_wire_block_reads_across_lines()
    {
        var text = FbdMarker + "NETWORK\n  VAR_TEMP\n    g1 : BOOL;\n    g2 : BOOL;\n  END_VAR\n  g1 := TRUE;\n  g2 := (g1 AND a);\n  out := g2;\nEND_NETWORK\n";
        AssertModel(Body(Net(Def(1, L("TRUE"), "BOOL"), Def(2, Op("AND", Ref(1), L("a")), "BOOL"), Set(Ref(2), Coil("out")))),
            Read(text));
        Assert.True(NextNetworkTextGate.Validate(text, BodyLanguage.Fbd, NextNetworkScope.Empty).Ok);
    }

    /// <summary>Spec, "an undeclared assignment is a coil".</summary>
    [Fact]
    public void An_undeclared_wire_shaped_target_in_scope_is_a_coil() =>
        AssertModel(Body(Set(L("x"), Coil("g5"))),
            Read(Src("g5 := x;"), new NextNetworkScope(new[] { "g5" }, Array.Empty<string>(), new Dictionary<string, string>())));

    [Fact]
    public void A_wire_takes_the_type_it_is_declared_with_where_the_producer_does_not_say() =>
        AssertModel(Body(Net(Def(1, Consumed("ADD", new[] { In(L("a")), In(L("b")) }), "INT"), Set(Consumed("GT", new[] { In(Ref(1)), In(L("c")) }), Coil("o")))),
            Read(Src("VAR_TEMP g1 : INT; END_VAR", "g1 := ADD(a, b);", "o := (g1 > c);")));

    // ── the header and its comment ──────────────────────────────────────────────────────────────

    /// <summary>Spec, "a variable named like a header field".</summary>
    [Fact]
    public void A_statement_after_the_header_line_is_a_statement()
    {
        var body = Read(FbdMarker + "NETWORK\n  DISABLED := x;\nEND_NETWORK\n");
        AssertModel(Body(Set(L("x"), Coil("DISABLED"))), body);
        Assert.False(body.Networks[0].Disabled);
    }

    /// <summary>Spec, "a multi-line comment keeps its shape"; page: a blank line between // lines is layout.</summary>
    [Fact]
    public void A_multi_line_comment_reads_back_line_for_line()
    {
        var body = Read(FbdMarker + "NETWORK\n  // step:\n  //\n\n  //     indented\n  // // quoted\n  out := a;\nEND_NETWORK\n");
        Assert.Equal("step:\n\n    indented\n// quoted", body.Networks[0].Comment);
    }

    [Fact]
    public void The_header_fields_and_the_title_escapes()
    {
        var body = Read(FbdMarker + "NETWORK LABEL: Done TITLE: \"Tray $\"A$\" line 1$Nline 2 costs $$5\" DISABLED\n  ;\nEND_NETWORK\n");
        var n = body.Networks[0];
        Assert.Equal(("Done", "Tray \"A\" line 1\nline 2 costs $5", true), (n.Label, n.Title, n.Disabled));
    }

    // ── labels, jumps, returns ──────────────────────────────────────────────────────────────────

    /// <summary>Page, "LABEL, JMP and RETURN": the vendor's own shapes — unconditional is an empty Terminator
    /// (census 1.2, DIALECT C11), the bit rides on the target and the item (C13), a return's target is ???.</summary>
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
            Read(FbdMarker + "NETWORK\n  JMP Done;\nEND_NETWORK\nNETWORK\n  IF a THEN RETURN; END_IF;\nEND_NETWORK\nNETWORK\n  RETURN;\nEND_NETWORK\n"));
    }

    // ── EN, ENO and output slots ────────────────────────────────────────────────────────────────

    /// <summary>Spec, "an enabled box drives a lamp".</summary>
    [Fact]
    public void An_enabled_box_consumed_by_its_ENO() =>
        AssertModel(Body(Set(Call("MOVE", new[] { In(L("0")) }, new[] { Out("Status", 1) }, en: L("c"), main: null, connected: 0), Coil("lamp"))),
            Read(Src("lamp := MOVE(EN := c, 0, => Status).ENO;")));

    /// <summary>Spec, "a consumed box without EN keeps its main output for its consumer".</summary>
    [Fact]
    public void A_consumed_box_without_EN_reads_its_positional_pin_on_slot_1() =>
        AssertModel(Body(Set(Consumed("f", new[] { In(L("src")) }, new[] { Out("err", 1) }), Coil("out"))),
            Read(Src("out := f(src, => err);")));

    /// <summary>Spec, "an operator box in call form".</summary>
    /// <summary>Found by the model oracle on the Lenze corpus (<c>identPolePosition_FeedforwardWrapper(execute :=
    /// …)</c>): a pin is named by the <c>:=</c> / <c>=&gt;</c> after it, so a formal spelled like a construct of
    /// the text is a pin name and never opens the construct.</summary>
    [Fact]
    public void A_pin_named_like_a_construct_of_the_text_is_a_pin() =>
        AssertModel(Body(Top("f", new[] { In(L("a"), "execute"), In(L("b"), "parallel") }, new[] { Out("x", null, "not") })),
            Read(Src("f(execute := a, parallel := b, not => x);")));

    [Fact]
    public void An_operator_box_in_call_form_has_its_BoxType_as_head() =>
        AssertModel(Body(Call("AND", new[] { In(L("a")), In(L("b")) }, new[] { Out("out", 1) }, en: L("go"), main: null, kind: CallKind.Operator)),
            Read(Src("AND(EN := go, a, b, => out);")));

    /// <summary>Spec, "a consumed Execute box without EN".</summary>
    [Fact]
    public void A_consumed_execute_box_without_EN() =>
        AssertModel(Body(Set(Exec("x := 1;", connected: 0), Coil("out"))),
            Read(FbdMarker + "NETWORK\n  out := EXECUTE\nx := 1;\n  END_EXECUTE.ENO;\nEND_NETWORK\n"));

    [Fact]
    public void A_bare_arrow_passes_an_output_slot_over() =>
        AssertModel(Body(Set(Consumed("f", new[] { In(L("src")) }, new[] { Out("b", 2) }), Coil("out"))),
            Read(Src("out := f(src, =>, => b);")));

    [Fact]
    public void An_FB_head_is_the_instance_the_scope_declares_and_its_type_comes_from_there()
    {
        var scope = new NextNetworkScope(Array.Empty<string>(), Array.Empty<string>(), new Dictionary<string, string> { ["t1"] = "TON" });
        AssertModel(Body(Fb("t1", new[] { In(L("a"), "IN"), In(L("pt"), "PT") }, new[] { Out("el", null, "ET") }, "TON")),
            Read(Src("t1(IN := a, PT := pt, ET => el);"), scope));
        // The same text with no instance declared is a function call named t1 — the text alone cannot tell.
        AssertModel(Body(Top("t1", new[] { In(L("a"), "IN"), In(L("pt"), "PT") }, new[] { Out("el", null, "ET") })),
            Read(Src("t1(IN := a, PT := pt, ET => el);")));
    }

    // ── parentheses, NOT and edges ──────────────────────────────────────────────────────────────

    /// <summary>Spec, "the NOT box and the modifier" and "spacing does not change the box".</summary>
    [Fact]
    public void Parentheses_decide_the_NOT_box_and_spacing_does_not()
    {
        var notBox = ConsumedBitOp("NOT", new[] { In(L("a")) });
        var body = Read(Src("o1 := NOT(a);", "o2 := NOT a;", "o3 := NOT (a AND b);", "o4 := NOT((a AND b));", "o5 := NOT (a);"));
        AssertModel(Body(Net(
            Set(notBox, Coil("o1")),
            Set(L("a", Neg), Coil("o2")),
            Set(Op("AND", L("a"), L("b")) with { Flags = Neg }, Coil("o3")),
            Set(ConsumedBitOp("NOT", new[] { In(Op("AND", L("a"), L("b"))) }), Coil("o4")),
            Set(notBox, Coil("o5")))), body);
    }

    /// <summary>Spec, "an edge on EN" and "negation with an edge".</summary>
    [Fact]
    public void Edges_are_flags_on_their_operand_never_a_box()
    {
        AssertModel(Body(Top("MOVE", new[] { In(L("1")) }, new[] { Out("nMode", 1) }, en: L("bStart", Rise))),
            Read(Src("MOVE(EN := R_EDGE(bStart), 1, => nMode);")));
        AssertModel(Body(Set(L("x", Neg with { Falling = true }), Coil("out"))), Read(Src("out := NOT F_EDGE(x);")));
        AssertModel(Body(Set(Op("AND", L("a"), L("b")) with { Flags = Rise }, Coil("lamp"))), Read(Src("lamp := R_EDGE((a AND b));")));
    }

    // ── empty slots, PARALLEL, EXECUTE, backticks ───────────────────────────────────────────────

    /// <summary>Spec, "zero inputs versus one unwired input".</summary>
    [Fact]
    public void An_empty_argument_list_is_no_input_slot_and_a_named_empty_pin_is_one()
    {
        AssertModel(Body(Top("MOVE", Array.Empty<Input>())), Read(Src("MOVE();")));
        AssertModel(Body(Top("MOVE", new[] { In(Empty, "IN") })), Read(Src("MOVE(IN := );")));
    }

    /// <summary>Spec, "a result pin is not an assign".</summary>
    [Fact]
    public void A_result_pin_and_an_assign_over_the_box_are_different_items()
    {
        AssertModel(Body(Top("MOVE", new[] { In(L("src")) }, new[] { Out("dst", 0) })), Read(Src("MOVE(src, => dst);")));
        AssertModel(Body(Set(Consumed("MOVE", new[] { In(L("src")) }), Coil("dst"))), Read(Src("dst := MOVE(src);")));
    }

    /// <summary>Spec, "a Parallel is not rebuilt as AND/OR" and "an unwired Parallel feed".</summary>
    [Fact]
    public void PARALLEL_is_a_Parallel_fed_unfed_or_wired_to_nothing()
    {
        AssertModel(Body(Net(Def(54, L("TRUE"), "BOOL"), Set(new Parallel(Ref(54), new Node[] { L("a"), L("b") }, Flags.None), Coil("out")))),
            Read(Src("VAR_TEMP g54 : BOOL; END_VAR", "g54 := TRUE;", "out := PARALLEL(IN := g54, a, b);")));
        AssertModel(Body(Set(new Parallel(Empty, new Node[] { L("a"), L("b") }, Flags.None), Coil("out"))),
            Read(Src("out := PARALLEL(IN := , a, b);")));
        AssertModel(Body(Set(new Parallel(null, new Node[] { L("a"), L("b") }, Flags.None), Coil("out"))),
            Read(Src("out := PARALLEL(a, b);")));
        AssertModel(Body(Set(new Parallel(L("f"), new Node[] { L("a"), L("b") }, Flags.None, ParallelMode.Sequential), Coil("out"))),
            Read(Src("out := PARALLEL(MODE := Sequential, IN := f, a, b);")));
    }

    /// <summary>Spec, "an empty Execute box" and "a snippet line starting with Network".</summary>
    [Fact]
    public void EXECUTE_bodies_are_verbatim_lines()
    {
        AssertModel(Body(Exec("", L("bRun"))), Read(FbdMarker + "NETWORK\n  EXECUTE(EN := bRun)\n\n  END_EXECUTE;\nEND_NETWORK\n"));
        var text = FbdMarker + "NETWORK\n  EXECUTE\nNetworkState := 1;\n  END_EXECUTE;\nEND_NETWORK\n";
        AssertModel(Body(Exec("NetworkState := 1;")), Read(text));
        Assert.True(NextNetworkTextGate.Validate(text, BodyLanguage.Fbd, NextNetworkScope.Empty).Ok);
    }

    /// <summary>Spec, "a typed call stays one operand".</summary>
    [Fact]
    public void Backticked_text_is_one_operand_never_parsed()
    {
        var scope = new NextNetworkScope(Array.Empty<string>(), Array.Empty<string>(), new Dictionary<string, string> { ["fb"] = "FB" });
        AssertModel(Body(Fb("fb", new[] { In(L("fc_dinttotime(T.Start,2)"), "P") })),
            Read(Src("fb(P := `fc_dinttotime(T.Start,2)`);"), scope));
        AssertModel(Body(Set(L("x"), Coil("arr[i + 1]"))), Read(Src("`arr[i + 1]` := x;")));
    }

    [Fact]
    public void A_ladder_body_reads_with_its_marker() =>
        AssertModel(Body(Net(Def(1, L("x"), "BOOL"), Set(Ref(1), Coil("o"))), BodyLanguage.Ld),
            Read(LdMarker + "NETWORK\n  VAR_TEMP g1 : BOOL; END_VAR\n  g1 := x;\n  o := g1;\nEND_NETWORK\n", BodyLanguage.Ld));

    // ── diagnostics are findings, not exceptions ────────────────────────────────────────────────

    [Fact]
    public void A_bad_network_does_not_hide_the_next_ones_finding()
    {
        var r = NextNetworkTextReader.Read(
            FbdMarker + "NETWORK\n  out := ((a AND b));\nEND_NETWORK\nNETWORK\n  out := (a & b);\nEND_NETWORK\nNETWORK\n  ok := a;\nEND_NETWORK\n",
            BodyLanguage.Fbd, NextNetworkScope.Empty);
        Assert.Null(r.Body);
        Assert.Equal(new[] { ("NETWORK_BAD_EXPRESSION", 3), ("NETWORK_UNKNOWN_OPERATOR", 6) },
            r.Diagnostics.Select(d => (d.Code, d.Line)).ToArray());
    }
    // ── review 2026-09-26: what the writer writes, the reader reads back unchanged ──────────────

    /// <summary>The written text read back must be the model it was written from, raw — no normalisation.</summary>
    static void RoundTrips(NetworkBody m, NextNetworkScope scope)
    {
        var text = NextNetworkTextWriter.Write(m, scope);
        AssertModel(m, Read(text, scope, m.Language));
        var gate = NextNetworkTextGate.Validate(text, m.Language, scope);
        Assert.True(gate.Ok, string.Join("\n", gate.Diagnostics.Select(x => x.Code + " " + x.Message)) + "\n\n" + text);
    }

    /// <summary>Spec, "parentheses are structural": after an operator word, a pair holding an operator is a group
    /// (the word was the operator after an empty slot), any other pair is the call's argument list — and
    /// whitespace plays no part. The writer's <c>( AND (x OR y))</c> must not read as the call head <c>AND(</c>.</summary>
    [Fact]
    public void An_empty_slot_before_a_group_is_not_a_call_head()
    {
        RoundTrips(Body(Set(Op("AND", Empty, Op("OR", L("x"), L("y"))), Coil("out"))), NextNetworkScope.Empty);
        RoundTrips(Body(Set(Op("AND", L("a"), Empty, Op("OR", L("x"), L("y"))), Coil("out"))), NextNetworkScope.Empty);
        AssertModel(Body(Set(Op("AND", Empty, Op("OR", L("x"), L("y"))), Coil("out"))), Read(Src("out := (AND(x OR y));")));
        // A pair holding no operator at its own depth is still the call's: a group nested inside it does not count.
        AssertModel(Body(Set(ConsumedBitOp("NOT", new[] { In(ConsumedBitOp("AND", new[] { In(Op("OR", L("x"), L("y"))) })) }), Coil("out"))),
            Read(Src("out := NOT(AND((x OR y)));")));
    }

    /// <summary>A JMP takes one label, and after <c>JMP</c> a word can be nothing else — so a label spelled like a
    /// word of the text (a legal IEC label the header already accepts) is read as the label.</summary>
    [Theory]
    [InlineData("Execute")]
    [InlineData("Parallel")]
    [InlineData("Network")]
    [InlineData("Let")]
    [InlineData("END_IF")]
    public void A_jump_label_spelled_like_a_word_of_the_text_round_trips(string label) =>
        RoundTrips(new NetworkBody(BodyLanguage.Ld, new[]
        {
            Net(new Assign(L("x"), new[] { Coil(label, JumpBit) }, JumpBit)),
            new Network(1, null, label, null, false, new Node[] { Set(L("a"), Coil("out")) }),
            Net(new Assign(Empty, new[] { Coil(label, JumpBit) }, JumpBit)) with { Order = 2 },
        }), NextNetworkScope.Empty);

    [Fact]
    public void An_operand_named_LET_round_trips()
    {
        RoundTrips(Body(Set(L("a"), Coil("Let"))), NextNetworkScope.Empty);
        RoundTrips(Body(L("let")), NextNetworkScope.Empty);
    }

    /// <summary>A box type spelled like a word of the text is a backticked head, and reads back as that type.</summary>
    [Fact]
    public void A_box_type_spelled_like_a_word_of_the_text_round_trips()
    {
        RoundTrips(Body(Top("Network", new[] { In(L("x")) }, new[] { Out("y", 0) })), NextNetworkScope.Empty);
        RoundTrips(Body(Set(Consumed("JMP", new[] { In(L("x")) }), Coil("out"))), NextNetworkScope.Empty);
        RoundTrips(Body(Top("EXECUTE", new[] { In(L("x")) })), NextNetworkScope.Empty);
    }

    /// <summary>An operator type in another case keeps its spelling through call form.</summary>
    [Fact]
    public void An_operator_type_in_another_case_round_trips() =>
        RoundTrips(Body(Set(Call("and", new[] { In(L("a")), In(L("b")) }, main: null, kind: CallKind.Operator), Coil("o"))), NextNetworkScope.Empty);

    /// <summary>A wire fed by a bit operator is BOOL or another bit-string type — whichever the text declares.</summary>
    [Fact]
    public void A_bit_operator_wire_reads_the_bit_string_type_it_is_declared_with() =>
        AssertModel(Body(Net(Def(5, Op("AND", L("w1"), L("w2")), "WORD"), Set(Ref(5), Coil("o1")), Set(Ref(5), Coil("o2")))),
            Read(Src("VAR_TEMP g5 : WORD; END_VAR", "g5 := (w1 AND w2);", "o1 := g5;", "o2 := g5;")));

    /// <summary>Task 1.17: in ladder a leaf is boolean only where every use is — a leaf feeding a MOVE's data pin
    /// is a data value, and the engineer's own declared type for it is accepted, never overruled as BOOL.</summary>
    [Fact]
    public void A_ladder_leaf_wire_feeding_a_data_pin_takes_its_declared_type() =>
        AssertModel(Body(Net(Def(1, L("nSpeed"), "INT"), Top("MOVE", new[] { In(Ref(1)) }, new[] { Out("nOut", 0) })), BodyLanguage.Ld),
            Read(LdMarker + "NETWORK\n  VAR_TEMP g1 : INT; END_VAR\n  g1 := nSpeed;\n  MOVE(g1, => nOut);\nEND_NETWORK\n", BodyLanguage.Ld));

    /// <summary>An EXECUTE snippet's trailing newlines are its own content.</summary>
    [Fact]
    public void An_EXECUTE_snippet_with_trailing_newlines_round_trips()
    {
        RoundTrips(Body(Exec("x := 1;\n")), NextNetworkScope.Empty);
        RoundTrips(Body(Exec("\n")), NextNetworkScope.Empty);
        RoundTrips(Body(Exec("")), NextNetworkScope.Empty);
    }

    /// <summary>Spec, "pull-side loss is caught": ≅ compares the output slots and the connection slot as stored.
    /// A box whose main output is slot 1 and one whose main output is slot 0 print the same text; they must not
    /// compare equal, or a push would wire <c>err</c> to the result slot while the oracle stayed green.</summary>
    [Fact]
    public void The_oracle_sees_an_output_moved_to_another_slot()
    {
        var one = Body(Set(Call("f", new[] { In(L("src")) }, new[] { Out("err", 0) }, main: 1, connected: 1), Coil("out")));
        var zero = Body(Set(Call("f", new[] { In(L("src")) }, new[] { Out("err", 1) }, main: 0, connected: 0), Coil("out")));
        Assert.NotNull(NetworkModelEquality.FirstDifference(NextNetworkTextFacts.Carried(one), NextNetworkTextFacts.Carried(zero)));
    }

    /// <summary>The oracle's ≅ holds no equivalence the spec does not state: a snippet's trailing newline and an
    /// unconditional jump's null value (census 1.2: never the vendor's) are differences.</summary>
    [Fact]
    public void The_oracle_sees_a_trailing_newline_and_a_null_jump_value()
    {
        Assert.NotNull(NetworkModelEquality.FirstDifference(
            NextNetworkTextFacts.Carried(Body(Exec("x := 1;\n"))), NextNetworkTextFacts.Carried(Body(Exec("x := 1;")))));
        Assert.NotNull(NetworkModelEquality.FirstDifference(
            NextNetworkTextFacts.Carried(Body(new Assign(null, new[] { Coil("Done", JumpBit) }, JumpBit))),
            NextNetworkTextFacts.Carried(Body(new Assign(Empty, new[] { Coil("Done", JumpBit) }, JumpBit)))));
    }

    /// <summary>Census 1.12: the oracle's scope holds only what a declaration can name. <c>SUPER^</c> is no
    /// declared instance, so the body is refused by name — the check the push path runs, not one the oracle
    /// makes pass by declaring every instance text it finds.</summary>
    [Fact]
    public void The_oracle_does_not_declare_an_instance_no_declaration_names()
    {
        var super = Body(Call("ATD_Base", new[] { In(L("ioAxis"), "ioAxis") }, main: null,
            instance: new Operand("SUPER^", IsInstance: true), kind: CallKind.FunctionBlock));
        Assert.Equal("an FB instance the declarations do not name", NextModelOracle.Check("SUPER^", super).Reason);
    }
}
