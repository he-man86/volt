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

    static NextNetworkScope Names(params string[] names) => new(names, Array.Empty<string>(), new Dictionary<string, string>());

    static NextNetworkScope Pous(params string[] pous) => new(Array.Empty<string>(), pous, new Dictionary<string, string>());

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

    /// <summary>Task 2.8 / review 7.14: EXECUTE is a statement like IF, and its <c>;</c> is its own — without it the
    /// body is refused, whether the box stands alone or feeds a consumer, and never read as an empty item either
    /// way. With it, the <c>;</c> closes the box and creates no item.</summary>
    [Fact]
    public void END_EXECUTE_without_its_semicolon()
    {
        // Reported where the `;` is missing - at the token found instead, as for `END_IF` above.
        Refused("NETWORK_PARSE", 6, Fbd + "NETWORK\n  EXECUTE\nx := 1;\n  END_EXECUTE\nEND_NETWORK\n");
        Refused("NETWORK_PARSE", 6, Fbd + "NETWORK\n  out := EXECUTE\nx := 1;\n  END_EXECUTE.ENO\nEND_NETWORK\n");
        var ok = Gate(Fbd + "NETWORK\n  EXECUTE\nx := 1;\n  END_EXECUTE;\nEND_NETWORK\n");
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
        var scope = new NextNetworkScope(Array.Empty<string>(), Array.Empty<string>(), new Dictionary<string, string> { ["fb"] = "FB_Big" });
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

    /// <summary>Task 2.6 / review 7.2: the reserved set is EVERY name the body can see, not only the POU's own
    /// variables — a global (a GVL's <c>G1</c>, visible unqualified) and, in a method or action, the owning FB's
    /// member (<c>G2</c>). Each is refused by name on read, case-insensitively; the writer renames around each, and
    /// the reader accepts the renamed wire against the SAME scope. (Collecting the globals and the owning FB's members
    /// into that scope from the declarations is task 3.9's; here the scope states them.)</summary>
    [Theory]
    [InlineData("G1", "a global")]
    [InlineData("G2", "the owning FB's member seen from a method")]
    public void A_wire_named_like_a_global_or_an_FB_member_seen_from_a_method(string name, string what)
    {
        var scope = Names(name);
        var wire = name.ToLowerInvariant();
        var d = Refused("NETWORK_DUPLICATE_NAME", 3, Src($"VAR_TEMP {wire} : BOOL; END_VAR", $"{wire} := TRUE;", $"out := {wire};"), scope);
        Assert.True(d.Message.Contains(wire), what + ": " + d.Message);

        var id = int.Parse(name.Substring(1));
        var written = NextNetworkTextWriter.Write(new NetworkBody(BodyLanguage.Fbd, new[]
        {
            new Network(0, null, null, null, false, new Node[]
            {
                new Demux(id, new Leaf(new Operand("TRUE"), Flags.None)),
                new Assign(new Demux(id, null), new[] { new Operand("out", IsLValue: true) }, Flags.None),
            }),
        }), scope);
        Assert.Equal(Src("VAR_TEMP g0 : BOOL; END_VAR", "g0 := TRUE;", "out := g0;"), written);
        Accepted(written, scope);
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
        var read = NextNetworkTextReader.Read(Src("out := GT(ADD(EN := x, a, b), c);"), BodyLanguage.Fbd, NextNetworkScope.Empty);
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
    }

    [Fact]
    public void A_consumed_execute_box_says_ENO() =>
        Refused("NETWORK_BAD_EXPRESSION", 3, Fbd + "NETWORK\n  out := EXECUTE\nx := 1;\n  END_EXECUTE;\nEND_NETWORK\n");

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
            new NextNetworkScope(Array.Empty<string>(), Array.Empty<string>(), new Dictionary<string, string> { ["f_edge"] = "F_TRIG" }));
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
        Accepted(Fbd + "NETWORK\n  JMP Done;\nEND_NETWORK\nNETWORK LABEL: Done DISABLED\n  out := a;\nEND_NETWORK\n");
    }

    /// <summary>Spec, "labels and jumps round-trip what the IDE holds" (census 1.15, DIALECT N19): a <c>JMP</c> inside a
    /// DISABLED network is held by both IDEs (the build reports the label as unreferenced), so it round-trips — the
    /// jump stays in the disabled network, as a jump.</summary>
    [Fact]
    public void A_jump_inside_a_disabled_network_round_trips()
    {
        var text = Fbd + "NETWORK DISABLED\n  JMP Done;\nEND_NETWORK\nNETWORK LABEL: Done\n  out := a;\nEND_NETWORK\n";
        Accepted(text);
        var body = NextNetworkTextReader.Read(text, BodyLanguage.Fbd, NextNetworkScope.Empty).Body!;
        Assert.True(body.Networks[0].Disabled);
        var jump = Assert.IsType<Assign>(Assert.Single(body.Networks[0].Trees));
        Assert.True(jump.Flags.Jump);
        Assert.Equal("Done", Assert.Single(jump.Targets).Text);
        Assert.Equal(text, NextNetworkTextWriter.Write(body, NextNetworkScope.Empty));
    }

    /// <summary>Spec, "a label on two networks" (census 1.15, DIALECT N19): both IDEs hold one label on two networks,
    /// case-differing or not — their build reports <c>The label 'DONE' is a duplicate</c> — so the push is accepted and
    /// each label travels verbatim.</summary>
    [Fact]
    public void A_label_on_two_networks_is_accepted_and_kept_verbatim()
    {
        var text = Fbd + "NETWORK LABEL: Done\n  out := a;\nEND_NETWORK\nNETWORK LABEL: DONE\n  out := b;\nEND_NETWORK\n";
        Accepted(text);
        var body = NextNetworkTextReader.Read(text, BodyLanguage.Fbd, NextNetworkScope.Empty).Body!;
        Assert.Equal(new[] { "Done", "DONE" }, body.Networks.Select(n => n.Label));
        Assert.Equal(text, NextNetworkTextWriter.Write(body, NextNetworkScope.Empty));
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
