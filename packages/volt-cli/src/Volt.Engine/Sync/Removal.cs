using System.Collections.Generic;
using System.Linq;

using Volt.Engine.Item;

namespace Volt.Engine.Sync;

/// <summary>THE one rule for "a name the client knows is gone from the IDE" — <c>ReadResponse.Removed</c> on
/// both read ops (<c>refs</c> for <c>volt status</c>, <c>fetch</c> for <c>volt pull</c>).
///
/// <para>It lives here because deciding it needs facts only the walk has. The unreadable exemption is keyed by
/// the item's bare name AND the kind it was walked as — IEC makes names unique within a kind, not across kinds
/// (CLAUDE.md, the item-name invariant), and the wire's <c>unreadable</c> list carries bare names only. A client
/// that re-derived removal from that list could match by bare name alone, and did: with a program <c>X</c>
/// unreadable, a DUT <c>X.struct</c> the IDE had deleted was exempt on every partial pull, so its file survived
/// and its next edit pushed as a create. And status and pull each derived it with a rule of their own, so
/// <c>volt status</c> reported nothing removed where <c>volt pull</c> then deleted the file.</para>
///
/// <para>A PARTIAL walk is not a reason to report nothing. Absence under a folder the walk could not enumerate
/// proves nothing, but absence from a folder it DID read is as good as on a complete walk — provided the client
/// says where the name last sat (<c>knownFolders</c>). A name it gives no folder for is not judged.</para></summary>
internal static class Removal
{
    public static List<string> Removed(
        IEnumerable<string> known,
        IReadOnlyDictionary<string, string>? knownFolders,
        ICollection<string> walked,
        IReadOnlyDictionary<string, HashSet<string>> unreadableKinds,
        IReadOnlyList<string> unwalkedFolders)
    {
        var seen = new HashSet<(string Bare, string Kind)>(
            walked.Select(w => (Materializer.Bare(w), ItemKind.KindForWireName(w)))
                  .Where(x => x.Item2 is not null)
                  .Select(x => (x.Item1, x.Item2!)));
        return known.Where(name => !walked.Contains(name)
                                   && (SeenUnderAnotherName(name, seen)
                                       || (!IsUnreadable(name, unreadableKinds)
                                           && (unwalkedFolders.Count == 0
                                               || (knownFolders is not null && knownFolders.TryGetValue(name, out var folder)
                                                   && !UnderAny(folder, unwalkedFolders))))))
                    .OrderBy(n => n, System.StringComparer.Ordinal)
                    .ToList();
    }

    /// <summary>Did the walk publish the one object behind <paramref name="known"/> under another wire name? Same
    /// bare name AND same kind is the same IDE object (IEC makes a name unique within a kind), so a known name that
    /// differs from it is gone — a DUT whose subtype changed (`X.struct` → `X.enum`) is the case that reaches it.
    /// The walk SAW that object, so where the old name last sat, and whether that folder was read, no longer
    /// matter: without this a partial walk whose unread folder held the old name kept it beside the new one — two
    /// files and two baseline keys for one object, the stale one force-pushable over the live one. A different kind
    /// sharing the bare name (`X.fb`) is a different item and proves nothing.</summary>
    private static bool SeenUnderAnotherName(string known, HashSet<(string Bare, string Kind)> seen) =>
        ItemKind.KindForWireName(known) is { } kind && seen.Contains((Materializer.Bare(known), kind));

    /// <summary>Record an item the walk found and could not read, under its bare name and walked kind.</summary>
    public static void AddUnreadable(Dictionary<string, HashSet<string>> unreadableKinds, string bareName, string kind)
    {
        if (!unreadableKinds.TryGetValue(bareName, out var kinds))
            unreadableKinds[bareName] = kinds = new HashSet<string>(System.StringComparer.Ordinal);
        kinds.Add(kind);
    }

    /// <summary>Is the known wire name <paramref name="known"/> an item this walk saw and could not read? Same bare
    /// name AND the kind it was walked as — a name of ANOTHER kind that shares the bare name is a different item,
    /// and absent from the walk means gone.
    ///
    /// <para>A known name whose kind cannot be read off its extension is NOT exempt. It used to be ("absence proves
    /// nothing about an item the reader could not place"), and that shielded exactly the names the engine does
    /// not recognise: with FB <c>X</c> unreadable, a known <c>X.struct</c> the IDE had deleted was never reported
    /// removed, so its file survived and its next edit pushed as a create. No legitimate known name lacks a kind —
    /// an unreadable item is published in <c>Unreadable</c>, never in <c>Items</c>, so no baseline holds its bare
    /// identity — and the answer for any other unplaceable name is the ordinary one: not in this walk.</para></summary>
    private static bool IsUnreadable(string known, IReadOnlyDictionary<string, HashSet<string>> unreadableKinds) =>
        unreadableKinds.TryGetValue(Materializer.Bare(known), out var kinds)
        && ItemKind.KindForWireName(known) is { } kind && kinds.Contains(kind);

    /// <summary>Is <paramref name="folder"/> one of <paramref name="roots"/>, or inside one? The walk's unwalked
    /// folders and the client's known folders are the same shape, so this is a prefix test on `/` boundaries.
    /// <para>The ROOT is <c>""</c> — the folder path every root-level item has — and it covers everything: no real
    /// path starts with <c>"" + "/"</c>, so without saying so an unwalked root protected only the root-level items,
    /// and a pull deleted every file under a root object the walk could not enter.</para></summary>
    private static bool UnderAny(string folder, IReadOnlyList<string> roots)
    {
        foreach (var r in roots)
            if (r.Length == 0
                || string.Equals(folder, r, System.StringComparison.Ordinal)
                || folder.StartsWith(r + "/", System.StringComparison.Ordinal))
                return true;
        return false;
    }
}
