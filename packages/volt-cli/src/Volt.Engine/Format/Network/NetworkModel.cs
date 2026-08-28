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
/// <see cref="Network.SplitPoints"/>.</para>
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
/// fields are not a TwinCAT extra; PLCopen was the lossy party.</para>
/// <para><see cref="SplitPoints"/> is fan-out, made explicit: the vendor keeps a per-network list of operands
/// reachable through <c>GetSplitPoint</c> / <c>AppendSplitPoint</c>. A split point is a wire that feeds more
/// than one consumer, and it is what network text spells as a named <c>LET g1 := …</c>. In a graph model this
/// was implicit in the reference count; here it is a value, so the writer no longer has to re-derive it.</para></summary>
public sealed record Network(
    int Order,
    string? Title,
    string? Label,
    string? Comment,
    bool Disabled,
    IReadOnlyList<Node> Trees,
    IReadOnlyList<Operand> SplitPoints);

/// <summary>A node in a network's tree. The three the vendor's visitor dispatches over are
/// <see cref="Leaf"/>, <see cref="Box"/> and <see cref="Assign"/>; the remaining three are LD structures.</summary>
public abstract record Node(Flags Flags);

/// <summary>A bare operand in tree position — the vendor's <c>BoxTreeOperand</c>, its <c>VisitOperand</c> arm.</summary>
public sealed record Leaf(Operand Operand, Flags Flags) : Node(Flags);

/// <summary>An assignment — <c>BoxTreeAssign</c>, the <c>VisitAssign</c> arm. <see cref="Targets"/> is a LIST
/// because the vendor's <c>Outputs</c> is one (<c>OutputItemList</c>: <c>AppendOutputItem</c> /
/// <c>InsertOutputItem</c> / <c>RemoveOutputItem</c>, enumerated through <c>List</c>): one value can be
/// assigned to several l-values in a single network.</summary>
public sealed record Assign(Node Value, IReadOnlyList<Operand> Targets, Flags Flags) : Node(Flags);

/// <summary>A call or operator — <c>BoxTreeBox</c>, the <c>VisitBox</c> arm. Covers every shape the previous
/// model spread across `Block`, its EN pin, and a separate ST-code field:
/// <list type="bullet">
/// <item><see cref="Instance"/> non-null: a function-block instance call.</item>
/// <item><see cref="EnEno"/>: the box has EN/ENO pins. On the vendor this is a BOX PROPERTY
/// (<c>EnEno</c> / <c>En</c> / <c>Eno</c>), not a pin found by name — the old model looked for an input
/// literally called "EN".</item>
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
    bool EnEno,
    string? StCode,
    Flags Flags) : Node(Flags);

/// <summary>An LD parallel branch — <c>BoxTreeParallel</c> (contacts in parallel = a boolean OR of rungs).
/// <see cref="Input"/> is the rung feeding the branch; <see cref="Branches"/> are the parallel paths.</summary>
public sealed record Parallel(Node? Input, IReadOnlyList<Node> Branches, ParallelMode Mode, Flags Flags)
    : Node(Flags);

/// <summary>The end of an LD rung — <c>BoxTreeTerminator</c>.</summary>
public sealed record Terminator(Node? Input, Flags Flags) : Node(Flags);

/// <summary>One input pin: the formal parameter name where the vendor supplies one, the sub-tree feeding it,
/// and that pin's own modifiers (the vendor keeps these in <c>BoxTreeBox.InputFlags</c>, per pin).</summary>
public sealed record Input(string? Formal, Node Value, Flags Flags);

/// <summary>A variable, literal or expression. <see cref="Type"/> is the vendor's declared type when it
/// supplies one — read-only metadata used to declare a wire's temp; it is NOT load-bearing for round-trip.</summary>
public sealed record Operand(
    string Text,
    string? Type = null,
    string? Comment = null,
    bool IsInstance = false);

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
/// <para><see cref="Set"/> has no <c>Reset</c> partner in the vendor bit-field. Whether a reset coil is
/// <c>Set = false</c> on a coil item or something else is NOT yet measured, and must be settled against a real
/// LD fixture before this record is treated as complete.</para>
/// </summary>
public sealed record Flags(
    bool Negated = false,
    bool Set = false,
    bool Jump = false,
    bool Return = false,
    bool Rising = false,
    bool Falling = false)
{
    public static readonly Flags None = new();
    public bool IsNone => !Negated && !Set && !Jump && !Return && !Rising && !Falling;
}
