using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Network;
// `Parallel` is also System.Threading.Tasks.Parallel; this file means the LD branch.
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Cli.Ide.Twincat;

/// <summary>
/// Writes a <see cref="NetworkBody"/> back into a TwinCAT <c>&lt;NWL&gt;</c> archive.
///
/// <para><b>Only what changed is rewritten.</b> The archive is edited IN PLACE, so every part of the document
/// the engineer did not touch — <c>Id</c>s, <c>FBDValid</c>, <c>ILLines</c>, <c>Address</c>, <c>Fixed</c>,
/// and any member Volt does not model — survives byte-for-byte. A network whose rendered text is unchanged is
/// not written at all. This is the property the PLCopen transport could not have: it regenerated the whole
/// body from a projection every time, which is why it needed a carry rule to put back what regeneration had
/// destroyed.</para>
/// </summary>
internal static class TcNetworkWriter
{
    /// <summary>Apply the model to the archive and return the new <c>&lt;NWL&gt;</c> body XML, or null when
    /// nothing changed.</summary>
    public static string? Apply(string bodyXml, NetworkBody body)
    {
        // ── REFUSED. This wrote unreadable .TcPOU files into a real project. ──────────────────────
        //
        // TwinCAT could not open twenty POUs afterwards:
        //     Reading file failed. Value cannot be null. Parameter name: iILStatement
        //
        // The archive is a STRICT typed object-graph serialization with a per-type member contract, and this
        // writer INFERRED that contract from the shapes it happened to need instead of measuring it. Against a
        // vendor-written body the differences are plain: every item and operand carries a `<v n="Id">` and mine
        // carried none; a box writes an explicit `<n n="InputFlags" />` null member and mine omitted it; a
        // `BoxTreeOperand` has NO Flags member and mine added one; a box always writes its `Instance` member
        // even when empty. Get the member set wrong and the reader mis-assigns what follows — which is how a
        // missing IL-line list surfaced as a null `iILStatement`.
        //
        // Reading is unaffected and stays: it only asks for members it finds.
        //
        // THE GATE THIS NEEDED, and the one to satisfy before re-enabling it: read a vendor-written archive and
        // write it back BYTE-IDENTICAL, for every fixture, before editing a single value. An adapter that
        // cannot reproduce what the vendor wrote has no business writing something new. That gate is cheap,
        // it is offline, and it would have caught this before it touched a project.
        throw new NotSupportedException(
            "TwinCAT: writing a graphical body is disabled. Volt's archive writer produced .TcPOU files the " +
            "IDE could not read (\"Value cannot be null. Parameter name: iILStatement\"), because it builds " +
            "archive elements from an inferred member contract rather than a measured one. Edit graphical " +
            "bodies in the IDE and pull; textual bodies are unaffected.");
    }

    /// <summary>Unreachable until the writer is re-enabled; kept because the SHAPE of the edit is right — it is
    /// the per-element member set that is wrong.</summary>
    private static string? ApplyDisabled(string bodyXml, NetworkBody body)
    {
        var doc = XElement.Parse(bodyXml);
        var impl = doc.Descendants("o").FirstOrDefault(o => (string?)o.Attribute("t") == "NWLImplementationObject")
            ?? throw new InvalidOperationException(
                "TwinCAT: the body is not an NWL archive - refusing to write a graphical body into it");

        var networks = TcArchive.List(impl, "NetworkList");
        if (networks.Count != body.Networks.Count)
            throw new NotSupportedException(
                $"TwinCAT: this push changes the NUMBER of networks ({networks.Count} -> " +
                $"{body.Networks.Count}), which Volt cannot yet do through the archive.");

        bool changed = false;
        for (int i = 0; i < networks.Count; i++)
            changed |= WriteNetwork(networks[i], body.Networks[i]);

        return changed ? doc.ToString(SaveOptions.DisableFormatting) : null;
    }

    private static bool WriteNetwork(XElement net, Network model)
    {
        bool changed = false;
        changed |= SetString(net, "Title", model.Title);
        changed |= SetString(net, "Label", model.Label);
        changed |= SetString(net, "Comment", model.Comment);
        if (TcArchive.Bool(net, "OutCommented") != model.Disabled)
        {
            TcArchive.SetBool(net, "OutCommented", model.Disabled);
            changed = true;
        }

        var built = model.Trees.Select(Build).ToList();
        var existing = TcArchive.List(net, "NetworkItems");

        // Compare the SERIALIZED form, so an edit that renders identically is not written. This is the same
        // identity test the read side uses (equality of the whole thing, never a partial match), one level down.
        var same = existing.Count == built.Count
            && existing.Zip(built, (a, b) => a.ToString(SaveOptions.DisableFormatting)
                                          == b.ToString(SaveOptions.DisableFormatting)).All(x => x);
        if (same) return changed;

        TcArchive.SetList(net, "NetworkItems", ElementTypeFor(built), built);
        return true;
    }

    /// <summary>A homogeneous list states its element type once, as <c>cet</c>; a mixed one carries <c>t</c>
    /// per child, which <see cref="Build"/> always writes.</summary>
    private static string? ElementTypeFor(IReadOnlyList<XElement> items)
    {
        var types = items.Select(i => (string?)i.Attribute("t")).Distinct().ToList();
        return types.Count == 1 ? types[0] : null;
    }

    private static bool SetString(XElement owner, string name, string? value)
    {
        if ((TcArchive.Str(owner, name) ?? "") == (value ?? "")) return false;
        TcArchive.SetString(owner, name, value);
        return true;
    }

    // ── building ──────────────────────────────────────────────────────────────────────────────────

    private static XElement Build(Node n)
    {
        switch (n)
        {
            case Leaf l:
                return TcArchive.NewObject("BoxTreeOperand")
                    .Add2(BuildOperand(l.Operand, "Operand"))
                    .Add2(TcArchive.FlagsObject(Bits(l.Flags)));

            case Assign a:
            {
                var e = TcArchive.NewObject("BoxTreeAssign");
                if (a.Value is { } v)
                {
                    var rv = Build(v);
                    rv.SetAttributeValue("n", "RValue");
                    e.Add(rv);
                }
                e.Add(BuildOutputs(a.Targets));
                e.Add(TcArchive.FlagsObject(Bits(a.Flags)));
                return e;
            }

            case Box b:
            {
                var e = TcArchive.NewObject("BoxTreeBox");
                e.Add(TcArchive.StringValue("BoxType", b.Type));
                if (b.Instance is { } inst) e.Add(BuildOperand(inst, "Instance"));
                e.Add(BuildOutputs(b.Outputs));
                e.Add(TcArchive.FlagsObject(Bits(b.Flags)));
                if (b.Enable is { } en)
                {
                    var enEl = Build(en);
                    enEl.SetAttributeValue("n", "En");
                    e.Add(enEl);
                }
                var inputs = b.Inputs.Select(p => Build(p.Value)).ToList();
                TcArchive.SetList(e, "InputItems", ElementTypeFor(inputs), inputs);
                return e;
            }

            case Demux d:
            {
                var e = TcArchive.NewObject("BoxTreeDemux");
                e.Add(TcArchive.Value("VarId", d.VarId.ToString(System.Globalization.CultureInfo.InvariantCulture)));
                if (d.Input is { } src)
                {
                    var input = Build(src);
                    input.SetAttributeValue("n", "Input");
                    e.Add(input);
                }
                e.Add(TcArchive.FlagsObject(Bits(d.Flags)));
                return e;
            }

            case Terminator t:
            {
                var e = TcArchive.NewObject("BoxTreeTerminator");
                if (t.Input is { } ti)
                {
                    var input = Build(ti);
                    input.SetAttributeValue("n", "Input");
                    e.Add(input);
                }
                e.Add(TcArchive.FlagsObject(Bits(t.Flags)));
                return e;
            }

            case Parallel p:
            {
                var e = TcArchive.NewObject("BoxTreeParallel");
                if (p.Input is { } pi)
                {
                    var input = Build(pi);
                    input.SetAttributeValue("n", "Input");
                    e.Add(input);
                }
                e.Add(TcArchive.StringValue("Mode", p.Mode == ParallelMode.And ? "And" : "Or"));
                var branches = p.Branches.Select(Build).ToList();
                TcArchive.SetList(e, "Trees", ElementTypeFor(branches), branches);
                e.Add(TcArchive.FlagsObject(Bits(p.Flags)));
                return e;
            }

            default:
                throw new NotSupportedException(
                    $"TwinCAT: no way to write the graphical node '{n.GetType().Name}' — refusing rather than " +
                    "writing a body that is not what the source says.");
        }
    }

    /// <summary>Outputs are nested one level deeper than the live model's: an <c>OutputItems</c> member of type
    /// <c>OutputItemList</c>, holding a list also called <c>OutputItems</c>.</summary>
    private static XElement BuildOutputs(IReadOnlyList<Operand> targets)
    {
        var holder = TcArchive.NewObject("OutputItemList", "OutputItems");
        TcArchive.SetList(holder, "OutputItems", targets.Count == 0 ? null : "Operand",
                          targets.Select(t => BuildOperand(t, null)));
        return holder;
    }

    private static XElement BuildOperand(Operand o, string? memberName)
    {
        var e = TcArchive.NewObject("Operand", memberName);
        e.Add(TcArchive.StringValue("Operand", o.Text));
        e.Add(TcArchive.StringValue("Type", o.Type));
        e.Add(TcArchive.StringValue("Comment", null));
        e.Add(TcArchive.StringValue("SymbolComment", o.Comment));
        e.Add(TcArchive.StringValue("Address", null));
        e.Add(TcArchive.FlagsObject(Bits(o.Flags)));
        e.Add(TcArchive.BoolValue("LValue", o.IsLValue));
        e.Add(TcArchive.BoolValue("Boolean", false));
        e.Add(TcArchive.BoolValue("IsInstance", o.IsInstance));
        return e;
    }

    /// <summary>Volt's flags as the vendor's bit-field. <c>Reset</c> is REFUSED rather than dropped: network
    /// text can express a reset coil and the vendor's flag set (Negation/Set/Jump/Return/Rtrig/Ftrig) cannot,
    /// so writing a plain coil instead would change what the program does.</summary>
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
}
