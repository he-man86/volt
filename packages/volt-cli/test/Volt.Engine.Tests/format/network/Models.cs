using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.Network;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Engine.Tests;

/// <summary>
/// Model builders for the network text v2 reader and gate tests, and <see cref="WriterGoldens"/> — every model
/// <c>NetworkTextWriterTests</c> writes successfully, rebuilt here field for field so the model oracle
/// <c>Read(Write(m)) ≅ m</c> runs over exactly the shapes the writer goldens pin. (Copied rather than shared:
/// the writer tests stay as they were written, and a model changed there does not silently change the oracle.)
/// </summary>
internal static class NetworkModels
{
    public static Leaf L(string text, Flags? f = null) => new(new Operand(text), f ?? Flags.None);
    public static Operand T(string text, Flags? f = null) => new(text, IsLValue: true, Flags: f);
    public static Terminator Empty => new(Flags.None);
    public static Input In(Node v, string? formal = null) => new(formal, v, Flags.None);
    public static Demux Ref(int id) => new(id, null);
    public static Demux Def(int id, Node v, string? type = null) => new(id, v, type);
    public static Assign Set(Node v, params Operand[] targets) => new(v, targets, Flags.None);
    public static readonly Flags Neg = Flags.None with { Negated = true };
    public static readonly Flags Rise = Flags.None with { Rising = true };
    public static readonly Flags Fall = Flags.None with { Falling = true };
    public static readonly Flags SetBit = Flags.None with { Set = true };
    public static readonly Flags ResetBit = Flags.None with { Reset = true };
    public static readonly Flags JumpBit = Flags.None with { Jump = true };
    public static readonly Flags ReturnBit = Flags.None with { Return = true };

    public static Box Op(string type, params Node[] inputs) =>
        new(type, null, CallKind.Operator, inputs.Select(i => In(i)).ToList(), new List<Output>(), null, null, Flags.None);

    public static Box Call(string type, IEnumerable<Input> inputs, IEnumerable<Output>? outputs = null, Node? en = null,
                           int? main = 0, int? connected = null, Flags? f = null, Operand? instance = null,
                           CallKind kind = CallKind.Function, IReadOnlyList<string?>? types = null, bool? eno = null) =>
        new(type, instance, kind, inputs.ToList(), (outputs ?? Array.Empty<Output>()).ToList(), en, null, f ?? Flags.None,
            MainOutputIndex: main, ConnectedSlot: connected, OutputTypes: types, HasEnoOutput: eno);

    public static Box Fb(string instance, IEnumerable<Input> inputs, IEnumerable<Output>? outputs = null, string type = "FB") =>
        Call(type, inputs, outputs, main: null, instance: new Operand(instance, IsInstance: true), kind: CallKind.FunctionBlock);

    public static Box Exec(string st, Node? en = null, int? connected = null) =>
        new("EXECUTE", null, CallKind.Function, new List<Input>(), new List<Output>(), en, st, Flags.None,
            ConnectedSlot: connected);

    public static Output Out(string target, int? slot, string? formal = null) => new(formal, new Operand(target, IsLValue: true), slot);

    /// <summary>A box showing EN/ENO (<c>OutputParams.Names = ['ENO', …]</c>, <c>MainOutputIndex</c> 0): consumed,
    /// it is read through its ENO; at the top level it is connected by nothing. <paramref name="types"/> are its
    /// stored output types, none given = not read.</summary>
    public static Box EnEno(string type, Node en, IEnumerable<Input> inputs, IEnumerable<Output>? outputs = null,
                            bool consumed = false, params string?[] types) =>
        Call(type, inputs, outputs, en: en, main: 0, connected: consumed ? 0 : null, eno: true,
            types: types.Length == 0 ? null : types, kind: NetworkSpelling.KindOf(type, hasInstance: false));

    // ── source text ─────────────────────────────────────────────────────────────────────────────

    public const string FbdMarker = "IMPLEMENTATION FBD\n";
    public const string LdMarker = "IMPLEMENTATION LD\n";

    /// <summary>A one-network FBD body holding exactly these statement lines, in the page's layout (two-space
    /// statement indentation).</summary>
    public static string Src(params string[] lines) => OneNetwork(FbdMarker, lines);

    /// <summary>A one-network LD body holding exactly these statement lines.</summary>
    public static string LdSrc(params string[] lines) => OneNetwork(LdMarker, lines);

    private static string OneNetwork(string marker, string[] lines) =>
        marker + "NETWORK\n" + string.Concat(lines.Select(l => "  " + l + "\n")) + "END_NETWORK\n";

    public static NetworkBody Fbd1(params Node[] trees) => new(BodyLanguage.Fbd, new[] { Net(trees) });
    public static NetworkBody Ld1(params Node[] trees) => new(BodyLanguage.Ld, new[] { Net(trees) });

    public static Network Net(params Node[] trees) => new(0, null, null, null, false, trees);

    public static NetworkBody Body(Network net, BodyLanguage lang = BodyLanguage.Fbd) => new(lang, new[] { net });
    public static NetworkBody Body(Node tree, BodyLanguage lang = BodyLanguage.Fbd) => Body(Net(tree), lang);

    /// <summary>The scope a model's text needs to be read back: its FB instances (the declarations would carry
    /// them) plus <paramref name="names"/>.</summary>
    public static NetworkScope ScopeOf(NetworkBody body, params string[] names) =>
        new(names, Array.Empty<string>(), NetworkModelOracle.Instances(body));

    /// <summary>Every model <c>NetworkTextWriterTests</c> writes without refusing, keyed by the test that pins it
    /// (<c>Test</c> or <c>Test/variant</c>) — held to that list by <c>Every_writer_test_is_a_golden_or_says_why_not</c>.</summary>
    public static readonly IReadOnlyDictionary<string, NetworkBody> WriterGoldens = BuildGoldens();

    private static Dictionary<string, NetworkBody> BuildGoldens()
    {
        var g = new Dictionary<string, NetworkBody>();
        void Add(string name, NetworkBody b) => g.Add(name, b);

        Add("The_language_rides_on_the_implementation_marker_and_the_header_has_no_order_number/ld-empty-item", Body(Empty, BodyLanguage.Ld));
        Add("The_language_rides_on_the_implementation_marker_and_the_header_has_no_order_number/order-7", Body(new Network(7, null, null, null, false, new Node[] { Empty })));
        Add("Header_comment_wire_block_and_statements_in_that_order", Body(new Network(0, "Tray \"A\" ready", "Done",
            "Indented notes keep their indentation:\n    step 1 — wait for the tray\n\n// a line that itself starts with two slashes",
            true, new Node[] { Def(0, L("TRUE")) })));
        Add("A_multi_line_comment_keeps_its_shape", Body(new Network(0, null, null, "step:\n\n    indented\n// quoted", false, new Node[] { Set(L("a"), T("out")) })));
        Add("A_title_with_a_newline_and_a_dollar_is_escaped", Body(new Network(0, "line 1\nline 2 costs $5", null, null, false, new Node[] { Empty })));
        Add("A_flagged_top_level_box_is_a_value_statement", Body(Call("f", new[] { In(L("x")) }, f: Neg)));
        Add("A_box_with_no_input_slot", Body(Call("GetTime", Array.Empty<Input>())));
        Add("A_top_level_leaf_wire_reference_and_parallel_are_value_statements/leaf", Body(L("a")));
        Add("A_top_level_leaf_wire_reference_and_parallel_are_value_statements/parallel", Body(new Parallel(null, new Node[] { L("a"), L("b") }, ParallelMode.BoxShortCircuit)));
        Add("A_top_level_leaf_wire_reference_and_parallel_are_value_statements/wire-ref", Body(Net(Def(1, L("TRUE")), Ref(1))));
        Add("The_empty_item_is_a_semicolon_on_its_own_line", Body(Net(Set(L("a"), T("out")), Empty)));
        Add("An_operand_that_is_not_one_token_is_backticked_in_place/in-pin", Body(Fb("t1", new[] { In(L("DINT_TO_REAL(x)"), "IN") })));
        Add("An_operand_that_is_not_one_token_is_backticked_in_place/typed-call", Body(Fb("fb", new[] { In(L("fc_dinttotime(T.Start,2)"), "P") })));
        Add("Lvalues_that_are_not_one_token_are_backticked/index", Body(Set(L("x"), T("arr[i + 1]"))));
        Add("Lvalues_that_are_not_one_token_are_backticked/space", Body(Set(L("x"), T("a .b"))));
        Add("Tokens_stay_bare", Body(Set(Op("OR", Op("AND", L("s.f"), L("T#1S")), L("???")), T("out"))));
        Add("Infix_groups_and_the_NOT_box/nested", Body(Set(Op("OR", Op("AND", L("a"), L("b")), L("c")), T("out"))));
        Add("Infix_groups_and_the_NOT_box/not-modifier", Body(Set(L("a", Neg), T("out"))));
        Add("Infix_groups_and_the_NOT_box/not-on-group", Body(Set(new Box("AND", null, CallKind.Operator, new[] { In(L("a")), In(L("b")) }, new Output[0], null, null, Neg), T("out"))));
        Add("Infix_groups_and_the_NOT_box/not-box", Body(Set(Call("NOT", new[] { In(L("a")) }, main: null), T("out"))));
        Add("Infix_groups_and_the_NOT_box/not-box-around-group", Body(Set(Call("NOT", new[] { In(Op("AND", L("a"), L("b"))) }, main: null), T("out"))));
        Add("Edges_are_flags_spelled_R_EDGE_and_F_EDGE/on-en", Body(Call("MOVE", new[] { In(L("1")) }, new[] { Out("nMode", 1) }, en: L("bStart", Rise), eno: true)));
        Add("Edges_are_flags_spelled_R_EDGE_and_F_EDGE/on-group", Body(Set(new Box("AND", null, CallKind.Operator, new[] { In(L("a")), In(L("b")) }, new Output[0], null, null, Rise), T("lamp"))));
        Add("Negation_with_an_edge_is_NOT_inside/operand", Body(Set(L("x", Neg with { Falling = true }), T("out"))));
        Add("Calls_FB_instances_and_functions/fb", Body(Fb("t1", new[] { In(L("a"), "IN"), In(L("pt"), "PT") }, new[] { Out("el", 2, "ET") }, "TON")));
        Add("Calls_FB_instances_and_functions/named-output", Body(Set(Call("f", new[] { In(L("src")) }, new[] { Out("err", 1, "oErr") }, connected: 0, eno: false), T("dst"))));
        Add("Calls_FB_instances_and_functions/function", Body(Set(Call("MAX", new[] { In(L("a")), In(L("b")) }, connected: 0, eno: false), T("out"))));
        Add("Unnamed_instances_carry_their_type_and_question_marks_are_content/instance", Body(Call("TON", new[] { In(L("a"), "IN"), In(L("t"), "PT") }, main: null,
            instance: new Operand("???", IsInstance: true), kind: CallKind.FunctionBlock)));
        Add("Unnamed_instances_carry_their_type_and_question_marks_are_content/target", Body(Set(L("ioAxis.xVirtual"), T("???"))));
        Add("Unnamed_instances_carry_their_type_and_question_marks_are_content/pins", Body(Fb("t1", new[] { In(L("???"), "IN"), In(L("pt"), "PT") }, new[] { Out("???", 2, "ET") }, "TON")));
        Add("Unnamed_instances_carry_their_type_and_question_marks_are_content/in-group", Body(Set(Op("AND", L("???"), L("a")), T("out"))));
        Add("Default_formals_stay_infix_and_a_non_default_one_forces_call_form/default", Body(Set(Call("AND", new[] { In(L("a"), "IN1"), In(L("b"), "IN2") }, main: null), T("out"))));
        Add("Default_formals_stay_infix_and_a_non_default_one_forces_call_form/non-default", Body(Set(Call("ADD", new[] { In(L("a"), "X"), In(L("b")) }, connected: 0, eno: false), T("out"))));
        Add("EN_is_a_pin_and_a_box_writes_its_own_result_pins/unconsumed", Body(Call("MOVE", new[] { In(L("b")) }, en: L("a"))));
        Add("EN_is_a_pin_and_a_box_writes_its_own_result_pins/result-pin", Body(Call("MOVE", new[] { In(L("0")) }, new[] { Out("Status", 1) }, en: L("c"), eno: true)));
        Add("EN_is_a_pin_and_a_box_writes_its_own_result_pins/operator-call-form", Body(Call("AND", new[] { In(L("a")), In(L("b")) }, new[] { Out("out", 1) }, en: L("go"), main: null, eno: true)));
        Add("EN_is_a_pin_and_a_box_writes_its_own_result_pins/chain", Body(Call("GT", new[] { In(L("sensor")), In(L("diff")) }, new[] { Out("out", 1) }, eno: true,
            en: Call("SUB", new[] { In(L("light")), In(L("deviation")) }, new[] { Out("diff", 1) }, en: L("rung"), connected: 0, eno: true))));
        Add("An_enabled_box_consumed_by_its_ENO", Body(Set(Call("MOVE", new[] { In(L("0")) }, new[] { Out("Status", 1) }, en: L("c"), connected: 0, eno: true), T("lamp"))));
        Add("An_EN_shown_but_unwired_is_an_empty_EN_pin/no-eno", Body(Set(Call("GE", new[] { In(L("stActHeightElevator")), In(L("tInt")) }, en: Empty, connected: 0, eno: false), T("out"))));
        Add("An_EN_shown_but_unwired_is_an_empty_EN_pin/with-eno", Body(Set(Call("MUL", new[] { In(L("a")), In(L("b")) }, en: Empty, connected: 0, eno: true), T("out"))));
        Add("Positional_result_pins_fill_the_slots_left_after_the_connected_one/top-level", Body(Call("MOVE", new[] { In(L("src")) }, new[] { Out("dst", 0) }, eno: false)));
        Add("Positional_result_pins_fill_the_slots_left_after_the_connected_one/consumed", Body(Set(Call("f", new[] { In(L("src")) }, new[] { Out("err", 1) }, connected: 0, eno: false), T("out"))));
        Add("Positional_result_pins_fill_the_slots_left_after_the_connected_one/passed-over", Body(Set(Call("f", new[] { In(L("src")) }, new[] { Out("b", 2) }, connected: 0, eno: false), T("out"))));
        Add("Empty_slots_are_positions/mul", Body(Op("MUL", Empty, L("iRPM"), L("6"))));
        Add("Empty_slots_are_positions/named", Body(Fb("ctu", new[] { In(L("a"), "CU"), In(Empty, "RESET"), In(Empty, "PV") })));
        Add("Empty_slots_are_positions/leading", Body(Call("f", new[] { In(Empty), In(L("a")) })));
        Add("Empty_slots_are_positions/trailing", Body(Call("f", new[] { In(L("a")), In(Empty) })));
        Add("Empty_slots_are_positions/lone-named", Body(Call("MOVE", new[] { In(Empty, "IN") })));
        Add("Empty_slots_are_positions/coil", Body(Set(Empty, T("coil"))));
        Add("Execute_boxes_statement_empty_and_value_forms/statement", Body(Exec("IF bStart THEN\n\ttarget := 40 + 2;\nEND_IF", L("bRun"))));
        Add("Execute_boxes_statement_empty_and_value_forms/empty", Body(Exec("", L("bRun"))));
        Add("Execute_boxes_statement_empty_and_value_forms/value", Body(Set(Exec("x := 1;", L("bRun"), connected: 0), T("out"))));
        Add("A_consumed_execute_box_without_EN_says_ENO", Body(Set(Exec("x := 1;", connected: 0), T("out"))));
        Add("A_snippet_line_starting_END_EXECUTE_goes_to_the_marker_and_one_starting_Network_does_not", Body(Exec("NetworkState := 1;")));
        Add("One_assign_several_coils_is_one_chained_statement", Body(Net(Def(0, L("TRUE")), Set(L("x"), T("lamp")),
            Set(Ref(0), T("stRestposition", SetBit), T("stLowerInpusher", ResetBit), T("stInfeedTray", ResetBit)))));
        Add("Labels_jumps_and_returns", new NetworkBody(BodyLanguage.Fbd, new[]
        {
            Net(new Assign(L("a"), new[] { T("Done", JumpBit) }, JumpBit)),
            new Network(1, null, "Done", null, false, new Node[] { Set(L("a"), T("out")) }),
            Net(new Assign(Empty, new[] { T("Done", JumpBit) }, JumpBit)),
            Net(new Assign(L("a"), new Operand[0], ReturnBit)),
            Net(new Assign(Empty, new Operand[0], ReturnBit)),
        }));
        Add("Wires_are_declared_in_the_network_VAR_TEMP_block", Body(new Network(0, "DONE Network 1: Activating/deactivating MID-S/Trayfiller", null, null, false, new Node[]
        {
            Def(0, L("TRUE")),
            Def(1, Op("AND", Ref(0), L("Mach1_Safety.Status.Custom_ATF_Disabled", Neg))),
            Set(Ref(1), T("Mach1_AuxData.TrayfillerActive")),
            Set(Ref(1), T("HMI_Var.TrayfillerActive")),
            Set(Op("AND", Ref(0), L("TRUE")), T("Mach1_AuxData.MIDS_Active")),
        }), BodyLanguage.Ld));
        Add("A_single_consumer_wire_keeps_its_VarId", Body(Net(Def(28, Op("AND", L("a"), L("b"))), Set(Ref(28), T("out")))));
        Add("A_wire_is_typed_from_its_producer_and_never_guessed/typed-box", Body(Net(Def(1, Call("ADD", new[] { In(L("a"), "X"), In(L("b")) }, connected: 0, eno: false, types: new[] { "INT" })),
            Set(Call("GT", new[] { In(Ref(1)), In(L("c")) }, connected: 0, eno: false), T("o1")),
            Set(Call("LT", new[] { In(Ref(1)), In(L("d")) }, connected: 0, eno: false), T("o2")))));
        Add("A_wire_is_typed_from_its_producer_and_never_guessed/ld-leaf", Body(Net(Def(1, L("x")), Set(Ref(1), T("o"))), BodyLanguage.Ld));
        Add("A_stored_type_is_written_in_the_texts_spelling_of_its_tokens", Body(Net(
            Def(1, Call("CONCAT", new[] { In(L("a")), In(L("b")) }, connected: 0, eno: false, types: new[] { "STRING (80)" })),
            Set(Ref(1), T("o")))));
        Add("Wires_of_several_types_are_one_block_one_declaration_per_type", Body(Net(Def(1, L("TRUE")),
            Def(2, Call("ADD", new[] { In(L("a"), "X"), In(L("b")) }, connected: 0, eno: false, types: new[] { "INT" })),
            Def(3, Op("AND", Ref(1), L("c"))), Set(Ref(2), T("o")), Set(Ref(3), T("p")))));
        Add("Parallel_fed_unfed_and_sequential/fed", Body(Net(Def(54, L("TRUE")),
            Set(new Parallel(Ref(54), new Node[] { L("StartFlag"), L("tResetSafetyGuard") }, ParallelMode.BoxShortCircuit), T("ResetSafetyGuard", SetBit)))));
        Add("Parallel_fed_unfed_and_sequential/unfed", Body(Set(new Parallel(null, new Node[] { L("a"), L("b") }, ParallelMode.BoxShortCircuit), T("out"))));
        Add("WriterReaderAgreementTests.A_consumed_comparison_or_arithmetic_box_the_vendor_stores_is_written_infix/comparison", Body(Set(Call("GT", new[] { In(L("a")), In(L("b")) }, connected: 0, eno: false), T("o"))));
        Add("WriterReaderAgreementTests.A_consumed_comparison_or_arithmetic_box_the_vendor_stores_is_written_infix/arithmetic", Body(Set(Call("ADD", new[] { In(L("a")), In(L("b")) }, connected: 0, eno: false), T("out"))));
        Add("WriterReaderAgreementTests.A_literal_target_is_backticked", Body(Net(Set(L("a"), T("5")), Set(L("a"), T("16#FF")), Call("F", new[] { In(L("a")) }, new[] { Out("T#1s", 0) }, eno: false))));
        Add("WriterReaderAgreementTests.A_lone_unwired_slot_beside_an_output_pin_is_written", Body(Call("f", new[] { In(Empty) }, new[] { Out("x", 0) }, eno: false)));
        Add("Parallel_fed_unfed_and_sequential/sequential", Body(Set(new Parallel(L("f"), new Node[] { L("a"), L("b") }, ParallelMode.Sequential), T("out"))));

        // Section 2 added these writer goldens without their models — the drift the completeness guard
        // (Every_writer_test_is_a_golden_or_says_why_not) now catches.
        Add("Negation_with_an_edge_is_NOT_inside/on-group", Body(Set(new Box("AND", null, CallKind.Operator, new[] { In(L("a")), In(L("b")) }, new Output[0], null, null, Neg with { Rising = true }), T("out"))));
        Add("An_enabled_comparison_consumed_by_its_main_output_has_no_suffix",
            Body(Set(Call("GT", new[] { In(L("a")), In(L("b")) }, en: L("c"), main: 0, connected: 0, eno: false), T("out"))));
        Add("ENO_wins_where_it_is_also_the_main_output",
            Body(Set(Call("MOVE", new[] { In(L("0")) }, new[] { Out("Status", 1) }, en: L("c"), main: 0, connected: 0, eno: true), T("lamp"))));
        Add("A_box_with_ENO_and_no_EN_consumed_by_its_ENO",
            Body(Set(Call("Dryer", new[] { In(L("a")) }, new[] { Out("speed", 1) }, main: 0, connected: 0, eno: true), T("out"))));
        Add("An_operator_box_consumed_by_its_ENO_is_a_call_with_the_suffix_not_a_group/add-by-eno",
            Body(Set(Call("ADD", new[] { In(L("a")), In(L("b")) }, main: 0, connected: 0, eno: true, kind: CallKind.Operator), T("out"))));
        Add("An_operator_box_consumed_by_its_ENO_is_a_call_with_the_suffix_not_a_group/add-by-main",
            Body(Set(Call("ADD", new[] { In(L("a")), In(L("b")) }, main: 0, connected: 0, eno: false, kind: CallKind.Operator), T("out"))));
        Add("An_operator_box_consumed_by_its_ENO_is_a_call_with_the_suffix_not_a_group/and-by-eno",
            Body(Set(Call("AND", new[] { In(L("a")), In(L("b")) }, main: null, connected: 0, eno: true, kind: CallKind.Operator), T("out"))));
        Add("ENO_is_never_an_output_pin/positional", Body(Call("MOVE", new[] { In(L("0")) }, new[] { Out("Status", 1) }, en: L("c"), eno: true)));
        Add("A_box_whose_ENO_output_was_not_read_goes_to_the_marker/not-asked", Body(Call("MOVE", new[] { In(L("b")) }, en: L("a"))));
        Add("A_consumed_box_whose_main_output_the_text_would_misread_goes_to_the_marker/slot-0",
            Body(Set(Call("FC", new[] { In(L("src")) }, new[] { Out("x", 1) }, main: 0, connected: 0, eno: false), T("out"))));
        Add("A_box_type_spelled_like_a_word_of_the_text_is_a_backticked_head/Network", Body(Call("Network", new[] { In(L("x")) }, new[] { Out("y", 0) }, eno: false)));
        Add("A_box_type_spelled_like_a_word_of_the_text_is_a_backticked_head/JMP", Body(Set(Call("JMP", new[] { In(L("x")) }, connected: 0, eno: false), T("out"))));
        Add("A_box_type_spelled_like_a_word_of_the_text_is_a_backticked_head/EXECUTE", Body(Call("EXECUTE", new[] { In(L("x")) })));
        Add("A_box_type_spelled_like_a_word_of_the_text_is_a_backticked_head/Let", Body(Call("Let", new[] { In(L("x")) })));
        Add("A_wire_fed_by_a_bit_operator_takes_the_vendors_stored_type",
            Body(Net(Def(5, new Box("AND", null, CallKind.Operator, new[] { In(L("w1")), In(L("w2")) }, new Output[0], null, null, Flags.None,
                    OutputTypes: new[] { "WORD" })),
                Set(Ref(5), T("o1")), Set(Ref(5), T("o2")))));
        Add("An_operator_type_in_another_case_keeps_its_spelling",
            Body(Set(Call("and", new[] { In(L("a")), In(L("b")) }, main: null, kind: CallKind.Operator), T("o"))));
        Add("An_EXECUTE_snippet_keeps_its_trailing_newlines/trailing-newline", Body(Exec("x := 1;\n")));
        Add("An_EXECUTE_snippet_keeps_its_trailing_newlines/crlf", Body(Exec("x := 1;\r\ny := 2;\r\n")));
        Add("A_comment_keeps_everything_but_the_CR_of_a_CRLF", Body(new Network(0, null, null, "line1\r\nline2", false, new Node[] { Empty })));
        Add("An_operand_named_LET_is_backticked/target", Body(Set(L("a"), T("Let"))));
        Add("An_operand_named_LET_is_backticked/value", Body(L("let")));
        var i = 0;
        foreach (var (tree, _) in NetworkTextWriterTests.WireShapedNames)
            Add("A_wire_shaped_name_the_scope_does_not_hold_is_backticked/" + i++, Body(tree));
        return g;
    }

    /// <summary>The writer tests with no model in <see cref="WriterGoldens"/>, each with why. Every other
    /// <c>NetworkTextWriterTests</c> test is a golden under its own name (<c>Test</c> or <c>Test/variant</c>);
    /// a key prefixed <c>WriterReaderAgreementTests.</c> is a model that test pins.</summary>
    public static readonly IReadOnlyDictionary<string, string> NotGolden = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["Operand_text_holding_a_backtick_goes_to_the_marker"] = "refused by the writer",
        ["A_wire_or_a_Parallel_cannot_carry_a_flag"] = "writes nothing: the model cannot hold the state",
        ["Rising_and_falling_on_one_operand_goes_to_the_marker"] = "refused by the writer",
        ["A_flag_on_a_box_input_pin_goes_to_the_marker"] = "refused by the writer",
        ["A_flag_on_an_Assign_item_goes_to_the_marker"] = "refused by the writer",
        ["A_flag_on_an_empty_slot_goes_to_the_marker"] = "refused by the writer",
        ["A_connection_by_neither_the_main_output_nor_ENO_goes_to_the_marker"] = "refused by the writer",
        ["A_top_level_box_whose_ENO_the_text_would_misread_goes_to_the_marker"] = "refused by the writer",
        ["An_unnamed_output_with_no_stored_slot_goes_to_the_marker"] = "refused by the writer",
        ["A_lone_unwired_slot_without_a_formal_goes_to_the_marker"] = "refused by the writer",
        ["Negated_and_edge_coils_go_to_the_marker"] = "refused by the writer",
        ["A_rung_with_several_control_flow_targets_goes_to_the_marker"] = "refused by the writer",
        ["A_return_with_a_named_target_goes_to_the_marker"] = "refused by the writer",
        ["The_writer_never_reorders_and_never_nests_a_definition"] = "refused by the writer",
        ["A_function_or_instance_named_like_an_edge_word_goes_to_the_marker"] = "refused by the writer",
        ["A_flag_on_a_jump_or_return_target_goes_to_the_marker"] = "refused by the writer",
        ["A_coil_both_set_and_reset_goes_to_the_marker"] = "refused by the writer",
        ["An_FB_instance_the_declarations_do_not_name_goes_to_the_marker"] = "refused by the writer",
        ["A_ladder_leaf_wire_feeding_data_pins_is_of_unknown_type"] = "refused by the writer",
        ["A_ladder_leaf_wire_on_an_enabled_boxs_data_pins_is_of_unknown_type"] = "refused by the writer",
        ["A_lone_CR_inside_a_comment_or_snippet_line_goes_to_the_marker"] = "refused by the writer",
        ["A_consumed_box_whose_main_output_was_not_read_goes_to_the_marker"] = "refused by the writer",
        ["A_wire_whose_name_is_taken_is_renamed_to_the_lowest_free_g"] =
            "renames a wire, so its model comes back under the new VarId, which a golden compared as-is would call a " +
            "difference: A_renamed_wire_reads_back_under_its_new_VarId pins the read-back, and NetworkModelOracle maps " +
            "only such a forced rename back",
    };
}
