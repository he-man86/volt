using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;

namespace Volt.Bridge.Core.Graphical
{
    /// <summary>
    /// Renders a <see cref="GraphBody"/> to a PLCopenXML <c>&lt;FBD&gt;</c> / <c>&lt;LD&gt;</c> body
    /// element — the inverse of <see cref="PlcOpenReader"/>. Positions are SYNTHESIZED (a fixed grid;
    /// CODESYS re-lays-out on import), localIds come from the model, and opaque nodes round-trip
    /// verbatim. FB-call <c>typeName</c> is not carried by VG, so the caller supplies a resolver
    /// (instanceName → type) from the POU declaration; operators/functions carry their own type.
    /// </summary>
    public static class PlcOpenWriter
    {
        public static readonly XNamespace Ns = "http://www.plcopen.org/xml/tc6_0200";
        private static readonly XNamespace Xhtml = "http://www.w3.org/1999/xhtml";
        private const long NetworkStride = 10_000_000_000L;   // network index = localId / 10^10 (mirrors PlcOpenReader)

        /// <param name="resolveType">instanceName → FB type name, from the POU declaration. May be
        /// null when types are already present on the model (e.g. a body just read back).</param>
        /// <summary>Render a graphical <see cref="GraphBody"/> to its PLCopen body element. FBD and LD are the
        /// editable graphical languages; LD is generated as the inverse of <see cref="PlcOpenReader"/>'s ladder
        /// lowering. CFC and SFC are READ-ONLY today (surfaced as %LANG placeholders, never written) — when one
        /// becomes writable, add its case here with its own writer/model. An unhandled language throws (a loud
        /// failure, never a silently-wrong body).</summary>
        public static XElement WriteBody(GraphBody body, System.Func<string, string?>? resolveType = null) => body.Language switch
        {
            "FBD" => WriteFbdBody(body, resolveType),
            "LD" => WriteLadderBody(body),
            _ => throw new System.NotSupportedException(
                $"PlcOpenWriter: graphical language '{body.Language}' is not writable (FBD/LD are generated; CFC/SFC are read-only)."),
        };

        private static XElement WriteFbdBody(GraphBody body, System.Func<string, string?>? resolveType)
        {
            var root = new XElement(Ns + "FBD");
            // A connection back to an operator/function result carries no output-pin name in VG (it's
            // `g1`, not `g1.Out1`). Re-derive the producer block's single output pin so the PLCopen
            // connection still names the output the IDE expects.
            var byId = new Dictionary<long, GraphNode>();
            foreach (var n in body.Networks.SelectMany(x => x.Nodes)) byId[n.LocalId] = n;
            string? OutPin(long id) => byId.TryGetValue(id, out var n) && n is Block bl && bl.OutputPins.Count > 0
                ? bl.OutputPins[0] : null;

            // Output pins REFERENCED by a connection's formalParameter (an FB output like `inst.Q`). VG
            // lists a block's CALL but not its output pins, so a parsed FB block has no OutputPins; without
            // this the `inst.Q` connection would name a pin the block doesn't declare and the IDE would
            // DROP it on import (the `out := ;` bug). Emit these as the block's outputVariables too.
            var refPins = new Dictionary<long, List<string>>();
            void NoteRef(Conn? c)
            {
                if (c?.FormalParameter == null) return;
                if (!refPins.TryGetValue(c.RefLocalId, out var list)) refPins[c.RefLocalId] = list = new List<string>();
                if (!list.Contains(c.FormalParameter)) list.Add(c.FormalParameter);
            }
            foreach (var n in body.Networks.SelectMany(x => x.Nodes))
                switch (n)
                {
                    case Block bk: foreach (var p in bk.Inputs) NoteRef(p.Source); break;
                    case OutVar o: NoteRef(o.Source); break;
                    case Jump j: NoteRef(j.Condition); break;
                    case Return r: NoteRef(r.Condition); break;
                }

            int row = 0;
            int commentSeq = 0;
            foreach (var net in body.Networks)
            {
                if (!string.IsNullOrEmpty(net.Comment))
                {
                    // The comment must live in its network's localId range (index = localId / 10^10),
                    // high within it to avoid colliding with the content nodes — a stray index (e.g.
                    // an out-of-range localId) makes CODESYS reject the whole import. Use the network's
                    // authoritative Order (not the first node's localId, which is absent for an
                    // empty/comment-only network → would wrongly land the comment in network 0).
                    long netIndex = net.Order ?? (net.Nodes.Count > 0 ? net.Nodes[0].LocalId / NetworkStride : 0);
                    long commentId = netIndex * NetworkStride + 9_000_000L + commentSeq++;
                    root.Add(new XElement(Ns + "comment",
                        new XAttribute("localId", commentId), new XAttribute("height", 0), new XAttribute("width", 0),
                        Pos(row++),
                        // TC6 comment content is xhtml, not plain text — CODESYS rejects bare text.
                        new XElement(Ns + "content", new XElement(Xhtml + "xhtml", net.Comment))));
                }
                foreach (var node in net.Nodes)
                    root.Add(WriteNode(node, resolveType, OutPin, refPins, row++));
            }
            return root;
        }

        private static XElement WriteNode(GraphNode node, System.Func<string, string?>? resolveType,
            System.Func<long, string?> outPin, Dictionary<long, List<string>> refPins, int row)
        {
            switch (node)
            {
                case OpaqueNode op:
                    return XElement.Parse(op.RawXml);

                case InVar iv:
                    return new XElement(Ns + "inVariable", IdAttrs(iv), ModAttrs(iv.Mods),
                        Pos(row), new XElement(Ns + "connectionPointOut"),
                        new XElement(Ns + "expression", iv.Expression));

                case OutVar ov:
                    return new XElement(Ns + "outVariable", IdAttrs(ov), ModAttrs(ov.Mods),
                        Pos(row), ConnIn(ov.Source, outPin),
                        new XElement(Ns + "expression", ov.Expression));

                case Block b:
                    var typeName = b.TypeName;
                    if (string.IsNullOrEmpty(typeName) && b.InstanceName != null && resolveType != null)
                        typeName = resolveType(b.InstanceName) ?? "";
                    var el = new XElement(Ns + "block", IdAttrs(b),
                        new XAttribute("typeName", typeName));
                    if (b.InstanceName != null) el.Add(new XAttribute("instanceName", b.InstanceName));
                    el.Add(Pos(row));
                    el.Add(new XElement(Ns + "inputVariables", b.Inputs.Select(p =>
                        new XElement(Ns + "variable", new XAttribute("formalParameter", p.FormalParameter),
                            ModAttrs(p.Mods), ConnIn(p.Source, outPin)))));
                    el.Add(new XElement(Ns + "inOutVariables"));
                    // Output pins = the block's own, UNION any referenced by an `inst.Q` connection
                    // (which VG carries on the consumer, not the block) so the connection stays valid.
                    var outs = new List<string>(b.OutputPins);
                    if (refPins.TryGetValue(b.LocalId, out var extra))
                        foreach (var p in extra) if (!outs.Contains(p)) outs.Add(p);
                    el.Add(new XElement(Ns + "outputVariables", outs.Select(o =>
                        new XElement(Ns + "variable", new XAttribute("formalParameter", o),
                            new XElement(Ns + "connectionPointOut")))));
                    // Re-emit the CODESYS/TwinCAT vendor metadata so a written-back block carries what
                    // the IDE exported: the fbdcalltype hint (operator / function / functionblock) plus
                    // the input/output param-type lists. Types are read-only metadata — on the push path
                    // VG doesn't carry them, so these come out empty and the IDE reconstructs them.
                    if (!string.IsNullOrEmpty(b.CallType))
                        el.Add(new XElement(Ns + "addData",
                            VendorData("fbdcalltype", "CallType", b.CallType),
                            VendorData("inputparamtypes", "InputParamTypes", JoinTypes(b.Inputs.Select(p => p.Type))),
                            VendorData("outputparamtypes", "OutputParamTypes", JoinTypes(b.OutputTypes))));
                    return el;

                case Label lb:
                    return new XElement(Ns + "label", IdAttrs(lb), new XAttribute("label", lb.Name), Pos(row));

                case Jump jp:
                    return new XElement(Ns + "jump", IdAttrs(jp), new XAttribute("label", jp.Target),
                        ModAttrs(jp.Mods), Pos(row), jp.Condition != null ? ConnIn(jp.Condition, outPin) : null);

                case Return rt:
                    return new XElement(Ns + "return", IdAttrs(rt), ModAttrs(rt.Mods),
                        Pos(row), rt.Condition != null ? ConnIn(rt.Condition, outPin) : null);

                default:
                    return new XElement(Ns + "inVariable", IdAttrs(node), Pos(row),
                        new XElement(Ns + "expression", ""));
            }
        }

        private static IEnumerable<XAttribute> IdAttrs(GraphNode n)
        {
            yield return new XAttribute("localId", n.LocalId);
            if (n.ExecOrder.HasValue) yield return new XAttribute("executionOrderId", n.ExecOrder.Value);
        }

        /// <summary>The PLCopen pin/element modifier attributes (negation, edge, set/reset storage),
        /// the inverse of <see cref="PlcOpenReader"/>'s ReadMods. None emitted when <c>IsNone</c>.</summary>
        private static IEnumerable<XAttribute> ModAttrs(Mods m)
        {
            if (m.Negated) yield return new XAttribute("negated", "true");
            if (m.Edge == EdgeMod.Rising) yield return new XAttribute("edge", "rising");
            else if (m.Edge == EdgeMod.Falling) yield return new XAttribute("edge", "falling");
            if (m.Storage == StorageMod.Set) yield return new XAttribute("storage", "set");
            else if (m.Storage == StorageMod.Reset) yield return new XAttribute("storage", "reset");
        }

        private static XElement Pos(int row)
            => new(Ns + "position", new XAttribute("x", 0), new XAttribute("y", row * 40));

        /// <summary>A 3S vendor <c>&lt;data&gt;</c> addData child with an empty-namespace inner element
        /// (matching the IDE format). A null/empty value yields a self-closing inner element.</summary>
        private static XElement VendorData(string nameSuffix, string innerName, string? value)
            => new(Ns + "data",
                new XAttribute("name", "http://www.3s-software.com/plcopenxml/" + nameSuffix),
                new XAttribute("handleUnknown", "implementation"),
                string.IsNullOrEmpty(value) ? new XElement(innerName) : new XElement(innerName, value));

        /// <summary>Space-join a positional type list for the param-types addData; null when the list
        /// is absent or every entry is empty (operators export empty input types).</summary>
        private static string? JoinTypes(IEnumerable<string?>? types)
        {
            if (types == null) return null;
            var list = types.Select(t => t ?? "").ToList();
            return list.Any(t => t.Length > 0) ? string.Join(" ", list) : null;
        }

        // ── LD ladder generation — the inverse of PlcOpenReader.LowerLadder ──────────────────────────
        // Boolean rung: leftPowerRail → contacts (series = AND) → coil → rightPowerRail. The right rail and
        // a network-title vendorElement bracket the rung the way TwinCAT/CODESYS emit it. POC scope: pure
        // boolean series; OR/parallel (ldbranchid) and FB-blocks-on-a-rung are not generated yet — they throw
        // so the gap is loud, never silently mis-rendered.
        private const long RightRailId = 2147483646L;

        private static XElement WriteLadderBody(GraphBody body)
        {
            var root = new XElement(Ns + "LD");
            foreach (var net in body.Networks)
            {
                long netIndex = net.Order ?? (net.Nodes.Count > 0 ? net.Nodes[0].LocalId / NetworkStride : 0);
                long baseId = netIndex * NetworkStride;
                long leftRail = baseId;
                long nextId = baseId + 2;   // 0 = left rail, 1 reserved (mirrors the IDE layout)
                int row = 0;

                root.Add(new XElement(Ns + "leftPowerRail", new XAttribute("localId", leftRail), Pos(row++),
                    new XElement(Ns + "connectionPointOut", new XAttribute("formalParameter", "none"))));

                foreach (var node in net.Nodes)
                {
                    if (node is not OutVar ov) continue;   // each l-value is a coil — the end of a rung
                    long feed = EmitContacts(root, net.Nodes, ov.Source, leftRail, ref nextId, ref row);
                    long coilId = nextId++;
                    root.Add(new XElement(Ns + "coil", new XAttribute("localId", coilId),
                        CoilAttrs(ov.Mods), Pos(row++),
                        ConnTo(feed), new XElement(Ns + "connectionPointOut"),
                        new XElement(Ns + "variable", ov.Expression)));
                }

                // Right rail: per-network localId IN this network's stride range (baseId + the IDE's
                // ~int.MaxValue rail offset) so it is unique across networks AND decodes back to the right
                // network (index = localId / 10^10). For network 0 this is exactly the IDE's conventional value.
                root.Add(new XElement(Ns + "rightPowerRail", new XAttribute("localId", baseId + RightRailId), Pos(row),
                    new XElement(Ns + "connectionPointIn")));
            }
            return root;
        }

        /// <summary>Emit the contacts feeding <paramref name="source"/> in SERIES (AND), chained from
        /// <paramref name="inId"/>. Returns the localId whose output feeds the next stage (the coil).</summary>
        private static long EmitContacts(XElement root, IReadOnlyList<GraphNode> nodes, Conn? source,
            long inId, ref long nextId, ref int row)
        {
            if (source == null) return inId;
            var prod = nodes.ById(source.RefLocalId);
            switch (prod)
            {
                case InVar iv:
                    long cid = nextId++;
                    root.Add(new XElement(Ns + "contact", new XAttribute("localId", cid),
                        new XAttribute("negated", iv.Mods.Negated ? "true" : "false"),
                        new XAttribute("storage", "none"),
                        new XAttribute("edge", iv.Mods.Edge == EdgeMod.Rising ? "rising"
                            : iv.Mods.Edge == EdgeMod.Falling ? "falling" : "none"),
                        Pos(row++), ConnTo(inId), new XElement(Ns + "connectionPointOut"),
                        new XElement(Ns + "variable", iv.Expression)));
                    return cid;

                case Block b when b.TypeName.ToUpperInvariant() == "AND":
                    long prev = inId;
                    foreach (var pin in b.Inputs) prev = EmitContacts(root, nodes, pin.Source, prev, ref nextId, ref row);
                    return prev;

                default:
                    throw new System.NotSupportedException(
                        $"LD generation (POC): cannot render '{(prod as Block)?.TypeName ?? prod?.GetType().Name ?? "null"}' " +
                        "as ladder yet — only boolean series (AND of contacts) is supported. Edit this POU in the IDE.");
            }
        }

        private static XElement ConnTo(long refId)
            => new(Ns + "connectionPointIn", new XElement(Ns + "connection", new XAttribute("refLocalId", refId)));

        private static IEnumerable<XAttribute> CoilAttrs(Mods m)
        {
            yield return new XAttribute("negated", m.Negated ? "true" : "false");
            yield return new XAttribute("storage", m.Storage == StorageMod.Set ? "set"
                : m.Storage == StorageMod.Reset ? "reset" : "none");
        }

        private static XElement ConnIn(Conn? c, System.Func<long, string?> outPin)
        {
            var cpi = new XElement(Ns + "connectionPointIn");
            if (c != null)
            {
                var conn = new XElement(Ns + "connection", new XAttribute("refLocalId", c.RefLocalId));
                // VG drops an operator/function result's pin (`g1`, not `g1.Out1`); re-derive it so the
                // connection still names the producer's output. FB-instance refs already carry the pin.
                var fp = c.FormalParameter ?? outPin(c.RefLocalId);
                if (fp != null) conn.Add(new XAttribute("formalParameter", fp));
                cpi.Add(conn);
            }
            return cpi;
        }
    }
}
