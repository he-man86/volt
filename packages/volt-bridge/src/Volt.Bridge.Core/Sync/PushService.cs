using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Bridge.Core.Graphical;
using Volt.Bridge.Core.Ide;
using Volt.Bridge.Core.Wire;
using Volt.Bridge.Core.Workspace;
using Volt.Bridge.Core.Workspace.SourceText;

namespace Volt.Bridge.Core.Sync;

/// <summary><c>/push</c>: apply a batch of create/update/delete/rename/move ops with optimistic
/// concurrency (per-item <c>ifVersion</c> + an optional project version), then return a fresh version
/// map from a cold re-walk so the receipt matches the next <c>/refs</c> exactly.</summary>
public static class PushService
{
    public static PushResponse Handle(IIdeDriver ide, PushRequest request)
    {
        if (!ide.IsConnected) throw BridgeException.PlcDisconnected();

        ide.FlushPendingWrites();

        // Pre-apply snapshot: current versions + a cache of the top-level CRUD items to write into.
        var currentVersions = new Dictionary<string, string>();
        var itemCache = new Dictionary<string, (ItemRef Item, string Folder)>(StringComparer.OrdinalIgnoreCase);
        foreach (var it in ide.WalkItems())
        {
            var kind = ItemKind.Map(it.KindCode, it.IsTopLevelCrud);
            if (kind == null) continue;
            var (version, _) = Versioning.Materialize(ide, it.Name, kind, it.Item, it.Folder);
            currentVersions[it.Name] = version;
            if (it.IsTopLevelCrud) itemCache[it.Name] = (it.Item, it.Folder);
        }

        var currentProjectVersion = Hasher.ComputeProjectVersion(currentVersions);
        var conflicts = DetectConflicts(request, currentVersions, currentProjectVersion);
        if (conflicts.Count > 0)
            return PushResponse.RejectedResult(conflicts, currentProjectVersion);

        var parent = ide.GetPlcProjectRoot();
        foreach (var op in request.Ops)
        {
            try { ApplyOp(ide, parent, itemCache, op); }
            catch (Exception ex)
            {
                // An apply failure becomes a clean per-op conflict rather than a 500 — the client sees
                // exactly which op failed and why.
                return PushResponse.RejectedResult(
                    new List<PushConflict> { new() { Name = op.Name, Reason = ex.Message } },
                    currentProjectVersion);
            }
        }

        ide.FlushPendingWrites();

        // Cold re-walk for the receipt — byte-for-byte how /refs builds it, so the version map the
        // client stores is EXACTLY what the next /refs returns (a recompute from the just-written items
        // reads their transiently-dirty state and drifts).
        var newVersions = new Dictionary<string, string>();
        foreach (var it in ide.WalkItems())
        {
            var kind = ItemKind.Map(it.KindCode, it.IsTopLevelCrud);
            if (kind == null) continue;
            newVersions[it.Name] = Versioning.Materialize(ide, it.Name, kind, it.Item, it.Folder).Version;
        }

        return PushResponse.AcceptedResult(Hasher.ComputeProjectVersion(newVersions), newVersions);
    }

    private static List<PushConflict> DetectConflicts(
        PushRequest request, Dictionary<string, string> currentVersions, string currentProjectVersion)
    {
        var conflicts = new List<PushConflict>();

        if (request.ExpectedProjectVersion != null && request.ExpectedProjectVersion != currentProjectVersion)
            conflicts.Add(new PushConflict
            {
                Name = "<project>", YourVersion = request.ExpectedProjectVersion,
                CurrentVersion = currentProjectVersion,
                Reason = "expected project version does not match current project version",
            });

        var pending = currentVersions.ToDictionary(kv => kv.Key, kv => (string?)kv.Value);
        foreach (var op in request.Ops)
        {
            var name = op.Name;
            var clientVersion = op.IfVersion;
            var currentVersion = pending.TryGetValue(name, out var v) ? v : null;

            if (op is PushItemOp)
            {
                if (clientVersion == null)
                {
                    if (currentVersion != null)
                        conflicts.Add(new PushConflict { Name = name, YourVersion = null, CurrentVersion = currentVersion, Reason = "expected to create new item but it already exists" });
                    else pending[name] = "";
                }
                else if (currentVersion != clientVersion)
                {
                    conflicts.Add(new PushConflict { Name = name, YourVersion = clientVersion, CurrentVersion = currentVersion, Reason = currentVersion == null ? "expected item to exist but it doesn't" : "item changed since you fetched its version" });
                }
            }
            else
            {
                if (clientVersion != null && currentVersion != clientVersion)
                    conflicts.Add(new PushConflict { Name = name, YourVersion = clientVersion, CurrentVersion = currentVersion, Reason = currentVersion == null ? "expected item to exist but it doesn't" : "item changed since you fetched its version" });
                else if (op is DeleteItemOp) pending.Remove(name);
                else if (op is RenameItemOp renameOp && renameOp.NewName != null) { pending.Remove(name); pending[renameOp.NewName] = ""; }
            }
        }
        return conflicts;
    }

    private static void ApplyOp(IIdeDriver ide, ItemRef parent,
        Dictionary<string, (ItemRef Item, string Folder)> itemCache, PushOp op)
    {
        var name = op.Name;
        ItemRef? existing = itemCache.TryGetValue(name, out var cached) ? cached.Item : ide.Lookup(name);

        switch (op)
        {
            case PushItemOp pushOp:
                ApplyPushItem(ide, parent, name, existing, pushOp);
                break;
            case DeleteItemOp when existing is { } del:
                ide.Delete(ide.Parent(del), name);
                break;
            case RenameItemOp { NewName: { } newName } when existing is { } ren:
                ide.Rename(ren, newName);
                break;
            case MoveItemOp { NewFolder: { } newFolder } when existing is { } mv:
                MoveItem(ide, parent, name, mv, newFolder);
                break;
        }
    }

    /// <summary>Move an item to a new folder by full-fidelity recreate (declaration + implementation +
    /// children), so a moved FB never loses its methods/actions/properties the way a text-only recreate
    /// would. Graphical bodies can't be recreated from scratch, so a move of a graphical item is REFUSED
    /// before any deletion rather than silently corrupting it — reorganize those in the IDE, then pull.</summary>
    private static void MoveItem(IIdeDriver ide, ItemRef parent, string name, ItemRef item, string newFolder)
    {
        var code = ide.KindCode(item);
        var kind = ItemKind.Map(code, ItemKind.IsTopLevelCrud(code));
        if (kind == null || !Materializer.IsSourceKind(kind))
            throw new BridgeException(400, "UNSUPPORTED", $"cannot move '{name}': only source items (POUs/DUTs/GVLs) can be moved");

        var src = Materializer.Materialize(ide, name, kind, item).Text;
        var split = StSplitter.SplitSt(src);
        if (VgBody.Is(split.PouImplementation) || split.Children.Any(c => VgBody.Is(c.Implementation)))
            throw new BridgeException(400, "UNSUPPORTED",
                $"cannot move graphical item '{name}' — reorganize it in the IDE, then pull");

        ide.Delete(ide.Parent(item), name);
        WriteItemFromSource(ide, parent, name, existing: null, src, newFolder);
    }

    private static void ApplyPushItem(IIdeDriver ide, ItemRef parent, string name, ItemRef? existing, PushItemOp pushOp)
    {
        var src = pushOp.SourceText ?? "";
        if (string.IsNullOrWhiteSpace(src))
            throw new BridgeException(400, "BAD_REQUEST", "pushItem missing 'sourceText'");
        WriteItemFromSource(ide, parent, name, existing, src, pushOp.Folder);
    }

    /// <summary>Create-or-update an item and its children from full canonical .st source. Shared by
    /// pushItem and the moveItem recreate, so both apply identical full-fidelity write semantics.</summary>
    private static void WriteItemFromSource(IIdeDriver ide, ItemRef parent, string name, ItemRef? existing, string src, string? folder)
    {
        var split = StSplitter.SplitSt(src);
        var decl = split.PouDeclaration ?? "";
        var impl = split.PouImplementation ?? "";
        var itemType = PouKindToCode(split.PouKind);
        var targetParent = ResolveFolder(ide, parent, folder);

        // A ROOT FBD/LD body IS the editable VG language (it leads with the NETWORK marker). Write it
        // back via the PLCopen transport. (Root CFC/SFC are read-only and never reach push.)
        var pouVg = VgBody.Is(impl);

        ItemRef pou;
        if (existing is not { } existingPou)
        {
            if (pouVg) throw new BridgeException(400, "UNSUPPORTED",
                $"cannot create graphical POU '{name}' from scratch — author it in the IDE, then pull");
            pou = ide.CreateChild(targetParent, name, itemType);
            ide.WriteText(pou, decl, impl);
        }
        else
        {
            pou = existingPou;
            if (pouVg) GraphicalCode.Write(ide, pou, impl, decl);
            else ide.WriteText(pou, decl, impl);
        }

        foreach (var child in split.Children)
        {
            var cimpl = child.Implementation;
            // Read-only graphical view (CFC/SFC) — never overwrite or create.
            if (VgBody.Is(cimpl) && !VgBody.IsEditable(VgBody.LanguageOf(cimpl))) continue;

            var childParent = ResolveFolder(ide, pou, child.Folder);
            var existingChild = FindChild(ide, childParent, child.Name);

            if (VgBody.Is(cimpl))
            {
                if (existingChild is not { } ec) throw new BridgeException(400, "UNSUPPORTED",
                    $"cannot create graphical child '{child.Name}' from scratch — author it in the IDE, then pull");
                GraphicalCode.Write(ide, ec, cimpl, decl);   // FB types from the enclosing POU's decl
                continue;
            }

            var childItem = existingChild ?? ide.CreateChild(childParent, child.Name, ChildKindToCode(child.Kind));
            // An action is body-only — it has no declaration (its "ACTION name" line is synthesized on
            // read, never persisted). Pass null so no declaration is written (TwinCAT rejects one).
            var childDecl = child.Kind == "action" ? null : child.Declaration;
            ide.WriteText(childItem, childDecl, child.Implementation);

            if (child.Kind == "property")
            {
                // Upsert the accessors present in the push; remove one that was dropped (GET-only ⇄ GET+SET).
                if (child.Getter != null) EnsureAccessor(ide, childItem, "Get", ItemKind.PropertyGet, child.Getter.Declaration, child.Getter.Implementation);
                else RemoveChildIfPresent(ide, childItem, "Get");
                if (child.Setter != null) EnsureAccessor(ide, childItem, "Set", ItemKind.PropertySet, child.Setter.Declaration, child.Setter.Implementation);
                else RemoveChildIfPresent(ide, childItem, "Set");
            }
        }

        // Delete children that no longer exist in the pushed source. The upsert loop above only ever
        // touches children PRESENT in the push, so without this a child removed in the workspace (a
        // deleted method/action/property) would orphan in the IDE and reappear on the next pull — the
        // workspace and IDE would silently diverge. Read-only graphical children stay in the pushed set
        // as %LANG placeholders, so they are kept, not deleted.
        //
        // Only for a textual root POU: a graphical (VG) body push goes through GraphicalCode.Write, which
        // deletes-and-reimports the object (staleing `pou`), and the VG sourceText carries no textual
        // child list to reconcile against — so child reconciliation doesn't apply there.
        if (!pouVg)
        {
            var keep = new HashSet<string>(split.Children.Select(c => c.Name), StringComparer.OrdinalIgnoreCase);
            RemoveOrphanChildren(ide, pou, keep);
        }
    }

    /// <summary>Walk the POU subtree and delete in-POU children (method/action/property/transition) whose
    /// name is not in <paramref name="keep"/>. Folders are descended (recursed first, so a deletion never
    /// invalidates a not-yet-visited folder handle); accessors live under properties and are handled
    /// per-property, not here, so we never recurse into a property.</summary>
    private static void RemoveOrphanChildren(IIdeDriver ide, ItemRef parent, ISet<string> keep)
    {
        var count = ide.ChildCount(parent);
        var snapshot = new List<(ItemRef Ref, int Kind, string Name)>();
        for (int i = 1; i <= count; i++)
        {
            var c = ide.ChildAt(parent, i);
            snapshot.Add((c, ide.KindCode(c), ide.Name(c)));
        }
        foreach (var s in snapshot)
            if (s.Kind == ItemKind.Folder) RemoveOrphanChildren(ide, s.Ref, keep);
        foreach (var s in snapshot)
            if (s.Kind != ItemKind.Folder && ItemKind.IsInlinedInPou(s.Kind) && !keep.Contains(s.Name))
                ide.Delete(parent, s.Name);
    }

    private static void RemoveChildIfPresent(IIdeDriver ide, ItemRef parent, string name)
    {
        if (FindChild(ide, parent, name) is not null) ide.Delete(parent, name);
    }

    private static ItemRef ResolveFolder(IIdeDriver ide, ItemRef parent, string? folder)
    {
        if (string.IsNullOrEmpty(folder)) return parent;
        var node = parent;
        foreach (var part in folder!.Split('/'))
            node = FindOrCreateFolder(ide, node, part);
        return node;
    }

    private static ItemRef FindOrCreateFolder(IIdeDriver ide, ItemRef parent, string name)
    {
        int count = ide.ChildCount(parent);
        for (int i = 1; i <= count; i++)
        {
            var child = ide.ChildAt(parent, i);
            if (string.Equals(ide.Name(child), name, StringComparison.OrdinalIgnoreCase) && ide.KindCode(child) == ItemKind.Folder)
                return child;
        }
        return ide.CreateChild(parent, name, ItemKind.Folder);
    }

    private static ItemRef? FindChild(IIdeDriver ide, ItemRef parent, string name)
    {
        int count = ide.ChildCount(parent);
        for (int i = 1; i <= count; i++)
        {
            var child = ide.ChildAt(parent, i);
            if (string.Equals(ide.Name(child), name, StringComparison.OrdinalIgnoreCase)) return child;
        }
        return null;
    }

    private static void EnsureAccessor(IIdeDriver ide, ItemRef property, string name, int kindCode, string decl, string impl)
    {
        var accessor = FindChild(ide, property, name) ?? ide.CreateChild(property, name, kindCode);
        ide.WriteText(accessor, decl, impl);
    }

    private static int PouKindToCode(string kind) => kind switch
    {
        "program" => ItemKind.Program, "function" => ItemKind.Function, "function_block" => ItemKind.FunctionBlock,
        "enumeration" => ItemKind.Enumeration, "structure" => ItemKind.Structure, "gvl" => ItemKind.Gvl,
        "interface" => ItemKind.Interface, "union" => ItemKind.Union, "alias" => ItemKind.Alias,
        _ => ItemKind.Program,
    };

    private static int ChildKindToCode(string kind) => kind switch
    {
        "method" => ItemKind.Method, "action" => ItemKind.Action, "property" => ItemKind.Property,
        _ => ItemKind.Action,
    };
}
