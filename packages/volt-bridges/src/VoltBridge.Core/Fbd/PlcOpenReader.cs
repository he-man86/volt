using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;

namespace VoltBridge.Core.Fbd
{
    /// <summary>
    /// Parses a PLCopenXML <c>&lt;FBD&gt;</c> / <c>&lt;LD&gt;</c> body element into a
    /// <see cref="GraphBody"/>. TOTAL over the element set: any element it does not yet model
    /// becomes an <see cref="OpaqueNode"/> (preserved verbatim), so it never throws on valid input
    /// and the writer can round-trip what we don't interpret. Positions are discarded.
    /// </summary>
    public static class PlcOpenReader
    {
        public static GraphBody ReadBody(XElement fbdOrLd)
        {
            var ns = fbdOrLd.Name.Namespace;
            var lang = fbdOrLd.Name.LocalName.ToUpperInvariant();          // FBD | LD
            var nodes = fbdOrLd.Elements().Select(el => ReadNode(el, ns)).ToList();
            // NOTE(networks): PLCopenXML FBD is a flat element list — CODESYS network boundaries are
            // not delimited in the body. Phase 1 treats the whole body as a single network; splitting
            // into the engineer's networks is a later refinement.
            var net = new GraphNetwork(null, null, null, false, nodes);
            return new GraphBody(lang, new[] { net });
        }

        private static GraphNode ReadNode(XElement el, XNamespace ns)
        {
            long id = (long?)el.Attribute("localId") ?? 0;
            int? order = (int?)el.Attribute("executionOrderId");
            switch (el.Name.LocalName)
            {
                case "inVariable":  return new InVar(id, order, Expr(el, ns), ReadMods(el));
                case "outVariable": return new OutVar(id, order, Expr(el, ns), ReadMods(el), ReadSource(el, ns));
                case "block":       return ReadBlock(el, ns, id, order);
                default:            return new OpaqueNode(id, order, el.Name.LocalName, el.ToString());
            }
        }

        private static Block ReadBlock(XElement el, XNamespace ns, long id, int? order)
        {
            var inputs = (el.Element(ns + "inputVariables")?.Elements(ns + "variable") ?? Enumerable.Empty<XElement>())
                .Select(v => new Pin((string?)v.Attribute("formalParameter") ?? "", ReadSource(v, ns), ReadMods(v)))
                .ToList();
            var outs = (el.Element(ns + "outputVariables")?.Elements(ns + "variable") ?? Enumerable.Empty<XElement>())
                .Select(v => (string?)v.Attribute("formalParameter") ?? "")
                .ToList();
            return new Block(id, order, (string?)el.Attribute("typeName") ?? "",
                (string?)el.Attribute("instanceName"), inputs, outs, ReadCallType(el, ns));
        }

        private static Conn? ReadSource(XElement el, XNamespace ns)
        {
            var conn = el.Element(ns + "connectionPointIn")?.Element(ns + "connection");
            if (conn == null) return null;
            return new Conn((long?)conn.Attribute("refLocalId") ?? 0, (string?)conn.Attribute("formalParameter"));
        }

        private static string Expr(XElement el, XNamespace ns) => (string?)el.Element(ns + "expression") ?? "";

        private static Mods ReadMods(XElement el)
        {
            bool neg = (bool?)el.Attribute("negated") ?? false;
            var edge = (string?)el.Attribute("edge") switch { "rising" => EdgeMod.Rising, "falling" => EdgeMod.Falling, _ => EdgeMod.None };
            var stor = (string?)el.Attribute("storage") switch { "set" => StorageMod.Set, "reset" => StorageMod.Reset, _ => StorageMod.None };
            return new Mods(neg, edge, stor) is { IsNone: true } ? Mods.None : new Mods(neg, edge, stor);
        }

        /// <summary>CODESYS hint (functionblock / function / operator) from the fbdcalltype addData.</summary>
        private static string? ReadCallType(XElement el, XNamespace ns)
        {
            foreach (var d in el.Element(ns + "addData")?.Elements(ns + "data") ?? Enumerable.Empty<XElement>())
                if (((string?)d.Attribute("name"))?.EndsWith("fbdcalltype") == true)
                    return d.Descendants().FirstOrDefault(x => x.Name.LocalName == "CallType")?.Value;
            return null;
        }
    }
}
