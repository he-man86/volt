using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Engine.Format.Network;
using static Volt.Engine.Tests.NetworkModels;

namespace Volt.Engine.Tests;

/// <summary>
/// The network text gate (openspec <c>ld-fbd-coverage</c> 2R.6b): each finding fires on its case, with its code and AT ITS
/// LINE, and what the grammar accepts, is — a finding is always a diagnostic, never an exception. The breadth of the
/// grammar's refusals is the shared case set (<see cref="NetworkTextCaseTests"/>); this file pins positions, the
/// canonical form, recovery across networks and the post-push token comparison.
/// </summary>
public class NetworkTextGateTests
{
    static NetworkGateResult Gate(string text, NetworkScope? scope = null) =>
        NetworkTextGate.Validate(text, scope ?? NetworkScope.Empty);

    static NetworkScope Names(params string[] names) => new(names, Array.Empty<string>(), new Dictionary<string, string>());

    static NetworkScope Pous(params string[] pous) => new(Array.Empty<string>(), pous, new Dictionary<string, string>());

    /// <summary>The body is refused with exactly one finding, of <paramref name="code"/>, on <paramref name="line"/>.</summary>
    static NetworkTextDiagnostic Refused(string code, int line, string text, NetworkScope? scope = null)
    {
        var r = Gate(text, scope);
        Assert.False(r.Ok);
        var d = Assert.Single(r.Diagnostics);
        Assert.True(code == d.Code && line == d.Line, $"expected {code} on line {line}, got {d.Code} on line {d.Line}: {d.Message}");
        return d;
    }

    static void Accepted(string text, NetworkScope? scope = null)
    {
        var r = Gate(text, scope);
        Assert.True(r.Ok, string.Join("\n", r.Diagnostics.Select(d => $"{d.Line}:{d.Column} {d.Code} {d.Message}")));
    }

    static void AcceptedAs(string text, string canonicalHolds, NetworkScope? scope = null)
    {
        var r = Gate(text, scope);
        Assert.True(r.Ok, string.Join("\n", r.Diagnostics.Select(d => $"{d.Line}:{d.Column} {d.Code} {d.Message}")));
        Assert.Contains(canonicalHolds, r.Canonical);
    }

    // ── NETWORK_PARSE ───────────────────────────────────────────────────────────────────────────

    /// <summary>An item ends with <c>;</c>: a line no deeper than its item's first line ends it — "missing `;`?", at that
    /// line.</summary>
    [Fact]
    public void A_coil_without_its_semicolon()
    {
        Refused("NETWORK_PARSE", 4, Src("out := a"));
        Assert.Contains("missing `;`?", Refused("NETWORK_PARSE", 4, Src("out := a", "y := b;")).Message);
    }

    /// <summary>An EXECUTE box is an item like any other: it ends with its <c>;</c>.</summary>
    [Fact]
    public void An_EXECUTE_box_ends_its_item_with_a_semicolon()
    {
        Refused("NETWORK_PARSE", 6, FbdMarker + "NETWORK\n  EXECUTE\nx := 1;\n  END_EXECUTE\nEND_NETWORK\n");
        var ok = Gate(FbdMarker + "NETWORK\n  EXECUTE\nx := 1;\n  END_EXECUTE;\nEND_NETWORK\n");
        Assert.True(ok.Ok);
        Assert.IsType<Box>(Assert.Single(ok.Body!.Networks[0].Trees));
    }

    [Fact]
    public void A_comment_after_a_statement_is_refused_never_moved()
    {
        Refused("NETWORK_PARSE", 4, Src("out := a;", "// later"));
        Refused("NETWORK_PARSE", 3, Src("out := a; // trailing"));
    }

    /// <summary>A lone CR ends a line wherever it stands, in a comment and an EXECUTE body alike; the CR of a CR LF is
    /// layout.</summary>
    [Fact]
    public void A_lone_CR_inside_a_comment_or_snippet_line_is_refused()
    {
        Refused("NETWORK_PARSE", 3, FbdMarker + "NETWORK\n  // hi\r  out := a;\nEND_NETWORK\n");
        Refused("NETWORK_PARSE", 4, FbdMarker + "NETWORK\n  // one\n  // two\r  o := b;\n  p := c;\nEND_NETWORK\n");
        Refused("NETWORK_PARSE", 3, FbdMarker + "NETWORK\n  // hi\r\r\n  out := a;\nEND_NETWORK\n");
        Refused("NETWORK_PARSE", 4, FbdMarker + "NETWORK\n  EXECUTE\nx := 1;\ry := 2;\n  END_EXECUTE;\nEND_NETWORK\n");
        Accepted(FbdMarker.Replace("\n", "\r\n") + "NETWORK\r\n  // hi\r\n  EXECUTE\r\nx := 1;\r\n  END_EXECUTE;\r\nEND_NETWORK\r\n");
    }

    [Fact]
    public void V1_text_is_refused_naming_a_re_pull()
    {
        var d = Refused("NETWORK_PARSE", 1, "NETWORK 0 LD\n  LET g0 := TRUE;\n  out := g0;\nEND_NETWORK\n");
        Assert.Contains("re-pull", d.Message);
        Assert.Contains("re-pull", Refused("NETWORK_PARSE", 3, Src("LET g0 := TRUE;")).Message);
        Assert.Contains("re-pull", Refused("NETWORK_PARSE", 2, FbdMarker + "NETWORK 0 FBD\n  out := a;\nEND_NETWORK\n").Message);
    }

    [Fact]
    public void A_body_without_its_graphical_marker()
    {
        Refused("NETWORK_PARSE", 1, "NETWORK\n  out := a;\nEND_NETWORK\n");
        Refused("NETWORK_PARSE", 1, "IMPLEMENTATION ST\nNETWORK\n  out := a;\nEND_NETWORK\n");
    }

    [Fact]
    public void A_marker_states_the_bodys_language_whatever_the_IDE_holds()
    {
        var read = Gate(Src("out := a;"));
        Assert.True(read.Ok);
        Assert.Equal(BodyLanguage.Fbd, read.Body!.Language);
    }

    /// <summary>P12: the header's fields are on its line, each once, in their order; a TITLE spells its escapes.</summary>
    [Fact]
    public void Header_fields_are_on_the_header_line_once_and_in_order()
    {
        Refused("NETWORK_PARSE", 2, FbdMarker + "NETWORK DISABLED DISABLED\n  ;\nEND_NETWORK\n");
        Refused("NETWORK_PARSE", 2, FbdMarker + "NETWORK TITLE: \"open\n  ;\nEND_NETWORK\n");
        Refused("NETWORK_PARSE", 2, FbdMarker + "NETWORK TITLE: \"$Q\"\n  ;\nEND_NETWORK\n");
        Refused("NETWORK_PARSE", 2, FbdMarker + "NETWORK DISABLED LABEL: Done\n  ;\nEND_NETWORK\n");
        Refused("NETWORK_PARSE", 2, FbdMarker + "NETWORK TITLE: \"\"\n  ;\nEND_NETWORK\n");
    }

    // ── NETWORK_NOT_CLOSED ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_network_without_END_NETWORK()
    {
        Refused("NETWORK_NOT_CLOSED", 2, FbdMarker + "NETWORK\n  out := a;\n");
        var r = Gate(FbdMarker + "NETWORK\n  out := a;\nNETWORK\n  out := b;\nEND_NETWORK\n");
        Assert.Equal(("NETWORK_NOT_CLOSED", 2), (Assert.Single(r.Diagnostics).Code, r.Diagnostics[0].Line));
    }

    [Fact]
    public void An_EXECUTE_body_without_END_EXECUTE() =>
        Refused("NETWORK_PARSE", 3, FbdMarker + "NETWORK\n  EXECUTE\nx := 1;\n");

    // ── canonical form ──────────────────────────────────────────────────────────────────────────

    /// <summary>Line breaks are layout: an item runs to its <c>;</c>, its continuation lines deeper than its first, and the
    /// canonical text is the writer's layout.</summary>
    [Fact]
    public void Layout_is_not_a_difference()
    {
        var pins = Enumerable.Range(1, 30).Select(i => $"P{i} := v{i}").ToArray();
        var scope = new NetworkScope(Array.Empty<string>(), Array.Empty<string>(), new Dictionary<string, string> { ["fb"] = "FB_Big" });
        Accepted(FbdMarker + "NETWORK\n  fb : FB_Big(\n      " + string.Join(",\n      ", pins) + "\n    );\nEND_NETWORK\n", scope);
        AcceptedAs(FbdMarker + "NETWORK\nout:=(a AND b)OR c;\nEND_NETWORK\n", "  out := (a AND b) OR c;");
        AcceptedAs(Src("x := a AND", "     b AND c;"), "  x := a AND b AND c;");
    }

    /// <summary>A plain name between backticks comes back bare; a box word keeps the case the box type is spelled in.</summary>
    [Fact]
    public void Another_spelling_of_one_tree_is_accepted_and_comes_back_canonical()
    {
        AcceptedAs(Src("out := a and b;"), "out := a and b;");
        AcceptedAs(Src("out := `a` AND b;"), "out := a AND b;");
        AcceptedAs(Src("JMP Done:=c;"), "JMP Done := c;");
    }

    /// <summary>B4b: a jump's condition is a line's whole value; the editor's parallel mode is written as nothing.</summary>
    [Fact]
    public void A_parallel_in_the_editors_mode_writes_no_mode() =>
        AcceptedAs(Src("out := f BRANCH (a, b);"), "out := f BRANCH (a, b);");

    // ── NETWORK_DUPLICATE_NAME and the split rules (B6, P11) ────────────────────────────────────

    [Fact]
    public void A_split_defined_twice() =>
        Refused("NETWORK_DUPLICATE_NAME", 4, Src("split1 := a;", "split1 := b;", "out := split1;"));

    /// <summary>2R.5 (#19): a reference stored above its definition stores and builds (it reads the previous scan) — the
    /// stored order is kept; a reference the network never defines is refused at it.</summary>
    [Fact]
    public void A_split_referenced_before_its_definition_is_accepted_and_one_never_defined_is_not()
    {
        Accepted(Src("out := split1;", "split1 := a;"));
        Assert.Contains("never defined", Refused("NETWORK_BAD_EXPRESSION", 3, Src("out := split1;")).Message);
    }

    [Fact]
    public void A_split_defined_with_S_equals_is_a_coil_on_a_split() =>
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("split1 S= a;"));

    /// <summary>A split is never a target in a chain; its definition stands nested in brackets (2R.5, #20).</summary>
    [Fact]
    public void A_split_inside_a_chain_is_refused_and_a_nested_definition_accepted()
    {
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("out := split1 := a;"));
        Accepted(Src("y := (split1 := a);", "z := split1;"));
    }

    /// <summary>B6, P9: a split's type is never written — refused at the `:`, naming the split.</summary>
    [Fact]
    public void A_split_type_is_refused_at_the_type()
    {
        var d = Refused("NETWORK_BAD_EXPRESSION", 3, Src("split1 : INT := a GT b;", "out := split1;"));
        Assert.Contains("split1", d.Message);
        Assert.Equal(10, d.Column);
    }

    /// <summary>A split beside a declaration of its name is one more split: P1 reserves the pattern (a bare <c>split3</c> is
    /// the split, the variable is <c>`split3`</c>), and the vendor builds it clean on both IDEs
    /// (<c>rcc_network_wire_named_like_variable</c>: <c>[]</c>; the Demux's VarId is no name the compiler sees).</summary>
    [Fact]
    public void A_split_beside_a_declaration_of_its_name_is_accepted() =>
        Accepted(Src("x := y;", "split3 := a;", "out := split3;", "`split3` := split3;"), Names("split3"));

    /// <summary>P1: a bare split-shaped word is always the split; the variable of that name is backticked.</summary>
    [Fact]
    public void A_backticked_split_shaped_name_is_the_variable()
    {
        Accepted(Src("out := `split5`;"));
        Accepted(Src("`split5` := a;"));
        var r = NetworkTextReader.Read(Src("out := `split7`;"), NetworkScope.Empty);
        Assert.Equal("split7", Assert.IsType<Leaf>(Assert.IsType<Assign>(Assert.Single(Assert.Single(r.Body!.Networks).Trees)).Value).Operand.Text);
    }

    // ── NETWORK_BAD_EXPRESSION ──────────────────────────────────────────────────────────────────

    [Fact]
    public void A_pair_of_brackets_that_is_no_box() =>
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("out := a AND ((b OR c));"));

    [Fact]
    public void Two_box_words_at_one_level() =>
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("out := a AND b OR c;"));

    /// <summary>A box read through its ENO is written where its consumer holds it, showing <c>ENO</c>; the word ENO alone
    /// is no value.</summary>
    [Fact]
    public void A_box_read_through_its_ENO_stands_in_its_consumer()
    {
        Accepted(Src("lamp := MOVE 1 => A ENO EN c;"));
        Accepted(Src("lamp := (MOVE 1 => A ENO EN c) AND (MOVE 2 => B ENO EN d);"));
        Refused("NETWORK_PARSE", 4, Src("MOVE 1 => A ENO EN c", "lamp := ENO;"));
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("lamp := ENO;"));
    }

    /// <summary>N20: no flag on a split reference or a parallel.</summary>
    [Fact]
    public void A_flag_on_a_split_reference_or_a_parallel()
    {
        Refused("NETWORK_UNSUPPORTED", 4, Src("split3 := a;", "out := NOT split3;"));
        Refused("NETWORK_UNSUPPORTED", 4, Src("split3 := a;", "out := R_EDGE split3;"));
        Refused("NETWORK_UNSUPPORTED", 3, Src("out := NOT (f BRANCH (a, b));"));
        // The flag on the split's FEEDER, and on a parallel's branch, are the vendor's own and stay.
        Accepted(Src("split3 := NOT a;", "out := split3;"));
        Accepted(Src("out := BRANCH (NOT a, b);"));
    }

    /// <summary>N17: <c>R_EDGE NOT x</c> is the one spelling of a negation with an edge — the edge first.</summary>
    [Fact]
    public void A_negation_follows_its_edge_and_nothing_else_does()
    {
        Accepted(Src("out := R_EDGE NOT x;"));
        Accepted(Src("out := F_EDGE NOT (a AND b);"));
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("out := NOT R_EDGE x;"));
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("out := R_EDGE NOT NOT x;"));
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("out := R_EDGE NOT F_EDGE x;"));
    }

    [Fact]
    public void An_operand_spelled_like_a_word_of_the_text_must_be_backticked()
    {
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("out := a AND BRANCH;"));
        Accepted(Src("out := a AND `BRANCH`;"));
        Accepted(Src("out := a AND THEN;"));   // THEN left the word list (P1)
    }

    /// <summary>P14: the ST symbols and an unknown character are no operator — refused by name.</summary>
    [Fact]
    public void A_symbol_is_no_operator()
    {
        Assert.Contains("write AND", Refused("NETWORK_BAD_EXPRESSION", 3, Src("out := a AND b + c;")).Message.Replace("ADD", "AND"));
        Refused("NETWORK_UNKNOWN_OPERATOR", 3, Src("out := a & b;"));
        Refused("NETWORK_PARSE", 3, Src("out := a NAND b;"));
    }

    // ── NETWORK_UNSUPPORTED ─────────────────────────────────────────────────────────────────────

    /// <summary>Inside backticks a backtick is doubled; a lone one closes the text.</summary>
    [Fact]
    public void A_backtick_inside_backticked_text()
    {
        Accepted(Src("out := `a``b`;"));
        Refused("NETWORK_PARSE", 3, Src("out := `a`b`;"));
    }

    /// <summary>An edge is a prefix, so a POU or an instance named like one blocks nothing: its call is backticked.</summary>
    [Fact]
    public void A_POU_or_instance_named_like_an_edge_word()
    {
        Accepted(Src("out := R_EDGE x;"), Pous("R_EDGE"));
        Accepted(Src("out := `R_EDGE`(IN := x);"), Pous("R_EDGE"));
        Accepted(Src("out := R_EDGE x;"), Names("R_EDGE"));
        Accepted(Src("out := Parallel(a, b);"), Pous("Parallel"));
    }

    [Fact]
    public void Nested_edges() =>
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("out := R_EDGE F_EDGE x;"));

    /// <summary>A negated empty slot stores and builds as a plain coil's value (2R.5, #6a); anywhere else, and an edge on one,
    /// it is unmeasured, refused by name.</summary>
    [Fact]
    public void A_flag_on_an_empty_slot()
    {
        Accepted(Src("x := NOT;"));
        Refused("NETWORK_UNSUPPORTED", 3, Src("x := f(NOT , a);"));
        Refused("NETWORK_UNSUPPORTED", 3, Src("x := f(R_EDGE , a);"));
    }

    /// <summary>B8: one branch pushes and does not compile (C0023) — refused at the branch.</summary>
    [Fact]
    public void A_parallel_with_one_branch_is_refused_at_it() =>
        Refused("NETWORK_UNSUPPORTED", 3, Src("out := f BRANCH (a);"));

    /// <summary>C3: a two-input operator with three inputs, refused at its word.</summary>
    [Fact]
    public void A_third_input_on_a_two_input_operator() =>
        Assert.Contains("SUB takes two", Refused("NETWORK_UNSUPPORTED", 3, Src("i := j SUB k SUB m;")).Message);

    // ── accepted as the grammar says ────────────────────────────────────────────────────────────

    [Fact]
    public void Labels_are_the_compilers_business()
    {
        Accepted(Src("JMP Nowhere := ;"));
        Accepted(FbdMarker + "NETWORK\n  JMP Done := ;\nEND_NETWORK\nNETWORK LABEL: Done DISABLED\n  out := a;\nEND_NETWORK\n");
    }

    [Fact]
    public void A_jump_inside_a_disabled_network_round_trips()
    {
        var text = FbdMarker + "NETWORK DISABLED\n  JMP Done := ;\nEND_NETWORK\nNETWORK LABEL: Done\n  out := a;\nEND_NETWORK\n";
        Accepted(text);
        var body = NetworkTextReader.Read(text, NetworkScope.Empty).Body!;
        Assert.True(body.Networks[0].Disabled);
        var jump = Assert.IsType<Assign>(Assert.Single(body.Networks[0].Trees));
        Assert.True(jump.Flags.Jump);
        Assert.Equal("Done", Assert.Single(jump.Targets).Text);
        Assert.Equal(text, NetworkTextWriter.Write(body, NetworkScope.Empty));
    }

    [Fact]
    public void A_label_on_two_networks_is_accepted_and_kept_verbatim()
    {
        var text = FbdMarker + "NETWORK LABEL: Done\n  out := a;\nEND_NETWORK\nNETWORK LABEL: DONE\n  out := b;\nEND_NETWORK\n";
        Accepted(text);
        var body = NetworkTextReader.Read(text, NetworkScope.Empty).Body!;
        Assert.Equal(new[] { "Done", "DONE" }, body.Networks.Select(n => n.Label));
        Assert.Equal(text, NetworkTextWriter.Write(body, NetworkScope.Empty));
    }

    [Fact]
    public void A_fully_headed_network_in_canonical_order() =>
        Accepted(FbdMarker + "NETWORK LABEL: Done DISABLED TITLE: \"Tray $\"A$\" ready\"\n  // note\n  split0 := TRUE;\n  out := split0;\nEND_NETWORK\n");

    /// <summary>A backticked head named like an edge word is a function's.</summary>
    [Fact]
    public void A_backticked_head_named_like_a_construct_is_a_call() =>
        Accepted(Src("y := x;", "y := `R_EDGE`(x);"));

    [Fact]
    public void A_backticked_keyword_head_is_a_box_type() =>
        Accepted(Src("y := `EXECUTE`(x);", "`Network`(x, => z);"));

    /// <summary><c>S=</c> and <c>R=</c> are single tokens.</summary>
    [Fact]
    public void S_and_R_storage_are_single_tokens()
    {
        Accepted(Src("x S= a;"));
        Accepted(Src("x := y R=a;"));
        Refused("NETWORK_PARSE", 3, Src("x S = a;"));
    }

    /// <summary>A literal says its own type: an inline type it contradicts stands (it differs), one it states is redundant.</summary>
    [Fact]
    public void A_literal_split_takes_no_redundant_type()
    {
        Refused("NETWORK_BAD_EXPRESSION", 3, LdMarker + "NETWORK\n  split1 : BOOL := TRUE;\n  o := split1;\nEND_NETWORK\n");
        Accepted(LdMarker + "NETWORK\n  split1 := TRUE;\n  o := split1;\nEND_NETWORK\n");
    }

    /// <summary>B6: no split takes a type, whatever its feeder (P9).</summary>
    [Fact]
    public void A_split_takes_no_type()
    {
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("split5 : WORD := w1 AND w2;", "o := split5;"));
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("split5 : REAL := w1 AND w2;", "o := split5;"));
    }

    // ── the post-push comparison ────────────────────────────────────────────────────────────────

    /// <summary><see cref="NetworkTextGate.SameTokens"/>: is the IDE's text a re-layout of the pushed one? A wrapped call is;
    /// a changed pin, marker, ST line or a line break that changes which line hands its ENO on (P2, B4) is not.</summary>
    [Theory]
    [InlineData("  t1(IN := a, PT := pt);", "  t1(\n    IN := a,\n    PT := pt\n  );", true)]
    [InlineData("  t1(IN := a, PT := pt);", "  t1(IN := a);", false)]
    [InlineData("  EXECUTE\nx := 1;\n  END_EXECUTE;", "  EXECUTE\n    x := 1;\n  END_EXECUTE;", false)]
    [InlineData("  EXECUTE\nx := 1;\n  END_EXECUTE ENO EN a AND b;", "  EXECUTE\nx := 1;\n    END_EXECUTE ENO EN a   AND b;", true)]
    [InlineData("  x := `a  b`;", "  x := `a b`;", false)]
    [InlineData("  x := a AND\n    b;", "  x := a AND b;", true)]
    [InlineData("  y := MOVE 1 => A ENO EN\n    MOVE 2 => B ENO EN c;", "  y := MOVE 1 => A ENO EN MOVE 2 => B ENO EN c;", true)]
    [InlineData("  y := MOVE 1 => A ENO EN c;", "  y := MOVE 1 => A EN c;", false)]
    public void Two_bodies_are_the_same_tokens_only_but_for_layout(string a, string b, bool same) =>
        Assert.Equal(same, NetworkTextGate.SameTokens(Src(a.TrimStart()), Src(b.TrimStart())));

    [Fact]
    public void Two_markers_are_two_texts() =>
        Assert.False(NetworkTextGate.SameTokens(Src("x := a;"), LdSrc("x := a;")));

    /// <summary>What the gate accepts as the canonical form's equal is the same tokens as that canonical form.</summary>
    [Theory]
    [InlineData("x := a AND\n     b;")]
    [InlineData("x := f(a,\n     b);")]
    public void A_layout_the_gate_accepts_is_the_same_tokens_as_its_canonical_form(string statement)
    {
        var text = Src(statement);
        var g = Gate(text);
        Assert.True(g.Ok, string.Join("\n", g.Diagnostics.Select(d => d.Message)));
        Assert.True(NetworkTextGate.SameTokens(text, g.Canonical!));
    }

    static string LabelledExecute(string value) =>
        FbdMarker + "NETWORK LABEL: Execute\n  out := " + value + ";\nEND_NETWORK\n" +
        "NETWORK\n  JMP Execute := go;\nEND_NETWORK\n";

    /// <summary>A label spelled <c>Execute</c> opens no EXECUTE body — in the reader and in the post-push comparison alike.</summary>
    [Fact]
    public void A_label_named_Execute_opens_no_body_in_the_post_push_comparison()
    {
        Accepted(LabelledExecute("a OR b"));
        Assert.False(NetworkTextGate.SameTokens(LabelledExecute("a AND b"), LabelledExecute("a OR b")));
        Assert.True(NetworkTextGate.SameTokens(LabelledExecute("a OR b"), LabelledExecute("a OR\n    b")));
    }

    [Fact]
    public void Two_texts_that_do_not_lex_are_not_the_same_tokens() =>
        Assert.False(NetworkTextGate.SameTokens(Src("x := `a;"), Src("x := `b AND c;")));
}
