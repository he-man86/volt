using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Volt.Engine.Format.Network;

/// <summary>Where a box stands, for the derivations that depend on it: whether something consumes it.</summary>
public sealed record BoxSite(bool Consumed);

/// <summary>The kinds of value a stored member takes.</summary>
public enum MemberKind { Text, List }

/// <summary>
/// ONE STORED VALUE OF AN NWL MEMBER a vendor reader read (openspec <c>ld-fbd-coverage</c> design "1b.2"). Structural
/// equality, so a model holding it compares by value. B7 (2R.3): the text spells no member — a stored value is the
/// vendor's, carried for the rebuild-loss warning (<see cref="RebuildLoss"/>) and for the in-place write that keeps an
/// unchanged box, never written into the text.
/// </summary>
public sealed class MemberValue : IEquatable<MemberValue>
{
    private MemberValue(MemberKind kind, string? scalar, IReadOnlyList<MemberValue>? items)
    {
        Kind = kind;
        Scalar = scalar;
        Items = items;
    }

    public MemberKind Kind { get; }
    public string? Scalar { get; }
    public IReadOnlyList<MemberValue>? Items { get; }

    public static MemberValue Text(string s) => new(MemberKind.Text, s ?? throw new ArgumentNullException(nameof(s)), null);
    public static MemberValue List(IEnumerable<MemberValue> items) => new(MemberKind.List, null, items.ToList());
    public static MemberValue Texts(IEnumerable<string> items) => List(items.Select(Text));

    public IReadOnlyList<string> AsTexts =>
        Kind == MemberKind.List && Items!.All(i => i.Kind == MemberKind.Text)
            ? Items!.Select(i => i.Scalar!).ToList()
            : throw new InvalidOperationException($"a {Kind} member value is no list of strings");

    public bool Equals(MemberValue? other) =>
        other is not null && Kind == other.Kind && Scalar == other.Scalar &&
        (Items is null ? other.Items is null : other.Items is not null && Items.SequenceEqual(other.Items));

    public override bool Equals(object? obj) => Equals(obj as MemberValue);

    public override int GetHashCode()
    {
        var h = ((int)Kind * 397) ^ (Scalar?.GetHashCode() ?? 0);
        if (Items is not null) foreach (var i in Items) h = (h * 31) ^ i.GetHashCode();
        return h;
    }

    public override string ToString() =>
        Kind == MemberKind.Text ? "'" + Scalar + "'" : "[" + string.Join(", ", Items!.Select(i => i.ToString())) + "]";

    public static bool operator ==(MemberValue? a, MemberValue? b) => a is null ? b is null : a.Equals(b);
    public static bool operator !=(MemberValue? a, MemberValue? b) => !(a == b);
}

/// <summary>
/// THE STORED VALUES OF A NODE'S MEMBERS a vendor reader read: member path → value, with structural equality. A text read
/// states none (B7): an absent member is its derivation (<see cref="NetworkMembers.Effective"/>), never "unknown".
/// </summary>
public sealed class NwlMembers : IEquatable<NwlMembers>
{
    public static readonly NwlMembers Empty = new(Array.Empty<KeyValuePair<string, MemberValue>>());

    private readonly IReadOnlyList<KeyValuePair<string, MemberValue>> _entries;

    private NwlMembers(IReadOnlyList<KeyValuePair<string, MemberValue>> entries) => _entries = entries;

    public IReadOnlyList<KeyValuePair<string, MemberValue>> Entries => _entries;
    public int Count => _entries.Count;

    public MemberValue? this[string member] =>
        _entries.FirstOrDefault(e => string.Equals(e.Key, member, StringComparison.Ordinal)).Value;

    public NwlMembers With(string member, MemberValue? value)
    {
        var list = _entries.Where(e => !string.Equals(e.Key, member, StringComparison.Ordinal)).ToList();
        if (value is not null) list.Add(new KeyValuePair<string, MemberValue>(member, value));
        list.Sort((a, b) => string.CompareOrdinal(a.Key, b.Key));
        return new NwlMembers(list);
    }

    public static NwlMembers Of(params (string Member, MemberValue? Value)[] members) =>
        members.Aggregate(Empty, (m, x) => m.With(x.Member, x.Value));

    public bool Equals(NwlMembers? other) =>
        other is not null && _entries.Count == other._entries.Count &&
        _entries.Zip(other._entries, (a, b) => a.Key == b.Key && a.Value == b.Value).All(x => x);

    public override bool Equals(object? obj) => Equals(obj as NwlMembers);

    public override int GetHashCode() => _entries.Aggregate(17, (h, e) => (h * 31) ^ e.Key.GetHashCode() ^ e.Value.GetHashCode());

    public override string ToString() => string.Join(", ", _entries.Select(e => e.Key + " = " + e.Value));

    public static bool operator ==(NwlMembers? a, NwlMembers? b) => a is null ? b is null : a.Equals(b);
    public static bool operator !=(NwlMembers? a, NwlMembers? b) => !(a == b);
}

/// <summary>
/// THE DERIVED MEMBERS (openspec <c>ld-fbd-coverage</c> 2R.2 "D", B7): what a push builds a box with from the text alone —
/// its output names and types — and, where a vendor reader read them, the stored ones (<see cref="Effective"/>). The text
/// spells neither: a stored value that differs from the derivation is LOST ON REBUILD (2R.2 Open item 5, owner), named by
/// <see cref="RebuildLoss"/>, and kept byte for byte by every push that does not rebuild its network (N28).
/// </summary>
public static class NetworkMembers
{
    public const string OutputNames = "OutputParam.Names";
    public const string OutputTypes = "OutputParam.Types";

    /// <summary>The value a box holds: the stored one a vendor reader read, else the derivation.</summary>
    public static MemberValue Effective(Box b, BoxSite site, string member) => member switch
    {
        OutputNames => b.Members?[OutputNames] ?? MemberValue.Texts(DerivedOutputNames(b, site.Consumed)),
        OutputTypes => b.OutputTypes is { } t ? MemberValue.Texts(t.Select(x => x ?? "")) : MemberValue.Texts(DerivedOutputTypes(b, site)),
        _ => throw new ArgumentException($"'{member}' is no box member", nameof(member)),
    };

    /// <summary>Whether the model states the box's stored members — a vendor read — or derives them all (a text read).</summary>
    public static bool Stated(Box b) => b.Members is not null || b.OutputTypes is not null;

    /// <summary>The output names the text's own pins give: the box's slots as <see cref="TextOutputSlots"/> lays them out,
    /// none at all where no slot is named (the plain AND/OR, census 1.6).</summary>
    public static IReadOnlyList<string> DerivedOutputNames(Box b, bool consumed)
    {
        var slots = TextOutputSlots(b, consumed);
        return ResultSlot(b, consumed) is not null || slots.Any(s => !string.IsNullOrEmpty(s))
            ? slots.Select(s => s ?? "").ToList()
            : Array.Empty<string>();
    }

    /// <summary>
    /// THE OUTPUT NAMES AND TYPES A PUSH CAN BUILD: the box's own (<see cref="Effective"/>), except where they hold a
    /// FUNCTION'S RESULT PIN (<see cref="FunctionResult"/>, <c>'   '</c>) — which only a box the IDE resolved can hold
    /// (DIALECT N37). There the derivation is built, and the drawn name is the rebuild's loss, named by
    /// <see cref="RebuildLoss"/>.
    /// </summary>
    public static (IReadOnlyList<string> Names, IReadOnlyList<string> Types) Buildable(Box b, BoxSite site)
    {
        var names = Effective(b, site, OutputNames).AsTexts;
        if (!names.Contains(FunctionResult)) return (names, Effective(b, site, OutputTypes).AsTexts);
        return (DerivedOutputNames(b, site.Consumed), DerivedOutputTypes(b, site));
    }

    /// <summary>The output types a push writes from the text: BOOL for the ENO echo (186 of 186 stored ENO slots) and a
    /// comparison's result (45 of 45); any other slot the text does not type (the push's derivation is the IDE's).</summary>
    public static IReadOnlyList<string> DerivedOutputTypes(Box b, BoxSite site)
    {
        var names = DerivedOutputNames(b, site.Consumed);
        var result = ResultSlot(b, site.Consumed);
        return Enumerable.Range(0, names.Count).Select(i =>
            names[i] == Box.EnoPin ? NetworkSpelling.Bool
            : i == result && NetworkSpelling.Comparisons.Contains(b.Type) ? NetworkSpelling.Bool
            : "").ToList();
    }

    /// <summary>A function's result pin as the vendor names it: three spaces (97 of 97 corpus function boxes without
    /// EN). NOT a derivation: a box Volt builds cannot hold it (<see cref="Buildable"/>).</summary>
    public const string FunctionResult = "   ";

    /// <summary>The IEC operators CODESYS resolves to an <c>Operator</c> member of its own, as opposed to a call of a
    /// FUNCTION POU — the two name their result differently (an operator <c>''</c>, a function <c>'   '</c>).</summary>
    private static bool IsOperatorType(string type) =>
        OperatorTypes.Contains(type) ||
        System.Text.RegularExpressions.Regex.IsMatch(type, @"^[A-Za-z]+_TO_[A-Za-z]+$", System.Text.RegularExpressions.RegexOptions.CultureInvariant);

    private static readonly HashSet<string> OperatorTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "MOVE", "ADD", "SUB", "MUL", "DIV", "MOD", "EXPT", "GT", "GE", "EQ", "NE", "LE", "LT", "AND", "OR", "XOR", "NOT",
        "SEL", "MAX", "MIN", "LIMIT", "MUX", "SHL", "SHR", "ROL", "ROR", "ABS", "SQRT", "LN", "LOG", "EXP", "SIN", "COS",
        "TAN", "ASIN", "ACOS", "ATAN", "TRUNC", "SIZEOF", "ADR", "BITADR", "INDEXOF",
    };

    /// <summary>The slot of the box's data result in <see cref="TextOutputSlots"/>, or null where it lists none.</summary>
    private static int? ResultSlot(Box b, bool consumed)
    {
        if (b.StCode is not null || b.Instance is not null || !IsOperatorType(b.Type) || NetworkSpelling.BitOperators.Contains(b.Type)) return null;
        if (b.Outputs.Any(o => o.Formal is not null)) return null;
        return CarriedHasEno(b, consumed) ? 1 : 0;
    }

    /// <summary>The box's output slots as the text states them: the ENO echo first where the box has one, then the data
    /// result of an operator, then each pin.</summary>
    private static IReadOnlyList<string?> TextOutputSlots(Box b, bool consumed)
    {
        var slots = new List<string?>();
        if (b.StCode is not null || CarriedHasEno(b, consumed)) slots.Add(Box.EnoPin);
        if (ResultSlot(b, consumed) is { } r)
        {
            while (slots.Count < r) slots.Add(null);
            slots.Add("");
        }
        foreach (var o in b.Outputs)
        {
            if (o.Formal is null && o.Slot is { } at)
            {
                if (at < slots.Count) { slots[at] ??= ""; continue; }
                while (slots.Count < at) slots.Add(null);
                slots.Add("");
                continue;
            }
            slots.Add(o.Formal);
        }
        return slots;
    }

    /// <summary>Whether the box has an ENO output AS THE TEXT CARRIES IT.</summary>
    private static bool CarriedHasEno(Box b, bool consumed)
    {
        if (NetworkSpelling.EnoCarried(b, consumed) && b.HasEnoOutput is { } stated) return stated;
        return NetworkSpelling.TextHasEno(isExecute: b.StCode is not null, hasEnable: b.Enable is not null,
            enoSuffix: NetworkSpelling.ConnectedByEno(b), consumed: consumed);
    }
}
