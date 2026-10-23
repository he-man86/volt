using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Engine.Seam;

namespace Volt.Engine.Sync;

/// <summary>
/// Navigate and shape the served host's tree for a push:
/// resolve a folder path (creating what is missing, recorded), find a child or a folder, judge a move target, and prune
/// the folders a push emptied. The roles are the host's (<see cref="NodeClass"/>): a path segment is any node that is no
/// SOURCE item, a user folder is a <see cref="NodeRole.Folder"/>, and a node an item may be moved into is a folder or a
/// container that holds items.
/// </summary>
internal static class TreeNav
{
    /// <summary>The node a top-level item's folder path names, created where missing; each folder created is recorded
    /// in <paramref name="created"/>, by its path.</summary>
    internal static ItemRef ResolveTopLevelFolder(HostLink link, string? folder, List<string>? created = null) =>
        Descend(link, link.Driver.Root, FolderPath.Segments(folder), AnyContainer(link), create: true, created)!.Value;

    /// <summary>Where a new item of <paramref name="kind"/> goes for <paramref name="folder"/>: the container the folder's
    /// parent holds that TAKES that kind (<see cref="NodeClass.Takes"/>: a Task Configuration, whatever its localized
    /// name), else the folder itself.</summary>
    internal static ItemRef ResolveDedicatedParent(HostLink link, string kind, string? folder, List<string>? created = null)
    {
        var segments = new List<string>(FolderPath.Segments(folder));
        if (segments.Count > 0)
        {
            var node = Descend(link, link.Driver.Root, segments.Take(segments.Count - 1), AnyContainer(link), create: true,
                               created)!.Value;
            if (FirstChild(link, node, c => link.Driver.Classify(c).Takes?.Contains(kind) == true) is { } dedicated)
                return dedicated;
        }
        // The ancestry above was created already if it was missing, so this walk finds it and records only what it adds.
        return ResolveTopLevelFolder(link, folder, created);
    }

    private static ItemRef? Descend(HostLink link, ItemRef from, IEnumerable<string> segments,
                                    Func<ItemRef, bool> isContainer, bool create, List<string>? created)
    {
        var node = from;
        var path = "";
        foreach (var part in segments)
        {
            path = path.Length == 0 ? part : path + "/" + part;
            var next = FirstChild(link, node, c => NameIs(link, c, part) && isContainer(c));
            if (next is null)
            {
                if (!create) return null;
                next = link.Driver.CreateFolder(node, part);
                created?.Add(path);
            }
            node = next.Value;
        }
        return node;
    }

    private static Func<ItemRef, bool> AnyContainer(HostLink link) => c => !TreeLookup.IsSourceItem(link, link.Driver.Classify(c));

    private static Func<ItemRef, bool> UserFolder(HostLink link) => c => link.Driver.Classify(c).Role == NodeRole.Folder;

    /// <summary>Resolve a folder RELATIVE to a given parent (a member's sub-folder inside its item), creating what is
    /// missing; each folder created is recorded by its path from the parent.</summary>
    internal static ItemRef ResolveFolder(HostLink link, ItemRef parent, string? folder, List<string>? created = null) =>
        Descend(link, parent, FolderPath.Segments(folder), UserFolder(link), create: true, created)!.Value;

    private static ItemRef? DescendExisting(HostLink link, ItemRef parent, string? folder) =>
        Descend(link, parent, FolderPath.Segments(folder), AnyContainer(link), create: false, null);

    /// <summary>Why an existing item cannot be MOVED into <paramref name="folder"/> — the node is no folder and holds no
    /// items (a device, a task configuration) — or null when it can, or when the folder does not exist yet (a move
    /// creates it) or is the tree root. An IDE can accept such a move and leave the object where it was (CODESYS), so it is
    /// refused before any op lands (openspec bridge-refusal-review 4.31).</summary>
    internal static string? RefusedMoveTarget(HostLink link, string folder)
    {
        if (string.IsNullOrEmpty(folder) || DescendExisting(link, link.Driver.Root, folder) is not { } node) return null;
        var cls = link.Driver.Classify(node);
        return cls.Role == NodeRole.Folder || cls is { Role: NodeRole.Container, HoldsItems: true }
            ? null
            : $"'{link.Driver.Name(node)}' is a {NounOf(cls)}, not a folder — an item can be moved only to the tree root, " +
              "into a folder or into an Application.";
    }

    private static string NounOf(NodeClass cls) =>
        cls.Noun ?? (cls.Kind is { } kind ? $"{kind} node" : $"{cls.Role.ToString().ToLowerInvariant()} node");

    /// <summary>Does <paramref name="folder"/> hold an item named <paramref name="name"/> of <paramref name="kind"/>? An
    /// item the host must not open counts by the name and kind it is named with.</summary>
    internal static bool FolderHolds(HostLink link, string folder, string name, string kind)
    {
        if (DescendExisting(link, link.Driver.Root, folder) is not { } node) return false;
        var children = link.Driver.Children(node);
        for (var i = 0; i < children.Count; i++)
        {
            try
            {
                var child = children[i];
                if (NameIs(link, child, name) && link.Driver.Classify(child).Kind == kind) return true;
            }
            catch (UnreadableItemException untouchable)
            {
                if (ItemPath.SameItem(untouchable.Name, name)
                    && untouchable.Kind == kind) return true;
            }
        }
        return false;
    }

    /// <summary>The user folder <paramref name="folder"/> under <paramref name="parent"/>, or null — never created.</summary>
    internal static ItemRef? FindFolder(HostLink link, ItemRef parent, string? folder) =>
        Descend(link, parent, FolderPath.Segments(folder), UserFolder(link), create: false, null);

    /// <summary>Delete the folders a push EMPTIED (a delete's folder, a move's origin), deepest first and up the chain,
    /// as git removes a directory whose last file went. Only a user FOLDER is ever removed: the descent is loose so it can
    /// pass the vendor's own containers, and those are exactly what must never be deleted.</summary>
    internal static void PruneEmptied(HostLink link, IEnumerable<string> emptiedFolders)
    {
        var tree = link.Driver;
        foreach (var folder in emptiedFolders.Where(f => !string.IsNullOrEmpty(f))
                                             .Distinct(ItemPath.Addressed)
                                             .OrderByDescending(f => FolderPath.Segments(f).Count(), Comparer<int>.Default))
        {
            var path = folder;
            while (!string.IsNullOrEmpty(path))
            {
                var node = DescendExisting(link, tree.Root, path);
                if (node is not { } dir || tree.Classify(dir).Role != NodeRole.Folder) break;
                if (tree.Children(dir).Count > 0) break;

                var segments = FolderPath.Segments(path).ToList();
                var parentPath = string.Join("/", segments.Take(segments.Count - 1));
                var parent = DescendExisting(link, tree.Root, parentPath);
                if (parent is not { } holder) break;

                // The LAST SEGMENT, from the path in hand: no dependence on how a host names a folder node.
                tree.Delete(holder, segments[segments.Count - 1]);
                path = parentPath;   // …and ask the same question one level up
            }
        }
    }

    internal static ItemRef? FindChild(HostLink link, ItemRef parent, string name) =>
        FirstChild(link, parent, c => NameIs(link, c, name), wanted: name);

    /// <summary>The first child that matches. A child the host must not open (<see cref="UnreadableItemException"/>) is
    /// passed by unless it is the very name wanted, which is then the host's refusal to give.</summary>
    private static ItemRef? FirstChild(HostLink link, ItemRef parent, Func<ItemRef, bool> match, string? wanted = null)
    {
        var children = link.Driver.Children(parent);
        for (var i = 0; i < children.Count; i++)
        {
            ItemRef child;
            try { child = children[i]; }
            catch (UnreadableItemException u) when (!ItemPath.SameItem(u.Name, wanted))
            {
                continue;
            }
            if (match(child)) return child;
        }
        return null;
    }

    // Names are matched case-insensitively: IEC identifiers are case-insensitive, so the engine never trusts the IDE's
    // casing.
    private static bool NameIs(HostLink link, ItemRef item, string name) =>
        ItemPath.SameItem(link.Driver.Name(item), name);
}
