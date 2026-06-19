using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;

namespace Volt.Bridge.Core.Graphical
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
            var networks = new List<GraphNetwork>();

            // Each localId encodes its network index (localId / 10^10) — group on that for the
            // engineer's top-to-bottom order.
            foreach (var g in fbdOrLd.Elements()
                         .GroupBy(e => ((long?)e.Attribute("localId") ?? 0) / NetworkStride)
                         .OrderBy(g => g.Key))
            {
                var els = g.ToList();
                // <comment> boxes carry the network's annotation/title; fold their text in.
                var comment = string.Join("\n", els.Where(e => e.Name.LocalName == "comment")
                    .Select(CommentText).Where(t => t.Length > 0));
                var logic = els.Where(e => e.Name.LocalName != "comment").ToList();

                // LD-native rungs (contacts/coils/rails) lower to the SAME boolean graph as the FBD
                // twin so they READ as VG; pure block/variable networks read directly.
                var ladder = logic.Any(e => e.Name.LocalName is "contact" or "coil" or "leftPowerRail" or "rightPowerRail");
                var nodes = ladder
                    // Fresh localIds start high within the network's range so they can't collide with
                    // original ids that pass-through nodes (vendorElement/jump/…) keep.
                    ? LowerLadder(logic, ns, g.Key * NetworkStride + 500_000_000L)
                    : logic.Select(e => ReadNode(e, ns)).ToList();

                networks.Add(new GraphNetwork((int)g.Key, null, comment.Length > 0 ? comment : null, false, nodes));
            }
            // A body always has at least one network (empty FBD → one empty network).
            if (networks.Count == 0) networks.Add(new GraphNetwork(0, null, null, false, new List<GraphNode>()));

            return new GraphBody(lang, networks);
        }

        /// <summary>Lower an LD rung (leftPowerRail → contacts → coil) into the SAME boolean node graph
        /// an FBD network would use: a contact is its variable, contacts in series are AND, parallel
        /// branches (a connectionPointIn with several connections) are OR, a coil is an assignment.
        /// Negation/edge/storage ride as pin <see cref="Mods"/> on the consumer. The inverse —
        /// <c>PlcOpenWriter.WriteLadderBody</c> — regenerates the ladder (contacts/coil/power-rails) from this
        /// boolean graph on write, so ladder is both READABLE as VG and round-trippable.</summary>
        private static List<GraphNode> LowerLadder(List<XElement> els, XNamespace ns, long baseId)
        {
            var byId = new Dictionary<long, XElement>();
            foreach (var e in els) byId[(long?)e.Attribute("localId") ?? 0] = e;
            var nodes = new List<GraphNode>();
            long next = baseId;
            var memo = new Dictionary<long, (Conn? Conn, Mods Mods)>();   // ld id → its boolean value (Conn==null = rail/identity)

            (Conn? Conn, Mods Mods) Value(long id)
            {
                if (memo.TryGetValue(id, out var done)) return done;
                memo[id] = (null, Mods.None);                            // cycle guard
                if (!byId.TryGetValue(id, out var el)) return (null, Mods.None);
                (Conn? Conn, Mods Mods) r;
                switch (el.Name.LocalName)
                {
                    case "contact":
                    {
                        var up = CombineIn(el);
                        var iv = new InVar(next++, null, el.Element(ns + "variable")?.Value ?? "", Mods.None);
                        nodes.Add(iv);
                        var v = ((Conn?)new Conn(iv.LocalId, null), ReadMods(el));
                        r = up.Conn == null ? v : And(up, v);           // off-rail = just the var; else series AND
                        break;
                    }
                    case "coil":
                    {
                        var inp = CombineIn(el);
                        nodes.Add(new OutVar(next++, null, el.Element(ns + "variable")?.Value ?? "",
                            Merge(inp.Mods, ReadMods(el)), inp.Conn));
                        r = (null, Mods.None);                          // a sink
                        break;
                    }
                    case "outVariable":
                    {
                        var inp = CombineIn(el);
                        nodes.Add(new OutVar(next++, null, Expr(el, ns), Merge(inp.Mods, ReadMods(el)), inp.Conn));
                        r = (null, Mods.None);
                        break;
                    }
                    case "inVariable":
                    {
                        var iv = new InVar(next++, null, Expr(el, ns), ReadMods(el));
                        nodes.Add(iv);
                        r = (new Conn(iv.LocalId, null), Mods.None);
                        break;
                    }
                    case "block":
                    {
                        var inTypes = ReadParamTypes(el, ns, "inputparamtypes");
                        var outTypes = ReadParamTypes(el, ns, "outputparamtypes");
                        var ins = (el.Element(ns + "inputVariables")?.Elements(ns + "variable") ?? Enumerable.Empty<XElement>())
                            .Select((v, k) => { var s = CombineIn(v);
                                return new Pin((string?)v.Attribute("formalParameter") ?? "", s.Conn, Merge(s.Mods, ReadMods(v)),
                                    k < inTypes.Count ? inTypes[k] : null); })
                            .ToList();
                        var outs = (el.Element(ns + "outputVariables")?.Elements(ns + "variable") ?? Enumerable.Empty<XElement>())
                            .Select(v => (string?)v.Attribute("formalParameter") ?? "").ToList();
                        var blk = new Block(next++, null, (string?)el.Attribute("typeName") ?? "",
                            (string?)el.Attribute("instanceName"), ins, outs, ReadCallType(el, ns),
                            outTypes.Count > 0 ? outTypes : null);
                        nodes.Add(blk);
                        r = (new Conn(blk.LocalId, null), Mods.None);   // consumers carry the output-pin selector
                        break;
                    }
                    case "leftPowerRail":
                    case "rightPowerRail":
                        r = (null, Mods.None);                          // power identity
                        break;
                    case "label":
                        nodes.Add(new Label(next++, null, (string?)el.Attribute("label") ?? ""));
                        r = (null, Mods.None);
                        break;
                    case "jump":
                    {
                        var c = CombineIn(el);                          // re-wire the (optional) condition
                        nodes.Add(new Jump(next++, null, (string?)el.Attribute("label") ?? "", c.Conn, Merge(c.Mods, ReadMods(el))));
                        r = (null, Mods.None);
                        break;
                    }
                    case "return":
                    {
                        var c = CombineIn(el);
                        nodes.Add(new Return(next++, null, c.Conn, Merge(c.Mods, ReadMods(el))));
                        r = (null, Mods.None);
                        break;
                    }
                    default:                                            // vendorElement / unknown → opaque, dropped from VG
                        nodes.Add(ReadNode(el, ns) with { LocalId = next++ });
                        r = (null, Mods.None);
                        break;
                }
                memo[id] = r;
                return r;
            }

            // Resolve an element's input wire(s), carrying each connection's output-pin selector
            // (formalParameter) onto the lowered wire. Several connections = a parallel OR junction.
            (Conn? Conn, Mods Mods) CombineIn(XElement el)
            {
                var ins = (el.Element(ns + "connectionPointIn")?.Elements(ns + "connection") ?? Enumerable.Empty<XElement>())
                    .Select(c =>
                    {
                        var v = Value((long?)c.Attribute("refLocalId") ?? 0);
                        if (v.Conn == null) return ((Conn?)null, Mods.None);
                        var fp = (string?)c.Attribute("formalParameter") ?? v.Conn.FormalParameter;
                        return ((Conn?)new Conn(v.Conn.RefLocalId, fp), v.Mods);
                    })
                    .Where(v => v.Item1 != null).ToList();
                if (ins.Count == 0) return (null, Mods.None);           // fed only by the rail
                if (ins.Count == 1) return ins[0];
                var or = new Block(next++, null, "OR", null,
                    ins.Select((v, i) => new Pin("IN" + (i + 1), v.Item1, v.Item2)).ToList(),
                    new List<string> { "OUT" }, "operator");
                nodes.Add(or);
                return (new Conn(or.LocalId, null), Mods.None);
            }

            (Conn?, Mods) And((Conn? Conn, Mods Mods) a, (Conn? Conn, Mods Mods) b)
            {
                var and = new Block(next++, null, "AND", null,
                    new List<Pin> { new("IN1", a.Conn, a.Mods), new("IN2", b.Conn, b.Mods) },
                    new List<string> { "OUT" }, "operator");
                nodes.Add(and);
                return (new Conn(and.LocalId, null), Mods.None);
            }

            // Evaluate every element (sinks pull their upstream; standalone blocks get pulled too).
            foreach (var el in els) Value((long?)el.Attribute("localId") ?? 0);
            return nodes;
        }

        /// <summary>Combine two modifier sets (a contact/coil's own with the value flowing through it):
        /// negations cancel, edge/storage take whichever is set.</summary>
        private static Mods Merge(Mods a, Mods b)
        {
            var neg = a.Negated ^ b.Negated;
            var edge = a.Edge != EdgeMod.None ? a.Edge : b.Edge;
            var stor = a.Storage != StorageMod.None ? a.Storage : b.Storage;
            return (!neg && edge == EdgeMod.None && stor == StorageMod.None) ? Mods.None : new Mods(neg, edge, stor);
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
            var inTypes = ReadParamTypes(el, ns, "inputparamtypes");
            var outTypes = ReadParamTypes(el, ns, "outputparamtypes");
            var inputs = (el.Element(ns + "inputVariables")?.Elements(ns + "variable") ?? Enumerable.Empty<XElement>())
                .Select((v, k) => new Pin((string?)v.Attribute("formalParameter") ?? "", ReadSource(v, ns), ReadMods(v),
                    k < inTypes.Count ? inTypes[k] : null))
                .ToList();
            var outs = (el.Element(ns + "outputVariables")?.Elements(ns + "variable") ?? Enumerable.Empty<XElement>())
                .Select(v => (string?)v.Attribute("formalParameter") ?? "")
                .ToList();
            return new Block(id, order, (string?)el.Attribute("typeName") ?? "",
                (string?)el.Attribute("instanceName"), inputs, outs, ReadCallType(el, ns),
                outTypes.Count > 0 ? outTypes : null);
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

        /// <summary>The whitespace-separated type list from the 3S <c>inputparamtypes</c> /
        /// <c>outputparamtypes</c> addData (CODESYS and TwinCAT both emit it; operators leave inputs
        /// empty). Positionally aligned to the block's input/output pins. Read-only metadata.</summary>
        private static IReadOnlyList<string> ReadParamTypes(XElement el, XNamespace ns, string suffix)
        {
            foreach (var d in el.Element(ns + "addData")?.Elements(ns + "data") ?? Enumerable.Empty<XElement>())
                if (((string?)d.Attribute("name"))?.EndsWith(suffix) == true)
                    return (d.Elements().FirstOrDefault()?.Value ?? "")
                        .Split(new[] { ' ', '\t', '\n', '\r' }, System.StringSplitOptions.RemoveEmptyEntries);
            return System.Array.Empty<string>();
        }
    }
}
