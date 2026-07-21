using System;
using System.Collections.Generic;
using Volt.Engine.Diagnostics;
using Volt.Engine.Ide;
using Volt.Engine.Workspace;
using Volt.Engine.Workspace.SourceText;

namespace Volt.Cli.Ide.Twincat;

/// <summary>Beckhoff driver — the <see cref="IProjectTree"/> facet: the walk/lookup/CRUD ALGORITHM over
/// the TwinCAT tree. The raw COM moves (child access, name, item-type, create/delete/rename) go through
/// <see cref="TcObjectModel"/>; <see cref="ItemRef"/> wraps an opaque COM tree item (no <c>dynamic</c>
/// here). The per-node try/catch is the walk's own defence against a COM node that faults mid-walk.</summary>
public sealed partial class BeckhoffDriver
{
    public ItemRef GetPlcProjectRoot() => new(_om.PlcRoot());

    // TwinCAT's walk starts AT the PLC project root (folder paths are relative to it), so the tree root and the
    // PLC-project root are the same node — full and relative toFolder coincide, and this stays a no-op vs CODESYS.
    public ItemRef GetTreeRoot() => new(_om.PlcRoot());

    public IReadOnlyList<ProjectItem> WalkItems()
    {
        var items = new List<ProjectItem>();
        WalkInner(_om.PlcRoot(), "", items);
        WalkIoDevices(items);
        return items;
    }

    private void WalkInner(object node, string folderPath, List<ProjectItem> items)
    {
        // A COM node that faults mid-walk is skipped (never break the whole walk) — but LOG it (Debug, so a
        // healthy project stays quiet) so a silently-dropped item is diagnosable. A swallowed materialize error
        // like this once hid a real read bug (FB-with-method / interface) for a long time.
        int count;
        try { count = _om.ChildCount(node); } catch (Exception ex) { VoltLog.Debug($"walk: ChildCount faulted at folder='{folderPath}': {ex.Message}"); return; }
        for (int i = 1; i <= count; i++)
        {
            object child;
            try { child = _om.ChildAt(node, i); } catch (Exception ex) { VoltLog.Debug($"walk: ChildAt({i}) faulted at folder='{folderPath}': {ex.Message}"); continue; }
            string name;
            try { name = _om.GetName(child); } catch (Exception ex) { VoltLog.Debug($"walk: GetName faulted at folder='{folderPath}' index={i}: {ex.Message}"); continue; }
            int itemType = ClassifiedKind(child);

            // A plain folder OR a container-manager (library / recipe / visualization manager) is a FOLDER, not a
            // file: recurse its children under a folder named after it, emit no item for the container itself.
            // (The library manager was already handled this way; container-managers now share one rule across
            // both drivers — the wire parity boundary.)
            if (itemType == ItemKind.PlcFolder || ItemKind.IsContainerManager(itemType))
            {
                var nested = FolderPath.Append(folderPath, name);
                WalkInner(child, nested, items);
                continue;
            }
            if (ItemKind.IsInlinedInPou(itemType)) continue;

            // Surface (once) a real PLC tree-item code we don't classify — a kind we may be missing. Logged,
            // NOT thrown: one unknown node must never break the walk. (Unknown=-2 read-failures aren't logged.)
            if (itemType > 0 && ItemKind.Map(itemType) is null)
                WarnUnmappedTcCode(itemType, name);

            int childCount = 0;
            try { childCount = _om.ChildCount(child); } catch { }
            bool isTopLevelCrud = ItemKind.IsTopLevelCrud(itemType);
            bool isHybrid = childCount > 0 && !isTopLevelCrud;
            string emitFolder = isHybrid ? FolderPath.Append(folderPath, name) : folderPath;

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
            // Encode the synthetic label like any other segment — "I/O Devices" carries a literal '/'.
            items.Add(new ProjectItem(name, new ItemRef(device), ClassifiedKind(device), false, FolderPath.Encode("I/O Devices")));
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
            if (_om.ItemType(child) == ItemKind.PlcFolder)
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

    // Enumerating an interface property's accessor COM children can hard-crash TwinCAT — read presence from the
    // enclosing interface's PLCopen export instead, which lists <GetAccessor>/<SetAccessor> under the property.
    public (bool getter, bool setter) InterfacePropertyAccessors(ItemRef property) =>
        Volt.Engine.Graphical.PlcOpenDocument.InterfacePropertyAccessors(
            _om.ExportPouXml(_om.Parent(property.Native)), _om.GetName(property.Native));

    // TwinCAT reports EVERY DUT as one tree type (623 = ItemKind.PlcDut) — a DUT is a single wire kind (`dut`),
    // so we emit the raw code as-is. The struct/enum/union/alias distinction is NOT computed on a read (its only
    // consumer was the four-way extension, now unified to `.dut`); it is derived from the declaration on push-
    // create only. This drops the per-DUT declaration read the walk used to pay.
    private int ClassifiedKind(object node) => _om.ItemType(node);

    private static readonly HashSet<int> _loggedTcCodes = new HashSet<int>();

    /// <summary>Log an unmapped TwinCAT PLC tree-item code once, so a kind we may be missing is visible.</summary>
    private static void WarnUnmappedTcCode(int code, string name)
    {
        bool isNew;
        lock (_loggedTcCodes) isNew = _loggedTcCodes.Add(code);
        if (isNew)
            Console.Error.WriteLine($"[bridge] unmapped TwinCAT TREEITEMTYPE {code} (skipped): example item='{name}' — add it to ItemKind if it should be tracked");
    }
}
