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
        // CODESYS/TwinCAT have no <network> wrapper in the flat PLCopenXML body; instead they encode
        // the engineer's network index in the high digits of every localId (localId / 10^10 = the
        // network it belongs to). We split on that so the VG mirrors the editor's networks 1:1.
        private const long NetworkStride = 10_000_000_000L;   // 10^10

        public static GraphBody ReadBody(XElement fbdOrLd)
        {
            var ns = fbdOrLd.Name.Namespace;
            var lang = fbdOrLd.Name.LocalName.ToUpperInvariant();          // FBD | LD
            var all = fbdOrLd.Elements().ToList();

            // <comment> boxes carry a network's annotation (and, in the flat scheme, its title). Fold
            // them into the owning network (by localId index) as the network Comment; the logic nodes
            // are everything else.
            var comments = all.Where(e => e.Name.LocalName == "comment")
                .GroupBy(c => ((long?)c.Attribute("localId") ?? 0) / NetworkStride)
                .ToDictionary(g => g.Key, g => string.Join("\n", g.Select(CommentText).Where(t => t.Length > 0)));
            var nodes = all.Where(e => e.Name.LocalName != "comment").Select(el => ReadNode(el, ns)).ToList();

            var keys = nodes.Select(n => n.LocalId / NetworkStride)
                .Concat(comments.Keys).Distinct().OrderBy(k => k).ToList();   // engineer's top-to-bottom order
            var networks = keys
                .Select(k => new GraphNetwork(
                    (int)k, null,
                    comments.TryGetValue(k, out var c) && c.Length > 0 ? c : null,
                    false,
                    nodes.Where(n => n.LocalId / NetworkStride == k).ToList()))
                .ToList();
            // A body always has at least one network (empty FBD → one empty network).
            if (networks.Count == 0) networks.Add(new GraphNetwork(0, null, null, false, nodes));

            return new GraphBody(lang, networks);
        }

        /// <summary>A comment box's text, taken from ALL its text content regardless of the
        /// (vendor-varying) wrapper (&lt;content&gt;, xhtml, …) so the text is never lost.</summary>
        private static string CommentText(XElement c) =>
            string.Concat(c.DescendantNodes().OfType<XText>().Select(t => t.Value)).Trim();

        private static GraphNode ReadNode(XElement el, XNamespace ns)
        {
            long id = (long?)el.Attribute("localId") ?? 0;
            int? order = (int?)el.Attribute("executionOrderId");
            switch (el.Name.LocalName)
            {
                case "inVariable":  return new InVar(id, order, Expr(el, ns), ReadMods(el));
                case "outVariable": return new OutVar(id, order, Expr(el, ns), ReadMods(el), ReadSource(el, ns));
                case "block":       return ReadBlock(el, ns, id, order);
                case "label":       return new Label(id, order, (string?)el.Attribute("label") ?? "");
                case "jump":        return new Jump(id, order, (string?)el.Attribute("label") ?? "", ReadSource(el, ns), ReadMods(el));
                case "return":      return new Return(id, order, ReadSource(el, ns), ReadMods(el));
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
