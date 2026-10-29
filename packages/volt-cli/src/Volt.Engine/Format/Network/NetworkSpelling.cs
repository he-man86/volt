using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace Volt.Engine.Format.Network;

/// <summary>
/// The facts of the model the network text's writer and reader and the vendors' readers and writers must agree on, in ONE
/// place: which box is an operator, its default pin names, how a box's output slots are numbered, the escape of delimited
/// text. A rule kept twice drifts, and a text that reads back cleanly into a DIFFERENT model passes unseen.
/// </summary>
internal static class NetworkSpelling
{
    public static readonly Regex Identifier = new(@"^[A-Za-z_][A-Za-z0-9_]*$", RegexOptions.Compiled);
    public static readonly Regex Path = new(@"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$", RegexOptions.Compiled);

    /// <summary>A direct address (<c>%QW105</c>).</summary>
    public static readonly Regex Address = new(@"^%[IQM][XBWDL]?[0-9]+(\.[0-9]+)*$", RegexOptions.Compiled);

    /// <summary>The word of a network's one line where the text has no spelling for its trees.</summary>
    public const string UnsupportedWord = St.PropertyLines.UnsupportedWord;

    /// <summary>What may follow <see cref="UnsupportedWord"/>: the refusal's shape name, words separated by one space.</summary>
    public static readonly Regex UnsupportedShape = new(@"^[A-Za-z0-9_]+( [A-Za-z0-9_]+)*$", RegexOptions.CultureInvariant);

    /// <summary>The hash an UNSUPPORTED line carries: 8 lower-case hex digits.</summary>
    public static readonly Regex UnsupportedHash = new(@"^[0-9a-f]{8}$", RegexOptions.CultureInvariant);

    /// <summary>The 14 keyword operator boxes.</summary>
    public static readonly HashSet<string> OperatorWords = new(StringComparer.OrdinalIgnoreCase)
        { "AND", "OR", "XOR", "ADD", "SUB", "MUL", "DIV", "MOD", "GT", "GE", "EQ", "NE", "LE", "LT" };

    public const string Move = "MOVE";
    public const string NotBox = "NOT";

    /// <summary>The type the Execute box's model carries; the ST is what distinguishes it.</summary>
    public const string ExecuteType = "EXECUTE";

    public const string Bool = "BOOL";

    /// <summary>Operator boxes whose result is BOOL whatever their operands.</summary>
    internal static readonly HashSet<string> Comparisons = new(StringComparer.OrdinalIgnoreCase)
        { "GT", "GE", "LT", "LE", "EQ", "NE" };

    /// <summary>The bit operators: the boxes the vendor stores NO main output for (census 1.6: none on 823).</summary>
    public static readonly HashSet<string> BitOperators = new(StringComparer.OrdinalIgnoreCase)
        { "AND", "OR", "XOR", "NOT" };

    /// <summary>A name a declaration makes and a call can head: an identifier, or a qualified one.</summary>
    public static bool IsName(string t) => Identifier.IsMatch(t) || Path.IsMatch(t);

    /// <summary>Whether a box type is one of the operators (the table, MOVE, the NOT box).</summary>
    public static bool IsOperatorBox(string type) =>
        OperatorWords.Contains(type) || string.Equals(type, Move, StringComparison.OrdinalIgnoreCase) ||
        string.Equals(type, NotBox, StringComparison.OrdinalIgnoreCase);

    /// <summary>The default formal of an operator's input: <c>IN&lt;n&gt;</c> on the table's operators, <c>IN</c> on the
    /// NOT box and MOVE — read back as no name, the vendor's own (an operator box stores no input names, census 1.13).
    /// Null for any other box.</summary>
    private static string? DefaultFormal(string type, int pin) =>
        OperatorWords.Contains(type) ? "IN" + (pin + 1).ToString(System.Globalization.CultureInfo.InvariantCulture)
        : string.Equals(type, Move, StringComparison.OrdinalIgnoreCase) || string.Equals(type, NotBox, StringComparison.OrdinalIgnoreCase) ? "IN"
        : null;

    /// <summary>Whether a pin's stored formal is its operator's default — a fact the text does not carry.</summary>
    public static bool IsDefaultFormal(string type, int pin, string? formal) =>
        formal is null || (DefaultFormal(type, pin) is { } d && string.Equals(formal, d, StringComparison.OrdinalIgnoreCase));

    /// <summary>THE VALUE SLOT a consumer of a box reads when it reads the box by its value (not by ENO, not by an FB's
    /// <c>.name</c>): none on a bit operator (census 1.6; a stored one is lost on rebuild, B7), slot 0 on every other.</summary>
    public static int? MainSlotOfCall(string type) => BitOperators.Contains(type) ? null : 0;

    /// <summary>The pins an IEC operator box has (<see cref="IsIecOperator"/>): one value, no input or output of its own named
    /// EN or ENO.</summary>
    private static readonly CalleeSignature OperatorSignature = new(CalleeShape.Function, Array.Empty<string>(), Array.Empty<string>());

    /// <summary>THE PINS THE CALLEE OF <paramref name="b"/> DECLARES (openspec network-output-member): an operator's own, an
    /// FB's its block type's, any other call's its callee's (<see cref="NetworkScope.Signature"/>) — or null where no
    /// declaration in reach states them, and for the Execute box, whose pins are the text's own (<c>EN</c>, <c>CODE</c>).</summary>
    public static CalleeSignature? SignatureOf(Box b, NetworkScope scope) =>
        b.StCode is not null ? null : SignatureOf(b.Type, b.Instance is not null, scope);

    /// <summary>Whether a box type is an IEC operator the compiler provides — the keyword boxes, MOVE and NOT, and every
    /// other one (LIMIT, SEL, the shifts, the conversions, …, <see cref="NetworkMembers.IsOperatorType"/>): a name no
    /// declaration makes, whose pins are the operator's (as the LSP reads every builtin, <c>network-box.ts</c>).</summary>
    private static bool IsIecOperator(string type) => IsOperatorBox(type) || NetworkMembers.IsOperatorType(type);

    /// <summary>The pins a box of <paramref name="type"/> declares, an FB's (<paramref name="block"/>) or a call's.</summary>
    public static CalleeSignature? SignatureOf(string type, bool block, NetworkScope scope)
    {
        if (!block && IsOperatorBox(type)) return OperatorSignature;
        var signature = scope.Signature(type);
        // Any other IEC operator: where no declaration in reach names it (a POU named as a conversion is its own).
        if (signature is null) return !block && IsIecOperator(type) ? OperatorSignature : null;
        return block == (signature.Shape == CalleeShape.Block) ? signature : null;
    }

    /// <summary>Whether a consumer of <paramref name="b"/> is connected to its ENO.</summary>
    public static bool ConnectedByEno(Box b) => b.HasEnoOutput && b.ConnectedSlot == 0;

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

    /// <summary>Delimited text (a <c>//</c> line, a title) written with IEC's escape: <c>$</c> is <c>$$</c>, a line feed
    /// <c>$L</c>, a carriage return <c>$R</c>, and the delimiter <paramref name="quote"/> (a <c>"</c> is <c>$"</c>).
    /// Everything else is verbatim.</summary>
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

    // ── the Execute box's ST: a string with its line breaks as they stand ──────────────────────────────────────────────

    /// <summary>The Execute box's ST as its <c>CODE := '…'</c> string (openspec network-output-member 2.6): a <c>'</c> is
    /// <c>$'</c>, a <c>$</c> is <c>$$</c>, and everything else — a line break, a tab — stands as it is, so the code reads as
    /// the engineer wrote it.</summary>
    public static string EscapeCode(string st)
    {
        var sb = new StringBuilder(st.Length);
        foreach (var c in st)
        {
            if (c == '$') sb.Append("$$");
            else if (c == '\'') sb.Append("$'");
            else sb.Append(c);
        }
        return sb.ToString();
    }

    /// <summary>The inverse of <see cref="EscapeCode"/>: <c>$'</c> and <c>$$</c>, the only escapes of the code. Null and
    /// <paramref name="error"/> for any other <c>$</c>: one spelling per code, so a <c>$N</c> is refused, not read as a line
    /// break the text writes as it stands.</summary>
    public static string? UnescapeCode(string text, out string? error)
    {
        error = null;
        var sb = new StringBuilder(text.Length);
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (c != '$') { sb.Append(c); continue; }
            var e = i + 1 < text.Length ? text[i + 1] : '\0';
            if (e != '$' && e != '\'')
            {
                error = e == '\0'
                    ? "a `$` at the end of the Execute box's CODE: a `$` is written `$$`"
                    : $"the escape '${e}' in the Execute box's CODE: its code spells a ' as $' and a $ as $$, and everything else as it stands";
                return null;
            }
            sb.Append(e);
            i++;
        }
        return sb.ToString();
    }
}
