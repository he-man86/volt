using VoltBridge.Core;
using VoltBridge.Core.Errors;
using VoltBridge.Core.Models;

namespace VoltBridge.Core.Handlers;

public static class PushHandler
{
    public static PushResponse Handle(IAdapter adapter, PushRequest request)
    {
        if (!adapter.IsConnected) throw ErrorResponse.PlcDisconnectedException();

        adapter.FlushPendingWrites();

        var items = adapter.WalkAllItems();
        var currentVersions = new Dictionary<string, string>();
        var itemCache = new Dictionary<string, (dynamic item, string folder)>(StringComparer.OrdinalIgnoreCase);
        foreach (var visit in items)
        {
            var kind = adapter.MapItemType(visit.ItemType, visit.IsTopLevelCrud);
            if (kind == null) continue;
            var version = adapter.ComputeItemVersion(visit.Item, visit.FolderPath ?? "");
            currentVersions[visit.Name] = version;
            if (visit.IsTopLevelCrud) itemCache[visit.Name] = (visit.Item, visit.FolderPath ?? "");
        }

        var currentProjectVersion = adapter.ComputeProjectVersion(currentVersions);
        var conflicts = new List<PushConflict>();

        if (request.ExpectedProjectVersion != null && request.ExpectedProjectVersion != currentProjectVersion)
        {
            conflicts.Add(new PushConflict
            {
                Name = "<project>", YourVersion = request.ExpectedProjectVersion,
                CurrentVersion = currentProjectVersion,
                Reason = "expected project version does not match current project version",
            });
        }

        var pending = currentVersions.ToDictionary(kv => kv.Key, kv => (string?)kv.Value);

        foreach (var op in request.Ops)
        {
            var name = op.Name ?? "";
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

        if (conflicts.Count > 0)
            return PushResponse.RejectedResult(conflicts, currentProjectVersion);

        var parent = adapter.GetPlcProjectRoot();
        foreach (var op in request.Ops)
        {
            try { ApplyOp(adapter, parent, itemCache, op); }
            catch (Exception ex)
            {
                return PushResponse.RejectedResult(
                    new List<PushConflict> { new PushConflict { Name = op.Name ?? "<op>", Reason = ex.Message } },
                    currentProjectVersion);
            }
        }

        adapter.FlushPendingWrites();

        var deletedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var newItems = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var op in request.Ops)
        {
            var name = op.Name ?? "";
            if (op is DeleteItemOp) { deletedNames.Add(name); }
            else if (op is PushItemOp pushOp && !itemCache.ContainsKey(name))
            {
                newItems[name] = pushOp.Folder ?? "";
            }
            else if (op is RenameItemOp renameOp && renameOp.NewName != null)
            {
                deletedNames.Add(name);
                var folder = itemCache.TryGetValue(name, out var oldCached) ? oldCached.folder : "";
                itemCache.Remove(name);
                if (oldCached.item != null) itemCache[renameOp.NewName] = (oldCached.item, folder);
            }
            else if (op is MoveItemOp moveOp)
            {
                deletedNames.Add(name);
                newItems[name] = moveOp.NewFolder ?? "";
            }
        }

        var newVersions = new Dictionary<string, string>();
        foreach (var kv in itemCache)
        {
            if (deletedNames.Contains(kv.Key)) continue;
            newVersions[kv.Key] = adapter.ComputeItemVersion(kv.Value.item, kv.Value.folder);
        }
        foreach (var kv in newItems)
        {
            var found = adapter.LookupItemByName(kv.Key);
            if (found != null)
                newVersions[kv.Key] = adapter.ComputeItemVersion(found, kv.Value);
        }

        return PushResponse.AcceptedResult(adapter.ComputeProjectVersion(newVersions), newVersions);
    }

    private static void ApplyOp(IAdapter adapter, dynamic parent,
        Dictionary<string, (dynamic item, string folder)> itemCache, PushOp op)
    {
        var name = op.Name ?? "";
        var existing = itemCache.TryGetValue(name, out var cached) ? cached.item : adapter.LookupItemByName(name);

        if (op is PushItemOp pushOp)
        {
            var src = pushOp.SourceText ?? "";
            if (string.IsNullOrWhiteSpace(src))
                throw new BridgeException(400, "BAD_REQUEST", "pushItem missing 'sourceText'");
            var split = StSplitter.SplitSt(src);
            var decl = split.PouDeclaration ?? "";
            var impl = split.PouImplementation ?? "";
            var itemType = MapPouKindToItemType(split.PouKind);
            var folder = pushOp.Folder;

            dynamic targetParent = parent;
            if (!string.IsNullOrEmpty(folder))
            {
                foreach (var part in folder.Split('/'))
                    targetParent = FindOrCreateFolder(targetParent, part);
            }

            dynamic po;
            if (existing == null)
            {
                po = adapter.CreateChild(targetParent, name, itemType);
                adapter.WriteSourceText(po, decl, impl);
            }
            else
            {
                po = existing;
                adapter.WriteSourceText(existing, decl, impl);
            }

            foreach (var child in split.Children)
            {
                var childType = MapChildKindToItemType(child.Kind);
                dynamic childParent = po;
                if (!string.IsNullOrEmpty(child.Folder))
                    foreach (var part in child.Folder.Split('/'))
                        childParent = FindOrCreateFolder(childParent, part);

                dynamic? existingChild = FindChildByName(adapter, po, child.Name);
                dynamic childItem;
                if (existingChild == null)
                    childItem = adapter.CreateChild(childParent, child.Name, childType);
                else
                    childItem = existingChild;

                adapter.WriteSourceText(childItem, child.Declaration, child.Implementation);

                if (child.Kind == "property")
                {
                    if (child.Getter != null)
                        EnsureAccessor(adapter, childItem, "Get", 613, child.Getter.Declaration, child.Getter.Implementation);
                    if (child.Setter != null)
                        EnsureAccessor(adapter, childItem, "Set", 614, child.Setter.Declaration, child.Setter.Implementation);
                }
            }
        }
        else if (op is DeleteItemOp)
        {
            if (existing != null)
                try { adapter.DeleteChild(GetParent(existing), name); } catch { }
        }
        else if (op is RenameItemOp renameOp)
        {
            if (existing != null && renameOp.NewName != null)
                adapter.RenameItem(existing, renameOp.NewName);
        }
        else if (op is MoveItemOp moveOp)
        {
            if (existing != null && moveOp.NewFolder != null)
            {
                var decl = adapter.ReadDeclaration(existing);
                var impl = adapter.ReadImplementation(existing);
                var itype = adapter.GetItemType(existing);
                try { adapter.DeleteChild(GetParent(existing), name); } catch { }
                dynamic tp = parent;
                foreach (var part in moveOp.NewFolder.Split('/'))
                    tp = FindOrCreateFolder(tp, part);
                var created = adapter.CreateChild(tp, name, itype);
                adapter.WriteSourceText(created, decl, impl);
            }
        }
    }

    private static dynamic FindOrCreateFolder(dynamic parent, string name)
    {
        for (int i = 1; ; i++)
        {
            dynamic child;
            try { child = parent.Child[i]; } catch { break; }
            string childName;
            try { childName = (string)child.Name; } catch { continue; }
            if (string.Equals(childName, name, StringComparison.OrdinalIgnoreCase))
            {
                int itemType;
                try { itemType = (int)child.ItemType; } catch { itemType = 0; }
                if (itemType == 601) return child;
            }
        }
        return parent.CreateChild(name, 601, "", null);
    }

    private static dynamic? FindChildByName(IAdapter adapter, dynamic parent, string name)
    {
        int count;
        try { count = (int)parent.ChildCount; } catch { return null; }
        for (int i = 1; i <= count; i++)
        {
            dynamic child;
            try { child = parent.Child[i]; } catch { continue; }
            string childName;
            try { childName = (string)child.Name; } catch { continue; }
            if (string.Equals(childName, name, StringComparison.OrdinalIgnoreCase)) return child;
        }
        return null;
    }

    private static void EnsureAccessor(IAdapter adapter, dynamic property, string kind,
        int itemType, string decl, string impl)
    {
        var existing = FindChildByName(adapter, property, kind);
        dynamic acc;
        if (existing == null)
            acc = adapter.CreateChild(property, kind, itemType);
        else
            acc = existing;
        adapter.WriteSourceText(acc, decl, impl);
    }

    private static int MapPouKindToItemType(string kind) => kind switch
    {
        "program" => 602, "function" => 603, "function_block" => 604,
        "enumeration" => 605, "structure" => 606, "gvl" => 615, "interface" => 618,
        _ => 602,
    };

    private static int MapChildKindToItemType(string kind) => kind switch
    {
        "method" => 609, "action" => 608, "property" => 611, _ => 608,
    };

    private static dynamic GetParent(dynamic item) => item.Parent;
}
