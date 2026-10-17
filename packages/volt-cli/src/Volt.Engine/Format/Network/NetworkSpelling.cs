using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace Volt.Engine.Format.Network;

/// <summary>
/// The spelling rules network text's writer and reader must agree on, in ONE place (openspec <c>ld-fbd-coverage</c>
/// 2R.3, <c>readability.md</c>). Each rule here is decided on one side and relied on by the other: a token the writer
/// leaves bare must lex as one token, a word the writer backticks must be refused bare, a box the writer writes as its
/// word must be the box the reader builds from it, and a split's type is read off its feeder by the same rule on both
/// sides. Two private copies would drift the first time one side learns a new literal form, far from the rule that
/// moved. A spelling that reads back cleanly into a DIFFERENT model passes the gate unseen; that half is caught offline,
/// by the model oracle <c>Read(Write(m)) ≅ m</c> (<c>NetworkModelOracle</c>) — the reason this table is shared.
/// </summary>
internal static class NetworkSpelling
{
    public static readonly Regex Identifier = new(@"^[A-Za-z_][A-Za-z0-9_]*$", RegexOptions.Compiled);
    public static readonly Regex Path = new(@"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$", RegexOptions.Compiled);
    /// <summary>A number and a direct address, unanchored: the lexer reads them at its position with these same
    /// patterns, so what the writer leaves bare is what the lexer takes as one token.</summary>
    internal const string NumberPattern = @"[0-9][0-9_]*(\.[0-9][0-9_]*)?([eE][+-]?[0-9]+)?";
    internal const string AddressPattern = @"%[IQM][XBWDL]?[0-9]+(\.[0-9]+)*";

    /// <summary>A number, its minus touching the digit (P12: <c>-1</c>; <c>- 1</c> and <c>+1</c> are refused).</summary>
    public static readonly Regex Number = new("^-?" + NumberPattern + "$", RegexOptions.Compiled);
    // T#1S, TIME#1h2m, 16#FF, INT#5, DT#2020-01-01-12:00:00 — one ST literal token, no whitespace.
    public static readonly Regex Typed = new(@"^-?[A-Za-z0-9_]+#[A-Za-z0-9_.:+\-]+$", RegexOptions.Compiled);
    public static readonly Regex Address = new("^" + AddressPattern + "$", RegexOptions.Compiled);
    /// <summary>ST's string literals, whole: one token, on one line, <c>$</c> escaping the character after it.</summary>
    public static readonly Regex SString = new(@"^'([^'$\r\n]|\$[^\r\n])*'$", RegexOptions.Compiled);
    public static readonly Regex DString = new(@"^""([^""$\r\n]|\$[^\r\n])*""$", RegexOptions.Compiled);

    /// <summary>A split point's name (B6): <c>split</c> plus the vendor's VarId, no leading zeros. The PATTERN is reserved
    /// (P1) — a bare word of that shape is always a split, never a variable — matched case-insensitively.</summary>
    public static readonly Regex SplitShape = new(@"^split[0-9]+$", RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    public const string SplitPrefix = "split";

    public static string SplitName(int varId) => SplitPrefix + varId.ToString(System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>
    /// THE RESERVED WORDS (P1), compared case-insensitively: the text's own grammar gives each a meaning, so a variable,
    /// pin, FB, global or enum value spelled like one is backticked — a reference never falls back to a variable.
    /// <c>IF THEN END_IF LET VAR_TEMP FEED PARALLEL INTO BRANCHES</c> are not words of the text.
    /// </summary>
    public static readonly HashSet<string> TextWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "EN", "ENO", BranchWord, ShortCircuitWord, "JMP", "RETURN", "EXECUTE", "END_EXECUTE", "NOT",
        "R_EDGE", "F_EDGE", "NETWORK", "END_NETWORK", UnsupportedWord,
        "AND", "OR", "XOR", "ADD", "SUB", "MUL", "DIV", "MOD", "GT", "GE", "EQ", "NE", "LE", "LT", "MOVE",
    };

    /// <summary>Whether <paramref name="t"/> is reserved: a word of the text, or the split pattern.</summary>
    public static bool IsReserved(string t) => TextWords.Contains(t) || SplitShape.IsMatch(t);

    /// <summary>The word that opens a network's one line where the text has no spelling for its trees
    /// (<c>UNSUPPORTED "a flag on a box input pin";</c>, <see cref="Network.Unsupported"/>, ld-fbd-coverage 1b.4).</summary>
    public const string UnsupportedWord = St.ImplementationMarker.UnsupportedWord;

    /// <summary>What may follow <see cref="UnsupportedWord"/>: the refusal's shape name, words separated by one space.
    /// Every reason the writer and the readers raise is such a phrase; one that is not has no line to stand on.</summary>
    public static readonly Regex UnsupportedShape = new(@"^[A-Za-z0-9_]+( [A-Za-z0-9_]+)*$", RegexOptions.CultureInvariant);

    /// <summary>B1: the operator boxes written as their WORD, infix — the box's name as CODESYS draws it.</summary>
    public static readonly HashSet<string> OperatorWords = new(StringComparer.OrdinalIgnoreCase)
        { "AND", "OR", "XOR", "ADD", "SUB", "MUL", "DIV", "MOD", "GT", "GE", "EQ", "NE", "LE", "LT" };

    /// <summary>B1's guard (C3): the operators that take exactly two inputs — a third is stored and refused by the build
    /// ("'-' needs exactly '2' operands"), so the text refuses it by name.</summary>
    public static readonly HashSet<string> TwoInputOperators = new(StringComparer.OrdinalIgnoreCase)
        { "SUB", "DIV", "MOD", "GT", "GE", "EQ", "NE", "LE", "LT" };

    /// <summary>The modifiers 2R.5's composition would spell and no store, build and run measures (design "2R.5": measured
    /// per row before its spelling ships) — refused by name by the reader, the writer and the LSP's parser alike.</summary>
    public const string UnmeasuredFlow =
        "a modified jump or return: NOT, R_EDGE, F_EDGE and R= on JMP or RETURN are not measured — `JMP l S=` and `RETURN S=` are the ones stored and built (2R.5).";
    public const string UnmeasuredEdgeCoil =
        "an edge on a negated, set or reset coil: not measured — `R_EDGE x :=` is the one stored and built (2R.5).";
    public const string UnmeasuredModifiedFanOut =
        "a negated or edge coil beside another coil: not measured — `NOT x :=`, `R_EDGE x :=` and `F_EDGE x :=` are each stored and built alone on their item (2R.5).";
    public const string UnmeasuredEdgeEn = "an edge on the EN pin: not measured — `NOT EN c` is the one stored and built (2R.5).";
    public const string UnmeasuredEdgePin =
        "an edge on a negated pin: not measured — `R_EDGE IN1 :=` and `NOT IN1 :=` are each stored and built, together they are not (2R.5).";
    public const string UnmeasuredNegatedEmpty =
        "a negated empty slot outside a lone plain coil's value: not measured — `x := NOT ;` is the one stored and built (2R.5).";

    public const string Move = "MOVE";
    public const string NotBox = "NOT";

    /// <summary>The names a POU or FB instance may not carry as a CALL, because the text spells a construct with them
    /// (<c>R_EDGE(x)</c>, <c>F_EDGE(x)</c>).</summary>
    public static readonly HashSet<string> ConstructWords = new(StringComparer.OrdinalIgnoreCase) { "R_EDGE", "F_EDGE" };

    /// <summary>A name a declaration makes and a call can head: an identifier, or a qualified one
    /// (<c>GVL.fbTimer</c>, <c>Lib.F</c>). Not an expression — <c>fbs[1]</c>, <c>SUPER^</c>.</summary>
    public static bool IsName(string t) => Identifier.IsMatch(t) || Path.IsMatch(t);

    /// <summary>Whether a call of the text would read the construct word <paramref name="word"/> as something else
    /// than the construct: a POU or an FB instance in scope is named so.</summary>
    public static bool ConstructTaken(string word, NetworkScope scope) =>
        ConstructWords.Contains(word) && scope.IsCallable(word);

    /// <summary>Whether <paramref name="t"/> is exactly one bare token of the text: a name that is not reserved, a
    /// literal (a number, a typed literal, an ST string — P12: never backticked), an address, or the vendor's
    /// <c>???</c>.</summary>
    public static bool IsToken(string t) =>
        t == Box.UnnamedInstance || IsLiteral(t) || Address.IsMatch(t) ||
        (!IsReserved(t) && (Identifier.IsMatch(t) || Path.IsMatch(t)));

    /// <summary>An ST literal the text writes bare (P12): a number (its minus touching it), a typed literal, a string.</summary>
    public static bool IsLiteral(string t) => Number.IsMatch(t) || Typed.IsMatch(t) || SString.IsMatch(t) || DString.IsMatch(t);

    /// <summary>Whether a box type heads its call bare: one name that is not reserved, or an operator's own word in its
    /// call form (P5: <c>ADD(a)</c>, <c>AND(a, NOT IN2 := b)</c>, <c>NOT(IN := a)</c>, <c>MOVE(a, b)</c>).</summary>
    public static bool IsBareHead(string type) =>
        IsName(type) && (!IsReserved(type) || OperatorWords.Contains(type) || IsMoveOrNot(type));

    private static bool IsMoveOrNot(string type) =>
        string.Equals(type, Move, StringComparison.OrdinalIgnoreCase) || string.Equals(type, NotBox, StringComparison.OrdinalIgnoreCase);

    /// <summary>Whether an assignment or <c>=&gt;</c> target may stand bare: a name that is not reserved, the vendor's
    /// <c>???</c>, or an address. A literal is no target.</summary>
    public static bool IsBareTarget(string t) =>
        t == Box.UnnamedInstance || Address.IsMatch(t) || (IsName(t) && !IsReserved(t));

    /// <summary>The Parallel modes measured on a real project (census 1.3: <c>BoxShortCircuit</c> 16,
    /// <c>Sequential</c> 1). Any other value is unmeasured and refused by both sides.</summary>
    public static bool IsMeasuredMode(ParallelMode m) => m is ParallelMode.BoxShortCircuit or ParallelMode.Sequential;

    /// <summary>B8: the mode a Parallel the editor creates holds (N20: <c>Sequential</c>), written as nothing; the other
    /// measured one is <c>SHORTCIRCUIT</c>.</summary>
    public const ParallelMode DerivedMode = ParallelMode.Sequential;
    public const string ShortCircuitWord = "SHORTCIRCUIT";

    /// <summary>B8: the word that heads a parallel's branch list, <c>[feed] BRANCH (a, b)</c> — the only head of a bracketed
    /// comma list that is not a call (P6).</summary>
    public const string BranchWord = "BRANCH";

    /// <summary>P2: whether a line ending in <paramref name="prev"/> (after <paramref name="before"/>) goes on to the next
    /// line — it ends with a word that cannot end it: an infix box word, BRANCH, <c>=&gt;</c>, <c>:=</c>, <c>S=</c>,
    /// <c>R=</c> (and <c>,</c> / <c>(</c>, which only stand inside brackets, where line breaks are layout anyway). The
    /// reader cuts lines by it and the gate compares lines by it: one rule.</summary>
    internal static bool ContinuesLine(Tok prev, Tok before) =>
        (prev.Kind == TokKind.Word && (OperatorWords.Contains(prev.Text) || prev.Is(BranchWord))) ||
        prev.IsSym("=>") || prev.IsSym(":=") || prev.IsSym(",") || prev.IsSym("(") ||
        (prev.IsSym("=") && (before.Is("S") || before.Is("R")));

    private static readonly Regex WordPattern = new(@"[A-Za-z_][A-Za-z0-9_]*", RegexOptions.Compiled);

    /// <summary>Every identifier-shaped word in <paramref name="text"/>.</summary>
    public static IEnumerable<string> Words(string text) => WordPattern.Matches(text).Cast<Match>().Select(m => m.Value);

    public const string Bool = "BOOL";

    /// <summary>Operator boxes whose result is BOOL whatever their operands.</summary>
    internal static readonly HashSet<string> Comparisons = new(StringComparer.OrdinalIgnoreCase)
        { "GT", "GE", "LT", "LE", "EQ", "NE" };

    /// <summary>The bit operators: the boxes the vendor stores NO main output index for (census 1.6: None on 823).</summary>
    public static readonly HashSet<string> BitOperators = new(StringComparer.OrdinalIgnoreCase)
        { "AND", "OR", "XOR", "NOT" };

    /// <summary>The default formal of an operator's input: <c>IN&lt;n&gt;</c> on the table's operators, <c>IN</c> on the
    /// NOT box and MOVE — the name the text gives a pin it must name (P5: <c>AND(a, NOT IN2 := b)</c>,
    /// <c>NOT(IN := a)</c>, <c>MOVE(IN := )</c>), read back as no name, the vendor's own (an operator box stores no input
    /// names, census 1.13). Null for any other box.</summary>
    public static string? DefaultFormal(string type, int pin) =>
        OperatorWords.Contains(type) ? "IN" + (pin + 1).ToString(System.Globalization.CultureInfo.InvariantCulture)
        : IsMoveOrNot(type) ? "IN"
        : null;

    /// <summary>Whether a pin's stored formal is its operator's default — a fact the text does not carry (the two
    /// read as one).</summary>
    public static bool IsDefaultFormal(string type, int pin, string? formal) =>
        formal is null || (DefaultFormal(type, pin) is { } d && string.Equals(formal, d, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// B1: whether an operator box is written as its WORD, infix (<c>a ADD b ADD c</c>, <c>a GT 40 EN c</c>,
    /// <c>a ADD b =&gt; x EN c</c>). Decided by the box's own fields alone: its type the table's word spelled in capitals
    /// (a lowercase type is the call form's to carry, P5), no instance, two or more inputs, none of them empty or flagged,
    /// formals absent or the operator's defaults, and output pins only positional ones that fill consecutive slots. A box
    /// the word form cannot carry is its call form; a two-input operator with more inputs is no box the text writes (C3).
    /// </summary>
    public static bool IsWordForm(Box b) =>
        OperatorWords.Contains(b.Type) && string.Equals(b.Type, b.Type.ToUpperInvariant(), StringComparison.Ordinal) &&
        b.Instance is null && b.StCode is null && b.Inputs.Count >= 2 && WordFormPins(b);

    /// <summary>B2: whether a MOVE box is <c>MOVE b =&gt; a</c>: one input that is a value, unflagged and unnamed, and output
    /// pins only positional ones filling consecutive slots. Every other MOVE is its call form (P5).</summary>
    public static bool IsMoveWordForm(Box b) =>
        string.Equals(b.Type, Move, StringComparison.Ordinal) && b.Instance is null && b.StCode is null &&
        b.Inputs.Count == 1 && WordFormPins(b);

    private static bool WordFormPins(Box b) =>
        b.Inputs.Select((p, i) => p.Value is not Terminator && p.Flags.IsNone && IsDefaultFormal(b.Type, i, p.Formal)).All(x => x) &&
        b.Outputs.All(o => o.Formal is null) && ConsecutiveOutputs(b);

    /// <summary>Whether the box's positional outputs fill the free slots in order, skipping none — the word forms write
    /// <c>=&gt; v</c> per pin, with no position for a slot passed over.</summary>
    private static bool ConsecutiveOutputs(Box b)
    {
        var next = 0;
        foreach (var o in b.Outputs)
        {
            if (o.Slot is not { } slot) return false;
            next = NextFreeSlot(next, EnoSlot(b), b.ConnectedSlot);
            if (slot != next) return false;
            next++;
        }
        return true;
    }

    /// <summary>
    /// THE SLOT READING of a box consumed by its main output (not by ENO), which the text does not spell and so fixes by
    /// rule — the writer refuses every box the rule would misread. A bit operator is connected by no stored slot (census
    /// 1.6; a stored one is lost on rebuild, B7); every other box by its main output, slot 0. A box whose main output is
    /// another slot is read through its output's name (S4, <c>fb(…).name</c>).
    /// </summary>
    public static int? MainSlotOfCall(string type) => BitOperators.Contains(type) ? null : 0;

    /// <summary>
    /// THE NAMED MAIN OUTPUT (ld-fbd-coverage 1b.4, S4): the output name a consumed box is spelled with — <c>fb(…).name</c>
    /// — or null where the text reads the box by <see cref="MainSlotOfCall"/>.</summary>
    public static string? NamedMainOutput(Box b)
    {
        if (b.MainOutputName is not { } name || MainSlotOfCall(b.Type) is not { } rule) return null;
        if (b.ConnectedSlot is null && b.MainOutputIndex is null) return name;            // read from `.name`
        return b.ConnectedSlot is { } slot && slot == b.MainOutputIndex && !ConnectedByEno(b) && slot != rule
            ? name
            : null;
    }

    /// <summary>The ENO slot: output slot 0 of a box whose outputs start with ENO (<see cref="Box.HasEnoOutput"/>), and
    /// the ONLY output of an Execute box. Keyed on the ENO OUTPUT, never on EN (census 1.6, DIALECT N16).</summary>
    public static int? EnoSlot(Box b) => EnoSlot(isExecute: b.StCode is not null, hasEnoOutput: b.HasEnoOutput == true);

    public static int? EnoSlot(bool isExecute, bool hasEnoOutput) => isExecute || hasEnoOutput ? 0 : null;

    /// <summary>Whether a consumer of <paramref name="b"/> is connected to its ENO — read by the word <c>ENO</c> on the
    /// line after the box's own (B4). The ONE definition: the writer, the split type rule and the oracle ask this.</summary>
    public static bool ConnectedByEno(Box b) => b.ConnectedSlot is { } c && c == EnoSlot(b);

    /// <summary>
    /// THE TEXT'S READING of whether a box has an ENO output: an Execute box has one by type; a box read by <c>ENO</c>
    /// says so; a consumed box read otherwise is connected by a main output that is NOT ENO (N16), so it has none; a
    /// top-level box is read by its EN.
    /// </summary>
    public static bool TextHasEno(bool isExecute, bool hasEnable, bool enoSuffix, bool consumed) =>
        isExecute || enoSuffix || (!consumed && hasEnable);

    /// <summary>Whether <see cref="Box.HasEnoOutput"/> is a fact the text carries for <paramref name="b"/>: where it
    /// decides the text — how a consumed box is read, the slots its positional <c>=&gt;</c> pins fill, and whether it has
    /// the ENO a named <c>ENO =&gt; v</c> pin is wired to (P5: a box shows ENO with EN or where a later line reads it).</summary>
    public static bool EnoCarried(Box b, bool consumed) =>
        b.StCode is null &&
        (b.Outputs.Any(o => o.Formal is null || string.Equals(o.Formal, Box.EnoPin, StringComparison.OrdinalIgnoreCase)) ||
         (consumed && (b.ConnectedSlot is not null || b.Enable is not null || NamedMainOutput(b) is not null)));

    /// <summary>The first output slot at or after <paramref name="from"/> a positional <c>=&gt;</c> pin can fill:
    /// ENO and the slot a consumer is connected to are skipped, the rest fill in order.</summary>
    public static int NextFreeSlot(int from, int? eno, int? connected)
    {
        while (from == eno || from == connected) from++;
        return from;
    }

    /// <summary>The box's <see cref="CallKind"/> as the TEXT determines it (the push takes the IDE's own value).</summary>
    public static CallKind KindOf(string type, bool hasInstance) =>
        hasInstance ? CallKind.FunctionBlock
        : OperatorWords.Contains(type) || string.Equals(type, NotBox, StringComparison.OrdinalIgnoreCase)
            ? CallKind.Operator
            : CallKind.Function;

    /// <summary>The type the Execute box's model carries; the ST is what distinguishes it.</summary>
    public const string ExecuteType = "EXECUTE";
}
