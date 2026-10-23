using System;
using System.Collections.Generic;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Engine.Seam;

namespace Volt.Engine.Sync;

/// <summary>
/// Find an item by its WIRE PATH (<c>&lt;folder&gt;/&lt;name&gt;.&lt;ext&gt;</c>) in the served host's tree: the folder
/// the path names is descended segment by segment, and the item is the child of the path's bare name AND of the kind its
/// extension states — so <c>X.dut</c> never lands on an object <c>X</c> of another kind. Names compare
/// case-insensitively (IEC identifiers are), and every read fault is refused <c>ITEM_UNVERIFIED</c> naming where it
/// happened, never reported as absence.
///
/// <para>The rules are over roles: a segment is any child that is no SOURCE item; an item is an ADDRESSABLE one (a
/// source item, or the descriptor a push writes). A child the host names but must not open throws its <see cref="UnreadableItemException"/> where it is read,
/// and is the answer only when it is the very item asked for (<see cref="ItemLookup.Untouchable"/>).</para>
/// </summary>
internal static class TreeLookup
{
    public static ItemRef? Find(HostLink link, string path)
    {
        var (item, untouchable) = Locate(link, path);
        if (untouchable is { } u)
            throw new BridgeException(BridgeErrorCodes.Unreadable, $"'{u.Name}' is not read: {u.Reason}");
        return item;
    }

    public static (ItemRef? Item, ItemLookup.Untouchable? Untouchable) Locate(HostLink link, string path)
    {
        var file = ItemPath.FileOf(path);
        var kind = link.Catalog.Kinds.FindByWireName(path)?.Kind
                   ?? throw new ArgumentException($"'{path}' is not a wire path: its extension names no kind", nameof(path));
        var doing = $"looking for '{path}'";
        var folderPath = ItemPath.FolderOf(path);
        if (Descend(link, folderPath, doing) is not { } folder) return (null, null);
        ItemRef? hit = null;
        ItemLookup.Untouchable? untouchable = null;
        Scan(link, folder, doing, (item, itemName, cls) =>
        {
            if (!IsAddressable(link, cls) || cls.Kind != kind || !Names(link, itemName, kind, file)) return true;
            hit = item;
            return false;
        }, (parent, u) =>
        {
            if (u.Kind != kind || !Names(link, u.Name, kind, file)) return true;
            untouchable = new ItemLookup.Untouchable(parent, u.Name, u.Reason, u.Kind);
            return false;
        }, FolderPath.Segments(folderPath).Count());
        return (hit, untouchable);
    }

    /// <summary>A SOURCE item: a file the engine reads and writes through its format.</summary>
    public static bool IsSourceItem(HostLink link, NodeClass cls) =>
        cls.Role == NodeRole.Item && link.Catalog.Kinds.Require(cls.Kind!).Role == KindRole.Source;

    /// <summary>An item a push can address: a source item, or the one descriptor a push writes.</summary>
    public static bool IsAddressable(HostLink link, NodeClass cls) =>
        cls.Role == NodeRole.Item && link.Catalog.Kinds.Require(cls.Kind!).Role is KindRole.Source or KindRole.WritableDescriptor;

    /// <summary>The kind a wire name's extension names in THIS host's catalog, or null.</summary>
    public static string? KindOf(HostLink link, string wireName) => link.Catalog.Kinds.FindByWireName(wireName)?.Kind;

    /// <summary>The IDE child named <paramref name="ideName"/> is the item at <paramref name="file"/> exactly when its
    /// wire name IS that file name — the lookup inverts the one place a wire name is minted
    /// (<see cref="Versioning.FileOf"/>), so a path finds the item `refs` names at it and no other.</summary>
    private static bool Names(HostLink link, string ideName, string kind, string file) =>
        ItemPath.SameItem(Versioning.FileOf(link.Catalog.Kinds, kind, ideName), file);

    private static ItemRef? Descend(HostLink link, string folder, string doing)
    {
        var node = link.Driver.Root;
        var depth = 0;
        foreach (var segment in FolderPath.Segments(folder))
        {
            ItemRef? next = null;
            Scan(link, node, doing, (child, childName, cls) =>
            {
                if (IsSourceItem(link, cls) || !ItemPath.SameItem(childName, segment))
                    return true;
                next = child;
                return false;
            }, (_, _) => true, depth);
            if (next is not { } found) return null;
            node = found;
            depth++;
        }
        return node;
    }

    private static void Scan(HostLink link, ItemRef node, string doing, Func<ItemRef, string, NodeClass, bool> visit,
                             Func<ItemRef, UnreadableItemException, bool> visitUntouchable, int depth = 1)
    {
        var tree = link.Driver;
        var children = Read(() => tree.Children(node), () => $"the children of {Place(tree.Name, node, depth)}", doing);
        for (var i = 1; i <= children.Count; i++)
        {
            ItemRef child;
            NodeClass cls;
            try
            {
                child = Read(() => children[i - 1], () => $"child {i} of {Place(tree.Name, node, depth)}", doing);
                cls = Read(() => tree.Classify(child), () => $"child {i} of {Place(tree.Name, node, depth)}", doing);
            }
            catch (UnreadableItemException untouchable)
            {
                if (!visitUntouchable(node, untouchable)) return;
                continue;
            }
            var name = Read(() => tree.Name(child), () => $"the name of child {i} of {Place(tree.Name, node, depth)}", doing);
            if (!visit(child, name, cls)) return;
        }
    }

    /// <summary>THE ONE MAPPING of a lookup's read fault (see <see cref="ItemLookup"/>'s walk): a coded refusal keeps its
    /// code, and a child the host must not open stays its <see cref="UnreadableItemException"/>; any other fault — a raw
    /// COM or binder throw — is <c>ITEM_UNVERIFIED</c> naming <paramref name="what"/> could not be read, never absence.
    /// The IDE's exception travels as the inner one.</summary>
    internal static T Read<T>(Func<T> read, Func<string> what, string doing)
    {
        try { return read(); }
        catch (Exception ex) when (ex is not ICodedError and not UnreadableItemException)
        {
            throw new BridgeException(ConflictCodes.ItemUnverified,
                $"could not read {what()} while {doing} — the IDE refused the read ({ex.Message}). Refusing to report it as absent.", ex);
        }
    }

    internal static string Place(Func<ItemRef, string> name, ItemRef node, int depth)
    {
        if (depth == 0) return "the project root";
        try { return $"the folder '{name(node)}'"; }
        catch (Exception ex) when (ex is not ICodedError)
        {
            return $"a folder whose name the IDE refused to read too ({ex.Message})";
        }
    }
}
