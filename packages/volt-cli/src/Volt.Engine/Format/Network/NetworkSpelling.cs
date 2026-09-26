using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace Volt.Engine.Format.Network;

/// <summary>
/// The spelling rules network text v2's writer and reader must agree on, in ONE place. Each rule here is decided
/// on one side and relied on by the other: a token the writer leaves bare must lex as one token, a word the writer
/// backticks must be refused bare, a box the writer writes infix must be the box the reader builds from a group,
/// and a wire's type is read off its producer by the same rule on both sides. Two private copies would drift the
/// first time one side learns a new literal form — and the drift would show up only as a body the gate refuses as
/// not canonical, far from the rule that moved.
/// </summary>
internal static class NetworkSpelling
{
    public static readonly Regex Identifier = new(@"^[A-Za-z_][A-Za-z0-9_]*$", RegexOptions.Compiled);
    public static readonly Regex Path = new(@"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$", RegexOptions.Compiled);
    /// <summary>A number and a direct address, unanchored: the lexer reads them at its position with these same
    /// patterns, so what the writer leaves bare is what the lexer takes as one token.</summary>
    internal const string NumberPattern = @"[0-9][0-9_]*(\.[0-9][0-9_]*)?([eE][+-]?[0-9]+)?";
    internal const string AddressPattern = @"%[IQM][XBWDL]?[0-9]+(\.[0-9]+)*";

    public static readonly Regex Number = new("^" + NumberPattern + "$", RegexOptions.Compiled);
    // T#1S, TIME#1h2m, 16#FF, INT#5, DT#2020-01-01-12:00:00 — one ST literal token, no whitespace.
    public static readonly Regex Typed = new(@"^[A-Za-z0-9_]+#[A-Za-z0-9_.:+\-]+$", RegexOptions.Compiled);
    public static readonly Regex Address = new("^" + AddressPattern + "$", RegexOptions.Compiled);

    /// <summary>A wire's name: <c>g</c> plus the vendor VarId. Matched case-insensitively, as IEC names are.</summary>
    public static readonly Regex WireName = new(@"^[gG][0-9]+$", RegexOptions.Compiled);

    /// <summary>Words the text's own grammar gives a meaning at operand position; an operand spelled like one is
    /// backticked so it cannot be read as the construct. <c>LET</c> is one because a statement starting with it is
    /// the v1 refusal: a coil on a variable named <c>Let</c> written bare would be refused as v1 text.</summary>
    public static readonly HashSet<string> TextWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "NOT", "AND", "OR", "XOR", "MOD", "R_EDGE", "F_EDGE", "PARALLEL", "EXECUTE", "END_EXECUTE",
        "IF", "THEN", "END_IF", "JMP", "RETURN", "NETWORK", "END_NETWORK", "VAR_TEMP", "END_VAR", "LET",
    };

    /// <summary>Words of the text that ARE box types, so they head a call bare: an operator box in call form
    /// (<c>AND(EN := go, a, b, =&gt; out)</c>) and the NOT box. Every other word of the text heads a call only
    /// between backticks.</summary>
    public static readonly HashSet<string> OperatorHeads = new(StringComparer.OrdinalIgnoreCase) { "AND", "OR", "XOR", "MOD", "NOT" };

    /// <summary>The names a POU or FB instance may not carry, because the text spells a construct with them.</summary>
    public static readonly HashSet<string> ConstructWords = new(StringComparer.OrdinalIgnoreCase)
        { "R_EDGE", "F_EDGE", "PARALLEL" };

    /// <summary>A name a declaration makes and a call can head: an identifier, or a qualified one
    /// (<c>GVL.fbTimer</c>, <c>Lib.F</c>). Not an expression — <c>fbs[1]</c>, <c>SUPER^</c> — which names no POU and
    /// is declared by no name.</summary>
    public static bool IsName(string t) => Identifier.IsMatch(t) || Path.IsMatch(t);

    /// <summary>Whether a call of the text would read the construct word <paramref name="word"/> as something else
    /// than the construct: a POU or an FB instance in scope is named so (case-insensitively, as IEC names are). A
    /// VARIABLE of that name is not a reason — it never heads a call, and as an operand it is backticked — so both
    /// sides ask the scope the one question, never "is the name anywhere in scope".</summary>
    public static bool ConstructTaken(string word, NetworkScope scope) =>
        ConstructWords.Contains(word) && scope.IsCallable(word);

    /// <summary>Whether a BARE word <paramref name="t"/> that is no wire of its network reads as a wire someone forgot
    /// to declare: shaped like one, and no name in scope. The reader refuses it (spec, "an undeclared wire-shaped
    /// name"), so the writer never leaves such an operand or target bare — it backticks it, verbatim text the reader
    /// takes as the variable of that name. One rule for both sides: a name the scope lacks (one no declaration the
    /// scope is built from makes — <see cref="NetworkScope.FromDeclarations"/>) otherwise made the writer's text one
    /// its own reader refuses.</summary>
    public static bool ReadsAsUndeclaredWire(string t, NetworkScope scope) => WireName.IsMatch(t) && !scope.Contains(t);

    /// <summary>A wire's declared type as the text compares it: its spelling with every run of layout one space.</summary>
    internal static string WireType(string spelled) => Regex.Replace(spelled, @"\s+", " ").Trim();

    /// <summary>A VAR_TEMP block as the text compares it: what it DECLARES — each wire with its type, by VarId — never
    /// how the declarations are grouped or ordered. Grouping and order are no NWL fact (the vendor's Demux has no
    /// declaration at all), so the spec accepts <c>g1 : BOOL; g2 : BOOL;</c> as the canonical <c>g1, g2 : BOOL;</c>.
    /// The one spelling of that comparison, for the reader's token stream and the gate's post-push comparison alike.</summary>
    internal static string WireBlockKey(IEnumerable<(int VarId, string Name, string Type)> wires) =>
        string.Join(", ", wires.OrderBy(w => w.VarId).Select(w => w.Name + " : " + w.Type));

    /// <summary>Whether <paramref name="t"/> is exactly one token of the text, so it may stand bare.</summary>
    public static bool IsToken(string t) =>
        t == Box.UnnamedInstance ||
        (!TextWords.Contains(t) &&
         (Identifier.IsMatch(t) || Path.IsMatch(t) || Number.IsMatch(t) || Typed.IsMatch(t) || Address.IsMatch(t)));

    /// <summary>Whether a box type heads its call bare: one name, and not a word of the text unless it is an
    /// operator's own. Anything else is written verbatim between backticks — a type <c>Network</c> written bare
    /// would open a network at a line start.</summary>
    public static bool IsBareHead(string type) =>
        IsName(type) && (!TextWords.Contains(type) || OperatorHeads.Contains(type));

    /// <summary>Whether an assignment or <c>=&gt;</c> target may stand bare: a name that is no word of the text,
    /// the vendor's <c>???</c>, or an address. A literal (<c>5</c>, <c>16#FF</c>, <c>T#1s</c>) is a token at operand
    /// position but no target token — the reader refuses a bare literal where a target stands — so a target
    /// holding one is backticked like any other text that is not a target token.</summary>
    public static bool IsBareTarget(string t) =>
        t == Box.UnnamedInstance || Address.IsMatch(t) || (IsName(t) && !TextWords.Contains(t));

    /// <summary>Whether <paramref name="type"/> can be written into a <c>VAR_TEMP</c> declaration and read back as
    /// itself: decided by the text's own lexer, so it is the reader's rule and not a copy of it. The reader takes the
    /// tokens up to the declaration's <c>;</c>, so a <c>;</c>, a <c>//</c> comment, a backtick, a string, an
    /// <c>END_VAR</c> or a lexical error inside the type would end, swallow or break the block; and the block is
    /// one line, so a newline has no place in it.</summary>
    public static bool IsSpellableType(string type)
    {
        if (type.Trim().Length == 0 || type.IndexOfAny(new[] { '\n', '\r' }) >= 0) return false;
        var lx = new NetworkLexer(type, 0);
        for (var t = lx.Next(); t.Kind != TokKind.Eof; t = lx.Next())
        {
            var ok = t.Kind switch
            {
                TokKind.Word => !t.Is("END_VAR"),
                TokKind.Number or TokKind.Typed or TokKind.Address => true,
                TokKind.Sym => t.Text != ";",
                _ => false,
            };
            if (!ok) return false;
        }
        return true;
    }

    /// <summary>The Parallel modes measured on a real project (census 1.3: <c>BoxShortCircuit</c> 16,
    /// <c>Sequential</c> 1). Any other value is unmeasured and refused by both sides, never written as a number.</summary>
    public static bool IsMeasuredMode(ParallelMode m) => m is ParallelMode.BoxShortCircuit or ParallelMode.Sequential;

    private static readonly Regex WordPattern = new(@"[A-Za-z_][A-Za-z0-9_]*", RegexOptions.Compiled);

    /// <summary>Every identifier-shaped word in <paramref name="text"/> — not just the whole text: a backticked
    /// <c>g3 + 1</c> names <c>g3</c> too. The reserved set a wire name must avoid is built from these, by the
    /// writer before it names a wire and by the reader before it accepts one.</summary>
    public static IEnumerable<string> Words(string text) => WordPattern.Matches(text).Cast<Match>().Select(m => m.Value);

    public const string Bool = "BOOL";

    /// <summary>The bit-string types (IEC ANY_BIT). An AND/OR/XOR/NOT box is bitwise on any of them.</summary>
    public static readonly HashSet<string> BitStrings = new(StringComparer.OrdinalIgnoreCase)
        { "BOOL", "BYTE", "WORD", "DWORD", "LWORD" };

    /// <summary>Operator boxes whose result is BOOL whatever their operands.</summary>
    private static readonly HashSet<string> Comparisons = new(StringComparer.OrdinalIgnoreCase)
        { "GT", "GE", "LT", "LE", "EQ", "NE" };

    /// <summary>The bit operators: their result has their operands' bit-string type, so they say "BOOL or another
    /// bit string" by themselves and the vendor's stored type (or a declaration) says which. They are also the
    /// boxes the vendor stores NO main output index for (census 1.6: None on 823 — the AND/OR boxes).</summary>
    public static readonly HashSet<string> BitOperators = new(StringComparer.OrdinalIgnoreCase)
        { "AND", "OR", "XOR", "NOT" };

    /// <summary>Infix is decided by the box's own fields alone (spec, "infix treats absent and default formals as
    /// one"): an operator in the table spelled as the table spells it (a head is the BoxType verbatim, and a group
    /// reads back as the table's word — <c>and</c> must stay a call), no EN, no instance, no output pin, formals
    /// absent or the operator's defaults, and at least two inputs (with fewer, the group's parentheses would be a
    /// pair that is no box), and no consumer connected by ENO. A group has no suffix position, so a box consumed
    /// by its ENO is a call ending <c>.ENO</c>; written infix it would be the text of the same box consumed by its
    /// main output — two models on one text, and the push would wire the consumer to the data result. Any OTHER
    /// connection plays no part: a group and a call say the same about it, and both are read by
    /// <see cref="MainSlotOfCall"/> — a box whose slot that reading would get wrong is refused whichever form it
    /// would take.</summary>
    public static bool IsInfix(Box b) =>
        b.Enable is null && b.Instance is null && b.Outputs.Count == 0 && b.StCode is null && !ConnectedByEno(b) &&
        FbdOperators.TypeToSymbol.ContainsKey(b.Type) &&
        string.Equals(b.Type, b.Type.ToUpperInvariant(), StringComparison.Ordinal) && b.Inputs.Count >= 2 &&
        b.Inputs.Select((p, i) => p.Formal is null ||
                                  string.Equals(p.Formal, "IN" + (i + 1), StringComparison.OrdinalIgnoreCase)).All(x => x);

    /// <summary>
    /// THE SLOT READING of a box consumed by its main output (no <c>.ENO</c>), in call form or as a group, which the
    /// text does not spell and so fixes by rule — the writer refuses every box the rule would misread. A bit
    /// operator stores no slot (census 1.6: the vendor keeps no main output index on AND/OR, and their consumers
    /// are read as connected by none); every other box is connected by its main output and that output is slot 0
    /// (spec, "err reads back on slot 1"; census 1.6: 0 on 456 boxes). Positional <c>=&gt;</c> pins fill the slots
    /// that remain, so a box whose main output is another slot (census: 1 on 3 Lenze call boxes) would read back
    /// with every positional output moved — which is why it is refused, not renumbered.
    /// </summary>
    public static int? MainSlotOfCall(string type) => BitOperators.Contains(type) ? null : 0;

    /// <summary>The ENO slot: output slot 0 of a box whose outputs start with ENO (<see cref="Box.HasEnoOutput"/>,
    /// read off the vendor's output names), and the ONLY output of an Execute box, which has ENO whether or not its
    /// EN is wired. Keyed on the ENO OUTPUT, never on EN: census 1.6 (DIALECT N16) measured the two independent — an
    /// enabled comparison has EN and no ENO, an FB may declare ENO without EN. ENO is never an <c>=&gt;</c> slot, and
    /// a consumer connected to it is written <c>.ENO</c>.</summary>
    public static int? EnoSlot(Box b) => EnoSlot(isExecute: b.StCode is not null, hasEnoOutput: b.HasEnoOutput == true);

    /// <summary>The same slot, for a reader that has decided the two facts before it has a <see cref="Box"/> to ask
    /// about — the call reader places its positional pins around ENO while it is still building the box. Both
    /// overloads are this one number, so the readers and the writer cannot disagree on where ENO sits.</summary>
    public static int? EnoSlot(bool isExecute, bool hasEnoOutput) => isExecute || hasEnoOutput ? 0 : null;

    /// <summary>Whether a consumer of <paramref name="b"/> is connected to its ENO — the <c>.ENO</c> suffix. The ONE
    /// definition: the writer's suffix, the wire type rule and the test oracle all ask this, so none can drift.</summary>
    public static bool ConnectedByEno(Box b) => b.ConnectedSlot is { } c && c == EnoSlot(b);

    /// <summary>
    /// THE TEXT'S READING of whether a box has an ENO output — the one rule the reader builds with and the writer
    /// refuses against, because the text spells ENO only where a consumer reads it. An Execute box has one by type;
    /// <c>.ENO</c> says so; a consumed box without the suffix is connected by a main output that is NOT ENO, and N16
    /// measured the main output to be ENO exactly when the box has one — so it has none. A top-level box says
    /// nothing, and is read by its EN: a box showing EN/ENO (MOVE, ADD, calls — 66 connections) is the common case,
    /// and a top-level box the rule misreads (an enabled comparison writing its result to a pin; an FB declaring ENO
    /// without EN, writing a positional pin) is refused by the writer, never renumbered.
    /// </summary>
    public static bool TextHasEno(bool isExecute, bool hasEnable, bool enoSuffix, bool consumed) =>
        isExecute || enoSuffix || (!consumed && hasEnable);

    /// <summary>Whether <see cref="Box.HasEnoOutput"/> is a fact the text carries for <paramref name="b"/>: where it
    /// decides the text — the suffix of a consumed box that is connected by a stored slot or shows EN, and the slots
    /// its positional <c>=&gt;</c> pins fill. Elsewhere the text has no position for it and the push takes it from the
    /// IDE's box: a top-level box with no positional pin; an Execute box, whose ENO is its type's; and an operator
    /// group — no EN, consumed by no stored slot (the vendor keeps no main output index on AND/OR, census 1.6),
    /// which N16 found no ENO on (an ENO without EN was measured only on an FB DECLARING one, Lenze <c>Dryer</c>).
    /// The writer checks, the reader states and the oracle compares it by this one predicate.</summary>
    public static bool EnoCarried(Box b, bool consumed) =>
        b.StCode is null &&
        (b.Outputs.Any(o => o.Formal is null) || (consumed && (b.ConnectedSlot is not null || b.Enable is not null)));

    /// <summary>The first output slot at or after <paramref name="from"/> a positional <c>=&gt;</c> pin can fill:
    /// ENO and the slot a consumer is connected to are skipped, the rest fill in order. The writer spells a pin by
    /// counting these and the reader places one by them — one rule, so the two cannot count differently.</summary>
    public static int NextFreeSlot(int from, int? eno, int? connected)
    {
        while (from == eno || from == connected) from++;
        return from;
    }

    /// <summary>The box's <see cref="CallKind"/> as the TEXT determines it. The text does not carry the vendor's
    /// <c>CallType</c> (a MOVE the IDE resolved reads <c>Operator</c>, the same box freshly built reads
    /// <c>None</c> — <see cref="CallKinds"/>), so this is the reader's reading and the oracle's normalisation, one
    /// rule for both; the push takes the IDE's own value.</summary>
    public static CallKind KindOf(string type, bool hasInstance) =>
        hasInstance ? CallKind.FunctionBlock
        : FbdOperators.TypeToSymbol.ContainsKey(type) || string.Equals(type, "NOT", StringComparison.OrdinalIgnoreCase)
            ? CallKind.Operator
            : CallKind.Function;

    /// <summary>The type the Execute box's model carries; the ST is what distinguishes it.</summary>
    public const string ExecuteType = "EXECUTE";

    // ── a wire's type, read off its producer ────────────────────────────────────────────────────

    /// <summary>What a wire's producer says about its type: an exact type, "BOOL or another bit string" (a bit
    /// operator with no stored type), or nothing — then only a declaration can say.</summary>
    public readonly struct ProducedType
    {
        public ProducedType(string? exact, bool anyBit) { Exact = exact; AnyBit = anyBit; }
        public string? Exact { get; }
        public bool AnyBit { get; }
        public static ProducedType Nothing => default;
        public static ProducedType Of(string type) => new(type, false);
    }

    /// <summary>
    /// The type the producer of wire <paramref name="varId"/> says by itself (spec, "a wire's type is read off its
    /// producer"), decided the same way by the writer, which declares it, and the reader, which checks a declared
    /// one against it:
    /// <list type="bullet">
    /// <item>BOOL: an edge, <c>TRUE</c>/<c>FALSE</c>, a Parallel, an Execute box or a box consumed by <c>.ENO</c>, a
    /// comparison — and a leaf whose EVERY use is boolean (task 1.17): an EN, a Parallel, a jump condition, an
    /// edge on the reference, and in ladder a coil or a contact (an AND/OR/XOR/NOT input). A leaf feeding a data pin
    /// is a data value, whatever the language.</item>
    /// <item>The vendor's stored output type (<see cref="Box.OutputTypes"/>) of the slot the wire is connected to —
    /// before any rule, so a bitwise AND on WORDs is a WORD.</item>
    /// <item>A bit operator with no stored type: BOOL or another bit string.</item>
    /// <item>A reference to another wire: that wire's type.</item>
    /// </list>
    /// </summary>
    public static ProducedType ProducerType(Node producer, int varId, IReadOnlyList<Node> network, BodyLanguage lang,
                                            Func<int, string?> wireType)
    {
        if (producer.Flags.Rising || producer.Flags.Falling) return ProducedType.Of(Bool);
        switch (producer)
        {
            case Leaf l:
                if (string.Equals(l.Operand.Text, "TRUE", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(l.Operand.Text, "FALSE", StringComparison.OrdinalIgnoreCase)) return ProducedType.Of(Bool);
                return EveryUseIsBoolean(varId, network, lang) ? ProducedType.Of(Bool) : ProducedType.Nothing;
            case Parallel:
                return ProducedType.Of(Bool);
            case Demux d:
                return wireType(d.VarId) is { } t ? ProducedType.Of(t) : ProducedType.Nothing;
            case Box b:
                if (b.StCode is not null || ConnectedByEno(b)) return ProducedType.Of(Bool);
                // A box with ONE output slot has only one slot a consumer can be connected to.
                var slot = b.ConnectedSlot ?? (b.OutputTypes is { Count: 1 } ? 0 : (int?)null);
                if (slot is { } s && b.OutputTypes is { } types && s < types.Count && types[s] is { } stored)
                    return ProducedType.Of(stored);
                if (Comparisons.Contains(b.Type)) return ProducedType.Of(Bool);
                if (BitOperators.Contains(b.Type)) return new ProducedType(null, anyBit: true);
                return ProducedType.Nothing;
            default:
                return ProducedType.Nothing;
        }
    }

    /// <summary>How <paramref name="p"/> disagrees with a DECLARED type — what the producer says instead — or null
    /// when they agree. The writer refuses a model whose declaration disagrees, and the reader reports one: the same
    /// comparison, so the two cannot differ on which declarations a producer allows.</summary>
    public static string? Disagreement(ProducedType p, string declared) =>
        p.Exact is { } exact
            ? string.Equals(exact, declared, StringComparison.OrdinalIgnoreCase) ? null : exact
            : p.AnyBit && !BitStrings.Contains(declared)
                ? "a bit operator, whose result is BOOL or another bit string (BYTE, WORD, DWORD, LWORD)"
                : null;

    /// <summary>Whether wire <paramref name="varId"/> is referenced at least once and only where a BOOL is taken.
    /// A walk over the whole network per leaf-fed wire: a leaf's type is decided by its USES, the one fact of a
    /// wire that lies below its definition.</summary>
    private static bool EveryUseIsBoolean(int varId, IReadOnlyList<Node> network, BodyLanguage lang)
    {
        var any = false;
        var all = true;
        void Walk(Node? n, bool boolean)
        {
            switch (n)
            {
                case Demux { Input: null } d:
                    if (d.VarId != varId) break;
                    any = true;
                    all &= boolean;
                    break;
                case Demux d:
                    Walk(d.Input, false);   // whether it is boolean depends on the other wire's uses — not proven
                    break;
                case Assign a:
                    var controlFlow = a.Flags.Jump || a.Flags.Return || a.Targets.Any(t => t.Flags is { } f && (f.Jump || f.Return));
                    Walk(a.Value, controlFlow || lang == BodyLanguage.Ld);   // a condition; a ladder coil
                    break;
                case Box b:
                    Walk(b.Enable, true);
                    var contacts = lang == BodyLanguage.Ld && b.StCode is null && BitOperators.Contains(b.Type);
                    foreach (var p in b.Inputs) Walk(p.Value, contacts);
                    break;
                case Parallel p:
                    Walk(p.Input, true);
                    foreach (var br in p.Branches) Walk(br, true);
                    break;
            }
        }
        foreach (var t in network) Walk(t, false);   // a top-level value's output goes nowhere
        return any && all;
    }
}
