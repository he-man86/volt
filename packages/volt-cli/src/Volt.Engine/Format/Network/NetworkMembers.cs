using System;
using System.Collections.Generic;
using System.Linq;

namespace Volt.Engine.Format.Network;

/// <summary>Which model node a member belongs to — the node its pragma is written after.</summary>
public enum MemberOwner { Box }

/// <summary>Where a box stands, for the derivations that depend on it: whether something consumes it, and — when it is a
/// wire's producer — the type the wire is declared with.</summary>
public sealed record BoxSite(bool Consumed, string? WireType = null);

/// <summary>
/// ONE MEMBER THE TEXT SPELLS BY PRAGMA (openspec <c>ld-fbd-coverage</c> design "1b.2", "2.3"): its path as the pragma names
/// it, the node it belongs to, the kind of value it takes, how the model holds it, and its DERIVATION — the value the text
/// implies where no pragma states one. The writer spells a stored value only where it differs from the derivation; the
/// reader keeps a spelled one; a driver building the node writes the stored value, else the derivation
/// (<see cref="NetworkMembers.Effective(Box, BoxSite, string)"/>). A derivation reads the CARRIED model only — what the
/// text says — so a text read gives back the vendor read.
/// </summary>
public sealed class BoxMember
{
    internal BoxMember(string name, PragmaKind kind, Func<Box, PragmaValue?> get, Func<Box, PragmaValue, Box> with,
        Func<Box, BoxSite, PragmaValue> derive)
    {
        Name = name; Kind = kind; Get = get; With = with; Derive = derive;
    }

    public string Name { get; }
    public PragmaKind Kind { get; }
    /// <summary>The stored value the model holds, or null where none was read (a text read: the derivation).</summary>
    public Func<Box, PragmaValue?> Get { get; }
    /// <summary>The box holding <c>value</c> as this member's stored value.</summary>
    public Func<Box, PragmaValue, Box> With { get; }
    /// <summary>The value the text implies for the box at its site.</summary>
    public Func<Box, BoxSite, PragmaValue> Derive { get; }
}

/// <summary>THE MEMBER TABLE THE PRAGMA SPELLS — the engine's half of design "1b.2" (the oracle's half is the test
/// suites' <c>NwlDisposition</c>): every member a pragma may name, with its derivation. A pragma naming anything else is
/// refused by name.</summary>
public static class NetworkMembers
{
    public const string OutputNames = "OutputParam.Names";
    public const string OutputTypes = "OutputParam.Types";

    /// <summary>The box members, in the order the writer spells them.</summary>
    public static readonly IReadOnlyList<BoxMember> OfBox = new[]
    {
        // A box's output pin names, index-aligned with its output slots — S1's stored slot on a bit operator ([''] where
        // the plain box holds none), a call's whole output list (its unconnected pins included). Derivation: the names
        // the text's own pins give — ENO first where the box has one, then each `=>` pin's formal at its slot — and
        // none at all where no slot is named.
        new BoxMember(OutputNames, PragmaKind.List,
            b => b.Members?[OutputNames],
            (b, v) => b with { Members = (b.Members ?? NwlMembers.Empty).With(OutputNames, v) },
            (b, site) => PragmaValue.Texts(DerivedOutputNames(b, site.Consumed))),

        // The stored output types, index-aligned with the slots — the model's OutputTypes (an entry the vendor stores
        // empty is null there). Derivation: what a push writes from the text alone — "" for each named slot, and a wire
        // producer's declared type at the slot its consumer is connected to (NetworkText.WithDeclaredType).
        new BoxMember(OutputTypes, PragmaKind.List,
            b => b.OutputTypes is { } t ? PragmaValue.Texts(t.Select(x => x ?? "")) : null,
            (b, v) => b with { OutputTypes = v.AsTexts.Select(x => x.Length == 0 ? null : x).ToList() },
            (b, site) => PragmaValue.Texts(DerivedOutputTypes(b, site))),
    };

    private static readonly Dictionary<string, int> OrderOf =
        OfBox.Select((m, i) => (m.Name, i)).ToDictionary(x => x.Name, x => x.i, StringComparer.Ordinal);

    /// <summary>A member's place in the spelling order; an unknown one sorts last.</summary>
    public static int Order(string member) => OrderOf.TryGetValue(member, out var i) ? i : int.MaxValue;

    public static BoxMember? BoxMemberNamed(string name) => OfBox.FirstOrDefault(m => string.Equals(m.Name, name, StringComparison.Ordinal));

    /// <summary>The value a driver builds the box with: the stored one, else the derivation.</summary>
    public static PragmaValue Effective(Box b, BoxSite site, string member)
    {
        var m = BoxMemberNamed(member) ?? throw new ArgumentException($"'{member}' is no box member", nameof(member));
        return m.Get(b) ?? m.Derive(b, site);
    }

    /// <summary>The pragmas the writer spells after <paramref name="b"/>: each stored value that differs from its
    /// derivation.</summary>
    public static IEnumerable<(string Member, PragmaValue Value)> Spelled(Box b, BoxSite site) =>
        OfBox.Select(m => (m, stored: m.Get(b)))
           .Where(x => x.stored is not null && x.stored != x.m.Derive(b, site))
           .Select(x => (x.m.Name, x.stored!));

    /// <summary>The output names the text's own pins give (see <see cref="OfBox"/>): the box's slots as
    /// <see cref="TextOutputSlots"/> lays them out. A bit operator or a call names its outputs only where the text names
    /// one (none otherwise: the plain AND/OR, census 1.6 — S1's stored slot and a call's list are pragmas).</summary>
    public static IReadOnlyList<string> DerivedOutputNames(Box b, bool consumed)
    {
        var slots = TextOutputSlots(b, consumed);
        return ResultSlot(b, consumed) is not null || slots.Any(s => !string.IsNullOrEmpty(s))
            ? slots.Select(s => s ?? "").ToList()
            : Array.Empty<string>();
    }

    /// <summary>
    /// THE OUTPUT NAMES AND TYPES A PUSH CAN BUILD: the box's own (<see cref="Effective"/>), except where they hold a
    /// FUNCTION'S RESULT PIN (<see cref="FunctionResult"/>, <c>'   '</c>) — which only a box the IDE resolved can hold:
    /// built by Volt, whose box has no main output index (read-only, DIALECT N21), CODESYS answers "'   ' is no component
    /// of 'F'" (vendor-facts nwl-output-param-names, re-run 2026-10-16). There the derivation is built — the layout every
    /// Volt-built function box has had — and the drawn name is the rebuild's loss, named by <see cref="RebuildLoss"/>.
    /// </summary>
    public static (IReadOnlyList<string> Names, IReadOnlyList<string> Types) Buildable(Box b, BoxSite site)
    {
        var names = Effective(b, site, OutputNames).AsTexts;
        if (!names.Contains(FunctionResult)) return (names, Effective(b, site, OutputTypes).AsTexts);
        return (DerivedOutputNames(b, site.Consumed), DerivedOutputTypes(b, site));
    }

    /// <summary>The output types a push writes from the text (see <see cref="OfBox"/>).</summary>
    public static IReadOnlyList<string> DerivedOutputTypes(Box b, BoxSite site)
    {
        var names = DerivedOutputNames(b, site.Consumed);
        var typed = site.WireType is { } w ? NetworkText.WithDeclaredType(b with { OutputTypes = null }, w) as Box : null;
        var declared = typed?.OutputTypes;
        var count = Math.Max(names.Count, declared?.Count ?? 0);
        var result = ResultSlot(b, site.Consumed);
        // The ENO echo is BOOL (186 of 186 stored ENO slots in the corpora), and so is a comparison's result (45 of 45);
        // a wire's slot its declared type; any other slot the text does not type.
        return Enumerable.Range(0, count).Select(i =>
            declared is not null && i < declared.Count && declared[i] is { } d ? d
            : i < names.Count && names[i] == Volt.Engine.Format.Network.Box.EnoPin ? NetworkSpelling.Bool
            : i == result && NetworkSpelling.Comparisons.Contains(b.Type) ? NetworkSpelling.Bool
            : "").ToList();
    }

    /// <summary>A function's result pin as the vendor names it: three spaces (97 of 97 corpus function boxes without
    /// EN; with EN a function lists only its ENO, 8 of 8). An operator's result is unnamed (<c>''</c>). NOT a derivation:
    /// a box Volt builds cannot hold it (<see cref="Buildable"/>), so a drawn function box spells it by its pragma, and the
    /// derivation is the layout a push builds — no result slot.</summary>
    public const string FunctionResult = "   ";

    /// <summary>
    /// THE OPERATOR BOXES — the IEC operators CODESYS resolves to an <c>Operator</c> member of its own (<c>CallType</c>
    /// <c>Move</c>, <c>Add</c>, <c>Gt</c>, <c>Conversion</c> …), as opposed to a call of a FUNCTION POU (<c>Function</c>).
    /// The two name their result differently (an operator <c>''</c>, after its ENO; a function <c>'   '</c>, and none at
    /// all beside an ENO), so the derivation asks the box type, the one fact the text has: the operator words, and the
    /// type conversions <c>X_TO_Y</c>. A box the IDE stores otherwise is spelled by its pragma.
    /// </summary>
    private static bool IsOperatorType(string type) =>
        OperatorTypes.Contains(type) ||
        System.Text.RegularExpressions.Regex.IsMatch(type, @"^[A-Za-z]+_TO_[A-Za-z]+$", System.Text.RegularExpressions.RegexOptions.CultureInvariant);

    private static readonly HashSet<string> OperatorTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "MOVE", "ADD", "SUB", "MUL", "DIV", "MOD", "EXPT", "GT", "GE", "EQ", "NE", "LE", "LT", "AND", "OR", "XOR", "NOT",
        "SEL", "MAX", "MIN", "LIMIT", "MUX", "SHL", "SHR", "ROL", "ROR", "ABS", "SQRT", "LN", "LOG", "EXP", "SIN", "COS",
        "TAN", "ASIN", "ACOS", "ATAN", "TRUNC", "SIZEOF", "ADR", "BITADR", "INDEXOF",
    };

    /// <summary>The slot of the box's data result in <see cref="TextOutputSlots"/>, or null where it lists none.
    /// <para>A box with a NAMED output pin lists no result slot: a push builds the named pin in the slot after the ENO (the
    /// layout every Volt-built box has had — `next := F(src, doubled =&gt; twice)` compiles so, e2e refused-shapes), and the
    /// result slot before it would need an output item where the consumer is connected, which the vendor stores as null
    /// and will not take (<c>AppendOutputItem(null)</c> throws). The IDE's own drawing of such a box — the result named
    /// first — is spelled by its pragma (8 corpus boxes).</para></summary>
    private static int? ResultSlot(Box b, bool consumed)
    {
        if (b.StCode is not null || b.Instance is not null || !IsOperatorType(b.Type) || NetworkSpelling.BitOperators.Contains(b.Type)) return null;
        if (b.Outputs.Any(o => o.Formal is not null)) return null;
        return CarriedHasEno(b, consumed) ? 1 : 0;
    }

    /// <summary>The box's output slots as the text states them, the formals: the ENO echo first where the box has one
    /// (an Execute box always — its only output, 11 of 11 corpus Execute boxes), then the data result of an operator
    /// (<c>''</c>) or a function (<see cref="FunctionResult"/>, none beside an ENO), then each pin — a positional
    /// <c>=&gt; v</c> at its slot (the result's own, or one passed over as null), a named pin at the next, as its slot is
    /// the box type's and the text names the pin.</summary>
    private static IReadOnlyList<string?> TextOutputSlots(Box b, bool consumed)
    {
        var slots = new List<string?>();
        if (b.StCode is not null || CarriedHasEno(b, consumed)) slots.Add(Volt.Engine.Format.Network.Box.EnoPin);
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

    /// <summary>Whether the box has an ENO output AS THE TEXT CARRIES IT: the model's fact where the text states it
    /// (<see cref="NetworkSpelling.EnoCarried"/>), else the text's own reading — never a vendor fact the text does not
    /// hold, which a derivation computed on a vendor read would otherwise see and a text read would not.</summary>
    private static bool CarriedHasEno(Box b, bool consumed)
    {
        if (NetworkSpelling.EnoCarried(b, consumed) && b.HasEnoOutput is { } stated) return stated;
        return NetworkSpelling.TextHasEno(isExecute: b.StCode is not null, hasEnable: b.Enable is not null,
            enoSuffix: NetworkSpelling.ConnectedByEno(b), consumed: consumed);
    }
}
