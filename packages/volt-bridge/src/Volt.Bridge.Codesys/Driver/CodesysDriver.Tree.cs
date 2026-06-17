using System;
using System.Collections.Generic;
using Volt.Bridge.Core.Ide;
using Volt.Bridge.Core.Workspace;

namespace Volt.Bridge.Codesys;

/// <summary>CODESYS driver — the <see cref="IProjectTree"/> facet: walk the object-model tree and
/// classify/CRUD nodes. <see cref="ItemRef"/> wraps a raw object-model node (or a synthetic
/// <c>LibRefNode</c> for a library reference).</summary>
public sealed partial class CodesysDriver
{
    public IReadOnlyList<ProjectItem> WalkItems()
    {
        var items = new List<ProjectItem>();
        var root = _om.PrimaryProject;
        if (root != null) Walk(root, "", items);
        return items;
    }

    private void Walk(object node, string folderPath, List<ProjectItem> items)
    {
        foreach (var child in _om.GetChildren(node))
        {
            var name = _om.GetName(child);
            var code = KindCodeOf(child);

            if (code == ItemKind.Folder)
            {
                var nested = string.IsNullOrEmpty(folderPath) ? name : $"{folderPath}/{name}";
                Walk(child, nested, items);
                continue;
            }
            // Device / Plc Logic / Application / Task Configuration: descend without adding to the path.
            if (CodesysTypeMap.IsRecurseOnlyContainer(code)) { Walk(child, folderPath, items); continue; }
            if (CodesysTypeMap.IsSkipped(code)) continue;       // transient/hidden/unknown
            if (ItemKind.IsInlinedInPou(code)) continue;        // collected inside the POU

            items.Add(new ProjectItem(name, new ItemRef(child), code, ItemKind.IsTopLevelCrud(code), folderPath));

            // The Library Manager additionally yields its individual library references as flat items.
            if (code == ItemKind.LibraryManager)
                foreach (var lib in _om.GetLibraryRefs(child))
                    items.Add(new ProjectItem(lib.Name, new ItemRef(lib), ItemKind.Library, false, folderPath));
        }
    }

    public ItemRef GetPlcProjectRoot() =>
        new(_om.FindApplication() ?? throw new InvalidOperationException("CODESYS: no Application found in project"));

    public ItemRef? Lookup(string name)
    {
        var node = _om.FindByName(name);
        return node == null ? null : new ItemRef(node);
    }

    public int ChildCount(ItemRef item) => _om.GetChildren(item.Native).Count;
    public ItemRef ChildAt(ItemRef parent, int index1Based) => new(_om.GetChildren(parent.Native)[index1Based - 1]);
    public ItemRef Parent(ItemRef item) => new(_om.ParentOf(item.Native)!);
    public string Name(ItemRef item) => item.Native is LibRefNode lib ? lib.Name : _om.GetName(item.Native);
    public int KindCode(ItemRef item) => KindCodeOf(item.Native);
    public ItemRef CreateChild(ItemRef parent, string name, int kindCode, string? language = null) => new(_om.CreateChild(parent.Native, name, kindCode, language));
    public void Delete(ItemRef parent, string name) => _om.DeleteChild(parent.Native, name);
    public void Rename(ItemRef item, string newName) => _om.Rename(item.Native, newName);

    private int KindCodeOf(object node)
    {
        if (node is LibRefNode) return ItemKind.Library;
        if (_om.IsFolder(node)) return ItemKind.Folder;
        var iobj = _om.ReadObject(node);
        var ifaces = _om.ObjectInterfaceNames(iobj);
        string? decl = ifaces.Contains("IPOUObject") || ifaces.Contains("IDUTObject")
            ? CodesysObjectModel.ReadAspectText(iobj, "Interface") : null;
        return CodesysTypeMap.CodeForObject(ifaces, false, _om.GetName(node), decl);
    }
}
