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
    /// <para>It lives HERE, on the one function every version-producing walk calls, so the folder a file is written
    /// to, the folder it is reported at and the folder its version is hashed over cannot disagree.</para></summary>
    public static string FolderOf(string kind, string walkedFolder, string name) =>
        kind == ItemKind.Kinds.Library ? Library.LibraryLayout.FolderFor(walkedFolder, name) : walkedFolder;

    /// <summary>THE PATH an item has on the wire, <c>&lt;folder&gt;/&lt;name&gt;.&lt;kind&gt;</c>, from what the walk states of
    /// it: its kind, the folder it was walked in and its bare IDE name. The one place an item's path is minted — every
    /// version map, <c>items</c> and <c>unreadable</c> key on it, so an item that cannot be read is named exactly as it
    /// is while it reads (a verbatim-named kind once, a library in its own folder).</summary>
    public static string PathOf(Seam.KindRegistry kinds, string kind, string walkedFolder, string bareName) =>
        Mint(kind, walkedFolder, bareName, FileOf(kinds, kind, bareName));

    /// <summary>The FILE NAME part of <see cref="PathOf"/> — what the push's lookup (<c>TreeLookup</c>) inverts, so a
    /// path finds the item this names at it and no other.</summary>
    public static string FileOf(Seam.KindRegistry kinds, string kind, string bareName) =>
        Materializer.FullWireName(bareName, kind, kinds);

    private static string Mint(string kind, string walkedFolder, string bareName, string fullName) =>
        ItemPath.Of(FolderOf(kind, walkedFolder, bareName), fullName);

    public static (string Version, WorkspaceItem Item) Materialize(
        HostLink link, string name, string kind, ItemRef item, string folder)
    {
        var mat = Materializer.Materialize(link, name, kind, item);
        return (Hasher.ComputeItemVersion(FolderOf(kind, folder, name), mat.Text), mat);
    }

    /// <summary>The version recorded for an item whose content can't be read (the driver's read threw). Stable, so the
    /// item looks unchanged across reads.</summary>
    public const string Unreadable = "UNREADABLE000000";

    /// <summary>Record every object the walk saw and did not read (<see cref="WalkResult.UnreadableObjects"/>) in
    /// <paramref name="versions"/> with the <see cref="Unreadable"/> sentinel, and return them for the op's two lists. It
    /// exists, so it counts toward the aggregate version like an unreadable item does — an object that cannot be read is
    /// not one that was deleted. ONE function for the three version-producing walks (refs, fetch, the push gate), so
    /// their maps cannot disagree.
    ///
    /// <para>An object of known item kind is an ITEM: keyed and named by its path (<see cref="PathOf"/>), as it is in
    /// <c>items</c> while it reads. A container node (<see cref="ItemKind.Kinds.Folder"/>) and an object whose kind is
    /// unknown are NODES with no file: named by their node path, and keyed by <see cref="UnclassifiableKey"/> — never a
    /// wire name, so the push's <c>ifVersion</c> gate cannot resolve an op onto one (an op that may land on an object of
    /// unknown kind is refused as unreadable by <c>PushConflicts</c>, by name).</para></summary>
    public static (System.Collections.Generic.List<UnreadableItem> Items, System.Collections.Generic.List<UnreadableNode> Nodes)
        CountUnclassifiable(Seam.HostWalk walk, System.Collections.Generic.IDictionary<string, string> versions,
                            Seam.KindRegistry kinds) =>
        CountUnclassifiable(walk.Unreadable, versions, (kind, folder, name) => PathOf(kinds, kind, folder, name));

    private static (System.Collections.Generic.List<UnreadableItem> Items, System.Collections.Generic.List<UnreadableNode> Nodes)
        CountUnclassifiable(System.Collections.Generic.IReadOnlyList<UnreadableObject> unread,
                            System.Collections.Generic.IDictionary<string, string> versions,
                            System.Func<string, string, string, string> pathOf)
    {
        var items = new System.Collections.Generic.List<UnreadableItem>();
        var nodes = new System.Collections.Generic.List<UnreadableNode>();
        var seen = new System.Collections.Generic.Dictionary<string, int>(ItemPath.Exact);
        foreach (var o in unread)
        {
            if (o.Kind is { } kind && kind != ItemKind.Kinds.Folder)
            {
                var path = pathOf(kind, o.Folder, o.Name);
                versions[path] = Unreadable;
                items.Add(new UnreadableItem(path, o.Code, o.Reason));
                continue;
            }
            var node = FolderPath.Append(o.Folder, o.Name);
            seen[node] = seen.TryGetValue(node, out var n) ? n + 1 : 0;
            versions[UnclassifiableKey(node, seen[node])] = Unreadable;
            nodes.Add(new UnreadableNode(ItemPath.Of(o.Folder, o.Name), o.Code, o.Reason));
        }
        return (items, nodes);
    }

    /// <summary>The version-map key of the <paramref name="ordinal"/>-th node at encoded <paramref name="path"/> (two
    /// objects of one name can share a folder — the FB and its visualization, when neither kind could be read). It starts
    /// with <c>/</c>, which no wire name and no encoded path segment does, so it can collide with no item.</summary>
    private static string UnclassifiableKey(string path, int ordinal) => $"/{path}#{ordinal}";

    /// <summary>Resilient version for the AGGREGATE ops (<c>refs</c>, <c>push</c> project-version): a
    /// single unreadable item must never crash the whole batch — it is isolated with the <see cref="Unreadable"/>
    /// sentinel and still listed/deletable (its <see cref="ItemRef"/> comes from WalkItems, not the read).
    /// <para><see cref="Materialize"/> is deliberately no-catch and this is its ONLY caller. That is not a
    /// spare seam for "single-item paths where the failure must surface" — the header claimed one and there
    /// has never been such a path. It is split out so the catch is visible as a choice rather than buried in
    /// the walk.</para>
    /// <para><b>A Volt bug is no unreadable object.</b> An entry says why the IDE's object was not read, in the codes the
    /// `unreadable` channel declares; Volt's own broken invariant (INTERNAL_ERROR) met during one item's read fails the op —
    /// loud, logged whole by the host — instead of being filed as that item's state (gate 3c review, finding 6).</para></summary>
    public static VersionedItem SafeVersion(HostLink link, string name, string kind, ItemRef item, string folder)
    {
        var kinds = link.Catalog.Kinds;
        // An unreadable item is a real error — its body did NOT make it into the pull — so surface it at Warn
        // with the name + reason (not Debug): a silent catch hides a real materialize bug.
        try { var (v, m) = Materialize(link, name, kind, item, folder); return new VersionedItem(v, m, kind, folder, name, null, kinds); }
        catch (System.Exception ex) when (ex is not ICodedError { ErrorCode: BridgeErrorCodes.InternalError })
        {
            VoltLog.Warn($"materialize failed name='{PathOf(kinds, kind, folder, name)}' — body skipped from pull: {ex.Message}");
            // The code the read raised, when it raised one; otherwise the IDE did not give the text: UNREADABLE.
            var code = (ex as ICodedError)?.ErrorCode ?? BridgeErrorCodes.Unreadable;
            return new VersionedItem(Unreadable, null, kind, folder, name, (code, ex.Message), kinds);
        }
    }
}

/// <summary>One item as a version-producing walk sees it: what it hashes to, the text it materialized into (null
/// when it could not be read), and — the reason this type exists — the IDENTITY every map keys it by.
///
/// <para><b>The identity is DERIVED here and nowhere else.</b> Three walks produce version maps (<c>refs</c> via
/// <see cref="ProjectSnapshot"/>, <c>fetch</c>, and the push's own lease walk), and all key by this. Bare names are
/// NOT unique across kinds: <c>CM_Carrier.pou</c> and <c>CM_Carrier.visualization</c> are two objects, and on one bare
/// slot the walk order picks a winner — the shadowed item's edit does not move the aggregate hash, and a push gates it
/// against its NEIGHBOUR'S version, so it can be pulled and never pushed back (V71_PackML_Hauzer; CLAUDE.md, the
/// item-name invariant).</para>
///
/// <para>So the identity is the item's PATH — the folder it is reported in plus its full name (the name and its kind
/// extension), <see cref="Versioning.PathOf"/> — which is what <c>refs</c> and <c>fetch</c> publish and therefore the
/// only identity a client can ever quote back. The FOLDER is part of it because names are not unique across
/// applications either: two devices whose applications both hold <c>PLC_PRG</c> are two programs, and keyed by full name
/// alone one application's code would be silently missing from a pull and a push would write one of each pair (openspec
/// <c>multi-application-tree</c>). This is not a "duplicate name" guard and adds none: bare-name lookup below the
/// vendor seam is untouched, inside the container the path names — that is the IDE's own lookup key.</para>
///
/// <para>An UNREADABLE item has the same identity: the walk states its kind, so its path does not depend on whether its
/// content could be read (openspec <c>unreadable-name-carries-kind</c>).</para></summary>
public sealed class VersionedItem
{
    internal VersionedItem(string version, WorkspaceItem? materialized, string kind, string walkedFolder, string bareName,
                           (string Code, string Reason)? unread, Seam.KindRegistry kinds)
    {
        Version = version;
        Materialized = materialized;
        Folder = Versioning.FolderOf(kind, walkedFolder, bareName);
        Identity = Versioning.PathOf(kinds, kind, walkedFolder, bareName);
        Unread = unread is { } u ? new UnreadableItem(Identity, u.Code, u.Reason) : null;
    }

    /// <summary>The folder the item is REPORTED in (<see cref="Versioning.FolderOf"/>: a library sits in its own) — the
    /// prefix of <see cref="Identity"/>.</summary>
    public string Folder { get; }

    /// <summary>The content version — <see cref="Versioning.Unreadable"/> when the body could not be read.</summary>
    public string Version { get; }

    /// <summary>The materialized text + full name, or null when the item could not be read.</summary>
    public WorkspaceItem? Materialized { get; }

    /// <summary>The key EVERY version map uses for this item — its path. See the type doc — this is the whole point.</summary>
    public string Identity { get; }

    /// <summary>The item as the read ops list it unreadable — its path and the refusal that left it out — or null when it
    /// materialized.</summary>
    public UnreadableItem? Unread { get; }
}
