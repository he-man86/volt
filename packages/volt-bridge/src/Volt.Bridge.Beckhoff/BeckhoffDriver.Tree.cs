using Volt.Bridge.Core.Ide;
using Volt.Bridge.Core.Workspace;

namespace Volt.Bridge.Beckhoff;

/// <summary>Beckhoff driver — the <see cref="IProjectTree"/> facet: walk the COM tree and classify/CRUD
/// nodes. <see cref="ItemRef"/> wraps a TwinCAT COM tree item (dynamic stays behind the boundary).</summary>
public sealed partial class BeckhoffDriver
{
    private dynamic PlcRoot()
    {
        if (_plcNode != null)
        {
            try { return _plcNode.NestedProject; } catch { /* fall through to lookup */ }
        }
        if (_plcProjectPath == null) throw new InvalidOperationException("No PLC project found");
        return LookupTreeItem(_plcProjectPath);
    }

    public ItemRef GetPlcProjectRoot() => new(PlcRoot());

    public IReadOnlyList<ProjectItem> WalkItems()
    {
        var items = new List<ProjectItem>();
        WalkInner(PlcRoot(), "", items);
        WalkIoDevices(items);
        return items;
    }

    private void WalkInner(dynamic node, string folderPath, List<ProjectItem> items)
    {
        int count;
        try { count = (int)node.ChildCount; } catch { return; }
        for (int i = 1; i <= count; i++)
        {
            dynamic child;
            try { child = node.Child[i]; } catch { continue; }
            string name;
            try { name = (string)child.Name; } catch { continue; }
            int itemType = KindOf(child);

            if (itemType == ItemKind.Folder || itemType == ItemKind.LibraryManager)
            {
                var nested = string.IsNullOrEmpty(folderPath) ? name : $"{folderPath}/{name}";
                WalkInner(child, nested, items);
                continue;
            }
            if (ItemKind.IsInlinedInPou(itemType)) continue;

            int childCount = 0;
            try { childCount = (int)child.ChildCount; } catch { }
            bool isTopLevelCrud = ItemKind.IsTopLevelCrud(itemType);
            bool isHybrid = childCount > 0 && !isTopLevelCrud;
            string emitFolder = isHybrid ? (string.IsNullOrEmpty(folderPath) ? name : $"{folderPath}/{name}") : folderPath;

            items.Add(new ProjectItem(name, new ItemRef((object)child), itemType, isTopLevelCrud, emitFolder));
            if (isHybrid) WalkInner(child, emitFolder, items);
        }
    }

    private void WalkIoDevices(List<ProjectItem> items)
    {
        if (_sysManager == null) return;
        dynamic tiid;
        try { tiid = _sysManager.LookupTreeItem("TIID"); } catch { return; }
        int count;
        try { count = (int)tiid.ChildCount; } catch { return; }
        for (int i = 1; i <= count; i++)
        {
            dynamic device;
            try { device = tiid.Child[i]; } catch { continue; }
            string name;
            try { name = (string)device.Name; } catch { continue; }
            items.Add(new ProjectItem(name, new ItemRef((object)device), KindOf(device), false, "I/O Devices"));
        }
    }

    public ItemRef? Lookup(string name)
    {
        var node = FindItemByName(PlcRoot(), name);
        return node == null ? null : new ItemRef((object)node);
    }

    private dynamic? FindItemByName(dynamic parent, string name)
    {
        // 1-based COM, bounded by ChildCount (0 for a leaf), so the loop never over-indexes.
        int count = (int)parent.ChildCount;
        for (int i = 1; i <= count; i++)
        {
            dynamic child = parent.Child[i];
            string childName = (string)child.Name ?? "";
            if (string.Equals(childName, name, StringComparison.OrdinalIgnoreCase) && ItemKind.IsTopLevelCrud(KindOf(child)))
                return child;
            if (KindOf(child) == ItemKind.Folder)
            {
                var found = FindItemByName(child, name);
                if (found != null) return found;
            }
        }
        return null;
    }

    public int ChildCount(ItemRef item) { try { return (int)((dynamic)item.Native).ChildCount; } catch { return 0; } }
    public ItemRef ChildAt(ItemRef parent, int index1Based) => new((object)((dynamic)parent.Native).Child[index1Based]);
    public ItemRef Parent(ItemRef item) => new((object)((dynamic)item.Native).Parent);
    public string Name(ItemRef item) => KindName(item.Native);
    public int KindCode(ItemRef item) => KindOf(item.Native);

    public ItemRef CreateChild(ItemRef parent, string name, int kindCode) =>
        new((object)((dynamic)parent.Native).CreateChild(name, kindCode, "", "ST"));
    public void Delete(ItemRef parent, string name) => ((dynamic)parent.Native).DeleteChild(name);
    public void Rename(ItemRef item, string newName) => ((dynamic)item.Native).Name = newName;

    // TwinCAT's native ItemType IS the vendor-neutral code; 0 (unknown) for an unclassifiable node → skipped.
    private static int KindOf(dynamic node) { try { return (int)node.ItemType; } catch { return 0; } }
    private static string KindName(object node) { try { return (string)((dynamic)node).Name ?? ""; } catch { return ""; } }
}
