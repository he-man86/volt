using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.Network.Next;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Engine.Tests;

/// <summary>
/// Model builders for the network text v2 reader and gate tests, and <see cref="WriterGoldens"/> — every model
/// <c>NextNetworkTextWriterTests</c> writes successfully, rebuilt here field for field so the model oracle
/// <c>Read(Write(m)) ≅ m</c> runs over exactly the shapes the writer goldens pin. (Copied rather than shared:
/// the writer tests stay as they were written, and a model changed there does not silently change the oracle.)
/// </summary>
internal static class NextModels
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

    public static Network Net(params Node[] trees) => new(0, null, null, null, false, trees);

    public static NetworkBody Body(Network net, BodyLanguage lang = BodyLanguage.Fbd) => new(lang, new[] { net });
    public static NetworkBody Body(Node tree, BodyLanguage lang = BodyLanguage.Fbd) => Body(Net(tree), lang);

    /// <summary>The scope a model's text needs to be read back: its FB instances (the declarations would carry
    /// them) plus <paramref name="names"/>.</summary>
    public static NextNetworkScope ScopeOf(NetworkBody body, params string[] names) =>
        new(names, Array.Empty<string>(), NextModelOracle.Instances(body));

    /// <summary>Every model <c>NextNetworkTextWriterTests</c> writes without refusing, by the test that pins it.</summary>
    public static readonly IReadOnlyDictionary<string, NetworkBody> WriterGoldens = BuildGoldens();

    private static Dictionary<string, NetworkBody> BuildGoldens()
    {
        var g = new Dictionary<string, NetworkBody>();
        void Add(string name, NetworkBody b) => g.Add(name, b);

        Add("marker.ld-empty-item", Body(Empty, BodyLanguage.Ld));
        Add("marker.order-7", Body(new Network(7, null, null, null, false, new Node[] { Empty })));
        Add("header.full", Body(new Network(0, "Tray \"A\" ready", "Done",
            "Indented notes keep their indentation:\n    step 1 — wait for the tray\n\n// a line that itself starts with two slashes",
            true, new Node[] { Def(0, L("TRUE")) })));
        Add("comment.shape", Body(new Network(0, null, null, "step:\n\n    indented\n// quoted", false, new Node[] { Set(L("a"), T("out")) })));
        Add("title.escapes", Body(new Network(0, "line 1\nline 2 costs $5", null, null, false, new Node[] { Empty })));
        Add("value.flagged-box", Body(Call("f", new[] { In(L("x")) }, f: Neg)));
        Add("value.no-input-slot", Body(Call("GetTime", Array.Empty<Input>())));
        Add("value.leaf", Body(L("a")));
        Add("value.parallel", Body(new Parallel(null, new Node[] { L("a"), L("b") }, ParallelMode.BoxShortCircuit)));
        Add("value.wire-ref", Body(Net(Def(1, L("TRUE")), Ref(1))));
        Add("empty-item", Body(Net(Set(L("a"), T("out")), Empty)));
        Add("backtick.in-pin", Body(Fb("t1", new[] { In(L("DINT_TO_REAL(x)"), "IN") })));
        Add("backtick.typed-call", Body(Fb("fb", new[] { In(L("fc_dinttotime(T.Start,2)"), "P") })));
        Add("backtick.lvalue-index", Body(Set(L("x"), T("arr[i + 1]"))));
        Add("backtick.lvalue-space", Body(Set(L("x"), T("a .b"))));
        Add("tokens.bare", Body(Set(Op("OR", Op("AND", L("s.f"), L("T#1S")), L("???")), T("out"))));
        Add("infix.nested", Body(Set(Op("OR", Op("AND", L("a"), L("b")), L("c")), T("out"))));
        Add("not.modifier", Body(Set(L("a", Neg), T("out"))));
        Add("not.on-group", Body(Set(new Box("AND", null, CallKind.Operator, new[] { In(L("a")), In(L("b")) }, new Output[0], null, null, Neg), T("out"))));
        Add("not.box", Body(Set(Call("NOT", new[] { In(L("a")) }, main: null), T("out"))));
        Add("not.box-around-group", Body(Set(Call("NOT", new[] { In(Op("AND", L("a"), L("b"))) }, main: null), T("out"))));
        Add("edge.on-en", Body(Call("MOVE", new[] { In(L("1")) }, new[] { Out("nMode", 1) }, en: L("bStart", Rise), eno: true)));
        Add("edge.on-group", Body(Set(new Box("AND", null, CallKind.Operator, new[] { In(L("a")), In(L("b")) }, new Output[0], null, null, Rise), T("lamp"))));
        Add("edge.negated", Body(Set(L("x", Neg with { Falling = true }), T("out"))));
        Add("call.fb", Body(Fb("t1", new[] { In(L("a"), "IN"), In(L("pt"), "PT") }, new[] { Out("el", 2, "ET") }, "TON")));
        Add("call.named-output", Body(Set(Call("f", new[] { In(L("src")) }, new[] { Out("err", 1, "oErr") }, connected: 0, eno: false), T("dst"))));
        Add("call.function", Body(Set(Call("MAX", new[] { In(L("a")), In(L("b")) }, connected: 0, eno: false), T("out"))));
        Add("unnamed.instance", Body(Call("TON", new[] { In(L("a"), "IN"), In(L("t"), "PT") }, main: null,
            instance: new Operand("???", IsInstance: true), kind: CallKind.FunctionBlock)));
        Add("unnamed.target", Body(Set(L("ioAxis.xVirtual"), T("???"))));
        Add("unnamed.pins", Body(Fb("t1", new[] { In(L("???"), "IN"), In(L("pt"), "PT") }, new[] { Out("???", 2, "ET") }, "TON")));
        Add("unnamed.in-group", Body(Set(Op("AND", L("???"), L("a")), T("out"))));
        Add("formals.default", Body(Set(Call("AND", new[] { In(L("a"), "IN1"), In(L("b"), "IN2") }, main: null), T("out"))));
        Add("formals.non-default", Body(Set(Call("ADD", new[] { In(L("a"), "X"), In(L("b")) }, connected: 0, eno: false), T("out"))));
        Add("en.unconsumed", Body(Call("MOVE", new[] { In(L("b")) }, en: L("a"))));
        Add("en.result-pin", Body(Call("MOVE", new[] { In(L("0")) }, new[] { Out("Status", 1) }, en: L("c"), eno: true)));
        Add("en.operator-call-form", Body(Call("AND", new[] { In(L("a")), In(L("b")) }, new[] { Out("out", 1) }, en: L("go"), main: null, eno: true)));
        Add("en.chain", Body(Call("GT", new[] { In(L("sensor")), In(L("diff")) }, new[] { Out("out", 1) }, eno: true,
            en: Call("SUB", new[] { In(L("light")), In(L("deviation")) }, new[] { Out("diff", 1) }, en: L("rung"), connected: 0, eno: true))));
        Add("eno.lamp", Body(Set(Call("MOVE", new[] { In(L("0")) }, new[] { Out("Status", 1) }, en: L("c"), connected: 0, eno: true), T("lamp"))));
        Add("eno.unwired-en", Body(Set(Call("GE", new[] { In(L("stActHeightElevator")), In(L("tInt")) }, en: Empty, connected: 0, eno: false), T("out"))));
        Add("eno.unwired-en-with-eno", Body(Set(Call("MUL", new[] { In(L("a")), In(L("b")) }, en: Empty, connected: 0, eno: true), T("out"))));
        Add("slots.top-level", Body(Call("MOVE", new[] { In(L("src")) }, new[] { Out("dst", 0) }, eno: false)));
        Add("slots.consumed", Body(Set(Call("f", new[] { In(L("src")) }, new[] { Out("err", 1) }, connected: 0, eno: false), T("out"))));
        Add("slots.passed-over", Body(Set(Call("f", new[] { In(L("src")) }, new[] { Out("b", 2) }, connected: 0, eno: false), T("out"))));
        Add("empty.mul", Body(Op("MUL", Empty, L("iRPM"), L("6"))));
        Add("empty.named", Body(Fb("ctu", new[] { In(L("a"), "CU"), In(Empty, "RESET"), In(Empty, "PV") })));
        Add("empty.leading", Body(Call("f", new[] { In(Empty), In(L("a")) })));
        Add("empty.trailing", Body(Call("f", new[] { In(L("a")), In(Empty) })));
        Add("empty.lone-named", Body(Call("MOVE", new[] { In(Empty, "IN") })));
        Add("empty.coil", Body(Set(Empty, T("coil"))));
        Add("execute.statement", Body(Exec("IF bStart THEN\n\ttarget := 40 + 2;\nEND_IF", L("bRun"))));
        Add("execute.empty", Body(Exec("", L("bRun"))));
        Add("execute.value", Body(Set(Exec("x := 1;", L("bRun"), connected: 0), T("out"))));
        Add("execute.value-no-en", Body(Set(Exec("x := 1;", connected: 0), T("out"))));
        Add("execute.network-line", Body(Exec("NetworkState := 1;")));
        Add("coils.chained", Body(Net(Def(0, L("TRUE")), Set(L("x"), T("lamp")),
            Set(Ref(0), T("stRestposition", SetBit), T("stLowerInpusher", ResetBit), T("stInfeedTray", ResetBit)))));
        Add("jumps.five-networks", new NetworkBody(BodyLanguage.Fbd, new[]
        {
            Net(new Assign(L("a"), new[] { T("Done", JumpBit) }, JumpBit)),
            new Network(1, null, "Done", null, false, new Node[] { Set(L("a"), T("out")) }),
            Net(new Assign(Empty, new[] { T("Done", JumpBit) }, JumpBit)),
            Net(new Assign(L("a"), new Operand[0], ReturnBit)),
            Net(new Assign(Empty, new Operand[0], ReturnBit)),
        }));
        Add("wires.mach1-n0", Body(new Network(0, "DONE Network 1: Activating/deactivating MID-S/Trayfiller", null, null, false, new Node[]
        {
            Def(0, L("TRUE")),
            Def(1, Op("AND", Ref(0), L("Mach1_Safety.Status.Custom_ATF_Disabled", Neg))),
            Set(Ref(1), T("Mach1_AuxData.TrayfillerActive")),
            Set(Ref(1), T("HMI_Var.TrayfillerActive")),
            Set(Op("AND", Ref(0), L("TRUE")), T("Mach1_AuxData.MIDS_Active")),
        }), BodyLanguage.Ld));
        Add("wires.single-consumer", Body(Net(Def(28, Op("AND", L("a"), L("b"))), Set(Ref(28), T("out")))));
        Add("wires.typed-box", Body(Net(Def(1, Call("ADD", new[] { In(L("a"), "X"), In(L("b")) }, connected: 0, eno: false, types: new[] { "INT" })),
            Set(Call("GT", new[] { In(Ref(1)), In(L("c")) }, connected: 0, eno: false), T("o1")),
            Set(Call("LT", new[] { In(Ref(1)), In(L("d")) }, connected: 0, eno: false), T("o2")))));
        Add("wires.ld-leaf", Body(Net(Def(1, L("x")), Set(Ref(1), T("o"))), BodyLanguage.Ld));
        Add("wires.several-types", Body(Net(Def(1, L("TRUE")),
            Def(2, Call("ADD", new[] { In(L("a"), "X"), In(L("b")) }, connected: 0, eno: false, types: new[] { "INT" })),
            Def(3, Op("AND", Ref(1), L("c"))), Set(Ref(2), T("o")), Set(Ref(3), T("p")))));
        Add("parallel.fed", Body(Net(Def(54, L("TRUE")),
            Set(new Parallel(Ref(54), new Node[] { L("StartFlag"), L("tResetSafetyGuard") }, ParallelMode.BoxShortCircuit), T("ResetSafetyGuard", SetBit)))));
        Add("parallel.unfed", Body(Set(new Parallel(null, new Node[] { L("a"), L("b") }, ParallelMode.BoxShortCircuit), T("out"))));
        Add("infix.consumed-comparison", Body(Set(Call("GT", new[] { In(L("a")), In(L("b")) }, connected: 0, eno: false), T("o"))));
        Add("infix.consumed-arithmetic", Body(Set(Call("ADD", new[] { In(L("a")), In(L("b")) }, connected: 0, eno: false), T("out"))));
        Add("targets.literal", Body(Net(Set(L("a"), T("5")), Set(L("a"), T("16#FF")), Call("F", new[] { In(L("a")) }, new[] { Out("T#1s", 0) }, eno: false))));
        Add("empty.lone-beside-output", Body(Call("f", new[] { In(Empty) }, new[] { Out("x", 0) }, eno: false)));
        Add("parallel.sequential", Body(Set(new Parallel(L("f"), new Node[] { L("a"), L("b") }, ParallelMode.Sequential), T("out"))));
        return g;
    }
}
