using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Network;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Ide.Twincat;

/// <summary>
/// Lowers a <see cref="NetworkBody"/> to PLCopen FBD/LD, the ONE form in which TwinCAT will accept a graphical
/// body it does not already have.
///
/// <para><b>Why this exists rather than archive construction.</b> <see cref="TcNetworkWriter"/> refuses to
/// create, and the refusal is correct: a real <c>BoxTreeBox</c> carries <c>InputParam</c>, <c>OutputParam</c>,
/// <c>CallType</c>, <c>EN</c>, <c>ENO</c> and <c>Id</c>, which are RESULTS OF THE IDE RESOLVING THE CALL. Volt
/// does not resolve calls. Building those from a template once wrote twenty <c>.TcPOU</c> files TwinCAT could
/// not open, and reflection does not rescue it — DIALECT N11 measured that <c>BoxTreeBox</c>, the type the
/// archive names most often, has no concrete class in any shipped assembly. PLCopen inverts the problem: Volt
/// emits TOPOLOGY and <b>TwinCAT's own importer resolves the rest</b>, producing exactly the members Volt must
/// not guess. It is also Beckhoff's documented route — <c>PlcOpenImport</c> is the only API they document that
/// carries a graphical body.</para>
///
/// <para><b>Volt does not model a resolved signature, so this writer does not emit one.</b> The vendor's own
/// export carries <c>inputparamtypes</c>/<c>outputparamtypes</c> <c>addData</c> holding the types the compiler
/// worked out (<c>OutputParam.Types = ["BOOL"]</c> on an <c>AND</c> whose <c>OutputItems</c> is empty — a
/// signature, not a wiring). Emitting a GUESS there would be the same class of error as building the archive,
/// so the blocks are omitted and the IDE re-derives them. Everything Volt genuinely knows — the call kind, the
/// formal names it was given, the wiring — is emitted.</para>
///
/// <para><b>Anything not expressible is refused, never dropped.</b> A flag or a node this lowering has no PLCopen
/// form for throws, because a silently thinned body is a body the engineer loses.</para>
/// </summary>
internal static class TcPlcOpenWriter
{
    /// <summary>The FBD/LD element for a whole body. Networks share one element and one id space, keyed the way
    /// the vendor keys them: <c>localId = 10^10 * (order + 1) + n</c>, which is why the vendor's own export of
    /// network 0 starts at 10000000001 with the attribute marker at 10000000000.</summary>
    private static XElement WriteBody(NetworkBody body, string? declaration)
    {
        // ALWAYS <FBD>, for a ladder too. An <LD> body whose children are FBD-shaped makes TwinCAT's importer
        // throw ("Object reference not set to an instance of an object"), because PLCopen ladder is a different
        // vocabulary - power rails, contacts, coils. Volt does not need it: the vendor treats FBD, LD and IL as
        // three VIEWS of ONE network, and a ladder's contacts and coils are already lowered into the same
        // boolean node graph an FBD network uses. The ladder-ness is `DefaultViewMode` on the archive, written
        // after the import (TcArchive.WithViewMode).
        var root = new XElement(Namespaces.Tc6 + "FBD");

        // ONE attribute marker for the WHOLE BODY, not one per network — measured, after guessing otherwise.
        // Emitting it per network produced a body TwinCAT imported happily and then could never push back: the
        // SECOND marker came out of the importer as a real network item, and the next pull rendered it as a box
        // literally called `FBD Implementation Attributes()`. It is a body-level declaration ("input pins may
        // carry flags"), so it is written once, in the first network's id space, exactly where the vendor's own
        // export puts it (localId 10000000000, immediately before that network's items).
        var first = new NetworkWriter(root, body.Networks.Count > 0 ? body.Networks[0].Order : 0, declaration);
        first.EmitAttributeMarker();

        for (int i = 0; i < body.Networks.Count; i++)
        {
            var network = body.Networks[i];
            var w = i == 0 ? first : new NetworkWriter(root, network.Order, declaration);
            w.CountWireConsumers(network);
            foreach (var tree in network.Trees) w.Emit(tree);
        }
        return root;
    }

    /// <summary>A complete PLCopen document for <c>PlcOpenImport</c>: the envelope and the lowered body.
    ///
    /// <para><b>The DECLARATION is deliberately absent, and the first reason given for that was wrong.</b> A
    /// first version carried it as a <c>plcopenxml/declaration</c> <c>addData</c>, and measured live the
    /// importer ignored it outright — the POU arrived holding nothing but <c>PROGRAM &lt;name&gt;</c>, its VAR
    /// block gone. The conclusion drawn then, "declarations do not travel in PLCopen on this install", is NOT
    /// what that measured: a vendor PLCopen export carries the declaration as
    /// <c>plcopenxml/<b>interfaceasplaintext</b></c> holding an <c>xhtml</c> block. The name was simply wrong.
    /// <para>It stays absent anyway, which is now a choice rather than a limit: <c>DeclarationText</c> is the
    /// documented path, it already works, and every other write here goes through it. Carrying the declaration
    /// twice would give two sources of truth for one string.</para></para></summary>
    public static XDocument WriteProject(string pouName, NetworkBody body, string? declaration = null)
    {
        // ALWAYS a program. This document is never the engineer's object - it builds a SCRATCH POU whose only
        // purpose is to make TwinCAT resolve the body, after which the archive is copied off it and the scratch
        // is deleted. A method's body resolves in a program exactly as well, because the importer resolves no
        // names at all: it records topology, and the compiler binds names later against whichever scope the
        // archive ends up in.
        var pou = new XElement(Namespaces.Tc6 + "pou",
            new XAttribute("name", pouName),
            new XAttribute("pouType", "program"),
            new XElement(Namespaces.Tc6 + "interface"),
            new XElement(Namespaces.Tc6 + "body", WriteBody(body, declaration)));

        return new XDocument(
            new XDeclaration("1.0", "utf-8", null),
            new XElement(Namespaces.Tc6 + "project",
                new XElement(Namespaces.Tc6 + "fileHeader",
                    new XAttribute("companyName", "Beckhoff Automation GmbH"),
                    new XAttribute("productName", "TwinCAT PLC Control"),
                    new XAttribute("productVersion", "3.5.13.21"),
                    new XAttribute("creationDateTime", "1970-01-01T00:00:00")),
                new XElement(Namespaces.Tc6 + "contentHeader",
                    new XAttribute("name", pouName),
                    new XElement(Namespaces.Tc6 + "coordinateInfo",
                        new XElement(Namespaces.Tc6 + "fbd", Scaling()),
                        new XElement(Namespaces.Tc6 + "ld", Scaling()),
                        new XElement(Namespaces.Tc6 + "sfc", Scaling()))),
                new XElement(Namespaces.Tc6 + "types",
                    new XElement(Namespaces.Tc6 + "dataTypes"),
                    new XElement(Namespaces.Tc6 + "pous", pou)),
                new XElement(Namespaces.Tc6 + "instances", new XElement(Namespaces.Tc6 + "configurations"))));

        XElement Scaling() => new XElement(Namespaces.Tc6 + "scaling", new XAttribute("x", "1"), new XAttribute("y", "1"));
    }

    private static NotSupportedException Refuse(string what) =>
        new NotSupportedException(
            $"TwinCAT: this graphical body {what}, which Volt cannot express as PLCopen. Create it in the IDE " +
            "and pull it.");

    /// <summary>One network's emission. Holds the id counter and the wire table, because both are per-network:
    /// a <see cref="Demux"/> id is only meaningful inside the network that defines it.</summary>
    private sealed class NetworkWriter
    {
        private readonly XElement _root;
        private long _next;
        private readonly Dictionary<int, long> _wires = new();
        private readonly Dictionary<int, int> _consumers = new();
        private readonly string? _declaration;

        public NetworkWriter(XElement root, int order, string? declaration)
        {
            _root = root;
            _next = 10_000_000_000L * (order + 1);
            _declaration = declaration;
        }

        private long Id() => _next++;

        private static XElement Position() =>
            new XElement(Namespaces.Tc6 + "position", new XAttribute("x", "0"), new XAttribute("y", "0"));

        /// <summary>The vendor writes this marker element first in every FBD body; it declares that input pins
        /// may carry flags. Reproduced verbatim so an import looks like an export.</summary>
        public void EmitAttributeMarker() =>
            _root.Add(new XElement(Namespaces.Tc6 + "vendorElement",
                new XAttribute("localId", Id().ToString()),
                Position(),
                new XElement(Namespaces.Tc6 + "alternativeText",
                    new XElement(Namespaces.Xhtml + "xhtml",
                        "FBD Implementation Attributes")),
                new XElement(Namespaces.Tc6 + "addData",
                    new XElement(Namespaces.Tc6 + "data",
                        new XAttribute("name",
                            Namespaces.PlcOpenExt + "fbd/implementationattributes"),
                        new XAttribute("handleUnknown", "implementation"),
                        new XElement("fbdattributes",
                            new XElement("attribute",
                                new XAttribute("name", "BoxInputFlagsSupported"),
                                new XAttribute("value", "true")))))));

        /// <summary>Emit a tree and answer the localId that PRODUCES its value, so a consumer can wire to it.
        /// An <see cref="Assign"/> produces nothing and answers null.</summary>
        public long? Emit(Node node) => node switch
        {
            Leaf leaf => EmitLeaf(leaf),
            Box box => EmitBox(box),
            Assign assign => EmitAssign(assign),
            Demux demux => EmitDemux(demux),
            Parallel => throw Refuse("contains a ladder parallel branch"),
            Terminator => throw Refuse("contains a ladder rung terminator"),
            _ => throw Refuse($"contains a {node.GetType().Name}"),
        };

        private long EmitLeaf(Leaf leaf)
        {
            var id = Id();
            _root.Add(new XElement(Namespaces.Tc6 + "inVariable",
                new XAttribute("localId", id.ToString()),
                Position(),
                new XElement(Namespaces.Tc6 + "connectionPointOut"),
                new XElement(Namespaces.Tc6 + "expression", leaf.Operand.Text)));
            return id;
        }

        /// <summary>The TYPE the block calls — which is NOT always what the model's <c>Box.Type</c> holds.
        ///
        /// <para>Network text names a function-block call by its INSTANCE (<c>t1(IN := a)</c>), so a text-derived
        /// model arrives with <c>Type == Instance.Text == "t1"</c>. Emitting that as PLCopen's
        /// <c>typeName</c> told the importer to call a block called <c>t1</c>, which is the instance, not the
        /// type — the POU imported and would not compile, and nothing at the wire showed it because both vendors
        /// RENDER the call by its instance name, so the pulled text was byte-identical either way.</para>
        ///
        /// <para>Resolved from the POU's own declaration, which is the only place the type is written down. This
        /// is CODESYS's rule, member for member, including its refusal: an undeclared instance means Volt cannot
        /// tell the IDE which type to call, and guessing would produce exactly the uncompilable POU above.</para></summary>
        private string TypeNameOf(Box box)
        {
            if (box.Kind != CallKind.FunctionBlock || box.Instance is not { } inst) return box.Type;
            if (!string.Equals(box.Type, inst.Text, StringComparison.OrdinalIgnoreCase)) return box.Type;

            return Volt.Engine.Format.St.StDeclaration.TypeOfVariable(_declaration, inst.Text)
                ?? throw new NotSupportedException(
                       $"TwinCAT: the call '{inst.Text}' names a function-block instance that is not declared in " +
                       "this POU, so Volt cannot tell the IDE which TYPE the box calls. Declare it, or edit this " +
                       "network in the IDE.");
        }

        private long EmitBox(Box box)
        {
            // A WIRED ENABLE IS REFUSED — and the reason is measured, not assumed.
            //
            // The old refusal said an enable "cannot be expressed as PLCopen", which is false: the vendor's own
            // export writes it as an ordinary input variable named EN, wired by refLocalId like any
            // other. So it was emitted that way and MEASURED end to end on
            // a live XAE (2026-08-31). The importer accepts the document and does NOT honour the pin:
            //
            //     pushed:  LET en1 := go;  IF en1 THEN out := (a AND b); END_IF
            //     back:    out := (go AND a AND b);
            //
            // The enable was absorbed as a THIRD ORDINARY INPUT of the AND. On an AND that is coincidentally
            // equivalent; on any other box it silently changes what the program does, which is worse than the
            // refusal it replaced. Nor can the following `Stamp` repair it: the box now has one input more than
            // the model, and the in-place writer refuses a shape change — correctly.
            //
            // So this stays refused, the divergence with CODESYS (which builds an enable natively) is FORCED by
            // the importer rather than by the format, and the message now says which.
            // NOT `Refuse(...)`: that helper ends every message with "which Volt cannot express as PLCopen",
            // and that is precisely the claim this measurement disproves.
            if (box.Enable != null)
                throw new NotSupportedException(
                    "TwinCAT: this graphical body wires a box's EN input. PLCopen can state it — the vendor's own " +
                    "export does — but TwinCAT's importer does NOT honour it: measured live, an enable comes back " +
                    "folded into the box as an ordinary input, so `IF en THEN out := (a AND b)` became " +
                    "`out := (en AND a AND b)`. Creating it would silently change what the program does. Draw the " +
                    "enable in the IDE and pull it.");
            if (box.StCode != null) throw Refuse("contains an Execute box");
            var wired = box.Inputs.Select(i => (Input: i, From: Emit(i.Value))).ToList();

            var id = Id();
            var block = new XElement(Namespaces.Tc6 + "block",
                new XAttribute("localId", id.ToString()),
                new XAttribute("typeName", TypeNameOf(box)),
                Position());
            if (box.Instance is { } instance)
                block.SetAttributeValue("instanceName", instance.Text);

            var inputs = new XElement(Namespaces.Tc6 + "inputVariables");

            for (int i = 0; i < wired.Count; i++)
            {
                var (input, from) = wired[i];
                if (from is not { } producer) throw Refuse("wires a box input to a statement");
                inputs.Add(new XElement(Namespaces.Tc6 + "variable",
                    // An operator carries no formal names, and the vendor's exporter numbers the pins - In1,
                    // In2 - rather than leaving them unnamed. A real call HAS names and they are used as given.
                    new XAttribute("formalParameter", input.Formal ?? "In" + (i + 1)),
                    new XElement(Namespaces.Tc6 + "connectionPointIn",
                        new XElement(Namespaces.Tc6 + "connection",
                            new XAttribute("refLocalId", producer.ToString())))));
            }

            // ONE output pin, named `Out1` - the name the vendor's own exporter gives an operator's single
            // output. It is not taken from `box.Outputs`: those are the operands WIRED to the pin, not the
            // pin's formal name, and network text carries neither (a text-derived `Box.Outputs` is always
            // empty). A box with several distinct named outputs has no network-text form at all, so the model
            // cannot present one here.
            var outputs = new XElement(Namespaces.Tc6 + "outputVariables",
                new XElement(Namespaces.Tc6 + "variable",
                    new XAttribute("formalParameter", "Out1"),
                    new XElement(Namespaces.Tc6 + "connectionPointOut")));

            block.Add(inputs, new XElement(Namespaces.Tc6 + "inOutVariables"), outputs,
                new XElement(Namespaces.Tc6 + "addData",
                    new XElement(Namespaces.Tc6 + "data",
                        new XAttribute("name", Namespaces.PlcOpenExt + "fbdcalltype"),
                        new XAttribute("handleUnknown", "implementation"),
                        new XElement("CallType", CallTypeName(box.Kind)))));
            _root.Add(block);
            return id;
        }

        private static string CallTypeName(CallKind kind) => kind switch
        {
            CallKind.Operator => "operator",
            CallKind.Function => "function",
            CallKind.FunctionBlock => "functionblock",
            _ => throw Refuse($"uses call kind {kind}"),
        };

        private long? EmitAssign(Assign assign)
        {
            // Jump and Return first, because they deserve their own words. Then EVERY REMAINING BIT - Set,
            // Reset, Negated, Rising, Falling - because an assignment carries its own modifiers and dropping
            // one turns a SET coil into a plain one on a push that reports success. The vendor really does put
            // them here: measured on a real ladder, a target came back Flags=Negation,Set.
            if (assign.Flags.Jump) return EmitJump(assign);
            if (assign.Flags.Return) return EmitReturn(assign);
            if (assign.Value is not { } value) throw Refuse("assigns nothing");

            var producer = Emit(value) ?? throw Refuse("assigns from a statement");
            foreach (var target in assign.Targets)
            {
                _root.Add(new XElement(Namespaces.Tc6 + "outVariable",
                    new XAttribute("localId", Id().ToString()),
                    Position(),
                    new XElement(Namespaces.Tc6 + "connectionPointIn",
                        new XElement(Namespaces.Tc6 + "connection",
                            new XAttribute("refLocalId", producer.ToString()))),
                    new XElement(Namespaces.Tc6 + "expression", target.Text)));
            }
            return null;
        }

        /// <summary>A JUMP — TC6's own <c>&lt;jump&gt;</c> element, carrying the destination network's label.
        ///
        /// <para>The model spells a jump as an <see cref="Assign"/> with <c>Flags.Jump</c>: the TARGET is the
        /// destination LABEL (not an l-value) and the value is the optional condition, which is why this cannot
        /// go through the ordinary assignment arm — emitting an <c>outVariable</c> named <c>Done</c> would land a
        /// real assignment to an undeclared symbol and stop the POU compiling.</para>
        ///
        /// <para>The label itself is not written here. It belongs to the DESTINATION network
        /// (<c>Network.Label</c>), which the archive writer sets after the import.</para></summary>
        /// <summary>A RETURN — `<return>`, which is `<jump>` without the label, and wired to its condition
        /// the same way.
        ///
        /// <para>This was refused as "contains a return, which Volt cannot express as PLCopen" — and that
        /// was never measured, only assumed. `<return>` is a TC6 element sitting beside `<jump>` in the same
        /// content model, and Volt was already emitting jumps successfully, so the claim did not survive the
        /// first look. CODESYS round-trips a conditional return exactly; TwinCAT refused to create one, which
        /// made a shape one vendor supports unreachable on the other for no reason either could point at.
        ///
        /// <para>The importer's behaviour IS the test (D22 is a standing reminder that documented PLCopen
        /// properties are wrong on this install): if it ever stops honouring this, the round-trip in
        /// `test/e2e/graphical/labels.test.ts` fails rather than a comment going stale.</para></summary>
        /// <summary>Nothing drives this item — no value at all, or the unconnected terminator the reader
        /// builds for a bare `JMP name;` / `RETURN;`.</summary>
        private static bool Unconditional(Node? value) => value is null or Terminator { Input: null };

        private long? EmitReturn(Assign ret)
        {
            var el = new XElement(Namespaces.Tc6 + "return",
                new XAttribute("localId", Id().ToString()),
                Position());

            // A CONDITIONAL return is wired to its condition. An unconnected TERMINATOR is how the model
            // spells "nothing drives this", so it means unconditional — and an unconditional one cannot be
            // IMPORTED here, which is measured rather than assumed: the identical document with a
            // `connectionPointIn` imports fine and round-trips, and without one TwinCAT rejects the whole
            // scratch object with `Value cannot be null. Parameter name: source`. The presence of the
            // connection is the only difference between the two, so the importer wants a jump or return
            // WIRED. Refusing says that; letting the vendor's null-reference reach the engineer does not.
            if (Unconditional(ret.Value)) throw Refuse("contains an unconditional return, which this"
                + " TwinCAT's PLCopen importer rejects (it requires a return to be wired to a condition)");

            if (ret.Value is { } condition)
            {
                var producer = Emit(condition) ?? throw Refuse("returns on a statement");
                el.Add(new XElement(Namespaces.Tc6 + "connectionPointIn",
                    new XElement(Namespaces.Tc6 + "connection",
                        new XAttribute("refLocalId", producer.ToString()))));
            }

            _root.Add(el);
            return null;      // a return produces no value for anything to consume
        }

        private long? EmitJump(Assign jump)
        {
            if (jump.Targets.Count != 1)
                throw Refuse($"has a jump with {jump.Targets.Count} destinations");

            var el = new XElement(Namespaces.Tc6 + "jump",
                new XAttribute("localId", Id().ToString()),
                new XAttribute("label", jump.Targets[0].Text),
                Position());

            // Same rule as the return above, and the same measurement: an unconditional jump is rejected by
            // the importer, a wired one imports and round-trips.
            if (Unconditional(jump.Value)) throw Refuse("contains an unconditional jump, which this"
                + " TwinCAT's PLCopen importer rejects (it requires a jump to be wired to a condition)");

            if (jump.Value is { } condition)
            {
                var producer = Emit(condition) ?? throw Refuse("jumps on a statement");
                el.Add(new XElement(Namespaces.Tc6 + "connectionPointIn",
                    new XElement(Namespaces.Tc6 + "connection",
                        new XAttribute("refLocalId", producer.ToString()))));
            }

            _root.Add(el);
            return null;      // a jump produces no value for anything to consume
        }

        /// <summary>How many places REFERENCE each wire in this network. Counted before emitting, because
        /// what PLCopen can say about a wire depends on it (see <see cref="EmitDemux"/>).</summary>
        public void CountWireConsumers(Network network)
        {
            foreach (var tree in network.Trees) Count(tree);

            void Count(Node? n)
            {
                switch (n)
                {
                    case null: break;
                    case Demux d when d.Input is null:
                        _consumers[d.VarId] = _consumers.TryGetValue(d.VarId, out var c) ? c + 1 : 1;
                        break;
                    case Demux d: Count(d.Input); break;
                    case Assign a: Count(a.Value); break;
                    case Terminator t: Count(t.Input); break;
                    case Parallel p:
                        Count(p.Input);
                        foreach (var b in p.Branches) Count(b);
                        break;
                    case Box b:
                        Count(b.Enable);
                        foreach (var i in b.Inputs) Count(i.Value);
                        break;
                }
            }
        }

        /// <summary>Fan-out. The DEFINITION emits its producer once and remembers the id; every REFERENCE
        /// answers that same id, so several consumers share one <c>refLocalId</c> - which is exactly how
        /// PLCopen spells a wire feeding more than one place, and why nothing needs duplicating.
        ///
        /// <para><b>A wire feeding ONE place is refused, and that is the interesting case.</b> PLCopen has no
        /// element for a branch point: a wire is spelled by consumers SHARING a `refLocalId`, so with two
        /// consumers the importer rebuilds the `BoxTreeDemux`, and with one there is nothing to distinguish
        /// it from an ordinary direct connection. It came back collapsed - `LET g0 := (a AND b); out := g0;`
        /// imported as `out := (a AND b);` - with the push ACCEPTED and the branch point gone from the
        /// drawing. That is the one outcome this file exists to prevent, and it was the last silent one
        /// left: a body Volt cannot express must be refused, never quietly reshaped.
        ///
        /// <para>The cost is small and the boundary is exact. This is the CREATE path (PLCopen import is
        /// TwinCAT's only route to a body it does not have); editing an existing body goes through
        /// `TcNetworkWriter`, which writes `VarId` straight into the archive and keeps single-consumer wires
        /// perfectly well. So a pulled TwinCAT body still round-trips - only CREATING one from text that
        /// carries a branch point the format cannot spell is refused, with the same "create it in the IDE and
        /// pull it" answer the terminator and parallel arms already give.</para></summary>
        private long EmitDemux(Demux demux)
        {
            if (demux.Input is { } input)
            {
                if (!_consumers.TryGetValue(demux.VarId, out var consumers) || consumers < 2)
                    throw Refuse(
                        $"contains a branch point (wire {demux.VarId}) feeding only one place, which PLCopen "
                        + "cannot express - it would import as a plain connection and the branch would be gone");

                var id = Emit(input) ?? throw Refuse("defines a wire from a statement");
                _wires[demux.VarId] = id;
                return id;
            }
            return _wires.TryGetValue(demux.VarId, out var known)
                ? known
                : throw Refuse($"references wire {demux.VarId} before it is defined");
        }

    }
}
