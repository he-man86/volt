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
/// THE LADDER ORACLE (task 2.4): seven real rungs from <c>test-corpus/lenze-mid</c> — Mach1_MIDS networks 0, 10, 13
/// and 82, TrayFiller networks 1, 6 and 8 — each pinned as network text v2 AND as the vendor's model, both ways:
/// the writer writes the model to the text, and the text reads back to the model (<see cref="NextModelOracle"/>,
/// which also runs the gate).
///
/// <para><b>The models are the vendor's, not the corpus text's.</b> The corpus holds these rungs as v1 text, which
/// carries none of the facts v2 spells — which <c>X AND (a OR b)</c> is a <c>BoxTreeParallel</c>, which box has an
/// ENO output, which output slot a pin is on, a coil's reset bit pair. Each model below is transcribed from a live
/// SP21 dump of those very networks (<c>scripts/probe-nwl-oracle-rungs.py</c> -&gt; <c>scripts/nwl-oracle-rungs.log</c>,
/// run on a copy of <c>Lenze_MID-S100_V5_00_602_T51</c>), item by item: <c>OutputParams.Names</c> starting
/// <c>ENO</c> is <see cref="Box.HasEnoOutput"/>, <c>MainOutputIndex</c> as stored (None on AND/OR), a consumer
/// connected by it (DIALECT N16), <c>Outputs.List[i]</c> wired is slot i, <c>Negation+Set</c> on a target is a reset.
/// Facts the text has no position for (an operand's type, <c>CallType</c>) are left out, as
/// <see cref="NextNetworkTextFacts"/> lists.</para>
///
/// <para><b>What the dump settled that the design page had guessed.</b> Of the page's two-way positions ‹E1›–‹E4›,
/// only ‹E4› (TrayFiller 8) is a Parallel; ‹E1›–‹E3› are AND/OR boxes. And the GE on that Parallel's branch has EN
/// shown and unwired and NO ENO output (<c>OutputParams.Names = ['']</c>, <c>Eno = False</c>): it is connected by its
/// comparison result, so it is written without <c>.ENO</c> — the v1 text's <c>IF en4 THEN (… &gt;= tInt)</c> and
/// the page's <c>GE(EN := , …).ENO</c> both claimed the ENO, which the rung does not read.</para>
/// </summary>
public class NextLadderOracleTests
{
    // Operator boxes as the vendor holds them: no main output index, an empty output type list (the dump's
    // `MainOutputIndex=None`, `OutputParams Names=[] Types=[]`).
    static Box And(params Node[] inputs) => Op("AND", inputs) with { OutputTypes = Array.Empty<string?>() };
    static Box Or(params Node[] inputs) => Op("OR", inputs) with { OutputTypes = Array.Empty<string?>() };

    /// <summary>A call box consumed by its main output, which is not an ENO (TON, R_TRIG: <c>Names=['Q', …]</c>).</summary>
    static Box FbByQ(string type, string instance, IEnumerable<Input> inputs, params string?[] types) =>
        Call(type, inputs, main: 0, connected: 0, eno: false, types: types,
            instance: new Operand(instance, IsInstance: true), kind: CallKind.FunctionBlock);

    static NetworkBody Ld(string? title, params Node[] trees) =>
        new(BodyLanguage.Ld, new[] { new Network(0, title, null, null, false, trees) });

    public static TheoryData<string> Rungs()
    {
        var d = new TheoryData<string>();
        foreach (var k in Oracle.Keys) d.Add(k);
        return d;
    }

    /// <summary>The model writes exactly the text; the text reads back to the model and passes the gate.</summary>
    [Theory]
    [MemberData(nameof(Rungs))]
    public void The_rung_is_pinned_as_text_and_as_a_model(string name)
    {
        var (model, text) = Oracle[name];
        Assert.Equal(text, NextNetworkTextWriter.Write(model, ScopeOf(model)));
        Assert.Null(NextModelOracle.Check(name, model).Reason);
    }

    static readonly IReadOnlyDictionary<string, (NetworkBody Model, string Text)> Oracle = new Dictionary<string, (NetworkBody, string)>
    {
        // A wire, a fan-out of it, and a series contact on a literal — already the page's "Wires" example.
        ["Mach1_MIDS N0"] = (
            Ld("DONE Network 1: Activating/deactivating MID-S/Trayfiller",
                Def(0, L("TRUE")),
                Def(1, And(Ref(0), L("Mach1_Safety.Status.Custom_ATF_Disabled", Neg))),
                Set(Ref(1), T("Mach1_AuxData.TrayfillerActive")),
                Set(Ref(1), T("HMI_Var.TrayfillerActive")),
                Set(And(Ref(0), L("TRUE")), T("Mach1_AuxData.MIDS_Active"))),
            LdMarker +
            "NETWORK TITLE: \"DONE Network 1: Activating/deactivating MID-S/Trayfiller\"\n" +
            "  VAR_TEMP g0, g1 : BOOL; END_VAR\n" +
            "  g0 := TRUE;\n" +
            "  g1 := (g0 AND NOT Mach1_Safety.Status.Custom_ATF_Disabled);\n" +
            "  Mach1_AuxData.TrayfillerActive := g1;\n" +
            "  HMI_Var.TrayfillerActive := g1;\n" +
            "  Mach1_AuxData.MIDS_Active := (g0 AND TRUE);\n" +
            "END_NETWORK\n"),

        // One Assign, two coils (v1: `LET m1`), off a TON consumed by its Q — Q is its main output and no ENO.
        ["Mach1_MIDS N10"] = (
            Ld(null, Set(
                FbByQ("TON", "TON_DelayAfterNetworkError", new[]
                {
                    In(And(L("Mach1_Alarms.Alm011"), L("Mach1_Alarms.Alm011", Neg)), "IN"), In(L("T#10000S"), "PT"),
                }, "BOOL"),
                T("EtherCAT_Master.xRestart"), T("REQ_RestartComm", SetBit))),
            LdMarker +
            "NETWORK\n" +
            "  EtherCAT_Master.xRestart :=\n" +
            "  REQ_RestartComm S= TON_DelayAfterNetworkError(IN := (Mach1_Alarms.Alm011 AND NOT Mach1_Alarms.Alm011), PT := T#10000S);\n" +
            "END_NETWORK\n"),

        // A call whose only output is ENO (`Names=['ENO']`), its EN wired to TRUE, read through the ENO as a
        // series contact (v1: `LET en1 := TRUE; IF en1 THEN MainDrive(); END_IF`).
        ["Mach1_MIDS N13"] = (
            Ld("TODO NETWORK 6", Set(
                And(EnEno("MainDrive", L("TRUE"), Array.Empty<Input>(), Array.Empty<Output>(), consumed: true, "BOOL"),
                    L("Mach1.GenFlags.DriveIsRunning")),
                T("HMI_Var.Mach1.HourCounterRunning", SetBit))),
            LdMarker +
            "NETWORK TITLE: \"TODO NETWORK 6\"\n" +
            "  HMI_Var.Mach1.HourCounterRunning S= (MainDrive(EN := TRUE).ENO AND Mach1.GenFlags.DriveIsRunning);\n" +
            "END_NETWORK\n"),

        // MOVE boxes lighting lamps: EN wired, the result on slot 1 (`=> HMI_Var.Mach1.Status`), the lamp on ENO.
        // ‹E1›/‹E2› are AND/OR boxes, not Parallels.
        ["Mach1_MIDS N82"] = (
            Ld("DONE NETWORK 49: State of the machine",
                Def(22, L("TRUE")),
                Set(EnEno("MOVE", And(Ref(22), Or(L("Mach1.GenFlags.MajorAlarm"), L("Mach1.GenFlags.MinorAlarm"))),
                    new[] { In(L("0")) }, new[] { Out("HMI_Var.Mach1.Status", 1) }, consumed: true, "BOOL", null), T("tAlarmSL")),
                Def(23, And(Ref(22), L("Mach1.GenFlags.MajorAlarm", Neg), L("Mach1.GenFlags.MinorAlarm", Neg))),
                Set(EnEno("MOVE", And(Ref(23), L("Mach1.GenFlags.Warning")),
                    new[] { In(L("1")) }, new[] { Out("HMI_Var.Mach1.Status", 1) }, consumed: true, "BOOL", null), T("tWarningSL")),
                Def(24, And(Ref(23), L("Mach1.GenFlags.Warning", Neg))),
                Set(EnEno("MOVE", And(Ref(24), L("Mach1.GenFlags.RunMan", Neg), L("Mach1.GenFlags.RunAuto", Neg)),
                    new[] { In(L("2")) }, new[] { Out("HMI_Var.Mach1.Status", 1) }, consumed: true, "BOOL", null), T("tStandbySL")),
                Set(EnEno("MOVE", And(Ref(24), Or(L("Mach1.GenFlags.RunMan"), L("Mach1.GenFlags.RunAuto"))),
                    new[] { In(L("3")) }, new[] { Out("HMI_Var.Mach1.Status", 1) }, consumed: true, "BOOL", null), T("tRunningSL"))),
            LdMarker +
            "NETWORK TITLE: \"DONE NETWORK 49: State of the machine\"\n" +
            "  VAR_TEMP g22, g23, g24 : BOOL; END_VAR\n" +
            "  g22 := TRUE;\n" +
            "  tAlarmSL := MOVE(EN := (g22 AND (Mach1.GenFlags.MajorAlarm OR Mach1.GenFlags.MinorAlarm)), 0, => HMI_Var.Mach1.Status).ENO;\n" +
            "  g23 := (g22 AND NOT Mach1.GenFlags.MajorAlarm AND NOT Mach1.GenFlags.MinorAlarm);\n" +
            "  tWarningSL := MOVE(EN := (g23 AND Mach1.GenFlags.Warning), 1, => HMI_Var.Mach1.Status).ENO;\n" +
            "  g24 := (g23 AND NOT Mach1.GenFlags.Warning);\n" +
            "  tStandbySL := MOVE(EN := (g24 AND NOT Mach1.GenFlags.RunMan AND NOT Mach1.GenFlags.RunAuto), 2, => HMI_Var.Mach1.Status).ENO;\n" +
            "  tRunningSL := MOVE(EN := (g24 AND (Mach1.GenFlags.RunMan OR Mach1.GenFlags.RunAuto)), 3, => HMI_Var.Mach1.Status).ENO;\n" +
            "END_NETWORK\n"),

        // A wire fed by an OR of a TON's Q and two series rungs, driving one Assign with four coils (set, then
        // three resets — `Negation+Set` on the vendor), and a second rung off the same wire.
        ["TrayFiller N1"] = (
            Ld("DONE NETWORK 2: Condition: Rest position",
                Def(0, Or(
                    FbByQ("TON", "TMR_InpusherDown", new[] { In(L("stLowerInpusher"), "IN"), In(L("T#500MS"), "PT") }, "BOOL", "TIME"),
                    And(L("stInfeedTray"), L("iPsInfeedConvAtElev")),
                    And(L("stLightCurtainInterruptedBeforeStart"), L("iLightCurtainInpusher"), L("iGenFlags.StartFlag")))),
                Set(Ref(0), T("stRestposition", SetBit), T("stLowerInpusher", ResetBit), T("stInfeedTray", ResetBit),
                    T("stLightCurtainInterruptedBeforeStart", ResetBit)),
                Set(And(Ref(0), L("iFcGuardTrayOnElev", Neg), L("iTestProd")), T("Trayfiller_Data.Alarms.AlmTrayInfeeding", SetBit))),
            LdMarker +
            "NETWORK TITLE: \"DONE NETWORK 2: Condition: Rest position\"\n" +
            "  VAR_TEMP g0 : BOOL; END_VAR\n" +
            "  g0 := (TMR_InpusherDown(IN := stLowerInpusher, PT := T#500MS) OR (stInfeedTray AND iPsInfeedConvAtElev) OR (stLightCurtainInterruptedBeforeStart AND iLightCurtainInpusher AND iGenFlags.StartFlag));\n" +
            "  stRestposition S=\n" +
            "  stLowerInpusher R=\n" +
            "  stInfeedTray R=\n" +
            "  stLightCurtainInterruptedBeforeStart R= g0;\n" +
            "  Trayfiller_Data.Alarms.AlmTrayInfeeding S= (g0 AND NOT iFcGuardTrayOnElev AND iTestProd);\n" +
            "END_NETWORK\n"),

        // An enabled ADD incrementing a counter, its ENO driving five coils — one item, where v1 needed an `en`
        // echo and five statements.
        ["TrayFiller N6"] = (
            Ld("TODO NETWORK 7: Condition: Decend tray", Set(
                EnEno("ADD",
                    And(Or(
                            FbByQ("TON", "TMR_DelayDescend", new[]
                            {
                                In(And(L("stInpushingRow"), L("iLightCurtainInpusher"), L("iEpsInpusher")), "IN"), In(L("T#500MS"), "PT"),
                            }, "BOOL", "TIME"),
                            And(L("stLightCurtainInterruptedDuringInpushing"), L("iLightCurtainInpusher"), L("iGenFlags.StartFlag"))),
                        L("stFaultInpusherBlocked.Q1", Neg)),
                    new[] { In(L("ioActNumberOfRows")), In(L("1")) }, new[] { Out("ioActNumberOfRows", 1) }, consumed: true, "BOOL", "INT"),
                T("stDecendTray", SetBit), T("stInpushingRow", ResetBit), T("stLightCurtainInterruptedDuringInpushing", ResetBit),
                T("stSrCigarAtEndBeforeLast", ResetBit), T("stSrCigarAtEnd", ResetBit))),
            LdMarker +
            "NETWORK TITLE: \"TODO NETWORK 7: Condition: Decend tray\"\n" +
            "  stDecendTray S=\n" +
            "  stInpushingRow R=\n" +
            "  stLightCurtainInterruptedDuringInpushing R=\n" +
            "  stSrCigarAtEndBeforeLast R=\n" +
            "  stSrCigarAtEnd R= ADD(EN := ((TMR_DelayDescend(IN := (stInpushingRow AND iLightCurtainInpusher AND iEpsInpusher), PT := T#500MS) OR (stLightCurtainInterruptedDuringInpushing AND iLightCurtainInpusher AND iGenFlags.StartFlag)) AND NOT stFaultInpusherBlocked.Q1), ioActNumberOfRows, 1, => ioActNumberOfRows).ENO;\n" +
            "END_NETWORK\n"),

        // The page's "honest regression": three wires, two edge FBs, a top-level enabled ADD writing its own pin,
        // and the one Parallel (‹E4›) — fed by an ADD read through its ENO, whose EN is a MUL read through ITS ENO,
        // with a branch that is a GE showing EN unwired and no ENO, connected by its result.
        ["TrayFiller N8"] = (
            Ld("TODO NETWORK 9: Condition: Tray decend",
                Def(2, L("True")),
                Def(3, And(Ref(2), L("True"))),
                Def(4, And(Ref(3), L("iPulseCounterElevator"))),
                Set(FbByQ("R_TRIG", "stRePulseCounter", new[] { In(Ref(4), "CLK") }, "BOOL"), T("tBool")),
                Set(FbByQ("F_TRIG", "stFePulseCounter", new[] { In(Ref(4), "CLK") }, "BOOL"), T("tBool", SetBit)),
                EnEno("ADD", And(Ref(3), L("tBool"), Or(L("stDecendTray"), L("stTrayDecended"), L("stTiltInpusher"))),
                    new[] { In(L("stActHeightElevator")), In(L("5")) }, new[] { Out("stActHeightElevator", 1) }, consumed: false, "BOOL", "INT"),
                Set(new Parallel(
                        EnEno("ADD",
                            EnEno("MUL", And(Ref(2), L("stDecendTray")),
                                new[] { In(L("ioActNumberOfRows")), In(L("iRowHeight")) }, new[] { Out("tInt", 1) }, consumed: true, "BOOL", "INT"),
                            new[] { In(L("tInt")), In(L("iInitialDescentValue")) }, new[] { Out("tInt", 1) }, consumed: true, "BOOL", "INT"),
                        new Node[]
                        {
                            Call("GE", new[] { In(L("stActHeightElevator")), In(L("tInt")) }, en: Empty, main: 0, connected: 0, eno: false,
                                types: new string?[] { "BOOL" }, kind: CallKind.Operator),
                            L("iPsElevatorDown"),
                        },
                        ParallelMode.BoxShortCircuit),
                    T("stTrayDecended", SetBit), T("stDecendTray", ResetBit))),
            LdMarker +
            "NETWORK TITLE: \"TODO NETWORK 9: Condition: Tray decend\"\n" +
            "  VAR_TEMP g2, g3, g4 : BOOL; END_VAR\n" +
            "  g2 := True;\n" +
            "  g3 := (g2 AND True);\n" +
            "  g4 := (g3 AND iPulseCounterElevator);\n" +
            "  tBool := stRePulseCounter(CLK := g4);\n" +
            "  tBool S= stFePulseCounter(CLK := g4);\n" +
            "  ADD(EN := (g3 AND tBool AND (stDecendTray OR stTrayDecended OR stTiltInpusher)), stActHeightElevator, 5, => stActHeightElevator);\n" +
            "  stTrayDecended S=\n" +
            "  stDecendTray R= PARALLEL(IN := ADD(EN := MUL(EN := (g2 AND stDecendTray), ioActNumberOfRows, iRowHeight, => tInt).ENO, tInt, iInitialDescentValue, => tInt).ENO, GE(EN := , stActHeightElevator, tInt), iPsElevatorDown);\n" +
            "END_NETWORK\n"),
    };
}
