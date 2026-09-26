using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.Network.Next;

namespace Volt.Engine.Tests;

/// <summary>
/// Network text v2 gate: every diagnostic in the spec's table (docs/network-text-next.html#diagnostics and the
/// scenarios of <c>specs/network-text/spec.md</c>) fires on its case, with its code and at its line — and what the
/// spec says is accepted, is. A finding is always a diagnostic; nothing here expects an exception.
/// </summary>
public class NextNetworkTextGateTests
{
    const string Fbd = "(* @volt-implementation FBD *)\n";

    static string Src(params string[] lines) =>
        Fbd + "NETWORK\n" + string.Concat(lines.Select(l => "  " + l + "\n")) + "END_NETWORK\n";

    static NextGateResult Gate(string text, NextNetworkScope? scope = null, BodyLanguage lang = BodyLanguage.Fbd) =>
        NextNetworkTextGate.Validate(text, lang, scope ?? NextNetworkScope.Empty);

    static NextNetworkScope Names(params string[] names) => new(names, new Dictionary<string, string>());

    /// <summary>The body is refused with exactly one finding, of <paramref name="code"/>, on <paramref name="line"/>.</summary>
    static NextNetworkTextDiagnostic Refused(string code, int line, string text, NextNetworkScope? scope = null, BodyLanguage lang = BodyLanguage.Fbd)
    {
        var r = Gate(text, scope, lang);
        Assert.False(r.Ok);
        var d = Assert.Single(r.Diagnostics);
        Assert.True(code == d.Code && line == d.Line, $"expected {code} on line {line}, got {d.Code} on line {d.Line}: {d.Message}");
        return d;
    }

    static void Accepted(string text, NextNetworkScope? scope = null, BodyLanguage lang = BodyLanguage.Fbd)
    {
        var r = Gate(text, scope, lang);
        Assert.True(r.Ok, string.Join("\n", r.Diagnostics.Select(d => $"{d.Line}:{d.Column} {d.Code} {d.Message}")));
    }

    // ── NETWORK_PARSE ───────────────────────────────────────────────────────────────────────────

    /// <summary>Spec, "a missing terminator is a parse error".</summary>
    [Fact]
    public void END_IF_without_its_semicolon() =>
        Refused("NETWORK_PARSE", 4, Src("IF a THEN JMP Done; END_IF"));

    [Fact]
    public void A_statement_without_its_semicolon() =>
        Refused("NETWORK_PARSE", 4, Src("out := a"));

    /// <summary>Spec, "a comment below a statement".</summary>
    [Fact]
    public void A_comment_after_a_statement_is_refused_never_moved()
    {
        Refused("NETWORK_PARSE", 4, Src("out := a;", "// later"));
        Refused("NETWORK_PARSE", 3, Src("out := a; // trailing"));
    }

    /// <summary>Spec, "a v1 body is refused, not translated".</summary>
    [Fact]
    public void V1_text_is_refused_naming_a_re_pull()
    {
        var d = Refused("NETWORK_PARSE", 1, "NETWORK 0 LD\n  LET g0 := TRUE;\n  out := g0;\nEND_NETWORK\n");
        Assert.Contains("re-pull", d.Message);
        Assert.Contains("re-pull", Refused("NETWORK_PARSE", 3, Src("LET g0 := TRUE;")).Message);
        Assert.Contains("re-pull", Refused("NETWORK_PARSE", 2, Fbd + "NETWORK 0 FBD\n  out := a;\nEND_NETWORK\n").Message);
    }

    [Fact]
    public void A_body_without_its_graphical_marker()
    {
        Refused("NETWORK_PARSE", 1, "NETWORK\n  out := a;\nEND_NETWORK\n");
        Refused("NETWORK_PARSE", 1, "(* @volt-implementation *)\nNETWORK\n  out := a;\nEND_NETWORK\n");
    }

    /// <summary>Spec, "a view change is one comparison": the marker says FBD, the IDE holds LD.</summary>
    [Fact]
    public void A_marker_naming_the_other_view_is_refused() =>
        Assert.Contains("view", Refused("NETWORK_UNSUPPORTED", 1, Src("out := a;"), lang: BodyLanguage.Ld).Message);

    [Fact]
    public void Header_fields_are_on_the_header_line_and_each_once()
    {
        Refused("NETWORK_PARSE", 2, Fbd + "NETWORK DISABLED DISABLED\n  ;\nEND_NETWORK\n");
        Refused("NETWORK_PARSE", 2, Fbd + "NETWORK TITLE: \"open\n  ;\nEND_NETWORK\n");
        Refused("NETWORK_PARSE", 2, Fbd + "NETWORK TITLE: \"$Q\"\n  ;\nEND_NETWORK\n");
    }

    // ── NETWORK_NOT_CLOSED ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_network_without_END_NETWORK()
    {
        Refused("NETWORK_NOT_CLOSED", 2, Fbd + "NETWORK\n  out := a;\n");
        var r = Gate(Fbd + "NETWORK\n  out := a;\nNETWORK\n  out := b;\nEND_NETWORK\n");
        Assert.Equal(("NETWORK_NOT_CLOSED", 2), (Assert.Single(r.Diagnostics).Code, r.Diagnostics[0].Line));
    }

    [Fact]
    public void An_EXECUTE_body_without_END_EXECUTE() =>
        Refused("NETWORK_PARSE", 3, Fbd + "NETWORK\n  EXECUTE\nx := 1;\n");

    // ── NETWORK_NOT_CANONICAL: tokens, never layout ─────────────────────────────────────────────

    /// <summary>Spec, "re-wrapping a call is accepted".</summary>
    [Fact]
    public void Layout_is_not_a_difference()
    {
        var pins = Enumerable.Range(1, 30).Select(i => $"P{i} := v{i}").ToArray();
        var scope = new NextNetworkScope(Array.Empty<string>(), new Dictionary<string, string> { ["fb"] = "FB_Big" });
        Accepted(Fbd + "NETWORK\n  fb(\n      " + string.Join(",\n      ", pins) + "\n  );\nEND_NETWORK\n", scope);
        Accepted(Fbd + "NETWORK\nout:=((a AND b)OR c);\nEND_NETWORK\n");
    }

    [Fact]
    public void Call_form_where_infix_is_canonical_names_the_canonical_body()
    {
        var d = Refused("NETWORK_NOT_CANONICAL", 3, Src("out := AND(a, b);"));
        Assert.Contains("out := (a AND b);", d.Message);
    }

    /// <summary>Spec, "the network header": another field order is NOT_CANONICAL.</summary>
    [Fact]
    public void Header_fields_out_of_order() =>
        Refused("NETWORK_NOT_CANONICAL", 2, Fbd + "NETWORK DISABLED LABEL: Done\n  ;\nEND_NETWORK\n");

    [Fact]
    public void A_default_Parallel_mode_written_out_is_not_canonical() =>
        Refused("NETWORK_NOT_CANONICAL", 3, Src("out := PARALLEL(MODE := BoxShortCircuit, a, b);"));

    // ── NETWORK_DUPLICATE_NAME ──────────────────────────────────────────────────────────────────

    /// <summary>Spec, "a wire defined twice".</summary>
    [Fact]
    public void A_wire_defined_twice() =>
        Refused("NETWORK_DUPLICATE_NAME", 5, Src("VAR_TEMP g1 : BOOL; END_VAR", "g1 := a;", "g1 := b;", "out := g1;"), lang: BodyLanguage.Fbd);

    [Fact]
    public void A_wire_declared_twice_or_with_one_VarId_twice()
    {
        Refused("NETWORK_DUPLICATE_NAME", 3, Src("VAR_TEMP g1, g1 : BOOL; END_VAR", "g1 := TRUE;"));
        Refused("NETWORK_DUPLICATE_NAME", 3, Src("VAR_TEMP g1, g01 : BOOL; END_VAR", "g1 := TRUE;"));
    }

    /// <summary>Spec, "a wire that differs from a variable only in case".</summary>
    [Fact]
    public void A_wire_named_like_a_variable_in_scope() =>
        Refused("NETWORK_DUPLICATE_NAME", 3, Src("VAR_TEMP g3 : BOOL; END_VAR", "g3 := TRUE;", "out := g3;"), Names("G3"));

    [Fact]
    public void A_wire_name_also_used_as_a_name_in_the_network() =>
        Refused("NETWORK_DUPLICATE_NAME", 5, Src("VAR_TEMP g1 : BOOL; END_VAR", "g1 := TRUE;", "MOVE(g1, => `g1`);"));

    // ── NETWORK_BAD_EXPRESSION ──────────────────────────────────────────────────────────────────

    /// <summary>Spec, "a redundant pair".</summary>
    [Fact]
    public void A_pair_of_parentheses_that_is_no_box() =>
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("out := ((a AND b));"));

    [Fact]
    public void Two_operator_kinds_in_one_group() =>
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("out := (a AND b OR c);"));

    /// <summary>Spec, "an undeclared wire-shaped name".</summary>
    [Fact]
    public void An_undeclared_wire_shaped_name_in_no_scope() =>
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("out := g5;"));

    /// <summary>Spec, "a second block".</summary>
    [Fact]
    public void A_second_wire_block() =>
        Refused("NETWORK_BAD_EXPRESSION", 5, Src("VAR_TEMP g1 : BOOL; END_VAR", "g1 := TRUE;", "VAR_TEMP g2 : BOOL; END_VAR", "g2 := TRUE;"));

    /// <summary>Spec, "a wire not named g&lt;digits&gt;".</summary>
    [Fact]
    public void A_wire_not_named_g_digits() =>
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("VAR_TEMP speed : BOOL; END_VAR", "speed := TRUE;"));

    /// <summary>Spec, "a wire referenced but never defined".</summary>
    [Fact]
    public void A_wire_referenced_and_never_defined()
    {
        var r = Gate(Src("VAR_TEMP g1 : BOOL; END_VAR", "out := g1;"));
        Assert.Contains(r.Diagnostics, d => d.Code == "NETWORK_BAD_EXPRESSION" && d.Line == 4);
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("VAR_TEMP g1 : BOOL; END_VAR", "out := a;"));
    }

    /// <summary>Spec, "a wire defined with a storage operator".</summary>
    [Fact]
    public void A_wire_defined_with_S_equals() =>
        Refused("NETWORK_BAD_EXPRESSION", 4, Src("VAR_TEMP g1 : BOOL; END_VAR", "g1 S= a;"));

    /// <summary>Spec, "a wire defined inside a chain".</summary>
    [Fact]
    public void A_wire_defined_inside_a_chain()
    {
        Refused("NETWORK_BAD_EXPRESSION", 4, Src("VAR_TEMP g1 : BOOL; END_VAR", "g1 := out := a;"));
        Refused("NETWORK_BAD_EXPRESSION", 4, Src("VAR_TEMP g1 : BOOL; END_VAR", "out := g1 := a;"));
    }

    /// <summary>Spec, "a wire referenced before its definition".</summary>
    [Fact]
    public void A_wire_referenced_before_its_definition() =>
        Refused("NETWORK_BAD_EXPRESSION", 4, Src("VAR_TEMP g1 : BOOL; END_VAR", "out := g1;", "g1 := a;"));

    /// <summary>Spec, "a hand-edited type": the finding names the wire and the producer's type.</summary>
    [Fact]
    public void A_wire_typed_unlike_its_producer()
    {
        var d = Refused("NETWORK_BAD_EXPRESSION", 3, Src("VAR_TEMP g1 : INT; END_VAR", "g1 := (a AND b);", "out := g1;"));
        Assert.Contains("g1", d.Message);
        Assert.Contains("BOOL", d.Message);
    }

    /// <summary>Spec, "a missing ENO is refused" and "an enabled box nested without ENO".</summary>
    [Fact]
    public void A_consumed_enabled_box_without_ENO()
    {
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("lamp := MOVE(EN := c, 0, => Status);"));
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("out := GT(ADD(EN := x, a, b), c);"));
    }

    [Fact]
    public void ENO_on_a_box_without_EN_or_on_a_box_nothing_consumes()
    {
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("out := f(a).ENO;"));
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("MOVE(EN := c, 0).ENO;"));
    }

    [Fact]
    public void A_consumed_execute_box_says_ENO() =>
        Refused("NETWORK_BAD_EXPRESSION", 3, Fbd + "NETWORK\n  out := EXECUTE\nx := 1;\n  END_EXECUTE;\nEND_NETWORK\n");

    /// <summary>Spec, "a modifier inside an edge".</summary>
    [Fact]
    public void A_modifier_inside_an_edge() =>
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("out := R_EDGE(NOT x);"));

    [Fact]
    public void An_operand_spelled_like_a_keyword_must_be_backticked()
    {
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("out := (a AND THEN);"));
        Accepted(Src("out := (a AND `THEN`);"));
    }

    // ── NETWORK_UNKNOWN_OPERATOR ────────────────────────────────────────────────────────────────

    [Fact]
    public void A_symbol_not_in_the_operator_table()
    {
        Refused("NETWORK_UNKNOWN_OPERATOR", 3, Src("out := (a & b);"));
        Refused("NETWORK_UNKNOWN_OPERATOR", 3, Src("out := (a NAND b);"));
    }

    // ── NETWORK_UNSUPPORTED ─────────────────────────────────────────────────────────────────────

    /// <summary>Spec, "an opaque operand is backticked in place": a backtick inside backticks, refused by name.</summary>
    [Fact]
    public void A_backtick_inside_backticked_text() =>
        Assert.Contains("backtick", Refused("NETWORK_UNSUPPORTED", 3, Src("out := `a`b`;")).Message);

    /// <summary>Spec, "a POU named like an edge word".</summary>
    [Fact]
    public void A_POU_or_instance_named_like_a_construct()
    {
        Refused("NETWORK_UNSUPPORTED", 3, Src("out := R_EDGE(x);"), Names("R_EDGE"));
        Refused("NETWORK_UNSUPPORTED", 3, Src("out := PARALLEL(a, b);"), Names("Parallel"));
    }

    [Fact]
    public void Nested_edges() =>
        Refused("NETWORK_UNSUPPORTED", 3, Src("out := R_EDGE(F_EDGE(x));"));

    /// <summary>Spec, "a flag on an empty slot".</summary>
    [Fact]
    public void A_flag_on_an_empty_slot() =>
        Refused("NETWORK_UNSUPPORTED", 3, Src("f(NOT , a);"));

    [Fact]
    public void An_unmeasured_Parallel_mode() =>
        Refused("NETWORK_UNSUPPORTED", 3, Src("out := PARALLEL(MODE := Eager, a, b);"));

    // ── accepted as the spec says ───────────────────────────────────────────────────────────────

    /// <summary>Spec, "a jump to a missing label" and "a disabled network that is a jump target".</summary>
    [Fact]
    public void Labels_are_the_compilers_business()
    {
        Accepted(Src("JMP Nowhere;"));
        Accepted(Fbd + "NETWORK\n  JMP Done;\nEND_NETWORK\nNETWORK LABEL: Done DISABLED\n  out := a;\nEND_NETWORK\n");
    }

    /// <summary>Spec, "a comment on a fully-headed network".</summary>
    [Fact]
    public void A_fully_headed_network_in_canonical_order() =>
        Accepted(Fbd + "NETWORK LABEL: Done TITLE: \"Tray $\"A$\" ready\" DISABLED\n  // note\n  VAR_TEMP g0 : BOOL; END_VAR\n  g0 := TRUE;\n  out := g0;\nEND_NETWORK\n");

    /// <summary>Spec, "the writer avoids a collision … and the reader accepts it".</summary>
    [Fact]
    public void The_writers_renamed_wire_is_accepted()
    {
        var scope = Names("G3");
        var text = NextNetworkTextWriter.Write(
            new NetworkBody(BodyLanguage.Fbd, new[] { NextModels.Net(NextModels.Def(3, NextModels.L("TRUE")), NextModels.Set(NextModels.Ref(3), NextModels.T("out"))) }),
            scope);
        Accepted(text, scope);
    }
    // ── review 2026-09-26 ───────────────────────────────────────────────────────────────────────

    /// <summary>Spec, "a POU named like an edge word": refused by name AT the call, by the reader — a backticked
    /// head is still the POU's name. (It used to pass the reader and fail in the writer, reported at 1:1 with the
    /// pull's "materializes the body as a marker" message.)</summary>
    [Fact]
    public void A_backticked_head_named_like_a_construct_is_refused_at_the_call()
    {
        var d = Refused("NETWORK_UNSUPPORTED", 4, Src("y := x;", "y := `R_EDGE`(x);"));
        Assert.Equal(8, d.Column);
        Assert.DoesNotContain("marker", d.Message);
        Assert.Equal(8, Refused("NETWORK_UNSUPPORTED", 4, Src("y := x;", "y := `Parallel`(x);")).Column);
    }

    /// <summary>A POU whose NAME is a keyword that is no construct (EXECUTE, NETWORK) is called with a backticked
    /// head, and reads back as that box type.</summary>
    [Fact]
    public void A_backticked_keyword_head_is_a_box_type() =>
        Accepted(Src("y := `EXECUTE`(x);", "`Network`(x, => z);"));

    /// <summary>Gate requirement: whitespace is significant only inside backticks, TITLE, comments and EXECUTE —
    /// so a comparison against a variable named R or S reads the same with or without spaces, and a storage
    /// operator does too.</summary>
    [Fact]
    public void Spacing_does_not_decide_a_storage_operator()
    {
        Accepted(Src("out := (R=x);"));
        Accepted(Src("out := (S = x);"));
        Accepted(Src("x S = a;"));
        Accepted(Src("x :=", "y R =a;"));
    }

    /// <summary>Task 1.17: in ladder a leaf wire whose every use is boolean (a coil) is BOOL, so another declared
    /// type is refused by name — the same rule the writer declares with.</summary>
    [Fact]
    public void A_ladder_leaf_wire_used_only_as_a_contact_is_BOOL()
    {
        var d = Refused("NETWORK_BAD_EXPRESSION", 3,
            "(* @volt-implementation LD *)\nNETWORK\n  VAR_TEMP g1 : INT; END_VAR\n  g1 := x;\n  o := g1;\nEND_NETWORK\n", lang: BodyLanguage.Ld);
        Assert.Contains("BOOL", d.Message);
    }

    /// <summary>A bit operator's wire is BOOL or another bit-string type; a numeric type is refused, naming both.</summary>
    [Fact]
    public void A_bit_operator_wire_accepts_a_bit_string_type()
    {
        Accepted(Src("VAR_TEMP g5 : WORD; END_VAR", "g5 := (w1 AND w2);", "o := g5;"));
        Assert.Contains("BOOL", Refused("NETWORK_BAD_EXPRESSION", 3, Src("VAR_TEMP g5 : REAL; END_VAR", "g5 := (w1 AND w2);", "o := g5;")).Message);
    }
}
