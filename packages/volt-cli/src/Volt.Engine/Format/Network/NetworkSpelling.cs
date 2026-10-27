using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace Volt.Engine.Format.Network;

/// <summary>
/// The spelling rules network text's writer and reader must agree on, in ONE place (openspec <c>ld-fbd-coverage</c>
/// 2R.6b, <c>v2-spec.md</c>): a token the writer leaves bare lexes as one token, a word the writer backticks is reserved,
/// and a box's slots are numbered by the same rule on both sides. A spelling that reads back cleanly into a DIFFERENT model
/// passes unseen, which the model oracle <c>Read(Write(m)) ≅ m</c> catches offline — the reason this table is shared.
/// </summary>
internal static class NetworkSpelling
{
    public static readonly Regex Identifier = new(@"^[A-Za-z_][A-Za-z0-9_]*$", RegexOptions.Compiled);
    public static readonly Regex Path = new(@"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$", RegexOptions.Compiled);
    /// <summary>A number and a direct address, unanchored: the lexer reads them at its position with these same patterns,
    /// so what the writer leaves bare is what the lexer takes as one token.</summary>
    internal const string NumberPattern = @"[0-9][0-9_]*(\.[0-9][0-9_]*)?([eE][+-]?[0-9]+)?";
    internal const string AddressPattern = @"%[IQM][XBWDL]?[0-9]+(\.[0-9]+)*";

    /// <summary>A number, its minus touching the digit (<c>-1</c>).</summary>
    public static readonly Regex Number = new("^-?" + NumberPattern + "$", RegexOptions.Compiled);
    // T#1S, TIME#1h2m, 16#FF, INT#5, DT#2020-01-01-12:00:00 — one ST literal token, no whitespace.
    public static readonly Regex Typed = new(@"^-?[A-Za-z0-9_]+#[A-Za-z0-9_.:+\-]+$", RegexOptions.Compiled);
    public static readonly Regex Address = new("^" + AddressPattern + "$", RegexOptions.Compiled);
    /// <summary>ST's string literals, whole: one token, on one line, <c>$</c> escaping the character after it.</summary>
    public static readonly Regex SString = new(@"^'([^'$\r\n]|\$[^\r\n])*'$", RegexOptions.Compiled);
    public static readonly Regex DString = new(@"^""([^""$\r\n]|\$[^\r\n])*""$", RegexOptions.Compiled);

    /// <summary>A split's name: <c>split</c> plus the vendor's VarId, no leading zeros. The PATTERN is reserved — a bare word
    /// of that shape is always a split — matched case-insensitively.</summary>
    public static readonly Regex SplitShape = new(@"^split[0-9]+$", RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    public const string SplitPrefix = "split";

    public static string SplitName(int varId) => SplitPrefix + varId.ToString(System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>THE RESERVED WORDS, compared case-insensitively: a name spelled like one is backticked.</summary>
    public static readonly HashSet<string> TextWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "EN", "ENO", BranchWord, ShortCircuitWord, "JMP", "RETURN", "EXECUTE", "END_EXECUTE", "NOT",
        "R_EDGE", "F_EDGE", "NETWORK", "END_NETWORK", UnsupportedWord, Move,
        "AND", "OR", "XOR", "ADD", "SUB", "MUL", "DIV", "MOD", "GT", "GE", "EQ", "NE", "LE", "LT",
    };

    /// <summary>Whether <paramref name="t"/> is reserved: a word of the text, or the split pattern.</summary>
    public static bool IsReserved(string t) => TextWords.Contains(t) || SplitShape.IsMatch(t);

    /// <summary>The word of a network's one line where the text has no spelling for its trees.</summary>
    public const string UnsupportedWord = St.PropertyLines.UnsupportedWord;

    /// <summary>What may follow <see cref="UnsupportedWord"/>: the refusal's shape name, words separated by one space.</summary>
    public static readonly Regex UnsupportedShape = new(@"^[A-Za-z0-9_]+( [A-Za-z0-9_]+)*$", RegexOptions.CultureInvariant);

    /// <summary>The hash an UNSUPPORTED line carries: 8 lower-case hex digits.</summary>
    public static readonly Regex UnsupportedHash = new(@"^[0-9a-f]{8}$", RegexOptions.CultureInvariant);

    /// <summary>The operator boxes written as their WORD, between their inputs.</summary>
    public static readonly HashSet<string> OperatorWords = new(StringComparer.OrdinalIgnoreCase)
        { "AND", "OR", "XOR", "ADD", "SUB", "MUL", "DIV", "MOD", "GT", "GE", "EQ", "NE", "LE", "LT" };

    /// <summary>The operators that take exactly two inputs (the build refuses a third: "needs exactly '2' operands").</summary>
    public static readonly HashSet<string> TwoInputOperators = new(StringComparer.OrdinalIgnoreCase)
        { "SUB", "DIV", "MOD", "GT", "GE", "EQ", "NE", "LE", "LT" };

    public const string Move = "MOVE";
    public const string NotBox = "NOT";

    /// <summary>The type the Execute box's model carries; the ST is what distinguishes it.</summary>
    public const string ExecuteType = "EXECUTE";

    public const string ShortCircuitWord = "SHORTCIRCUIT";
    public const string BranchWord = "BRANCH";

    /// <summary>The mode a Parallel the editor creates holds (N20: <c>Sequential</c>), written as nothing; the other
    /// measured one is <c>SHORTCIRCUIT</c>.</summary>
    public const ParallelMode DerivedMode = ParallelMode.Sequential;

    public const string Bool = "BOOL";

    /// <summary>Operator boxes whose result is BOOL whatever their operands.</summary>
    internal static readonly HashSet<string> Comparisons = new(StringComparer.OrdinalIgnoreCase)
        { "GT", "GE", "LT", "LE", "EQ", "NE" };

    /// <summary>The bit operators: the boxes the vendor stores NO main output for (census 1.6: none on 823).</summary>
    public static readonly HashSet<string> BitOperators = new(StringComparer.OrdinalIgnoreCase)
        { "AND", "OR", "XOR", "NOT" };

    /// <summary>A name a declaration makes and a call can head: an identifier, or a qualified one.</summary>
    public static bool IsName(string t) => Identifier.IsMatch(t) || Path.IsMatch(t);

    /// <summary>An ST literal the text writes bare: a number (its minus touching it), a typed literal, a string.</summary>
    public static bool IsLiteral(string t) => Number.IsMatch(t) || Typed.IsMatch(t) || SString.IsMatch(t) || DString.IsMatch(t);

    /// <summary>Whether <paramref name="t"/> is exactly one bare token of the text: a name that is not reserved, a
    /// literal, an address, or the vendor's <c>???</c>.</summary>
    public static bool IsToken(string t) =>
        t == Box.UnnamedInstance || IsLiteral(t) || Address.IsMatch(t) || (!IsReserved(t) && IsName(t));

    /// <summary>Whether a target, a call head, an FB type or a pin name may stand bare: a name that is not reserved, the
    /// vendor's <c>???</c>, or an address. A literal is none.</summary>
    public static bool IsBareName(string t) =>
        t == Box.UnnamedInstance || Address.IsMatch(t) || (IsName(t) && !IsReserved(t));

    /// <summary>Whether a box type is one of the operators the text names by a word (the table, MOVE, the NOT box).</summary>
    public static bool IsOperatorBox(string type) =>
        OperatorWords.Contains(type) || string.Equals(type, Move, StringComparison.OrdinalIgnoreCase) ||
        string.Equals(type, NotBox, StringComparison.OrdinalIgnoreCase);

    /// <summary>The default formal of an operator's input: <c>IN&lt;n&gt;</c> on the table's operators, <c>IN</c> on the
    /// NOT box and MOVE — read back as no name, the vendor's own (an operator box stores no input names, census 1.13).
    /// Null for any other box.</summary>
    public static string? DefaultFormal(string type, int pin) =>
        OperatorWords.Contains(type) ? "IN" + (pin + 1).ToString(System.Globalization.CultureInfo.InvariantCulture)
        : string.Equals(type, Move, StringComparison.OrdinalIgnoreCase) || string.Equals(type, NotBox, StringComparison.OrdinalIgnoreCase) ? "IN"
        : null;

    /// <summary>Whether a pin's stored formal is its operator's default — a fact the text does not carry.</summary>
    public static bool IsDefaultFormal(string type, int pin, string? formal) =>
        formal is null || (DefaultFormal(type, pin) is { } d && string.Equals(formal, d, StringComparison.OrdinalIgnoreCase));

    /// <summary>THE VALUE SLOT a consumer of a box reads when it reads the box by its value (not by ENO, not by an FB's
    /// <c>.name</c>): none on a bit operator (census 1.6; a stored one is lost on rebuild, B7), slot 0 on every other.</summary>
    public static int? MainSlotOfCall(string type) => BitOperators.Contains(type) ? null : 0;

    /// <summary>The ENO slot: output slot 0 of a box with an ENO output.</summary>
    public static int? EnoSlot(Box b) => b.HasEnoOutput ? 0 : null;

    /// <summary>Whether a consumer of <paramref name="b"/> is connected to its ENO.</summary>
    public static bool ConnectedByEno(Box b) => b.HasEnoOutput && b.ConnectedSlot == 0;

    /// <summary>Whether the text shows the box's <c>ENO</c>: a box with an ENO output that is enabled, or a function's (its
    /// ENO without EN builds on both vendors — recorded, <c>rcc_network_eno_function_without_en</c>). An FB's declared ENO
    /// and an Execute box's are read with nothing after the box; an operator's does not build without EN (X9).</summary>
    public static bool EnoShown(Box b) => b.HasEnoOutput && (b.Enable is not null || IsFunctionBox(b));

    /// <summary>A box that calls a function (or a program): no FB instance, no Execute box, no operator of the text.</summary>
    private static bool IsFunctionBox(Box b) => b.Instance is null && b.StCode is null && !IsOperatorBox(b.Type);

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

    private static readonly Regex WordPattern = new(@"[A-Za-z_][A-Za-z0-9_]*", RegexOptions.Compiled);

    /// <summary>Every identifier-shaped word in <paramref name="text"/>.</summary>
    public static IEnumerable<string> Words(string text) => WordPattern.Matches(text).Cast<Match>().Select(m => m.Value);

    // ── delimited text: the one escape (IEC's) ──────────────────────────────────────────────────────────────────────

    /// <summary>Delimited text (a <c>//</c> line, a TITLE, a backticked operand) written with IEC's escape: <c>$</c> is
    /// <c>$$</c>, a line feed <c>$L</c>, a carriage return <c>$R</c>, and the delimiter <paramref name="quote"/> (a <c>"</c>
    /// is <c>$"</c>; a backtick is doubled). Everything else is verbatim.</summary>
    public static string Escape(string text, char? quote)
    {
        var sb = new StringBuilder(text.Length);
        foreach (var c in text)
        {
            switch (c)
            {
                case '$': sb.Append("$$"); break;
                case '\n': sb.Append("$L"); break;
                case '\r': sb.Append("$R"); break;
                case '"' when quote == '"': sb.Append("$\""); break;
                case '`' when quote == '`': sb.Append("``"); break;
                default: sb.Append(c); break;
            }
        }
        return sb.ToString();
    }

    /// <summary>The inverse of <see cref="Escape"/>: <c>$$ $' $" $L $N $R $T</c> (case-insensitive letters; <c>$N</c> is the
    /// IDE's line end, CR LF). Null and <paramref name="error"/> for any other escape or a <c>$</c> at the end.</summary>
    public static string? Unescape(string text, out string? error)
    {
        error = null;
        var sb = new StringBuilder(text.Length);
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (c != '$') { sb.Append(c); continue; }
            var e = i + 1 < text.Length ? text[i + 1] : '\0';
            string? v = e switch
            {
                '$' => "$", '\'' => "'", '"' => "\"", 'L' or 'l' => "\n", 'N' or 'n' => "\r\n", 'R' or 'r' => "\r",
                'T' or 't' => "\t", _ => null,
            };
            if (v is null)
            {
                error = e == '\0'
                    ? "a `$` at the end of delimited text: a `$` is written `$$`."
                    : $"the escape '${e}': delimited text spells $$ $' $\" $L $N $R $T (IEC's escapes), and a `$` is written `$$`.";
                return null;
            }
            sb.Append(v);
            i++;
        }
        return sb.ToString();
    }
}
