using VoltBridge.Core;
using VoltBridge.Core.Errors;
using VoltBridge.Core.Models;

namespace VoltBridge.Beckhoff;

public static class PushHandler
{
    public static PushResponse Handle(Adapters.BeckhoffAdapter adapter, PushRequest request)
    {
        if (!adapter.IsConnected) throw ErrorResponse.PlcDisconnectedException();

        adapter.FlushPendingWrites();

        var items = adapter.WalkAllItems();
        var currentVersions = new Dictionary<string, string>();
        var itemCache = new Dictionary<string, dynamic>(StringComparer.OrdinalIgnoreCase);
        foreach (var visit in items)
        {
            var kind = ItemTypes.Map(visit.ItemType, visit.IsTopLevelCrud);
            if (kind == null) continue;
            var version = Adapters.BeckhoffAdapter.ComputeItemVersion(visit.Item, visit.FolderPath ?? "");
            currentVersions[visit.Name] = version;
            if (visit.IsTopLevelCrud) itemCache[visit.Name] = visit.Item;
        }

        var currentProjectVersion = Adapters.BeckhoffAdapter.ComputeProjectVersion(currentVersions);
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

            if (op.Op == "pushItem")
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
                else if (op.Op == "deleteItem") pending.Remove(name);
                else if (op.Op == "renameItem" && op.NewName != null) { pending.Remove(name); pending[op.NewName] = ""; }
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

        var newItems = adapter.WalkAllItems();
        var newVersions = new Dictionary<string, string>();
        foreach (var v in newItems)
        {
            var kind = ItemTypes.Map(v.ItemType, v.IsTopLevelCrud);
            if (kind == null) continue;
            newVersions[v.Name] = Adapters.BeckhoffAdapter.ComputeItemVersion(v.Item, v.FolderPath ?? "");
        }

        return PushResponse.AcceptedResult(Adapters.BeckhoffAdapter.ComputeProjectVersion(newVersions), newVersions);
    }

    private static void ApplyOp(Adapters.BeckhoffAdapter adapter, dynamic parent,
        Dictionary<string, dynamic> itemCache, PushOp op)
    {
        var name = op.Name ?? "";
        var existing = itemCache.TryGetValue(name, out var cached) ? cached : adapter.LookupItemByName(name);

        if (op.Op == "pushItem")
        {
            var src = op.SourceText ?? "";
            if (string.IsNullOrWhiteSpace(src))
                throw new BridgeException(400, "BAD_REQUEST", "pushItem missing 'sourceText'");
            var split = StSplitter.SplitSt(src);
            var decl = split.PouDeclaration ?? "";
            var impl = split.PouImplementation ?? "";
            var itemType = MapPouKindToItemType(split.PouKind);
            var folder = op.Folder;

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

            // Create/update children (methods, actions, properties)
            foreach (var child in split.Children)
            {
                var childType = MapChildKindToItemType(child.Kind);
                dynamic childParent = po;

                if (!string.IsNullOrEmpty(child.Folder))
                {
                    foreach (var part in child.Folder.Split('/'))
                        childParent = FindOrCreateFolder(childParent, part);
                }

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
        else if (op.Op == "deleteItem")
        {
            if (existing != null)
                try { adapter.DeleteChild(GetParent(existing), name); } catch { }
        }
        else if (op.Op == "renameItem")
        {
            if (existing != null && op.NewName != null)
                adapter.RenameItem(existing, op.NewName);
        }
        else if (op.Op == "moveItem")
        {
            if (existing != null && op.NewFolder != null)
            {
                var decl = Adapters.BeckhoffAdapter.ReadDeclaration(existing);
                var impl = Adapters.BeckhoffAdapter.ReadImplementation(existing);
                var itype = Adapters.BeckhoffAdapter.GetItemType(existing);
                try { adapter.DeleteChild(GetParent(existing), name); } catch { }
                dynamic tp = parent;
                foreach (var part in op.NewFolder.Split('/'))
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

    private static dynamic? FindChildByName(Adapters.BeckhoffAdapter adapter, dynamic parent, string name)
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

    private static void EnsureAccessor(Adapters.BeckhoffAdapter adapter, dynamic property, string kind,
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
