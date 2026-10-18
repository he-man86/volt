using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.Item;

namespace Volt.Engine.Ide;

/// <summary>Navigating and shaping a vendor project TREE: find a child, find or create a folder, descend a
/// path, remove a child if it is there. Every member here is about <see cref="IProjectTree"/> and nothing else, beside
/// <see cref="ItemLookup"/> in one namespace, so a caller that needs to find something in the tree need not be a push.</summary>
internal static class TreeNav
{
    /// <summary>Resolve a TOP-LEVEL item's placement folder. <paramref name="folder"/> is the FULL tree path
    /// exactly as <see cref="IProjectTree.WalkItems"/> emits it (e.g. CODESYS
    /// "Device/Plc Logic/Application/POUs/Sub"), so push placement is symmetric with fetch: descend from the same
    /// tree root the walk measures from, MATCHING each existing container (structural node OR user folder) by name
    /// and only CREATING a user folder for a segment that does not yet exist.
    ///
    /// <para><b>EMPTY IS THE TREE ROOT, never the Application.</b> The walk measures every folder from
    /// <see cref="IProjectTree.GetTreeRoot"/>, so an item it emits with an empty folder sits AT that root — on CODESYS
    /// the project's own POU pool (`Lenze_MID-S100` keeps `GVL_Errorlists` there). Resolving empty to the Application
    /// would create such items one folder deeper than the workspace sent them, so a round trip moved the engineer's
    /// files. On TwinCAT the two roots are the same node.</para></summary>
    /// <param name="created">When given, receives the path (from the tree root) of each folder this call CREATED — what a
    /// refused push states it left behind (openspec <c>push-keeps-what-landed</c>).</param>
    internal static ItemRef ResolveTopLevelFolder(IIdeDriver ide, string? folder, List<string>? created = null) =>
        Descend(ide, ide.GetTreeRoot(), FolderPath.Segments(folder), AnyContainer(ide), create: true, created)!.Value;

    /// <summary>The node a TASK is created under.
    ///
    /// <para><b>The task container's NAME is LOCALIZED; its KIND is not.</b> A German CODESYS ships the Standard
    /// template with <c>Taskkonfiguration</c> where an English project's walk emits <c>Task Configuration</c>, so a
    /// by-name descent misses the container, creates a plain user folder in its place, and the vendor refuses the
    /// create on a node with no task facet (<c>node has no ScriptTaskConfigObject facet</c>), junk folder left behind.
    /// Measured with <c>probe-task-config-survives-delete.py</c> (deleted; <c>git show b2496efb4b:packages/volt-cli/scripts/probe-task-config-survives-delete.py</c>),
    /// which also shows the container survives its last task being deleted.</para>
    ///
    /// <para>So the ANCESTRY is walked by name (Device / Plc Logic / Application are real, non-localized
    /// container names) and the last segment is resolved by KIND. TwinCAT has no such node — its PLC tasks are
    /// children of the PLC project itself — so nothing there matches and the by-name walk stays the answer.</para></summary>
    /// <param name="created">As on <see cref="ResolveTopLevelFolder"/>: each folder created, by its path.</param>
    internal static ItemRef ResolveTaskParent(IIdeDriver ide, string? folder, List<string>? created = null)
    {
        var segments = new List<string>(FolderPath.Segments(folder));
        if (segments.Count > 0)
        {
            var node = Descend(ide, ide.GetTreeRoot(), segments.Take(segments.Count - 1), AnyContainer(ide), create: true,
                               created)!.Value;
            if (FirstChild(ide, node, c => ide.KindCode(c) == ItemKind.TaskConfig) is { } config) return config;
        }
        // The ancestry above was created already if it was missing, so this walk finds it and records only what it adds.
        return ResolveTopLevelFolder(ide, folder, created);
    }

    /// <summary>THE folder descent every resolver here shares: from <paramref name="from"/>, one child per segment
    /// (each already decoded to its real IDE name), matched by name and <paramref name="isContainer"/>. A missing segment
    /// is CREATED as a user folder when <paramref name="create"/> — recorded in <paramref name="created"/> by its path
    /// from <paramref name="from"/> — and otherwise ends the descent with null.</summary>
    private static ItemRef? Descend(IIdeDriver ide, ItemRef from, IEnumerable<string> segments,
                                    Func<ItemRef, bool> isContainer, bool create, List<string>? created)
    {
        var node = from;
        var path = "";
        foreach (var part in segments)
        {
            path = path.Length == 0 ? part : path + "/" + part;
            var next = FirstChild(ide, node, c => NameIs(ide, c, part) && isContainer(c));
            if (next is null)
            {
                if (!create) return null;
                next = ide.CreateChild(node, part, ItemKind.PlcFolder, null, null);
                created?.Add(path);
            }
            node = next.Value;
        }
        return node;
    }

    /// <summary>A container child: a structural node like Device/Plc Logic/Application, a container-manager
    /// (<c>POUs</c>, <c>DUTs</c>) or a user folder — anything but a top-level CRUD kind, so a same-named source LEAF
    /// (a POU/DUT) is not descended into and a user folder is created beside it.</summary>
    private static Func<ItemRef, bool> AnyContainer(IIdeDriver ide) => c => !ItemKind.IsTopLevelCrud(ide.KindCode(c));

    /// <summary>A user folder and nothing else — the containers inside a POU.</summary>
    private static Func<ItemRef, bool> UserFolder(IIdeDriver ide) => c => ide.KindCode(c) == ItemKind.PlcFolder;

    // Resolve a folder RELATIVE to a given parent (used for POU children, whose sub-folder is relative to the POU).
    // <paramref name="created"/>: as on <see cref="ResolveTopLevelFolder"/>, each folder created, by its path from the parent.
    internal static ItemRef ResolveFolder(IIdeDriver ide, ItemRef parent, string? folder, List<string>? created = null) =>
        Descend(ide, parent, FolderPath.Segments(folder), UserFolder(ide), create: true, created)!.Value;

    /// <summary>Descend an EXISTING folder path, creating nothing, matching the way the create path matches
    /// (<see cref="AnyContainer"/>). That traverses a container-manager (`POUs`, `DUTs`) as well as a plain folder,
    /// which is what makes a path like <c>POUs/Sub</c> resolvable at all.</summary>
    private static ItemRef? DescendExisting(IIdeDriver ide, ItemRef parent, string? folder) =>
        Descend(ide, parent, FolderPath.Segments(folder), AnyContainer(ide), create: false, null);

    /// <summary>Why a MOVE into <paramref name="folder"/> (a full tree path, as <see cref="ResolveTopLevelFolder"/> takes it)
    /// cannot land, or null when it can (openspec <c>bridge-refusal-review</c> 4.31). Read-only: the path is descended the
    /// way the move will descend it (<see cref="DescendExisting"/>'s match), and only a target that EXISTS is judged: a
    /// path naming folders the move would CREATE (under any node) is the vendor's to answer — what CODESYS does with a
    /// folder created under <c>Device</c> is unmeasured (4d review), and the move's post-condition catches a move it
    /// ignores.
    ///
    /// <para>The holders are MEASURED, not assumed (<c>move-holders.log (deleted; git show 5312b799fe:packages/volt-cli/scripts/move-holders.log)</c>, CODESYS SP21: every top-level source
    /// object of Pro2193, Bakon, AWA, Lenze and the CODESYS fixture sits at the tree root, in a folder or directly in an
    /// Application; TwinCAT's, censused on the pulled <c>twincat-project14</c> corpus, at the PLC project root or in a
    /// folder). Any other node — <c>Device</c>, <c>Plc
    /// Logic</c>, <c>Task Configuration</c>, a library manager — is no holder: CODESYS accepts the move and leaves the object
    /// where it was (<c>scripts/vendor-facts.codesys.json</c>, fact <c>move-target</c>), so the push reported "moved" and the next pull moved the
    /// file back (DIALECT C2q). A holder kind measured later joins <see cref="MoveHolders"/>; nothing is a holder by default.</para></summary>
    internal static string? RefusedMoveTarget(IIdeDriver ide, string folder)
    {
        // The tree root, or a folder to create: not judged here (see the summary).
        if (string.IsNullOrEmpty(folder) || DescendExisting(ide, ide.GetTreeRoot(), folder) is not { } node) return null;
        var kind = ide.KindCode(node);
        return MoveHolders.Contains(kind)
            ? null
            : $"'{ide.Name(node)}' is a {NodeKindName(kind)}, not a folder — an item can be moved only to the tree root, " +
              "into a folder or into an Application.";
    }

    /// <summary>The node kinds that hold a top-level item, besides the tree root (measured: see <see cref="RefusedMoveTarget"/>).</summary>
    private static readonly HashSet<int> MoveHolders = new() { ItemKind.PlcFolder, ItemKind.Application };

    /// <summary>A node kind in words, for a refusal: the container names, else the wire kind, else the code itself.</summary>
    private static string NodeKindName(int kind) => kind switch
    {
        ItemKind.Device => "device node",
        ItemKind.PlcLogic => "PLC logic node",
        ItemKind.TaskConfig => "task configuration node",
        ItemKind.GenericContainer => "container node",
        _ => ItemKind.Map(kind) is { } wire ? $"{wire} node" : $"tree node of item type {kind}",
    };

    /// <summary>Does <paramref name="folder"/> (a full tree path) exist and hold the item <paramref name="name"/> of wire
    /// kind <paramref name="kind"/> (the name case-insensitive, as IEC names are)? Read-only — a move's post-condition.
    /// NAME AND KIND, because the bare name is not the identity: an FB and its visualization share one
    /// (<c>CM_Carrier.pou</c> / <c>CM_Carrier.visualization</c>), and a name alone let the visualization answer for an FB
    /// the IDE never moved. A child the driver must not open (DIALECT C2i) is answered by its name and the kind the
    /// vendor states for it.</summary>
    internal static bool FolderHolds(IIdeDriver ide, string folder, string name, string kind)
    {
        if (DescendExisting(ide, ide.GetTreeRoot(), folder) is not { } node) return false;
        for (int i = 1, n = ide.ChildCount(node); i <= n; i++)
        {
            try
            {
                var child = ide.ChildAt(node, i);
                if (NameIs(ide, child, name) && ItemKind.Map(ide.KindCode(child)) == kind) return true;
            }
            catch (UnreadableItemException untouchable)
            {
                if (string.Equals(untouchable.Name, name, StringComparison.OrdinalIgnoreCase)
                    && untouchable.Kind == kind) return true;
            }
        }
        return false;
    }

    /// <summary>Resolve a folder path WITHOUT creating anything, for a lookup that only wants to READ.
    /// <para><see cref="ResolveFolder"/> is find-OR-CREATE, right on a create path and wrong on every other: on a read
    /// it would make an empty folder inside the engineer's POU whenever the pushed `%FOLDER` does not match where the
    /// item sits, and then miss inside it.</para></summary>
    internal static ItemRef? FindFolder(IIdeDriver ide, ItemRef parent, string? folder) =>
        Descend(ide, parent, FolderPath.Segments(folder), UserFolder(ide), create: false, null);

    /// <summary>REMOVE A FOLDER THAT HAS JUST BEEN EMPTIED, and every ancestor the removal empties in turn.
    ///
    /// <para><b>Git is the specification.</b> A directory is not an entity there either, yet git REMOVES it from the
    /// working tree when its last file goes; the IDE does not. Measured on BOTH vendors (`probe-empty-folder-lifecycle.py`,
    /// deleted; `git show b2496efb4b:packages/volt-cli/scripts/probe-empty-folder-lifecycle.py`, for CODESYS, a COM tree
    /// walk for TwinCAT): neither prunes on its own, and both expose the primitive to do it. An empty folder is
    /// UNREPRESENTABLE on the wire (the <c>folders</c> map is keyed by item), so without this the two sides diverge
    /// silently and permanently.</para>
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
                                             .OrderByDescending(f => FolderPath.Segments(f).Count(), Comparer<int>.Default))
        {
            var path = folder;
            while (!string.IsNullOrEmpty(path))
            {
                // DESCEND THE WAY THE CREATE PATH DOES, not the way `FindFolder` does: `FindFolder` demands
                // `PlcFolder` at every segment, and a standard container like `POUs` is a container-MANAGER.
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
        FirstChild(ide, parent, c => NameIs(ide, c, name), wanted: name);

    /// <summary>The one 1-based child scan every lookup here shares: first child matching
    /// <paramref name="match"/>, or null.
    /// <para>A child the driver must not open (<see cref="UnreadableItemException"/>, DIALECT C2i) is a top-level POU:
    /// never a folder, a task configuration or a member, so it matches no scan here and is passed over — unless it IS
    /// the <paramref name="wanted"/> name, which no answer here can honestly give, so the refusal propagates.</para></summary>
    private static ItemRef? FirstChild(IIdeDriver ide, ItemRef parent, Func<ItemRef, bool> match, string? wanted = null)
    {
        int count = ide.ChildCount(parent);
        for (int i = 1; i <= count; i++)
        {
            ItemRef child;
            try { child = ide.ChildAt(parent, i); }
            catch (UnreadableItemException u) when (!string.Equals(u.Name, wanted, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            if (match(child)) return child;
        }
        return null;
    }

    // Names are matched case-insensitively: IEC identifiers are case-insensitive, so Core never trusts the
    // IDE's casing.
    private static bool NameIs(IIdeDriver ide, ItemRef item, string name) =>
        string.Equals(ide.Name(item), name, StringComparison.OrdinalIgnoreCase);

}
