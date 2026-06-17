using System;
using System.Collections.Generic;
using Volt.Bridge.Core.Ide;
using Volt.Bridge.Core.Workspace;
using Volt.Bridge.Core.Workspace.SourceText;

namespace Volt.Bridge.Beckhoff;

/// <summary>Beckhoff driver — the <see cref="IProjectTree"/> facet: the walk/lookup/CRUD ALGORITHM over
/// the TwinCAT tree. The raw COM moves (child access, name, item-type, create/delete/rename) go through
/// <see cref="TcObjectModel"/>; <see cref="ItemRef"/> wraps an opaque COM tree item (no <c>dynamic</c>
/// here). The per-node try/catch is the walk's own defence against a COM node that faults mid-walk.</summary>
public sealed partial class BeckhoffDriver
{
    public ItemRef GetPlcProjectRoot() => new(_om.PlcRoot());

    public IReadOnlyList<ProjectItem> WalkItems()
    {
        var items = new List<ProjectItem>();
        WalkInner(_om.PlcRoot(), "", items);
        WalkIoDevices(items);
        return items;
    }

    private void WalkInner(object node, string folderPath, List<ProjectItem> items)
    {
        int count;
        try { count = _om.ChildCount(node); } catch { return; }
        for (int i = 1; i <= count; i++)
        {
            object child;
            try { child = _om.ChildAt(node, i); } catch { continue; }
            string name;
            try { name = _om.GetName(child); } catch { continue; }
            int itemType = ClassifiedKind(child);

            if (itemType == ItemKind.Folder || itemType == ItemKind.LibraryManager)
            {
                var nested = string.IsNullOrEmpty(folderPath) ? name : $"{folderPath}/{name}";
                WalkInner(child, nested, items);
                continue;
            }
            if (ItemKind.IsInlinedInPou(itemType)) continue;

            int childCount = 0;
            try { childCount = _om.ChildCount(child); } catch { }
            bool isTopLevelCrud = ItemKind.IsTopLevelCrud(itemType);
            bool isHybrid = childCount > 0 && !isTopLevelCrud;
            string emitFolder = isHybrid ? (string.IsNullOrEmpty(folderPath) ? name : $"{folderPath}/{name}") : folderPath;

            items.Add(new ProjectItem(name, new ItemRef(child), itemType, isTopLevelCrud, emitFolder));
            if (isHybrid) WalkInner(child, emitFolder, items);
        }
    }

    private void WalkIoDevices(List<ProjectItem> items)
    {
        object tiid;
        try { tiid = _om.LookupTreeItem("TIID"); } catch { return; }
        int count;
        try { count = _om.ChildCount(tiid); } catch { return; }
        for (int i = 1; i <= count; i++)
        {
            object device;
            try { device = _om.ChildAt(tiid, i); } catch { continue; }
            string name;
            try { name = _om.GetName(device); } catch { continue; }
            items.Add(new ProjectItem(name, new ItemRef(device), ClassifiedKind(device), false, "I/O Devices"));
        }
    }

    public ItemRef? Lookup(string name)
    {
        var node = FindItemByName(_om.PlcRoot(), name);
        return node == null ? null : new ItemRef(node);
    }

    private object? FindItemByName(object parent, string name)
    {
        // 1-based COM, bounded by ChildCount (0 for a leaf), so the loop never over-indexes.
        int count = _om.ChildCount(parent);
        for (int i = 1; i <= count; i++)
        {
            object child = _om.ChildAt(parent, i);
            string childName = _om.GetName(child);
            if (string.Equals(childName, name, StringComparison.OrdinalIgnoreCase) && ItemKind.IsTopLevelCrud(_om.ItemType(child)))
                return child;
            if (_om.ItemType(child) == ItemKind.Folder)
            {
                var found = FindItemByName(child, name);
                if (found != null) return found;
            }
        }
        return null;
    }

    public int ChildCount(ItemRef item) { try { return _om.ChildCount(item.Native); } catch { return 0; } }
    public ItemRef ChildAt(ItemRef parent, int index1Based) => new(_om.ChildAt(parent.Native, index1Based));
    public ItemRef Parent(ItemRef item) => new(_om.Parent(item.Native));
    public string Name(ItemRef item) { try { return _om.GetName(item.Native); } catch { return ""; } }
    public int KindCode(ItemRef item) => ClassifiedKind(item.Native);

    public ItemRef CreateChild(ItemRef parent, string name, int kindCode, string? language = null) => new(_om.CreateChild(parent.Native, name, kindCode, language));
    public void Delete(ItemRef parent, string name) => _om.DeleteChild(parent.Native, name);
    public void Rename(ItemRef item, string newName) => _om.Rename(item.Native, newName);

    // TwinCAT reports EVERY DUT as one tree type (623, == ItemKind.Alias) — the struct/enum/union/alias
    // distinction lives only in the declaration. Refine it from the decl (shared CodeHelper, the same
    // basis CODESYS uses), so the wire kind matches across vendors. Only a DUT pays the extra decl read.
    private int ClassifiedKind(object node)
    {
        int raw = _om.ItemType(node);
        if (raw != ItemKind.Alias) return raw;
        try { return DutCode(CodeHelper.ParseCodeHeader(_om.ReadDeclaration(node)).Type); }
        catch { return raw; }
    }

    private static int DutCode(string type) => type switch
    {
        "structure" => ItemKind.Structure,
        "union" => ItemKind.Union,
        "enumeration" => ItemKind.Enumeration,
        _ => ItemKind.Alias,
    };
}
