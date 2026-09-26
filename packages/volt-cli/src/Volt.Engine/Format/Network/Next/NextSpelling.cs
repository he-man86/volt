using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace Volt.Engine.Format.Network.Next;

/// <summary>
/// The spelling rules network text v2's writer and reader must agree on, in ONE place. Each rule here is decided
/// on one side and relied on by the other: a token the writer leaves bare must lex as one token, a word the writer
/// backticks must be refused bare, a box the writer writes infix must be the box the reader builds from a group,
/// and a wire's type is read off its producer by the same rule on both sides. Two private copies would drift the
/// first time one side learns a new literal form — and the drift would show up only as a body the gate refuses as
/// not canonical, far from the rule that moved.
/// </summary>
internal static class NextSpelling
{
    public static readonly Regex Identifier = new(@"^[A-Za-z_][A-Za-z0-9_]*$", RegexOptions.Compiled);
    public static readonly Regex Path = new(@"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$", RegexOptions.Compiled);
    public static readonly Regex Number = new(@"^[0-9][0-9_]*(\.[0-9][0-9_]*)?([eE][+-]?[0-9]+)?$", RegexOptions.Compiled);
    // T#1S, TIME#1h2m, 16#FF, INT#5, DT#2020-01-01-12:00:00 — one ST literal token, no whitespace.
    public static readonly Regex Typed = new(@"^[A-Za-z0-9_]+#[A-Za-z0-9_.:+\-]+$", RegexOptions.Compiled);
    public static readonly Regex Address = new(@"^%[IQM][XBWDL]?[0-9]+(\.[0-9]+)*$", RegexOptions.Compiled);

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

    /// <summary>Whether <paramref name="t"/> is exactly one token of the text, so it may stand bare.</summary>
    public static bool IsToken(string t) =>
        t == Box.UnnamedInstance ||
        (!TextWords.Contains(t) &&
         (Identifier.IsMatch(t) || Path.IsMatch(t) || Number.IsMatch(t) || Typed.IsMatch(t) || Address.IsMatch(t)));

    /// <summary>Whether a box type heads its call bare: one name, and not a word of the text unless it is an
    /// operator's own. Anything else is written verbatim between backticks — a type <c>Network</c> written bare
    /// would open a network at a line start.</summary>
    public static bool IsBareHead(string type) =>
        (Identifier.IsMatch(type) || Path.IsMatch(type)) && (!TextWords.Contains(type) || OperatorHeads.Contains(type));

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

    /// <summary>Infix is decided by the box's own fields alone: an operator in the table spelled as the table spells
    /// it (a head is the BoxType verbatim, and a group reads back as the table's word — <c>and</c> must stay a
    /// call), no EN, no instance, no output pin, formals absent or the operator's defaults, at least two inputs
    /// (with fewer, the group's parentheses would be a pair that is no box), and no stored connection slot — a
    /// group says nothing about one, so a box connected by a stored slot is written as the call that does.</summary>
    public static bool IsInfix(Box b) =>
        b.Enable is null && b.Instance is null && b.Outputs.Count == 0 && b.StCode is null && b.ConnectedSlot is null &&
        FbdOperators.TypeToSymbol.ContainsKey(b.Type) &&
        string.Equals(b.Type, b.Type.ToUpperInvariant(), StringComparison.Ordinal) && b.Inputs.Count >= 2 &&
        b.Inputs.Select((p, i) => p.Formal is null ||
                                  string.Equals(p.Formal, "IN" + (i + 1), StringComparison.OrdinalIgnoreCase)).All(x => x);

    /// <summary>
    /// THE SLOT READING of a box consumed by its main output (no <c>.ENO</c>), which the text does not spell and so
    /// fixes by rule — the writer refuses every box the rule would misread. A bit operator's call form stores no
    /// slot (census 1.6: the vendor keeps no main output index on AND/OR, and phase 1 reads their consumers as
    /// connected by none); every other box is connected by its main output and that output is slot 0 (spec, "err
    /// reads back on slot 1"; census 1.6: 0 on 456 boxes). Positional <c>=&gt;</c> pins fill the slots that remain,
    /// so a box whose main output is another slot (census: 1 on 3 Lenze call boxes) would read back with every
    /// positional output moved — which is why it is refused, not renumbered.
    /// </summary>
    public static int? MainSlotOfCall(string type) => BitOperators.Contains(type) ? null : 0;

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
                if (b.StCode is not null || (b.Enable is not null && b.ConnectedSlot == 0)) return ProducedType.Of(Bool);
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

    /// <summary>Whether wire <paramref name="varId"/> is referenced at least once and only where a BOOL is taken.</summary>
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
                    all &= boolean || d.Flags.Rising || d.Flags.Falling;
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
                case Terminator t:
                    Walk(t.Input, false);
                    break;
            }
        }
        foreach (var t in network) Walk(t, false);   // a top-level value's output goes nowhere
        return any && all;
    }
}
