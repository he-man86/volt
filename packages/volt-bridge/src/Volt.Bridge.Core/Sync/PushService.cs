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

        // Pre-apply snapshot: versions keyed by BARE IDE name (push ops use bare names).
        // Responses use FULL names (mat.FullName) — matches /refs and /fetch.
        var currentVersions = new Dictionary<string, string>();
        var itemCache = new Dictionary<string, (ItemRef Item, string Folder)>(StringComparer.OrdinalIgnoreCase);
        foreach (var it in ide.WalkItems())
        {
            var kind = ItemKind.Map(it.KindCode);
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
                return PushResponse.RejectedResult(
                    new List<PushConflict> { new() { Name = op.Name, Reason = ex.Message } },
                    currentProjectVersion);
            }
        }

        ide.FlushPendingWrites();

        // Cold re-walk for the receipt — bare-name keys for aggregate version (matches /refs),
        // full-name keys for the wire Items map.
        var receiptVersions = new Dictionary<string, string>();
        var receiptFullVersions = new Dictionary<string, string>();
        foreach (var it in ide.WalkItems())
        {
            var kind = ItemKind.Map(it.KindCode);
            if (kind == null) continue;
            var (version, mat) = Versioning.Materialize(ide, it.Name, kind, it.Item, it.Folder);
            receiptVersions[it.Name] = version;
            receiptFullVersions[mat.FullName] = version;
        }

        return PushResponse.AcceptedResult(Hasher.ComputeProjectVersion(receiptVersions), receiptFullVersions);
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
        var kind = ItemKind.Map(code);
        if (kind == null || !ItemKind.IsSourceKind(kind))
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
            if (pouVg)
            {
                // The language comes from the VG NETWORK header (FBD/LD). TC's CreateChild uses this
                // to set the implementation language at creation. CODESYS's create_pou has no
                // implementation-language parameter, so it falls through to default ST — the subsequent
                // GraphicalCode.Write sets the correct language via PLCopen import (the <FBD>/<LD>
                // wrapper element on the body dictates the IDE's POU language).
                var lang = VgBody.LanguageOf(impl) ?? "FBD";
                pou = ide.CreateChild(targetParent, name, itemType, lang ?? "ST");
                GraphicalCode.Write(ide, pou, impl, decl);
            }
            else
            {
                pou = ide.CreateChild(targetParent, name, itemType);
                // The COM reference from CreateChild is stale for interface items — re-find
                // before writing anything. Without this, WriteText and child creation fail.
                if (itemType == ItemKind.PlcItf && existing is null)
                    pou = FindChild(ide, targetParent, name) ?? pou;
                // Interfaces have no body — their methods/properties are created as separate
                // children. Writing implementation text on an interface node crashes TC COM.
                ide.WriteText(pou, decl, itemType == ItemKind.PlcItf ? null : impl);
            }
        }
        else
        {
            pou = existingPou;
            // Body-type guard (last line of defence): never overwrite an item with a MISMATCHED body format —
            // that silently corrupts/flattens the IDE's representation and loses code. The bridge owns FORMAT;
            // the LSP owns code correctness. Scoped to POUs (only they have graphical bodies; reading an
            // interface body crashes TC), decided from the safe KindCode classification, not a body read.
            if (ide.KindCode(existingPou) is ItemKind.PlcPouProg or ItemKind.PlcPouFunc or ItemKind.PlcPouFb)
            {
                var currentLang = ide.BodyLanguage(existingPou);   // null=textual; FBD/LD=editable; CFC/SFC=read-only
                if (currentLang is "CFC" or "SFC")
                    throw new BridgeException(400, "UNSUPPORTED",
                        $"'{name}' is a read-only {currentLang} body — edit it in the IDE, not via push.");
                if (currentLang is not null && !pouVg)
                    throw new BridgeException(400, "UNSUPPORTED",
                        $"'{name}' is a graphical {currentLang} body in the IDE — a textual push would overwrite it. " +
                        "Edit it in the IDE, or delete it first to replace it.");
                if (currentLang is null && pouVg)
                    throw new BridgeException(400, "UNSUPPORTED",
                        $"'{name}' is a textual body — graphical bodies are authored in the IDE, not created by push.");
            }
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

            var isInterface = itemType == ItemKind.PlcItf;
            var childKindCode = ChildKindToCode(child.Kind, isInterface);
            // TC requires the return type / data type as vInfo for interface children (not a body language).
            // CODESYS ignores the language parameter — it only needs the correct item type code.
            var childVInfo = isInterface ? (child.ReturnType ?? child.DataType) : null;
            var childItem = existingChild ?? ide.CreateChild(childParent, child.Name, childKindCode, childVInfo);
            // An action is body-only — it has no declaration (its "ACTION name" line is synthesized on
            // read, never persisted). Pass null so no declaration is written (TwinCAT rejects one).
            var childDecl = child.Kind == "action" ? null : child.Declaration;
            // Interface members are declaration-only — COM rejects ImplementationText on them.
            var childImpl = isInterface ? null : child.Implementation;
            ide.WriteText(childItem, childDecl, childImpl);

            if (child.Kind == "property")
            {
                // TC interface property references are stale after CreateChild — re-find.
                if (isInterface && existingChild is null)
                    childItem = FindChild(ide, childParent, child.Name) ?? childItem;

                var getCode = isInterface ? ItemKind.PlcItfPropGet : ItemKind.PlcPropGet;
                var setCode = isInterface ? ItemKind.PlcItfPropSet : ItemKind.PlcPropSet;
                if (child.Getter != null) EnsureAccessor(ide, childItem, "Get", getCode, child.Getter.Declaration, child.Getter.Implementation, isInterface);
                else RemoveChildIfPresent(ide, childItem, "Get");
                if (child.Setter != null) EnsureAccessor(ide, childItem, "Set", setCode, child.Setter.Declaration, child.Setter.Implementation, isInterface);
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
            if (s.Kind == ItemKind.PlcFolder) RemoveOrphanChildren(ide, s.Ref, keep);
        foreach (var s in snapshot)
            if (s.Kind != ItemKind.PlcFolder && ItemKind.IsInlinedInPou(s.Kind) && !keep.Contains(s.Name))
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
            if (string.Equals(ide.Name(child), name, StringComparison.OrdinalIgnoreCase) && ide.KindCode(child) == ItemKind.PlcFolder)
                return child;
        }
        return ide.CreateChild(parent, name, ItemKind.PlcFolder);
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

    private static void EnsureAccessor(IIdeDriver ide, ItemRef property, string name, int kindCode, string decl, string impl, bool isInterface = false)
    {
        var accessor = FindChild(ide, property, name) ?? ide.CreateChild(property, name, kindCode);
        // An INTERFACE property accessor is a bodiless stub: it only declares that a getter/setter exists,
        // with no declaration or implementation text. TwinCAT COM rejects DeclarationText/ImplementationText
        // writes on it and can HARD-CRASH the IDE (RPC 0x800706BE), so for interfaces we ensure the accessor
        // exists and write nothing — matching the proven Beckhoff reference (CreateInterfaceAccessors).
        if (!isInterface) ide.WriteText(accessor, decl, impl);
    }

    private static int PouKindToCode(string kind) => kind switch
    {
        "program" => ItemKind.PlcPouProg, "function" => ItemKind.PlcPouFunc, "function_block" => ItemKind.PlcPouFb,
        "enumeration" => ItemKind.PlcDutEnum, "structure" => ItemKind.PlcDutStruct, "gvl" => ItemKind.PlcGvl,
        "interface" => ItemKind.PlcItf, "union" => ItemKind.PlcDutUnion, "alias" => ItemKind.PlcDutAlias,
        // No fallback: an unrecognized top-level kind is a bug (a new kind missed here), not a Program.
        _ => throw new BridgeException(400, "BAD_REQUEST", $"unknown top-level kind '{kind}'"),
    };

    // The splitter only ever emits method/action/property as textual children; interface vs non-interface is
    // the isInterface flag (the parent's kind), NOT a distinct child-kind string — so there is no
    // "interface_method"/"interface_property" arm. An unknown kind throws rather than defaulting to action.
    private static int ChildKindToCode(string kind, bool isInterface = false) => kind switch
    {
        "method" => isInterface ? ItemKind.PlcItfMeth : ItemKind.PlcMethod,
        "action" => ItemKind.PlcAction,
        "property" => isInterface ? ItemKind.PlcItfProp : ItemKind.PlcProp,
        _ => throw new BridgeException(400, "BAD_REQUEST", $"unknown child kind '{kind}'"),
    };
}
