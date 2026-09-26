using System;
using System.Collections.Generic;
using System.Linq;

namespace Volt.Engine.Format.Network.Next;

/// <summary>
/// The model as network text v2 CARRIES it: every field the text determines kept, every field it does not
/// determine set to what the reader produces. The model oracle's "≅" is <c>Equal(Carried(a), Carried(b))</c> —
/// so <c>Read(Write(m)) ≅ m</c> fails exactly when the text lost a fact it is meant to carry.
///
/// <para><b>This is the list of what the text does NOT carry, written down once.</b> Each line below is either a
/// spec'd equivalence or a fact the push must take from somewhere else (the IDE's own box, the declarations); none
/// is a leniency. Adding a line here is a claim that the text is not supposed to carry that fact — it must never
/// be how a failing oracle is made green.</para>
/// <list type="bullet">
/// <item>Network <c>Order</c> → the network's position. The header has no order number.</item>
/// <item>An operand's <c>Type</c>, <c>Comment</c>, and an operand's copy of its item's flags; <c>IsInstance</c> /
/// <c>IsLValue</c> are what the position says.</item>
/// <item><c>Box.Kind</c> → <see cref="NextSpelling.KindOf"/>: the vendor's <c>CallType</c> is not in the text.</item>
/// <item><c>Box.MainOutputIndex</c> and <c>OutputTypes</c> → null; <c>ConnectedSlot</c> kept only when it is ENO
/// (<c>.ENO</c>). A box consumed by its main output says so and not which slot that is, so positional output
/// slots are renumbered as if that slot were not there — they are the pins' positions among the slots the text
/// spells. A named output's slot → null (<c>F =&gt; v</c> names it).</item>
/// <item>Infix boxes: absent ≡ default <c>InputParams</c> names (the spec's one equivalence, review 7.9).</item>
/// <item>Control flow: "unconditional" is the empty Terminator (census 1.2); the Jump/Return bit on the item AND
/// its target (DIALECT C13); a return's target is the vendor's constant <c>???</c>.</item>
/// <item><c>Demux.Type</c> → null: a fact of the text, not of the vendor.</item>
/// <item>An EXECUTE snippet and a comment without <c>\r</c>, and a snippet without trailing newlines.</item>
/// </list>
/// </summary>
public static class NextNetworkTextFacts
{
    public static NetworkBody Carried(NetworkBody body) =>
        new(body.Language, body.Networks.Select((n, i) => new Network(
            i, n.Title, n.Label, n.Comment?.Replace("\r", ""), n.Disabled, n.Trees.Select(Node).ToList())).ToList());

    private static Node Node(Node n) => n switch
    {
        Leaf l => new Leaf(new Operand(l.Operand.Text), l.Flags),
        Assign a => AssignOf(a),
        Box b => BoxOf(b),
        Demux d => new Demux(d.VarId, d.Input is null ? null : Node(d.Input), d.Flags),
        Parallel p => new Parallel(p.Input is null ? null : Node(p.Input), p.Branches.Select(Node).ToList(), p.Flags, p.Mode),
        Terminator t => new Terminator(t.Input is null ? null : Node(t.Input), t.Flags),
        _ => throw new NotSupportedException($"NextNetworkTextFacts does not know node {n.GetType().Name}"),
    };

    private static Assign AssignOf(Assign a)
    {
        var jump = a.Flags.Jump || a.Targets.Any(t => t.Flags?.Jump == true);
        var ret = a.Flags.Return || a.Targets.Any(t => t.Flags?.Return == true);
        if (!jump && !ret)
            return new Assign(a.Value is null ? null : Node(a.Value), a.Targets.Select(Target).ToList(), a.Flags);

        var flags = a.Flags with { Jump = jump, Return = ret };
        var targets = a.Targets.Count == 0 && ret
            ? new List<Operand> { new(Box.UnnamedInstance, IsLValue: true, Flags: Flags.None with { Return = true }) }
            : a.Targets.Select(t => new Operand(t.Text, IsLValue: true,
                Flags: (t.Flags ?? Flags.None) with { Jump = jump, Return = ret })).ToList();
        return new Assign(a.Value is null ? new Terminator(null, Flags.None) : Node(a.Value), targets, flags);
    }

    private static Operand Target(Operand t) => new(t.Text, IsLValue: true, Flags: t.Flags is { IsNone: false } f ? f : null);

    private static Box BoxOf(Box b)
    {
        int? eno = b.StCode is not null || b.Enable is not null ? 0 : null;
        int? byMain = b.ConnectedSlot is { } c && c != eno ? c : null;
        var infix = NextSpelling.IsInfix(b);
        return new Box(
            b.Type,
            b.Instance is null ? null : new Operand(b.Instance.Text, IsInstance: true),
            NextSpelling.KindOf(b.Type, b.Instance is not null),
            b.Inputs.Select(p => new Input(infix ? null : p.Formal, Node(p.Value), p.Flags)).ToList(),
            b.Outputs.Select(o => new Output(
                o.Formal,
                Target(o.Value),
                o.Formal is not null ? null : o.Slot is { } s && byMain is { } m && s > m ? s - 1 : o.Slot)).ToList(),
            b.Enable is null ? null : Node(b.Enable),
            b.StCode?.Replace("\r", "").TrimEnd('\n'),
            b.Flags,
            MainOutputIndex: null,
            ConnectedSlot: b.ConnectedSlot == eno ? b.ConnectedSlot : null,
            OutputTypes: null);
    }
}
