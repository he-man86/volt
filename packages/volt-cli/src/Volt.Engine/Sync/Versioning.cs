using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Library;
using Volt.Engine.Format.Body;
using Volt.Engine.Item;

namespace Volt.Engine.Sync;

/// <summary>Materialize an item once and hash it into its content version — the shared step behind
/// <c>refs</c>, <c>fetch</c>, and the push receipt, so all three agree on a version. No catch: a read
/// failure propagates to the wire boundary rather than silently recording a folder-only hash for empty
/// text (which would drift the version and hide the failure).</summary>
public static class Versioning
{
    /// <summary>The workspace folder an item of this kind ACTUALLY occupies, from the folder the project walk
    /// reported. Today only a referenced library differs: it lives in its own folder beside the element
    /// signatures rendered for it (<see cref="Library.LibraryLayout"/>).
    /// <para>It lives HERE, on the one function every version-producing walk already calls, because "apply the
    /// layout at each call site" is what broke: <c>/fetch</c> applied it to the Changed entry only, so one
    /// response reported the file at <c>Library Manager/</c> while writing it to <c>Library Manager/&lt;lib&gt;/</c>
    /// and hashed the version over the folder it is not in — and <c>/refs</c>, the push receipt and the push's
    /// own lease walk each had their own answer. FOUR call sites, four chances to forget. One function cannot
    /// disagree with itself.</para></summary>
    public static string FolderOf(string kind, string walkedFolder, string name) =>
        kind == ItemKind.Kinds.Library ? Library.LibraryLayout.FolderFor(walkedFolder, name) : walkedFolder;

    public static (string Version, WorkspaceItem Item) Materialize(
        IIdeDriver ide, string name, string kind, ItemRef item, string folder)
    {
        var mat = Materializer.Materialize(ide, name, kind, item);
        return (Hasher.ComputeItemVersion(FolderOf(kind, folder, name), mat.Text), mat);
    }

    /// <summary>The version recorded for an item whose body can't be read (e.g. a malformed graphical POU whose
    /// PLCopen export has no FBD/LD body). Stable, so the item looks unchanged across reads.</summary>
    public const string Unreadable = "UNREADABLE000000";

    /// <summary>Record every object the walk saw and could not CLASSIFY (<see cref="WalkResult.UnreadableObjects"/>)
    /// in <paramref name="versions"/> with the <see cref="Unreadable"/> sentinel, and return their bare names for the
    /// op's <c>unreadable</c> list (one entry per OBJECT). It exists, so it counts toward the aggregate version like
    /// an unreadable item does — an object that cannot be read is not one that was deleted. ONE function for the three
    /// version-producing walks (refs, fetch, the push gate), so their maps cannot disagree.
    ///
    /// <para><b>One entry per object, never per bare name</b> (CLAUDE.md, the item-name invariant): IEC makes a name
    /// unique within a kind, and this object's kind is exactly what is unknown — <c>CM_Carrier</c> the FB and
    /// <c>CM_Carrier</c> the visualization are two objects. Keyed by the bare name they collapsed into one entry, so
    /// deleting either left <c>projectVersion</c> unchanged. The key is <see cref="UnclassifiableKey"/>: never a wire
    /// name, so the push's <c>ifVersion</c> gate cannot resolve an op onto it (an op on such a name is refused as
    /// unreadable by <c>PushConflicts</c>, by name).</para></summary>
    public static System.Collections.Generic.IReadOnlyList<string> CountUnclassifiable(
        WalkResult walk, System.Collections.Generic.IDictionary<string, string> versions,
        System.Collections.Generic.Dictionary<string, System.Collections.Generic.HashSet<string>>? unreadableKinds = null)
    {
        var names = new System.Collections.Generic.List<string>();
        var seen = new System.Collections.Generic.Dictionary<string, int>(System.StringComparer.Ordinal);
        foreach (var o in walk.UnreadableObjects)
        {
            var path = FolderPath.Append(o.Folder, o.Name);
            seen[path] = seen.TryGetValue(path, out var n) ? n + 1 : 0;
            versions[UnclassifiableKey(path, seen[path])] = Unreadable;
            // Its kind family is known though it was never read (UnreadableObject.Kinds): the removal pass keeps a known
            // name of those kinds, as it does for an item that failed to materialize, since its folder counts as walked.
            if (unreadableKinds is not null && o.Kinds is { } kinds)
                foreach (var k in kinds) Removal.AddUnreadable(unreadableKinds, o.Name, k);
            names.Add(o.Name);
        }
        return names;
    }

    /// <summary>The version-map key of the <paramref name="ordinal"/>-th unclassifiable object at encoded
    /// <paramref name="path"/> (two objects of one name can share a folder — the FB and its visualization). It starts
    /// with <c>/</c>, which no wire name and no encoded path segment does, so it can collide with no item.</summary>
    private static string UnclassifiableKey(string path, int ordinal) => $"/{path}#{ordinal}";

    /// <summary>Resilient version for the AGGREGATE ops (<c>refs</c>, <c>push</c> project-version): a
    /// single unreadable item must never crash the whole batch — it is isolated with the <see cref="Unreadable"/>
    /// sentinel and still listed/deletable (its <see cref="ItemRef"/> comes from WalkItems, not the read).
    /// <para><see cref="Materialize"/> is deliberately no-catch and this is its ONLY caller. That is not a
    /// spare seam for "single-item paths where the failure must surface" — the header claimed one and there
    /// has never been such a path. It is split out so the catch is visible as a choice rather than buried in
    /// the walk.</para></summary>
    public static VersionedItem SafeVersion(IIdeDriver ide, string name, string kind, ItemRef item, string folder)
    {
        // An unreadable item is a real error — its body did NOT make it into the pull — so surface it at Warn
        // with the name + reason (not Debug). The old bare catch hid a real materialize bug (FB-with-method /
        // interface) for a long time; a visible Warn is what caught it.
        try { var (v, m) = Materialize(ide, name, kind, item, folder); return new VersionedItem(v, m, name); }
        catch (System.Exception ex)
        {
            VoltLog.Warn($"materialize failed name='{name}' kind='{kind}' — body skipped from pull: {ex.Message}");
            return new VersionedItem(Unreadable, null, name);
        }
    }
}

/// <summary>One item as a version-producing walk sees it: what it hashes to, the text it materialized into (null
/// when it could not be read), and — the reason this type exists — the IDENTITY every map keys it by.
///
/// <para><b>The identity is DERIVED here and nowhere else.</b> Three walks produce version maps (<c>refs</c> via
/// <see cref="ProjectSnapshot"/>, <c>fetch</c>, and the push's own lease walk), and each used to key its map with
/// the bare item name it happened to be holding. Bare names are NOT unique across kinds: a control module and the
/// visualization that draws it are <c>CM_Carrier.pou</c> and <c>CM_Carrier.visualization</c> — two files, two
/// objects in the project tree, one shared slot in every one of those maps, with the walk order deciding which
/// survived. The consequences were a pull that reported "nothing to pull" over a real edit (the shadowed item did
/// not move the aggregate hash) and a push that refused an item by quoting its NEIGHBOUR'S version, so the FB
/// could be pulled and never pushed back. Found on a real customer project, V71_PackML_Hauzer.</para>
///
/// <para>So the identity is the FULL wire name — the name plus its kind extension, which is what <c>refs</c> and
/// <c>fetch</c> publish and therefore the only identity a client can ever quote back. This is not a
/// "duplicate name" guard and adds none: bare-name identity below the vendor seam is untouched, because that is
/// the IDE's own lookup key. It is one rung up, where Volt indexes items for the wire.</para>
///
/// <para>An UNREADABLE item never materialized, so it has no full name and keeps its bare one. It is absent from
/// the wire index either way (DIALECT C7) and no client holds a version for it; the bare key only keeps it
/// counted in the aggregate hash and blocks a create landing on top of it. Re-deriving a full name for it would
/// lean on the very kind mapping that may be what defeated the read.</para></summary>
public sealed class VersionedItem
{
    internal VersionedItem(string version, WorkspaceItem? materialized, string bareName)
    {
        Version = version;
        Materialized = materialized;
        Identity = materialized?.FullName ?? bareName;
    }

    /// <summary>The content version — <see cref="Versioning.Unreadable"/> when the body could not be read.</summary>
    public string Version { get; }

    /// <summary>The materialized text + full name, or null when the item could not be read.</summary>
    public WorkspaceItem? Materialized { get; }

    /// <summary>The key EVERY version/folder map uses for this item. See the type doc — this is the whole point.</summary>
    public string Identity { get; }
}
