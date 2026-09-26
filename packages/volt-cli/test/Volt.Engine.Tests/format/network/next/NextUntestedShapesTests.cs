using System.Collections.Generic;
using Xunit;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.Network.Next;
using static Volt.Engine.Tests.NextModels;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Engine.Tests;

/// <summary>
/// Task 2.13 / review 7.17: shapes no test had pinned, each as a golden text AND model — the writer writes the model
/// to the text, and the text reads back to the model and passes the gate (<see cref="NextModelOracle"/>). The rest of
/// 7.17's list (DISABLED/LABEL headers, an edge on EN, <c>R_EDGE((a AND b))</c>, an edge on <c>.ENO</c>, NOT with an
/// edge, the negated-only coil) is pinned in <see cref="NextNetworkTextWriterTests"/>.
/// </summary>
public class NextUntestedShapesTests
{
    public static TheoryData<string> Shapes()
    {
        var d = new TheoryData<string>();
        foreach (var k in Goldens.Keys) d.Add(k);
        return d;
    }

    [Theory]
    [MemberData(nameof(Shapes))]
    public void The_shape_is_pinned_as_text_and_as_a_model(string name)
    {
        var (model, text) = Goldens[name];
        Assert.Equal(text, NextNetworkTextWriter.Write(model, ScopeOf(model)));
        Assert.Null(NextModelOracle.Check(name, model).Reason);
    }

    static readonly IReadOnlyDictionary<string, (NetworkBody Model, string Text)> Goldens = new Dictionary<string, (NetworkBody, string)>
    {
        // An LD rising contact: the vendor holds it as the Rtrig bit on the contact's OPERAND (DIALECT N4; census 1.7
        // found one, pro2193 `Counters`) — a flag, never an R_TRIG box.
        ["an LD rising contact"] = (Ld1(Set(Op("AND", L("a", Rise), L("b")), T("out"))),
            LdSrc("out := (R_EDGE(a) AND b);")),
        // …and a falling one with the negation the vendor applies first (DIALECT N17).
        ["an LD negated falling contact"] = (Ld1(Set(Op("AND", L("a", Neg with { Falling = true }), L("b")), T("out"))),
            LdSrc("out := (F_EDGE(NOT a) AND b);")),

        // Edges on a Parallel's branches (and on its feed): the flags ride on the branch operands — the Parallel
        // itself holds none (DIALECT N20). Census 1.3/7.12: MainDrive net1's Parallel has a negated branch.
        ["edges in PARALLEL branches"] = (Ld1(Set(new Parallel(L("c", Rise),
                new Node[] { L("a", Rise), L("b", Neg with { Falling = true }), L("d", Neg) }, ParallelMode.BoxShortCircuit), T("out"))),
            LdSrc("out := PARALLEL(IN := R_EDGE(c), R_EDGE(a), F_EDGE(NOT b), NOT d);")),

        // ENO into a DATA pin — Lenze AHWF (the fc_CamC_CP_UDT shape): a MOVE's ENO feeds the function's first
        // input, `iEN : BOOL`, an ordinary data pin and not an EN; the function's result drives two reset coils.
        ["ENO into a data pin (fc_CamC_CP_UDT)"] = (Ld1(
                Def(10, L("True")),
                Set(Call("fc_CamC_CP_UDT", new[]
                    {
                        In(Call("MOVE", new[] { In(L("Mach1_Data.CamControls.TakeOverCycle_C.Stop")) },
                            new[] { Out("Mach1_AuxData.CamControls.TakeOverCycleStopPulse_CP.Start", 1) },
                            en: Ref(10), main: 0, connected: 0, eno: true)),
                        In(L("HMI_Var.Mach1.Position")), In(L("Mach1.GenFlags.Rotflag")),
                        In(L("Mach1_AuxData.CamControls.TakeOverCycleStopPulse_CP")),
                    }, main: 0, connected: 0, eno: false),
                    T("Mach1_AuxData.MemWrapperPresentForLeafCarrier", ResetBit), T("Mach1_AuxData.MemWrapperPassedUnderTheSensor", ResetBit))),
            LdSrc("VAR_TEMP g10 : BOOL; END_VAR",
                "g10 := True;",
                "Mach1_AuxData.MemWrapperPresentForLeafCarrier R=",
                "Mach1_AuxData.MemWrapperPassedUnderTheSensor R= fc_CamC_CP_UDT(MOVE(EN := g10, Mach1_Data.CamControls.TakeOverCycle_C.Stop, => Mach1_AuxData.CamControls.TakeOverCycleStopPulse_CP.Start).ENO, HMI_Var.Mach1.Position, Mach1.GenFlags.Rotflag, Mach1_AuxData.CamControls.TakeOverCycleStopPulse_CP);")),
    };
}
