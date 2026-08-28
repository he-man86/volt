using System;
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
    /// <summary>Resolve a TOP-LEVEL item's placement folder. A non-empty <paramref name="folder"/> is the FULL
    /// tree path exactly as <see cref="IProjectTree.WalkItems"/> emits it (e.g. CODESYS
    /// "Device/Plc Logic/Application/POUs/Sub"), so push placement is symmetric with fetch: descend from the same
    /// tree root the walk measures from, MATCHING each existing container (structural node OR user folder) by name
    /// and only CREATING a user folder for a segment that does not yet exist. Empty ⇒ the default PLC-project root
    /// (<paramref name="defaultParent"/>) so a bare create still lands in the Application / PLC project.</summary>
    internal static ItemRef ResolveTopLevelFolder(IIdeDriver ide, ItemRef defaultParent, string? folder)
    {
        if (string.IsNullOrEmpty(folder)) return defaultParent;
        var node = ide.GetTreeRoot();
        foreach (var part in FolderPath.Segments(folder))   // decode each segment back to its real IDE name
            node = DescendOrCreateFolder(ide, node, part);
        return node;
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

    /// <summary>Resolve a folder WITHOUT creating one — the read-only twin of <see cref="ResolveFolder"/>, for
    /// callers that are only looking (a guard must not mutate the project it is about to refuse).</summary>
    internal static ItemRef? FindFolder(IIdeDriver ide, ItemRef parent, string? folder)
    {
        if (string.IsNullOrEmpty(folder)) return parent;
        var node = parent;
        foreach (var part in FolderPath.Segments(folder))
        {
            if (FirstChild(ide, node, c => NameIs(ide, c, part) && ide.KindCode(c) == ItemKind.PlcFolder) is not { } found)
                return null;                                   // a segment that does not exist ⇒ the child is not there
            node = found;
        }
        return node;
    }

    private static ItemRef FindOrCreateFolder(IIdeDriver ide, ItemRef parent, string name) =>
        FirstChild(ide, parent, c => NameIs(ide, c, name) && ide.KindCode(c) == ItemKind.PlcFolder)
            ?? ide.CreateChild(parent, name, ItemKind.PlcFolder);

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
