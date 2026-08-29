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
    private static XElement WriteBody(NetworkBody body)
    {
        var root = new XElement(Namespaces.Tc6 + (body.Language == BodyLanguage.Ld ? "LD" : "FBD"));
        foreach (var network in body.Networks)
        {
            var w = new NetworkWriter(root, network.Order);
            w.EmitAttributeMarker();
            foreach (var tree in network.Trees) w.Emit(tree);
        }
        return root;
    }

    /// <summary>A complete PLCopen document for <c>PlcOpenImport</c>: the envelope and the lowered body.
    ///
    /// <para><b>The DECLARATION is deliberately absent.</b> A first version carried it as a 3S
    /// <c>declaration</c> <c>addData</c> block, and measured live the importer ignored it outright — the POU
    /// arrived holding nothing but <c>PROGRAM &lt;name&gt;</c>, its VAR block gone. The vendor's own export
    /// agrees and is the tell: it writes <c>&lt;interface /&gt;</c>, EMPTY, for a POU that has declared
    /// variables. Declarations do not travel in PLCopen on this install. So the interface is left empty exactly
    /// as the vendor leaves it, and the caller writes the declaration through <c>DeclarationText</c> afterwards
    /// — the documented path, which works. Emitting a block the importer discards would only make the loss
    /// look like a bug somewhere else.</para></summary>
    public static XDocument WriteProject(string pouName, string pouType, NetworkBody body)
    {
        var pou = new XElement(Namespaces.Tc6 + "pou",
            new XAttribute("name", pouName),
            new XAttribute("pouType", pouType),
            new XElement(Namespaces.Tc6 + "interface"),
            new XElement(Namespaces.Tc6 + "body", WriteBody(body)));

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
        private readonly long _base;
        private long _next;
        private readonly Dictionary<int, long> _wires = new();

        public NetworkWriter(XElement root, int order)
        {
            _root = root;
            _base = 10_000_000_000L * (order + 1);
            _next = _base;
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
            NoFlags(leaf.Operand.Flags, "an operand");
            NoFlags(leaf.Flags, "an operand");
            var id = Id();
            _root.Add(new XElement(Namespaces.Tc6 + "inVariable",
                new XAttribute("localId", id.ToString()),
                Position(),
                new XElement(Namespaces.Tc6 + "connectionPointOut"),
                new XElement(Namespaces.Tc6 + "expression", leaf.Operand.Text)));
            return id;
        }

        private long EmitBox(Box box)
        {
            if (box.Enable != null) throw Refuse("wires a box's EN input");
            if (box.StCode != null) throw Refuse("contains an Execute box");
            NoFlags(box.Flags, "a box");

            // Inputs are emitted BEFORE the block, so their ids exist to be referenced - and so the document
            // order matches the vendor's own export, which is producer-before-consumer throughout.
            var wired = box.Inputs.Select(i => (Input: i, From: Emit(i.Value))).ToList();

            var id = Id();
            var block = new XElement(Namespaces.Tc6 + "block",
                new XAttribute("localId", id.ToString()),
                new XAttribute("typeName", box.Type),
                Position());
            if (box.Instance is { } instance)
                block.SetAttributeValue("instanceName", instance.Text);

            var inputs = new XElement(Namespaces.Tc6 + "inputVariables");
            for (int i = 0; i < wired.Count; i++)
            {
                var (input, from) = wired[i];
                NoFlags(input.Flags, "a box input pin");
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
            if (assign.Flags.Jump) throw Refuse("contains a jump");
            if (assign.Flags.Return) throw Refuse("contains a return");
            if (assign.Value is not { } value) throw Refuse("assigns nothing");

            var producer = Emit(value) ?? throw Refuse("assigns from a statement");
            foreach (var target in assign.Targets)
            {
                NoFlags(target.Flags, "an assignment target");
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

        /// <summary>Fan-out. The DEFINITION emits its producer once and remembers the id; every REFERENCE
        /// answers that same id, so several consumers share one <c>refLocalId</c> - which is exactly how PLCopen
        /// spells a wire feeding more than one place, and why nothing needs duplicating.</summary>
        private long EmitDemux(Demux demux)
        {
            if (demux.Input is { } input)
            {
                var id = Emit(input) ?? throw Refuse("defines a wire from a statement");
                _wires[demux.VarId] = id;
                return id;
            }
            return _wires.TryGetValue(demux.VarId, out var known)
                ? known
                : throw Refuse($"references wire {demux.VarId} before it is defined");
        }

        /// <summary>Modifiers have no PLCopen form in this lowering, and a dropped one silently changes what the
        /// program DOES - a negated contact that stops being negated is a live bug. So they are refused.</summary>
        private static void NoFlags(Flags? flags, string where)
        {
            if (flags is null || flags.IsNone) return;
            throw Refuse($"puts a modifier on {where}");
        }
    }
}
