using System;
using System.Collections.Generic;
using Volt.Engine.Ide;
using Volt.Engine.Workspace;

namespace Volt.Cli.Ide.Codesys;

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

    // The walk mirrors the CODESYS project tree 1:1 into workspace paths. Every container — a user folder, a
    // structural node (PLC Logic / Application / Task Configuration), or a device — nests its children under its
    // own name, so the tree reads exactly as the IDE: Device → Plc Logic → Application → usercode, with the
    // hardware devices as siblings under Device. Nothing is flattened; the only per-kind logic is WHAT each leaf
    // emits (source text vs a device descriptor vs a library reference).
    private void Walk(object node, string folderPath, List<ProjectItem> items)
    {
        // Guard the child read: recursing an unclassified GenericContainer may reach an opaque subtree whose
        // children are unreadable — that must stop this branch, not crash the whole walk (matches Beckhoff).
        // Surface the failure (no-fallback policy) rather than swallowing it silently.
        IReadOnlyList<object> children;
        try { children = _om.GetChildren(node); }
        catch (Exception ex) { Console.Error.WriteLine($"[bridge] could not read children of a node (subtree skipped): {ex.Message}"); return; }
        foreach (var child in children)
        {
            var name = _om.GetName(child);
            var code = KindCodeOf(child);

            // A device-tree node (controller, fieldbus master, drive, axis, I/O module — all IDeviceObject): emit
            // a read-only `.device` descriptor and mirror its subtree. A device WITH children gets a folder named
            // after it and keeps its descriptor INSIDE that folder (Coupler_I_O_moduls/Coupler_I_O_moduls.device)
            // so the node reads together with its children; a childless leaf is a plain file at the parent level.
            if (code == ItemKind.Device)
            {
                var deviceFolder = FolderPath.Append(folderPath, name);
                var hasChildren = HasChildren(child);
                items.Add(new ProjectItem(name, new ItemRef(child), ItemKind.PlcDevice,
                    hasChildren ? deviceFolder : folderPath));
                if (hasChildren) Walk(child, deviceFolder, items);
                continue;
            }
            // Any other container — a user folder or a structural node (PLC Logic, Application, Task Configuration,
            // the SoftMotion "Kinematics" / drive "Functions" groupers) — nests its children under its own name.
            if (code == ItemKind.PlcFolder || CodesysTypeMap.IsRecurseOnlyContainer(code))
            {
                Walk(child, FolderPath.Append(folderPath, name), items);
                continue;
            }
            if (CodesysTypeMap.IsSkipped(code)) continue;       // transient/hidden/unknown
            if (ItemKind.IsInlinedInPou(code)) continue;        // collected inside the POU

            // A container-manager (library / recipe / visualization manager) is a FOLDER, not a file: it groups
            // its children and has no content of its own, so we emit NO stub item for it — only its children,
            // nested under a folder named after it. This matches the Beckhoff walk and fixes the redundant
            // `<Manager>.<kind>` stub (which also duplicated when two same-named managers exist at different tree
            // levels — e.g. a project-level and an Application-level "Library Manager").
            if (ItemKind.IsContainerManager(code))
            {
                var managerFolder = FolderPath.Append(folderPath, name);
                if (code == ItemKind.PlcLibMan)
                    // The library manager's children are SYNTHESIZED from ILibManObject (not tree children).
                    // A placeholder library's name can carry a Windows-illegal char (the '*' wildcard version,
                    // e.g. "SysTypes2 Interfaces, * (System)") — encode it so the .library file still materializes.
                    foreach (var lib in _om.GetLibraryRefs(child))
                        items.Add(new ProjectItem(FolderPath.EncodeName(lib.Name), new ItemRef(lib), ItemKind.PlcLibRef, managerFolder));
                else
                    // Recipe / visualization managers hold real tree children (recipe definitions, visualizations).
                    Walk(child, managerFolder, items);
                continue;
            }

            items.Add(new ProjectItem(name, new ItemRef(child), code, folderPath));
        }
    }

    public ItemRef GetPlcProjectRoot() =>
        new(_om.FindApplication() ?? throw new InvalidOperationException("CODESYS: no Application found in project"));

    // The walk starts here (PrimaryProject), so a full toFolder like "Device/Plc Logic/Application/POUs" resolves
    // by descending from the same origin — the structural nodes (Device/Plc Logic/Application) are matched, not
    // re-created as user folders under the Application (which doubled the path).
    public ItemRef GetTreeRoot() =>
        new(_om.PrimaryProject ?? throw new InvalidOperationException("CODESYS: no primary project"));

    public ItemRef? Lookup(string name)
    {
        var node = _om.FindByName(name);
        return node == null ? null : new ItemRef(node);
    }

    /// <summary>Does the node have any children? Guarded (an unreadable subtree ⇒ treat as a leaf) so the
    /// device-descriptor placement decision never crashes the walk.</summary>
    private bool HasChildren(object node)
    {
        try { return _om.GetChildren(node).Count > 0; } catch { return false; }
    }

    public int ChildCount(ItemRef item) => _om.GetChildren(item.Native).Count;
    public ItemRef ChildAt(ItemRef parent, int index1Based) => new(_om.GetChildren(parent.Native)[index1Based - 1]);
    public ItemRef Parent(ItemRef item) => new(_om.ParentOf(item.Native)!);
    public string Name(ItemRef item) => item.Native is LibRefNode lib ? lib.Name : _om.GetName(item.Native);
    public int KindCode(ItemRef item) => KindCodeOf(item.Native);

    // CODESYS enumerates an interface property's accessor children safely (in-process, no COM-RPC crash) —
    // read presence straight off their names.
    public (bool getter, bool setter) InterfacePropertyAccessors(ItemRef property)
    {
        bool getter = false, setter = false;
        foreach (var child in _om.GetChildren(property.Native))
        {
            var n = _om.GetName(child);
            if (string.Equals(n, "Get", StringComparison.OrdinalIgnoreCase)) getter = true;
            else if (string.Equals(n, "Set", StringComparison.OrdinalIgnoreCase)) setter = true;
        }
        return (getter, setter);
    }
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
