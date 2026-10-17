using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Volt.Engine.Format.Network;

/// <summary>
/// THE INTERIM LOSS WINDOW, MADE VISIBLE (openspec <c>ld-fbd-coverage</c> design "1b.2", gate 1b-2). A network a push
/// REBUILDS from its text — CODESYS: every changed network; TwinCAT: a changed SHAPE, through the import — is built
/// fresh, and the members the IDE stores that the text does not carry come back as whatever the vendor's rebuild gives
/// them. Until each such member's <c>vendor-facts</c> row decides it (a measured editor cache, or a member 2.3 spells), a
/// rebuild that does not give back a stored value of one says so: one <see cref="Volt.Engine.Ide.BridgeLog"/> warning
/// per rebuilt network, naming each member and how many of its stored values the rebuilt network does not hold. Never a
/// refusal — a refusal on <c>Fixed</c> alone would refuse nearly every CODESYS LD/FBD edit on a guess (design).
///
/// <para><b>Measured against the REBUILT network, never against one vendor-neutral "fresh" value</b> (gate 2-2). The
/// fresh value differs per vendor and per owner (vendor-facts <c>nwl-flags-fixed</c>, DIALECT N29): TwinCAT's import
/// writes <c>Fixed = true</c> on every operand's flag set and <c>false</c> on every item's, CODESYS sets it on a negated
/// contact. A test of "is this value not <c>false</c>" therefore named, on TwinCAT, operand <c>Fixed</c> values the
/// import gives straight back (a false loss on every network Volt itself pushed), and missed a stored <c>false</c> the
/// import turns <c>true</c>. So each driver reads the network it is about to replace AND the network the rebuild made,
/// in one notation, and this class names the stored values the rebuilt one does not hold — per member and per OWNER
/// (the class holding the value: an operand's flag set is not an item's), value by value. A multiset difference: items
/// are not paired one for one, since a shape change has no item-for-item counterpart, so a value an edit removed with
/// its item counts too, and two items of one owner class that swapped values cancel out.</para>
///
/// <para>The members are the design's loss candidates whose stored value a rebuild resets and that their 2.2 rows
/// (DIALECT N29) measured as not re-derived: <c>Flags.Fixed</c>, <c>Operand.Boolean</c> and the <c>Address</c> archive
/// sentinel — and, since 2R.3 deleted the pragma (B7), every member design 2R.2 files L "lost on rebuild": a box's
/// stored output and input lists and their types, its <c>BoxType</c> spelling, <c>Instance.Type</c>, <c>Operand.Type</c>,
/// <c>EN</c>/<c>ENO</c>, <c>CallType</c> and its pin flag list. 2R.4 measured each by running the drawn value against
/// Volt's (DIALECT N40): every one of them but a call's output names, its input names and its type spelling runs the
/// same — an editor cache, still named here because the rebuild drops it (readability P13: what a rebuild drops is
/// shown) — and a FUNCTION's and a METHOD's <c>CallType</c>, a FUNCTION's input names and its output list are DERIVED
/// now (<see cref="NetworkDerivation"/>), so a rebuild holds them. The item <c>Id</c> is not one: both IDEs mint
/// every Id themselves (vendor-facts <c>nwl-item-id</c>), and TwinCAT's splice gives a rebuilt network Ids no other
/// network of the body holds (<c>TcNetworkWriter.Splice</c>). <c>BranchCounter</c> lives on the body, which a network
/// rebuild does not touch.</para>
///
/// <para>Each driver reads its own representation (the CODESYS objects, the TwinCAT archive) into <see cref="Held"/>
/// values in one notation — <c>"true"</c>/<c>"false"</c>, the address text, the owner's class name — and this class
/// alone decides what was lost, so the two vendors cannot count differently.</para>
/// </summary>
public static class RebuildLoss
{
    /// <summary>A member a rebuild resets, and its vendor-facts row — null where no row measures it yet (design 2R.2
    /// files it L on the census alone).</summary>
    public sealed record Candidate(string Member, string? Row);

    /// <summary>One stored value: the member (<c>Flags.Fixed</c>), the class that owns it (<c>Operand</c>,
    /// <c>BoxTreeBox</c>, …) and the value in the shared notation.</summary>
    public readonly record struct Held(string Member, string Owner, string? Value);

    /// <summary>The archive's sentinel for an operand with no address (DIALECT N27; 258 stored in the corpora, a fresh
    /// operand archives <c>""</c> — gate 1b-3).</summary>
    public const string AddressSentinel = "Constant_Address_Serialization_Value";

    public static readonly IReadOnlyList<Candidate> Candidates = new[]
    {
        new Candidate("Flags.Fixed", "nwl-flags-fixed"),
        new Candidate("Operand.Boolean", "nwl-operand-boolean"),
        new Candidate("Operand.Address", "nwl-address-sentinel"),
        // B7 (2R.3): the text spells no member, so a box's STORED output list goes with every rebuild that does not
        // build the same one — a call's unwired pins (a TON's ET; ~48 of 279 corpus call boxes store a list that is not
        // even their declaration's), a drawn function's result name '   ' (no box Volt builds can hold it, DIALECT
        // N21/N37), a bit operator's slot [''] (17 boxes, design 2R.2 L). Held as the whole list (List), per box.
        new Candidate("OutputParam.Names", "nwl-output-param-names"),
        new Candidate("OutputParam.Types", "nwl-param-types"),
        new Candidate("InputParam.Names", "nwl-param-types"),
        new Candidate("InputParam.Types", "nwl-param-types"),
        // The other values design 2R.2 files L until 2R.4 measures them: a stored BoxType spelling the text writes
        // otherwise (15: `ton`, `R_Trig`, a namespace), Instance.Type (47 differ from BoxType), a stale Operand.Type,
        // the EN/ENO bools, CallType, and the pin flag list (a zero-only InputFlags).
        new Candidate("BoxType", null),
        new Candidate("Instance.Type", "nwl-instance-type"),
        new Candidate("Operand.Type", "nwl-operand-type"),
        new Candidate("EN", "nwl-box-en-eno"),
        new Candidate("ENO", "nwl-box-en-eno"),
        new Candidate("CallType", "nwl-call-type"),
        new Candidate("InputFlags", "nwl-input-flags-list"),
        // A box storing more output slots than output names — an enabled PROGRAM call's two null slots for its one name
        // ['ENO'] (10 corpus boxes, DIALECT N37): a rebuild lays out one slot per name, so the extra slot goes with it.
        // Held as "<slots> slots for <names> names" on a box whose counts differ (gate 2-3 review: it went unnamed).
        new Candidate(ExtraOutputSlots, "nwl-output-param-names"),
    };

    /// <summary>The member a box's extra output slots are held under (<see cref="Candidates"/>).</summary>
    public const string ExtraOutputSlots = "OutputItemList.OutputItems";

    /// <summary>A stored string list in the shared notation — <c>['Q', 'ET']</c>, <c>['']</c>, <c>[]</c> — or null where
    /// the member holds no list at all, so the three stay apart.</summary>
    public static string? List(IEnumerable<string?>? items) =>
        items is null ? null : MemberValue.Texts(items.Select(i => i ?? "")).ToString();

    /// <summary>A box's output slots beyond its output names, in the shared notation, or null where the counts agree.</summary>
    public static Held? ExtraSlots(string owner, int slots, int names) =>
        slots > names
            ? new Held(ExtraOutputSlots, owner,
                string.Format(CultureInfo.InvariantCulture, "{0} slots for {1} names", slots, names))
            : null;

    /// <summary>Per candidate member, how many of the values <paramref name="held"/> stored the
    /// <paramref name="rebuilt"/> network does not hold (owner by owner, value by value); members no candidate names, and
    /// candidates that lost nothing, are not listed.</summary>
    public static IReadOnlyList<(Candidate Candidate, int Count)> Count(IEnumerable<Held> held, IEnumerable<Held> rebuilt)
    {
        var before = held.ToList();
        var after = rebuilt.ToList();
        return Candidates
            .Select(c => (c, Lost(before.Where(h => h.Member == c.Member), after.Where(h => h.Member == c.Member))))
            .Where(x => x.Item2 > 0)
            .ToList();
    }

    private static string Key(Held h) => h.Owner + "\u0001" + (h.Value ?? "\u0000");

    private static int Lost(IEnumerable<Held> stored, IEnumerable<Held> given)
    {
        var left = given.GroupBy(Key).ToDictionary(g => g.Key, g => g.Count(), StringComparer.Ordinal);
        var lost = 0;
        foreach (var key in stored.Select(Key))
        {
            if (left.TryGetValue(key, out var n) && n > 0) left[key] = n - 1;
            else lost++;
        }
        return lost;
    }

    /// <summary>The warning for rebuilding network <paramref name="order"/> (0-based) out of what it
    /// <paramref name="held"/> into what the rebuild made (<paramref name="rebuilt"/>), or null when the rebuilt network
    /// holds every stored value of every candidate.</summary>
    public static string? Warning(string vendorDisplay, int order, IEnumerable<Held> held, IEnumerable<Held> rebuilt)
    {
        var counts = Count(held, rebuilt);
        if (counts.Count == 0) return null;
        var named = string.Join(", ", counts.Select(x =>
            string.Format(CultureInfo.InvariantCulture, "{0} ×{1} ({2})", x.Candidate.Member, x.Count,
                x.Candidate.Row is { } row ? "vendor-facts row " + row : "no vendor-facts row yet; design 2R.2 L")));
        return $"{vendorDisplay}: network {(order + 1).ToString(CultureInfo.InvariantCulture)} is rebuilt from its text, " +
               $"which does not carry these stored values, and the rebuilt network does not hold them: {named} " +
               "(openspec ld-fbd-coverage 2.2 / 2R.3 B7: lost on rebuild, never guessed).";
    }
}
