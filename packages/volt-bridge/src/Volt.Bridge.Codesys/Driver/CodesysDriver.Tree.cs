using System;
using System.Collections.Generic;
using Volt.Bridge.Core.Ide;
using Volt.Bridge.Core.Workspace;

namespace Volt.Bridge.Codesys;

/// <summary>CODESYS driver — the <see cref="IProjectTree"/> facet: walk the object-model tree and
/// classify/CRUD nodes. <see cref="ItemRef"/> wraps a raw object-model node (or a synthetic
/// <c>LibRefNode</c> for a library reference).</summary>
public sealed partial class CodesysDriver : IDebugIntrospect
{
    /// <summary>Diagnostic (/debug): the IObject interface names a node implements — the exact basis
    /// <c>CodesysTypeMap.CodeForObject</c> classifies on, so an Unknown node can be diagnosed from ground truth.</summary>
    public IReadOnlyList<string> TypeTags(ItemRef item)
    {
        if (item.Native is LibRefNode) return new[] { "LibRefNode" };
        var iobj = _om.ReadObject(item.Native);
        var names = new List<string>(_om.ObjectInterfaceNames(iobj));
        names.Sort(StringComparer.Ordinal);
        return names;
    }

    /// <summary>Diagnostic (/debug): effective exclude-from-build for a tree node plus the raw member probe.</summary>
    public string ExcludeFromBuildProbe(ItemRef item)
    {
        if (item.Native is LibRefNode) return "n/a (library ref)";
        return $"{_om.IsExcludedFromBuild(item.Native)} | {_om.ExcludeProbe(item.Native)}";
    }

    public IReadOnlyList<ProjectItem> WalkItems()
    {
        var items = new List<ProjectItem>();
        var root = _om.PrimaryProject;
        if (root != null) Walk(root, "", items);
        return items;
    }

    private void Walk(object node, string folderPath, List<ProjectItem> items)
    {
        // Guard the child read: recursing an unclassified GenericContainer may reach an opaque subtree whose
        // children are unreadable — that must stop this branch, not crash the whole walk (matches Beckhoff).
        IReadOnlyList<object> children;
        try { children = _om.GetChildren(node); } catch { return; }
        foreach (var child in children)
        {
            var name = _om.GetName(child);
            var code = KindCodeOf(child);

            if (code == ItemKind.PlcFolder)
            {
                var nested = string.IsNullOrEmpty(folderPath) ? name : $"{folderPath}/{name}";
                Walk(child, nested, items);
                continue;
            }
            // Device / Plc Logic / Application / Task Configuration: descend without adding to the path.
            if (CodesysTypeMap.IsRecurseOnlyContainer(code)) { Walk(child, folderPath, items); continue; }
            if (CodesysTypeMap.IsSkipped(code)) continue;       // transient/hidden/unknown
            if (ItemKind.IsInlinedInPou(code)) continue;        // collected inside the POU

            items.Add(new ProjectItem(name, new ItemRef(child), code, ItemKind.IsTopLevelCrud(code), folderPath, _om.IsExcludedFromBuild(child)));

            // The Library Manager additionally yields its individual library references as flat items.
            if (code == ItemKind.PlcLibMan)
                foreach (var lib in _om.GetLibraryRefs(child))
                    items.Add(new ProjectItem(lib.Name, new ItemRef(lib), ItemKind.PlcLibRef, false, folderPath));
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
        if (node is LibRefNode) return ItemKind.PlcLibRef;
        if (_om.IsFolder(node)) return ItemKind.PlcFolder;
        var iobj = _om.ReadObject(node);
        var ifaces = _om.ObjectInterfaceNames(iobj);
        // Read the Interface aspect only for kinds whose classification refines from the declaration —
        // CodesysTypeMap owns that list (NeedsDeclaration), so the two never drift.
        string? decl = CodesysTypeMap.NeedsDeclaration(ifaces) ? CodesysObjectModel.ReadAspectText(iobj, "Interface") : null;
        return CodesysTypeMap.CodeForObject(ifaces, false, _om.GetName(node), decl);
    }
}
