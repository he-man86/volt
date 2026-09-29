using System;
using System.Collections.Generic;
using System.Linq;

using Volt.Contracts;
using Volt.Engine.Format.St;
using Volt.Engine.Item;

namespace Volt.Engine.Sync;

/// <summary>A DUT SUBTYPE CHANGE IS ONE UPDATE OF THE SAME IDE OBJECT — the push's op normalisation for it, run
/// before anything else reads the ops (openspec <c>dut-subtype-on-the-wire</c>, "a subtype change is an update of
/// the same object").
///
/// <para><b>Why a push has to decide this at all.</b> A DUT is named on the wire by its subtype (<c>X.struct</c>,
/// <c>X.enum</c>, …; <c>Materializer</c>), so rewriting a struct as an enum reaches the bridge as a NAME change — yet
/// below the vendor seam the four names are one object, the bare <c>X</c>, and both vendors take a new shape in
/// place, same object, same folder (DIALECT C2e). Git reports that edit in one of two shapes: a RENAME
/// (<c>set X.struct toName X.enum</c>), or — since a struct→enum rewrite shares little text — a DELETE plus an ADD.
/// The rename already lands on <c>X</c> as a content update (the bare names agree, so <c>ApplySetItem</c> renames
/// nothing). The pair did not: it was two ops on one object, and measured live (task 1.1) it wrote half and refused
/// half in one path order, refused for ever in the other, and under <c>--force</c> DELETED the DUT in both. So the
/// pair is rewritten here into the rename it means, carrying the delete's <c>ifVersion</c> (the only version the
/// client quoted) and the added file's folder (the CLI sends every create with one). <b>Force does not change
/// this</b>: it drops the version gate, never the pairing.</para>
///
/// <para><b>Anything else that lands two ops on one DUT is refused by name</b> — two sets, two deletes, a delete
/// and a create of the SAME subtype, a subtype rename plus a second op. Each is two answers to "what is X?", and
/// ordering them would pick one silently. The rule keys on DUT ops ONLY: <c>X.fb</c> beside <c>X.struct</c> is two
/// items (the item-name invariant), and a "two ops on one bare name" rule would be the forbidden duplicate-name
/// guard.</para>
///
/// <para><b>A DUT op's body is NOT checked against its name</b> (openspec <c>push-without-header-check</c>): the
/// extension is the subtype, the text is written as sent, and the IDE takes the shape the text gives it. So
/// <c>set X.struct</c> with an enum body lands, and <c>refs</c> — and the receipt — then name the item <c>X.enum</c>, a
/// rename the next pull carries into the workspace. What that once risked — the stale <c>X.struct</c> file later
/// deleting the live DUT — is closed where it happened: a delete reaches a DUT only under the name it has
/// (<c>PushService.NamesThisItem</c>). This used to refuse such an op naming both subtypes, which read the text's
/// declaration to do it — the one thing a top-level item's text is no longer read for.</para></summary>
internal static class DutSubtypeChanges
{
    /// <summary>The ops with every DUT subtype change rewritten as one update; throws <see cref="PushRefusal"/> for a
    /// body-less rename that changes a DUT's subtype, for any other pair on one DUT, and — unforced — for a pair whose
    /// delete quotes no version. Ops that touch no DUT pass through untouched and in order.</summary>
    internal static List<PushOp> Normalize(IReadOnlyList<PushOp> ops, bool force)
    {
        foreach (var op in ops) RequireBodyForSubtypeRename(op);

        // Every DUT op under each bare DUT name it touches — a rename across bare names touches two.
        var byBare = new Dictionary<string, List<PushOp>>(StringComparer.OrdinalIgnoreCase);
        foreach (var op in ops)
            foreach (var bare in BareDutNames(op))
            {
                if (!byBare.TryGetValue(bare, out var list)) byBare[bare] = list = new List<PushOp>();
                list.Add(op);
            }

        var result = ops.ToList();
        foreach (var group in byBare.Values.Where(g => g.Count > 1))
        {
            var pair = AsSubtypeChangePair(group)
                ?? throw new PushRefusal(group[0].Name,
                    $"{string.Join(" and ", group.Select(Describe))} land on ONE DUT in the IDE — its subtype names " +
                    "are one object. A push may change a DUT's subtype (a rename, or a delete of one subtype with a " +
                    "create of another), and nothing else may name it twice. Push them separately.");

            // THE PAIR IS AN UPDATE, AND AN UPDATE IS GUARDED BY A VERSION — the delete's, the only one the client
            // quoted. A delete alone may go unguarded (it is idempotent), but on the wire a `set` with no
            // `ifVersion` is a CREATE: coalesced without one, the pair read as creating `X` over itself and was
            // refused `ITEM_EXISTS` for an op the client never sent. Refused by name instead, nothing written.
            // Force drops every version gate, so there the missing version asks nothing and the pair stands.
            if (!force && pair.Delete.IfVersion is null)
                throw new PushRefusal(pair.Delete.Name,
                    $"{Describe(pair.Delete)} and {Describe(pair.Create)} change one DUT's subtype, which is an update " +
                    "of that object — and an update is guarded by the version the delete quotes, but this delete " +
                    "carries no ifVersion. Send it with the version refs gave for it, or push with --force.");

            // In the place of whichever came first; the other is gone. Order is not a contract (see
            // `InFolderDepthOrder`), so this only keeps the batch as close to what was sent as it can be.
            var first = Math.Min(result.IndexOf(pair.Delete), result.IndexOf(pair.Create));
            result.Remove(pair.Delete);
            result.Remove(pair.Create);
            result.Insert(first, new SetItemOp
            {
                Name = pair.Delete.Name,
                ToName = pair.Create.Name,
                IfVersion = pair.Delete.IfVersion,
                ToFolder = pair.Create.ToFolder,
                SourceText = pair.Create.SourceText,
            });
        }
        return result;
    }

    /// <summary>A delete of one subtype and a create of ANOTHER, same bare name — the only pair that is a subtype
    /// change. Null for every other group.</summary>
    private static (DeleteItemOp Delete, SetItemOp Create)? AsSubtypeChangePair(List<PushOp> group)
    {
        if (group.Count != 2) return null;
        if (group[0] is DeleteItemOp d0 && group[1] is SetItemOp s1) return Pair(d0, s1);
        if (group[1] is DeleteItemOp d1 && group[0] is SetItemOp s0) return Pair(d1, s0);
        return null;
    }

    /// <summary><b>The set must be a CREATE</b> — no <c>ifVersion</c>. A <c>set X.enum ifVersion w</c> is an UPDATE of
    /// an <c>X.enum</c> the client believed the IDE held; it is not the added file of a subtype change. Coalesced,
    /// <c>w</c> was dropped unchecked and the enum written on the strength of the delete's version (alone, the set is
    /// refused <c>ITEM_MISSING</c>). Not a pair, so the group is refused naming both, like every other.</summary>
    private static (DeleteItemOp Delete, SetItemOp Create)? Pair(DeleteItemOp delete, SetItemOp create)
    {
        if (create.ToName is not null || create.SourceText is null || create.IfVersion is not null) return null;
        if (!IsDut(delete.Name) || !IsDut(create.Name)) return null;
        if (!SameBare(delete.Name, create.Name)) return null;
        return string.Equals(Ext(delete.Name), Ext(create.Name), StringComparison.OrdinalIgnoreCase)
            ? null
            : (delete, create);
    }

    /// <summary>Refuse a RENAME that changes a DUT's subtype and carries no body. It reads no text — there is none —
    /// and it cannot be true: the IDE's declaration stays what it is, so the name would disagree with it the moment it
    /// landed.</summary>
    private static void RequireBodyForSubtypeRename(PushOp op)
    {
        if (op is not SetItemOp { SourceText: null, ToName: { } target } set || !IsDut(target)) return;
        if (!string.Equals(Ext(set.Name), Ext(target), StringComparison.OrdinalIgnoreCase))
            throw new PushRefusal(set.Name,
                $"'{set.Name}' -> '{target}' changes the DUT's subtype but carries no declaration — the subtype is " +
                "what the declaration says, so push the file's text with the rename.");
    }

    private static IEnumerable<string> BareDutNames(PushOp op)
    {
        var names = new List<string>();
        if (IsDut(op.Name)) names.Add(Materializer.Bare(op.Name));
        if (op is SetItemOp { ToName: { } to } && IsDut(to) && !names.Contains(Materializer.Bare(to), StringComparer.OrdinalIgnoreCase))
            names.Add(Materializer.Bare(to));
        return names;
    }

    private static string Describe(PushOp op) => op switch
    {
        DeleteItemOp => $"delete '{op.Name}'",
        SetItemOp { ToName: { } to } => $"set '{op.Name}' -> '{to}'",
        _ => $"set '{op.Name}'",
    };

    internal static bool IsDut(string wireName) => ItemKind.KindForWireName(wireName) == ItemKind.Kinds.Dut;

    private static bool SameBare(string a, string b) =>
        string.Equals(Materializer.Bare(a), Materializer.Bare(b), StringComparison.OrdinalIgnoreCase);

    private static string Ext(string wireName) => wireName.Substring(wireName.LastIndexOf('.') + 1);
}
