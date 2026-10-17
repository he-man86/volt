using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using static Volt.Engine.Tests.NetworkModels;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Engine.Tests;

/// <summary>
/// The writer and the reader agreeing on ONE rule. Every case here was once a model the writer spelled into text its own
/// reader refused, text the reader read as a different model than the one written, or a push the gate accepted as
/// another box. Each is pinned as the grammar asks (openspec <c>ld-fbd-coverage</c> 2R.6b, <c>v2-spec.md</c>): the writer refuses by name
/// and the gate refuses by name, or the model survives <c>Read(Write(m))</c> through <see cref="NetworkModelOracle"/>.
/// </summary>
public class WriterReaderAgreementTests
{
    static string Written(NetworkBody m, NetworkScope scope) => NetworkTextWriter.Write(m, scope);

    static string RefusedBy(NetworkBody m, NetworkScope scope) =>
        Assert.ThrowsAny<UnrepresentableBodyException>(() => NetworkTextWriter.Write(m, scope)).Reason;

    static NetworkTextDiagnostic GateRefuses(string code, string text, NetworkScope scope)
    {
        var r = NetworkTextGate.Validate(text, scope);
        Assert.False(r.Ok, "the gate accepted:\n" + text);
        var d = Assert.Single(r.Diagnostics);
        Assert.True(code == d.Code, $"expected {code}, got {d.Code}: {d.Message}");
        return d;
    }

    static NetworkBody ReadOk(string text, NetworkScope scope)
    {
        var r = NetworkTextReader.Read(text, scope);
        Assert.True(r.Ok, string.Join("\n", r.Diagnostics.Select(d => $"{d.Line}:{d.Column} {d.Code} {d.Message}")));
        return r.Body!;
    }

    static NetworkScope Scope(string[] names, string[]? pous = null, Dictionary<string, string>? instances = null) =>
        new(names, pous ?? Array.Empty<string>(), instances ?? new Dictionary<string, string>());

    /// <summary>A comparison or arithmetic box as the vendor stores it when a consumer takes its result: main output 0
    /// and connected by it, which is not an ENO — no EN shown.</summary>
    static Box Stored(string type, params Node[] inputs) =>
        Call(type, inputs.Select(i => In(i)), connected: 0, eno: false);

    // ── box words and the slot rule ─────────────────────────────────────────────────────────────

    /// <summary>B1: a comparison or arithmetic box consumed by its main output is its word — its stored slot 0 is what
    /// the word reads back.</summary>
    [Fact]
    public void A_consumed_comparison_or_arithmetic_box_the_vendor_stores_is_its_word()
    {
        Assert.Equal(Src("o := a GT b;"), Written(Body(Set(Stored("GT", L("a"), L("b")), T("o"))), NetworkScope.Empty));
        Assert.Equal(Src("out := a ADD b;"), Written(Body(Set(Stored("ADD", L("a"), L("b")), T("out"))), NetworkScope.Empty));
        Assert.Null(NetworkModelOracle.Check("gt", Body(Set(Stored("GT", L("a"), L("b")), T("o")))).Reason);
        Assert.Null(NetworkModelOracle.Check("add-nested", Body(Set(Stored("GE", Stored("ADD", L("a"), L("b")), L("c")), T("o")))).Reason);
    }

    /// <summary>A word reads its connection by the call's one rule: slot 0, main output 0 — and the call form it keeps
    /// where the word cannot carry the tree (P10) reads the same; a bit operator is connected by none.</summary>
    [Fact]
    public void A_word_reads_its_connection_by_the_same_rule_as_the_call()
    {
        var gt = (Box)((Assign)ReadOk(Src("o := a GT b;"), NetworkScope.Empty).Networks[0].Trees[0]).Value!;
        Assert.Equal(0, gt.ConnectedSlot);
        var add = (Box)((Assign)ReadOk(Src("o := ADD a;"), NetworkScope.Empty).Networks[0].Trees[0]).Value!;
        Assert.Equal(0, add.ConnectedSlot);
        var call = (Box)((Assign)ReadOk(Src("o := `NOT`(IN := );"), NetworkScope.Empty).Networks[0].Trees[0]).Value!;
        Assert.Null(call.ConnectedSlot);
        var and = (Box)((Assign)ReadOk(Src("o := a AND b;"), NetworkScope.Empty).Networks[0].Trees[0]).Value!;
        Assert.Null(and.ConnectedSlot);
    }

    [Fact]
    public void A_consumed_word_with_no_stored_connection_slot_goes_to_the_marker()
    {
        Assert.Equal("a consumed box with no stored connection slot",
            RefusedBy(Body(Set(Op("ADD", L("a"), L("b")), T("out"))), NetworkScope.Empty));
        Assert.Equal("a consumed box with no stored connection slot",
            RefusedBy(Body(Set(Op("GT", L("a"), L("b")), T("o"))), NetworkScope.Empty));
        Assert.Equal("a consumed box with no stored connection slot",
            RefusedBy(Body(Set(Call("SEL", new[] { In(L("g")), In(L("a")), In(L("b")) }), T("o"))), NetworkScope.Empty));
    }

    // ── a split's type (B6) ─────────────────────────────────────────────────────────────────────

    /// <summary>B6: no type is ever written — a stored feeder type the derivation would not give (a plain AND stored
    /// DINT, a comparison stored INT, N25) is lost on rebuild (B7 L), and the split reads back without one.</summary>
    [Fact]
    public void A_split_writes_no_type_whatever_its_feeder_stores()
    {
        var and = new Box("AND", null, CallKind.Operator, new[] { In(L("a")), In(L("b")) }, new Output[0], null, null, Flags.None,
            OutputTypes: new string?[] { "DINT" });
        var m = Body(Net(Def(1, and), Set(Ref(1), T("c"))));
        Assert.Equal(Src("split1 := a AND b;", "c := split1;"), Written(m, NetworkScope.Empty));
        Assert.Null(NetworkModelOracle.Check("and-dint", m).Reason);

        var gt = Call("GT", new[] { In(L("a")), In(L("b")) }, connected: 0, eno: false, types: new string?[] { "INT" });
        var g = Body(Net(Def(1, gt), Set(Ref(1), T("c"))));
        Assert.Equal(Src("split1 := a GT b;", "c := split1;"), Written(g, NetworkScope.Empty));
        Assert.Null(NetworkModelOracle.Check("gt-int", g).Reason);
    }

    // ── targets ─────────────────────────────────────────────────────────────────────────────────

    /// <summary>A literal is a token at operand position and no target: as a coil or an <c>=&gt;</c> target it is
    /// backticked, and reads back as the same target text.</summary>
    [Fact]
    public void A_literal_target_is_backticked()
    {
        Assert.Equal(Src("`5` := a;"), Written(Body(Set(L("a"), T("5"))), NetworkScope.Empty));
        Assert.Equal(Src("`16#FF` := a;"), Written(Body(Set(L("a"), T("16#FF"))), NetworkScope.Empty));
        Assert.Equal(Src("F(a, => `T#1s`);"), Written(Body(Call("F", new[] { In(L("a")) }, new[] { Out("T#1s", 0) }, eno: false)), NetworkScope.Empty));
        Assert.Equal(Src("%QX0.1 := a;"), Written(Body(Set(L("a"), T("%QX0.1"))), NetworkScope.Empty));
        Assert.Null(NetworkModelOracle.Check("5", Body(Set(L("a"), T("5")))).Reason);
        Assert.Null(NetworkModelOracle.Check("16#FF", Body(Set(L("a"), T("16#FF")))).Reason);
        Assert.Null(NetworkModelOracle.Check("T#1s", Body(Call("F", new[] { In(L("a")) }, new[] { Out("T#1s", 0) }, eno: false))).Reason);
    }

    // ── call heads and instances ────────────────────────────────────────────────────────────────

    [Fact]
    public void A_function_named_like_an_instance_in_scope_goes_to_the_marker()
    {
        var m = Body(Net(Fb("t1", new[] { In(L("a"), "IN") }, type: "TON"), Call("t1", new[] { In(L("b")) })));
        Assert.Equal("a function named like an FB instance in scope", RefusedBy(m, ScopeOf(m)));
        Assert.Equal("a function named like an FB instance in scope", NetworkModelOracle.Check("t1", m).Reason);
    }

    [Fact]
    public void A_flag_on_an_FB_instance_goes_to_the_marker()
    {
        var m = Body(Call("TON", new[] { In(L("a"), "IN") }, kind: CallKind.FunctionBlock,
            instance: new Operand("t1", IsInstance: true, Flags: Neg)));
        Assert.Equal("a flag on an FB instance", RefusedBy(m, ScopeOf(m)));
        Assert.Equal("a flag on an FB instance", NetworkModelOracle.Check("t1-neg", m).Reason);
        var plain = Body(Call("TON", new[] { In(L("a"), "IN") }, kind: CallKind.FunctionBlock,
            instance: new Operand("t1", IsInstance: true)));
        Assert.NotNull(NetworkModelEquality.FirstDifference(NetworkTextFacts.Carried(m), NetworkTextFacts.Carried(plain)));
    }

    /// <summary>An FB call names its instance and its type: an element of an array of FBs, or an instance the declarations do
    /// not name, is written with both and reads back; the build judges what the declarations do not.</summary>
    [Fact]
    public void An_FB_instance_whose_text_is_an_expression_names_its_type()
    {
        var scope = Scope(new[] { "fbs", "a" });
        var m = Body(Call("TON", new[] { In(L("a"), "IN") }, kind: CallKind.FunctionBlock,
            instance: new Operand("fbs[1]", IsInstance: true)));
        Assert.Equal(Src("`fbs[1]` : TON(IN := a);"), Written(m, scope));
        Assert.Null(NetworkModelOracle.Check("fbs[1]", m).Reason);

        Assert.Throws<ArgumentException>(() => new NetworkScope(Array.Empty<string>(), Array.Empty<string>(),
            new Dictionary<string, string> { ["fbs[1]"] = "TON" }));
    }

    [Theory]
    [InlineData("execute")]
    [InlineData("ST")]
    public void An_Execute_box_of_another_type_goes_to_the_marker(string type)
    {
        var m = Body(new Box(type, null, CallKind.Function, new List<Input>(), new List<Output>(), null, "x := 1;", Flags.None));
        Assert.Equal("an Execute box of another type", RefusedBy(m, NetworkScope.Empty));
    }

    /// <summary>A pin named like a word of the text is backticked, an output named EN included.</summary>
    [Fact]
    public void An_output_pin_named_EN_is_backticked()
    {
        var m = Body(Call("F", new[] { In(L("a")) }, new[] { Out("x", null, "EN") }));
        Assert.Equal(Src("F(a, `EN` => x);"), Written(m, NetworkScope.Empty));
        Assert.Null(NetworkModelOracle.Check("EN output", m).Reason);
    }

    [Fact]
    public void An_unmeasured_Parallel_mode_goes_to_the_marker() =>
        Assert.Equal("an unmeasured Parallel mode",
            RefusedBy(Body(Set(new Parallel(null, new Node[] { L("a"), L("b") }, (ParallelMode)5), T("o")), BodyLanguage.Ld),
                NetworkScope.Empty));

    [Fact]
    public void A_lone_unwired_slot_beside_an_output_pin_is_written()
    {
        var m = Body(Call("f", new[] { In(Empty) }, new[] { Out("x", 0) }));
        Assert.Equal(Src("f(, => x);"), Written(m, NetworkScope.Empty));
        Assert.Null(NetworkModelOracle.Check("f(, => x)", m).Reason);
        Assert.True(NetworkTextGate.Validate(Src("f(, => x);"), NetworkScope.Empty).Ok);
    }

    // ── edge words ──────────────────────────────────────────────────────────────────────────────

    /// <summary>An edge is a prefix, so nothing named R_EDGE blocks it: a variable or a POU of that name is backticked
    /// where it stands.</summary>
    [Fact]
    public void A_name_spelled_like_an_edge_word_blocks_no_edge()
    {
        var edge = Body(Set(L("x", Rise), T("out")));
        var names = Scope(new[] { "x", "out" }, pous: new[] { "r_edge" }, instances: new() { ["F_Edge"] = "F_TRIG" });
        Assert.Equal(Src("out := R_EDGE x;"), Written(edge, names));
        Assert.True(NetworkTextReader.Read(Written(edge, names), names).Ok);
        Assert.Equal(Src("`R_EDGE`(a);"), Written(Body(Call("R_EDGE", new[] { In(L("a")) })), NetworkScope.Empty));
    }

    static NetworkGateResult Gate(string text, NetworkScope scope) =>
        NetworkTextGate.Validate(text, scope);

    /// <summary>An edge on a NOT box is a prefix on its call; a negation with an edge is the vendor's order, the edge first
    /// (DIALECT N17), the other order the one refusal.</summary>
    [Fact]
    public void An_edge_on_a_NOT_box_round_trips()
    {
        var m = Body(Set(Call("NOT", new[] { In(L("a")) }, f: Rise), T("out")));
        Assert.Equal(Src("out := R_EDGE `NOT`(a);"), Written(m, NetworkScope.Empty));
        Assert.Null(NetworkModelOracle.Check("rising-not-box", m).Reason);
        Assert.Null(NetworkModelOracle.Check("negated-falling-not-box",
            Body(Set(Call("NOT", new[] { In(L("a")) }, f: Neg with { Falling = true }), T("out")))).Reason);
        Assert.Null(NetworkModelOracle.Check("rising-not-box-around-group",
            Body(Set(Call("NOT", new[] { In(Op("AND", L("a"), L("b"))) }, f: Rise), T("out")))).Reason);

        Assert.Equal(Src("out := R_EDGE NOT a;"),
            Written(Body(Set(L("a", Neg with { Rising = true }), T("out"))), NetworkScope.Empty));
        Assert.Equal(Src("out := R_EDGE NOT (a AND b);"),
            Written(Body(Set(Op("AND", L("a"), L("b")) with { Flags = Neg with { Rising = true } }, T("out"))), NetworkScope.Empty));
        GateRefuses("NETWORK_BAD_EXPRESSION", Src("out := NOT R_EDGE a;"), NetworkScope.Empty);
    }

    /// <summary>Operator words nest by brackets, a lower-case type keeps its spelling, and a chain read through ENO writes
    /// each operator's value somewhere (X3).</summary>
    [Fact]
    public void Operator_words_nest_and_chain()
    {
        var and = Body(Call("and", new[] { In(Call("or", new[] { In(L("a")), In(L("b")) }, kind: CallKind.Operator)), In(L("c")) }, kind: CallKind.Operator));
        Assert.Equal(Src("(a or b) and c;"), Written(and, NetworkScope.Empty));
        Assert.Null(NetworkModelOracle.Check("and(or)", and).Reason);

        var enabled = Body(Call("AND", new[] { In(Call("xor", new[] { In(L("a")), In(L("b")) }, kind: CallKind.Operator)), In(L("c")) },
            new[] { Out("out", 1) }, en: L("go"), eno: true, kind: CallKind.Operator));
        Assert.Equal(Src("(a xor b) AND c => out ENO EN go;"), Written(enabled, NetworkScope.Empty));
        Assert.Null(NetworkModelOracle.Check("AND EN over xor", enabled).Reason);

        var enoChain = Body(Set(Call("AND", new[]
        {
            In(Call("XOR", new[] { In(L("a")), In(L("b")) }, new[] { Out("t", 1) }, en: L("c"), connected: 0, eno: true, kind: CallKind.Operator)), In(L("d")),
        }, new[] { Out("u", 1) }, en: L("go"), connected: 0, eno: true, kind: CallKind.Operator), T("out")));
        Assert.Equal(Src("out := (a XOR b => t ENO EN c) AND d => u ENO EN go;"), Written(enoChain, NetworkScope.Empty));
        Assert.Null(NetworkModelOracle.Check("XOR / AND / out", enoChain).Reason);

        Assert.Null(NetworkModelOracle.Check("R_EDGE over an AND over MOD's ENO", Body(Set(Call("AND", new[] { In(L("a")), In(L("b")) }, new[] { Out("u", 1) },
            en: Call("MOD", new[] { In(L("a")), In(L("b")) }, new[] { Out("t", 1) }, en: L("c"), connected: 0, eno: true, kind: CallKind.Operator),
            connected: 0, f: Rise, eno: true, kind: CallKind.Operator), T("out")))).Reason);
        Assert.Null(NetworkModelOracle.Check("OR over XOR's ENO over AND's ENO", Body(Set(Op("OR", L("a"),
            Call("XOR", new[] { In(Call("AND", new[] { In(L("a")), In(L("b")) }, new[] { Out("t", 1) }, en: L("d"), connected: 0, eno: true, kind: CallKind.Operator)), In(L("b")) },
                new[] { Out("u", 1) }, en: L("c"), connected: 0, eno: true, kind: CallKind.Operator)), T("out")))).Reason);

        var r = Gate(Src("x := (a or b) and c;"), NetworkScope.Empty);
        Assert.True(r.Ok, string.Join("\n", r.Diagnostics.Select(d => d.Code + " " + d.Message)));
        Assert.Equal(Src("x := (a or b) and c;"), r.Canonical);
    }

    [Theory]
    [InlineData("out := ٣;")]
    [InlineData("out := 1٣;")]
    [InlineData("out := １;")]
    [InlineData("out := aä;")]
    public void A_non_ASCII_digit_or_letter_is_refused_not_spun_on(string statement)
    {
        var task = System.Threading.Tasks.Task.Run(() =>
            NetworkTextGate.Validate(Src(statement), Scope(new[] { "out", "a" })));
        Assert.True(task.Wait(TimeSpan.FromSeconds(10)), "the gate did not return");
        Assert.False(task.Result.Ok);
        Assert.Equal("NETWORK_PARSE", task.Result.Diagnostics[0].Code);
    }

    /// <summary>A text the writer leaves bare is exactly one token of the lexer, and a text it backticks is not —
    /// literals included (P14: a negative number, a string).</summary>
    [Theory]
    [InlineData("a")] [InlineData("a.b.c")] [InlineData("12")] [InlineData("1_000.5e-3")] [InlineData("T#1S")]
    [InlineData("16#FF")] [InlineData("%IX0.1")] [InlineData("%QW12")] [InlineData("???")] [InlineData("-1")]
    [InlineData("-1.5")] [InlineData("'Recipes'")] [InlineData("'it$'s'")] [InlineData("\"wide\"")]
    [InlineData("٣")] [InlineData("aä")] [InlineData("1a")] [InlineData("%IX")] [InlineData("1.")] [InlineData("- 1")]
    public void A_bare_token_is_one_token_of_the_lexer(string text)
    {
        var lx = new NetworkLexer(text, 0);
        var first = lx.Next();
        var one = first.Kind != TokKind.Sym && first.Kind != TokKind.Error && first.Text == text && lx.Next().Kind == TokKind.Eof;
        Assert.Equal(NetworkSpelling.IsToken(text), one);
    }

    /// <summary>B8, C0023: a parallel with one branch — wired or not, fed or not — has no text.</summary>
    [Fact]
    public void A_Parallel_with_one_branch_goes_to_the_marker()
    {
        Assert.Equal("a Parallel with one branch",
            RefusedBy(Body(new Parallel(null, new Node[] { Empty }, ParallelMode.BoxShortCircuit), BodyLanguage.Ld), NetworkScope.Empty));
        Assert.Equal("a Parallel with one branch",
            RefusedBy(Body(new Parallel(L("f"), new Node[] { L("a") }, ParallelMode.Sequential), BodyLanguage.Ld), NetworkScope.Empty));
        // An empty branch is no refusal since 2R.5 (readability "Open" (c): it stores, builds and runs as a shorted branch).
        Assert.Null(NetworkModelOracle.Check("empty-branch",
            Body(new Parallel(L("f"), new Node[] { L("a"), Empty }, ParallelMode.Sequential), BodyLanguage.Ld)).Reason);
    }


    [Fact]
    public void The_empty_item_before_a_split_is_its_own_item()
    {
        Assert.Null(NetworkModelOracle.Check("empty-before-split", Body(Net(Empty, Def(3, L("TRUE")), Set(Ref(3), T("out"))))).Reason);
        Assert.Null(NetworkModelOracle.Check("two-empty-before-split",
            Body(Net(Empty, Empty, Def(3, L("TRUE")), Set(Ref(3), T("out"))))).Reason);
    }

    /// <summary>A split also spelled as another name (backticked) is no finding, so a later error in the network is the only one.</summary>
    [Fact]
    public void A_split_spelled_as_another_name_is_no_finding_beside_a_later_error()
    {
        var r = NetworkTextReader.Read(Src("split1 := a;", "`split1 + 1` := split1;", "out := a AND ((b OR c));"), NetworkScope.Empty);
        var d = Assert.Single(r.Diagnostics);
        Assert.Equal(("NETWORK_BAD_EXPRESSION", 5), (d.Code, d.Line));
    }

    /// <summary>The reader and the writer agree on the Parallel modes: the two measured ones are spelled, any other member
    /// the enum gains is refused by name.</summary>
    [Fact]
    public void Every_Parallel_mode_is_measured_or_refused()
    {
        foreach (ParallelMode mode in Enum.GetValues(typeof(ParallelMode)))
        {
            var m = Body(Set(new Parallel(L("f"), new Node[] { L("a"), L("b") }, mode), T("out")), BodyLanguage.Ld);
            if (mode is ParallelMode.BoxShortCircuit or ParallelMode.Sequential) Assert.Null(NetworkModelOracle.Check(mode.ToString(), m).Reason);
            else Assert.Equal("an unmeasured Parallel mode", RefusedBy(m, NetworkScope.Empty));
        }
    }
}
