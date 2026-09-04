using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Network;
// `Parallel` is also System.Threading.Tasks.Parallel; this file means the LD branch.
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Ide.Twincat;

/// <summary>
/// A TwinCAT <c>&lt;NWL&gt;</c> archive as a <see cref="NetworkBody"/>.
///
/// <para>The shapes below are the SAME object model CODESYS exposes live — same assembly family, same
/// <c>IBoxTreeVisitor</c> closed set — so this reader and <c>CodesysNetworkReader</c> produce the same model
/// for the same logic, which is what keeps the two vendors byte-identical on the wire. Only the ACCESS differs:
/// CODESYS hands over objects, TwinCAT hands over their serialization.</para>
///
/// <para><b>The member names differ from the live model, and the differences are the whole risk here</b>, so
/// they are stated once: an operand's text is <c>Operand</c> (live: <c>OperandExpr</c>), its l-value marker is
/// <c>LValue</c> (live: <c>IsLValue</c>), a box's inputs are <c>InputItems</c> (live: <c>InputItemList</c>),
/// outputs are <c>OutputItems</c> nested inside an <c>OutputItemList</c> object (live: a flat <c>Outputs</c>),
/// and a network's trees are <c>NetworkItems</c> (live: <c>GetTree(i)</c>). Reading one by the wrong name
/// yields a silently empty body, so each is used exactly once, here.</para>
/// </summary>
internal static class TcNetworkReader
{
    public static NetworkBody Read(XElement impl, BodyLanguage language)
    {
        var networks = TcArchive.RequireList(impl, "NetworkList", "the body")
            .Select((n, i) => ReadNetwork(n, i))
            .ToList();
        return new NetworkBody(language, networks);
    }

    /// <summary>A network's own text with TRAILING WHITESPACE removed.
    ///
    /// <para>An IDE stores a title or comment as the engineer typed it, including the newline that ended it.
    /// Network text puts the title in a QUOTED STRING on the header line, so an untrimmed title emits a quote
    /// that spans TWO LINES — not parseable network text, which means such a POU could be pulled and never
    /// pushed back — and a trailing newline in a comment emits an extra empty <c>//</c> line. Measured on
    /// CODESYS, where a user's title came back as "testlabel" followed by CR LF; the same is done here because
    /// the two vendors must answer identically for the same body, and nothing makes TwinCAT immune to an
    /// engineer pressing Enter.</para>
    ///
    /// <para>The archive keeps its own bytes: <see cref="TcNetworkWriter"/> compares these with trailing
    /// whitespace ignored, so a push that changed nothing still writes nothing.</para></summary>
    private static string? Trimmed(string? s) => s?.TrimEnd();

    /// <summary>One live network, read back into the model — for the WRITER's change gate, which must compare
    /// through exactly the reader a pull would use. A second, nearly-identical read there is how the two would
    /// drift apart.</summary>
    internal static Network ReadNetworkFor(XElement net, int order) => ReadNetwork(net, order);

    private static Network ReadNetwork(XElement net, int order) =>
        new Network(
            order,
            Trimmed(TcArchive.Str(net, "Title")),
            Trimmed(TcArchive.Str(net, "Label")),
            Trimmed(TcArchive.Str(net, "Comment")),
            TcArchive.Bool(net, "OutCommented"),
            TcArchive.RequireList(net, "NetworkItems", $"network {order}").Select(ReadNode).ToList());

    private static Node ReadNode(XElement e)
    {
        var flags = ReadFlags(TcArchive.FlagBits(e));
        switch (TcArchive.TypeOf(e))
        {
            // A `BoxTreeOperand` has NO Flags member (DIALECT N4): an operand's modifiers - negation, SET/RESET,
            // rising/falling - live on the `Operand` it holds. Taking `flags` from the ITEM therefore always
            // yielded None, so a negated contact reached the workspace as a plain one. CODESYS puts them on the
            // leaf because ITS item carries them; this is the same fact reached through the other spelling.
            case "BoxTreeOperand":
            {
                var operand = ReadOperand(TcArchive.Obj(e, "Operand"));
                return new Leaf(operand, operand.Flags ?? flags);
            }

            case "BoxTreeAssign":
            {
                var targets = Targets(e);
                var value = TcArchive.Obj(e, "RValue") is { } rv ? ReadNode(rv) : null;

                // COIL STORAGE STAYS ON THE TARGET, where this archive keeps it (measured: a coil operand comes
                // back `Flags=Negation,Set`) and where the format now spells it — `out S= v;` / `out R= v;`.
                // It used to be moved onto the VALUE to suit `out := v SET;` and moved back on write; the
                // translation layer that did it (`CoilStorage`) is deleted with the spelling that needed it.
                // A JUMP IS READ OFF THE TARGET OPERAND TOO, the same rule CODESYS's reader applies.
                //
                // TwinCAT writes the bit in BOTH places — a jump built by its own PLCopen importer carries
                // `Flags = 4` on the output `Operand` AND on the `BoxTreeAssign` — so reading the item alone
                // has always worked here, which is exactly why this is worth stating rather than leaving to
                // luck. On CODESYS the operand was the ONLY place the bit appeared for a jump an engineer drew,
                // and reading the item there turned their control flow into a coil assigning to the label. One
                // rule on both vendors costs two lines and removes the asymmetry that made that possible.
                //
                // It covers RETURN as well as JMP, and the rule now lives in `Flags.WithControlFlowFrom` for
                // that reason: this read lifted `Jump` and stopped, so on CODESYS — where the operand is the
                // only place the bit appears — an engineer's RETURN coil came back as `??? := cond;`. The two
                // bits share a bit-field and an operand; splitting them across two lines is what let one be
                // fixed while the other stayed broken.
                return new Assign(value, targets, flags.WithControlFlowFrom(targets));
            }

            case "BoxTreeBox":
                return new Box(
                    TcArchive.Str(e, "BoxType") ?? "",
                    InstanceOf(e),
                    CallKindOf(e),
                    ReadInputs(e),
                    BoxOutputs(e),
                    // FROM INPUT SLOT 0, not from the `EN` member.
                    //
                    // Correcting the member's SPELLING (`En` -> `EN`, 33 occurrences in every fixture and both
                    // real projects) fixed a real ordinal mismatch and still read nothing, because the member
                    // is not the wire: it is the "EN/ENO is shown on this box" flag, which the archive writes
                    // as `<n n="EN" />` when unset and a scalar when set — never a tree, so `Obj` matched
                    // nothing either way. The enable's expression is an ordinary input item, measured on the
                    // other vendor's live model (`Box.HasEnableSlot`) and identical here by N1.
                    ReadEnable(e),
                    ReadStCode(e),
                    flags);

            // Fan-out: with an Input it DEFINES the wire, without one it REFERENCES the same VarId.
            case "BoxTreeDemux":
                return new Demux(
                    TcArchive.Int(e, "VarId"),
                    TcArchive.Obj(e, "Input") is { } di ? ReadNode(di) : null,
                    flags);

            case "BoxTreeParallel":
                return new Parallel(
                    TcArchive.Obj(e, "Input") is { } pi ? ReadNode(pi) : null,
                    TcArchive.List(e, "Trees").Select(ReadNode).ToList(),
                    flags);

            case "BoxTreeTerminator":
                return new Terminator(
                    TcArchive.Obj(e, "Input") is { } ti ? ReadNode(ti) : null,
                    flags);

            default:
                throw new NotSupportedException(
                    $"TwinCAT: the graphical item '{TcArchive.TypeOf(e) ?? "?"}' has no network-text form yet. " +
                    "Volt refuses to materialize a body it cannot represent, rather than rendering an " +
                    "approximation an engineer would then push back.");
        }
    }

    /// <summary>An Execute box's ST — or a REFUSAL, because its archive shape is not measured.
    ///
    /// <para>An Execute box carries raw ST on the box itself; the archive records that with
    /// <c>ProvidesSTSnippet</c> and <c>STSnippet</c>, both measured members of <c>BoxTreeBox</c> (DIALECT N4).
    /// This returned null unconditionally, so <c>NetworkTextWriter</c>'s Execute arm never fired and the box
    /// rendered as a bare <c>EXECUTE();</c> — the engineer's ST absent from git with no marker, no diagnostic
    /// and no unreadable tally, and <c>volt status</c> reporting clean.</para>
    ///
    /// <para>It REFUSES rather than reading, and that is deliberate: what a populated <c>STSnippet</c> looks
    /// like inside this archive has never been measured on TwinCAT, and inventing a vendor serialization is
    /// exactly what made twenty .TcPOU files unopenable once. A refusal is loud and recoverable; a body missing
    /// the code it runs is neither. CODESYS reads its own snippet through the live object model, where there is
    /// nothing to guess at.</para></summary>
    private static string? ReadStCode(XElement e)
    {
        if (!TcArchive.Bool(e, "ProvidesSTSnippet")) return null;

        throw new NotSupportedException(
            "TwinCAT: this network contains an Execute box (ST inside FBD). Volt has not measured how the " +
            "archive stores its ST, and it will not materialize the box without the code it runs — the body " +
            "would look complete and would not be. Edit this POU in the IDE.");
    }

    /// <summary>A box's inputs, WITH their pin names.
    ///
    /// <para>The archive carries them as <c>&lt;o n="InputParam" t="ParamList"&gt;&lt;l2 n="Names"&gt;</c> - a
    /// measured member of <c>BoxTreeBox</c> (DIALECT N4) - and this hard-coded every <c>Formal</c> to null. The
    /// text writer renders an instance call as <c>Formal := value</c>, so a TON pulled as
    /// <c>fbTimer( := bStart,  := T#5s)</c>: the pin bindings gone from the file committed to git, and the text
    /// unparseable, so the POU could never be pushed back. CODESYS reads exactly this data - the same fact on
    /// the same object model, dropped on one side only.</para>
    ///
    /// <para>An OPERATOR box legitimately has an empty <c>InputParam</c> (measured on every box in every fixture
    /// here): its pins are positional and have no names, so those stay null rather than being refused.</para></summary>
    /// <summary>The enable wire, if input slot 0 is one — read BEFORE <see cref="ReadInputs"/> pairs the rest
    /// with their names, and removed from them there. See <see cref="Box.HasEnableSlot"/>: the enable is an
    /// ordinary input item, and the <c>EN</c> member is the "EN/ENO is shown" flag rather than the wire.</summary>
    private static Node? ReadEnable(XElement e)
    {
        var names = TcArchive.Strings(TcArchive.Obj(e, "InputParam"), "Names");
        if (!Box.HasEnableSlot(names)) return null;
        var items = TcArchive.List(e, "InputItems");
        return items.Count > 0 ? ReadNode(items[0]) : null;
    }

    private static List<Input> ReadInputs(XElement e)
    {
        var items = TcArchive.List(e, "InputItems");
        var names = TcArchive.Strings(TcArchive.Obj(e, "InputParam"), "Names");

        // Slot 0 is the ENABLE when the vendor names it so, and it is not a data pin — `ReadEnable` takes it.
        var skip = Box.HasEnableSlot(names) && items.Count > 0 ? 1 : 0;

        // INDEX-ALIGNED, never length-equal. This used to pair the two lists only when the vendor gave exactly
        // one name per input ("a partial list is not something to guess at") and otherwise name nothing — but a
        // shorter `Names` is not a partial list to guess at, it is how an EXTENSIBLE operator says its trailing
        // pins are positional. Requiring equality split one project's boxes in half on that accident.
        return items.Skip(skip)
            .Select((x, i) => new Input(Box.FormalAt(names, i + skip), ReadNode(x), Flags.None))
            .ToList();
    }

    /// <summary>An item's outputs. The archive nests them one level deeper than the live model does — an
    /// <c>OutputItems</c> object of type <c>OutputItemList</c>, itself holding an <c>OutputItems</c> list.</summary>
    private static IReadOnlyList<Operand> Outputs(XElement e)
    {
        // The HOLDER and its list must both be there. An empty list is a resolved box with no output items —
        // legitimate and common; an ABSENT one means this reader is looking by a name the archive does not
        // use, which is a body it cannot read, not a body with no outputs.
        var holder = TcArchive.RequireObj(e, "OutputItems", $"the {TcArchive.TypeOf(e) ?? "item"}");
        return TcArchive.RequireList(holder, "OutputItems", $"the {TcArchive.TypeOf(e) ?? "item"}'s outputs")
            .Select(x => ReadOperand(x)).ToList();
    }

    /// <summary>A box's OUTPUT PINS — the wired ones. The same rule as CODESYS (`Box.HasEnoSlot`): output
    /// slot 0 is the <c>ENO</c> echo when the vendor names it so, names are index-aligned with the slots, and
    /// an unwired pin is an EMPTY operand rather than an absent one. Nothing here is TwinCAT-specific; the two
    /// vendors ship the same NWL model (N1) and this is that model through the archive's spelling.</summary>
    private static IReadOnlyList<Output> BoxOutputs(XElement e)
    {
        var names = TcArchive.Strings(TcArchive.Obj(e, "OutputParam"), "Names");
        var eno = Box.HasEnoSlot(names) ? 1 : 0;
        return Outputs(e)
            .Select((op, i) => (op, i))
            .Skip(eno)
            .Where(x => x.op.Text.Length > 0)
            .Select(x => new Output(Box.FormalAt(names, x.i), x.op))
            .ToList();
    }

    /// <summary>An assignment's TARGETS. Same items as <see cref="Outputs"/>, read through the coil decode:
    /// on a target, <c>Negation</c> and <c>Set</c> are two bits spelling ONE coil kind, not two modifiers.
    /// See <see cref="Flags.CoilFromVendor"/> — the mapping was measured on CODESYS, and the bit values here
    /// (<c>FlagNegation = 1</c>, <c>FlagSet = 2</c>) are the same <c>IFlags</c> member order, so a reset coil
    /// is <c>3</c> on this vendor too.</summary>
    private static IReadOnlyList<Operand> Targets(XElement e) =>
        Outputs(e).Zip(
            TcArchive.RequireList(TcArchive.RequireObj(e, "OutputItems", "the assignment"), "OutputItems", "the assignment's outputs"),
            (op, x) =>
            {
                var bits = TcArchive.FlagBits(x);
                var coil = Flags.CoilFromVendor((bits & TcArchive.FlagNegation) != 0, (bits & TcArchive.FlagSet) != 0);
                return op with
                {
                    Flags = (op.Flags ?? Flags.None) with { Negated = coil.Negated, Set = coil.Set, Reset = coil.Reset },
                };
            }).ToList();

    private static Operand ReadOperand(XElement? o)
    {
        if (o == null) return new Operand("");
        return new Operand(
            TcArchive.Str(o, "Operand") ?? "",
            TcArchive.Str(o, "Type"),
            TcArchive.Str(o, "SymbolComment"),
            TcArchive.Bool(o, "IsInstance"),
            TcArchive.Bool(o, "LValue"),
            ReadFlags(TcArchive.FlagBits(o)));
    }

    /// <summary>The vendor bit-field. The archive stores a NUMBER where the live model exposes named booleans,
    /// so the bit values are decoded here — from <c>IFlags</c>'s own member order, not from a guess.</summary>
    private static Flags ReadFlags(int bits) =>
        bits == 0
            ? Flags.None
            : new Flags(
                Negated: (bits & TcArchive.FlagNegation) != 0,
                Set: (bits & TcArchive.FlagSet) != 0,
                Reset: false,
                Jump: (bits & TcArchive.FlagJump) != 0,
                Return: (bits & TcArchive.FlagReturn) != 0,
                Rising: (bits & TcArchive.FlagRtrig) != 0,
                Falling: (bits & TcArchive.FlagFtrig) != 0);

    /// <summary>A box's call kind. <c>CallType</c> is a SCALAR carrying a type attribute -
    /// <c>&lt;v n="CallType" t="Operator"&gt;And&lt;/v&gt;</c> - not an object member, which is why looking
    /// for it with <c>Obj</c> found nothing and read every AND box as a function call. An instance means a
    /// function-block call; neither means a stateless function.</summary>
    private static CallKind CallKindOf(XElement e)
    {
        if (TcArchive.Str(e, "CallType") != null) return CallKind.Operator;
        return InstanceOf(e) == null ? CallKind.Function : CallKind.FunctionBlock;
    }

    /// <summary>A box's FB instance, or null when it has none.
    ///
    /// <para><b>The PRESENCE of the member proves nothing.</b> The vendor writes an
    /// <c>&lt;o n="Instance" t="Operand"&gt;</c> on EVERY box and spells emptiness inside it, as an explicit
    /// <c>&lt;n n="Operand" /&gt;</c> null scalar - the same serializer writes real nulls that way everywhere,
    /// so the element is never evidence of a value. Testing the member instead of the scalar made
    /// <c>Instance</c> non-null for every box, so <c>NetworkTextWriter.Definition</c> took its instance arm for
    /// anything outside the operator table and rendered the callee's NAME away:
    /// <c>xoutput := ( := xtest,  := xtest2);</c> - unparseable, so the POU could never be pushed back. It also
    /// made <c>CallKindOf</c> incapable of ever answering <c>Function</c>.</para></summary>
    private static Operand? InstanceOf(XElement e)
    {
        var inst = TcArchive.Obj(e, "Instance");
        if (inst == null) return null;
        return TcArchive.Str(inst, "Operand") == null ? null : ReadOperand(inst);
    }
}
