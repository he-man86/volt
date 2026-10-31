using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.Network;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Tests.Shared;

/// <summary>
/// The model as network text v2.1 CARRIES it — the model oracle's "≅" is <c>Equal(Carried(a), Carried(b))</c>, so
/// <c>Read(Write(m)) ≅ m</c> fails exactly when the text lost a fact it is meant to carry. Test code: the ORACLE's
/// normalisation, shipped in no product.
///
/// <para><b>This is the list of what the text does NOT carry</b> (<c>v2-spec.md</c> section 2, "Members not carried"),
/// written down once. Adding a line is a claim that the text is not meant to carry that fact — never how a failing oracle
/// is made green.</para>
/// <list type="bullet">
/// <item>An operator pin's default formal (<c>IN&lt;n&gt;</c>, <c>IN</c> on MOVE and the NOT box) vs none — one text.</item>
/// <item>B7: a box's stored output names and types (<see cref="Box.Members"/>, <see cref="Box.OutputTypes"/>) — lost on
/// rebuild, named by <see cref="RebuildLoss"/>.</item>
/// <item>Network <c>Order</c> → its position; a <c>Title</c>/<c>Comment</c> stored <c>""</c> → none (one text).</item>
/// <item>An operand's <c>Type</c>, <c>Comment</c>, its copy of its item's flags; <c>IsInstance</c> / <c>IsLValue</c> are what
/// the position says.</item>
/// <item><c>Box.Kind</c> → <see cref="NetworkSpelling.KindOf"/> (derived on push from the declarations).</item>
/// <item><c>ConnectedSlot</c> where the text states no slot: a top-level box (none), a bit operator read by its value (the
/// vendor stores none), an FB read by <c>.name</c> (the name is carried, its slot is the declaration's).</item>
/// <item><c>HasEnoOutput</c> where the text shows nothing of it: an FB with no EN that nothing reads through ENO (its
/// declared ENO, unread); an Execute box has one by type.</item>
/// <item><c>MainOutputName</c> anywhere but on a consumed FB read by a data output.</item>
/// <item>A NAMED output's slot (the box type's), the ENO pin's included.</item>
/// <item>Control flow: the Jump/Return bit rides on the target and on the item as a cache (C13) — carried as the OR of the
/// targets', a lone target taking the item's; a target-less return's target is the vendor's <c>???</c>.</item>
/// <item>A CR LF line ending in an EXECUTE snippet is the FILE's layout: the LF alone.</item>
/// </list>
/// </summary>
public static class NetworkTextFacts
{
    public static NetworkBody Carried(NetworkBody body) =>
        new(body.Language, body.Networks.Select((n, i) => new Network(
            i, Text(n.Title), n.Label, Text(n.Comment), n.Disabled, n.Trees.Select(t => Node(t, consumed: false)).ToList(),
            n.Unsupported, n.UnsupportedHash)).ToList());

    private static string? Text(string? s) => string.IsNullOrEmpty(s) ? null : s;

    private static Node? NodeOrNull(Node? n) => n is null ? null : Node(n, consumed: true);

    private static Node Node(Node n, bool consumed) => n switch
    {
        Leaf l => new Leaf(new Operand(l.Operand.Text), l.Flags),
        Assign a => AssignOf(a),
        Box b => BoxOf(b, consumed),
        Demux d => new Demux(d.VarId, NodeOrNull(d.Input)),
        Parallel p => new Parallel(NodeOrNull(p.Input), p.Branches.Select(br => Node(br, consumed: true)).ToList(), p.Mode),
        Terminator t => new Terminator(t.Flags),
        _ => throw new NotSupportedException($"NetworkTextFacts does not know node {n.GetType().Name}"),
    };

    private static Assign AssignOf(Assign a)
    {
        var targets = a.Targets.Count == 0 && a.Flags.Return
            ? new[] { new Operand(Box.UnnamedInstance, IsLValue: true, Flags: Flags.None with { Return = true }) }
            : a.Targets.Count == 1 && (a.Flags.Jump || a.Flags.Return)
                ? new[] { a.Targets[0] with { Flags = (a.Targets[0].Flags ?? Flags.None) with
                    { Jump = a.Flags.Jump || a.Targets[0].Flags?.Jump == true, Return = a.Flags.Return || a.Targets[0].Flags?.Return == true } } }
                : a.Targets.ToArray();
        var carried = targets.Select(Target).ToList();
        var item = a.Flags with { Jump = false, Return = false };
        return new Assign(Node(a.Value, consumed: true), carried, item.WithControlFlowFrom(carried));
    }

    private static Operand Target(Operand t) => new(t.Text, IsLValue: true, Flags: t.Flags is { IsNone: false } f ? f : null);

    private static Box BoxOf(Box b, bool consumed)
    {
        var isFb = b.Instance is not null;
        var isExecute = b.StCode is not null;
        var byEno = consumed && NetworkSpelling.ConnectedByEno(b);
        var byName = consumed && isFb && !byEno ? b.MainOutputName : null;
        int? connected = !consumed || byName is not null ? null
            : !byEno && NetworkSpelling.MainSlotOfCall(b.Type) is null ? null
            : b.ConnectedSlot;
        // `.ENO` carries whether a box shows ENO, an Execute box has its ENO by type
        var hasEno = isExecute || b.HasEnoOutput;
        return new Box(
            b.Type,
            // The instance's text and its flags: the text has no position for a flag on the instance operand, so the writer
            // refuses one — which only holds if the oracle compares it.
            b.Instance is null ? null : new Operand(b.Instance.Text, IsInstance: true,
                Flags: b.Instance.Flags is { IsNone: false } f ? f : null),
            NetworkSpelling.KindOf(b.Type, isFb),
            b.Inputs.Select((p, i) => new Input(p.Formal,
                Node(p.Value, consumed: true), p.Flags)).ToList(),
            b.Outputs.Select(o => new Output(o.Formal, Target(o.Value), o.Formal is not null ? null : o.Slot)).ToList(),
            NodeOrNull(b.Enable),
            b.StCode?.Replace("\r\n", "\n"),
            b.Flags,
            ConnectedSlot: connected,
            OutputTypes: null,
            HasEnoOutput: hasEno,
            MainOutputName: byName,
            Members: null) { EnableFlags = b.EnableFlags };
    }
}
