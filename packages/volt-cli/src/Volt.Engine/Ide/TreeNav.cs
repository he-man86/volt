using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.Item;

namespace Volt.Engine.Ide;

/// <summary>Navigating and shaping a vendor project TREE: find a child, find or create a folder, descend a
/// path, remove a child if it is there. Every member here is about <see cref="IProjectTree"/> and nothing else.
/// <para>It lived privately inside <c>PushService</c>, which meant the push owned ~95 lines with no push
/// semantics in them — and, more tellingly, reimplemented a walk <see cref="ItemLookup"/> already had. Putting
/// the two in one namespace is what makes that overlap visible; a caller that needs to find something in the
/// tree should not have to be a push to do it.</para></summary>
internal static class TreeNav
{
    /// <summary>Resolve a TOP-LEVEL item's placement folder. <paramref name="folder"/> is the FULL tree path
    /// exactly as <see cref="IProjectTree.WalkItems"/> emits it (e.g. CODESYS
    /// "Device/Plc Logic/Application/POUs/Sub"), so push placement is symmetric with fetch: descend from the same
    /// tree root the walk measures from, MATCHING each existing container (structural node OR user folder) by name
    /// and only CREATING a user folder for a segment that does not yet exist.
    ///
    /// <para><b>EMPTY IS THE TREE ROOT, and it used to be the Application.</b> The walk measures every folder
    /// from <see cref="IProjectTree.GetTreeRoot"/>, so an item it emits with an empty folder is one sitting AT
    /// that root — on CODESYS the project's own POU pool, where `Lenze_MID-S100` keeps `GVL_Errorlists` and
    /// `POE_SystemStart`. Resolving empty to a second root instead (the Application) made push placement
    /// asymmetric with fetch for exactly those items: pushed into a fresh project they were CREATED INSIDE THE
    /// APPLICATION, so the workspace got them back one folder deeper than it sent them and a round-trip moved
    /// the engineer's files. On TwinCAT the two roots are the same node, so this is CODESYS-shaped and the
    /// TwinCAT behaviour is unchanged.</para></summary>
    internal static ItemRef ResolveTopLevelFolder(IIdeDriver ide, string? folder)
    {
        if (string.IsNullOrEmpty(folder)) return ide.GetTreeRoot();
        var node = ide.GetTreeRoot();
        foreach (var part in FolderPath.Segments(folder))   // decode each segment back to its real IDE name
            node = DescendOrCreateFolder(ide, node, part);
        return node;
    }

    /// <summary>The node a TASK is created under.
    ///
    /// <para><b>The task container's NAME is LOCALIZED; its KIND is not.</b> A German CODESYS ships the Standard
    /// template with <c>Taskkonfiguration</c> where an English project's walk emits <c>Task Configuration</c>, so
    /// resolving a pushed task's folder by name missed the container entirely, <see cref="DescendOrCreateFolder"/>
    /// created a plain user folder in its place, and the vendor then refused the create on a node with no task
    /// facet — <c>node has no ScriptTaskConfigObject facet</c>, with the junk folder left behind. Found migrating
    /// a real project into the shipped blank; measured with <c>scripts/probe-task-config-survives-delete.py</c>,
    /// which also rules out the other candidate (the container survives its last task being deleted).</para>
    ///
    /// <para>So the ANCESTRY is walked by name (Device / Plc Logic / Application are real, non-localized
    /// container names) and the last segment is resolved by KIND. TwinCAT has no such node — its PLC tasks are
    /// children of the PLC project itself — so nothing there matches and the by-name walk stays the answer.</para></summary>
    internal static ItemRef ResolveTaskParent(IIdeDriver ide, string? folder)
    {
        var segments = new List<string>(FolderPath.Segments(folder));
        if (segments.Count > 0)
        {
            var node = ide.GetTreeRoot();
            for (var i = 0; i < segments.Count - 1; i++) node = DescendOrCreateFolder(ide, node, segments[i]);
            if (FirstChild(ide, node, c => ide.KindCode(c) == ItemKind.TaskConfig) is { } config) return config;
        }
        return ResolveTopLevelFolder(ide, folder);
    }

    /// <summary>Match a container child (a structural node like Device/Plc Logic/Application, or an existing user
    /// folder) by name and descend into it; a same-named source LEAF (a POU/DUT) is not a container, so fall
    /// through and create a user folder beside it.</summary>
    private static ItemRef DescendOrCreateFolder(IIdeDriver ide, ItemRef parent, string name) =>
        FirstChild(ide, parent, c => NameIs(ide, c, name) && !ItemKind.IsTopLevelCrud(ide.KindCode(c)))
            ?? ide.CreateChild(parent, name, ItemKind.PlcFolder);

    // Resolve a folder RELATIVE to a given parent (used for POU children, whose sub-folder is relative to the POU).
    internal static ItemRef ResolveFolder(IIdeDriver ide, ItemRef parent, string? folder)
    {
        if (string.IsNullOrEmpty(folder)) return parent;
        var node = parent;
        foreach (var part in FolderPath.Segments(folder))   // decode each segment back to its real IDE name
            node = FindOrCreateFolder(ide, node, part);
        return node;
    }

    private static ItemRef FindOrCreateFolder(IIdeDriver ide, ItemRef parent, string name) =>
        FirstChild(ide, parent, c => NameIs(ide, c, name) && ide.KindCode(c) == ItemKind.PlcFolder)
            ?? ide.CreateChild(parent, name, ItemKind.PlcFolder);

    /// <summary>Descend an EXISTING folder path, creating nothing, matching the way the create path matches —
    /// by name, excluding only top-level CRUD kinds. That traverses a container-manager (`POUs`, `DUTs`) as
    /// well as a plain folder, which is what makes a path like <c>POUs/Sub</c> resolvable at all.</summary>
    private static ItemRef? DescendExisting(IIdeDriver ide, ItemRef parent, string? folder)
    {
        if (string.IsNullOrEmpty(folder)) return parent;
        var node = parent;
        foreach (var part in FolderPath.Segments(folder))
        {
            var next = FirstChild(ide, node, c => NameIs(ide, c, part) && !ItemKind.IsTopLevelCrud(ide.KindCode(c)));
            if (next is null) return null;
            node = next.Value;
        }
        return node;
    }

    /// <summary>Resolve a folder path WITHOUT creating anything, for a lookup that only wants to READ.
    /// <para><see cref="ResolveFolder"/> is find-OR-CREATE, which is right on a create path and wrong on every
    /// other. Used for a read it made a real empty folder inside the engineer's POU whenever the pushed
    /// `%FOLDER` did not match where the item actually sits, and the subsequent lookup then missed INSIDE the
    /// folder it had just made - so the caller silently skipped the work it was there to do.</para></summary>
    internal static ItemRef? FindFolder(IIdeDriver ide, ItemRef parent, string? folder)
    {
        if (string.IsNullOrEmpty(folder)) return parent;
        var node = parent;
        foreach (var part in FolderPath.Segments(folder))
        {
            var next = FirstChild(ide, node, c => NameIs(ide, c, part) && ide.KindCode(c) == ItemKind.PlcFolder);
            if (next is null) return null;
            node = next.Value;
        }
        return node;
    }

    /// <summary>REMOVE A FOLDER THAT HAS JUST BEEN EMPTIED, and every ancestor the removal empties in turn.
    ///
    /// <para><b>Git is the specification.</b> A directory is not an entity there either — deleting the last
    /// file under <c>a/b/</c> records exactly that one path — and git still REMOVES the directory from the
    /// working tree, as a derived consequence of the file going. Volt models its interface on git and was
    /// missing precisely that derivation: the workspace side is pruned by git for free, while the IDE kept the
    /// folder for ever. Measured on BOTH vendors (`scripts/probe-empty-folder-lifecycle.py` for CODESYS, a COM
    /// tree walk for TwinCAT): neither prunes on its own, and both expose the primitive to do it.</para>
    ///
    /// <para>It compounds, because an empty folder is UNREPRESENTABLE on the wire — the <c>folders</c> map is
    /// keyed by item — so the next pull cannot see it, cannot materialize it, and cannot report it as drift.
    /// The two sides diverge silently and permanently.</para>
    ///
    /// <para><b>ONLY WHAT THIS PUSH EMPTIED.</b> The caller passes the folders items actually LEFT, and a
    /// folder still holding anything is left alone. A folder that was ALREADY empty before the push is the
    /// engineer's and is not touched — git would not touch it either, having nothing to remove.</para>
    ///
    /// <para><b>RECURSIVE, because git is.</b> Emptying <c>a/b/</c> removes <c>a/</c> too when <c>b</c> was
    /// all it held. Stops at the tree root, which is not a folder and is never removed.</para></summary>
    internal static void PruneEmptied(IIdeDriver ide, IEnumerable<string> emptiedFolders)
    {
        // DEEPEST FIRST, so a child is gone before its parent is asked whether it is empty. Without the sort a
        // parent is measured while the child it is about to lose is still in it, and the chain stops one level
        // too early — the shallow half of the litter stays.
        foreach (var folder in emptiedFolders.Where(f => !string.IsNullOrEmpty(f))
                                             .Distinct(StringComparer.OrdinalIgnoreCase)
                                             .OrderByDescending(f => FolderPath.Segments(f).Count()))
        {
            var path = folder;
            while (!string.IsNullOrEmpty(path))
            {
                // DESCEND THE WAY THE CREATE PATH DOES, not the way `FindFolder` does. `FindFolder`
                // demands `PlcFolder` at every segment, and a standard container like `POUs` is a
                // container-MANAGER — so it failed on the first segment and the prune silently did
                // nothing against a real IDE while passing against the fake, whose tree is flat.
                var node = DescendExisting(ide, ide.GetTreeRoot(), path);
                // Gone already (a deeper pass removed it), not a folder, or still holding something: stop.
                // …AND ONLY A REAL FOLDER IS EVER REMOVED. The descent is deliberately loose so it can
                // traverse `POUs`/`DUTs`/`GVLs`, and those are exactly what must never be deleted: they
                // are the vendor's own containers, not the engineer's folders, and an empty one is the
                // project's normal state. The strict check moves here, where it is a SAFETY rule rather
                // than a navigation one.
                if (node is not { } dir || ide.KindCode(dir) != ItemKind.PlcFolder) break;
                if (ide.ChildCount(dir) > 0) break;

                var segments = FolderPath.Segments(path).ToList();
                var parentPath = string.Join("/", segments.Take(segments.Count - 1));
                var parent = DescendExisting(ide, ide.GetTreeRoot(), parentPath);
                if (parent is not { } holder) break;

                // The LAST SEGMENT, computed rather than read back with `ide.Name(dir)`. Both answer the
                // same thing on a real driver, and taking it from the path already in hand means this
                // does not depend on how a driver chooses to name a folder node.
                ide.Delete(holder, segments[segments.Count - 1]);
                path = parentPath;   // …and ask the same question one level up
            }
        }
    }

    internal static ItemRef? FindChild(IIdeDriver ide, ItemRef parent, string name) =>
        FirstChild(ide, parent, c => NameIs(ide, c, name));

    /// <summary>The one 1-based child scan every lookup here shares: first child matching
    /// <paramref name="match"/>, or null.</summary>
    private static ItemRef? FirstChild(IIdeDriver ide, ItemRef parent, Func<ItemRef, bool> match)
    {
        int count = ide.ChildCount(parent);
        for (int i = 1; i <= count; i++)
        {
            var child = ide.ChildAt(parent, i);
            if (match(child)) return child;
        }
        return null;
    }

    // Names are matched case-insensitively: IEC identifiers are case-insensitive, so Core never trusts the
    // IDE's casing.
    private static bool NameIs(IIdeDriver ide, ItemRef item, string name) =>
        string.Equals(ide.Name(item), name, StringComparison.OrdinalIgnoreCase);

}
