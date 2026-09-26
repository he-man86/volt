using System;
using System.Collections.Generic;

namespace Volt.Engine.Format.Network;

/// <summary>
/// Volt's model of a graphical (FBD/LD) body: a list of networks, each holding statement TREES.
///
/// <para><b>Shaped on what the IDEs have, not on a file format.</b> It replaces <c>GraphModel</c>, whose own
/// summary described it as "a faithful, position-free projection of a PLCopenXML FBD/LD body ... wiring by
/// <c>localId</c> / <c>refLocalId</c> / <c>formalParameter</c> taken verbatim from the XML". That was PLCopen
/// with a C# face: node identity WAS the PLCopen attribute, a wire was a <c>refLocalId</c>, the network index
/// was recovered by dividing a <c>localId</c> by 10^10, and an unmodelled element was carried as a string of raw
/// XML inside the model. Every one of those is a fact about a document, not about a program.</para>
///
/// <para><b>What it is shaped on instead</b> is the 3S NWL object model, which BOTH vendors expose — CODESYS
/// hands over live objects, TwinCAT stores the same object graph serialized in its <c>.TcPOU</c>. Measured
/// 2026-08-28; see <c>openspec/changes/pou-transport-per-vendor/nwl-object-model.md</c>. The vendor's own
/// visitor, <c>IBoxTreeVisitor</c>, dispatches over a CLOSED SET OF THREE — <c>VisitOperand</c>,
/// <c>VisitBox</c>, <c>VisitAssign</c> — and <see cref="Leaf"/>, <see cref="Box"/> and <see cref="Assign"/> are
/// those three. The rest of the hierarchy exists because LD needs it, and is named for what it does.</para>
///
/// <para><b>A tree, not a graph.</b> The consequence runs through everything downstream: a tree cannot share a
/// node, so the "one leaf feeding two consumers" shape that has no valid FBD form — and that crashed TwinCAT's
/// importer — is unrepresentable rather than guarded against. Fan-out is explicit, through
/// a <see cref="Demux"/>, which is what the vendor holds.</para>
///
/// <para><b>Record equality is NOT structural.</b> These are records, but their collection members compare by
/// reference, so <c>==</c> on two equal bodies is false. Compare models through
/// the oracle's <c>NetworkModelEquality</c> (test/shared), which walks the lists — the network text v2 oracle checks
/// <c>Read(Write(m)) ≅ m</c> on MODELS, because a text round trip that is a fixed point can still have lost a
/// fact the vendor reader filled (a writer arm that drops a flag writes and reads back the same text).</para>
/// </summary>
public sealed record NetworkBody(BodyLanguage Language, IReadOnlyList<Network> Networks);

/// <summary>The two graphical languages Volt models. CFC, SFC and IL are NOT here and are not bodies in this
/// sense: they materialize as a marker and are refused on push. That is a POLICY about a VIEW rather than a
/// statement about storage — the vendor treats FBD, LD and IL as three views of ONE network
/// (<c>ActivateFBD</c> / <c>ActivateIL</c> / <c>NWLDisplayMode { LD, FBD, IL }</c>).</summary>
public enum BodyLanguage { Fbd, Ld }

/// <summary>One network. <see cref="Order"/> is the network's index as the author sees it in network text.
/// <para><see cref="Title"/>, <see cref="Label"/>, <see cref="Comment"/> and <see cref="Disabled"/> are carried
/// by BOTH vendors' <c>INetwork</c> (`Title` / `Label` / `Comment` / `OutCommented`), measured on each. They
/// were absent from the previous model because PLCopen carries none of the four — and worse, its export OMITS
/// a disabled network entirely, which is how a disabled network could be dropped from a running program. The
/// four are now carried, and a fan-out wire is a <see cref="Demux"/> - the vendor's own item.</summary>
public sealed record Network(
    int Order,
    string? Title,
    string? Label,
    string? Comment,
    bool Disabled,
    IReadOnlyList<Node> Trees);

/// <summary>A node in a network's tree. The three the vendor's visitor dispatches over are
/// <see cref="Leaf"/>, <see cref="Box"/> and <see cref="Assign"/>; the remaining three are LD structures.
/// <para><see cref="Flags"/> is VIRTUAL so that a node the vendor holds no flag on (<see cref="Demux"/>,
/// <see cref="Parallel"/>, DIALECT N20) can close the inherited <c>init</c>: without that, <c>with { Flags = … }</c>
/// built a flagged wire or Parallel that every writer passes through as the bare node — the silent drop N20 is.</para></summary>
public abstract record Node(Flags Flags)
{
    public virtual Flags Flags { get; init; } = Flags;

    /// <summary>The <c>init</c> of a node that holds no flag: <see cref="Flags.None"/> is its one value, anything else
    /// is refused loudly — never kept, never dropped.</summary>
    private protected static void RefuseFlag(Flags value, string what)
    {
        if (!value.IsNone)
            throw new ArgumentException(
                $"{what} holds no flag (DIALECT N20: the IDE stores none, and a bit set on one ran as the bare value).",
                nameof(Flags));
    }
}

/// <summary>A bare operand in tree position — the vendor's <c>BoxTreeOperand</c>, its <c>VisitOperand</c> arm.</summary>
public sealed record Leaf(Operand Operand, Flags Flags) : Node(Flags);

/// <summary>An assignment — <c>BoxTreeAssign</c>, the <c>VisitAssign</c> arm. <see cref="Targets"/> is a LIST
/// because the vendor's <c>Outputs</c> is one (<c>OutputItemList</c>: <c>AppendOutputItem</c> /
/// <c>InsertOutputItem</c> / <c>RemoveOutputItem</c>, enumerated through <c>List</c>): one value can be
/// assigned to several l-values in a single network.
/// <para>This record also carries control flow: with <c>Flags.Jump</c> the target is the destination label and
/// the value is the condition, and a return written by Volt may have no target. An UNCONDITIONAL jump or return is
/// drawn on a rung nothing drives, so its value is the empty <see cref="Terminator"/>. <see cref="Value"/> is never
/// null: an item holding nothing is what neither IDE would save (DIALECT C11), and census 1.2 found the empty
/// Terminator the ONE representation of "unconnected" (RValue null 0, Terminator 3), so the readers refuse a vendor
/// null by name (task 1.10) rather than carry a second spelling of the same fact.
/// The Jump/Return bit rides on the target operand as well as the item (DIALECT C13); a return's target is the
/// vendor's constant <c>???</c>.</para></summary>
public sealed record Assign(Node Value, IReadOnlyList<Operand> Targets, Flags Flags) : Node(Flags);

/// <summary>A call or operator — <c>BoxTreeBox</c>, the <c>VisitBox</c> arm. Covers every shape the previous
/// model spread across `Block`, its EN pin, and a separate ST-code field:
/// <list type="bullet">
/// <item><see cref="Instance"/> non-null: a function-block instance call.</item>
/// <item><see cref="Enable"/> non-null: an enable is actually WIRED, and this is its expression. It comes
/// from the vendor's <c>En</c> pin, NOT from its <c>EnEno</c> flag — measured in a real project, <c>EnEno</c>
/// is <c>true</c> on all 1,256 boxes including every plain <c>AND</c>/<c>OR</c>, because it marks that the box
/// SUPPORTS EN/ENO. Keying on it would wrap every operator in the project in an <c>IF en THEN …</c>.
/// On the vendor this is a BOX PROPERTY (<c>EnEno</c> / <c>En</c> / <c>Eno</c>), not a pin found by name —
/// the old model searched the inputs for one literally called "EN", which is a PLCopen spelling. It is a
/// <see cref="Node"/> rather than a flag because the enable is a wired expression, and network text renders
/// it as the box's <c>en*</c> echo that downstream boxes chain off.</item>
/// <item><see cref="StCode"/>: a CODESYS Execute box — a box whose call is raw ST
/// (<c>BoxTreeBox.STSnippet</c> / <c>ProvidesSTSnippet</c>). Emitted verbatim between network text's
/// <c>EXECUTE</c> markers so it round-trips byte-for-byte.</item>
/// </list></summary>
public sealed record Box(
    string Type,
    Operand? Instance,
    CallKind Kind,
    IReadOnlyList<Input> Inputs,
    IReadOnlyList<Output> Outputs,
    Node? Enable,
    string? StCode,
    Flags Flags,
    int? MainOutputIndex = null,
    int? ConnectedSlot = null,
    IReadOnlyList<string?>? OutputTypes = null,
    bool? HasEnoOutput = null) : Node(Flags)
{
    // MainOutputIndex / ConnectedSlot / OutputTypes / HasEnoOutput are network text v2 facts
    // (openspec/changes/network-text-literal-nwl, review 7.3 and 1.17). They are OPTIONAL with null meaning
    // "not read" so that v1, which never consults them, builds and renders exactly as before; the drivers fill
    // them in phase 2. Null is NOT a default the v2 writer may assume a value for — it refuses by name instead.
    //
    //  MainOutputIndex  the vendor's BoxTreeBox.MainOutputIndex: which output slot is the box's result. It is
    //                   STORED, not "slot 0 by convention": measured 0 on 456 boxes, 1 on 3 call boxes (Lenze
    //                   call_FirstErrorCapture_FB), None on 823 — so null is a real vendor value as well as "unread".
    //  ConnectedSlot    on a CONSUMED box (an Assign's value, a box input, a Demux/Parallel input), the output
    //                   slot its consumer is wired to. The spec's slot rule reads it: the main output writes no
    //                   suffix, ENO writes `.ENO`, any other slot is the marker. Null on a top-level box.
    //  OutputTypes      the vendor's OutputParams.Types, index-aligned with the output SLOTS (not with
    //                   Outputs, which holds only the wired ones). v2 declares a wire fed by this box with the
    //                   type of the connected slot; a null list or entry is an unknown type, refused by name.
    //  HasEnoOutput     whether the box has an ENO output — its OutputParams.Names start "ENO" (HasEnoSlot), which
    //                   makes output slot 0 the ENO and, on such a box, its main output (DIALECT N16). It is NOT
    //                   "the box has EN": the two are independent (census 1.6 — 40 enabled comparisons have EN and
    //                   one data output; Lenze `Dryer` declares ENO without EN), so it cannot be derived from Enable.
    //                   v2 spells a consumer of the ENO output `.ENO` and never gives ENO an `=>` pin; null is "not
    //                   read", which the writer refuses wherever the answer decides the text.


    /// <summary>The vendor's name for the enable pin. It occupies INPUT SLOT 0 of a box that shows EN/ENO,
    /// and the vendor says so by naming that slot — see <see cref="HasEnableSlot"/>.</summary>
    public const string EnablePin = "EN";

    /// <summary>The vendor's literal marker for a call box whose INSTANCE has not been named — CODESYS stores
    /// the string <c>???</c> in the box's instance operand and draws it in the editor, so the engineer sees the
    /// compile error. It is content, not a Volt spelling (which is why network text has no magic token for an
    /// unconnected pin — see <c>NetworkTextReader.IsEmptyOperand</c>).
    ///
    /// <para><b>Such a box still has a real TYPE, and network text could not carry it.</b> Measured on
    /// `Lenze_MID-S100`'s `POU.prg` (<c>scripts/probe-nwl-dump.py</c>): four boxes, each
    /// <c>BoxType='L_MC1P_AxisBasicControlV2'</c> / <c>'L_TT1P_BasicMotionBase'</c> / … with
    /// <c>Instance='???'</c>. The format names an FB call ONCE — the instance — and the push recovers the type
    /// from the declaration that instance is declared in. <c>???</c> is declared nowhere, so the type was lost
    /// on pull and the push was refused: the POU could be pulled and never pushed back. The type is therefore
    /// written inline for exactly this instance (<c>??? : TYPE(PIN := …)</c>, docs/network-text.html#unnamed-instance).</para></summary>
    public const string UnnamedInstance = "???";

    /// <summary>Whether the box's input slot 0 is the ENABLE WIRE rather than a data pin.
    ///
    /// <para><b>The enable's expression is an ORDINARY INPUT ITEM, and the <c>En</c> member is not it.</b>
    /// Measured across 373 real networks (<c>scripts/probe-nwl-census.py</c>): <c>En</c> is a Boolean on 468
    /// boxes and null on 814, and a tree on NONE — it is the "EN/ENO is shown on this box" flag. The wire
    /// itself arrives as <c>InputItemList[0]</c>, and the vendor names that slot <c>"EN"</c> in
    /// <c>InputParams</c> on 220 of 220 boxes that have one. Live CODESYS agrees from the write side, in a
    /// type error: assigning a tree to <c>En</c> answers "Object of type BoxTreeOperand cannot be converted
    /// to type System.Nullable`1[System.Boolean]".</para>
    ///
    /// <para><b>What reading it as a data pin cost.</b> The rung a ladder box sits on IS its enable, so every
    /// such box gained a leading BOOLEAN operand: <c>MOVE(EN := rung, IN := 0)</c> materialized as
    /// <c>MOVE(g185, 0)</c> and <c>MUL(EN := rung, …)</c> as <c>(g185 * AUTOSPEED * 10)</c> — a BOOL
    /// multiplied by an INT, which the graphical build oracle reported as a type error on a project that
    /// builds clean. Pushed back, it would build a box with one data pin too many.</para></summary>
    public static bool HasEnableSlot(IReadOnlyList<string?> formals) =>
        formals.Count > 0 && string.Equals(formals[0], EnablePin, StringComparison.Ordinal);

    /// <summary>The vendor's name for the enable ECHO — output slot 0 of a box that shows EN/ENO.</summary>
    public const string EnoPin = "ENO";

    /// <summary>Whether the box's output slot 0 is the <c>ENO</c> echo rather than a data pin. The mirror of
    /// <see cref="HasEnableSlot"/>, and measured the same way: <c>OutputParams.Names[0] == "ENO"</c> on 181 of
    /// the boxes that have one, and the slot itself is null on every one of them — the rung's continuation is
    /// the enclosing <see cref="Assign"/>, never a variable.</summary>
    public static bool HasEnoSlot(IReadOnlyList<string?> formals) =>
        formals.Count > 0 && string.Equals(formals[0], EnoPin, StringComparison.Ordinal);

    /// <summary>The formal name of pin <paramref name="slot"/>, or null when it is POSITIONAL.
    ///
    /// <para>The vendor's <c>Names</c> array is INDEX-ALIGNED with the item list and may be SHORTER than it —
    /// an extensible operator names only the pins it has names for. Both drivers used to require the two
    /// lengths to be EQUAL and fall back to naming nothing, which split the format down the middle on a
    /// detail no one chose: 50 boxes in one project happened to match and rendered <c>f(EN := g0, …)</c>,
    /// leaking the enable pin into the text as a data argument, while the other 169 matched on nothing and
    /// lost every pin name they had.</para></summary>
    public static string? FormalAt(IReadOnlyList<string?> formals, int slot) =>
        slot < formals.Count && !string.IsNullOrEmpty(formals[slot]) ? formals[slot] : null;
}

/// <summary>An LD parallel branch — <c>BoxTreeParallel</c> (contacts in parallel = a boolean OR of rungs).
/// <see cref="Input"/> is the rung feeding the branch; <see cref="Branches"/> are the parallel paths.
///
/// <para><b>It carries no <see cref="Flags"/></b> (always <see cref="Flags.None"/>), because the vendor holds none:
/// <c>BoxTreeParallel.Flags</c> hands out an object the node never stores, so a bit set on it is gone before the
/// commit and ran as the bare value (DIALECT N20). A model able to say "negated Parallel" let a writer set that bit
/// and report success; a negation belongs on a branch or on the consumer.</para>
///
/// <para><see cref="Mode"/> has no default: a reader states the vendor's value, a text states its own. Defaulting it
/// hid that no reader read it, and a new vendor Parallel is <c>Sequential</c> (N20) while the corpus is
/// <c>BoxShortCircuit</c> — any default is wrong for one of them.</para></summary>
public sealed record Parallel(
    Node? Input,
    IReadOnlyList<Node> Branches,
    ParallelMode Mode) : Node(Flags.None)
{
    public override Flags Flags { get => Flags.None; init => RefuseFlag(value, "a Parallel"); }
}

/// <summary>The vendor's <c>BoxTreeParallel.Mode</c>. Carried because a non-default value EXISTS in a real
/// project: census 2026-09-26, 17 Parallels in Lenze_MID-S100 — <c>BoxShortCircuit</c> 16, <c>Sequential</c> 1
/// (MainDrive network 1). A model without it would rebuild that branch in the default mode on push, silently.
/// Both readers read it and the CODESYS writer sets it; there is no default (see <see cref="Parallel"/>). Only the
/// two measured members are listed; an unmeasured one must be refused by the reader, not mapped onto these.</summary>
public enum ParallelMode { BoxShortCircuit, Sequential }

/// <summary>The one reading of the vendor's <c>OperationMode</c> by member name, shared by both readers so the two
/// vendors cannot disagree on it. A name outside the two measured members — or none at all, where a TwinCAT archive
/// might omit it — is refused by name (the marker): mapping it onto either would push the other mode.</summary>
public static class ParallelModes
{
    public static ParallelMode FromVendor(string? name) => name switch
    {
        nameof(ParallelMode.BoxShortCircuit) => ParallelMode.BoxShortCircuit,
        nameof(ParallelMode.Sequential) => ParallelMode.Sequential,
        _ => throw new Volt.Engine.Format.Body.UnrepresentableBodyException(
            "an unmeasured Parallel mode",
            $"a parallel branch has the mode '{name ?? "(none)"}'; the measured modes are BoxShortCircuit and Sequential."),
    };

    /// <summary>Whether two networks hold their Parallels in the same modes, in walk order. Both writers' no-change
    /// gates compare v1 TEXT, which spells no mode, so without this a mode-only edit was "unchanged": CODESYS never
    /// rebuilt the network and TwinCAT never reached its refusal, and each push reported success.</summary>
    public static bool Agree(Network a, Network b) =>
        System.Linq.Enumerable.SequenceEqual(In(a.Trees), In(b.Trees));

    private static IEnumerable<ParallelMode> In(IEnumerable<Node?> nodes)
    {
        foreach (var n in nodes)
        {
            if (n is Parallel p) yield return p.Mode;
            foreach (var m in In(Children(n))) yield return m;
        }
    }

    private static IEnumerable<Node?> Children(Node? n)
    {
        switch (n)
        {
            case Parallel p:
                yield return p.Input;
                foreach (var br in p.Branches) yield return br;
                break;
            case Assign a:
                yield return a.Value;
                break;
            case Box b:
                yield return b.Enable;
                foreach (var i in b.Inputs) yield return i.Value;
                break;
            case Demux d:
                yield return d.Input;
                break;
        }
    }
}

/// <summary>Flag bits a vendor object reports where the model has no place for them, refused by name on READ. One
/// definition both vendor readers call — like <see cref="ParallelModes"/> — so the marker and the rule cannot drift
/// between the vendors; only the message's vendor name differs.</summary>
public static class UnheldFlags
{
    /// <summary>DIALECT N20: the IDE holds no flag on a <c>BoxTreeDemux</c> or <c>BoxTreeParallel</c> (the getter hands
    /// out an object the node never stores), so <see cref="Demux"/> and <see cref="Parallel"/> have no place for one.
    /// A bit read there anyway is the marker, never dropped on the way into a model that cannot say it.</summary>
    public static void RefuseOnNode(string vendor, string what, Flags flags)
    {
        if (!flags.IsNone)
            throw new Volt.Engine.Format.Body.UnrepresentableBodyException(
                "a flag on " + what,
                $"{vendor}: {what} carries a modifier, and the IDE holds none there (DIALECT N20). Edit this network in the IDE.");
    }

    /// <summary>Census 1.1: no Assign ITEM carries a negation or an edge — its operands and targets do — while
    /// <see cref="Assign.Flags"/> is where Jump/Return ride. Neither text has a position for such a bit: v1 printed it
    /// on the VALUE, so a re-read moved it onto the operand (and onto a wire reference, text its own push refuses).</summary>
    public static bool OnAssignItem(Flags flags) => flags.Negated || flags.Rising || flags.Falling;

    public const string AssignItemMarker = "a flag on an Assign item";

    public static void RefuseOnAssignItem(string vendor, Flags flags)
    {
        if (OnAssignItem(flags))
            throw new Volt.Engine.Format.Body.UnrepresentableBodyException(
                AssignItemMarker,
                $"{vendor}: an assignment item carries a negation or an edge of its own, which no measured project holds " +
                "(census 1.1) and the text has no position for. Edit this network in the IDE.");
    }
}

/// <summary>The end of an LD rung, and the model's one spelling of "nothing drives this" — <c>BoxTreeTerminator</c>
/// with no input. The vendor type HAS an <c>Input</c>, and it is not carried: census 1.4 found none holding one across
/// five real projects, so the readers refuse such a terminator by name (the marker) instead of the model keeping a
/// field no measured body fills and no spelling exists for (task 1.10).</summary>
public sealed record Terminator(Flags Flags) : Node(Flags);

/// <summary>
/// <b>Fan-out.</b> A wire feeding more than one consumer — the vendor's <c>BoxTreeDemux</c>, keyed by
/// <see cref="VarId"/>. With <see cref="Input"/> non-null it DEFINES the wire; with <see cref="Input"/> null it
/// REFERENCES the definition carrying the same id, and the same id may be referenced any number of times.
///
/// <para><b>This is what network text has always spelled as a named <c>LET g := …</c> plus its uses</b>, and it
/// is the mechanism `split points` were wrongly assumed to be. Measured in a real ladder project: 573
/// occurrences — the fourth most common item of any kind — against ZERO split points across 356 networks. The
/// shape is unmistakable:</para>
/// <code>
/// BoxTreeDemux VarId=24
///   .Input BoxTreeOperand -> Operand 'EnableDrivePower'    // the definition
/// BoxTreeAssign .RValue BoxTreeBox AND .InputItemList
///   BoxTreeDemux VarId=24                                  // a reference
/// </code>
///
/// <para><see cref="Type"/> is the type network text v2 DECLARED the wire with (<c>VAR_TEMP g1 : INT;</c>) — a
/// fact of the TEXT, not of the vendor, whose Demux holds no type. The v2 reader fills it on a definition and the
/// v2 writer declares it where the producer does not say the type by itself (a box read from text carries no
/// <c>OutputTypes</c>): without it, <c>g1 := ADD(a, b);</c> read back from the engineer's own file could not be
/// written again. A driver never reads it and never fills it; null means "no text declared one" (every
/// vendor-read model, and v1).</para>
///
/// <para><b>It carries no <see cref="Flags"/></b> (always <see cref="Flags.None"/>), definition or reference: the
/// vendor's <c>BoxTreeDemux.Flags</c> hands out an object the node never stores, so a negation or an edge set there
/// is gone before the commit and the wire runs bare (DIALECT N20) — census 1.1's zero item flags on a Demux is this
/// fact, not chance. With a field for it, the v1 text <c>out := NOT g1;</c> became a flagged reference that the
/// CODESYS writer "wrote" and the IDE ran as <c>out := g1</c>. A modifier rides the wire's producer or a consumer.</para>
/// </summary>
public sealed record Demux(int VarId, Node? Input, string? Type = null) : Node(Flags.None)
{
    public override Flags Flags { get => Flags.None; init => RefuseFlag(value, "a wire (Demux)"); }
}

/// <summary>One input pin: the formal parameter name where the vendor supplies one, the sub-tree feeding it,
/// and that pin's own modifiers (the vendor keeps these in <c>BoxTreeBox.InputFlags</c>, per pin).</summary>
public sealed record Input(string? Formal, Node Value, Flags Flags);

/// <summary>One OUTPUT pin of a box, wired to an l-value — the mirror of <see cref="Input"/>, and it carries a
/// name for the same reason: the vendor's <c>OutputParams.Names</c> is index-aligned with <c>Outputs</c>, so
/// pin 1 of <c>fc_MeanValue</c> is <c>oMeanValue</c> and pin 1 of <c>MOVE</c> is unnamed.
///
/// <para><b><see cref="Formal"/> null means the box's RESULT</b>, the pin ST spells by assigning the call —
/// <c>x := MOVE(v)</c> — while a named pin is <c>f(… , oMeanValue =&gt; x)</c>. That split is IEC's own, not a
/// Volt convention: a function's return value is assigned and its <c>VAR_OUTPUT</c>s use <c>=&gt;</c>.</para>
///
/// <para><b>This did not exist, and box outputs were simply DROPPED.</b> <c>Box.Outputs</c> was a bare
/// operand list that <c>NetworkTextWriter</c> only ever consulted for name collection — never rendered — so
/// every pin an engineer wired straight off a box vanished from the text: <c>MOVE(EN := rung, IN := 0)</c>
/// with its output on <c>TempI</c> materialized as <c>MOVE(0)</c>, and `TempI` was nowhere in the file. 208 wired
/// output pins on 171 boxes across 373 networks (`scripts/nwl-census.log`). The push side knew: it REFUSED any box carrying outputs, because
/// "network text has no form for them" — which was true, and is what this record exists to end.</para>
///
/// <para><see cref="Slot"/> is the pin's OUTPUT SLOT index (network text v2, review 7.3). v1 dropped null
/// slots while reading, so a list position is not a slot: positional <c>=&gt; v</c> pins fill the slots that
/// remain after the one a consumer is connected to, and that needs the stored index. Null means "not read"
/// (v1, and until the drivers fill it in phase 2), never "slot = list position".</para></summary>
public sealed record Output(string? Formal, Operand Value, int? Slot = null);

/// <summary>A variable, literal or expression. <see cref="Type"/> is the vendor's declared type when it
/// supplies one — read-only metadata used to declare a wire's temp; it is NOT load-bearing for round-trip.
/// <para><b>An operand carries its OWN modifiers.</b> Measured in a real ladder project: an assignment target
/// came back as <c>Operand OperandExpr=… IsLValue=True Flags=Negation,Set</c> — a negated SET coil, with the
/// modifiers on the TARGET rather than on the assignment. Putting flags only on the tree node (as the first
/// draft did) would have dropped both.</para></summary>
public sealed record Operand(
    string Text,
    string? Type = null,
    string? Comment = null,
    bool IsInstance = false,
    bool IsLValue = false,
    Flags? Flags = null);

/// <summary>How the box is called. The vendor's <c>BoxTreeBox.CallType</c>.</summary>
public enum CallKind { Operator, Function, FunctionBlock }

/// <summary>
/// THE VENDOR'S <c>CallType</c>, DECODED — one rule, because it is ONE ENUM on both vendors (DIALECT N1).
///
/// <para><c>_3S.CoDeSys.Core.LanguageModel.Operator</c> is what CODESYS holds live and what a <c>.TcPOU</c>
/// serializes by member name (<c>&lt;v n="CallType" t="Operator"&gt;FunctionBlock&lt;/v&gt;</c> — the
/// <c>t=</c> is the ENUM TYPE and the text is the MEMBER). The two drivers each invented their own reading of
/// it and BOTH got a function-block call wrong:</para>
/// <code>
///   TwinCAT   any non-null CallType            -> Operator
///   CODESYS   any value except "None"          -> Operator
/// </code>
/// <para>Neither has a <c>FunctionBlock</c> arm, so a resolved FB call classified as an OPERATOR on both —
/// latent only because nothing consumes an archive-derived <c>Kind</c> yet.</para>
///
/// <para><b>MEASURED, not inferred.</b> The member set comes from the committed archives (<c>And</c> 8,
/// <c>Or</c> 6, <c>FunctionBlock</c> 5, <c>None</c> 2) and from <c>scripts/nwl-boxoutputs.log</c>, which
/// records the live CODESYS side: a freshly constructed box reads <c>Operator.None</c> and the SAME box reads
/// <c>Operator.Move</c> after the IDE resolves it on reload. So <c>None</c> means "not resolved as an
/// operator", which is why an instance is what distinguishes the two call kinds under it — the reading
/// CODESYS already had, kept.</para>
/// </summary>
public static class CallKinds
{
    /// <param name="callType">The enum MEMBER name, or null when the box carries none.</param>
    /// <param name="hasInstance">Whether the box names a function-block instance.</param>
    public static CallKind FromVendor(string? callType, bool hasInstance)
    {
        if (string.Equals(callType, nameof(CallKind.FunctionBlock), System.StringComparison.OrdinalIgnoreCase))
            return CallKind.FunctionBlock;

        // An operator names itself — And, Or, Move. `None` is the vendor saying it resolved no operator, and
        // an absent member is a box the IDE has not resolved at all; both fall through to the instance.
        if (!string.IsNullOrEmpty(callType) &&
            !string.Equals(callType, "None", System.StringComparison.OrdinalIgnoreCase))
            return CallKind.Operator;

        return hasInstance ? CallKind.FunctionBlock : CallKind.Function;
    }
}


/// <summary>
/// Item modifiers. These are EXACTLY the vendor's <c>IFlags</c> bit-field —
/// <c>Negation, Set, Jump, Return, Rtrig, Ftrig</c> — measured identical on CODESYS and TwinCAT, and confirmed
/// against the named booleans on <c>IFlags</c> rather than inferred from a bit pattern.
///
/// <para><b><see cref="Jump"/> and <see cref="Return"/> are flags here, not statement kinds</b>, and that is a
/// correction. It is tempting to promote them — network text spells them <c>JMP name;</c> and <c>RETURN;</c>,
/// so they LOOK like statements — but the IDEs model them as modifiers on an item, and the jump target is the
/// destination network's <see cref="Network.Label"/>. Promoting them would be re-interpreting the vendor's
/// model to suit a rendering, which is the mistake the previous model made wholesale.</para>
///
/// <para><b><see cref="Reset"/> has no BIT of its own, and that is the vendor's encoding, not a gap.</b> This
/// used to read "the one field here with no vendor counterpart … how a reset coil actually reaches the IDE is
/// UNMEASURED". It is measured now, and the answer is that <c>Negation</c> and <c>Set</c> on an assignment
/// TARGET are two bits spelling one enum — see <see cref="CoilFromVendor"/>.</para>
/// </summary>
public sealed record Flags(
    bool Negated = false,
    bool Set = false,
    bool Reset = false,
    bool Jump = false,
    bool Return = false,
    bool Rising = false,
    bool Falling = false)
{
    public static readonly Flags None = new();
    public bool IsNone => !Negated && !Set && !Reset && !Jump && !Return && !Rising && !Falling;

    /// <summary>The coil kind the vendor's two bits spell, on an ASSIGNMENT TARGET. <c>IFlags</c> has
    /// <c>Negation</c> and <c>Set</c> and no <c>Reset</c>, because those two bits are one enum with four values
    /// and not two independent modifiers.
    ///
    /// <para><b>Measured, by asking the vendor rather than reading the logic around it.</b> CODESYS's own
    /// PLCopen export names coil storage outright, so exporting every POU in a real project that has a
    /// non-plain coil and pairing the two views settles it. All 17 POUs agree, exactly, with no residue
    /// (<c>scripts/probe-nwl-coils.py</c> · <c>scripts/nwl-coils.log</c>):</para>
    /// <code>
    ///   NWL target flags        CODESYS PLCopen export
    ///   (none)              ->  negated="false" storage="none"
    ///   Set                 ->  negated="false" storage="set"      TrayFiller x27, ServoControl x7, …
    ///   Negation + Set      ->  negated="false" storage="reset"    TrayFiller x54, ServoControl x19, …
    /// </code>
    ///
    /// <para><b>What it cost to have this wrong.</b> <c>Negation</c> was mapped to <see cref="Negated"/> and
    /// <c>Set</c> to <see cref="Set"/>, independently — so a RESET coil read as a negated SET coil, the text
    /// writer renders no modifier on a target, and every reset coil in a project materialized as a plain
    /// <c>SET</c>. 128 of them in one real project, each one INVERTED: `GeneralProgramFlags` network 0, whose
    /// comment is "Always Off", pulled as <c>AlwaysOff := AlwaysOff SET;</c>. Pushed back, the flag that must
    /// stay false latches true. Nothing in git showed it, because the text Volt wrote was self-consistent.</para>
    ///
    /// <para><c>negated="true"</c> on a coil does not occur anywhere in the surveyed project, so the fourth
    /// combination — <c>Negation</c> WITHOUT <c>Set</c> — is unobserved on a target. It is carried as
    /// <see cref="Negated"/> rather than guessed at or refused: refusing makes the body unreadable, and an
    /// unreadable body loses the whole POU.</para></summary>
    public static Flags CoilFromVendor(bool negation, bool set) => (negation, set) switch
    {
        (false, false) => None,
        (false, true) => None with { Set = true },
        (true, true) => None with { Reset = true },
        (true, false) => None with { Negated = true },
    };

    /// <summary>The inverse of <see cref="CoilFromVendor"/> — the two bits a coil kind is written back as.
    /// The pair must round-trip, and <c>CoilBitsRoundTrip</c> gates that they do.</summary>
    public (bool Negation, bool Set) VendorCoilBits() => (Reset || Negated, Set || Reset);

    /// <summary>These item flags, plus the CONTROL-FLOW bits carried by an assignment's TARGET operands.
    ///
    /// <para><b>Both vendors keep <see cref="Jump"/> and <see cref="Return"/> on the operand, not on the item</b>
    /// — measured on a live SP21 project: a RETURN coil an engineer drew reads back as
    /// <c>out[0] = '???' type='BOOL' flags=Return</c> on a <c>BoxTreeAssign</c> whose own flags are none. Reading
    /// them from the item alone only ever worked for control flow VOLT had written, because Volt was the only
    /// thing that put the bit there.</para>
    ///
    /// <para><b>Jump was fixed here once and Return was left behind</b>, which is why this is one call and not
    /// two conditions inlined per driver. The cost of the omission is not a missing modifier: a return coil has
    /// no operand to name, so the vendor writes <c>???</c> in it, and the missed bit turned an engineer's
    /// <c>RETURN</c> into <c>??? := cond;</c> — a coil assigning to the unresolved-instance marker. That text is
    /// refused on push, so the POU could be pulled and never pushed back, and the graphical build oracle read it
    /// as a compile error on a project that builds clean.</para></summary>
    public Flags WithControlFlowFrom(IEnumerable<Operand> targets)
    {
        bool jump = Jump, ret = Return;
        foreach (var t in targets)
        {
            if (t.Flags is not { } f) continue;
            jump |= f.Jump;
            ret |= f.Return;
        }
        return jump == Jump && ret == Return ? this : this with { Jump = jump, Return = ret };
    }
}
