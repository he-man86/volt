using System.Collections.Generic;
using System.Linq;

using Volt.Engine.Item;

namespace Volt.Engine.Sync;

/// <summary>THE one rule for "a path the client knows is gone from the IDE" — <c>ReadResponse.Removed</c> on
/// both read ops (<c>refs</c> for <c>volt status</c>, <c>fetch</c> for <c>volt pull</c>).
///
/// <para>It lives here because deciding it needs facts only the walk has. An item the walk found and did not read is
/// exempt by its PATH — the one it has in <c>items</c> while it reads, so an unreadable program <c>X.pou</c> shields
/// nothing but itself, never a deleted DUT <c>X.dut</c> (CLAUDE.md, the item-name invariant). One rule for both ops
/// also keeps <c>volt status</c> and <c>volt pull</c> from disagreeing about what is removed.</para>
///
/// <para>A PARTIAL walk is not a reason to report nothing. Absence under a folder the walk could not enumerate
/// proves nothing, but absence from a folder it DID read is as good as on a complete walk — and a known path says
/// where its item last sat (its own folder).</para></summary>
internal static class Removal
{
    /// <param name="applications">The walk's applications (<c>WalkResult.Applications</c>). A known path under a folder
    /// the walk could not read is still GONE when the walk found its file name — the same name and kind — at another path
    /// of the SAME application: IEC makes a name unique within a kind per application, so that item moved, and two files
    /// for one IDE object is what a pull must never leave (`PullCommandTests`, a moved DUT whose old folder went
    /// unread). Another application's item of the name is another item, never this one. OUTSIDE every application only a
    /// SOURCE item pairs (the CODESYS POU pool is one IEC namespace): nothing makes a descriptor's name unique there — two
    /// devices each carry an <c>EtherCAT_Master</c>, two system projects each an I/O device of one default name — so a
    /// walked descriptor of the name says nothing about a known one under an unread folder.</param>
    /// <param name="knownApplications">The applications the client's baseline was read with (<c>knownApplications</c>).
    /// An unread folder outside every application the walk states may HIDE one — an unread device's application is never
    /// walked, so never stated — and a known path there would fall into the pool namespace and pair with a pool item of
    /// its name, though CODESYS lets an application hold a POU the pool also holds. The baseline places it: a known path
    /// is in an application either read states. A client that states none cannot tell the pool from a hidden
    /// application, so a known path in neither never pairs.</param>
    public static List<string> Removed(
        IEnumerable<string> known,
        ICollection<string> walked,
        IEnumerable<string> unreadable,
        IReadOnlyList<string> unwalkedFolders,
        IReadOnlyList<string> applications,
        IReadOnlyList<string>? knownApplications,
        Seam.KindRegistry kinds) =>
        Removed(known, walked, unreadable, unwalkedFolders, applications, knownApplications,
                path => kinds.FindByWireName(path)?.Role == Seam.KindRole.Source);

    private static List<string> Removed(
        IEnumerable<string> known,
        ICollection<string> walked,
        IEnumerable<string> unreadable,
        IReadOnlyList<string> unwalkedFolders,
        IReadOnlyList<string> applications,
        IReadOnlyList<string>? knownApplications,
        System.Func<string, bool> isSourcePath)
    {
        var roots = knownApplications is null ? applications : applications.Concat(knownApplications).ToList();
        var unread = new HashSet<string>(unreadable, System.StringComparer.Ordinal);
        // The scope in which IEC makes a file name unique: the path's application, or the pool for a source item; null
        // where no rule makes it unique, and such a path never pairs.
        string? Key(string path, bool knownPath)
        {
            var application = ItemPath.ApplicationOf(path, roots);
            if (application is null && knownPath && knownApplications is null) return null;
            if (application is null && !isSourcePath(path)) return null;
            return (application ?? "") + "\n" + ItemPath.FileOf(path);
        }
        HashSet<string>? walkedNames = null;
        bool MovedWithinItsApplication(string path) =>
            Key(path, knownPath: true) is { } key
            && (walkedNames ??= new HashSet<string>(walked.Select(w => Key(w, knownPath: false)).OfType<string>(), System.StringComparer.OrdinalIgnoreCase))
                .Contains(key);

        return known.Where(path => !walked.Contains(path)
                                   && !unread.Contains(path)
                                   && (unwalkedFolders.Count == 0 || !UnderAny(ItemPath.FolderOf(path), unwalkedFolders)
                                       || MovedWithinItsApplication(path)))
                    .OrderBy(n => n, System.StringComparer.Ordinal)
                    .ToList();
    }

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
