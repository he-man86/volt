using System;
using System.Linq;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.Network.Next;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Tests.Shared;

/// <summary>
/// The model as network text v2 CARRIES it — the model oracle's "≅" is <c>Equal(Carried(a), Carried(b))</c>, so
/// <c>Read(Write(m)) ≅ m</c> fails exactly when the text lost a fact it is meant to carry. Test code: it is the
/// ORACLE's normalisation, and ships in no product (compiled into each suite that runs the oracle).
///
/// <para><b>This is the list of what the text does NOT carry, written down once.</b> Each line below is the spec's
/// one equivalence or a fact the text has no position for, which the push takes from the IDE's own box or the
/// declarations; none is a leniency. Adding a line here is a claim that the text is not supposed to carry that
/// fact — it must never be how a failing oracle is made green. Where the text CANNOT carry a fact that is not on
/// this list, the writer refuses the body by name instead.</para>
/// <list type="bullet">
/// <item>The spec's one equivalence: an infix box's absent ≡ default <c>InputParams</c> names (review 7.9).</item>
/// <item>Network <c>Order</c> → the network's position. The header has no order number.</item>
/// <item>An operand's <c>Type</c> and <c>Comment</c> (vendor metadata no statement spells), an operand's copy of its
/// item's flags; <c>IsInstance</c> / <c>IsLValue</c> are what the position says.</item>
/// <item><c>Box.Kind</c> → <see cref="NextSpelling.KindOf"/>: the vendor's <c>CallType</c> is the IDE's resolution
/// of the box type (a MOVE the IDE resolved reads <c>Operator</c>, the same box freshly built <c>None</c>).</item>
/// <item><c>Box.MainOutputIndex</c> where no connection names it — at the top level, and on a box consumed by ENO
/// or by no stored slot. It is the box TYPE's result slot, set by the IDE when it builds the box; where a consumer
/// IS connected by the main output the connection slot names it, and it is compared (the writer refuses every
/// main output the text would read back as another — <see cref="NextSpelling.MainSlotOfCall"/>).</item>
/// <item><c>OutputTypes</c> and <c>Demux.Type</c>: a wire's type is compared through the declaration the writer
/// derives from them, not as model fields (the vendor's Demux has no type; the text's has no stored types).</item>
/// <item><c>Box.HasEnoOutput</c> where the text does not decide by it (<see cref="NextSpelling.EnoCarried"/>): a
/// top-level box with no positional <c>=&gt;</c> pin, a box consumed by no stored slot, an Execute box. The ENO
/// output is the box type's; the text spells it only as <c>.ENO</c> and as the slot positional pins skip.</item>
/// <item>A NAMED output's slot → null: <c>F =&gt; v</c> names the pin, and the pin's slot is the box type's.</item>
/// <item>Control flow: the Jump/Return bit on the item AND its target (DIALECT C13 — the reader writes both); a
/// target-less return's target is the vendor's constant <c>???</c>.</item>
/// <item>A CR LF line ending in a comment or an EXECUTE snippet is the FILE's layout (spec, "the network header and
/// its comment"; the drivers compare ignoring it), so it is the LF alone. Every other character is carried.</item>
/// </list>
/// </summary>
public static class NextNetworkTextFacts
{
    public static NetworkBody Carried(NetworkBody body) =>
        new(body.Language, body.Networks.Select((n, i) => new Network(
            i, n.Title, n.Label, n.Comment?.Replace("\r\n", "\n"), n.Disabled, n.Trees.Select(t => Node(t, consumed: false)).ToList())).ToList());

    private static Node? NodeOrNull(Node? n) => n is null ? null : Node(n, consumed: true);

    /// <param name="consumed">Whether something consumes the node — everything but a top-level item. A box's
    /// ENO is carried differently at the top level (<see cref="NextSpelling.EnoCarried"/>).</param>
    private static Node Node(Node n, bool consumed) => n switch
    {
        Leaf l => new Leaf(new Operand(l.Operand.Text), l.Flags),
        Assign a => AssignOf(a),
        Box b => BoxOf(b, consumed),
        Demux d => new Demux(d.VarId, NodeOrNull(d.Input)),
        Parallel p => new Parallel(NodeOrNull(p.Input), p.Branches.Select(br => Node(br, consumed: true)).ToList(), p.Mode),
        Terminator t => new Terminator(t.Flags),
        _ => throw new NotSupportedException($"NextNetworkTextFacts does not know node {n.GetType().Name}"),
    };

    private static Assign AssignOf(Assign a)
    {
        var jump = a.Flags.Jump || a.Targets.Any(t => t.Flags?.Jump == true);
        var ret = a.Flags.Return || a.Targets.Any(t => t.Flags?.Return == true);
        if (!jump && !ret)
            return new Assign(Node(a.Value, consumed: true), a.Targets.Select(Target).ToList(), a.Flags);

        var flags = a.Flags with { Jump = jump, Return = ret };
        var targets = a.Targets.Count == 0 && ret
            ? new[] { new Operand(Box.UnnamedInstance, IsLValue: true, Flags: Flags.None with { Return = true }) }
            : a.Targets.Select(t => new Operand(t.Text, IsLValue: true,
                Flags: (t.Flags ?? Flags.None) with { Jump = jump, Return = ret })).ToArray();
        return new Assign(Node(a.Value, consumed: true), targets, flags);
    }

    private static Operand Target(Operand t) => new(t.Text, IsLValue: true, Flags: t.Flags is { IsNone: false } f ? f : null);

    private static Box BoxOf(Box b, bool consumed)
    {
        // The one definition of ".ENO", shared with the writer: a copy here could drift from it silently.
        var byMainOutput = b.ConnectedSlot is not null && !NextSpelling.ConnectedByEno(b);
        var infix = NextSpelling.IsInfix(b);
        return new Box(
            b.Type,
            // The instance's text and its flags: the text has no position for a flag on the instance operand, so the
            // writer refuses one — which only holds if the oracle compares it.
            b.Instance is null ? null : new Operand(b.Instance.Text, IsInstance: true,
                Flags: b.Instance.Flags is { IsNone: false } f ? f : null),
            NextSpelling.KindOf(b.Type, b.Instance is not null),
            b.Inputs.Select(p => new Input(infix ? null : p.Formal, Node(p.Value, consumed: true), p.Flags)).ToList(),
            b.Outputs.Select(o => new Output(o.Formal, Target(o.Value), o.Formal is not null ? null : o.Slot)).ToList(),
            NodeOrNull(b.Enable),
            b.StCode?.Replace("\r\n", "\n"),
            b.Flags,
            MainOutputIndex: byMainOutput ? b.MainOutputIndex : null,
            ConnectedSlot: b.ConnectedSlot,
            OutputTypes: null,
            HasEnoOutput: NextSpelling.EnoCarried(b, consumed) ? b.HasEnoOutput : null);
    }
}
