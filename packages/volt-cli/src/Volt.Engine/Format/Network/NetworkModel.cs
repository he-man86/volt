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
/// <para><b>Structural equality is deliberately NOT relied upon.</b> These are records, but their collection
/// members compare by reference. Compare rendered network text, never models — the same rule
/// <c>GraphModel</c> carried, and for the same reason.</para>
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
/// <see cref="Leaf"/>, <see cref="Box"/> and <see cref="Assign"/>; the remaining three are LD structures.</summary>
public abstract record Node(Flags Flags);

/// <summary>A bare operand in tree position — the vendor's <c>BoxTreeOperand</c>, its <c>VisitOperand</c> arm.</summary>
public sealed record Leaf(Operand Operand, Flags Flags) : Node(Flags);

/// <summary>An assignment — <c>BoxTreeAssign</c>, the <c>VisitAssign</c> arm. <see cref="Targets"/> is a LIST
/// because the vendor's <c>Outputs</c> is one (<c>OutputItemList</c>: <c>AppendOutputItem</c> /
/// <c>InsertOutputItem</c> / <c>RemoveOutputItem</c>, enumerated through <c>List</c>): one value can be
/// assigned to several l-values in a single network.
/// <para><see cref="Value"/> is NULLABLE and <see cref="Targets"/> may be empty, because this record also
/// carries control flow: with <c>Flags.Jump</c> the target is the destination label and the value is the
/// (optional) condition; with <c>Flags.Return</c> there is no target at all. An unconditional
/// <c>RETURN;</c> is therefore <c>Assign(null, [], Flags{Return})</c>. <b>The vendor shape for the
/// unconditional case is NOT measured</b> — `IFlags` carries the Jump/Return bits, but which item holds them
/// and what its RValue is when there is no condition has not been seen on a real body. Settle it against a
/// fixture with a jump before the adapter relies on it.</para></summary>
public sealed record Assign(Node? Value, IReadOnlyList<Operand> Targets, Flags Flags) : Node(Flags);

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
    IReadOnlyList<Operand> Outputs,
    Node? Enable,
    string? StCode,
    Flags Flags) : Node(Flags);

/// <summary>An LD parallel branch — <c>BoxTreeParallel</c> (contacts in parallel = a boolean OR of rungs).
/// <see cref="Input"/> is the rung feeding the branch; <see cref="Branches"/> are the parallel paths.</summary>
public sealed record Parallel(Node? Input, IReadOnlyList<Node> Branches, ParallelMode Mode, Flags Flags)
    : Node(Flags);

/// <summary>The end of an LD rung — <c>BoxTreeTerminator</c>.</summary>
public sealed record Terminator(Node? Input, Flags Flags) : Node(Flags);

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
/// </summary>
public sealed record Demux(int VarId, Node? Input, Flags Flags) : Node(Flags);

/// <summary>One input pin: the formal parameter name where the vendor supplies one, the sub-tree feeding it,
/// and that pin's own modifiers (the vendor keeps these in <c>BoxTreeBox.InputFlags</c>, per pin).</summary>
public sealed record Input(string? Formal, Node Value, Flags Flags);

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

/// <summary>LD parallel semantics — the vendor's <c>BoxTreeParallel.Mode</c>.</summary>
public enum ParallelMode { Or, And }

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
/// <para><b><see cref="Reset"/> is the one field here with no vendor counterpart</b>, and it is present
/// deliberately. `IFlags` has `Set` and no `Reset`, but network text — a PUBLISHED format, with `RESET` in its
/// grammar and in engineers' committed `.fb` files — requires it. The format is fixed and the model serves the
/// format; dropping the field to match the bit-field would silently change what Volt can express. How a reset
/// coil actually reaches the IDE is UNMEASURED (it may be `Set = false` on a coil item, or a distinct item)
/// and must be settled against a real LD fixture before the adapter writes one.</para>
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
}
