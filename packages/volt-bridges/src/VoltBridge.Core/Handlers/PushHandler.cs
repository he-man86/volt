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

        // Build the receipt with a fresh walk — byte-for-byte how /refs (RefsHandler)
        // builds it — so the version map the client stores is EXACTLY what the next
        // getRefs returns. Two reasons this must be a cold re-walk, not a recompute from
        // the pre-applied `itemCache`:
        //   1. itemCache only holds IsTopLevelCrud source POUs, so it would omit every
        //      read-only item (libraries, visus, image pools) → the client loses them
        //      from state.items → phantom "added" drift on the next status.
        //   2. Recomputing from the cached, just-written item references reads each POU
        //      from its transiently-dirty post-write state; for large POUs that differs
        //      from a cold read, so the receipt records versions getRefs won't match
        //      → phantom "M" drift on every push. (Verified live: a cold /refs is stable
        //      across a push; the post-write recompute is not.)
        var newVersions = new Dictionary<string, string>();
        foreach (var visit in adapter.WalkAllItems())
        {
            var kind = adapter.MapItemType(visit.ItemType, visit.IsTopLevelCrud);
            if (kind == null) continue;
            newVersions[visit.Name] = adapter.ComputeItemVersion(visit.Item, visit.FolderPath ?? "");
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
                    targetParent = FindOrCreateFolder(adapter, targetParent, part);
            }

            // A graphical POU body carries the (* @volt-graphical: LANG [vg] *) marker. With the
            // `vg` tag it is the EDITABLE VG language — parse it and write it back through the IDE's
            // PLCopen import. Without the tag it is a read-only view (ST / CFC / SFC) — never written.
            var pouMarked = IsGraphicalMarked(impl);

            dynamic po;
            if (existing == null)
            {
                if (pouMarked) return;   // creating a graphical POU from scratch is not supported yet
                po = adapter.CreateChild(targetParent, name, itemType);
                adapter.WriteSourceText(po, decl, impl);
            }
            else
            {
                po = existing;
                if (IsVgMarked(impl)) adapter.WriteGraphicalBody(existing, ExtractVg(impl), decl);
                else if (!pouMarked) adapter.WriteSourceText(existing, decl, impl);
            }

            foreach (var child in split.Children)
            {
                var cimpl = child.Implementation as string;
                // Read-only graphical view (ST / CFC / SFC, no `vg` tag) — never overwrite.
                if (IsGraphicalMarked(cimpl) && !IsVgMarked(cimpl)) continue;

                var childType = MapChildKindToItemType(child.Kind);
                dynamic childParent = po;
                if (!string.IsNullOrEmpty(child.Folder))
                    foreach (var part in child.Folder.Split('/'))
                        childParent = FindOrCreateFolder(adapter, childParent, part);

                // Look for the existing child under its ACTUAL parent (the sub-folder),
                // not the POU root — otherwise a sub-foldered action/method isn't found on
                // an update and we'd try to re-create it, which the IDE rejects as a
                // duplicate ("an object with the name '…' already exists").
                dynamic? existingChild = FindChildByName(adapter, childParent, child.Name);

                // Editable VG graphical child → write through the IDE's PLCopen import. FB instance
                // types come from the enclosing POU's declaration (the action shares its VARs).
                if (IsVgMarked(cimpl))
                {
                    if (existingChild != null) adapter.WriteGraphicalBody(existingChild, ExtractVg(cimpl!), decl);
                    continue;   // creating a graphical child from scratch is not supported yet
                }

                dynamic childItem = existingChild ?? adapter.CreateChild(childParent, child.Name, childType);
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
                try { adapter.DeleteChild(adapter.GetParent(existing), name); } catch { }
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
                try { adapter.DeleteChild(adapter.GetParent(existing), name); } catch { }
                dynamic tp = parent;
                foreach (var part in moveOp.NewFolder.Split('/'))
                    tp = FindOrCreateFolder(adapter, tp, part);
                var created = adapter.CreateChild(tp, name, itype);
                adapter.WriteSourceText(created, decl, impl);
            }
        }
    }

    private static dynamic FindOrCreateFolder(IAdapter adapter, dynamic parent, string name)
    {
        int count;
        try { count = adapter.GetChildCount(parent); } catch { count = 0; }
        for (int i = 1; i <= count; i++)
        {
            dynamic child;
            try { child = adapter.GetChildAt(parent, i); } catch { continue; }
            string childName;
            try { childName = adapter.GetItemName(child); } catch { continue; }
            if (string.Equals(childName, name, StringComparison.OrdinalIgnoreCase) && adapter.GetItemType(child) == 601)
                return child;
        }
        return adapter.CreateChild(parent, name, 601);
    }

    private static dynamic? FindChildByName(IAdapter adapter, dynamic parent, string name)
    {
        int count;
        try { count = adapter.GetChildCount(parent); } catch { return null; }
        for (int i = 1; i <= count; i++)
        {
            dynamic child;
            try { child = adapter.GetChildAt(parent, i); } catch { continue; }
            string childName;
            try { childName = adapter.GetItemName(child); } catch { continue; }
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

    // ── @volt-graphical marker helpers ──────────────────────────────────
    private static bool IsGraphicalMarked(string? impl)
        => impl != null && impl.TrimStart().StartsWith("(* @volt-graphical:", StringComparison.Ordinal);

    /// <summary>True when the marker carries the <c>vg</c> format tag — an EDITABLE body that push
    /// round-trips (vs. a read-only ST/CFC/SFC view).</summary>
    private static bool IsVgMarked(string? impl)
    {
        if (!IsGraphicalMarked(impl)) return false;
        var firstLine = impl!.TrimStart();
        var nl = firstLine.IndexOf('\n');
        if (nl >= 0) firstLine = firstLine.Substring(0, nl);
        return firstLine.Contains(" vg *)");
    }

    /// <summary>The VG body — everything after the marker line.</summary>
    private static string ExtractVg(string impl)
    {
        var t = impl.TrimStart();
        var nl = t.IndexOf('\n');
        return nl < 0 ? "" : t.Substring(nl + 1);
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
}
