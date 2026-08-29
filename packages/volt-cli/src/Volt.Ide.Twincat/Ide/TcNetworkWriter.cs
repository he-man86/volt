using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Network;
// `Parallel` is also System.Threading.Tasks.Parallel; this file means the LD branch.
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Ide.Twincat;

/// <summary>
/// Writes a <see cref="NetworkBody"/> back into a TwinCAT <c>&lt;NWL&gt;</c> archive.
///
/// <para><b>This writer creates nothing.</b> Not an element, not a member, not a list entry. It walks the
/// vendor's own document alongside the pushed model and assigns to members that are ALREADY THERE; anything
/// else is refused. That one rule is the whole design, and it is here because the version that built elements
/// from a template wrote twenty <c>.TcPOU</c> files TwinCAT could not open
/// (<c>Value cannot be null. Parameter name: iILStatement</c>).</para>
///
/// <para><b>Why building cannot work here.</b> The archive is a strict typed object-graph serialization: the
/// reader consumes members in order for the type it was told to expect, so a member set that is close but not
/// exact makes it mis-assign everything after the discrepancy. And the contract is deep — a real
/// <c>BoxTreeBox</c> carries <c>InputParam</c>, <c>OutputParam</c>, <c>CallType</c>, <c>EN</c>, <c>ENO</c>,
/// <c>STSnippet</c>, <c>ContainsExtensibleInputs</c>, <c>ProvidesSTSnippet</c> and an <c>Id</c>, most of which
/// are results of the IDE RESOLVING the call. Volt does not resolve calls; the IDE does. Synthesizing those
/// members means guessing at a compiler's output, which is the class of guess that produced unopenable files.
/// </para>
///
/// <para>So the capability is deliberately narrow and provable: <b>edit the VALUES of an existing graphical
/// body</b> — rename an operand, retype it, change a comment or a title, negate a contact, disable a network.
/// Adding or removing a rung, a box or an input is done in the IDE and pulled. Each refusal below names the
/// exact shape change it saw.</para>
/// </summary>
internal static class TcNetworkWriter
{
    /// <summary>Apply the model to the archive and return the new <c>&lt;NWL&gt;</c> body XML, or null when
    /// nothing changed.
    /// <para>The parse keeps whitespace and the serialization adds none, so an untouched document comes back
    /// byte-identical — and an unchanged model does not come back at all. Those two together are what make a
    /// push non-destructive: every id, every <c>Fixed</c>, every <c>ILLines</c> entry and every member Volt
    /// does not model survives exactly as the IDE wrote it.</para></summary>
    public static string? Apply(string? bodyXml, NetworkBody body)
    {
        // No archive to edit means there is nothing to edit IN, and creating one is the construction this
        // writer does not do. A newly created POU arrives here with an empty implementation, so this is the
        // path a push of a brand-new graphical body takes - it has to say that, not throw an XML parse error.
        if (string.IsNullOrWhiteSpace(bodyXml))
            throw Refuse("creates a graphical body where the IDE has none");

        XElement doc;
        try { doc = XElement.Parse(bodyXml, LoadOptions.PreserveWhitespace); }
        catch (System.Xml.XmlException) { throw Refuse("replaces a textual body with a graphical one"); }

        var impl = doc.Descendants("o").FirstOrDefault(o => (string?)o.Attribute("t") == "NWLImplementationObject")
            ?? throw Refuse("replaces a " + doc.Name.LocalName + " body with a graphical one");

        var networks = TcArchive.List(impl, "NetworkList");
        if (networks.Count != body.Networks.Count)
            throw Refuse($"the number of networks changes ({networks.Count} -> {body.Networks.Count})");

        bool changed = false;
        for (int i = 0; i < networks.Count; i++)
            changed |= WriteNetwork(networks[i], body.Networks[i]);

        return changed ? doc.ToString(SaveOptions.DisableFormatting) : null;
    }

    private static NotSupportedException Refuse(string what) =>
        new NotSupportedException(
            $"TwinCAT: this push {what}, which Volt cannot do through the archive. It edits the VALUES of an " +
            "existing graphical body - operands, types, comments, titles, flags - and never builds archive " +
            "elements, because the IDE's own reader depends on a member contract only the IDE produces. " +
            "Make this change in the IDE and pull it.");

    // -- networks ----------------------------------------------------------------------------------

    private static bool WriteNetwork(XElement net, Network model)
    {
        bool changed = SetString(net, "Title", model.Title)
                     | SetString(net, "Label", model.Label)
                     | SetString(net, "Comment", model.Comment)
                     | SetBool(net, "OutCommented", model.Disabled);

        var items = TcArchive.List(net, "NetworkItems");
        if (items.Count != model.Trees.Count)
            throw Refuse($"network {model.Order + 1} changes from {items.Count} to {model.Trees.Count} item(s)");

        for (int i = 0; i < items.Count; i++)
            changed |= WriteNode(items[i], model.Trees[i]);
        return changed;
    }

    // -- the tree ----------------------------------------------------------------------------------

    /// <summary>Walk one archive item against one model node. The node KIND must still match what the IDE
    /// wrote — a leaf that became a box is a different object with a different member set, not an edit.</summary>
    private static bool WriteNode(XElement e, Node n)
    {
        var type = TcArchive.TypeOf(e);
        var changed = WriteFlags(e, n.Flags);

        switch (n)
        {
            case Leaf l when type == "BoxTreeOperand":
                return changed | WriteOperand(e, "Operand", l.Operand);

            case Assign a when type == "BoxTreeAssign":
                return changed
                     | WriteChild(e, "RValue", a.Value)
                     | WriteOutputs(e, a.Targets);

            case Box b when type == "BoxTreeBox":
            {
                // The box TYPE is not an editable value: it is what the IDE resolved `CallType`, `InputParam`
                // and `OutputParam` from, and changing it without redoing that resolution leaves an archive
                // describing one call with another call's signature.
                var was = TcArchive.Str(e, "BoxType") ?? "";
                if (was != b.Type)
                    throw Refuse($"a box changes from '{was}' to '{b.Type}'");

                changed |= WriteOperand(e, "Instance", b.Instance);
                changed |= WriteOutputs(e, b.Outputs);
                changed |= WriteChild(e, "En", b.Enable);

                var inputs = TcArchive.List(e, "InputItems");
                if (inputs.Count != b.Inputs.Count)
                    throw Refuse($"box '{b.Type}' changes from {inputs.Count} to {b.Inputs.Count} input(s)");
                for (int i = 0; i < inputs.Count; i++)
                    changed |= WriteNode(inputs[i], b.Inputs[i].Value);
                return changed;
            }

            case Demux d when type == "BoxTreeDemux":
                return changed
                     | SetInt(e, "VarId", d.VarId)
                     | WriteChild(e, "Input", d.Input);

            case Parallel p when type == "BoxTreeParallel":
            {
                changed |= SetString(e, "Mode", p.Mode == ParallelMode.And ? "And" : "Or");
                changed |= WriteChild(e, "Input", p.Input);
                var branches = TcArchive.List(e, "Trees");
                if (branches.Count != p.Branches.Count)
                    throw Refuse($"a branch changes from {branches.Count} to {p.Branches.Count} path(s)");
                for (int i = 0; i < branches.Count; i++)
                    changed |= WriteNode(branches[i], p.Branches[i]);
                return changed;
            }

            case Terminator t when type == "BoxTreeTerminator":
                return changed | WriteChild(e, "Input", t.Input);

            default:
                throw Refuse($"a '{type ?? "?"}' item becomes a {n.GetType().Name.ToLowerInvariant()}");
        }
    }

    /// <summary>A nested node member (<c>RValue</c>, <c>En</c>, <c>Input</c>). Present-vs-absent must match:
    /// the archive spells "absent" as an explicit null member, and turning one into an object is
    /// construction.</summary>
    private static bool WriteChild(XElement owner, string name, Node? node)
    {
        var child = TcArchive.Obj(owner, name);
        if (child == null)
            return node == null ? false : throw Refuse($"a '{name}' input appears where the IDE wrote none");
        if (node == null)
            throw Refuse($"the '{name}' input of an item is removed");
        return WriteNode(child, node);
    }

    /// <summary>Outputs sit one level deeper than in the live model: an <c>OutputItems</c> member of type
    /// <c>OutputItemList</c>, itself holding an <c>OutputItems</c> list.</summary>
    private static bool WriteOutputs(XElement e, IReadOnlyList<Operand> targets)
    {
        var holder = TcArchive.Obj(e, "OutputItems");
        var items = TcArchive.List(holder, "OutputItems");
        if (items.Count != targets.Count)
            throw Refuse($"an item changes from {items.Count} to {targets.Count} output(s)");

        bool changed = false;
        for (int i = 0; i < items.Count; i++)
            changed |= WriteOperandInto(items[i], targets[i]);
        return changed;
    }

    private static bool WriteOperand(XElement owner, string name, Operand? op)
    {
        var o = TcArchive.Obj(owner, name);
        if (o == null)
            return op == null || op.Text.Length == 0
                ? false
                : throw Refuse($"an operand appears in '{name}', where the IDE wrote none");
        return op == null ? false : WriteOperandInto(o, op);
    }

    private static bool WriteOperandInto(XElement o, Operand op) =>
        SetString(o, "Operand", op.Text)
      | SetString(o, "Type", op.Type)
      | SetString(o, "SymbolComment", op.Comment)
      | SetBool(o, "LValue", op.IsLValue)
      | SetBool(o, "IsInstance", op.IsInstance)
      | WriteFlags(o, op.Flags);

    /// <summary>Volt's flags as the vendor's bit-field, written into the <c>Flags</c> object the IDE already
    /// put there. A <c>BoxTreeOperand</c> has NO such member — its flags live on the operand it holds — so a
    /// leaf whose flags changed is refused here rather than growing a member the vendor never writes.</summary>
    private static bool WriteFlags(XElement owner, Flags? flags)
    {
        var bits = Bits(flags);
        var holder = TcArchive.Obj(owner, "Flags");
        if (holder == null)
            return bits == 0 ? false : throw Refuse("a modifier appears on an item that carries none");
        return SetInt(holder, "Flags", bits);
    }

    /// <summary><c>Reset</c> is REFUSED rather than dropped: network text can express a reset coil and the
    /// vendor's flag set (Negation/Set/Jump/Return/Rtrig/Ftrig) cannot, so writing a plain coil instead would
    /// change what the program does.</summary>
    private static int Bits(Flags? flags)
    {
        if (flags is not { } f || f.IsNone) return 0;
        if (f.Reset)
            throw new NotSupportedException(
                "TwinCAT: a RESET modifier has no representation in the IDE's flag set. Refusing rather than " +
                "writing a plain coil, which would change what the program does.");
        int bits = 0;
        if (f.Negated) bits |= TcArchive.FlagNegation;
        if (f.Set) bits |= TcArchive.FlagSet;
        if (f.Jump) bits |= TcArchive.FlagJump;
        if (f.Return) bits |= TcArchive.FlagReturn;
        if (f.Rising) bits |= TcArchive.FlagRtrig;
        if (f.Falling) bits |= TcArchive.FlagFtrig;
        return bits;
    }

    // -- the only mutation in this file --------------------------------------------------------------

    /// <summary>Assign to a scalar member THAT EXISTS. Every write in this file goes through here, so "the
    /// writer never adds a member" is a property of one function rather than a convention twenty call sites
    /// have to remember. A missing member is a refusal, never an insertion.</summary>
    private static bool Set(XElement owner, string name, string raw, string current)
    {
        if (current == raw) return false;
        var v = owner.Elements("v").FirstOrDefault(x => (string?)x.Attribute("n") == name);
        if (v == null)
            throw Refuse($"'{name}' would have to be added to a '{TcArchive.TypeOf(owner) ?? "?"}', " +
                         "and the IDE did not write it there");
        v.Value = raw;
        return true;
    }

    private static bool SetString(XElement owner, string name, string? text) =>
        Set(owner, name, "\"" + (text ?? "") + "\"", "\"" + (TcArchive.Str(owner, name) ?? "") + "\"");

    private static bool SetBool(XElement owner, string name, bool b) =>
        Set(owner, name, b ? "true" : "false", TcArchive.Bool(owner, name) ? "true" : "false");

    private static bool SetInt(XElement owner, string name, int i) =>
        Set(owner, name, i.ToString(CultureInfo.InvariantCulture),
            TcArchive.Int(owner, name).ToString(CultureInfo.InvariantCulture));
}
