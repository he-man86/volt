using System;
using System.Collections.Generic;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Engine.Seam;

namespace Volt.Engine.Sync;

/// <summary>
/// Find an item by its WIRE PATH (<c>&lt;folder&gt;/&lt;name&gt;.&lt;ext&gt;</c>) in the served host's tree, on the new
/// contract (openspec <c>volt-cli-rework</c> step 5): the folder the path names is descended segment by segment, and the
/// item is the child of the path's bare name AND of the kind its extension states — so <c>X.dut</c> never lands on an
/// object <c>X</c> of another kind. Names compare case-insensitively (IEC identifiers are), and every read fault is
/// refused <c>ITEM_UNVERIFIED</c> naming where it happened, never reported as absence.
///
/// <para>The rules the old lookup (<see cref="ItemLookup"/>, the hosts' own until step 6) read off codes, over roles: a
/// segment is any child that is no SOURCE item; an item is an ADDRESSABLE one (a source item, or the descriptor a push
/// writes). A child the host names but must not open throws its <see cref="UnreadableItemException"/> where it is read,
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
            if (!IsAddressable(link, cls) || cls.Kind != kind || !Names(itemName, file)) return true;
            hit = item;
            return false;
        }, (parent, u) =>
        {
            if (u.Kind != kind || !Names(u.Name, file)) return true;
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

    private static bool Names(string ideName, string file) =>
        string.Equals(ideName, ItemPath.BareOf(file), StringComparison.OrdinalIgnoreCase)
        || string.Equals(ideName, file, StringComparison.OrdinalIgnoreCase);

    private static ItemRef? Descend(HostLink link, string folder, string doing)
    {
        var node = link.Driver.Root;
        var depth = 0;
        foreach (var segment in FolderPath.Segments(folder))
        {
            ItemRef? next = null;
            Scan(link, node, doing, (child, childName, cls) =>
            {
                if (IsSourceItem(link, cls) || !string.Equals(childName, segment, StringComparison.OrdinalIgnoreCase))
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
        IReadOnlyList<ItemRef> children;
        try { children = tree.Children(node); }
        catch (Exception ex) when (ex is not ICodedError)
        {
            throw new BridgeException(ConflictCodes.ItemUnverified,
                $"could not read the children of {Place(tree.Name, node, depth)} while {doing} — the IDE refused the read " +
                $"({ex.Message}). Refusing to report it as absent.", ex);
        }
        for (var i = 1; i <= children.Count; i++)
        {
            ItemRef child;
            NodeClass cls;
            try
            {
                child = children[i - 1];
                cls = tree.Classify(child);
            }
            catch (UnreadableItemException untouchable)
            {
                if (!visitUntouchable(node, untouchable)) return;
                continue;
            }
            catch (Exception ex) when (ex is not ICodedError)
            {
                throw new BridgeException(ConflictCodes.ItemUnverified,
                    $"could not read child {i} of {Place(tree.Name, node, depth)} while {doing} — the IDE refused the read " +
                    $"({ex.Message}). Refusing to report it as absent.", ex);
            }
            string name;
            try { name = tree.Name(child); }
            catch (Exception ex) when (ex is not ICodedError)
            {
                throw new BridgeException(ConflictCodes.ItemUnverified,
                    $"could not read the name of child {i} of {Place(tree.Name, node, depth)} while {doing} — the IDE refused " +
                    $"the read ({ex.Message}). Refusing to report it as absent.", ex);
            }
            if (!visit(child, name, cls)) return;
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
