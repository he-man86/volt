using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Engine.Format.Network;
using static Volt.Engine.Tests.NetworkModels;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Engine.Tests;

/// <summary>
/// The goldens for the NWL shapes the v1 split-only tests pinned — an item v1 spelled as several statements (a hoisted
/// <c>LET i</c>, an <c>en</c> echo and its <c>IF</c>, a <c>LET m</c> fold, a <c>LET g</c> of a single consumer) or sent
/// to the marker. Each holds the NWL model and pins its text in the grammar of <c>readability.md</c> (openspec
/// <c>ld-fbd-coverage</c> 2R.3): one <c>;</c> per item, an ENO read on the line below its box (B4), a split its VarId
/// (B6) — or the marker by name.
///
/// <para><b>ENO facts follow the measurement, not the v1 text.</b> v1's <c>IF en THEN … END_IF</c> said "the rung
/// continues from ENO" for every enabled box. Where these shapes come from a real network the model carries what the
/// live dump says (<c>nwl-oracle-rungs.log</c> (deleted; <c>git show b2496efb4b:packages/volt-cli/scripts/nwl-oracle-rungs.log</c>)): a comparison with EN shown and unwired has no ENO output and
/// is read by its result (TrayFiller N8's GE), while MOVE/ADD/MUL/SUB show ENO.</para>
/// </summary>
public class SplitShapeGoldensTests
{
    /// <summary>A comparison with EN shown and unwired and no ENO output, consumed by its result (TrayFiller N8's
    /// GE, measured: <c>OutputParams.Names = ['']</c>).</summary>
    static Box Cmp(string type, Node a, Node b) =>
        Call(type, new[] { In(a), In(b) }, en: Empty, main: 0, connected: 0, eno: false, kind: CallKind.Operator);

    public static TheoryData<string> Spelled()
    {
        var d = new TheoryData<string>();
        foreach (var k in Goldens.Keys) d.Add(k);
        return d;
    }

    [Theory]
    [MemberData(nameof(Spelled))]
    public void The_shape_is_one_statement_per_item(string name)
    {
        var (model, text) = Goldens[name];
        Assert.Equal(text, NetworkTextWriter.Write(model, ScopeOf(model)));
        Assert.Null(NetworkModelOracle.Check(name, model).Reason);
    }

    public static TheoryData<string> Marked()
    {
        var d = new TheoryData<string>();
        foreach (var k in Markers.Keys) d.Add(k);
        return d;
    }

    [Theory]
    [MemberData(nameof(Marked))]
    public void The_shape_goes_to_the_marker_by_name(string name)
    {
        var (model, marker) = Markers[name];
        Assert.Equal(marker, NetworkModelOracle.Check(name, model).Reason);
    }

    static readonly IReadOnlyDictionary<string, (NetworkBody Model, string Text)> Goldens = new Dictionary<string, (NetworkBody, string)>
    {
        // NetworkTextRoundTripTests.A_modifier_on_an_operand_does_not_force_a_hoisted_LET — the four statements.
        ["RoundTrip.modifier/a AND NOT b"] = (Fbd1(Set(Op("AND", L("a"), L("b", Neg)), T("out"))),
            Src("out := a AND NOT b;")),
        ["RoundTrip.modifier/NOT a AND b"] = (Fbd1(Set(Op("AND", L("a", Neg), L("b")), T("out"))),
            Src("out := NOT a AND b;")),
        ["RoundTrip.modifier/a AND b RISING"] = (Fbd1(Set(Op("AND", L("a"), L("b", Rise)), T("out"))),
            Src("out := a AND R_EDGE(b);")),
        ["RoundTrip.modifier/NOT a AND NOT b"] = (Fbd1(Set(Op("AND", L("a", Neg), L("b", Neg)), T("out"))),
            Src("out := NOT a AND NOT b;")),

        // NetworkTextRoundTripTests.An_operand_whose_own_text_is_unsafe_is_still_hoisted: `LET i1 := arr[j + 1];`
        // becomes the one operand it is, in place.
        ["RoundTrip.unsafe-operand"] = (Fbd1(Set(Op("AND", L("a"), L("arr[j + 1]")), T("out"))),
            Src("out := a AND `arr[j + 1]`;")),

        // NetworkTextRoundTripTests L56-67, the en-chain InlineData.
        // L56: an EN shown and wired to nothing, the box writing its own result pin.
        ["RoundTrip.en/unwired-EN"] = (Fbd1(EnEno("MUL", Empty, new[] { In(L("iRPM")), In(L("6")) }, new[] { Out("oDriveSpeed", 1) })),
            Src("iRPM MUL 6 => oDriveSpeed EN;")),
        // L61: SideCorrection — a SUB in a GT's EN slot, read through its ENO, each writing its own pin.
        ["RoundTrip.en/SideCorrection"] = (Ld1(EnEno("GT", EnEno("SUB", L("rung"), new[] { In(L("light")), In(L("deviation")) },
                new[] { Out("diff", 1) }, consumed: true), new[] { In(L("sensor")), In(L("diff")) }, new[] { Out("out", 1) })),
            LdSrc("light SUB deviation => diff EN rung", "sensor GT diff => out EN ENO;")),
        // L63: the inner box with no pin of its own — its enable still survives.
        ["RoundTrip.en/inner-without-pin"] = (Ld1(EnEno("GT", EnEno("SUB", L("rung"), new[] { In(L("light")), In(L("deviation")) },
                consumed: true), new[] { In(L("sensor")), In(L("5")) }, new[] { Out("out", 1) })),
            LdSrc("light SUB deviation EN rung", "sensor GT 5 => out EN ENO;")),
        // L67: a fed Parallel whose rung and branches are comparisons with EN unwired (fc_CamC_CC_Base, TrayFiller):
        // no hoist and no `en` numbering left to get wrong — and no ENO the rung does not read.
        ["RoundTrip.en/fed-Parallel"] = (Ld1(Set(new Parallel(Cmp("GT", L("a"), L("b")),
                new Node[] { Cmp("GE", L("c"), L("d")), Cmp("LE", L("e"), L("f")) }, ParallelMode.BoxShortCircuit), T("out"))),
            LdSrc("out := (a GT b EN) BRANCH ((c GE d EN),", "                           (e LE f EN)) SHORTCIRCUIT;")),

        // NetworkTextRoundTripTests L139: `LET g28` with ONE consumer is still a wire — a Demux the vendor drew.
        ["RoundTrip.single-consumer-wire"] = (Ld1(Def(28, Op("AND", L("a"), L("b"))),
                Set(Call("f", new[] { In(Ref(28), "IN") }, connected: 0, eno: false), T("out"))),
            LdSrc("split28 := a AND b;", "out := f(IN := split28);")),
        // L144: `LET i1 := DINT_TO_REAL(x);` is one inVariable whose text is not a token — one operand, in place.
        ["RoundTrip.opaque-leaf"] = (Fbd1(Fb("t1", new[] { In(L("DINT_TO_REAL(x)"), "IN") }, type: "TON")),
            Src("t1(IN := `DINT_TO_REAL(x)`);")),

        // FanOutShapeTests — the chain (one Assign, several coils) and the wire (a Demux) are two texts.
        ["FanOutShape.MultiOutputAssign"] = (Ld1(Set(L("a"), T("out1"), T("out2"))),
            LdSrc("out1 := out2 := a;")),
        ["FanOutShape.DemuxAndTwoAssigns"] = (Ld1(Def(1, LT("a", "BOOL")), Set(Ref(1), T("out1")), Set(Ref(1), T("out2"))),
            LdSrc("split1 := a;", "out1 := split1;", "out2 := split1;")),
        ["FanOutShape.A_fold_keeps_each_targets_own_operator"] = (Ld1(Set(L("a"), T("out1"), T("out2", SetBit))),
            LdSrc("out1 := out2 S= a;")),
        ["FanOutShape.An_enabled_box_driving_several_coils"] = (Ld1(Set(
                EnEno("AND", L("en"), new[] { In(L("a")), In(L("b")) }, consumed: true) with { MainOutputIndex = null }, T("out1"), T("out2"))),
            LdSrc("a AND b EN `en`", "out1 := out2 := ENO;")),
        ["FanOutShape.A_folded_assign_fed_by_a_WIRE"] = (Ld1(Def(3, LT("a", "BOOL")), Set(Ref(3), T("single")), Set(Ref(3), T("out1"), T("out2"))),
            LdSrc("split3 := a;", "single := split3;", "out1 := out2 := split3;")),

        // LiteralFanoutBugTests: a literal leaf fanning out to two boxes is the vendor's Demux of a leaf — LEGAL
        // text. (Its requirement stays with the v1 test until 4.2/4.4: a structurally changed TwinCAT network
        // holding one is refused cleanly before the importer, which crashed on it.)
        ["LiteralFanout.a-Demux-of-a-leaf"] = (Fbd1(
                Def(0, L("FALSE")),
                Def(1, Op("AND", L("TRUE"), L("FALSE"))),
                Def(2, Op("OR", Ref(1), Ref(0))),
                Set(Ref(2), T("np")),
                Set(Op("AND", Ref(2), Ref(0)), T("outpur"))),
            Src("split0 := FALSE;", "split1 := TRUE AND FALSE;", "split2 := split1 OR split0;",
                "np := split2;", "outpur := split2 AND split0;")),
    };

    static readonly IReadOnlyDictionary<string, (NetworkBody Model, string Marker)> Markers = new Dictionary<string, (NetworkBody, string)>
    {
        // The shapes v1's deleted Unspellable detector named — negated and edge coils (census 1.7: 0 of 576 targets)
        // and rungs with several control-flow targets — stay on the marker, by the writer's own refusal.
        ["MarkerCoil.negated"] = (Ld1(Set(L("a"), T("out", Neg))), "negated coil"),
        ["MarkerCoil.rising"] = (Ld1(Set(L("a"), T("out", Rise))), "rising-edge coil"),
        ["MarkerCoil.falling"] = (Ld1(Set(L("a"), T("out", Fall))), "falling-edge coil"),
        ["MarkerCoil.coil-and-jump"] = (Ld1(new Assign(Empty, new[] { T("Onwards", JumpBit), T("out") }, JumpBit)),
            "a rung driving a coil and a jump together"),
        ["MarkerCoil.jump-and-coil"] = (Ld1(new Assign(Empty, new[] { T("out"), T("Onwards", JumpBit) }, JumpBit)),
            "a rung driving a coil and a jump together"),
        ["MarkerCoil.two-jumps"] = (Ld1(new Assign(Empty, new[] { T("Onwards", JumpBit), T("Elsewhere", JumpBit) }, JumpBit)),
            "a rung driving several jumps"),
    };
}
