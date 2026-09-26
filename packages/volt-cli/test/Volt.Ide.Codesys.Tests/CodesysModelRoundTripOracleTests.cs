using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// THE MODEL ROUND-TRIP ORACLE over the CODESYS reader doubles (task 2.2): every NWL double the offline CODESYS
/// suites hand <see cref="CodesysNetworkReader"/> and expect to READ — the vendor-read model a pull hands the writer
/// — must round-trip through network text v2 or be refused by name (<see cref="NetworkModelOracle"/>). The engine
/// suite runs the same oracle over its goldens and the LSP corpus, and the TwinCAT suite over its archives; this
/// third half lives here because only this suite can reach <see cref="CodesysNetworkReader"/>.
///
/// <para><b>Transcribed, keyed by the test that builds each double.</b> A double constructed inside a test method
/// cannot be harvested, so each is rebuilt here exactly as its test builds it (the engine suite's
/// <c>V1BuiltModels</c> does the same for the v1 models). The doubles a test builds to be REFUSED by the reader
/// (a pin flag, a split point, a terminator with an input, …) are not here: they never reach a writer, v1 or v2,
/// and <see cref="CodesysNetworkReaderTests"/> pins each refusal by name. A copy can fall behind its source, so
/// <see cref="Every_reader_test_is_transcribed_or_says_why_not"/> holds the two lists to the reader tests that exist:
/// a new reader test fails it until its double is here or its reason is.</para>
///
/// <para><b>The refusal table is pinned, by reason.</b> <see cref="CodesysNetworkReader"/> reads the slot facts (task
/// 3.10), so what the writer still cannot spell is refused here by the name it gives it — never guessed. A count
/// moving means the text learned or lost a spelling, or the reader started or stopped filling a fact, and must be
/// read, never re-pinned blind.</para>
/// </summary>
public class CodesysModelRoundTripOracleTests
{
    static Nwl.BoxTreeOperand Leaf(string text, Nwl.Flags? flags = null) =>
        new() { Operand = new Nwl.Operand { OperandExpr = text, Flags = flags ?? new Nwl.Flags() } };

    static Nwl.BoxTreeAssign Coil(object? value, Nwl.Operand target)
    {
        var assign = value is null ? new Nwl.BoxTreeAssign() : new Nwl.BoxTreeAssign { RValue = value };
        assign.Outputs.List.Add(target);
        return assign;
    }

    static Nwl.Operand Target(string text, Nwl.Flags? flags = null, string symbolComment = "") =>
        new() { OperandExpr = text, IsLValue = true, SymbolComment = symbolComment, Flags = flags ?? new Nwl.Flags() };

    static Nwl.NWLImplementationObject Body(Nwl.Network net)
    {
        var impl = new Nwl.NWLImplementationObject();
        impl.NetworkList.Add(net);
        return impl;
    }

    static Nwl.BoxTreeParallel Parallel(Nwl.OperationMode mode, params object[] branches)
    {
        var par = new Nwl.BoxTreeParallel { Mode = mode };
        par.Trees.AddRange(branches);
        return par;
    }

    static Nwl.BoxTreeBox Execute(string st)
    {
        var impl = new _3S.CoDeSys.STObject.STImplementationObject();
        if (st.Length > 0)
        {
            Nwl.TextDocument.ThrowsAfterInsert = false;
            try { impl.TextDocument.Insert(0, st); }
            finally { Nwl.TextDocument.ThrowsAfterInsert = true; }
        }
        return Nwl.ExecuteBox(new Nwl.STSnippet { Snippet = impl });
    }

    /// <summary>Every double a CODESYS reader test reads successfully, with the language it is read in.</summary>
    static Dictionary<string, (Nwl.NWLImplementationObject Impl, BodyLanguage Language)> Doubles()
    {
        var d = new Dictionary<string, (Nwl.NWLImplementationObject, BodyLanguage)>(StringComparer.Ordinal);
        void Fbd(string name, params object[] trees) => d.Add(name, (Nwl.Body(trees), BodyLanguage.Fbd));
        void Ld(string name, params object[] trees) => d.Add(name, (Nwl.Body(trees), BodyLanguage.Ld));
        void Net(string name, Nwl.Network net) => d.Add(name, (Body(net), BodyLanguage.Fbd));

        // CodesysNetworkReaderTests
        Fbd("Reader.An_unwired_EN_pin_reads_as_no_enable",
            new Nwl.BoxTreeBox { BoxType = "AND", InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("b") }, En = false });
        Fbd("Reader.A_wired_EN_pin_is_read_from_input_slot_zero", new Nwl.BoxTreeBox
        {
            BoxType = "MOVE",
            InputItemList = new object[] { Nwl.Leaf("rung"), Nwl.Leaf("value") },
            InputParams = new Nwl.ParamList { Names = new[] { "EN" }, Types = new[] { "BOOL" } },
            En = true,
        });
        Fbd("Reader.A_box_whose_first_pin_is_not_EN_keeps_all_of_its_inputs", new Nwl.BoxTreeBox
        {
            BoxType = "TON",
            Instance = new Nwl.Operand { OperandExpr = "t1", IsInstance = true },
            InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("pt") },
            InputParams = new Nwl.ParamList { Names = new[] { "IN", "PT" }, Types = new[] { "BOOL", "TIME" } },
        });
        Fbd("Reader.A_short_param_list_names_the_pins_it_covers_and_no_others", new Nwl.BoxTreeBox
        {
            BoxType = "ADD",
            InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("b"), Nwl.Leaf("c") },
            InputParams = new Nwl.ParamList { Names = new[] { "In1" }, Types = new[] { "BOOL" } },
        });
        Fbd("Reader.An_empty_pin_name_is_positional", new Nwl.BoxTreeBox
        {
            BoxType = "MOVE",
            InputItemList = new object[] { Nwl.Leaf("a") },
            InputParams = new Nwl.ParamList { Names = new[] { "" }, Types = new[] { "" } },
        });
        foreach (var title in new[] { "Constant_Torque", "Constant_Speed_Setpoint", "Constant_" })
            Net("Reader.A_network_title_beginning_with_the_sentinel_prefix_survives/" + title,
                new Nwl.Network { Title = title, Comment = title, Label = title }.With(Coil(null, new Nwl.Operand { OperandExpr = "out" })));
        Net("Reader.An_operands_symbol_comment_sentinel_is_still_dropped",
            new Nwl.Network().With(Coil(null, new Nwl.Operand { OperandExpr = "out", SymbolComment = "Constant_SymbolComment_Serialization_Value" })));
        foreach (var comment in new[] { "Constant_Torque", "Constant_Speed_Setpoint", "Constant_", "Constant_Serialization_Value_but_not_really" })
            Net("Reader.An_operand_comment_that_only_LOOKS_like_the_sentinel_survives/" + comment,
                new Nwl.Network().With(Coil(null, new Nwl.Operand { OperandExpr = "out", SymbolComment = comment })));
        Net("Reader.An_unmeasured_third_sentinel_is_still_dropped",
            new Nwl.Network().With(Coil(null, new Nwl.Operand { OperandExpr = "out", SymbolComment = "Constant_SomeNewMember_Serialization_Value" })));
        Net("Reader.A_set_coil_keeps_its_storage_on_the_target",
            new Nwl.Network().With(Coil(Leaf("a"), Target("out", new Nwl.Flags { Set = true }))));
        Net("Reader.A_reset_coil_reads_as_a_reset_and_not_as_a_negated_set",
            new Nwl.Network().With(Coil(Leaf("a"), Target("out", new Nwl.Flags { Negation = true, Set = true }))));
        Net("Reader.A_plain_coil_gains_no_storage", new Nwl.Network().With(Coil(Leaf("a"), Target("out"))));
        Net("Reader.A_negated_contact_pulls_as_negated",
            new Nwl.Network().With(Coil(Leaf("a", new Nwl.Flags { Negation = true }), Target("out"))));
        Ld("Reader.An_unfed_Parallel_reads_with_no_feed",
            Coil(Parallel(Nwl.OperationMode.Sequential, Nwl.Leaf("a"), Nwl.Leaf("b")), Target("out")));
        foreach (var mode in new[] { Nwl.OperationMode.BoxShortCircuit, Nwl.OperationMode.Sequential })
            Ld("Reader.A_Parallel_reads_its_mode/" + mode, Coil(Parallel(mode, Nwl.Leaf("a"), Nwl.Leaf("b")), Target("out")));
        Ld("Reader.An_assignment_fed_by_the_empty_terminator_reads", Coil(new Nwl.BoxTreeTerminator(), Target("out")));
        // The pin-flag doubles READ now (task 4.1: InputFlags into Input.Flags) and reach the writer, which has no
        // spelling for a pin flag (phase-1 decision) — each is refused by that name below, never read back without it.
        Net("Reader.A_negation_on_a_box_input_pin_is_read_into_the_model_and_the_pull_names_it",
            new Nwl.Network().With(Coil(new Nwl.BoxTreeBox
            {
                BoxType = "AND",
                InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("xIsWarningInfo") },
                InputFlags = new object[] { new Nwl.Flags(), new Nwl.Flags { Negation = true } },
            }, Target("out"))));
        Fbd("Reader.An_edge_on_a_box_input_pin_is_read_onto_that_pin", new Nwl.BoxTreeBox
        {
            BoxType = "TON",
            InputItemList = new object[] { Nwl.Leaf("start"), Nwl.Leaf("pt") },
            InputParams = new Nwl.ParamList { Names = new[] { "IN", "PT" }, Types = new[] { "BOOL", "TIME" } },
            InputFlags = new object[] { new Nwl.Flags { Rtrig = true }, new Nwl.Flags() },
        });
        Fbd("Reader.Pin_flags_stay_aligned_past_the_enable", new Nwl.BoxTreeBox
        {
            BoxType = "MOVE",
            InputItemList = new object[] { Nwl.Leaf("rung"), Nwl.Leaf("value") },
            InputParams = new Nwl.ParamList { Names = new[] { "EN", "" }, Types = new[] { "BOOL", "" } },
            InputFlags = new object[] { new Nwl.Flags(), new Nwl.Flags { Negation = true } },
        });
        Fbd("Reader.Empty_pin_flags_read_as_before", new Nwl.BoxTreeBox
        {
            BoxType = "AND",
            InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("b") },
            InputFlags = new object[] { new Nwl.Flags(), new Nwl.Flags() },
        });
        Net("Reader.A_rising_edge_contact_keeps_its_edge",
            new Nwl.Network().With(Coil(Leaf("a", new Nwl.Flags { Rtrig = true }), Target("out"))));
        Ld("Reader.A_return_coil_reads_as_control_flow_not_as_an_assignment_to_the_marker",
            Coil(new Nwl.BoxTreeOperand { Operand = new Nwl.Operand { OperandExpr = "ioAxis.xVirtual", Type = "BOOL" } },
                new Nwl.Operand { OperandExpr = "???", Type = "BOOL", IsLValue = true, Flags = new Nwl.Flags { Return = true } }));
        {
            var box = new Nwl.BoxTreeBox
            {
                BoxType = "fc_MeanValue",
                InputItemList = new object[] { Nwl.Leaf("rung"), Nwl.Leaf("len") },
                InputParams = new Nwl.ParamList { Names = new[] { "EN", "iLength" }, Types = new[] { "BOOL", "INT" } },
                OutputParams = new Nwl.ParamList { Names = new[] { "ENO", "oMeanValue", "oSpare" }, Types = new[] { "", "", "" } },
                En = true,
            };
            box.Outputs.List.Add(null!);
            box.Outputs.List.Add(new Nwl.Operand { OperandExpr = "measured" });
            box.Outputs.List.Add(new Nwl.Operand { OperandExpr = "" });
            Fbd("Reader.A_box_output_pin_is_read_without_the_ENO_slot_or_the_unwired_ones", box);
        }
        {
            var box = new Nwl.BoxTreeBox
            {
                BoxType = "BLINK",
                InputItemList = new object[] { Nwl.Leaf("enable") },
                InputParams = new Nwl.ParamList { Names = new[] { "ENABLE" }, Types = new[] { "BOOL" } },
                OutputParams = new Nwl.ParamList { Names = new[] { "OUT" }, Types = new[] { "BOOL" } },
            };
            box.Outputs.List.Add(new Nwl.Operand { OperandExpr = "pulse" });
            Fbd("Reader.A_box_without_an_ENO_slot_keeps_its_first_output", box);
        }
        {
            var box = new Nwl.BoxTreeBox
            {
                BoxType = "MOVE",
                InputItemList = new object[] { Nwl.Leaf("src") },
                InputParams = new Nwl.ParamList { Names = new[] { "" }, Types = new[] { "" } },
                OutputParams = new Nwl.ParamList { Names = new[] { "" }, Types = new[] { "" } },
                MainOutputIndex = 0,
            };
            box.Outputs.List.Add(new Nwl.Operand { OperandExpr = "dst" });
            Fbd("Reader.An_unnamed_output_pin_is_the_boxs_own_result_pin_not_an_assign", box);
        }
        {
            var ge = new Nwl.BoxTreeBox
            {
                BoxType = "GE",
                InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("b") },
                OutputParams = new Nwl.ParamList { Names = new[] { "" }, Types = new[] { "" } },
                MainOutputIndex = 0,
            };
            var and = new Nwl.BoxTreeBox { BoxType = "AND", InputItemList = new object[] { ge, Nwl.Leaf("c") } };
            Ld("Reader.A_consumed_box_is_connected_by_its_main_output_and_an_operator_by_none",
               Coil(and, new Nwl.Operand { OperandExpr = "out", IsLValue = true }));
        }
        {
            var add = new Nwl.BoxTreeBox
            {
                BoxType = "ADD",
                InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("b") },
                OutputParams = new Nwl.ParamList { Names = new[] { "", "" }, Types = new[] { "INT", "" } },
                MainOutputIndex = 0,
            };
            var use = new Nwl.BoxTreeAssign { RValue = new Nwl.BoxTreeDemux { VarId = 1 } };
            use.Outputs.List.Add(new Nwl.Operand { OperandExpr = "out", IsLValue = true });
            Fbd("Reader.A_wire_fed_by_a_data_box_is_declared_with_its_stored_output_type",
                new Nwl.BoxTreeDemux { VarId = 1, Input = add }, use);
        }
        {
            var net = new Nwl.Network().With(Coil(null, new Nwl.Operand { OperandExpr = "out" }));
            net.PhantomItemCount = 2;
            Net("Reader.A_network_reporting_a_dropped_item_skips_the_phantom_slot", net);
        }
        Fbd("Reader.An_execute_box_with_empty_ST_reads_as_empty_not_missing", Execute(""));
        Fbd("Reader.An_execute_box_reads_its_ST", Execute("n := n + 1;"));

        // CodesysNetworkWriterGateTests: the live network every change-gate test reads before pushing it back.
        Net("WriterGate.LiveAndRung", new Nwl.Network().With(Coil(
            new Nwl.BoxTreeBox { BoxType = "AND", InputItemList = new object[] { Nwl.Leaf("a"), Nwl.Leaf("b") } }, Target("out"))));
        return d;
    }

    static readonly Lazy<Dictionary<string, NetworkBody>> Read = new(() =>
        Doubles().ToDictionary(kv => kv.Key, kv => CodesysNetworkReader.Read(kv.Value.Impl, kv.Value.Language), StringComparer.Ordinal));

    public static TheoryData<string> Ids()
    {
        var d = new TheoryData<string>();
        foreach (var k in Read.Value.Keys) d.Add(k);
        return d;
    }

    [Theory]
    [MemberData(nameof(Ids))]
    public void Every_reader_double_round_trips_or_is_refused_by_name(string id) =>
        NetworkModelOracle.Check(id, Read.Value[id]);

    /// <summary>The reader tests whose double is NOT transcribed above, each with why. Everything else a
    /// <see cref="CodesysNetworkReaderTests"/> test reads must be in <see cref="Doubles"/> under its test's name.</summary>
    static readonly Dictionary<string, string> NotTranscribed = new(StringComparer.Ordinal)
    {
        ["A_boolean_where_a_node_belongs_is_never_a_node"] = "refused by the reader: an assignment with no value",
        ["Formal_pin_names_are_read_from_the_param_list"] = "the TON double of A_box_whose_first_pin_is_not_EN_keeps_all_of_its_inputs",
        ["A_network_missing_its_item_count_throws_rather_than_reading_as_empty"] = "refused by the reader",
        ["A_terminator_with_an_input_is_refused_by_name"] = "refused by the reader",
        ["An_assignment_holding_no_value_is_refused_by_name"] = "refused by the reader",
        ["A_Parallel_fed_by_the_empty_terminator_is_refused_by_name"] = "refused by the reader",
        ["A_flag_on_a_Parallel_is_refused_by_name"] = "refused by the reader",
        ["A_flag_on_a_wire_is_refused_by_name"] = "refused by the reader",
        ["A_Parallel_with_an_unmeasured_mode_is_refused_by_name"] = "refused by the reader",
        ["A_flag_on_the_enable_pin_is_refused_by_name"] = "refused by the reader: the model has no place for a flag on the enable",
        ["A_negation_or_edge_on_an_Assign_item_is_refused_by_name"] = "refused by the reader",
        ["A_return_coil_renders_as_a_conditional_RETURN"] = "the double of A_return_coil_reads_as_control_flow_not_as_an_assignment_to_the_marker",
        ["A_network_carrying_a_vendor_split_point_is_refused_by_name"] = "refused by the reader",
        ["An_execute_box_whose_snippet_has_no_document_throws"] = "refused by the reader",
    };

    /// <summary>THE TRANSCRIPTION IS COMPLETE. The doubles above are copied by hand, because a double built inside
    /// a test method cannot be harvested — so a reader test added (or renamed) without its entry here would never
    /// reach the v2 oracle, and the tally would not notice. Every reader test is either transcribed under its
    /// name or listed in <see cref="NotTranscribed"/> with the reason; neither list names a test that is gone.</summary>
    [Fact]
    public void Every_reader_test_is_transcribed_or_says_why_not()
    {
        var tests = typeof(CodesysNetworkReaderTests).GetMethods()
            .Where(m => m.GetCustomAttributes(typeof(FactAttribute), inherit: true).Length > 0)   // Theory is a Fact
            .Select(m => m.Name).ToHashSet(StringComparer.Ordinal);
        var transcribed = Doubles().Keys.Where(k => k.StartsWith("Reader.", StringComparison.Ordinal))
            .Select(k => k.Substring("Reader.".Length).Split('/')[0]).ToHashSet(StringComparer.Ordinal);

        var missing = tests.Where(t => !transcribed.Contains(t) && !NotTranscribed.ContainsKey(t)).OrderBy(t => t, StringComparer.Ordinal).ToList();
        var gone = transcribed.Concat(NotTranscribed.Keys).Where(t => !tests.Contains(t)).OrderBy(t => t, StringComparer.Ordinal).ToList();
        var both = transcribed.Where(NotTranscribed.ContainsKey).ToList();
        Assert.True(missing.Count == 0 && gone.Count == 0 && both.Count == 0,
            "reader tests with no transcribed double and no reason: " + string.Join(", ", missing) +
            "\nnamed here but no longer a reader test: " + string.Join(", ", gone) +
            "\nboth transcribed and excused: " + string.Join(", ", both));
    }

    [Fact]
    public void Reader_double_tally() =>
        NetworkModelOracle.AssertTally("CODESYS reader doubles",
            Read.Value.Select(kv => NetworkModelOracle.Check(kv.Key, kv.Value)),
            // Every double round-trips since the reader fills the output slots, the connection slot and whether a box has
            // an ENO output (task 3.10): the one refusal this table held — MOVE's result pin, "a box whose ENO output
            // was not read" — was those facts missing, and its double is now the measured MOVE (`OutputParams ['']`). The
            // 34th is the data box whose stored output type (`OutputParams.Types`) declares the wire it feeds. The three
            // refusals are the pin-flag doubles the reader reads since task 4.1: the text has no spelling for a flag on a
            // box input pin (phase-1 decision), so the pull names it rather than write the pin without it.
            bodies: 34, networks: 34, refused: new Dictionary<string, int> { ["a flag on a box input pin"] = 3 });
}
