using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Volt.Engine.Graphical;
using Volt.Engine.Ide;
using Volt.Engine.Wire;
using Volt.Engine.Workspace;
using Volt.Engine.Workspace.SourceText;

using Volt.Cli.Transport;
using Volt.Engine.PlcOpen;

namespace Volt.Engine.Sync;

/// <summary><c>/push</c>: apply a batch of <c>set</c> (declarative create/update/rename/move) +
/// <c>delete</c> ops with optimistic concurrency (per-item <c>ifVersion</c> + an optional project
/// version), then return a fresh version map from a cold re-walk so the receipt matches the next
/// <c>/refs</c> exactly.</summary>
public static class PushService
{
    public static PushResponse Handle(IIdeDriver ide, PushRequest request, Action<ProgressFrame>? onProgress = null)
    {
        // Connected + right-project guard BEFORE any apply, regardless of Force — so `push --force` (which nulls
        // the version gate) still can't clobber the wrong IDE.
        OpGuard.RequireBoundProject(ide, request.ExpectedPlatform, request.ExpectedProjectName);

        var sw = Stopwatch.StartNew();
        ide.FlushPendingWrites();

        // Pre-apply snapshot: keyed by BARE IDE name because these maps mirror the IDE (which is
        // extension-less). The WIRE carries FULL names on every endpoint; op.Name is converted to bare at
        // the apply boundary via Materializer.Bare. Responses use FULL names (mat.FullName) — like /refs/fetch.
        // Pre-apply walk for conflict detection (per-item ifVersion guards) + the apply-boundary item cache.
        // `currentVersions` is deliberately UNGATED: per-item lookup/delete must see EVERY item (incl.
        // container-managers) so an op never misses one. But the PROJECT-level lease version MUST hash the same
        // gated set /refs/fetch/receipt use (ProjectSnapshot.IsTracked) — else a divergent gate makes the client
        // baseline mismatch the pre-apply hash and every push wrongly reports "pull first".
        var currentVersions = new Dictionary<string, string>();
        var gatedVersions = new Dictionary<string, string>();
        var itemCache = new Dictionary<string, (ItemRef Item, string Folder)>(StringComparer.OrdinalIgnoreCase);
        foreach (var it in ide.WalkItems())
        {
            var kind = ItemKind.Map(it.KindCode);
            if (kind == null) continue;
            // Resilient: a malformed item must not crash the push. It still gets a (sentinel) version and stays
            // in itemCache — its ItemRef comes from WalkItems, not the read — so it remains deletable.
            var version = Versioning.SafeVersion(ide, it.Name, kind, it.Item, it.Folder, out _);
            currentVersions[it.Name] = version;
            if (ProjectSnapshot.IsTracked(it.KindCode)) gatedVersions[it.Name] = version;
            if (ItemKind.IsTopLevelCrud(it.KindCode)) itemCache[it.Name] = (it.Item, it.Folder);
        }

        var currentProjectVersion = Hasher.ComputeProjectVersion(gatedVersions);
        var conflicts = DetectConflicts(request.Ops, request.ExpectedProjectVersion, request.Force, currentVersions, currentProjectVersion);
        if (conflicts.Count > 0)
        {
            VoltLog.Info($"push {request.Ops.Count} ops — REJECTED ({conflicts.Count} conflicts: {string.Join(", ", conflicts.Take(5).Select(c => c.Name))}{(conflicts.Count > 5 ? "..." : "")}) ({sw.ElapsedMilliseconds}ms)");
            return PushResponse.RejectedResult(conflicts, currentProjectVersion);
        }

        var parent = ide.GetPlcProjectRoot();
        var applied = new List<(string Action, string Name)>();  // what each op did, for the write receipt in the log
        var opTotal = request.Ops.Count;
        onProgress?.Invoke(new ProgressFrame { Operation = Ops.Push, Done = 0, Total = opTotal, Phase = "applying" });
        foreach (var op in request.Ops)
        {
            try { applied.Add((ApplyOp(ide, parent, itemCache, op), op.Name)); }
            catch (Exception ex)
            {
                // A structured VG diagnostic (parser / round-trip gate) carries a stable code + source line;
                // any other throw is reason-only.
                var vg = ex as Graphical.Vg.VgParseException;
                VoltLog.Info($"push {request.Ops.Count} ops — REJECTED ({op.Name}: {ex.Message}) ({sw.ElapsedMilliseconds}ms)");
                return PushResponse.RejectedResult(
                    new List<PushConflict> { new() { Name = op.Name, Reason = ex.Message, Code = vg?.Code, Line = vg?.Line } },
                    currentProjectVersion);
            }
            // Report AFTER applying (like FetchService), so the final frame carries Done == Total (100%).
            onProgress?.Invoke(new ProgressFrame { Operation = Ops.Push, Done = applied.Count, Total = opTotal });
        }

        ide.FlushPendingWrites();

        // The receipt is a FRESH FULL snapshot — the SAME walk /refs uses (ProjectSnapshot), NOT a reuse of the
        // pre-apply versions. A native rename rewrites the bodies of referencing items that are NOT in the op
        // set, so reusing their pre-apply versions would report a stale baseline; the client persists this
        // receipt as its IDE baseline with no follow-up /refs, so it must match /refs exactly.
        var receipt = ProjectSnapshot.Walk(ide, operation: "push-receipt");

        VoltLog.Info($"push {request.Ops.Count} ops — accepted [{FormatApplied(applied)}] ({receipt.FullVersions.Count} items) ({sw.ElapsedMilliseconds}ms)");
        return PushResponse.AcceptedResult(receipt.ProjectVersion, receipt.FullVersions, receipt.Folders);
    }

    /// <summary>The write receipt for the accepted-push log line: each applied op grouped by what it did to the
    /// item (created/updated/renamed/moved/deleted), with the item names — so the log answers "what files did
    /// this push change?". Names per group are capped so a bulk push stays one readable line.</summary>
    private static string FormatApplied(List<(string Action, string Name)> ops)
    {
        if (ops.Count == 0) return "no-op";
        return string.Join("; ", ops
            .GroupBy(o => o.Action, StringComparer.Ordinal)
            .OrderBy(g => g.Key, StringComparer.Ordinal)
            .Select(g =>
            {
                var names = g.Select(o => o.Name).ToList();
                var shown = string.Join(", ", names.Take(15));
                if (names.Count > 15) shown += $", +{names.Count - 15} more";
                return $"{g.Key}: {shown}";
            }));
    }

    private static List<PushConflict> DetectConflicts(
        List<PushOp> ops, string? expectedProjectVersion, bool force,
        Dictionary<string, string> currentVersions, string currentProjectVersion)
    {
        var conflicts = new List<PushConflict>();

        // The project-level gate runs regardless of force — it IS the --force-with-lease check.
        if (expectedProjectVersion != null && expectedProjectVersion != currentProjectVersion)
            conflicts.Add(new PushConflict
            {
                Name = "<project>", YourVersion = expectedProjectVersion,
                CurrentVersion = currentProjectVersion,
                Reason = "expected project version does not match current project version",
            });

        // Force skips the per-item ifVersion checks entirely (apply unconditionally); the project gate above still ran.
        if (force) return conflicts;

        // Forward simulation: name → version, mutated per op so in-batch dependencies validate. Every op
        // is a SetItemOp or a DeleteItemOp.
        var pending = currentVersions.ToDictionary(kv => kv.Key, kv => (string?)kv.Value);
        foreach (var op in ops)
        {
            var name = op.Name;                       // FULL wire name — echoed back in the conflict
            var bare = Materializer.Bare(name);       // the IDE/version-map key (bare-keyed)
            var clientVersion = op.IfVersion;
            var currentVersion = pending.TryGetValue(bare, out var v) ? v : null;

            if (op is SetItemOp set)
            {
                if (clientVersion == null)            // create
                {
                    if (currentVersion != null)
                        conflicts.Add(new PushConflict { Name = name, YourVersion = null, CurrentVersion = currentVersion, Reason = "expected to create new item but it already exists" });
                    else pending[bare] = "";
                }
                else if (currentVersion != clientVersion)   // update / rename / move guard
                {
                    conflicts.Add(VersionMismatch(name, clientVersion, currentVersion));
                }
                else if (set.ToName is { } toName && !string.Equals(Materializer.Bare(toName), bare, StringComparison.OrdinalIgnoreCase))
                {
                    pending.Remove(bare);             // rename: the new identity exists for later ops
                    pending[Materializer.Bare(toName)] = "";
                }
            }
            else                                      // DeleteItemOp
            {
                // Delete is idempotent: if the item is already gone (currentVersion == null) the goal state
                // already holds, so it's a no-op success — never a conflict, whatever the ifVersion guard. This
                // also covers the UNREADABLE-sentinel force-delete of an accepted-but-unenumerable item (absent
                // from /refs → currentVersion null here, but Apply still finds and removes it via ide.Lookup).
                // Only a version MISMATCH on a still-PRESENT item is a real conflict.
                if (currentVersion != null && clientVersion != null && currentVersion != clientVersion)
                    conflicts.Add(VersionMismatch(name, clientVersion, currentVersion));
                else pending.Remove(bare);
            }
        }
        return conflicts;
    }

    private static PushConflict VersionMismatch(string name, string? clientVersion, string? currentVersion) =>
        new() { Name = name, YourVersion = clientVersion, CurrentVersion = currentVersion,
                Reason = currentVersion == null ? "expected item to exist but it doesn't" : "item changed since you fetched its version" };

    /// <summary>Apply one op and return a short label of what it did (created/updated/renamed/moved/deleted),
    /// used only for the log receipt.</summary>
    private static string ApplyOp(IIdeDriver ide, ItemRef parent,
        Dictionary<string, (ItemRef Item, string Folder)> itemCache, PushOp op)
    {
        // The wire carries FULL names; the IDE is extensionless. Convert once, here, at the boundary.
        var name = Materializer.Bare(op.Name);
        var inCache = itemCache.TryGetValue(name, out var cached);
        ItemRef? existing = inCache ? cached.Item : ide.Lookup(name);
        var currentFolder = inCache ? cached.Folder : "";

        switch (op)
        {
            case SetItemOp set:
                return ApplySetItem(ide, parent, name, existing, currentFolder, set);
            case DeleteItemOp when existing is { } del:
                ide.Delete(ide.Parent(del), name);
                return "deleted";
            default:
                return "no-op";  // delete of an item that isn't there
        }
    }

    /// <summary>Apply one unified change. A rename uses the IDE's native rename (rewrites call-sites) and
    /// precedes a move; a move recreates in the new folder (name kept ⇒ name-based references survive); a
    /// content change goes through the shared full-fidelity writer. Each facet absent = unchanged.</summary>
    private static string ApplySetItem(IIdeDriver ide, ItemRef parent, string name, ItemRef? existing, string currentFolder, SetItemOp op)
    {
        if (op.SourceText is { } st && string.IsNullOrWhiteSpace(st))
            throw new BridgeException(BridgeErrorCodes.BadRequest, $"set '{op.Name}': sourceText is empty");

        // CREATE — no existing item; sourceText is required, toFolder is the placement.
        if (existing is not { } item)
        {
            if (op.SourceText is null)
                throw new BridgeException(BridgeErrorCodes.BadRequest, $"set '{op.Name}': a new item needs sourceText");
            WriteItemFromSource(ide, parent, name, existing: null, op.SourceText, op.ToFolder);
            return "created";
        }

        var currentName = name;
        var renamed = false;
        var toName = op.ToName is { } t ? Materializer.Bare(t) : null;
        if (toName != null && !string.Equals(toName, currentName, StringComparison.OrdinalIgnoreCase))
        {
            ide.Rename(item, toName);                  // native rename → IDE rewrites references
            currentName = toName;
            item = ide.Lookup(currentName) ?? item;    // refresh the (possibly staled) handle
            renamed = true;
        }

        // A non-empty toFolder that differs from the item's current folder is a MOVE; empty (or omitted) means
        // "keep the current folder" — never a move to the root — so an in-place edit that doesn't restate the
        // full tree path isn't misread as a move (and a graphical item isn't spuriously refused).
        if (op.ToFolder is { Length: > 0 } toFolder && !string.Equals(toFolder, currentFolder, StringComparison.OrdinalIgnoreCase))
        {
            MoveItem(ide, parent, currentName, item, toFolder, op.SourceText);       // recreate in the new folder
            return renamed ? "renamed+moved" : "moved";
        }
        if (op.SourceText is { } src)
        {
            WriteItemFromSource(ide, parent, currentName, item, src, currentFolder); // content update in place
            return renamed ? "renamed+updated" : "updated";
        }
        return renamed ? "renamed" : "no-op";          // rename-only (or a bare no-op set)
    }

    /// <summary>Move an item to another folder.
    /// <para><b>The real move</b> — <see cref="IProjectTree.Move"/> — where the driver has one: the IDE relocates
    /// the object whole, so nothing is read, deleted or rebuilt, and there is no window in which the item does not
    /// exist. A graphical item moves too, which the recreate below can never do.</para>
    /// <para><b>The recreate</b>, for a driver without a move: read the source, delete, re-create in the new
    /// folder, write the content back. Full-fidelity (children included) so a moved FB does not lose its members,
    /// but a graphical body cannot be rebuilt from text, so a graphical move is REFUSED before any deletion rather
    /// than silently corrupted.</para>
    /// <para>Both keep the NAME, so name-based references survive either way.</para></summary>
    private static void MoveItem(IIdeDriver ide, ItemRef parent, string name, ItemRef item, string newFolder, string? sourceText)
    {
        var code = ide.KindCode(item);
        var kind = ItemKind.Map(code);
        if (kind == null || !ItemKind.IsSourceKind(kind))
            throw new BridgeException(BridgeErrorCodes.Unsupported, $"cannot move '{name}': only source items (POUs/DUTs/GVLs) can be moved");

        // Gated on the same capability as the single-document write, because they are the same measurement: the
        // driver that merges a POU document is the driver that has `Move` (the merge FLATTENS child folders, so
        // `RestoreChildFolders` already depends on it — a driver without a move could not take that path at all).
        // One flag, both facts, deleted together when §5 measures TwinCAT.
        if (ide.WritesPouAsOneDocument)
        {
            ide.Move(item, ResolveTopLevelFolder(ide, parent, newFolder));
            if (sourceText is not { } edited) return;                  // pure move: the content never left
            var moved = ide.Lookup(name) ?? item;                      // refresh the (possibly staled) handle
            WriteItemFromSource(ide, parent, name, moved, edited, newFolder);   // move+edit → the in-place update
            return;
        }

        // The moved item's content: the push's new sourceText if it carried one (move+edit), else the item's
        // current source (pure move), read back for the full-fidelity recreate.
        var src = sourceText ?? Materializer.Materialize(ide, name, kind, item).Text;
        var split = StSplitter.SplitSt(src);
        if (VgBody.Is(split.PouImplementation) || split.Children.Any(c => VgBody.Is(c.Implementation)))
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"cannot move graphical item '{name}' — reorganize it in the IDE, then pull");

        ide.Delete(ide.Parent(item), name);
        WriteItemFromSource(ide, parent, name, existing: null, src, newFolder);
    }

    /// <summary>Create-or-update an item and its children from full canonical ST source. Shared by the
    /// set create/update path and the move recreate, so both apply identical full-fidelity write semantics.</summary>
    private static void WriteItemFromSource(IIdeDriver ide, ItemRef parent, string name, ItemRef? existing, string src, string? folder)
    {
        var split = StSplitter.SplitSt(src);

        // Children (method/action/property) are keyed by name, so two children sharing a name would silently
        // collapse: the second's CreateChild finds the first and WriteText overwrites it, losing a source item
        // while the push still reports accepted. The IDE itself can't hold two same-name children (an unmarked
        // overload). Reject the push with a clear reason instead of dropping code. This is NOT the top-level
        // opaque-item name invariant (which forbids a throwing dup guard because real projects repeat opaque
        // names) — it is duplicate children WITHIN one pushed source, which is unambiguously invalid.
        var dupChild = split.Children
            .GroupBy(c => c.Name, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault(g => g.Count() > 1);
        if (dupChild != null)
            throw new BridgeException(BridgeErrorCodes.DuplicateChild,
                $"'{name}' declares more than one child named '{dupChild.Key}' — a duplicate method/action/property " +
                "name is not representable (the IDE keys children by name; the duplicate would silently overwrite). " +
                "Rename or remove the duplicate.");

        var decl = split.PouDeclaration;
        var impl = split.PouImplementation;
        var itemType = PouKindToCode(split.PouKind);
        // Only POUs (program/function/function_block) have an implementation-body slot. DUTs, GVLs and
        // interfaces don't — pass NULL so WriteText leaves the (nonexistent) impl untouched; writing text to
        // a slot the COM object doesn't expose crashes TwinCAT. A POU with an EMPTY body still passes "" so
        // the body is CLEARED (TcObjectModel.WriteText / CodesysObjectModel.WriteSourceText write on non-null).
        var bodyImpl = split.PouKind is ItemKind.Kinds.Program or ItemKind.Kinds.Function or ItemKind.Kinds.FunctionBlock ? impl : (string?)null;

        // A ROOT FBD/LD body IS the editable VG language (it leads with the NETWORK marker). Write it
        // back via the PLCopen transport. (Root CFC/SFC are read-only and never reach push.)
        var pouVg = VgBody.Is(impl);

        // Read-only enforcement for graphical bodies is by LIVE IDE STATE, not content: an existing CFC/SFC
        // body is refused by the body-type guard below (which reads `BodyLanguage`). The materialized
        // informational marker carries no semantics, so there is no content-marker check here.

        ItemRef pou;
        if (existing is not { } existingPou)
        {
            // Placement is a CREATE-only concern: resolve (and if needed create) the target folder from the full
            // tree path here, so an in-place update never re-walks or accidentally materializes the spine.
            var targetParent = ResolveTopLevelFolder(ide, parent, folder);
            if (pouVg)
            {
                // The language comes from the VG NETWORK header (FBD/LD). TC's CreateChild uses this
                // to set the implementation language at creation. CODESYS's create_pou has no
                // implementation-language parameter, so it falls through to default ST — the subsequent
                // GraphicalCode.Write sets the correct language via PLCopen import (the <FBD>/<LD>
                // wrapper element on the body dictates the IDE's POU language).
                // Validate the VG body (parser + round-trip gate) BEFORE creating the item — otherwise a
                // refused push leaves an orphaned, unlisted stub POU that blocks the next create.
                GraphicalCode.Validate(impl);
                var lang = VgBody.LanguageOf(impl)!;   // Validate above proved an editable FBD/LD marker is present
                pou = ide.CreateChild(targetParent, name, itemType, lang);
                // A graphical POU's program-scope declaration is NOT carried by the body write —
                // GraphicalCode.Write only writes the BODY and preserves the export's <interface>, which on a
                // fresh create is empty, leaving the vars the contacts/coils reference undeclared. Write the
                // declaration onto the still-empty POU first (safe: nothing to clobber), then the body.
                if (!string.IsNullOrWhiteSpace(decl)) ide.WriteText(pou, decl, null);
                GraphicalCode.Write(ide, pou, name, impl, decl);
            }
            else
            {
                pou = ide.CreateChild(targetParent, name, itemType);
                // The COM reference from CreateChild is stale for interface items — re-find
                // before writing anything. Without this, WriteText and child creation fail.
                if (itemType == ItemKind.PlcItf)
                    pou = FindChild(ide, targetParent, name) ?? pou;
                // A POU on the single-document path writes NOTHING here: its declaration and body are part of the
                // one import below, so this WriteText would be a COM round-trip whose result is immediately
                // overwritten. Everything else (interface/DUT/GVL) still writes its text now.
                // Interfaces/DUTs/GVLs have no body slot (bodyImpl is null there); a POU passes its body
                // (possibly "" to clear). Writing implementation text on a slot-less node crashes TC COM.
                if (!OneDocument(ide, itemType))
                    ide.WriteText(pou, decl, bodyImpl);
            }
        }
        else
        {
            pou = existingPou;
            // ONE export serves this whole update: the root's body-format guard, EVERY child's guard, and the
            // splice basis below. It used to be 1 + N + 1 separate exports, because `BodyLanguage` is a full
            // PLCopen export on CODESYS and the child guard called it once per child — so a POU with 20 methods
            // paid 22 exports to write one body. Reading the document once and answering every language question
            // from it is the same information for a 22nd of the IDE traffic.
            var doc = !pouVg && OneDocument(ide, itemType) ? ide.ReadXml(pou) : null;
            var parsed = doc is null ? null : PouReader.Parse(doc);

            // Body-type guard (last line of defence): never overwrite an item with a MISMATCHED body format —
            // that silently corrupts/flattens the IDE's representation and loses code. The bridge owns FORMAT;
            // the LSP owns code correctness. Scoped to POUs (only they have graphical bodies; reading an
            // interface body crashes TC), decided from the safe KindCode classification, not a body read.
            if (ide.KindCode(existingPou) is ItemKind.PlcPouProg or ItemKind.PlcPouFunc or ItemKind.PlcPouFb)
            {
                // null=textual; FBD/LD=editable; CFC/SFC=read-only — from the document when we have one, else
                // from the vendor. Both answer the same question; only the cost differs.
                var currentLang = parsed is null ? ide.BodyLanguage(existingPou) : GraphicalOnly(parsed.BodyLanguage);
                if (currentLang is "CFC" or "SFC")
                    throw new BridgeException(BridgeErrorCodes.Unsupported,
                        $"'{name}' is a read-only {currentLang} body — edit it in the IDE, not via push.");
                if (currentLang is not null && !pouVg)
                    throw new BridgeException(BridgeErrorCodes.Unsupported,
                        $"'{name}' is a graphical {currentLang} body in the IDE — a textual push would overwrite it. " +
                        "Edit it in the IDE, or delete it first to replace it.");
                if (currentLang is null && pouVg)
                    throw new BridgeException(BridgeErrorCodes.Unsupported,
                        $"'{name}' is a textual body — graphical bodies are authored in the IDE, not created by push.");
            }
            // Validate every CHILD's body format BEFORE writing anything, so a refusal is atomic — exactly like the
            // root guard above. Checking inside the apply loop instead would leave the root body already written
            // while a child was refused: not data loss, but the IDE would hold the new root and the old child.
            foreach (var child in split.Children) RequireChildFormatWritable(ide, pou, child, itemType, parsed);

            if (pouVg) GraphicalCode.Write(ide, pou, name, impl, decl);
            else if (doc is null) ide.WriteText(pou, decl, bodyImpl);
            else
            {
                // The single-document write, reusing the export already read for the guards above.
                ide.WriteXml(pou, PouDocument.Splice(doc, name, split));
                RestoreChildFolders(ide, name, split);
                return;
            }
        }

        // THE single-document write for a CREATE: declaration, body, children, accessors, all in ONE merge import.
        // (The UPDATE takes the same write above, reusing the export it already read for the guards.)
        //
        // Create reaches here because the POU now EXISTS: `CreateChild` above made it, so it has an export to
        // splice. `pou-writes-via-plcopen` §3.3 read "a POU that does not exist yet has no export to splice" as a
        // reason to keep create on the per-child API — but that is only true BEFORE the create, and the create
        // path is what decides when that is. Measured on 3.5.21.40: a just-created POU exports with both an
        // `<InterfaceAsPlainText>` and a `<body>`, which are exactly the two elements the splice needs.
        if (!pouVg && OneDocument(ide, itemType))
        {
            ide.WriteXml(pou, PouDocument.Splice(ide.ReadXml(pou), name, split));
            RestoreChildFolders(ide, name, split);
            return;
        }

        foreach (var child in split.Children)
        {
            var cimpl = child.Implementation;
            var childVg = VgBody.Is(cimpl);
            // A read-only graphical (CFC/SFC) child has NO text form — it materializes as
            // Materializer.GraphicalBodyMarker, and VgBody.Is matches only a `NETWORK n LANG` header, so it REJECTS
            // that marker. The old guard here was `VgBody.Is(cimpl) && !IsEditable(...)`, which therefore never fired
            // for the one case it existed to stop: the marker fell through to the textual path below and
            // ide.WriteText replaced the engineer's graphical body with a comment. Refuse the round-tripped marker
            // outright — it is never something to write.
            if (Materializer.IsGraphicalBodyMarker(cimpl))
                throw new BridgeException(BridgeErrorCodes.Unsupported,
                    $"'{child.Name}' is a read-only graphical body — edit it in the IDE, not via push.");

            var childParent = ResolveFolder(ide, pou, child.Folder);
            var existingChild = FindChild(ide, childParent, child.Name);

            if (childVg)
            {
                if (existingChild is not { } ec) throw new BridgeException(BridgeErrorCodes.Unsupported,
                    $"cannot create graphical child '{child.Name}' from scratch — author it in the IDE, then pull");
                GraphicalCode.Write(ide, ec, child.Name, cimpl, decl);   // FB types from the enclosing POU's decl
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
            var childDecl = child.Kind == ItemKind.Kinds.Action ? null : child.Declaration;
            // Interface members are declaration-only, and a PROPERTY node has no body of its own (its GET/SET
            // accessors carry the impl, written below) — pass null so no ImplementationText is written to a
            // slot the COM object doesn't expose (crashes TC). Methods/actions have a body: pass it (possibly
            // "" to clear).
            var childImpl = isInterface || child.Kind == ItemKind.Kinds.Property ? null : child.Implementation;
            ide.WriteText(childItem, childDecl, childImpl);

            if (child.Kind == ItemKind.Kinds.Property)
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
        // (declaration-only), so they are kept, not deleted.
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

    /// <summary>Only a POU (program/function/function_block) is written as one PLCopen document. A DUT/GVL has no
    /// children to reconcile and no <c>&lt;body&gt;</c> at all in its export (measured), and an INTERFACE exports
    /// in a different shape entirely (no <c>&lt;pou&gt;</c> element — its members hang off
    /// <c>addData/Interface</c>), so neither is in scope.</summary>
    private static bool IsPou(int itemType) =>
        itemType is ItemKind.PlcPouProg or ItemKind.PlcPouFunc or ItemKind.PlcPouFb;

    /// <summary>Whether THIS item, on THIS driver, takes the single-document write. The one predicate the create,
    /// update and move paths all ask, so they cannot drift apart about which items it covers.</summary>
    private static bool OneDocument(IIdeDriver ide, int itemType) =>
        ide.WritesPouAsOneDocument && IsPou(itemType);

    /// <summary>Put the POU's children back in their folders after the merge import flattened them.
    /// <para>The import is a CONTENT transport and nothing more: measured on CODESYS 3.5.21.40, it prunes a POU's
    /// internal folders and lands every child at the POU root — even when the document itself describes the
    /// folders, because CODESYS emits that block <c>handleUnknown="discard"</c>. The placement Volt needs is not in
    /// the vendor document anyway; it is in Volt's OWN representation, the <c>%FOLDER</c> directive the splitter
    /// peels off each child.</para>
    /// <para>Only a child found at the POU ROOT is moved — the position the import leaves it in. One found
    /// elsewhere is already inside SOME folder, and this has no way to tell "the user moved it in the workspace"
    /// from "the import happened not to flatten it", so it is left alone. A missed re-placement is a folder the
    /// user fixes once; a guessed one silently scatters their methods.</para></summary>
    private static void RestoreChildFolders(IIdeDriver ide, string name, StSplitter.StSplitResult split)
    {
        var foldered = split.Children.Where(c => !string.IsNullOrEmpty(c.Folder)).ToList();
        if (foldered.Count == 0) return;
        // The merge does not delete the POU, but re-find it anyway: the import rewrites the object, and a handle
        // captured before it is not something to trust on the write path.
        if (ide.Lookup(name) is not { } pou) return;
        foreach (var child in foldered)
        {
            if (FindChild(ide, pou, child.Name) is not { } flattened) continue;   // already inside a folder
            ide.Move(flattened, ResolveFolder(ide, pou, child.Folder));
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

    /// <summary>Resolve a TOP-LEVEL item's placement folder. A non-empty <paramref name="folder"/> is the FULL
    /// tree path exactly as <see cref="IProjectTree.WalkItems"/> emits it (e.g. CODESYS
    /// "Device/Plc Logic/Application/POUs/Sub"), so push placement is symmetric with fetch: descend from the same
    /// tree root the walk measures from, MATCHING each existing container (structural node OR user folder) by name
    /// and only CREATING a user folder for a segment that does not yet exist. Empty ⇒ the default PLC-project root
    /// (<paramref name="defaultParent"/>) so a bare create still lands in the Application / PLC project.</summary>
    private static ItemRef ResolveTopLevelFolder(IIdeDriver ide, ItemRef defaultParent, string? folder)
    {
        if (string.IsNullOrEmpty(folder)) return defaultParent;
        var node = ide.GetTreeRoot();
        foreach (var part in FolderPath.Segments(folder))   // decode each segment back to its real IDE name
            node = DescendOrCreateFolder(ide, node, part);
        return node;
    }

    /// <summary>Match a container child (a structural node like Device/Plc Logic/Application, or an existing user
    /// folder) by name and descend into it; a same-named source LEAF (a POU/DUT) is not a container, so fall
    /// through and create a user folder beside it.</summary>
    private static ItemRef DescendOrCreateFolder(IIdeDriver ide, ItemRef parent, string name) =>
        FirstChild(ide, parent, c => NameIs(ide, c, name) && !ItemKind.IsTopLevelCrud(ide.KindCode(c)))
            ?? ide.CreateChild(parent, name, ItemKind.PlcFolder);

    // Resolve a folder RELATIVE to a given parent (used for POU children, whose sub-folder is relative to the POU).
    private static ItemRef ResolveFolder(IIdeDriver ide, ItemRef parent, string? folder)
    {
        if (string.IsNullOrEmpty(folder)) return parent;
        var node = parent;
        foreach (var part in FolderPath.Segments(folder))   // decode each segment back to its real IDE name
            node = FindOrCreateFolder(ide, node, part);
        return node;
    }

    /// <summary>The six-language body answer reduced to the GRAPHICAL ones — the same shape
    /// <see cref="ICodeStore.BodyLanguage"/> returns (null for a textual ST/IL body), so the two sources are
    /// interchangeable at every guard.</summary>
    private static string? GraphicalOnly(string? language) =>
        language is "FBD" or "LD" or "CFC" or "SFC" ? language : null;

    /// <summary>Resolve a folder WITHOUT creating one — the read-only twin of <see cref="ResolveFolder"/>, for
    /// callers that are only looking (a guard must not mutate the project it is about to refuse).</summary>
    private static ItemRef? FindFolder(IIdeDriver ide, ItemRef parent, string? folder)
    {
        if (string.IsNullOrEmpty(folder)) return parent;
        var node = parent;
        foreach (var part in FolderPath.Segments(folder))
        {
            if (FirstChild(ide, node, c => NameIs(ide, c, part) && ide.KindCode(c) == ItemKind.PlcFolder) is not { } found)
                return null;                                   // a segment that does not exist ⇒ the child is not there
            node = found;
        }
        return node;
    }

    private static ItemRef FindOrCreateFolder(IIdeDriver ide, ItemRef parent, string name) =>
        FirstChild(ide, parent, c => NameIs(ide, c, name) && ide.KindCode(c) == ItemKind.PlcFolder)
            ?? ide.CreateChild(parent, name, ItemKind.PlcFolder);

    private static ItemRef? FindChild(IIdeDriver ide, ItemRef parent, string name) =>
        FirstChild(ide, parent, c => NameIs(ide, c, name));

    /// <summary>Body-format guard for ONE child of a POU — the child-level counterpart of the root POU guard, and it
    /// decides from the IDE's LIVE body language, never from the incoming text. <c>VgBody</c>'s contract says it
    /// outright: CFC/SFC read-only-ness "is enforced by live IDE state on push, not by any content marker".
    /// <para>The old guard tried to do it from content — <c>VgBody.Is(cimpl) &amp;&amp; !IsEditable(...)</c> — which could
    /// never work, because a CFC/SFC body has no text form and materializes as
    /// <see cref="Materializer.GraphicalBodyMarker"/>, which <c>VgBody.Is</c> (a <c>NETWORK n LANG</c> matcher)
    /// REJECTS. So the marker fell through to the textual path and <c>WriteText</c> replaced an engineer's graphical
    /// child body with a comment. Scoped to method/action children: an interface member has no body of its own
    /// (reading one crashes TwinCAT) and a PROPERTY node's body lives in its GET/SET accessors.</para></summary>
    private static void RequireChildFormatWritable(IIdeDriver ide, ItemRef pou, StSplitter.StChild child, int itemType,
                                                   PouReader.ParsedPou? parsed)
    {
        var cimpl = child.Implementation;
        // The round-tripped marker is never something to write, whatever the IDE currently holds.
        if (Materializer.IsGraphicalBodyMarker(cimpl))
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"'{child.Name}' is a read-only graphical body — edit it in the IDE, not via push.");

        if (itemType == ItemKind.PlcItf || child.Kind == ItemKind.Kinds.Property) return;

        string? lang;                        // null=textual; FBD/LD=editable; CFC/SFC=read-only
        if (parsed is not null)
        {
            // From the document already read for this write. Besides costing nothing, this is how the guard stops
            // MUTATING the project: the vendor path below resolves the child's folder to find it, and
            // `ResolveFolder` CREATES missing folders — so a guard advertised as "validate before writing
            // anything, so a refusal is atomic" could leave new empty folders behind and then refuse the push.
            var known = parsed.Children.FirstOrDefault(c => string.Equals(c.Name, child.Name, StringComparison.OrdinalIgnoreCase));
            if (known is null) return;       // not in the IDE yet — a create, nothing to overwrite
            lang = GraphicalOnly(known.BodyLanguage);
        }
        else
        {
            if (FindChild(ide, FindFolder(ide, pou, child.Folder) ?? pou, child.Name) is not { } live) return;
            lang = ide.BodyLanguage(live);
        }

        var childVg = VgBody.Is(cimpl);
        if (lang is "CFC" or "SFC")
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"'{child.Name}' is a read-only {lang} body — edit it in the IDE, not via push.");
        if (lang is not null && !childVg)
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"'{child.Name}' is a graphical {lang} body in the IDE — a textual push would overwrite it. " +
                "Edit it in the IDE, or delete it first to replace it.");
        if (lang is null && childVg)
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"'{child.Name}' is a textual body — graphical bodies are authored in the IDE, not created by push.");
    }

    /// <summary>The one 1-based child scan every lookup here shares: first child matching
    /// <paramref name="match"/>, or null. (<see cref="RemoveOrphanChildren"/> keeps its own loop on purpose —
    /// it snapshots the whole level before mutating.)</summary>
    private static ItemRef? FirstChild(IIdeDriver ide, ItemRef parent, Func<ItemRef, bool> match)
    {
        int count = ide.ChildCount(parent);
        for (int i = 1; i <= count; i++)
        {
            var child = ide.ChildAt(parent, i);
            if (match(child)) return child;
        }
        return null;
    }

    // Names are matched case-insensitively: IEC identifiers are case-insensitive, so Core never trusts the
    // IDE's casing.
    private static bool NameIs(IIdeDriver ide, ItemRef item, string name) =>
        string.Equals(ide.Name(item), name, StringComparison.OrdinalIgnoreCase);

    private static void EnsureAccessor(IIdeDriver ide, ItemRef property, string name, int kindCode, string decl, string impl, bool isInterface)
    {
        var accessor = FindChild(ide, property, name) ?? ide.CreateChild(property, name, kindCode);
        // An INTERFACE property accessor is a bodiless stub: it only declares that a getter/setter exists,
        // with no declaration or implementation text. TwinCAT COM rejects DeclarationText/ImplementationText
        // writes on it and can HARD-CRASH the IDE (RPC 0x800706BE), so for interfaces we ensure the accessor
        // exists and write nothing — matching the proven Beckhoff reference (CreateInterfaceAccessors).
        if (!isInterface) ide.WriteText(accessor, decl, impl);
    }

    // Maps a top-level wire kind to its IDE create code. A DUT is one kind `dut` → one code (PlcDut); the IDE
    // derives struct/enum/union/alias from the written declaration, so Volt never picks a subkind.
    private static int PouKindToCode(string kind) => kind switch
    {
        ItemKind.Kinds.Program => ItemKind.PlcPouProg, ItemKind.Kinds.Function => ItemKind.PlcPouFunc, ItemKind.Kinds.FunctionBlock => ItemKind.PlcPouFb,
        ItemKind.Kinds.Dut => ItemKind.PlcDut, ItemKind.Kinds.Gvl => ItemKind.PlcGvl, ItemKind.Kinds.Interface => ItemKind.PlcItf,
        // No fallback: an unrecognized top-level kind is a bug (a new kind missed here), not a Program.
        _ => throw new BridgeException(BridgeErrorCodes.BadRequest, $"unknown top-level kind '{kind}'"),
    };

    // The splitter only ever emits method/action/property as textual children; interface vs non-interface is
    // the isInterface flag (the parent's kind), NOT a distinct child-kind string — so there is no
    // "interface_method"/"interface_property" arm. An unknown kind throws rather than defaulting to action.
    private static int ChildKindToCode(string kind, bool isInterface) => kind switch
    {
        ItemKind.Kinds.Method => isInterface ? ItemKind.PlcItfMeth : ItemKind.PlcMethod,
        ItemKind.Kinds.Action => ItemKind.PlcAction,
        ItemKind.Kinds.Property => isInterface ? ItemKind.PlcItfProp : ItemKind.PlcProp,
        _ => throw new BridgeException(BridgeErrorCodes.BadRequest, $"unknown child kind '{kind}'"),
    };
}
