using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace Volt.Engine.Format.Network;

/// <summary>The kinds of value a pragma spells (openspec <c>ld-fbd-coverage</c> design "2.3"): ST's literals — a string, a
/// number, <c>TRUE</c>/<c>FALSE</c>, an enum word — and a bracketed list of them.</summary>
public enum PragmaKind { Text, Bool, Int, Word, List }

/// <summary>
/// ONE STORED VALUE OF AN NWL MEMBER, as the pragma spells it. Structural equality, so a model holding it compares by
/// value (an <see cref="Operand"/> is a record compared whole). A scalar keeps its canonical payload in <see cref="Scalar"/>
/// (the decoded string, <c>true</c>/<c>false</c>, the invariant integer, the word); a list its items.
/// </summary>
public sealed class PragmaValue : IEquatable<PragmaValue>
{
    private PragmaValue(PragmaKind kind, string? scalar, IReadOnlyList<PragmaValue>? items)
    {
        Kind = kind;
        Scalar = scalar;
        Items = items;
    }

    public PragmaKind Kind { get; }
    public string? Scalar { get; }
    public IReadOnlyList<PragmaValue>? Items { get; }

    public static PragmaValue Text(string s) => new(PragmaKind.Text, s ?? throw new ArgumentNullException(nameof(s)), null);
    public static PragmaValue Bool(bool b) => new(PragmaKind.Bool, b ? "true" : "false", null);
    public static PragmaValue Int(long i) => new(PragmaKind.Int, i.ToString(CultureInfo.InvariantCulture), null);
    public static PragmaValue Word(string w) =>
        NetworkSpelling.Identifier.IsMatch(w) ? new(PragmaKind.Word, w, null)
            : throw new ArgumentException($"'{w}' is no enum word", nameof(w));
    public static PragmaValue List(IEnumerable<PragmaValue> items) => new(PragmaKind.List, null, items.ToList());
    public static PragmaValue Texts(IEnumerable<string> items) => List(items.Select(Text));

    public bool AsBool => Kind == PragmaKind.Bool ? Scalar == "true" : throw new InvalidOperationException($"a {Kind} pragma value is no BOOL");
    public long AsInt => Kind == PragmaKind.Int ? long.Parse(Scalar!, CultureInfo.InvariantCulture) : throw new InvalidOperationException($"a {Kind} pragma value is no integer");
    public string AsText => Kind == PragmaKind.Text ? Scalar! : throw new InvalidOperationException($"a {Kind} pragma value is no string");
    public string AsWord => Kind == PragmaKind.Word ? Scalar! : throw new InvalidOperationException($"a {Kind} pragma value is no word");
    public IReadOnlyList<string> AsTexts =>
        Kind == PragmaKind.List && Items!.All(i => i.Kind == PragmaKind.Text)
            ? Items!.Select(i => i.Scalar!).ToList()
            : throw new InvalidOperationException($"a {Kind} pragma value is no list of strings");

    /// <summary>The value as the text spells it: ST's own literals.</summary>
    public string Spell() => Kind switch
    {
        PragmaKind.Text => Quote(Scalar!),
        PragmaKind.Bool => Scalar == "true" ? "TRUE" : "FALSE",
        PragmaKind.Int or PragmaKind.Word => Scalar!,
        _ => "[" + string.Join(", ", Items!.Select(i => i.Spell())) + "]",
    };

    /// <summary>An ST single-quoted string: <c>$'</c> a quote, <c>$$</c> the dollar, <c>$N</c>/<c>$R</c>/<c>$T</c> the
    /// line feed, carriage return and tab, <c>$hh</c> any other control character — so a pragma never spans a line.</summary>
    private static string Quote(string s)
    {
        var q = new StringBuilder("'");
        foreach (var c in s)
            q.Append(c switch
            {
                '\'' => "$'",
                '$' => "$$",
                '\n' => "$N",
                '\r' => "$R",
                '\t' => "$T",
                _ when c < ' ' || c == '\u007f' => "$" + ((int)c).ToString("X2", CultureInfo.InvariantCulture),
                _ => c.ToString(),
            });
        return q.Append('\'').ToString();
    }

    public bool Equals(PragmaValue? other) =>
        other is not null && Kind == other.Kind && Scalar == other.Scalar &&
        (Items is null ? other.Items is null : other.Items is not null && Items.SequenceEqual(other.Items));

    public override bool Equals(object? obj) => Equals(obj as PragmaValue);

    public override int GetHashCode()
    {
        var h = ((int)Kind * 397) ^ (Scalar?.GetHashCode() ?? 0);
        if (Items is not null) foreach (var i in Items) h = (h * 31) ^ i.GetHashCode();
        return h;
    }

    public override string ToString() => Spell();

    public static bool operator ==(PragmaValue? a, PragmaValue? b) => a is null ? b is null : a.Equals(b);
    public static bool operator !=(PragmaValue? a, PragmaValue? b) => !(a == b);
}

/// <summary>
/// THE STORED VALUES OF A NODE'S MEMBERS the text spells by pragma (openspec <c>ld-fbd-coverage</c> design "1b.2", "2.3"):
/// member path → value, in the member table's order (<see cref="NetworkMembers"/>), with structural equality.
///
/// <para>A VENDOR READ states every member it read; a TEXT READ states only the spelled ones — the writer spells a value
/// only where it differs from the member's derivation, so an absent member means "the derivation"
/// (<see cref="NetworkMembers.Effective"/>), never "unknown". The two compare equal through
/// <see cref="NetworkMembers.Carried"/>.</para>
/// </summary>
public sealed class NwlMembers : IEquatable<NwlMembers>
{
    public static readonly NwlMembers Empty = new(Array.Empty<KeyValuePair<string, PragmaValue>>());

    private readonly IReadOnlyList<KeyValuePair<string, PragmaValue>> _entries;

    private NwlMembers(IReadOnlyList<KeyValuePair<string, PragmaValue>> entries) => _entries = entries;

    public IReadOnlyList<KeyValuePair<string, PragmaValue>> Entries => _entries;
    public int Count => _entries.Count;

    public PragmaValue? this[string member] =>
        _entries.FirstOrDefault(e => string.Equals(e.Key, member, StringComparison.Ordinal)).Value;

    public bool Has(string member) => _entries.Any(e => string.Equals(e.Key, member, StringComparison.Ordinal));

    /// <summary>A copy holding <paramref name="value"/> for <paramref name="member"/> (null removes it), kept in the member
    /// table's order.</summary>
    public NwlMembers With(string member, PragmaValue? value)
    {
        var list = _entries.Where(e => !string.Equals(e.Key, member, StringComparison.Ordinal)).ToList();
        if (value is not null) list.Add(new KeyValuePair<string, PragmaValue>(member, value));
        list.Sort((a, b) => NetworkMembers.Order(a.Key).CompareTo(NetworkMembers.Order(b.Key)));
        return new NwlMembers(list);
    }

    public static NwlMembers Of(params (string Member, PragmaValue? Value)[] members) =>
        members.Aggregate(Empty, (m, x) => m.With(x.Member, x.Value));

    public bool Equals(NwlMembers? other) =>
        other is not null && _entries.Count == other._entries.Count &&
        _entries.Zip(other._entries, (a, b) => a.Key == b.Key && a.Value == b.Value).All(x => x);

    public override bool Equals(object? obj) => Equals(obj as NwlMembers);

    public override int GetHashCode() => _entries.Aggregate(17, (h, e) => (h * 31) ^ e.Key.GetHashCode() ^ e.Value.GetHashCode());

    public override string ToString() => string.Concat(_entries.Select(e => NetworkPragma.Spell(e.Key, e.Value)));

    public static bool operator ==(NwlMembers? a, NwlMembers? b) => a is null ? b is null : a.Equals(b);
    public static bool operator !=(NwlMembers? a, NwlMembers? b) => !(a == b);
}

/// <summary>
/// THE PRAGMA'S ONE PRODUCTION (openspec <c>ld-fbd-coverage</c> design "2.3"):
/// <c>"{" , member { "." member } , ":=" , literal | "[" literal { "," literal } "]" , "}"</c>, directly after its node.
/// Literals are ST's: a single-quoted string, an integer, <c>TRUE</c>/<c>FALSE</c>, an enum word. The braces are the
/// lexer's (one token, <see cref="TokKind.Pragma"/>); this reads what is inside them.
/// </summary>
public static class NetworkPragma
{
    public static string Spell(string member, PragmaValue value) => "{" + member + " := " + value.Spell() + "}";

    private static readonly Regex MemberPath = new(@"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$", RegexOptions.CultureInvariant);

    /// <summary>Read the inside of one pragma: the member and its value, or the reason it is no pragma.</summary>
    public static (string Member, PragmaValue Value)? Parse(string inner, out string? error)
    {
        error = null;
        var at = inner.IndexOf(":=", StringComparison.Ordinal);
        if (at < 0) { error = "a pragma is `{Member := value}`: no `:=` in it."; return null; }
        var member = inner.Substring(0, at).Trim();
        if (!MemberPath.IsMatch(member)) { error = $"'{member}' is no member name: a pragma names a member as `Name` or `Owner.Name`."; return null; }
        var i = at + 2;
        var value = Value(inner, ref i, out error);
        if (value is null) return null;
        Skip(inner, ref i);
        if (i < inner.Length) { error = $"'{inner.Substring(i).Trim()}' after a pragma's value: a pragma holds one member and one value."; return null; }
        return (member, value);
    }

    private static PragmaValue? Value(string s, ref int i, out string? error, bool inList = false)
    {
        error = null;
        Skip(s, ref i);
        if (i >= s.Length) { error = "a pragma with no value after `:=`."; return null; }
        var c = s[i];
        if (c == '[')
        {
            if (inList) { error = "a list inside a list: a pragma's list holds literals."; return null; }
            i++;
            var items = new List<PragmaValue>();
            Skip(s, ref i);
            if (i < s.Length && s[i] == ']') { i++; return PragmaValue.List(items); }
            while (true)
            {
                var item = Value(s, ref i, out error, inList: true);
                if (item is null) return null;
                items.Add(item);
                Skip(s, ref i);
                if (i < s.Length && s[i] == ',') { i++; continue; }
                if (i < s.Length && s[i] == ']') { i++; return PragmaValue.List(items); }
                error = "a pragma's list is `[a, b, …]`: items are separated by `,` and closed by `]`.";
                return null;
            }
        }
        if (c == '\'')
        {
            var sb = new StringBuilder();
            i++;
            while (true)
            {
                if (i >= s.Length) { error = "an unclosed string in a pragma."; return null; }
                var d = s[i];
                if (d == '\'') { i++; return PragmaValue.Text(sb.ToString()); }
                if (d == '$')
                {
                    if (i + 1 >= s.Length) { error = "a `$` ending a pragma's string."; return null; }
                    var e = s[i + 1];
                    string? v = e switch
                    {
                        '$' => "$", '\'' => "'", 'N' or 'n' or 'L' or 'l' => "\n", 'R' or 'r' => "\r", 'T' or 't' => "\t",
                        'P' or 'p' => "\f", _ => null,
                    };
                    if (v is not null) { sb.Append(v); i += 2; continue; }
                    // Exactly two hex digits: HexNumber alone also takes a leading or trailing space ('$A ' read as $0A),
                    // which the LSP's port refuses (gate 2-3 review).
                    if (i + 2 < s.Length && Uri.IsHexDigit(s[i + 1]) && Uri.IsHexDigit(s[i + 2])
                        && int.TryParse(s.Substring(i + 1, 2), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out var code))
                    {
                        sb.Append((char)code);
                        i += 3;
                        continue;
                    }
                    error = $"the escape '${e}' in a pragma's string: ST spells $$, $', $N, $R, $T, $L, $P and $hh.";
                    return null;
                }
                sb.Append(d);
                i++;
            }
        }
        var start = i;
        while (i < s.Length && (char.IsLetterOrDigit(s[i]) || s[i] == '_' || s[i] == '-')) i++;
        var word = s.Substring(start, i - start);
        if (word.Length == 0) { error = $"'{s[start]}' where a pragma's value is expected: a string, a number, TRUE/FALSE, a word or a list."; return null; }
        if (string.Equals(word, "TRUE", StringComparison.OrdinalIgnoreCase)) return PragmaValue.Bool(true);
        if (string.Equals(word, "FALSE", StringComparison.OrdinalIgnoreCase)) return PragmaValue.Bool(false);
        if (Regex.IsMatch(word, @"^-?[0-9]+$") && long.TryParse(word, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var n))
            return PragmaValue.Int(n);
        if (NetworkSpelling.Identifier.IsMatch(word)) return PragmaValue.Word(word);
        error = $"'{word}' is no literal a pragma holds.";
        return null;
    }

    private static void Skip(string s, ref int i)
    {
        while (i < s.Length && char.IsWhiteSpace(s[i])) i++;
    }
}
