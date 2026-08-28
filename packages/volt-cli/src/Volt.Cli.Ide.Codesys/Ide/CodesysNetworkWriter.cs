using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.Network;
// `Parallel` is also System.Threading.Tasks.Parallel; this file means the LD branch.
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Cli.Ide.Codesys
{
    /// <summary>
    /// Writes a <see cref="NetworkBody"/> back as LIVE typed objects, inside one
    /// <c>GetObjectToModify</c>/<c>SetObject</c> transaction.
    ///
    /// <para><b>Nothing is regenerated.</b> The previous transport rebuilt the whole PLCopen body from a
    /// projection on every write, which is why it needed a carry rule (to keep ids, vendor <c>addData</c> and
    /// comment boxes on networks the engineer had not touched), a convergence gate (so push→pull→push settled
    /// instead of oscillating) and a capability guard scoped to what a regeneration would discard. A network
    /// whose text is unchanged is simply not written here, so none of that machinery has anything to do.</para>
    ///
    /// <para>Construction is by PUBLIC constructor — measured, no private-reflection trick — and the vendor
    /// derives what it can: setting <c>BoxType="AND"</c> and appending two inputs produced
    /// <c>CallType=Operator.And</c> and <c>EnEno=true</c> unasked. So the writer supplies the type NAME and the
    /// structure, and never computes a classification the IDE owns.</para>
    /// </summary>
    internal static class CodesysNetworkWriter
    {
        public static void Write(CodesysObjectModel om, object node, NetworkBody body)
        {
            om.ModifyObject(node, iobj =>
            {
                var impl = NwlInterop.Get(iobj, "Implementation")
                    ?? throw new InvalidOperationException(
                        "CODESYS: the item has no Implementation aspect — refusing to write a graphical body " +
                        "into an item that cannot hold one");

                // Match the network COUNT first, through the aspect's own API. `NetworkList` is read-only,
                // and an earlier version of this file refused a count change outright as "not measured" - which
                // failed every splice test, because splicing a body is exactly where a network appears or goes.
                // The aspect has AppendNetwork / InsertNetwork / RemoveNetwork / ReplaceNetwork; nothing here
                // needs the archive back door (SetSerializableValue), which also works but writes AROUND the
                // object model rather than through it.
                for (int i = Count(impl) - 1; i >= body.Networks.Count; i--)
                    NwlInterop.Call(impl, "RemoveNetwork", i);
                while (Count(impl) < body.Networks.Count)
                    NwlInterop.Call(impl, "AppendNetwork", NwlInterop.New(impl, "Network"));

                var existing = NwlInterop.Items(NwlInterop.Require(impl, "NetworkList"), listMember: "");
                for (int i = 0; i < existing.Count; i++)
                    WriteNetwork(impl, existing[i], body.Networks[i]);
            });
        }

        private static void WriteNetwork(object impl, object net, Network model)
        {
            SetIfChanged(net, "Title", model.Title ?? "");
            SetIfChanged(net, "Label", model.Label ?? "");
            SetIfChanged(net, "Comment", model.Comment ?? "");
            if (NwlInterop.Flag(net, "OutCommented") != model.Disabled)
                NwlInterop.Set(net, "OutCommented", model.Disabled);

            // Replace the trees wholesale for this network. Scoped to ONE network, so an edit to one rung does
            // not disturb the rest of the POU.
            for (int i = NwlInterop.Int(net, "NetworkItemCount") - 1; i >= 0; i--)
                NwlInterop.Call(net, "RemoveNetworkItem", i);

            var ctx = new BuildContext(impl, net);
            foreach (var tree in model.Trees)
                NwlInterop.Call(net, "AppendTree", ctx.Node(tree));
        }

        private static int Count(object impl) =>
            NwlInterop.Items(NwlInterop.Require(impl, "NetworkList"), listMember: "").Count;

        private static void SetIfChanged(object o, string member, string value)
        {
            if ((NwlInterop.Text(o, member) ?? "") != value) NwlInterop.Set(o, member, value);
        }

        /// <summary>Per-network build state. <see cref="_varIds"/> maps a model <c>Demux.VarId</c> to the id
        /// actually used in the IDE, because a body authored in network text carries Volt's own wire numbering
        /// and the IDE mints its own from <c>BranchCounter</c>.</summary>
        private sealed class BuildContext
        {
            private readonly object _impl;
            private readonly object _net;
            private readonly Dictionary<int, int> _varIds = new Dictionary<int, int>();

            public BuildContext(object impl, object net) { _impl = impl; _net = net; }

            public object Node(Node n)
            {
                switch (n)
                {
                    case Leaf l:
                        return Flagged(NwlInterop.New(_net, "BoxTreeOperand", Operand(l.Operand)), l.Flags);

                    case Assign a:
                    {
                        var asg = NwlInterop.New(_net, "BoxTreeAssign");
                        if (a.Value is { } v) NwlInterop.Set(asg, "RValue", Node(v));
                        var outputs = NwlInterop.Require(asg, "Outputs");
                        foreach (var t in a.Targets)
                            NwlInterop.Call(outputs, "AppendOutputItem", Operand(t));
                        return Flagged(asg, a.Flags);
                    }

                    case Box b:
                    {
                        var box = NwlInterop.New(_net, "BoxTreeBox");
                        // The TYPE NAME only: CallType and EnEno are the vendor's to derive, and it does.
                        NwlInterop.Set(box, "BoxType", b.Type);
                        foreach (var p in b.Inputs)
                            NwlInterop.Call(box, "AppendInputItem", Node(p.Value));
                        return Flagged(box, b.Flags);
                    }

                    case Demux d:
                    {
                        var dm = NwlInterop.New(_net, "BoxTreeDemux");
                        NwlInterop.Set(dm, "VarId", VarIdFor(d.VarId));
                        // With an Input this DEFINES the wire; without one it REFERENCES the definition
                        // carrying the same id.
                        if (d.Input is { } src) NwlInterop.Call(dm, "SetInputTree", 0, Node(src));
                        return Flagged(dm, d.Flags);
                    }

                    case Terminator t:
                    {
                        var term = NwlInterop.New(_net, "BoxTreeTerminator");
                        if (t.Input is { } ti) NwlInterop.Call(term, "SetInputTree", 0, Node(ti));
                        return Flagged(term, t.Flags);
                    }

                    case Parallel p:
                    {
                        var par = NwlInterop.New(_net, "BoxTreeParallel");
                        if (p.Input is { } pi) NwlInterop.Call(par, "SetInputTree", 0, Node(pi));
                        foreach (var branch in p.Branches) NwlInterop.Call(par, "Append", Node(branch));
                        return Flagged(par, p.Flags);
                    }

                    default:
                        throw new NotSupportedException(
                            $"CODESYS: no way to write the graphical node '{n.GetType().Name}' — refusing " +
                            "rather than writing a body that is not what the source says.");
                }
            }

            /// <summary>A wire id the IDE will accept. Volt's numbering comes from the authored text and can
            /// collide with ids already in the POU, so each distinct model id is mapped once onto a fresh id
            /// taken from the aspect's own <c>BranchCounter</c>.</summary>
            private int VarIdFor(int modelId)
            {
                if (_varIds.TryGetValue(modelId, out var id)) return id;
                // The aspect mints these. Incrementing the BranchCounter property by hand -
                // which is what this did first - reimplements the vendor allocator from the
                // outside, and would drift the moment it did anything else (skipping an id
                // already in use, for one).
                var next = NwlInterop.Call(_impl, "GetNextBranchCounter") is int n ? n : 0;
                _varIds[modelId] = next;
                return next;
            }

            private object Operand(Operand o)
            {
                var op = NwlInterop.New(_net, "Operand", o.Text);
                if (!string.IsNullOrEmpty(o.Type)) NwlInterop.Set(op, "Type", o.Type);
                if (o.IsLValue) NwlInterop.Set(op, "IsLValue", true);
                ApplyFlags(op, o.Flags);
                return op;
            }

            private static object Flagged(object item, Flags f)
            {
                ApplyFlags(item, f);
                return item;
            }

            /// <summary>The vendor bit-field, set by NAME. <c>Reset</c> has no counterpart and is refused rather
            /// than dropped: network text can express a reset coil, the object model (as measured) cannot, and
            /// silently writing a plain coil would change what the program does.</summary>
            private static void ApplyFlags(object item, Flags? flags)
            {
                if (flags is not { } f || f.IsNone) return;
                if (f.Reset)
                    throw new NotSupportedException(
                        "CODESYS: a RESET modifier has no representation in the IDE's flag set (it carries " +
                        "Negation/Set/Jump/Return/Rtrig/Ftrig and no Reset). Refusing rather than writing a " +
                        "plain coil, which would change what the program does.");

                var target = NwlInterop.Get(item, "Flags")
                    ?? throw new InvalidOperationException(
                        $"CODESYS: '{item.GetType().Name}' carries no Flags, so its modifiers cannot be written");
                if (f.Negated) NwlInterop.Set(target, "Negation", true);
                if (f.Set) NwlInterop.Set(target, "Set", true);
                if (f.Jump) NwlInterop.Set(target, "Jump", true);
                if (f.Return) NwlInterop.Set(target, "Return", true);
                if (f.Rising) NwlInterop.Set(target, "Rtrig", true);
                if (f.Falling) NwlInterop.Set(target, "Ftrig", true);
            }
        }
    }
}
