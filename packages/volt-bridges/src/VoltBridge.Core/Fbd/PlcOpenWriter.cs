using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;

namespace VoltBridge.Core.Fbd
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

        /// <param name="resolveType">instanceName → FB type name, from the POU declaration. May be
        /// null when types are already present on the model (e.g. a body just read back).</param>
        public static XElement WriteBody(GraphBody body, System.Func<string, string?>? resolveType = null)
        {
            var root = new XElement(Ns + (body.Language == "LD" ? "LD" : "FBD"));
            int row = 0;
            long commentId = 900_000_000_000L;   // high, throwaway localIds for synthesized comment boxes
            foreach (var net in body.Networks)
            {
                if (!string.IsNullOrEmpty(net.Comment))
                    root.Add(new XElement(Ns + "comment",
                        new XAttribute("localId", commentId++), Pos(row++),
                        new XElement(Ns + "content", net.Comment)));
                foreach (var node in net.Nodes)
                    root.Add(WriteNode(node, resolveType, row++));
            }
            return root;
        }

        private static XElement WriteNode(GraphNode node, System.Func<string, string?>? resolveType, int row)
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
                        Pos(row), ConnIn(ov.Source),
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
                            ModAttrs(p.Mods), ConnIn(p.Source)))));
                    el.Add(new XElement(Ns + "inOutVariables"));
                    el.Add(new XElement(Ns + "outputVariables", b.OutputPins.Select(o =>
                        new XElement(Ns + "variable", new XAttribute("formalParameter", o),
                            new XElement(Ns + "connectionPointOut")))));
                    // Re-emit the CODESYS/TwinCAT fbdcalltype hint (operator / function / functionblock)
                    // so a written-back block carries the same vendor metadata the IDE exported.
                    if (!string.IsNullOrEmpty(b.CallType))
                        el.Add(new XElement(Ns + "addData",
                            new XElement(Ns + "data",
                                new XAttribute("name", "http://www.3s-software.com/plcopenxml/fbdcalltype"),
                                new XAttribute("handleUnknown", "implementation"),
                                new XElement("CallType", b.CallType))));   // empty-ns child, matching the IDE format
                    return el;

                case Label lb:
                    return new XElement(Ns + "label", IdAttrs(lb), new XAttribute("label", lb.Name), Pos(row));

                case Jump jp:
                    return new XElement(Ns + "jump", IdAttrs(jp), new XAttribute("label", jp.Target),
                        ModAttrs(jp.Mods), Pos(row), jp.Condition != null ? ConnIn(jp.Condition) : null);

                case Return rt:
                    return new XElement(Ns + "return", IdAttrs(rt), ModAttrs(rt.Mods),
                        Pos(row), rt.Condition != null ? ConnIn(rt.Condition) : null);

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

        private static XElement ConnIn(Conn? c)
        {
            var cpi = new XElement(Ns + "connectionPointIn");
            if (c != null)
            {
                var conn = new XElement(Ns + "connection", new XAttribute("refLocalId", c.RefLocalId));
                if (c.FormalParameter != null) conn.Add(new XAttribute("formalParameter", c.FormalParameter));
                cpi.Add(conn);
            }
            return cpi;
        }
    }
}
