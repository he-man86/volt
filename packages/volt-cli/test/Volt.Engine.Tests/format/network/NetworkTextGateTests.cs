using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Engine.Format.Network;
using static Volt.Engine.Tests.NetworkModels;

namespace Volt.Engine.Tests;

/// <summary>
/// Network text v2 gate: every diagnostic in the spec's table (docs/network-text.html#diagnostics and the
/// scenarios of <c>specs/network-text/spec.md</c>) fires on its case, with its code and at its line — and what the
/// spec says is accepted, is. A finding is always a diagnostic; nothing here expects an exception.
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

    // ── NETWORK_PARSE ───────────────────────────────────────────────────────────────────────────

    /// <summary>Spec, "a missing terminator is a parse error".</summary>
    [Fact]
    public void END_IF_without_its_semicolon() =>
        Refused("NETWORK_PARSE", 4, Src("IF a THEN JMP Done; END_IF"));

    [Fact]
    public void A_statement_without_its_semicolon() =>
        Refused("NETWORK_PARSE", 4, Src("out := a"));

    /// <summary>Task 2.8 / review 7.14: EXECUTE is a statement like IF, and its <c>;</c> is its own — without it the
    /// body is refused, whether the box stands alone or feeds a consumer, and never read as an empty item either
    /// way. With it, the <c>;</c> closes the box and creates no item.</summary>
    [Fact]
    public void END_EXECUTE_without_its_semicolon()
    {
        // Reported where the `;` is missing - at the token found instead, as for `END_IF` above.
        Refused("NETWORK_PARSE", 6, FbdMarker + "NETWORK\n  EXECUTE\nx := 1;\n  END_EXECUTE\nEND_NETWORK\n");
        Refused("NETWORK_PARSE", 6, FbdMarker + "NETWORK\n  out := EXECUTE\nx := 1;\n  END_EXECUTE.ENO\nEND_NETWORK\n");
        var ok = Gate(FbdMarker + "NETWORK\n  EXECUTE\nx := 1;\n  END_EXECUTE;\nEND_NETWORK\n");
        Assert.True(ok.Ok);
        Assert.IsType<Box>(Assert.Single(ok.Body!.Networks[0].Trees));
    }

    /// <summary>Spec, "a comment below a statement".</summary>
    [Fact]
    public void A_comment_after_a_statement_is_refused_never_moved()
    {
        Refused("NETWORK_PARSE", 4, Src("out := a;", "// later"));
        Refused("NETWORK_PARSE", 3, Src("out := a; // trailing"));
    }

    /// <summary>Spec, "a line ending in a lone CR": a lone CR ends a line wherever it stands, and an editor shows it
    /// as one — so the statement after one in a comment line was read as more comment and dropped from the push while
    /// the engineer saw it. Refused, in a comment and an EXECUTE body alike; the CR of a CR LF stays layout.</summary>
    [Fact]
    public void A_lone_CR_inside_a_comment_or_snippet_line_is_refused()
    {
        Refused("NETWORK_PARSE", 3, FbdMarker + "NETWORK\n  // hi\r  out := a;\nEND_NETWORK\n");
        Refused("NETWORK_PARSE", 4, FbdMarker + "NETWORK\n  // one\n  // two\r  o := b;\n  p := c;\nEND_NETWORK\n");
        Refused("NETWORK_PARSE", 3, FbdMarker + "NETWORK\n  // hi\r\r\n  out := a;\nEND_NETWORK\n");
        Refused("NETWORK_PARSE", 4, FbdMarker + "NETWORK\n  EXECUTE\nx := 1;\ry := 2;\n  END_EXECUTE;\nEND_NETWORK\n");
        Accepted(FbdMarker.Replace("\n", "\r\n") + "NETWORK\r\n  // hi\r\n  EXECUTE\r\nx := 1;\r\n  END_EXECUTE;\r\nEND_NETWORK\r\n");
    }

    /// <summary>Spec, "a v1 body is refused, not translated".</summary>
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

    /// <summary>Spec, "a view change is one comparison": the marker says FBD, the IDE holds LD. The body's language IS
    /// its marker's, so the text reads; the one comparison is the drivers' against the IDE's view. The reader once
    /// made a second one against a language its only caller took from that same marker — a check that could never
    /// fire, with a copy of the refusal's wording.</summary>
    [Fact]
    public void A_marker_naming_the_other_view_is_refused_by_the_one_comparison()
    {
        var read = Gate(Src("out := a;"));
        Assert.True(read.Ok);
        Assert.Equal(BodyLanguage.Fbd, read.Body!.Language);

        var e = Assert.Throws<System.NotSupportedException>(() => NetworkText.RefuseViewModeChange(BodyLanguage.Ld, read.Body.Language));
        Assert.Contains("view is LD and the pushed text says FBD", e.Message);
    }

    [Fact]
    public void Header_fields_are_on_the_header_line_and_each_once()
    {
        Refused("NETWORK_PARSE", 2, FbdMarker + "NETWORK DISABLED DISABLED\n  ;\nEND_NETWORK\n");
        Refused("NETWORK_PARSE", 2, FbdMarker + "NETWORK TITLE: \"open\n  ;\nEND_NETWORK\n");
        Refused("NETWORK_PARSE", 2, FbdMarker + "NETWORK TITLE: \"$Q\"\n  ;\nEND_NETWORK\n");
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

    // ── NETWORK_NOT_CANONICAL: tokens, never layout ─────────────────────────────────────────────

    /// <summary>Spec, "re-wrapping a call is accepted".</summary>
    [Fact]
    public void Layout_is_not_a_difference()
    {
        var pins = Enumerable.Range(1, 30).Select(i => $"P{i} := v{i}").ToArray();
        var scope = new NetworkScope(Array.Empty<string>(), Array.Empty<string>(), new Dictionary<string, string> { ["fb"] = "FB_Big" });
        Accepted(FbdMarker + "NETWORK\n  fb(\n      " + string.Join(",\n      ", pins) + "\n  );\nEND_NETWORK\n", scope);
        Accepted(FbdMarker + "NETWORK\nout:=((a AND b)OR c);\nEND_NETWORK\n");
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
        Refused("NETWORK_NOT_CANONICAL", 2, FbdMarker + "NETWORK DISABLED LABEL: Done\n  ;\nEND_NETWORK\n");

    [Fact]
    public void A_default_Parallel_mode_written_out_is_not_canonical() =>
        Refused("NETWORK_NOT_CANONICAL", 3, Src("out := PARALLEL(MODE := BoxShortCircuit, a, b);"));

    // ── NETWORK_DUPLICATE_NAME ──────────────────────────────────────────────────────────────────

    /// <summary>Spec, "a wire defined twice".</summary>
    [Fact]
    public void A_wire_defined_twice() =>
        Refused("NETWORK_DUPLICATE_NAME", 5, Src("VAR_TEMP g1 : BOOL; END_VAR", "g1 := a;", "g1 := b;", "out := g1;"));

    [Fact]
    public void A_wire_declared_twice_or_with_one_VarId_twice()
    {
        Refused("NETWORK_DUPLICATE_NAME", 3, Src("VAR_TEMP g1, g1 : BOOL; END_VAR", "g1 := TRUE;"));
        Refused("NETWORK_DUPLICATE_NAME", 3, Src("VAR_TEMP g1, g01 : BOOL; END_VAR", "g1 := TRUE;"));
    }

    /// <summary>A WIRE NAMED LIKE A VARIABLE IN SCOPE IS ACCEPTED (openspec <c>bridge-refusal-review</c> 2.10). Wires
    /// are VarIds in the IDE, so nothing there conflicts, and in the text a network's own wires resolve first: the
    /// reference is the wire. It used to be refused as "the writer would have named it the lowest free g&lt;n&gt;" — the
    /// writer's naming choice, which the next pull applies, and a rule resting on the regex scope. The READER's answer;
    /// the gate stops refusing a non-canonical spelling with 2.12.</summary>
    [Fact]
    public void A_wire_named_like_a_variable_in_scope_is_the_wire()
    {
        var r = NetworkTextReader.Read(Src("VAR_TEMP g3 : BOOL; END_VAR", "g3 := TRUE;", "out := g3;"), Names("G3", "out"));
        Assert.True(r.Ok, string.Join("\n", r.Diagnostics.Select(d => $"{d.Line} {d.Code} {d.Message}")));
        var trees = Assert.Single(r.Body!.Networks).Trees;
        Assert.Equal(3, Assert.IsType<Demux>(trees[0]).VarId);
        Assert.Equal(3, Assert.IsType<Demux>(Assert.IsType<Assign>(trees[1]).Value).VarId);
    }

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

    /// <summary>A BARE WIRE-SHAPED NAME NO VAR_TEMP DECLARES IS A VARIABLE OPERAND (openspec <c>bridge-refusal-review</c>
    /// 1.3). Only the network's own VAR_TEMP block makes a name a wire; any other <c>gN</c> is a variable, and whether one
    /// is declared is the build's question ("undeclared identifier"), not the push's. It used to be refused as "a wire
    /// someone forgot to declare" — a check on the code, resting on a one-line regex scope that also missed real
    /// variables (<c>g5 AT %IX0.0 : BOOL;</c>). The READER's answer: the canonical spelling of such a variable is
    /// backticked, and the gate stops refusing a non-canonical spelling with 2.12.</summary>
    [Fact]
    public void An_undeclared_wire_shaped_name_is_a_variable_operand()
    {
        var r = NetworkTextReader.Read(Src("out := g7;"), NetworkScope.Empty);
        Assert.True(r.Ok, string.Join("\n", r.Diagnostics.Select(d => $"{d.Line} {d.Code} {d.Message}")));
        var assign = Assert.IsType<Assign>(Assert.Single(Assert.Single(r.Body!.Networks).Trees));
        Assert.Equal("g7", Assert.IsType<Leaf>(assign.Value).Operand.Text);
    }

    /// <summary>…and so is a real variable whose declaration the scope's one-line reading misses — an address after
    /// the name. The push used to refuse a body using it as an undeclared wire.</summary>
    [Fact]
    public void A_wire_shaped_variable_declared_AT_an_address_is_a_variable_operand()
    {
        var scope = NetworkScope.FromDeclarations("PROGRAM P\nVAR\n\tg5 AT %IX0.0 : BOOL;\n\tout : BOOL;\nEND_VAR",
            _ => null, () => Array.Empty<string>());
        var r = NetworkTextReader.Read(Src("out := g5;"), scope);
        Assert.True(r.Ok, string.Join("\n", r.Diagnostics.Select(d => $"{d.Line} {d.Code} {d.Message}")));
        var assign = Assert.IsType<Assign>(Assert.Single(Assert.Single(r.Body!.Networks).Trees));
        Assert.Equal("g5", Assert.IsType<Leaf>(assign.Value).Operand.Text);
    }

    /// <summary>Review of section 2: backticked, a wire-shaped name is verbatim text — the variable of that name,
    /// which the scope may not hold — and that IS its canonical form. The gate re-spelled it bare, its own reader
    /// refused that, and the push crashed on text the reader had accepted. Declared, the bare name is canonical.</summary>
    [Fact]
    public void A_backticked_wire_shaped_name_in_no_scope_is_the_variable_and_canonical()
    {
        Accepted(Src("out := `g5`;"));
        Accepted(Src("`g5` := a;"));
        Accepted(Src("out := `G12`;"), Names("out", "a"));
        Accepted(Src("`g5` := a;"), Names("out", "a"));
        Refused("NETWORK_NOT_CANONICAL", 3, Src("out := `g5`;"), Names("g5"));
    }

    /// <summary>A SECOND OR LATE VAR_TEMP BLOCK IS LAYOUT (openspec <c>bridge-refusal-review</c> 2.7): the model it reads
    /// to is the one a single block reads to, and the writer canonicalizes it to one block before the first statement on
    /// the next pull. It used to be refused — a rule that existed to make the canonical gate pass. Read in text order: a
    /// wire is a wire from its declaration on.</summary>
    [Fact]
    public void A_second_wire_block_is_read_into_the_same_model()
    {
        var r = NetworkTextReader.Read(Src("VAR_TEMP g1 : BOOL; END_VAR", "g1 := TRUE;", "VAR_TEMP g2 : BOOL; END_VAR", "g2 := g1;", "out := g2;"), Names("out"));
        Assert.True(r.Ok, string.Join("\n", r.Diagnostics.Select(d => $"{d.Line} {d.Code} {d.Message}")));
        var one = NetworkTextReader.Read(Src("VAR_TEMP g1, g2 : BOOL; END_VAR", "g1 := TRUE;", "g2 := g1;", "out := g2;"), Names("out"));
        Assert.Equal(NetworkTextWriter.Write(one.Body!, Names("out")), NetworkTextWriter.Write(r.Body!, Names("out")));
    }

    /// <summary>…but a LATE block may not make a name a wire that the network already READ as a variable (1+2d review):
    /// with a scope variable <c>g1</c>, <c>out := g1;</c> before the block and <c>out2 := g1;</c> after it would spell two
    /// different things the same way, and the canonical rewrite showed it only after the push had landed. Refused at the
    /// declaration, naming the earlier use.</summary>
    [Theory]
    [InlineData("out := g1;")]
    [InlineData("g1 := a;")]
    public void A_late_wire_block_may_not_take_a_name_already_used_as_a_variable(string earlier)
    {
        Refused("NETWORK_DUPLICATE_NAME", 4,
            Src(earlier, "VAR_TEMP g1 : BOOL; END_VAR", "g1 := (a AND b);", "out2 := g1;"), Names("g1", "out", "out2", "a", "b"));
    }

    [Fact]
    public void A_wire_block_after_a_statement_is_read()
    {
        var r = NetworkTextReader.Read(Src("out := a;", "VAR_TEMP g1 : BOOL; END_VAR", "g1 := TRUE;", "lamp := g1;"), Names("out", "a", "lamp"));
        Assert.True(r.Ok, string.Join("\n", r.Diagnostics.Select(d => $"{d.Line} {d.Code} {d.Message}")));
        Assert.Equal(1, Assert.IsType<Demux>(r.Body!.Networks[0].Trees[1]).VarId);
    }

    /// <summary>AN EMPTY VAR_TEMP BLOCK IS LAYOUT (2.9): it declares nothing, the model is the one without it.</summary>
    [Fact]
    public void An_empty_wire_block_is_read()
    {
        var r = NetworkTextReader.Read(Src("VAR_TEMP END_VAR", "out := a;"), Names("out", "a"));
        Assert.True(r.Ok, string.Join("\n", r.Diagnostics.Select(d => $"{d.Line} {d.Code} {d.Message}")));
        Assert.IsType<Assign>(Assert.Single(Assert.Single(r.Body!.Networks).Trees));
    }

    /// <summary>Spec, "a wire not named g&lt;digits&gt;".</summary>
    [Fact]
    public void A_wire_not_named_g_digits() =>
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("VAR_TEMP speed : BOOL; END_VAR", "speed := TRUE;"));

    /// <summary>Spec, "a wire referenced but never defined": the reference has no producer to read, so it is refused
    /// where it stands.</summary>
    [Fact]
    public void A_wire_referenced_and_never_defined() =>
        Refused("NETWORK_BAD_EXPRESSION", 4, Src("VAR_TEMP g1 : BOOL; END_VAR", "out := g1;"));

    /// <summary>A WIRE DECLARED AND NEVER USED is a lint, not a refusal (openspec <c>bridge-refusal-review</c> 2.8): no
    /// Demux carries it, the model is complete, and the writer drops the declaration on the next pull.</summary>
    [Fact]
    public void A_wire_declared_and_never_defined_or_used_is_dropped_from_the_model()
    {
        var r = NetworkTextReader.Read(Src("VAR_TEMP g1 : BOOL; END_VAR", "out := a;"), Names("out", "a"));
        Assert.True(r.Ok, string.Join("\n", r.Diagnostics.Select(d => $"{d.Line} {d.Code} {d.Message}")));
        Assert.IsType<Assign>(Assert.Single(Assert.Single(r.Body!.Networks).Trees));
        Assert.DoesNotContain("VAR_TEMP", NetworkTextWriter.Write(r.Body!, Names("out", "a")));
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

    /// <summary>Task 2.5, spec "the gate SHALL NOT refuse a consumed enabled box for lacking `.ENO`". These were
    /// "a missing ENO is refused" — a premise census 1.6 measured false (DIALECT N16: EN and ENO are independent; 40
    /// enabled comparisons are consumed by their one data output). The text is valid; whether the IDE's box has an
    /// ENO main output the consumer must say `.ENO` for is the PUSH's to check against the box it builds.
    /// <c>GT(ADD(EN := x, a, b), c)</c> is the re-decided case: it reads as GT consuming ADD's main output, no ENO.</summary>
    [Fact]
    public void A_consumed_enabled_box_without_ENO_is_valid_text()
    {
        Accepted(Src("lamp := MOVE(EN := c, 0, => Status);"));
        Accepted(Src("out := GT(EN := c, a, b);"));
        // Its canonical form is the group (GT with no EN is infix): accepted, and ADD reads as consumed by its main
        // output with no ENO — the call form, not canonical, reads to the same model.
        Accepted(Src("out := (ADD(EN := x, a, b) > c);"));
        var read = NetworkTextReader.Read(Src("out := GT(ADD(EN := x, a, b), c);"), NetworkScope.Empty);
        Assert.True(read.Ok);
        var add = Assert.IsType<Box>(Assert.IsType<Box>(Assert.IsType<Assign>(read.Body!.Networks[0].Trees.Single()).Value).Inputs[0].Value);
        Assert.Equal((0, false), (add.ConnectedSlot, add.HasEnoOutput));
    }

    /// <summary>`.ENO` means "connected to the ENO output", never "the box has EN" (spec; census 1.6: Lenze
    /// <c>Dryer</c> declares ENO without EN), so it is valid on a box without EN. On a box nothing consumes it is
    /// refused: a top-level box's output goes nowhere.</summary>
    [Fact]
    public void ENO_on_a_box_without_EN_is_valid_and_on_a_box_nothing_consumes_is_not()
    {
        Accepted(Src("out := f(a).ENO;"));
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("MOVE(EN := c, 0).ENO;"));
        // Spec, ".ENO on a box nothing consumes": the Execute box's value form at the top level likewise.
        Refused("NETWORK_BAD_EXPRESSION", 3, FbdMarker + "NETWORK\n  EXECUTE\nx := 1;\n  END_EXECUTE.ENO;\nEND_NETWORK\n");
    }

    [Fact]
    public void A_consumed_execute_box_says_ENO() =>
        Refused("NETWORK_BAD_EXPRESSION", 3, FbdMarker + "NETWORK\n  out := EXECUTE\nx := 1;\n  END_EXECUTE;\nEND_NETWORK\n");

    /// <summary>Spec, "negation with an edge" and "a negation outside an edge": <c>R_EDGE(NOT x)</c> is the one
    /// spelling (the vendor negates first, DIALECT N17); <c>NOT R_EDGE(x)</c> states logic no vendor operand holds,
    /// and any modifier inside an edge but that one <c>NOT</c> is refused.</summary>
    [Fact]
    public void A_negation_goes_inside_an_edge_and_nowhere_else()
    {
        Accepted(Src("out := R_EDGE(NOT x);"));
        Accepted(Src("out := F_EDGE(NOT (a AND b));"));
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("out := NOT R_EDGE(x);"));
        Refused("NETWORK_BAD_EXPRESSION", 3, Src("out := R_EDGE(NOT NOT x);"));
        Refused("NETWORK_UNSUPPORTED", 3, Src("out := R_EDGE(NOT F_EDGE(x));"));
    }

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

    /// <summary>Spec, "a POU named like an edge word": a POU or an FB instance of that name — a variable of it
    /// never heads a call, and blocks nothing.</summary>
    [Fact]
    public void A_POU_or_instance_named_like_a_construct()
    {
        Refused("NETWORK_UNSUPPORTED", 3, Src("out := R_EDGE(x);"), Pous("R_EDGE"));
        Refused("NETWORK_UNSUPPORTED", 3, Src("out := PARALLEL(a, b);"), Pous("Parallel"));
        Refused("NETWORK_UNSUPPORTED", 3, Src("out := F_EDGE(x);"),
            new NetworkScope(Array.Empty<string>(), Array.Empty<string>(), new Dictionary<string, string> { ["f_edge"] = "F_TRIG" }));
        Accepted(Src("out := R_EDGE(x);"), Names("R_EDGE"));
        Accepted(Src("out := PARALLEL(a, b);"), Names("Parallel"));
    }

    [Fact]
    public void Nested_edges() =>
        Refused("NETWORK_UNSUPPORTED", 3, Src("out := R_EDGE(F_EDGE(x));"));

    /// <summary>Spec, "a flag on a wire reference or a Parallel": the IDE holds no flag on a <c>BoxTreeDemux</c> or a
    /// <c>BoxTreeParallel</c> (DIALECT N20), so the text refuses one by name instead of pushing logic the IDE drops.</summary>
    [Fact]
    public void A_flag_on_a_wire_reference_or_a_Parallel()
    {
        const string wire = "VAR_TEMP g3 : BOOL; END_VAR";
        Refused("NETWORK_UNSUPPORTED", 5, Src(wire, "g3 := a;", "out := NOT g3;"));
        Refused("NETWORK_UNSUPPORTED", 5, Src(wire, "g3 := a;", "out := R_EDGE(g3);"));
        Refused("NETWORK_UNSUPPORTED", 3, Src("out := NOT PARALLEL(a, b);"));
        Refused("NETWORK_UNSUPPORTED", 3, Src("out := R_EDGE(PARALLEL(a, b));"));
        // The flag on the wire's PRODUCER, and on a Parallel's branch, are the vendor's own and stay.
        Accepted(Src(wire, "g3 := NOT a;", "out := g3;"));
        Accepted(Src("out := PARALLEL(NOT a, b);"));
    }

    /// <summary>Spec, "a flag on an empty slot".</summary>
    [Fact]
    public void A_flag_on_an_empty_slot() =>
        Refused("NETWORK_UNSUPPORTED", 3, Src("f(NOT , a);"));

    /// <summary>Census 1.2, the Parallel half: an unfed Parallel is <c>PARALLEL(a, b)</c>; a feed wired to nothing
    /// occurs in no project (0 of 17), so <c>IN := ,</c> is refused by name rather than a second "no feed".</summary>
    [Fact]
    public void A_Parallel_feed_wired_to_nothing() =>
        Assert.Contains("empty terminator", Refused("NETWORK_UNSUPPORTED", 3, Src("out := PARALLEL(IN := , a, b);")).Message);

    [Fact]
    public void An_unmeasured_Parallel_mode() =>
        Refused("NETWORK_UNSUPPORTED", 3, Src("out := PARALLEL(MODE := Eager, a, b);"));

    // ── accepted as the spec says ───────────────────────────────────────────────────────────────

    /// <summary>Spec, "a jump to a missing label" and "a disabled network that is a jump target".</summary>
    [Fact]
    public void Labels_are_the_compilers_business()
    {
        Accepted(Src("JMP Nowhere;"));
        Accepted(FbdMarker + "NETWORK\n  JMP Done;\nEND_NETWORK\nNETWORK LABEL: Done DISABLED\n  out := a;\nEND_NETWORK\n");
    }

    /// <summary>Spec, "labels and jumps round-trip what the IDE holds" (census 1.15, DIALECT N19): a <c>JMP</c> inside a
    /// DISABLED network is held by both IDEs (the build reports the label as unreferenced), so it round-trips — the
    /// jump stays in the disabled network, as a jump.</summary>
    [Fact]
    public void A_jump_inside_a_disabled_network_round_trips()
    {
        var text = FbdMarker + "NETWORK DISABLED\n  JMP Done;\nEND_NETWORK\nNETWORK LABEL: Done\n  out := a;\nEND_NETWORK\n";
        Accepted(text);
        var body = NetworkTextReader.Read(text, NetworkScope.Empty).Body!;
        Assert.True(body.Networks[0].Disabled);
        var jump = Assert.IsType<Assign>(Assert.Single(body.Networks[0].Trees));
        Assert.True(jump.Flags.Jump);
        Assert.Equal("Done", Assert.Single(jump.Targets).Text);
        Assert.Equal(text, NetworkTextWriter.Write(body, NetworkScope.Empty));
    }

    /// <summary>Spec, "a label on two networks" (census 1.15, DIALECT N19): both IDEs hold one label on two networks,
    /// case-differing or not — their build reports <c>The label 'DONE' is a duplicate</c> — so the push is accepted and
    /// each label travels verbatim.</summary>
    [Fact]
    public void A_label_on_two_networks_is_accepted_and_kept_verbatim()
    {
        var text = FbdMarker + "NETWORK LABEL: Done\n  out := a;\nEND_NETWORK\nNETWORK LABEL: DONE\n  out := b;\nEND_NETWORK\n";
        Accepted(text);
        var body = NetworkTextReader.Read(text, NetworkScope.Empty).Body!;
        Assert.Equal(new[] { "Done", "DONE" }, body.Networks.Select(n => n.Label));
        Assert.Equal(text, NetworkTextWriter.Write(body, NetworkScope.Empty));
    }

    /// <summary>Spec, "a comment on a fully-headed network".</summary>
    [Fact]
    public void A_fully_headed_network_in_canonical_order() =>
        Accepted(FbdMarker + "NETWORK LABEL: Done TITLE: \"Tray $\"A$\" ready\" DISABLED\n  // note\n  VAR_TEMP g0 : BOOL; END_VAR\n  g0 := TRUE;\n  out := g0;\nEND_NETWORK\n");

    /// <summary>Spec, "the writer avoids a collision … and the reader accepts it".</summary>
    [Fact]
    public void The_writers_renamed_wire_is_accepted()
    {
        var scope = Names("G3");
        var text = NetworkTextWriter.Write(
            new NetworkBody(BodyLanguage.Fbd, new[] { NetworkModels.Net(NetworkModels.Def(3, NetworkModels.L("TRUE")), NetworkModels.Set(NetworkModels.Ref(3), NetworkModels.T("out"))) }),
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
            LdMarker + "NETWORK\n  VAR_TEMP g1 : INT; END_VAR\n  g1 := x;\n  o := g1;\nEND_NETWORK\n");
        Assert.Contains("BOOL", d.Message);
    }

    /// <summary>A bit operator's wire is BOOL or another bit-string type; a numeric type is refused, naming both.</summary>
    [Fact]
    public void A_bit_operator_wire_accepts_a_bit_string_type()
    {
        Accepted(Src("VAR_TEMP g5 : WORD; END_VAR", "g5 := (w1 AND w2);", "o := g5;"));
        Assert.Contains("BOOL", Refused("NETWORK_BAD_EXPRESSION", 3, Src("VAR_TEMP g5 : REAL; END_VAR", "g5 := (w1 AND w2);", "o := g5;")).Message);
    }

    // ── the post-push comparison (review of section 3) ──────────────────────────────────────────

    /// <summary><see cref="NetworkTextGate.SameTokens"/> — the CLI's question after a push: is the IDE's text a
    /// re-layout of the pushed one? A wrapped call is; a changed pin, marker or ST line inside an EXECUTE body (whose
    /// whitespace is content, as the gate says) is not.</summary>
    [Theory]
    [InlineData("  t1(IN := a, PT := pt);", "  t1(\n    IN := a,\n    PT := pt\n  );", true)]
    [InlineData("  t1(IN := a, PT := pt);", "  t1(IN := a);", false)]
    [InlineData("  EXECUTE\nx := 1;\n  END_EXECUTE;", "  EXECUTE\n    x := 1;\n  END_EXECUTE;", false)]
    [InlineData("  EXECUTE(EN := (a AND b))\nx := 1;\n  END_EXECUTE;", "  EXECUTE(EN := ( a AND b ))\nx := 1;\n  END_EXECUTE;", true)]
    [InlineData("  x := `a  b`;", "  x := `a b`;", false)]
    public void Two_bodies_are_the_same_tokens_only_but_for_layout(string a, string b, bool same) =>
        Assert.Equal(same, NetworkTextGate.SameTokens(Src(a.TrimStart()), Src(b.TrimStart())));

    [Fact]
    public void Two_markers_are_two_texts() =>
        Assert.False(NetworkTextGate.SameTokens(Src("x := a;"), LdSrc("x := a;")));

    /// <summary>The comparison after a push and the gate agree on what LAYOUT is: whatever the gate accepts as the
    /// canonical form's equal is the same tokens as that canonical form. The gate compares a VAR_TEMP block by what it
    /// declares — grouping and order are free — so a push declaring <c>g1 : BOOL; g2 : BOOL;</c> comes back from the IDE
    /// as <c>g1, g2 : BOOL;</c>, and that is a layout, not an IDE change (spec, "a hand layout does not come back as an
    /// IDE change").</summary>
    [Theory]
    [InlineData("VAR_TEMP g1 : BOOL; g2 : BOOL; END_VAR")]
    [InlineData("VAR_TEMP g2 : BOOL; g1 : BOOL; END_VAR")]
    [InlineData("VAR_TEMP\n    g2, g1 :\n BOOL;\n  END_VAR")]
    public void A_wire_block_the_gate_accepts_is_the_same_tokens_as_its_canonical_form(string block)
    {
        var text = Src(block, "g1 := (a AND b);", "g2 := (c AND d);", "o := (g1 OR g2);");
        var g = Gate(text);
        Assert.True(g.Ok, string.Join("\n", g.Diagnostics.Select(d => d.Message)));
        Assert.True(NetworkTextGate.SameTokens(text, g.Canonical!));
    }

    /// <summary>…and a wire block that DECLARES something else is another text: a wire's type is content.</summary>
    [Fact]
    public void A_wire_block_declaring_another_type_is_another_text() =>
        Assert.False(NetworkTextGate.SameTokens(
            Src("VAR_TEMP g1 : WORD; END_VAR", "g1 := (a AND b);", "o := g1;"),
            Src("VAR_TEMP g1 : BOOL; END_VAR", "g1 := (a AND b);", "o := g1;")));

    /// <summary>An EXECUTE nested in another's pin list opens its own verbatim body, where the reader opens it: the ST
    /// inside it is compared whole, so a changed space in a string literal is another program, while a re-wrapped pin
    /// list around it is only layout.</summary>
    [Theory]
    [InlineData("s := 'a  b';", "  EXECUTE(EN := EXECUTE\n s := 'a b';\nEND_EXECUTE.ENO)\n y := 1;\nEND_EXECUTE.ENO;", false)]
    [InlineData("s := 'a b';", "  EXECUTE(\n    EN := EXECUTE\n s := 'a b';\nEND_EXECUTE.ENO\n  )\n y := 1;\nEND_EXECUTE.ENO;", true)]
    public void An_EXECUTE_nested_in_a_pin_list_keeps_its_body_verbatim(string inner, string other, bool same)
    {
        var a = Src("out := EXECUTE(EN := EXECUTE\n " + inner + "\nEND_EXECUTE.ENO)\n y := 1;\nEND_EXECUTE.ENO;");
        Assert.Equal(same, NetworkTextGate.SameTokens(a, Src("out :=" + other.Substring(1))));
    }

    // ── the third section-3 review ──────────────────────────────────────────────────────────────

    /// <summary>A TITLE or comment fact no driver stores is not canonical. Both vendor readers trim a network's title
    /// and comment at the end (an empty one is none), and both writers compare ignoring trailing whitespace — so a
    /// trailing space, an empty title, a lone <c>//</c> or a closing empty <c>//</c> line would be pushed, never
    /// written, and come back from the IDE as another text (spec, "the network header and its comment": the drivers
    /// compare a comment ignoring trailing whitespace).</summary>
    [Theory]
    [InlineData("NETWORK TITLE: \"t  \"\n  out := a;\nEND_NETWORK\n", 2)]
    [InlineData("NETWORK TITLE: \"\"\n  out := a;\nEND_NETWORK\n", 2)]
    [InlineData("NETWORK TITLE: \"   \"\n  out := a;\nEND_NETWORK\n", 2)]
    [InlineData("NETWORK\n  //\n  out := a;\nEND_NETWORK\n", 3)]
    [InlineData("NETWORK\n  // one\n  //\n  out := a;\nEND_NETWORK\n", 4)]
    [InlineData("NETWORK\n  // one   \n  out := a;\nEND_NETWORK\n", 3)]
    public void A_title_or_comment_the_drivers_do_not_store_is_not_canonical(string network, int line) =>
        Refused("NETWORK_NOT_CANONICAL", line, FbdMarker + network);

    /// <summary>…while trailing whitespace INSIDE a comment, before its last line, is text the drivers store and
    /// compare: only the comment's end is trimmed.</summary>
    [Fact]
    public void Trailing_whitespace_on_an_inner_comment_line_is_the_comments_text() =>
        Accepted(FbdMarker + "NETWORK TITLE: \"t\"\n  // one   \n  // two\n  out := a;\nEND_NETWORK\n");

    static string LabelledExecute(string value) =>
        FbdMarker + "NETWORK LABEL: Execute\n  out := " + value + ";\nEND_NETWORK\n" +
        "NETWORK\n  IF go THEN JMP Execute; END_IF;\nEND_NETWORK\n";

    /// <summary>A label spelled <c>Execute</c> opens no EXECUTE body — the reader opens one only in value position, and
    /// the post-push comparison walks the text by that one rule. Entered at the label, the walk swallowed the rest of
    /// the text into one error token and called two different programs the same tokens, which adopts the IDE's other
    /// program as a layout (spec, "an IDE holding other tokens is not adopted as a layout").</summary>
    [Fact]
    public void A_label_named_Execute_opens_no_body_in_the_post_push_comparison()
    {
        Accepted(LabelledExecute("(a OR b)"));
        Assert.False(NetworkTextGate.SameTokens(LabelledExecute("(a AND b)"), LabelledExecute("(a OR b)")));
        Assert.True(NetworkTextGate.SameTokens(LabelledExecute("(a OR b)"), LabelledExecute("( a OR\n    b )")));
    }

    /// <summary>Two texts that do not lex are no layouts of each other: an error token is no token of a body, so two
    /// failures with one message say nothing about the programs behind them.</summary>
    [Fact]
    public void Two_texts_that_do_not_lex_are_not_the_same_tokens() =>
        Assert.False(NetworkTextGate.SameTokens(Src("x := `a;"), Src("x := `b AND c;")));

    static string TypedWire(string type) =>
        Src("VAR_TEMP g1 : " + type + "; END_VAR", "g1 := CONCAT(a, b);", "out := g1;");

    /// <summary>A wire's declared type is TOKENS, like every other part of the text outside backticks, a TITLE, a
    /// comment and an EXECUTE body: <c>STRING (80)</c> is <c>STRING(80)</c> laid out otherwise. Compared as a
    /// whitespace-collapsed substring, it was another text, and the canonical form echoed the engineer's layout.</summary>
    [Fact]
    public void A_wire_type_is_compared_as_tokens()
    {
        Assert.True(NetworkTextGate.SameTokens(TypedWire("STRING (80)"), TypedWire("STRING(80)")));
        Assert.True(NetworkTextGate.SameTokens(TypedWire("ARRAY [1..2] OF INT"), TypedWire("ARRAY[1 .. 2]  OF\n INT")));
        Assert.False(NetworkTextGate.SameTokens(TypedWire("STRING(80)"), TypedWire("STRING(81)")));

        var spaced = Gate(TypedWire("STRING (80)"));
        var tight = Gate(TypedWire("STRING(80)"));
        Assert.True(spaced.Ok && tight.Ok, string.Join("\n", spaced.Diagnostics.Concat(tight.Diagnostics).Select(d => d.Message)));
        Assert.Equal(tight.Canonical, spaced.Canonical);
    }
}
