using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Network;
// `Parallel` is also System.Threading.Tasks.Parallel; this file means the LD branch.
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Cli.Ide.Twincat;

/// <summary>
/// A TwinCAT <c>&lt;NWL&gt;</c> archive as a <see cref="NetworkBody"/>.
///
/// <para>The shapes below are the SAME object model CODESYS exposes live — same assembly family, same
/// <c>IBoxTreeVisitor</c> closed set — so this reader and <c>CodesysNetworkReader</c> produce the same model
/// for the same logic, which is what keeps the two vendors byte-identical on the wire. Only the ACCESS differs:
/// CODESYS hands over objects, TwinCAT hands over their serialization.</para>
///
/// <para><b>The member names differ from the live model, and the differences are the whole risk here</b>, so
/// they are stated once: an operand's text is <c>Operand</c> (live: <c>OperandExpr</c>), its l-value marker is
/// <c>LValue</c> (live: <c>IsLValue</c>), a box's inputs are <c>InputItems</c> (live: <c>InputItemList</c>),
/// outputs are <c>OutputItems</c> nested inside an <c>OutputItemList</c> object (live: a flat <c>Outputs</c>),
/// and a network's trees are <c>NetworkItems</c> (live: <c>GetTree(i)</c>). Reading one by the wrong name
/// yields a silently empty body, so each is used exactly once, here.</para>
/// </summary>
internal static class TcNetworkReader
{
    public static NetworkBody Read(XElement impl, BodyLanguage language)
    {
        var networks = TcArchive.List(impl, "NetworkList")
            .Select((n, i) => ReadNetwork(n, i))
            .ToList();
        return new NetworkBody(language, networks);
    }

    private static Network ReadNetwork(XElement net, int order) =>
        new Network(
            order,
            TcArchive.Str(net, "Title"),
            TcArchive.Str(net, "Label"),
            TcArchive.Str(net, "Comment"),
            TcArchive.Bool(net, "OutCommented"),
            TcArchive.List(net, "NetworkItems").Select(ReadNode).ToList(),
            Array.Empty<Operand>());

    private static Node ReadNode(XElement e)
    {
        var flags = ReadFlags(TcArchive.FlagBits(e));
        switch (TcArchive.TypeOf(e))
        {
            case "BoxTreeOperand":
                return new Leaf(ReadOperand(TcArchive.Obj(e, "Operand")), flags);

            case "BoxTreeAssign":
                return new Assign(
                    TcArchive.Obj(e, "RValue") is { } rv ? ReadNode(rv) : null,
                    Outputs(e),
                    flags);

            case "BoxTreeBox":
                return new Box(
                    TcArchive.Str(e, "BoxType") ?? "",
                    TcArchive.Obj(e, "Instance") is { } inst ? ReadOperand(inst) : null,
                    CallKindOf(e),
                    TcArchive.List(e, "InputItems").Select(x => new Input(null, ReadNode(x), Flags.None)).ToList(),
                    Outputs(e),
                    TcArchive.Obj(e, "En") is { } en ? ReadNode(en) : null,
                    null,   // an Execute box's ST snippet: see the note in ReadStCode's CODESYS counterpart
                    flags);

            // Fan-out: with an Input it DEFINES the wire, without one it REFERENCES the same VarId.
            case "BoxTreeDemux":
                return new Demux(
                    TcArchive.Int(e, "VarId"),
                    TcArchive.Obj(e, "Input") is { } di ? ReadNode(di) : null,
                    flags);

            case "BoxTreeParallel":
                return new Parallel(
                    TcArchive.Obj(e, "Input") is { } pi ? ReadNode(pi) : null,
                    TcArchive.List(e, "Trees").Select(ReadNode).ToList(),
                    string.Equals(TcArchive.Str(e, "Mode"), "And", StringComparison.OrdinalIgnoreCase)
                        ? ParallelMode.And : ParallelMode.Or,
                    flags);

            case "BoxTreeTerminator":
                return new Terminator(
                    TcArchive.Obj(e, "Input") is { } ti ? ReadNode(ti) : null,
                    flags);

            default:
                throw new NotSupportedException(
                    $"TwinCAT: the graphical item '{TcArchive.TypeOf(e) ?? "?"}' has no network-text form yet. " +
                    "Volt refuses to materialize a body it cannot represent, rather than rendering an " +
                    "approximation an engineer would then push back.");
        }
    }

    /// <summary>An item's outputs. The archive nests them one level deeper than the live model does — an
    /// <c>OutputItems</c> object of type <c>OutputItemList</c>, itself holding an <c>OutputItems</c> list.</summary>
    private static IReadOnlyList<Operand> Outputs(XElement e)
    {
        var holder = TcArchive.Obj(e, "OutputItems");
        if (holder == null) return Array.Empty<Operand>();
        return TcArchive.List(holder, "OutputItems").Select(x => ReadOperand(x)).ToList();
    }

    private static Operand ReadOperand(XElement? o)
    {
        if (o == null) return new Operand("");
        return new Operand(
            TcArchive.Str(o, "Operand") ?? "",
            TcArchive.Str(o, "Type"),
            TcArchive.Str(o, "SymbolComment"),
            TcArchive.Bool(o, "IsInstance"),
            TcArchive.Bool(o, "LValue"),
            ReadFlags(TcArchive.FlagBits(o)));
    }

    /// <summary>The vendor bit-field. The archive stores a NUMBER where the live model exposes named booleans,
    /// so the bit values are decoded here — from <c>IFlags</c>'s own member order, not from a guess.</summary>
    private static Flags ReadFlags(int bits) =>
        bits == 0
            ? Flags.None
            : new Flags(
                Negated: (bits & TcArchive.FlagNegation) != 0,
                Set: (bits & TcArchive.FlagSet) != 0,
                Reset: false,
                Jump: (bits & TcArchive.FlagJump) != 0,
                Return: (bits & TcArchive.FlagReturn) != 0,
                Rising: (bits & TcArchive.FlagRtrig) != 0,
                Falling: (bits & TcArchive.FlagFtrig) != 0);

    /// <summary>A box's call kind. The archive carries <c>CallType</c> as an <c>Operator</c> object; an
    /// instance means a function-block call, and neither means a stateless function.</summary>
    private static CallKind CallKindOf(XElement e)
    {
        if (TcArchive.Obj(e, "CallType") != null) return CallKind.Operator;
        return TcArchive.Obj(e, "Instance") == null ? CallKind.Function : CallKind.FunctionBlock;
    }
}
