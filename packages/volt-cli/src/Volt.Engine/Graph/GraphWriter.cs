using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Model;

namespace Volt.Engine.Graph
{
    /// <summary>
    /// Renders a <see cref="GraphBody"/> to a PLCopenXML <c>&lt;FBD&gt;</c> / <c>&lt;LD&gt;</c> body
    /// element — the inverse of <see cref="GraphReader"/>. Positions are SYNTHESIZED (a fixed grid;
    /// CODESYS re-lays-out on import) and localIds come from the model. Opaque nodes round-trip
    /// verbatim on the FBD path ONLY; the LD path has no opaque arm and DROPS them — its per-network
    /// vendorElement(networktitle) marker is regenerated instead.
    /// FB-call <c>typeName</c> is not carried by network text, so the caller supplies a resolver
    /// (instanceName → type) from the POU declaration; operators/functions carry their own type.
    /// </summary>
    public static class GraphWriter
    {
        public static readonly XNamespace Ns = "http://www.plcopen.org/xml/tc6_0200";
        private static readonly XNamespace Xhtml = "http://www.w3.org/1999/xhtml";

        /// <param name="resolveType">instanceName → FB type name, from the POU declaration. May be
        /// null when types are already present on the model (e.g. a body just read back).</param>
        /// <summary>Render a graphical <see cref="GraphBody"/> to its PLCopen body element. FBD and LD are the
        /// editable graphical languages; LD is generated as the inverse of <see cref="GraphReader"/>'s ladder
        /// lowering. CFC and SFC are READ-ONLY today (declaration-only, never written) — when one
        /// becomes writable, add its case here with its own writer/model. An unhandled language throws (a loud
        /// failure, never a silently-wrong body).</summary>
        public static XElement WriteBody(GraphBody body, System.Func<string, string?>? resolveType = null) => body.Language switch
        {
            "FBD" => WriteFbdBody(body, resolveType),
            "LD" => WriteLadderBody(body, resolveType),
            _ => throw new System.NotSupportedException(
                $"GraphWriter: graphical language '{body.Language}' is not writable (FBD/LD are generated; CFC/SFC are read-only)."),
        };

        private static XElement WriteFbdBody(GraphBody body, System.Func<string, string?>? resolveType)
        {
            var root = new XElement(Ns + "FBD");
            // A connection back to an operator/function result carries no output-pin name in network text (it's
            // `g1`, not `g1.Out1`). Re-derive the producer block's single output pin so the PLCopen
            // connection still names the output the IDE expects.
            var byId = new Dictionary<long, GraphNode>();
            foreach (var n in body.Networks.SelectMany(x => x.Nodes)) byId[n.LocalId] = n;
            string? OutPin(long id) => byId.TryGetValue(id, out var n) && n is Block bl && bl.OutputPins.Count > 0
                ? bl.OutputPins[0] : null;

            // Output pins REFERENCED by a connection's formalParameter (an FB output like `inst.Q`). network text
            // lists a block's CALL but not its output pins, so a parsed FB block has no OutputPins; without
            // this the `inst.Q` connection would name a pin the block doesn't declare and the IDE would
            // DROP it on import (the `out := ;` bug). Emit these as the block's outputVariables too.
            var refPins = CollectRefPins(body.Networks.SelectMany(x => x.Nodes));

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
                    long netIndex = net.Order ?? (net.Nodes.Count > 0 ? net.Nodes[0].LocalId / GraphConstants.NetworkStride : 0);
                    long commentId = netIndex * GraphConstants.NetworkStride + 9_000_000L + commentSeq++;
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

        /// <summary>Output pins REFERENCED by a connection's <c>formalParameter</c> (see the call sites).
        /// ONE rule for both writers — FBD collects over the whole body, LD per network.</summary>
        private static Dictionary<long, List<string>> CollectRefPins(IEnumerable<GraphNode> nodes)
        {
            var refPins = new Dictionary<long, List<string>>();
            void NoteRef(Conn? c)
            {
                if (c?.FormalParameter == null) return;
                if (!refPins.TryGetValue(c.RefLocalId, out var list)) refPins[c.RefLocalId] = list = new List<string>();
                if (!list.Contains(c.FormalParameter)) list.Add(c.FormalParameter);
            }
            foreach (var n in nodes)
                switch (n)
                {
                    case Block bk: foreach (var p in bk.Inputs) NoteRef(p.Source); break;
                    case OutVar o: NoteRef(o.Source); break;
                    case Jump j: NoteRef(j.Condition); break;
                    case Return r: NoteRef(r.Condition); break;
                }
            return refPins;
        }

        private static XElement WriteNode(GraphNode node, System.Func<string, string?>? resolveType,
            System.Func<long, string?> outPin, Dictionary<long, List<string>> refPins, int row)
        {
            switch (node)
            {
                case OpaqueNode op:
                    return XElement.Parse(op.RawXml);

                case InVar iv:
                    // TwinCAT's importer DROPS `negated` on an <inVariable> (it honours it on outVariables and
                    // block input pins, not here). So a leaf carries its negation in the EXPRESSION TEXT
                    // (`NOT x`) — which both TC and CODESYS round-trip verbatim — not as the attribute. Edge/
                    // storage (rare on a source) stay as attrs. GraphReader re-extracts the leading NOT.
                    return new XElement(Ns + "inVariable", IdAttrs(iv), ModAttrs(iv.Mods with { Negated = false }),
                        Pos(row), new XElement(Ns + "connectionPointOut"),
                        new XElement(Ns + "expression", iv.Mods.Negated ? "NOT " + iv.Expression : iv.Expression));

                case OutVar ov:
                    return new XElement(Ns + "outVariable", IdAttrs(ov), ModAttrs(ov.Mods),
                        Pos(row), ConnIn(ov.Source, outPin),
                        new XElement(Ns + "expression", ov.Expression));

                case Block b:
                    var typeName = b.TypeName;
                    if (string.IsNullOrEmpty(typeName) && b.InstanceName != null && resolveType != null)
                        // NOT `?? ""`. An unresolved instance used to be written as typeName="" — over an export
                        // that CARRIED the type — and the push reported success. Nothing downstream could catch
                        // it: network text does not mention FB types, so both of NetworkCode.Validate's gates see
                        // an identical round-trip whether the type survived or not. The validation was blind to
                        // exactly the thing being destroyed, which is why this has to fail here or nowhere.
                        typeName = resolveType(b.InstanceName)
                            ?? throw new InvalidOperationException(
                                $"cannot write FB instance '{b.InstanceName}': its type is neither in the body " +
                                "being replaced nor readable from the declaration. Declare it as " +
                                $"`{b.InstanceName} : <FB type>;` in the VAR block, or edit this body in the IDE.");
                    var el = new XElement(Ns + "block", IdAttrs(b),
                        new XAttribute("typeName", typeName));
                    if (b.InstanceName != null) el.Add(new XAttribute("instanceName", b.InstanceName));
                    el.Add(Pos(row));
                    el.Add(new XElement(Ns + "inputVariables", b.Inputs.Select(p =>
                        new XElement(Ns + "variable", new XAttribute("formalParameter", p.FormalParameter),
                            ModAttrs(p.Mods), ConnIn(p.Source, outPin)))));
                    el.Add(new XElement(Ns + "inOutVariables"));
                    // Output pins = the block's own, UNION any referenced by an `inst.Q` connection
                    // (which network text carries on the consumer, not the block) so the connection stays valid.
                    var outs = new List<string>(b.OutputPins);
                    if (refPins.TryGetValue(b.LocalId, out var extra))
                        foreach (var p in extra) if (!outs.Contains(p)) outs.Add(p);
                    el.Add(new XElement(Ns + "outputVariables", outs.Select(o =>
                        new XElement(Ns + "variable", new XAttribute("formalParameter", o),
                            new XElement(Ns + "connectionPointOut")))));
                    // Re-emit the CODESYS/TwinCAT vendor metadata so a written-back block carries what
                    // the IDE exported: the fbdcalltype hint (operator / function / functionblock) plus
                    // the input/output param-type lists. Types are read-only metadata — on the push path
                    // network text doesn't carry them, so these come out empty and the IDE reconstructs them.
                    if (!string.IsNullOrEmpty(b.CallType))
                        el.Add(new XElement(Ns + "addData",
                            VendorData("fbdcalltype", "CallType", b.CallType),
                            VendorData("inputparamtypes", "InputParamTypes", JoinTypes(b.Inputs.Select(p => p.Type))),
                            VendorData("outputparamtypes", "OutputParamTypes", JoinTypes(b.OutputTypes)),
                            // An Execute box carries its inline ST — re-emit the <STCode> so the IDE rebuilds the box.
                            b.StCode != null ? VendorData("stcode", "STCode", b.StCode) : null));
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
                    // Every GraphNode subtype is matched above. A new one must get its own arm here —
                    // emitting a placeholder would ship a silently-wrong body (see WriteBody).
                    throw new System.NotSupportedException(
                        $"GraphWriter: no writer for graph node '{node.GetType().Name}' (localId {node.LocalId}).");
            }
        }

        private static IEnumerable<XAttribute> IdAttrs(GraphNode n)
        {
            yield return new XAttribute("localId", n.LocalId);
            if (n.ExecOrder.HasValue) yield return new XAttribute("executionOrderId", n.ExecOrder.Value);
        }

        /// <summary>The PLCopen pin/element modifier attributes (negation, edge, set/reset storage),
        /// the inverse of <see cref="GraphReader"/>'s ReadMods. None emitted when <c>IsNone</c>.</summary>
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

        // ── LD ladder generation — ONE recursion, the exact inverse of GraphReader.LowerLadder ─────────────
        // A rung is leftPowerRail → the boolean spine → coil. The right rail is emitted ONCE per body as an
        // UNCONNECTED terminator (empty connectionPointIn; no coil is wired to it, and a coil's own
        // connectionPointOut is left dangling) — it is this form, not a wired one, that the live round-trip
        // below was verified with. The spine (see LdCtx.EmitPower) is
        // contacts (series = AND), parallel branches (OR), and FB/operator blocks whose primary output continues
        // it; a block's typed data inputs are variable boxes (LdCtx.EmitData), and a non-boolean output assigned
        // to a variable embeds in its pin. Negated / Set / Reset coils and normally-closed / edge contacts carry
        // their pin mods. Round-trip-verified live on BOTH vendors — and the CODESYS half is the newer claim.
        // Every committed LD capture is TwinCAT (fixtures/tc-ld/*), so CODESYS LD used to ride this spine on the
        // strength of FBD parity: an inference, not a measurement. test/e2e/graphical/graphical-kinds.test.ts closes it
        // by pushing a ladder through the live bridge into every element that can hold one — function_block,
        // program, function, method, action and both property accessors — reading it back, re-pushing it
        // byte-identical, and building it. The same file runs against either vendor.
        private const long RightRailId = 2147483646L;

        private static XElement WriteLadderBody(GraphBody body, System.Func<string, string?>? resolveType)
        {
            // ONE shared left/right power rail bracket the WHOLE body (TwinCAT's multi-network LD form, confirmed
            // against a real 4-network capture). Each network is a vendorElement(networktitle) marker + its rung,
            // and every contact hangs off the one shared left rail (id 0). The reader splits on the markers; the
            // shared rails make a multi-network/multi-coil body re-import without TC dropping networks (the bug
            // that came from per-network rails). The IDE re-numbers localIds on import, so strided ids are fine.
            const long SharedLeftRail = 0L;
            var root = new XElement(Ns + "LD");
            int row = 0;
            root.Add(new XElement(Ns + "leftPowerRail", new XAttribute("localId", SharedLeftRail), Pos(row++),
                new XElement(Ns + "connectionPointOut", new XAttribute("formalParameter", "none"))));
            foreach (var net in body.Networks)
            {
                long netIndex = net.Order ?? (net.Nodes.Count > 0 ? net.Nodes[0].LocalId / GraphConstants.NetworkStride : 0);
                var ctx = new LdCtx(root, net, resolveType, netIndex);
                // The network's COMMENT precedes its title marker — the shape both vendors emit (recorded:
                // tc-ld/ld_four_networks_shared_rails.plcopen.xml:33, a <comment> then a <vendorElement>), and the
                // order GraphReader.SplitNetworks expects. Without this the ladder writer silently DELETED an
                // engineer's network comment on every push: the reader folds it into the network, `SafeToDrop`
                // lets the splice remove the original, and nothing put it back. FBD has always re-emitted it.
                if (!string.IsNullOrEmpty(net.Comment))
                    root.Add(new XElement(Ns + "comment",
                        new XAttribute("localId", ctx.Mint()), new XAttribute("height", 0), new XAttribute("width", 0),
                        Pos(row++),
                        // TC6 comment content is xhtml, not plain text — CODESYS rejects bare text.
                        new XElement(Ns + "content", new XElement(Xhtml + "xhtml", net.Comment))));
                root.Add(NetworkTitle(ctx.Mint(), Pos(row++)));   // delimits this network — the reader splits here
                foreach (var node in net.Nodes)
                {
                    switch (node)
                    {
                        case OutVar ov when ctx.IsEmbedded(ov):
                            break;                                  // folded into its producing block's output pin
                        case OutVar ov:                             // each l-value is a coil — the end of a rung
                            var feed = ctx.EmitPower(ov.Source, Mods.None, new List<long> { SharedLeftRail });
                            // the coil's localId is minted AFTER its spine (so it's above its contacts) — else the
                            // IDE reads each coil as its own rung and splits a multi-coil network apart.
                            root.Add(new XElement(Ns + "coil", new XAttribute("localId", ctx.Mint()), CoilAttrs(ov.Mods),
                                Pos(row++), ConnTo(feed, ctx.OutPin), new XElement(Ns + "connectionPointOut"),
                                new XElement(Ns + "variable", ov.Expression)));
                            break;
                        case Label:
                        case Jump:
                        case Return:
                            root.Add(WriteNode(node, resolveType, ctx.OutPin, ctx.RefPins, row++));
                            break;
                        // InVar and Block are pulled by EmitPower/EmitData — never emitted at the rung top level.
                    }
                }
            }
            root.Add(new XElement(Ns + "rightPowerRail", new XAttribute("localId", RightRailId),
                Pos(row), new XElement(Ns + "connectionPointIn")));
            return root;
        }

        // The per-network "networktitle" vendorElement TwinCAT/CODESYS emit to delimit each LD network. The
        // ElementType is in NO namespace (xmlns="") — GraphReader.SplitNetworks matches it by local name.
        private static XElement NetworkTitle(long id, XElement pos) =>
            new XElement(Ns + "vendorElement", new XAttribute("localId", id), pos,
                new XElement(Ns + "alternativeText", new XElement(Xhtml + "xhtml")),
                new XElement(Ns + "addData",
                    new XElement(Ns + "data",
                        new XAttribute("name", "http://www.3s-software.com/plcopenxml/fbdelementtype"),
                        new XAttribute("handleUnknown", "implementation"),
                        new XElement("ElementType", "networktitle"))));

        /// <summary>Per-network emit state for the ladder writer (see the section comment). ONE recursion, the
        /// inverse of <see cref="GraphReader"/>'s LowerLadder: <see cref="EmitPower"/> draws the boolean power
        /// spine (contacts / series=AND / parallel=OR / an FB-or-operator block whose primary output continues
        /// the spine), <see cref="EmitData"/> draws a block's typed data inputs as variable boxes. A leaf reached
        /// via EmitPower is a contact; via EmitData a box — the contact-vs-box choice the reader collapsed. A
        /// non-primary block output assigned to a variable embeds as an &lt;expression&gt; in its pin. Blocks/boxes
        /// keep their model localIds; minted contact ids start above every model id so they never collide.</summary>
        private sealed class LdCtx
        {
            private readonly XElement _root;
            private readonly System.Func<string, string?>? _resolveType;
            private readonly Dictionary<long, GraphNode> _byId;
            private readonly Dictionary<(long, string), string> _embed = new Dictionary<(long, string), string>();
            private readonly HashSet<long> _emitted = new HashSet<long>();   // a block / data box is emitted once
            private long _nextId;
            public int Row;
            public readonly System.Func<long, string?> OutPin;
            public readonly Dictionary<long, List<string>> RefPins;

            public LdCtx(XElement root, GraphNetwork net, System.Func<string, string?>? resolveType, long netIndex)
            {
                _root = root; _resolveType = resolveType;
                _byId = net.Nodes.ToDictionary(n => n.LocalId);
                _nextId = (net.Nodes.Count > 0 ? net.Nodes.Max(n => n.LocalId) : netIndex * GraphConstants.NetworkStride) + 1;

                var refPins = CollectRefPins(net.Nodes);
                RefPins = refPins;
                // a block's PRIMARY output pin: its first declared output, else the first one a connection names.
                OutPin = id => _byId.TryGetValue(id, out var n) && n is Block bl
                    ? (bl.OutputPins.Count > 0 ? bl.OutputPins[0] : refPins.TryGetValue(id, out var rp) ? rp.FirstOrDefault() : null)
                    : null;

                // The primary (boolean) output drives the rung coil; any OTHER output assigned to a variable embeds
                // in its pin. LIVE TC proved both are required — a boolean output embedded in the pin is dropped,
                // a non-boolean output as a coil is a TIME coil that silently empties the export.
                foreach (var n in net.Nodes)
                    if (n is OutVar o && o.Source is { FormalParameter: { } fp } src
                        && _byId.TryGetValue(src.RefLocalId, out var prod) && prod is Block && fp != OutPin(src.RefLocalId))
                        _embed[(src.RefLocalId, fp)] = o.Expression;
            }

            public bool IsEmbedded(OutVar ov) =>
                ov.Source is { FormalParameter: { } fp } s && _embed.ContainsKey((s.RefLocalId, fp));

            /// <summary>Mint a fresh localId, above every model id and every id minted so far.</summary>
            public long Mint() => _nextId++;

            /// <summary>The boolean power spine. Returns the localId(s) carrying <paramref name="source"/>'s value
            /// (with <paramref name="extraMods"/> merged on), wired from <paramref name="inIds"/> — one for a
            /// contact/series, several for a parallel (OR) convergence.</summary>
            public List<long> EmitPower(Conn? source, Mods extraMods, IReadOnlyList<long> inIds)
            {
                if (source == null) return new List<long>(inIds);
                var prod = _byId.TryGetValue(source.RefLocalId, out var p) ? p : null;
                switch (prod)
                {
                    case InVar iv:
                        var m = MergeMods(iv.Mods, extraMods);   // the leaf's own mods AND the consuming pin's
                        long cid = _nextId++;
                        _root.Add(new XElement(Ns + "contact", new XAttribute("localId", cid),
                            new XAttribute("negated", m.Negated ? "true" : "false"), new XAttribute("storage", "none"),
                            new XAttribute("edge", m.Edge == EdgeMod.Rising ? "rising" : m.Edge == EdgeMod.Falling ? "falling" : "none"),
                            Pos(Row++), ConnTo(inIds, OutPin), new XElement(Ns + "connectionPointOut"),
                            new XElement(Ns + "variable", iv.Expression)));
                        return new List<long> { cid };

                    case Block b when b.TypeName.ToUpperInvariant() == "AND":   // series: chain pin → pin
                        List<long> cur = new List<long>(inIds);
                        foreach (var pin in b.Inputs) cur = EmitPower(pin.Source, pin.Mods, cur);
                        return cur;

                    case Block b when b.TypeName.ToUpperInvariant() == "OR":    // parallel branches off the same input
                        var outs = new List<long>();
                        foreach (var pin in b.Inputs) outs.AddRange(EmitPower(pin.Source, pin.Mods, inIds));
                        return outs;

                    case Block b:                                  // FB/operator: its primary output continues the spine
                        EmitBlock(b);
                        return new List<long> { b.LocalId };

                    default:
                        throw new System.NotSupportedException(
                            $"this ladder rung uses '{prod?.GetType().Name ?? "an unsupported element"}', " +
                            "which can't be authored as ladder — edit this POU in the IDE.");
                }
            }

            /// <summary>A typed DATA wire into a block pin: a leaf becomes a variable box, a nested block the block
            /// itself. Emitted at most once.</summary>
            private void EmitData(Conn? source)
            {
                if (source == null) return;
                if (!_byId.TryGetValue(source.RefLocalId, out var prod)) return;
                if (prod is Block b) EmitBlock(b);
                else if (prod is InVar && _emitted.Add(prod.LocalId))
                    _root.Add(WriteNode(prod, _resolveType, OutPin, RefPins, Row++));
            }

            /// <summary>Emit an FB/operator block (once): its data inputs first (boxes / nested blocks), then the
            /// block element, embedding any non-primary output assignment into its output pin.</summary>
            private void EmitBlock(Block b)
            {
                if (!_emitted.Add(b.LocalId)) return;
                foreach (var pin in b.Inputs) EmitData(pin.Source);
                var el = WriteNode(b, _resolveType, OutPin, RefPins, Row++);
                foreach (var ovar in el.Element(Ns + "outputVariables")?.Elements(Ns + "variable") ?? Enumerable.Empty<XElement>())
                    if (ovar.Attribute("formalParameter")?.Value is { } fp && _embed.TryGetValue((b.LocalId, fp), out var target))
                        ovar.Element(Ns + "connectionPointOut")?.Add(new XElement(Ns + "expression", target));
                _root.Add(el);
            }
        }

        /// <summary>Combine a leaf's mods with the consuming pin's: two negations cancel (XOR); edge and
        /// storage take whichever side is set (they never legitimately conflict on one wire).</summary>
        private static Mods MergeMods(Mods a, Mods b) => new(
            a.Negated ^ b.Negated,
            a.Edge != EdgeMod.None ? a.Edge : b.Edge,
            a.Storage != StorageMod.None ? a.Storage : b.Storage);

        // A connectionPointIn's connections. A connection to a BLOCK names the producer's output pin (via outPin)
        // — without it the IDE drops an inst.Q wire on import. SEVERAL connections are how PLCopen encodes an OR
        // convergence (the reader lowers them back to OR); a single connection is the ordinary series case.
        private static XElement ConnTo(IEnumerable<long> refIds, System.Func<long, string?> outPin)
            => new(Ns + "connectionPointIn", refIds.Select(r =>
            {
                var c = new XElement(Ns + "connection", new XAttribute("refLocalId", r));
                if (outPin(r) is { } fp) c.Add(new XAttribute("formalParameter", fp));
                return c;
            }));

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
                // network text drops an operator/function result's pin (`g1`, not `g1.Out1`); re-derive it so the
                // connection still names the producer's output. FB-instance refs already carry the pin.
                var fp = c.FormalParameter ?? outPin(c.RefLocalId);
                if (fp != null) conn.Add(new XAttribute("formalParameter", fp));
                cpi.Add(conn);
            }
            return cpi;
        }
    }
}
