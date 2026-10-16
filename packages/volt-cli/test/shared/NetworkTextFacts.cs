using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.Network;
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
/// <item>The spec's one equivalence: an operator's absent ≡ default <c>InputParams</c> names (review 7.9; P10:
/// <c>IN&lt;n&gt;</c> on the table's operators, <c>IN</c> on MOVE and the NOT box).</item>
/// <item>B7 (ld-fbd-coverage 2R.3): the members the text derives and never spells — a box's stored <c>OutputParam</c>
/// names (<see cref="Box.Members"/>) and types, and a bit operator's stored output slot (the editor's <c>['']</c>, S1),
/// which the text reads as none — are LOST ON REBUILD (owner, 2R.2 Open item 5) and kept by every push that does not
/// rebuild the network. Not compared here; <see cref="RebuildLoss"/> names them on a rebuild.</item>
/// <item>Network <c>Order</c> → the network's position. The header has no order number.</item>
/// <item>An operand's <c>Type</c> and <c>Comment</c> (vendor metadata no statement spells), an operand's copy of its
/// item's flags; <c>IsInstance</c> / <c>IsLValue</c> are what the position says.</item>
/// <item><c>Box.Kind</c> → <see cref="NetworkSpelling.KindOf"/>: the vendor's <c>CallType</c> is the IDE's resolution
/// of the box type (a MOVE the IDE resolved reads <c>Operator</c>, the same box freshly built <c>None</c>).</item>
/// <item><c>Box.MainOutputIndex</c> where no connection names it — at the top level, and on a box consumed by ENO
/// or by no stored slot. It is the box TYPE's result slot, set by the IDE when it builds the box; where a consumer
/// IS connected by the main output the connection slot names it, and it is compared (the writer refuses every
/// main output the text would read back as another — <see cref="NetworkSpelling.MainSlotOfCall"/>).</item>
/// <item><c>OutputTypes</c> and <c>Demux.Type</c>: a wire's type is compared through the declaration the writer
/// derives from them, not as model fields (the vendor's Demux has no type; the text's has no stored types).</item>
/// <item><c>Box.HasEnoOutput</c> where the text does not decide by it (<see cref="NetworkSpelling.EnoCarried"/>): a
/// top-level box with no positional <c>=&gt;</c> pin, a consumed box with no EN and no stored slot (an operator
/// group), an Execute box. The ENO output is the box type's; the text spells it only as <c>.ENO</c> and as the
/// slot positional pins skip.</item>
/// <item>An FB instance box's <c>Type</c> SPELLING → its last name segment, case folded. The text spells the call by
/// its instance, and the reader takes the type from the instance's declaration, in the declaration's spelling
/// (<c>t : Standard.TON;</c>, <c>t : Ton;</c>) where the vendor may store <c>TON</c>. Those are one type, and the writer
/// refuses any pair that is not (<c>StDeclaration.SameType</c>: two namespaces are two types), so what reaches this
/// comparison differs in spelling alone. The push keeps the IDE's own spelling where it edits in place (TwinCAT) and
/// writes the declaration's where it builds the box (CODESYS), which the IDE resolves to the same type. A <c>???</c>
/// instance's type is spelled in the text and compared whole.</item>
/// <item>A main output read by its NAME (S4, <c>fb(…).name</c>, <see cref="NetworkSpelling.NamedMainOutput"/>) → the name,
/// with no <c>MainOutputIndex</c> and no <c>ConnectedSlot</c>: the text has no position for the index (the box type's),
/// and a push never builds such a box (N21) — it keeps the IDE's network. <c>MainOutputName</c> anywhere else → null:
/// the readers state it only where the text spells it.</item>
/// <item>A NAMED output's slot → null: <c>F =&gt; v</c> names the pin, and the pin's slot is the box type's.</item>
/// <item>Control flow: the Jump/Return bit on the item AND its target (DIALECT C13 — the reader writes both); a
/// target-less return's target is the vendor's constant <c>???</c>.</item>
/// <item>A CR LF line ending in an EXECUTE snippet is the FILE's layout, so it is the LF alone. A network's title and
/// comment are carried EXACTLY (P12, 2R.2 S), their CR LF included.</item>
/// </list>
/// </summary>
public static class NetworkTextFacts
{
    public static NetworkBody Carried(NetworkBody body) =>
        new(body.Language, body.Networks.Select((n, i) => new Network(
            i, n.Title, n.Label, n.Comment, n.Disabled, n.Trees.Select(t => Node(t, consumed: false)).ToList(),
            n.Unsupported)).ToList());

    private static Node? NodeOrNull(Node? n) => n is null ? null : Node(n, consumed: true);

    /// <param name="consumed">Whether something consumes the node — everything but a top-level item. A box's
    /// ENO is carried differently at the top level (<see cref="NetworkSpelling.EnoCarried"/>).</param>
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
        // S4: a main output read by NAME carries the name and no slot — the text has no position for the index.
        var byName = consumed ? NetworkSpelling.NamedMainOutput(b) : null;
        if (byName is not null) b = b with { MainOutputIndex = null, ConnectedSlot = null };
        // B7: a bit operator read by its data is connected by none in the text (its stored slot is lost on rebuild),
        // unless a named output pin states its outputs.
        if (consumed && !NetworkSpelling.ConnectedByEno(b) && NetworkSpelling.MainSlotOfCall(b.Type) is null && byName is null)
        {
            var slot = Box.BitOperatorSlot(b.Outputs.Any(o => o.Formal is not null) ? 1 : 0);
            b = b with { ConnectedSlot = slot, MainOutputIndex = slot };
        }
        // The one definition of a read through ENO, shared with the writer: a copy here could drift from it silently.
        var byMainOutput = b.ConnectedSlot is not null && !NetworkSpelling.ConnectedByEno(b);
        return new Box(
            b.Instance is { } named && named.Text != Box.UnnamedInstance ? TypeSpelling(b.Type) : b.Type,
            // The instance's text and its flags: the text has no position for a flag on the instance operand, so the
            // writer refuses one — which only holds if the oracle compares it.
            b.Instance is null ? null : new Operand(b.Instance.Text, IsInstance: true,
                Flags: b.Instance.Flags is { IsNone: false } f ? f : null),
            NetworkSpelling.KindOf(b.Type, b.Instance is not null),
            b.Inputs.Select((p, i) => new Input(NetworkSpelling.DefaultFormal(b.Type, i) is not null && NetworkSpelling.IsDefaultFormal(b.Type, i, p.Formal) ? null : p.Formal,
                Node(p.Value, consumed: true), p.Flags)).ToList(),
            b.Outputs.Select(o => new Output(o.Formal, Target(o.Value), o.Formal is not null ? null : o.Slot)).ToList(),
            NodeOrNull(b.Enable),
            b.StCode?.Replace("\r\n", "\n"),
            b.Flags,
            MainOutputIndex: byMainOutput ? b.MainOutputIndex : null,
            ConnectedSlot: b.ConnectedSlot,
            OutputTypes: null,
            HasEnoOutput: NetworkSpelling.EnoCarried(b with { MainOutputName = byName }, consumed) ? b.HasEnoOutput : null,
            MainOutputName: byName,
            Members: null);
    }

    private static string TypeSpelling(string type) => type.Substring(type.LastIndexOf('.') + 1).ToUpperInvariant();
}
