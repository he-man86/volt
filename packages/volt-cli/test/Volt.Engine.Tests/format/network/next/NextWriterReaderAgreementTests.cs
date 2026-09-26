using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.Network.Next;
using static Volt.Engine.Tests.NextModels;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Engine.Tests;

/// <summary>
/// Network text v2, the writer and the reader agreeing on ONE rule (review 2026-09-26, second pass). Every case
/// here was a model the writer spelled into text its own reader refused, text the reader read as a different
/// model than the one written, or a push the gate accepted as another box. Each is pinned in the form the spec
/// asks for: the writer refuses by name (the pull's marker) and the gate refuses by name, or the model survives
/// <c>Read(Write(m))</c> through <see cref="NextModelOracle"/>.
/// </summary>
public class NextWriterReaderAgreementTests
{
    const string Fbd = "(* @volt-implementation FBD *)\n";

    static string Src(params string[] lines) =>
        Fbd + "NETWORK\n" + string.Concat(lines.Select(l => "  " + l + "\n")) + "END_NETWORK\n";

    static string Written(NetworkBody m, NextNetworkScope scope) => NextNetworkTextWriter.Write(m, scope);

    static string RefusedBy(NetworkBody m, NextNetworkScope scope) =>
        Assert.ThrowsAny<UnrepresentableBodyException>(() => NextNetworkTextWriter.Write(m, scope)).Marker;

    static NextNetworkTextDiagnostic GateRefuses(string code, string text, NextNetworkScope scope)
    {
        var r = NextNetworkTextGate.Validate(text, BodyLanguage.Fbd, scope);
        Assert.False(r.Ok, "the gate accepted:\n" + text);
        var d = Assert.Single(r.Diagnostics);
        Assert.True(code == d.Code, $"expected {code}, got {d.Code}: {d.Message}");
        return d;
    }

    static NetworkBody ReadOk(string text, NextNetworkScope scope)
    {
        var r = NextNetworkTextReader.Read(text, BodyLanguage.Fbd, scope);
        Assert.True(r.Ok, string.Join("\n", r.Diagnostics.Select(d => $"{d.Line}:{d.Column} {d.Code} {d.Message}")));
        return r.Body!;
    }

    static NextNetworkScope Scope(string[] names, string[]? pous = null, Dictionary<string, string>? instances = null) =>
        new(names, pous ?? Array.Empty<string>(), instances ?? new Dictionary<string, string>());

    /// <summary>A comparison or arithmetic box as the vendor stores it when a consumer takes its result: main output
    /// 0 and connected by it (census 1.6: MainOutputIndex 0 on 456 boxes).</summary>
    static Box Stored(string type, params Node[] inputs) =>
        Call(type, inputs.Select(i => In(i)), connected: 0);

    // ── infix and the slot rule (spec, "infix treats absent and default formals as one"; "EN is a pin …") ─────

    /// <summary>A comparison or arithmetic box consumed by its main output is written infix, as the spec's rule
    /// says — its stored slot 0 is what the group reads back, not a reason for call form.</summary>
    [Fact]
    public void A_consumed_comparison_or_arithmetic_box_the_vendor_stores_is_written_infix()
    {
        Assert.Equal(Src("o := (a > b);"), Written(Body(Set(Stored("GT", L("a"), L("b")), T("o"))), NextNetworkScope.Empty));
        Assert.Equal(Src("out := (a + b);"), Written(Body(Set(Stored("ADD", L("a"), L("b")), T("out"))), NextNetworkScope.Empty));
        Assert.Null(NextModelOracle.Check("gt", Body(Set(Stored("GT", L("a"), L("b")), T("o")))).Reason);
        Assert.Null(NextModelOracle.Check("add-nested", Body(Set(Stored("GE", Stored("ADD", L("a"), L("b")), L("c")), T("o")))).Reason);
    }

    /// <summary>The group and the call form of one box read to one model: connected by slot 0, main output 0 — the
    /// spec's one rule for every box that is not AND/OR/XOR/NOT.</summary>
    [Fact]
    public void A_group_reads_its_connection_by_the_same_rule_as_the_call()
    {
        var group = ReadOk(Src("o := (a > b);"), NextNetworkScope.Empty);
        var call = ReadOk(Src("o := GT(a, b);"), NextNetworkScope.Empty);
        Assert.Null(NetworkModelEquality.FirstDifference(group, call));
        var gt = (Box)((Assign)group.Networks[0].Trees[0]).Value!;
        Assert.Equal(0, gt.ConnectedSlot);
        Assert.Equal(0, gt.MainOutputIndex);
        // A bit operator stays connected by none, group or call.
        var and = (Box)((Assign)ReadOk(Src("o := (a AND b);"), NextNetworkScope.Empty).Networks[0].Trees[0]).Value!;
        Assert.Null(and.ConnectedSlot);
    }

    /// <summary>Spec: a consumed box whose connection slot was never read goes to the marker — a group is no
    /// exception, or an ADD with no connection slot would be pushed as a shape the vendor never stores.</summary>
    [Fact]
    public void A_consumed_group_with_no_stored_connection_slot_goes_to_the_marker()
    {
        Assert.Equal("a consumed box with no stored connection slot",
            RefusedBy(Body(Set(Op("ADD", L("a"), L("b")), T("out"))), NextNetworkScope.Empty));
        Assert.Equal("a consumed box with no stored connection slot",
            RefusedBy(Body(Set(Op("GT", L("a"), L("b")), T("o"))), NextNetworkScope.Empty));
        // The same refusal a non-operator box in that state gets.
        Assert.Equal("a consumed box with no stored connection slot",
            RefusedBy(Body(Set(Call("SEL", new[] { In(L("g")), In(L("a")), In(L("b")) }, main: null), T("o"))), NextNetworkScope.Empty));
    }

    // ── a wire's type (spec, "a wire's type is read off its producer") ─────────────────────────────

    /// <summary>A stored type the text's own rule contradicts cannot be declared: the reader reads the producer
    /// without the vendor's stored types. Refused by name, never written as text the reader refuses.</summary>
    [Fact]
    public void A_stored_output_type_the_text_reads_otherwise_goes_to_the_marker()
    {
        var and = new Box("AND", null, CallKind.Operator, new[] { In(L("a")), In(L("b")) }, new Output[0], null, null, Flags.None,
            OutputTypes: new string?[] { "DINT" });
        var m = Body(Net(Def(1, and), Set(Ref(1), T("c"))));
        Assert.Equal("a stored output type the text reads otherwise", RefusedBy(m, NextNetworkScope.Empty));
        Assert.Equal("a stored output type the text reads otherwise", NextModelOracle.Check("and-dint", m).Reason);

        var gt = Call("GT", new[] { In(L("a")), In(L("b")) }, connected: 0, types: new string?[] { "INT" });
        Assert.Equal("a stored output type the text reads otherwise",
            RefusedBy(Body(Net(Def(1, gt), Set(Ref(1), T("c")))), NextNetworkScope.Empty));
    }

    /// <summary>A type the VAR_TEMP block cannot hold — one the reader would end, swallow or break — is refused
    /// by name, never written.</summary>
    [Theory]
    [InlineData("INT // x")]
    [InlineData("IN`T")]
    [InlineData("END_VAR")]
    [InlineData("INT; BOOL")]
    [InlineData("STRING \"x\"")]
    public void A_wire_type_the_block_cannot_hold_goes_to_the_marker(string type)
    {
        var m = Body(Net(Def(1, L("a"), type), Set(Ref(1), T("b"))));
        Assert.Equal("a wire of unspellable type", RefusedBy(m, NextNetworkScope.Empty));
    }

    [Fact]
    public void A_structured_wire_type_is_written_and_read_back() =>
        Assert.Null(NextModelOracle.Check("array", Body(Net(Def(1, L("a"), "ARRAY [0..1] OF INT"), Set(Ref(1), T("b"))))).Reason);

    // ── targets (spec, "an opaque operand is backticked in place") ────────────────────────────────

    /// <summary>A literal is a token at operand position and no target: as a coil or an <c>=&gt;</c> target it is
    /// backticked, and reads back as the same target text.</summary>
    [Fact]
    public void A_literal_target_is_backticked()
    {
        Assert.Equal(Src("`5` := a;"), Written(Body(Set(L("a"), T("5"))), NextNetworkScope.Empty));
        Assert.Equal(Src("`16#FF` := a;"), Written(Body(Set(L("a"), T("16#FF"))), NextNetworkScope.Empty));
        Assert.Equal(Src("F(a, => `T#1s`);"), Written(Body(Call("F", new[] { In(L("a")) }, new[] { Out("T#1s", 0) })), NextNetworkScope.Empty));
        Assert.Equal(Src("%QX0.1 := a;"), Written(Body(Set(L("a"), T("%QX0.1"))), NextNetworkScope.Empty));
        Assert.Null(NextModelOracle.Check("5", Body(Set(L("a"), T("5")))).Reason);
        Assert.Null(NextModelOracle.Check("16#FF", Body(Set(L("a"), T("16#FF")))).Reason);
        Assert.Null(NextModelOracle.Check("T#1s", Body(Call("F", new[] { In(L("a")) }, new[] { Out("T#1s", 0) }))).Reason);
    }

    // ── call heads and instances ────────────────────────────────────────────────────────────────

    /// <summary>A FUNCTION box named like an FB instance in scope would read back as that instance's call, with the
    /// instance's FB type — two models, one text. Refused by name.</summary>
    [Fact]
    public void A_function_named_like_an_instance_in_scope_goes_to_the_marker()
    {
        var m = Body(Net(Fb("t1", new[] { In(L("a"), "IN") }, type: "TON"), Call("t1", new[] { In(L("b")) })));
        Assert.Equal("a function named like an FB instance in scope", RefusedBy(m, ScopeOf(m)));
        Assert.Equal("a function named like an FB instance in scope", NextModelOracle.Check("t1", m).Reason);
    }

    /// <summary>The call head has no position for a flag on the instance operand; the oracle compares it, and the
    /// writer refuses it rather than drop it.</summary>
    [Fact]
    public void A_flag_on_an_FB_instance_goes_to_the_marker()
    {
        var m = Body(Call("TON", new[] { In(L("a"), "IN") }, main: null, kind: CallKind.FunctionBlock,
            instance: new Operand("t1", IsInstance: true, Flags: Neg)));
        Assert.Equal("a flag on an FB instance", RefusedBy(m, ScopeOf(m)));
        Assert.Equal("a flag on an FB instance", NextModelOracle.Check("t1-neg", m).Reason);
        var plain = Body(Call("TON", new[] { In(L("a"), "IN") }, main: null, kind: CallKind.FunctionBlock,
            instance: new Operand("t1", IsInstance: true)));
        Assert.NotNull(NetworkModelEquality.FirstDifference(NextNetworkTextFacts.Carried(m), NextNetworkTextFacts.Carried(plain)));
    }

    /// <summary>Task 1.12 against a REAL declaration: a scope names <c>fbs</c>, never <c>fbs[1]</c>. The pull
    /// refuses the instance by name; the push refuses the backticked head instead of building a function named
    /// <c>fbs[1]</c> in place of the instance call; and a scope cannot be keyed by an expression at all.</summary>
    [Fact]
    public void An_FB_instance_whose_text_is_an_expression_is_refused_on_pull_and_push()
    {
        var scope = Scope(new[] { "fbs", "a" });
        var m = Body(Call("TON", new[] { In(L("a"), "IN") }, main: null, kind: CallKind.FunctionBlock,
            instance: new Operand("fbs[1]", IsInstance: true)));
        Assert.Equal("an FB instance the declarations do not name", RefusedBy(m, scope));

        var d = GateRefuses("NETWORK_UNSUPPORTED", Src("`fbs[1]`(IN := a);"), scope);
        Assert.Contains("fbs[1]", d.Message);
        GateRefuses("NETWORK_UNSUPPORTED", Src("`SUPER^`(ioAxis := a);"), scope);

        Assert.Throws<ArgumentException>(() => new NextNetworkScope(Array.Empty<string>(), Array.Empty<string>(),
            new Dictionary<string, string> { ["fbs[1]"] = "TON" }));
    }

    /// <summary>A function is a POU and has a name; a box type that is none has no call head the reader reads.</summary>
    [Fact]
    public void A_function_box_type_that_is_no_name_goes_to_the_marker() =>
        Assert.Equal("a box type that is no POU name", RefusedBy(Body(Call("fbs[1]", new[] { In(L("a")) })), NextNetworkScope.Empty));

    /// <summary>The text writes the keyword EXECUTE and reads every Execute box back as that type.</summary>
    [Theory]
    [InlineData("execute")]
    [InlineData("ST")]
    public void An_Execute_box_of_another_type_goes_to_the_marker(string type)
    {
        var m = Body(new Box(type, null, CallKind.Function, new List<Input>(), new List<Output>(), null, "x := 1;", Flags.None));
        Assert.Equal("an Execute box of another type", RefusedBy(m, NextNetworkScope.Empty));
    }

    /// <summary><c>EN =&gt;</c> is refused by the reader; the writer refuses an output pin named EN by name.</summary>
    [Fact]
    public void An_output_pin_named_EN_goes_to_the_marker() =>
        Assert.Equal("an output pin named EN",
            RefusedBy(Body(Call("F", new[] { In(L("a")) }, new[] { Out("x", null, "EN") })), NextNetworkScope.Empty));

    /// <summary>Spec: an unmeasured <c>Parallel.Mode</c> is refused — by the writer too, never written as its
    /// number.</summary>
    [Fact]
    public void An_unmeasured_Parallel_mode_goes_to_the_marker() =>
        Assert.Equal("an unmeasured Parallel mode",
            RefusedBy(Body(Set(new Parallel(null, new Node[] { L("a"), L("b") }, (ParallelMode)5), T("o")), BodyLanguage.Ld),
                NextNetworkScope.Empty));

    /// <summary>The empty argument list <c>f()</c> is the only ambiguity a lone unwired slot has: beside an output
    /// pin it is a position of its own.</summary>
    [Fact]
    public void A_lone_unwired_slot_beside_an_output_pin_is_written()
    {
        var m = Body(Call("f", new[] { In(Empty) }, new[] { Out("x", 0) }));
        Assert.Equal(Src("f(, => x);"), Written(m, NextNetworkScope.Empty));
        Assert.Null(NextModelOracle.Check("f(, => x)", m).Reason);
        Assert.True(NextNetworkTextGate.Validate(Src("f(, => x);"), BodyLanguage.Fbd, NextNetworkScope.Empty).Ok);
    }

    // ── construct words (spec, "reserved names are one case-insensitive set") ─────────────────────

    /// <summary>A VARIABLE named like a construct word blocks nothing: it never heads a call, and as an operand it
    /// is backticked. Only a POU or an instance of that name makes the construct mean two things — the one rule
    /// both sides ask.</summary>
    [Fact]
    public void A_variable_named_like_a_construct_does_not_block_the_construct()
    {
        var par = Body(Set(new Parallel(null, new Node[] { L("a"), L("b") }, ParallelMode.BoxShortCircuit), T("out")), BodyLanguage.Ld);
        var names = Scope(new[] { "Parallel", "a", "b", "out" });
        var text = Written(par, names);
        Assert.Equal("(* @volt-implementation LD *)\nNETWORK\n  out := PARALLEL(a, b);\nEND_NETWORK\n", text);
        Assert.True(NextNetworkTextReader.Read(text, BodyLanguage.Ld, names).Ok);

        var edge = Body(Set(L("x", Rise), T("out")));
        var edgeNames = Scope(new[] { "r_edge", "x", "out" });
        Assert.True(NextNetworkTextReader.Read(Written(edge, edgeNames), BodyLanguage.Fbd, edgeNames).Ok);
    }

    /// <summary>A POU or instance of the construct's name: the writer refuses the construct by the reader's own
    /// rule, so a pull never writes text the push refuses.</summary>
    [Fact]
    public void A_POU_or_instance_named_like_a_construct_blocks_it_on_both_sides()
    {
        var par = Body(Set(new Parallel(null, new Node[] { L("a"), L("b") }, ParallelMode.BoxShortCircuit), T("out")), BodyLanguage.Ld);
        Assert.Equal("PARALLEL beside a POU or instance of that name", RefusedBy(par, Scope(new[] { "a" }, pous: new[] { "Parallel" })));

        var edge = Body(Set(L("x", Rise), T("out")));
        Assert.Equal("R_EDGE beside a POU or instance of that name", RefusedBy(edge, Scope(new[] { "x" }, pous: new[] { "r_edge" })));
        Assert.Equal("F_EDGE beside a POU or instance of that name",
            RefusedBy(Body(Set(L("x", Fall), T("out"))), Scope(new[] { "x" }, instances: new() { ["F_Edge"] = "F_TRIG" })));
    }

    // ── review 2026-09-26, third pass ─────────────────────────────────────────────────────────────

    static NextGateResult Gate(string text, BodyLanguage lang, NextNetworkScope scope) =>
        NextNetworkTextGate.Validate(text, lang, scope);

    /// <summary>Spec, "edges are R_EDGE and F_EDGE flags" with "parentheses are structural": inside an edge,
    /// <c>NOT(a)</c> is the NOT BOX (its pair holds no operator), not the negation modifier — so an edge on a NOT
    /// box is spelled and read back, while a modifier inside the edge stays refused.</summary>
    [Fact]
    public void An_edge_on_a_NOT_box_round_trips()
    {
        var m = Body(Set(Call("NOT", new[] { In(L("a")) }, main: null, f: Rise), T("out")));
        Assert.Equal(Src("out := R_EDGE(NOT(a));"), Written(m, NextNetworkScope.Empty));
        Assert.Null(NextModelOracle.Check("rising-not-box", m).Reason);
        Assert.Null(NextModelOracle.Check("negated-falling-not-box",
            Body(Set(Call("NOT", new[] { In(L("a")) }, main: null, f: Neg with { Falling = true }), T("out")))).Reason);
        Assert.Null(NextModelOracle.Check("rising-not-box-around-group",
            Body(Set(Call("NOT", new[] { In(Op("AND", L("a"), L("b"))) }, main: null, f: Rise), T("out")))).Reason);

        // The backticked head reads to the same box and is not canonical — a finding, never an exception.
        var r = Gate(Src("out := R_EDGE(`NOT`(a));"), BodyLanguage.Fbd, NextNetworkScope.Empty);
        Assert.Equal("NETWORK_NOT_CANONICAL", Assert.Single(r.Diagnostics).Code);

        // The negation MODIFIER inside the edge is the vendor's order (DIALECT N17) and reads back as the flag;
        // outside the edge it is the one refusal the spec names.
        Assert.Equal(Src("out := R_EDGE(NOT a);"),
            Written(Body(Set(L("a", Neg with { Rising = true }), T("out"))), NextNetworkScope.Empty));
        Assert.Equal(Src("out := R_EDGE(NOT (a AND b));"),
            Written(Body(Set(Op("AND", L("a"), L("b")) with { Flags = Neg with { Rising = true } }, T("out"))), NextNetworkScope.Empty));
        GateRefuses("NETWORK_BAD_EXPRESSION", Src("out := NOT R_EDGE(a);"), NextNetworkScope.Empty);
    }

    /// <summary>Spec, "parentheses are structural": a call head is not an infix operator, so an operator-word call
    /// inside another operator-word call's argument list leaves the outer pair an argument list.</summary>
    [Fact]
    public void An_operator_word_call_inside_an_operator_word_call_round_trips()
    {
        var and = Body(Call("and", new[] { In(Call("or", new[] { In(L("a")), In(L("b")) }, main: null)), In(L("c")) }, main: null));
        Assert.Equal(Src("and(or(a, b), c);"), Written(and, NextNetworkScope.Empty));
        Assert.Null(NextModelOracle.Check("and(or)", and).Reason);

        var enabled = Body(Call("AND", new[] { In(Call("xor", new[] { In(L("a")), In(L("b")) }, main: null)), In(L("c")) },
            new[] { Out("out", 1) }, en: L("go"), main: null));
        Assert.Equal(Src("AND(EN := go, xor(a, b), c, => out);"), Written(enabled, NextNetworkScope.Empty));
        Assert.Null(NextModelOracle.Check("AND(EN, xor)", enabled).Reason);

        var enoChain = Body(Set(Call("AND", new[]
        {
            In(Call("XOR", new[] { In(L("a")), In(L("b")) }, en: L("c"), main: null, connected: 0)), In(L("d")),
        }, en: L("go"), main: null, connected: 0), T("out")));
        Assert.Equal(Src("out := AND(EN := go, XOR(EN := c, a, b).ENO, d).ENO;"), Written(enoChain, NextNetworkScope.Empty));
        Assert.Null(NextModelOracle.Check("AND(EN, XOR.ENO).ENO", enoChain).Reason);

        Assert.Null(NextModelOracle.Check("R_EDGE(AND(EN := MOD.ENO))", Body(Set(Call("AND", new[] { In(L("a")), In(L("b")) },
            en: Call("MOD", new[] { In(L("a")), In(L("b")) }, en: L("c"), connected: 0), main: null, connected: 0, f: Rise), T("out")))).Reason);
        Assert.Null(NextModelOracle.Check("OR-group over XOR.ENO", Body(Set(Op("OR", L("a"),
            Call("XOR", new[] { In(Call("AND", new[] { In(L("a")), In(L("b")) }, en: L("d"), main: null, connected: 0)), In(L("b")) },
                en: L("c"), main: null, connected: 0)), T("out")))).Reason);

        var r = Gate(Src("and(`or`(a, b), c);"), BodyLanguage.Fbd, NextNetworkScope.Empty);
        Assert.Equal("NETWORK_NOT_CANONICAL", Assert.Single(r.Diagnostics).Code);
    }

    /// <summary>A digit or letter outside ASCII is no character of a bare token: the lexer makes progress past it
    /// and the gate refuses it, instead of spinning in recovery on a token that consumed nothing.</summary>
    [Theory]
    [InlineData("out := ٣;")]
    [InlineData("out := 1٣;")]
    [InlineData("out := １;")]
    [InlineData("out := aä;")]
    public void A_non_ASCII_digit_or_letter_is_refused_not_spun_on(string statement)
    {
        var task = System.Threading.Tasks.Task.Run(() =>
            NextNetworkTextGate.Validate(Src(statement), BodyLanguage.Fbd, Scope(new[] { "out", "a" })));
        Assert.True(task.Wait(TimeSpan.FromSeconds(10)), "the gate did not return");
        Assert.False(task.Result.Ok);
        Assert.Equal("NETWORK_PARSE", task.Result.Diagnostics[0].Code);
    }

    /// <summary>A text the writer leaves bare is exactly one token of the lexer, and a text it backticks is not —
    /// one set of spellings (NextSpelling) on both sides.</summary>
    [Theory]
    [InlineData("a")] [InlineData("a.b.c")] [InlineData("12")] [InlineData("1_000.5e-3")] [InlineData("T#1S")]
    [InlineData("16#FF")] [InlineData("%IX0.1")] [InlineData("%QW12")] [InlineData("???")]
    [InlineData("٣")] [InlineData("aä")] [InlineData("1a")] [InlineData("%IX")] [InlineData("1.")]
    public void A_bare_token_is_one_token_of_the_lexer(string text)
    {
        var lx = new NextLexer(text, 0);
        var first = lx.Next();
        var one = first.Kind != TokKind.Sym && first.Kind != TokKind.Error && first.Text == text && lx.Next().Kind == TokKind.Eof;
        Assert.Equal(NextSpelling.IsToken(text), one);
    }

    /// <summary>A Parallel whose lone branch is unconnected would be <c>PARALLEL()</c>, which is a Parallel with
    /// no branch: refused by name on pull, and the push spelling that reads to it is refused by name too.</summary>
    [Fact]
    public void A_Parallel_with_a_lone_unconnected_branch_goes_to_the_marker()
    {
        var m = Body(new Parallel(null, new Node[] { Empty }, ParallelMode.BoxShortCircuit), BodyLanguage.Ld);
        Assert.Equal("a lone unconnected Parallel branch", RefusedBy(m, NextNetworkScope.Empty));
        var r = Gate("(* @volt-implementation LD *)\nNETWORK\n  PARALLEL(MODE := BoxShortCircuit, );\nEND_NETWORK\n",
            BodyLanguage.Ld, NextNetworkScope.Empty);
        Assert.Equal("NETWORK_UNSUPPORTED", Assert.Single(r.Diagnostics).Code);
        // Beside a feed or a mode the empty branch is a position of its own.
        Assert.Null(NextModelOracle.Check("fed", Body(new Parallel(L("f"), new Node[] { Empty }, ParallelMode.BoxShortCircuit), BodyLanguage.Ld)).Reason);
        Assert.Null(NextModelOracle.Check("sequential",
            Body(new Parallel(null, new Node[] { Empty }, ParallelMode.Sequential), BodyLanguage.Ld)).Reason);
    }

    /// <summary>Spec, "one statement per NWL network item": the empty item right after the wire block is its own
    /// statement — <c>END_VAR</c> takes no <c>;</c> of its own that could swallow it.</summary>
    [Fact]
    public void The_empty_item_after_the_wire_block_is_not_swallowed()
    {
        Assert.Null(NextModelOracle.Check("empty-before-wire", Body(Net(Empty, Def(3, L("TRUE")), Set(Ref(3), T("out"))))).Reason);
        Assert.Null(NextModelOracle.Check("two-empty-before-wire",
            Body(Net(Empty, Empty, Def(3, L("TRUE")), Set(Ref(3), T("out"))))).Reason);

        // `END_VAR;` is END_VAR and the empty statement: the same tokens as the canonical form's own line.
        var read = ReadOk(Src("VAR_TEMP g3 : BOOL; END_VAR;", "g3 := TRUE;", "out := g3;"), Scope(new[] { "out" }));
        Assert.Equal(3, read.Networks[0].Trees.Count);
        Assert.IsType<Terminator>(read.Networks[0].Trees[0]);
    }

    /// <summary>A wire spelled as another name is reported where it is spelled, so a later error in the same
    /// network does not hide it.</summary>
    [Fact]
    public void A_wire_name_collision_is_reported_beside_a_later_error()
    {
        var r = NextNetworkTextReader.Read(Src("VAR_TEMP g1 : BOOL; END_VAR", "g1 := a;", "`g1 + 1` := g1;", "out := ((b));"),
            BodyLanguage.Fbd, NextNetworkScope.Empty);
        Assert.Contains(r.Diagnostics, d => d.Code == "NETWORK_DUPLICATE_NAME" && d.Line == 5);
        Assert.Contains(r.Diagnostics, d => d.Code == "NETWORK_BAD_EXPRESSION" && d.Line == 6);
    }

    /// <summary>The reader and the writer refuse the same Parallel modes: whatever member the enum gains, the one
    /// rule (<see cref="NextSpelling.IsMeasuredMode"/>) decides both.</summary>
    [Fact]
    public void Every_Parallel_mode_is_measured_or_refused_by_both_sides()
    {
        foreach (ParallelMode mode in Enum.GetValues(typeof(ParallelMode)))
        {
            var text = "(* @volt-implementation LD *)\nNETWORK\n  out := PARALLEL(MODE := " + mode + ", a, b);\nEND_NETWORK\n";
            Assert.Equal(NextSpelling.IsMeasuredMode(mode), NextNetworkTextReader.Read(text, BodyLanguage.Ld, NextNetworkScope.Empty).Ok);
        }
    }

    /// <summary>A box literally named like a construct and a construct used beside a POU of its name are two
    /// facts, and the marker names each apart.</summary>
    [Fact]
    public void A_box_named_like_a_construct_and_a_construct_beside_a_POU_are_named_apart()
    {
        var box = RefusedBy(Body(Call("Parallel", new[] { In(L("a")) })), NextNetworkScope.Empty);
        var beside = RefusedBy(Body(Set(new Parallel(null, new Node[] { L("a"), L("b") }, ParallelMode.BoxShortCircuit), T("o")), BodyLanguage.Ld),
            Scope(new[] { "a" }, pous: new[] { "Parallel" }));
        Assert.NotEqual(box, beside);
    }
}
