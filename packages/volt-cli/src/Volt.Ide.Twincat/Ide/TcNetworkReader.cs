using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine;
using Volt.Engine.Format.Network;
// `Parallel` is also System.Threading.Tasks.Parallel; this file means the LD branch.
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Ide.Twincat;

/// <summary>
/// A TwinCAT <c>&lt;NWL&gt;</c> archive as a <see cref="NetworkBody"/>.
///
/// <para>The shapes below are the SAME object model CODESYS exposes live — same assembly family, same
/// <c>IBoxTreeVisitor</c> closed set — so this reader and <c>CodesysNetworkReader</c> must produce the same model
/// for the same logic, which is what keeps the two vendors byte-identical on the wire. Only the ACCESS differs:
/// CODESYS hands over objects, TwinCAT hands over their serialization. Where the two still differ it is a defect
/// to close, not a parity (this one refuses a populated <c>InputFlags</c>, which CODESYS's reads; openspec
/// twincat-inproc-host 1.1).</para>
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
    public static NetworkBody Read(XElement impl, BodyLanguage language) =>
        new(language, TcArchive.RequireList(impl, "NetworkList", "the body").Select((n, i) => ReadNetwork(n, i)).ToList());

    /// <summary>The whole body AS A PULL SHOWS IT (<see cref="ReadNetworkShown"/>, per network).</summary>
    public static NetworkBody ReadShown(XElement impl, BodyLanguage language) =>
        new(language, TcArchive.RequireList(impl, "NetworkList", "the body").Select((n, i) => ReadNetworkShown(n, i)).ToList());

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
    private static string? Trimmed(string? s) =>
        string.IsNullOrEmpty(s) ? null : (s!.TrimEnd() is { Length: > 0 } t ? t : null);

    /// <summary>A network comment as the archive's XML hands it over. The XAE hands a comment's CR LF raw (DIALECT N42 f),
    /// and a normalizing parse turns it into LF, so a line break arrives as LF or CR LF depending on the parse, and the
    /// text's comment lines are CR LF (P10): each LF is the IDE's line break, read back as CR LF. Without it a two-line
    /// comment read as a bare LF, which the text cannot spell, and its whole body was hidden (measured 2026-10-16,
    /// ld-fbd-coverage 2R.3). The writer compares through the same reading.</summary>
    internal static string? Comment(string? archived) =>
        NetworkText.Stored(archived?.Replace("\r\n", "\n").Replace("\n", "\r\n"));

    /// <summary>One live network AS A PULL SHOWS IT — what the pull and the writer's pairing and change gate read. A
    /// NETWORK THE TEXT CANNOT HOLD IS SHOWN, NOT ITS BODY HIDDEN (ld-fbd-coverage 1b.4), CODESYS's reader's rule: a
    /// refusal met in its trees makes this one network its UNSUPPORTED line, header and comment kept.</summary>
    internal static Network ReadNetworkShown(XElement net, int order)
    {
        try { return ReadNetwork(net, order); }
        catch (Volt.Engine.Format.Body.UnrepresentableBodyException e) when (NetworkText.ShownAsUnsupported(e.Reason))
        {
            return Header(net, order) with { Unsupported = e.Reason };
        }
    }

    private static Network ReadNetwork(XElement net, int order) =>
        Header(net, order) with
        {
            Trees = TcArchive.RequireList(net, "NetworkItems", $"network {order}").Select(n => ReadNode(n, consumed: false)).ToList(),
        };

    /// <summary>The header as the network stores it — each member REQUIRED, as TwinCAT writes all four on every network
    /// (201 of 201: <c>""</c> where there is none, which reads as none).</summary>
    private static Network Header(XElement net, int order)
    {
        var what = $"network {order}";
        return new(order,
            NetworkText.Stored(TcArchive.RequireText(net, "Title", what)),
            Trimmed(TcArchive.RequireText(net, "Label", what)),
            Comment(TcArchive.RequireText(net, "Comment", what)),
            TcArchive.RequireBool(net, "OutCommented", what),
            Array.Empty<Node>());
    }

    /// <param name="consumed">Whether an item above this one reads its output — true for everything below the top
    /// level. A consumed box records the output slot its consumer is connected to (<see cref="ConnectedSlot"/>).</param>
    private static Node ReadNode(XElement e, bool consumed)
    {
        var type = TcArchive.TypeOf(e);
        var flags = ReadFlags(ItemFlagBits(e, type));
        switch (type)
        {
            // A `BoxTreeOperand` has NO Flags member (DIALECT N4): an operand's modifiers - negation, SET/RESET,
            // rising/falling - live on the `Operand` it holds. Taking `flags` from the ITEM therefore always
            // yielded None, so a negated contact reached the workspace as a plain one. CODESYS puts them on the
            // leaf because ITS item carries them; this is the same fact reached through the other spelling.
            case "BoxTreeOperand":
            {
                var operand = ReadOperand(TcArchive.RequireObj(e, "Operand", "a contact (BoxTreeOperand)"));
                var leafFlags = operand.Flags!;   // ReadOperand reads every operand's own Flags
                if (TcUnmeasured.NegatedEdge(leafFlags)) throw TcUnmeasured.EdgeOrderOnPull($"the operand '{operand.Text}'");
                return new Leaf(operand, leafFlags);
            }

            case "BoxTreeAssign":
            {
                var targets = Targets(e);
                // Census 1.2: the empty terminator is the ONE spelling of "unconnected", so the model has no null
                // value to put an archive null in (task 1.10) — the same refusal CODESYS's reader makes.
                var value = TcArchive.Obj(e, "RValue") is { } rv
                    ? ReadNode(rv, consumed: true)
                    : throw new Volt.Engine.Format.Body.UnrepresentableBodyException(
                        "an assignment with no value",
                        "TwinCAT: an assignment holds no value at all, where an unconnected one holds an empty " +
                        "terminator. No measured project has one, and the model keeps one spelling of it.");

                // COIL STORAGE STAYS ON THE TARGET, where this archive keeps it (measured: a coil operand comes
                // back `Flags=Negation,Set`) and where the format spells it — `out S= v;` / `out R= v;`.
                // A JUMP IS READ OFF THE TARGET OPERAND TOO, the same rule CODESYS's reader applies.
                //
                // TwinCAT writes the bit in BOTH places — a jump built by its own importer carries
                // `Flags = 4` on the output `Operand` AND on the `BoxTreeAssign` — so reading the item alone
                // would work here; on CODESYS the operand is the ONLY place the bit appears for a jump an engineer
                // drew. One rule on both vendors.
                //
                // It covers RETURN as well as JMP, and the rule now lives in `Flags.WithControlFlowFrom` for
                // that reason: this read lifted `Jump` and stopped, so on CODESYS — where the operand is the
                // only place the bit appears — an engineer's RETURN coil came back as `??? := cond;`. The two
                // bits share a bit-field and an operand; splitting them across two lines is what let one be
                // fixed while the other stayed broken.
                UnheldFlags.RefuseOnAssignItem(BeckhoffDriver.Row.Display, flags);
                // TWINCAT'S UNCONDITIONAL JUMP OR RETURN holds the empty operand where CODESYS holds the rail (its importer,
                // corpus Vn_jump_uncond / Vn_return_uncond): one fact, read as the rail the model holds it as, so one text
                // (`JMP.l := RAIL();`) names it on both vendors. The writer keeps the archive's operand (`RailJumpValue`).
                if (IsRailJump(targets, value)) value = new Terminator(Flags.None);
                return new Assign(value, targets, flags.WithControlFlowFrom(targets));
            }

            case "BoxTreeBox":
            {
                // The edge order is unmeasured on TwinCAT on a box as on an operand (N17 measured both on CODESYS).
                if (TcUnmeasured.NegatedEdge(flags))
                    throw TcUnmeasured.EdgeOrderOnPull($"the '{BoxType(e)}' box");
                var connected = consumed ? ConnectedSlot(e) : null;
                return new Box(
                    BoxType(e),
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
                    flags,
                    // A consumer reads the box's MAIN output (DIALECT N16), so on a consumed box the connected slot is
                    // the main output; a top-level box has no consumer, and the text no position for its main
                    // output, so neither is stated there.
                    ConnectedSlot: connected,
                    // The vendor's stored output types, beside the names this reads (`OutputParam/Types`) — a wire
                    // fed by the box is declared with the type of its connected slot (spec, "a stored output type").
                    OutputTypes: OutputTypes(e),
                    // Whether the box HAS an ENO output: its output list's first name, as CODESYS reads it (task 3.10).
                    HasEnoOutput: HasEno(e),
                    // S4 (ld-fbd-coverage 1b.4): the stored name of a main output the text spells by name, as CODESYS.
                    MainOutputName: Box.NameOfConnectedOutput(InstanceOf(e) is not null, connected, HasEno(e), Names(e, "OutputParam")),
                    // The stored output names whole (ld-fbd-coverage 2.3), as CODESYS reads them: S1's slot on a bit
                    // operator, a call's unconnected pins — the text spells them where they differ from what its pins give.
                    Members: NwlMembers.Of((NetworkMembers.OutputNames, MemberValue.Texts(Names(e, "OutputParam")))));
            }

            // Fan-out: with an Input it DEFINES the wire, without one it REFERENCES the same VarId.
            case "BoxTreeDemux":
                // DIALECT N20: the archive serializes no flag on a wire or a Parallel (`BoxTreeParallel` carries only
                // Trees, Input, Mode and Id); one found anyway is refused by name, the rule CODESYS's reader shares.
                UnheldFlags.RefuseOnNode(BeckhoffDriver.Row.Display, "a wire", flags);
                return new Demux(
                    TcArchive.RequireInt(e, "VarId", "a wire (BoxTreeDemux)"),
                    TcArchive.Obj(e, "Input") is { } di ? ReadNode(di, consumed: true) : null);

            case "BoxTreeParallel":
            {
                var feed = TcArchive.Obj(e, "Input") is { } pi ? ReadNode(pi, consumed: true) : null;
                // Census 1.2, the parity twin of CODESYS's reader: an unfed Parallel is the null feed, and a feed
                // that is the empty terminator occurs in no measured project — refused by name.
                if (feed is Terminator)
                    throw new Volt.Engine.Format.Body.UnrepresentableBodyException(
                        "a Parallel fed by the empty terminator",
                        "TwinCAT: a parallel branch's feed is an unconnected terminator, a shape no measured project " +
                        "holds (an unfed branch has no feed at all). Edit this network in the IDE.");
                UnheldFlags.RefuseOnNode(BeckhoffDriver.Row.Display, "a Parallel", flags);
                // `Mode` is an enum scalar, written by member name like `CallType` — read, never defaulted (census
                // 1.3 found a Sequential); no committed archive holds a Parallel, so an absent or unknown value is
                // the marker, not a guess.
                return new Parallel(feed, TcArchive.List(e, "Trees").Select(t => ReadNode(t, consumed: true)).ToList(),
                    ParallelModes.FromVendor(TcArchive.Str(e, "Mode")));
            }

            // Census 1.4: a terminator with an INPUT occurs in no measured project — refused by name (task 1.10),
            // the parity twin of CODESYS's reader.
            case "BoxTreeTerminator":
                if (TcArchive.Obj(e, "Input") is not null)
                    throw new Volt.Engine.Format.Body.UnrepresentableBodyException(
                        "a terminator with an input",
                        "TwinCAT: a rung terminator carries an input, a shape no measured project holds and " +
                        "network text has no form for.");
                return new Terminator(flags);

            default:
                throw new Volt.Engine.Format.Body.UnrepresentableBodyException(
                    "an item with no network-text form",
                    $"TwinCAT: the graphical item '{TcArchive.TypeOf(e) ?? "?"}' has no network-text form yet. " +
                    "Volt refuses to materialize a body it cannot represent, rather than rendering an " +
                    "approximation an engineer would then push back.");
        }
    }

    /// <summary>THE FLAG BITS OF AN ITEM, by its class. A box, an assignment and a terminator hold a <c>Flags</c> member on
    /// every one TwinCAT wrote (207, 165 and 5 of them), so its absence is refused by name, never read as no flag. A contact
    /// (<c>BoxTreeOperand</c>, DIALECT N4), a wire (<c>BoxTreeDemux</c>) and a Parallel (N20) hold none.</summary>
    private static int ItemFlagBits(XElement e, string? type)
    {
        var what = $"a {type ?? "graphical item"}";
        switch (type)
        {
            case "BoxTreeBox":
            case "BoxTreeAssign":
            case "BoxTreeTerminator":
                return TcArchive.RequireFlagBits(e, what);
            case "BoxTreeOperand":
                if (TcArchive.Obj(e, "Flags") is not null)
                    throw new UnsupportedException(
                        $"TwinCAT: {what} holds a 'Flags' member, which TwinCAT writes on none (DIALECT N4: a contact's " +
                        "modifiers ride its operand). Refusing rather than reading past a modifier this reader has no place for.");
                return 0;
            // A wire and a Parallel hold none either (N20); one found is read, so the shared refusal names it
            // (UnheldFlags.RefuseOnNode, the rule CODESYS's reader shares).
            case "BoxTreeDemux":
            case "BoxTreeParallel":
                return TcArchive.Obj(e, "Flags") is null ? 0 : TcArchive.RequireFlagBits(e, what);
            default:
                return 0;   // an item with no network-text form: refused by name in ReadNode
        }
    }

    /// <summary>A box's TYPE — the callee's name, REQUIRED and non-empty: TwinCAT writes one on every box (207 of 207).
    /// Absent or <c>""</c>, the box is a call to nothing, refused by name rather than read as a call to <c>""</c>.</summary>
    internal static string BoxType(XElement box) =>
        TcArchive.RequireText(box, "BoxType", "a box") is { Length: > 0 } t ? t
            : throw new UnsupportedException(
                "TwinCAT: a box holds an empty 'BoxType', where TwinCAT names the callee on every box. Refusing rather than " +
                "reading a call to nothing.");

    /// <summary>Whether the box SHOWS its ENO: the archive's <c>ENO</c> flag, never the output's name (<c>Box.ShowsEno</c>,
    /// network-text-st 1c) — the rule CODESYS's reader shares.</summary>
    internal static bool HasEno(XElement box) =>
        Box.ShowsEno(Shown(box, "ENO"), Names(box, "OutputParam"), BeckhoffDriver.Row.Display, BoxType(box));

    /// <summary>Whether the box SHOWS its enable: the archive's <c>EN</c> flag, never slot 0's name (<c>Box.ShowsEnable</c>).</summary>
    private static bool HasEnable(XElement box) =>
        Box.ShowsEnable(Shown(box, "EN"), Names(box, "InputParam"), BeckhoffDriver.Row.Display, BoxType(box));

    /// <summary>The "EN/ENO is shown" flag as the archive stores it: a scalar <c>true</c>/<c>false</c>, or <c>&lt;n n="EN" /&gt;</c>
    /// (unset, null). Any other scalar is no measured spelling and is refused by name.</summary>
    private static bool? Shown(XElement box, string member)
    {
        var v = box.Elements("v").FirstOrDefault(x => (string?)x.Attribute("n") == member)?.Value;
        return v switch
        {
            null => null,
            "true" => true,
            "false" => false,
            _ => throw new Volt.Engine.Format.Body.UnrepresentableBodyException(Box.ShownWithoutSlotMarker,
                $"TwinCAT: the '{BoxType(box)}' box stores '{v}' as its {member} flag, a spelling no archive was " +
                "measured to hold."),
        };
    }

    /// <summary>A box's pin names — <c>InputParam</c>/<c>OutputParam</c>'s <c>Names</c> list, REQUIRED. The names decide
    /// whether slot 0 is the enable (and the ENO), so a list the archive does not hold is refused by name
    /// (<see cref="BoxRefusals.MissingList"/>): <c>TcArchive.Strings</c> answers a missing list with an empty one, and
    /// read so a wired EN became a positional data pin and a named output the box's result. An operator's EMPTY list
    /// (<c>&lt;l2 n="Names" /&gt;</c>, measured on every operator box here) is a real answer.</summary>
    private static IReadOnlyList<string> Names(XElement box, string param) =>
        TcArchive.Obj(box, param) is { } p && p.Elements("l2").Any(l => (string?)l.Attribute("n") == "Names")
            ? TcArchive.Strings(p, "Names")
            : throw BoxRefusals.MissingList(BeckhoffDriver.Row.Display, BoxType(box), param + "/Names");

    /// <summary>A box's INPUT SLOTS — with their holes, REQUIRED, and refused where one is a hole. The slots are
    /// index-aligned with <c>InputParam/Names</c>, and <c>TcArchive.List</c> drops a <c>&lt;n /&gt;</c>: a null slot
    /// then moved every later pin onto its neighbour's name (the TON's <c>PT</c> read as <c>IN</c>) or a data pin onto
    /// the enable, and nothing caught it — this vendor's <c>InputFlags</c> is null, so there is no length to check.
    /// An unwired pin is an empty operand here (<see cref="ReadPin"/>); a null slot is no measured shape.</summary>
    private static IReadOnlyList<XElement> InputSlots(XElement box)
    {
        var type = BoxType(box);
        if (!box.Elements("l2").Any(l => (string?)l.Attribute("n") == "InputItems"))
            throw BoxRefusals.MissingList(BeckhoffDriver.Row.Display, type, "InputItems");
        var slots = TcArchive.Slots(box, "InputItems");
        for (var i = 0; i < slots.Count; i++)
            if (slots[i] is null) throw BoxRefusals.NullInputSlot(BeckhoffDriver.Row.Display, type, i);
        return slots.Select(x => x!).ToList();
    }

    /// <summary>THE STORED OUTPUT TYPES, index-aligned with the output slots as the names are — the compiler's answer
    /// the archive keeps (<c>&lt;l2 n="Types"&gt;&lt;v&gt;BOOL&lt;/v&gt;&lt;v&gt;TIME&lt;/v&gt;</c> on a TON; <c>[BOOL]</c> on an AND, DIALECT
    /// D22). An empty entry (<c>&lt;v&gt;&lt;/v&gt;</c>, an unresolved slot) is an unknown type, never a default; a box with
    /// no <c>OutputParam</c>, or one with no <c>Types</c> list, stored none, which is null — not read — rather than an
    /// empty list, which says "read, zero slots". <c>TcArchive.Strings</c> answers a missing list with an empty one,
    /// so the list's presence is asked first: CODESYS reads the same absence as null, and the model has one meaning.</summary>
    private static IReadOnlyList<string?>? OutputTypes(XElement box) =>
        TcArchive.Obj(box, "OutputParam") is { } param && param.Elements("l2").Any(l => (string?)l.Attribute("n") == "Types")
            ? TcArchive.Strings(param, "Types").Select(t => string.IsNullOrWhiteSpace(t) ? null : t).ToList()
            : null;

    /// <summary>THE OUTPUT SLOT A CONSUMED BOX'S CONSUMER READS (task 3.10), or null where the archive does not say.
    ///
    /// <para>The archive serializes no <c>MainOutputIndex</c> (no fixture carries the member; the live CODESYS object
    /// reports one). It does say it another way, the one CODESYS's census recorded beside the index: the slot a
    /// consumer is connected to is the one output slot stored as NULL (<c>&lt;n /&gt;</c>) — nothing is written into
    /// it because the connection IS the nesting. Measured on CODESYS (<c>git show b2496efb4b:packages/volt-cli/scripts/nwl-slots.log</c>, the slots column:
    /// <c>MainOutputIndex=1 slots=eneeRe</c>, <c>=0 slots=nRRRR</c>, <c>=0 slots=ne</c> — the null sits at the index
    /// every time), and the hand-drawn TwinCAT fixtures hold the same shape (<c>ladder-demux.TcPOU</c>'s TON read by
    /// its coil: <c>[null, ""]</c>, Q connected, ET unwired). DIALECT N1: one object model, two spellings.</para>
    ///
    /// <para>A box with an ENO output is read through it (DIALECT N16: the main output IS the ENO there), and the ENO
    /// echo is stored null whether or not anything reads it — so it is slot 0 by that rule, not by its null. Any other
    /// box: exactly one null slot is the answer; none (an AND/OR box, which has no output items and stores no main
    /// output) or several is no answer, and null is never a default — the writer refuses what it would need the slot
    /// for, by name.</para></summary>
    internal static int? ConnectedSlot(XElement box)
    {
        // A bit operator stores no main output (census 1.6), so its consumer is connected by no stored slot — what
        // the archive's single null output item on an AND box would otherwise be read as. CODESYS reads the same box
        // as `MainOutputIndex` None; one model, one answer.
        // S1 (ld-fbd-coverage 2.3): one that stores an output (the editor's `Names = ['']`, drawn here as on CODESYS) is
        // connected by it, slot 0 — Box.BitOperatorSlot, the one rule both readers and the text share.
        if (NetworkText.IsBitOperator(BoxType(box))) return Names(box, "OutputParam").Count > 0 ? 0 : null;
        if (HasEno(box)) return 0;
        var holder = TcArchive.Obj(box, "OutputItems");
        if (holder is null) return null;
        var slots = TcArchive.Slots(holder, "OutputItems");
        // A box TwinCAT's PLCopen IMPORT built declares one output (`OutputParam/Names = [Out1]`) and stores no slot
        // null: the importer hangs an EMPTY operand there, or none (`importer-max.TcPOU`, real XAE output). Either way
        // one declared output is one slot a consumer can read.
        if (slots.Count <= 1 && slots.All(s => s is not null && TcArchive.RequireText(s, "Operand", "an output slot").Length == 0)
            && Names(box, "OutputParam").Count == 1)
            return 0;
        // A box that stores no output at all — no name, no slot: a function box a push built, its names the text's (none:
        // a function's result pin is no name a built box can hold, NetworkMembers.Buildable, ld-fbd-coverage 2.3) — is read
        // through the one output it has, its result, slot 0: as CODESYS reads a box Volt built (DIALECT N21).
        if (slots.Count == 0 && Names(box, "OutputParam").Count == 0)
            return 0;
        var nulls = slots.Select((slot, i) => (slot, i)).Where(x => x.slot is null).Select(x => x.i).ToList();
        return nulls.Count == 1 ? nulls[0] : null;
    }

    /// <summary>An Execute box's ST, read from the archive.
    ///
    /// <para>An Execute box carries raw ST on the box itself, recorded with <c>ProvidesSTSnippet</c> and
    /// <c>STSnippet</c> (DIALECT N4). Answered null, the box would render as a bare <c>EXECUTE();</c> — the
    /// engineer's ST absent from git with <c>volt status</c> reporting clean.</para>
    ///
    /// <para><b>MEASURED 2026-09-06</b> from an Execute box drawn by hand in XAE (the fixture
    /// <c>tc-pou/execute-box.TcPOU</c>, since Volt cannot create one on this vendor — the importer accepts the
    /// push and returns a plain box named EXECUTE with the ST gone). The shape is four objects deep, and the
    /// line list is an ARRAY, not an l2 list:</para>
    /// <code>
    /// &lt;o n="STSnippet" t="STSnippet"&gt;
    ///   &lt;o n="STSnippet" t="STImplementationObject"&gt;
    ///     &lt;o n="TextDocument" t="TextDocument"&gt;
    ///       &lt;a n="TextLines" cet="TextLine"&gt;
    ///         &lt;o&gt;&lt;v n="Id"&gt;17L&lt;/v&gt;&lt;n n="Tag" /&gt;&lt;v n="Text"&gt;"iCount:=icount+1;"&lt;/v&gt;&lt;/o&gt;
    /// </code>
    /// <para>Each line's <c>Text</c> is stored QUOTED — the value includes its own surrounding double quotes —
    /// so they are stripped here. A box whose <c>ProvidesSTSnippet</c> is true but whose document cannot be
    /// walked still REFUSES rather than answering empty: an Execute box with no code is not a thing, and
    /// answering "" would lose its code silently.</para></summary>
    /// <summary>The Execute box's ST lines AS ARCHIVE ELEMENTS — one per line, in order.
    ///
    /// <para>Shared with <c>TcNetworkWriter</c>, which edits a line's <c>Text</c> in place, so the walk to the
    /// document lives in ONE place. A reader and a writer that walk to the same member by different routes is
    /// how `Element("l")` vs `<l2>` shipped.</para></summary>
    internal static IReadOnlyList<XElement> StLines(XElement e) =>
        TcArchive.Items(
            TcArchive.Obj(TcArchive.Obj(TcArchive.Obj(e, "STSnippet"), "STSnippet"), "TextDocument"),
            "TextLines");

    internal static string? ReadStCode(XElement e)
    {
        if (!TcArchive.RequireBool(e, "ProvidesSTSnippet", $"the '{BoxType(e)}' box")) return null;

        var doc = TcArchive.Obj(TcArchive.Obj(TcArchive.Obj(e, "STSnippet"), "STSnippet"), "TextDocument");
        if (doc == null)
            throw new Volt.Engine.Format.Body.UnrepresentableBodyException(BoxRefusals.UnreadableExecuteMarker,
                "TwinCAT: this network contains an Execute box whose STSnippet/TextDocument this reader could " +
                "not walk. Volt will not materialize the box without the code it runs — the body would look " +
                "complete and would not be. Edit this POU in the IDE.");

        // The line ARRAY is required (every drawn Execute box holds one): `Items` answers a missing one with no lines, which
        // read the box's code as "" — an Execute box's ST erased, the pull reporting clean. Each line's `Text` is required
        // too: an empty line is the `""` TwinCAT writes for one (the trailing line of every drawn box).
        if (!doc.Elements("a").Any(a => (string?)a.Attribute("n") == "TextLines"))
            throw new UnsupportedException(
                "TwinCAT: an Execute box's TextDocument has no 'TextLines' array, which every drawn Execute box holds. " +
                "Refusing rather than reading the box's code as empty.");
        return string.Join("\n", TcArchive.Items(doc, "TextLines")
            .Select(l => Unquote(TcArchive.RequireText(l, "Text", "an Execute box's ST line"))));
    }

    /// <summary>A `TextLine`'s stored text, without the double quotes the archive wraps every line in.</summary>
    private static string Unquote(string s) =>
        s.Length >= 2 && s[0] == '"' && s[^1] == '"' ? s.Substring(1, s.Length - 2) : s;

    /// <summary>The enable wire, if input slot 0 is one — read BEFORE <see cref="ReadInputs"/> pairs the rest
    /// with their names, and removed from them there. See <see cref="Box.HasEnableSlot"/>: the enable is an
    /// ordinary input item, and the <c>EN</c> member is the "EN/ENO is shown" flag rather than the wire.</summary>
    private static Node? ReadEnable(XElement e)
    {
        if (!HasEnable(e)) return null;
        var items = InputSlots(e);
        return items.Count == 0 ? throw Box.EnableWithoutItem(BeckhoffDriver.Row.Display, BoxType(e)) : ReadPin(items[0]);
    }

    /// <summary>THE ONE READ OF A BOX INPUT SLOT — the enable (slot 0) and every data pin alike. An unwired slot is the
    /// empty operand TwinCAT's import writes (<c>importer-unwired.TcPOU</c>, <c>Vn_ton_unwired</c>), read as the operand it
    /// is — <c>Leaf ""</c>, as CODESYS reads its own — never as the rail, which only a stored terminator is.</summary>
    private static Node ReadPin(XElement item) => ReadNode(item, consumed: true);

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
    private static List<Input> ReadInputs(XElement e)
    {
        var items = InputSlots(e);
        var names = Names(e, "InputParam");

        // Slot 0 is the ENABLE when the vendor names it so, and it is not a data pin — `ReadEnable` takes it.
        var skip = HasEnable(e) ? 1 : 0;   // a shown EN with no item is refused by ReadEnable

        // INDEX-ALIGNED, never length-equal: a shorter `Names` is not a partial list to guess at, it is how an
        // EXTENSIBLE operator says its trailing pins are positional.
        // A POPULATED `InputFlags` IS REFUSED BY NAME. It was null in all 22 occurrences measured here. On CODESYS —
        // the same object model (DIALECT N1) — the member IS populated, and six pins in two real projects keep their
        // negation there ONLY, with the operand unflagged (census 2026-09-26, `probe-nwl-census-v2.py`,
        // `git show b2496efb4b:packages/volt-cli/scripts/probe-nwl-census-v2.py`); reading them as None would pull
        // inverted logic. CODESYS READS its populated list into `Input.Flags`; this reader cannot, because the populated ARCHIVE spelling has never been
        // observed, so it is not guessed at: anything but `<n n="InputFlags" />` refuses the body here, at the reader.
        // An ABSENT member is refused too: N4 measured it on every `BoxTreeBox`, so a box without one is an archive
        // shape this reader has never seen, not a box whose pins carry nothing.
        var pinFlags = e.Elements().FirstOrDefault(x => (string?)x.Attribute("n") == "InputFlags");
        if (pinFlags is null)
            throw BoxRefusals.NoPinFlags(BeckhoffDriver.Row.Display, BoxType(e));
        if (pinFlags.Name.LocalName != "n")
            throw new Volt.Engine.Format.Body.UnrepresentableBodyException(BoxRefusals.PinFlagMarker,
                $"TwinCAT: the '{BoxType(e)}' box carries a populated InputFlags — a modifier on a PIN, " +
                "which network text has no spelling for (only on what feeds it). Volt refuses to materialize the body " +
                "rather than pull the input without it.");

        return items.Skip(skip)
            // `Flags.None` because a pin with a modifier was refused above; a per-pin negation that rides the
            // OPERAND (`NegatedContact.derived.TcPOU`: `Flags = 1` on the operand's own Flags) is read there.
            .Select((x, i) => new Input(Box.FormalAt(names, i + skip), ReadPin(x), Flags.None))
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

    /// <summary>A box's OUTPUT PINS — the wired ones. The same rule as CODESYS (`Box.ShowsEno`): output
    /// slot 0 is the <c>ENO</c> echo when the vendor names it so, names are index-aligned with the slots, and
    /// an unwired pin is an EMPTY operand rather than an absent one. Nothing here is TwinCAT-specific; the two
    /// vendors ship the same NWL model (N1) and this is that model through the archive's spelling.</summary>
    private static IReadOnlyList<Output> BoxOutputs(XElement e)
    {
        var names = Names(e, "OutputParam");
        // SLOTS, NOT ITEMS. `Outputs`/`TcArchive.List` drop a `<n />` slot, and the ENO slot IS one — so
        // indexing the compacted list against `Names` named every later pin one place wrong, or dropped the
        // only wired pin outright. The CODESYS twin reads raw for the same reason.
        // And REQUIRED, holder and list, as `Outputs` requires them: `Slots` answers a missing list with an empty
        // one, which would read a box whose outputs this reader cannot find as a box with none — every `=> v` dropped.
        var type = BoxType(e);
        var holder = TcArchive.Obj(e, "OutputItems");
        if (holder is null || !holder.Elements("l2").Any(l => (string?)l.Attribute("n") == "OutputItems"))
            throw BoxRefusals.MissingList(BeckhoffDriver.Row.Display, type, "OutputItems");
        var slots = TcArchive.Slots(holder, "OutputItems");
        var eno = HasEno(e) ? 1 : 0;
        var outputs = new List<Output>();
        // 2R.5 (#23): a variable stored on the ENO slot is the named ENO pin, `ENO => lamp` (P5), as on CODESYS.
        if (eno == 1 && slots.Count > 0 && slots[0] is { } enoSlot && ReadOperand(enoSlot) is { Text.Length: > 0 } wired)
            outputs.Add(new Output(Box.EnoPin, wired, 0));
        for (var i = eno; i < slots.Count; i++)
        {
            if (slots[i] is not { } slot) continue;
            var operand = ReadOperand(slot);
            if (operand.Text.Length == 0) continue;      // a declared pin the engineer never wired
            // The SLOT travels with the pin: a positional `=> v` is spelled by the slot it fills (task 3.10).
            outputs.Add(new Output(Box.FormalAt(names, i), operand, i));
        }
        return outputs;
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
                var bits = TcArchive.RequireFlagBits(x, "an assignment target");
                var coil = Flags.CoilFromVendor((bits & TcArchive.FlagNegation) != 0, (bits & TcArchive.FlagSet) != 0);
                return op with
                {
                    Flags = op.Flags! with { Negated = coil.Negated, Set = coil.Set, Reset = coil.Reset },
                };
            }).ToList();

    /// <summary>An <c>Operand</c> object, every member REQUIRED as TwinCAT writes it on every operand (940 of 940). The text
    /// is a quoted string — <c>""</c> on an unwired pin or an unused output slot, never the explicit null, which only an
    /// Instance holds for "no instance" (<see cref="InstanceOf"/> asks that first). <c>Type</c> and <c>SymbolComment</c> are
    /// the IDE's metadata: null where it holds <c>""</c> or the explicit null (the model's "none"), but never absent.</summary>
    /// <summary>An item whose every target is a jump or a return, on the empty operand: TwinCAT's spelling of the rail
    /// there (see the <c>BoxTreeAssign</c> arm).</summary>
    internal static bool IsRailJump(IReadOnlyList<Operand> targets, Node value) =>
        targets.Count > 0 && targets.All(t => t.Flags is { Jump: true } or { Return: true }) &&
        value is Leaf { Operand.Text.Length: 0, Flags.IsNone: true };

    private static Operand ReadOperand(XElement o)
    {
        const string what = "an operand";
        return new Operand(
            TcArchive.RequireText(o, "Operand", what),
            Metadata(o, "Type"),
            Metadata(o, "SymbolComment"),
            TcArchive.RequireBool(o, "IsInstance", what),
            TcArchive.RequireBool(o, "LValue", what),
            ReadFlags(TcArchive.RequireFlagBits(o, what)));
    }

    /// <summary>An operand's metadata string — the explicit null and <c>""</c> both the model's "none" (Type holds both:
    /// 13 and 950 in the archives), absence refused.</summary>
    private static string? Metadata(XElement o, string name) =>
        TcArchive.RequireRaw(o, name, "an operand") is null ? null
            : TcArchive.RequireText(o, name, "an operand") is { Length: > 0 } t ? t : null;

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
    private static CallKind CallKindOf(XElement e) =>
        CallKinds.FromVendor(
            TcArchive.RequireRaw(e, "CallType", $"the '{BoxType(e)}' box")
            ?? throw new UnsupportedException(
                $"TwinCAT: the '{BoxType(e)}' box holds no value in 'CallType', where TwinCAT writes the member of every box " +
                "(207 of 207). Refusing rather than reading the call kind from a value the IDE did not state."),
            InstanceOf(e) != null);

    /// <summary>A box's FB instance, or null when it has none.
    ///
    /// <para><b>The PRESENCE of the member proves nothing.</b> The vendor writes an
    /// <c>&lt;o n="Instance" t="Operand"&gt;</c> on EVERY box and spells emptiness inside it, as an explicit
    /// <c>&lt;n n="Operand" /&gt;</c> null scalar - the same serializer writes real nulls that way everywhere,
    /// so the element is never evidence of a value. Testing the member instead of the scalar made
    /// <c>Instance</c> non-null for every box, so the text writer took its instance arm for
    /// anything outside the operator table and rendered the callee's NAME away:
    /// <c>xoutput := ( := xtest,  := xtest2);</c> - unparseable, so the POU could never be pushed back. It also
    /// made <c>CallKindOf</c> incapable of ever answering <c>Function</c>.</para></summary>
    private static Operand? InstanceOf(XElement e)
    {
        var inst = TcArchive.Obj(e, "Instance");
        if (inst == null) return null;
        // "No instance" is the explicit null (174 of 174 unnamed instances); a named one a quoted name. An Instance holding
        // `""` is neither, and no archive holds one: refused, not read as no instance.
        if (TcArchive.RequireRaw(inst, "Operand", "a box's Instance") is null) return null;
        if (TcArchive.RequireText(inst, "Operand", "a box's Instance").Length == 0)
            throw new UnsupportedException(
                $"TwinCAT: the '{BoxType(e)}' box's Instance names \"\", where TwinCAT writes the explicit null for no instance " +
                "and the instance's name otherwise.");
        return ReadOperand(inst);
    }
}
