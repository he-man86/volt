using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.Network;
// `Parallel` is also System.Threading.Tasks.Parallel; this file means the LD branch.
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Ide.Codesys
{
    /// <summary>
    /// A CODESYS graphical body as a <see cref="NetworkBody"/> — read from the LIVE typed objects, with no
    /// serialization anywhere in the path.
    ///
    /// <para>The dispatch below is not a guess at a vendor format: it is the vendor's own
    /// <c>IBoxTreeVisitor</c> closed set (<c>VisitOperand</c> / <c>VisitBox</c> / <c>VisitAssign</c>) plus the
    /// three LD structures, and every arm was measured against a real ladder project
    /// (<c>nwl-object-model.md</c>, 36 POUs / 356 networks / 773 trees).</para>
    /// </summary>
    internal static class CodesysNetworkReader
    {
        /// <summary>Read the whole body. <paramref name="impl"/> is the item's <c>Implementation</c> aspect,
        /// already known to be an <c>NWLImplementationObject</c>.</summary>
        public static NetworkBody Read(object impl, BodyLanguage language)
        {
            var networks = new List<Network>();
            var list = NwlInterop.Items(NwlInterop.Require(impl, "NetworkList"), listMember: "");
            for (int i = 0; i < list.Count; i++) networks.Add(ReadNetwork(list[i], i));
            return new NetworkBody(language, networks);
        }

        private static Network ReadNetwork(object net, int order)
        {
            var trees = new List<Node>();
            var count = NwlInterop.Int(net, "NetworkItemCount");
            for (int i = 0; i < count; i++)
            {
                // NetworkItemCount can EXCEED the number of real trees — measured: a network reported 2 with
                // one tree, the second slot being an item the IDE had dropped. A null here is normal, not a
                // failure, and must be skipped rather than treated as an empty body.
                if (NwlInterop.TryCall(net, "GetTree", i) is { } tree) trees.Add(ReadNode(tree));
            }

            // The vendor's own per-network SPLIT-POINT list, which is NOT fan-out - fan-out is `Demux`, and
            // this list measured ZERO across all 356 networks of the one real project surveyed. Volt has no
            // text form for it, so a body that does carry one is REFUSED rather than silently rendered without
            // it. (It had a field on the model for a while, which then collided with the text reader's own
            // fan-out encoding and produced two incompatible spellings of the same idea; the model now carries
            // exactly one, the vendor's.)
            if (NwlInterop.TryCall(net, "GetSplitPoint", 0) is { } sp)
                throw new NotSupportedException(
                    $"CODESYS: network {order} carries a vendor split point ('{ReadOperand(sp).Text}'), which " +
                    "network text has no form for. Volt refuses to materialize a body it cannot represent " +
                    "rather than render one silently missing it.");

            return new Network(
                order,
                Clean(NwlInterop.Text(net, "Title")),
                Clean(NwlInterop.Text(net, "Label")),
                Clean(NwlInterop.Text(net, "Comment")),
                NwlInterop.Flag(net, "OutCommented"),
                trees);
        }

        private static Node ReadNode(object n)
        {
            var flags = ReadFlags(NwlInterop.Get(n, "Flags"));
            switch (NwlInterop.TypeName(n))
            {
                case "BoxTreeOperand":
                    return new Leaf(ReadOperand(NwlInterop.Require(n, "Operand")), flags);

                case "BoxTreeAssign":
                    return new Assign(
                        NwlInterop.Get(n, "RValue") is { } rv ? ReadNode(rv) : null,
                        NwlInterop.Items(NwlInterop.Get(n, "Outputs")).Select(ReadOperand).ToList(),
                        flags);

                case "BoxTreeBox":
                    return ReadBox(n, flags);

                // Fan-out. With an Input this DEFINES the wire; without one it REFERENCES the definition
                // carrying the same VarId. 573 of these in the surveyed project, against zero split points.
                case "BoxTreeDemux":
                    return new Demux(
                        NwlInterop.Int(n, "VarId"),
                        NwlInterop.Get(n, "Input") is { } di ? ReadNode(di) : null,
                        flags);

                case "BoxTreeParallel":
                    return new Parallel(
                        NwlInterop.Get(n, "Input") is { } pi ? ReadNode(pi) : null,
                        NwlInterop.Items(NwlInterop.Get(n, "Trees"), listMember: "").Select(ReadNode).ToList(),
                        ReadParallelMode(NwlInterop.Get(n, "Mode")),
                        flags);

                case "BoxTreeTerminator":
                    return new Terminator(
                        NwlInterop.Get(n, "Input") is { } ti ? ReadNode(ti) : null,
                        flags);

                default:
                    // BoxTreeMux is the known member of this set and was unused in the surveyed project, so it
                    // has no measured shape and no network-text spelling. Refusing is the only honest answer:
                    // rendering it as anything else would put logic in the workspace that is not in the IDE.
                    throw new NotSupportedException(
                        $"CODESYS: the graphical item '{NwlInterop.TypeName(n)}' has no network-text form yet. " +
                        "Volt refuses to materialize a body it cannot represent, rather than rendering an " +
                        "approximation an engineer would then push back.");
            }
        }

        private static Box ReadBox(object n, Flags flags)
        {
            var inputs = NwlInterop.Items(NwlInterop.Get(n, "InputItemList"), listMember: "")
                .Select(x => new Input(null, ReadNode(x), Flags.None))
                .ToList();

            // Formal pin names, where the vendor supplies them. Operator boxes are positional; an FB call names
            // its pins, and network text needs those names to write `inst(IN := x, PT := y)`.
            var formals = NwlInterop.Items(NwlInterop.Get(n, "InputParams"))
                .Select(p => NwlInterop.Text(p, "Name"))
                .ToList();
            if (formals.Count == inputs.Count)
                inputs = inputs.Select((p, i) => p with { Formal = Clean(formals[i]) }).ToList();

            var instance = NwlInterop.Get(n, "Instance") is { } inst ? ReadOperand(inst) : null;

            return new Box(
                NwlInterop.Text(n, "BoxType") ?? "",
                instance,
                ReadCallKind(NwlInterop.Get(n, "CallType"), instance),
                inputs,
                NwlInterop.Items(NwlInterop.Get(n, "Outputs")).Select(ReadOperand).ToList(),
                // From the En PIN, never from the EnEno flag: EnEno is a CAPABILITY marker and is true on every
                // box in a real project — including every plain AND and OR — so keying on it would wrap the
                // whole project in `IF en THEN ... END_IF`.
                NwlInterop.Get(n, "En") is { } en ? ReadNode(en) : null,
                ReadStCode(n),
                flags);
        }

        /// <summary>A CODESYS Execute box: a box whose call is raw ST, carried on the box itself.</summary>
        private static string? ReadStCode(object n)
        {
            if (!NwlInterop.Flag(n, "ProvidesSTSnippet")) return null;
            var snippet = NwlInterop.Get(n, "STSnippet");
            if (snippet == null) return null;
            var impl = NwlInterop.Get(snippet, "Snippet") ?? snippet;
            return CodesysObjectModel.ReadAspectText(impl, "Implementation") is { Length: > 0 } t ? t : null;
        }

        private static Operand ReadOperand(object o) =>
            new Operand(
                NwlInterop.Text(o, "OperandExpr") ?? "",
                Clean(NwlInterop.Text(o, "Type")),
                Clean(NwlInterop.Text(o, "SymbolComment")),
                NwlInterop.Flag(o, "IsInstance"),
                NwlInterop.Flag(o, "IsLValue"),
                ReadFlags(NwlInterop.Get(o, "Flags")));

        /// <summary>The vendor bit-field, read by NAME rather than by bit position.</summary>
        private static Flags ReadFlags(object? f) =>
            f == null
                ? Flags.None
                : new Flags(
                    Negated: NwlInterop.Flag(f, "Negation"),
                    Set: NwlInterop.Flag(f, "Set"),
                    Reset: false,          // no Reset bit exists; see NetworkModel.Flags
                    Jump: NwlInterop.Flag(f, "Jump"),
                    Return: NwlInterop.Flag(f, "Return"),
                    Rising: NwlInterop.Flag(f, "Rtrig"),
                    Falling: NwlInterop.Flag(f, "Ftrig"));

        private static CallKind ReadCallKind(object? callType, Operand? instance)
        {
            // The vendor derives CallType itself from the box's type name (measured: setting BoxType="AND"
            // produced CallType=Operator.And unasked), so it is read, never computed. `None` on a box with an
            // instance is a function-block call.
            var name = callType?.ToString();
            if (!string.IsNullOrEmpty(name) && !string.Equals(name, "None", StringComparison.OrdinalIgnoreCase))
                return CallKind.Operator;
            return instance is null ? CallKind.Function : CallKind.FunctionBlock;
        }

        private static ParallelMode ReadParallelMode(object? mode) =>
            string.Equals(mode?.ToString(), "And", StringComparison.OrdinalIgnoreCase)
                ? ParallelMode.And
                : ParallelMode.Or;

        /// <summary>Empty and the vendor's serialization placeholders both mean "not set".
        /// <para>A freshly constructed operand reports <c>Address='Constant_Address_Serialization_Value'</c> and
        /// <c>SymbolComment='Constant_SymbolComment_Serialization_Value'</c> — sentinels of the archive layer,
        /// not values. Carrying one into the workspace would write a vendor internal into an engineer's file.</para></summary>
        private static string? Clean(string? s) =>
            string.IsNullOrEmpty(s) || s!.StartsWith("Constant_", StringComparison.Ordinal) ? null : s;
    }
}
