using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Document;
using Volt.Engine.Graph;
using Volt.Engine.Ide;
using Volt.Engine.Model;
using Volt.Engine.Text;
using Volt.Engine.Vocabulary;

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
        foreach (var it in ide.WalkItems().Items)
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
        var conflicts = PushConflicts.DetectConflicts(request.Ops, request.ExpectedProjectVersion, request.Force, currentVersions, currentProjectVersion);
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
                // A structured network-text diagnostic (parser / round-trip gate) carries a stable code + source line;
                // any other throw is reason-only.
                var vg = ex as Graph.NetworkTextException;
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

    /// <summary>Apply one op and return a short label of what it did (created/updated/renamed/moved/deleted),
    /// used only for the log receipt.</summary>
    private static string ApplyOp(IIdeDriver ide, ItemRef parent,
        Dictionary<string, (ItemRef Item, string Folder)> itemCache, PushOp op)
    {
        // The wire carries FULL names; the IDE is extensionless. Convert once, here, at the boundary.
        var name = Materializer.Bare(op.Name);
        var inCache = itemCache.TryGetValue(name, out var cached);
        ItemRef? existing = inCache ? cached.Item : ItemLookup.Find(ide, name);
        var currentFolder = inCache ? cached.Folder : "";

        switch (op)
        {
            case SetItemOp set:
                return ApplySetItem(ide, parent, name, existing, currentFolder, set);
            case DeleteItemOp when existing is { } del:
                // `ide.Name(del)`, NOT the wire `name`: `del` is the already-resolved handle, so this is the item's
                // ACTUAL IDE name. itemCache resolves case-INSENSITIVELY while the drivers' child scan matches
                // case-SENSITIVELY, so a case-divergent wire name found the item here and then matched nothing in
                // the driver — silently on CODESYS, as a raw COM error on TwinCAT. Shared Core, so this fixes both.
                ide.Delete(ide.Parent(del), ide.Name(del));
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
            // VALIDATE THE PUSHED TEXT FIRST. A native rename makes the IDE rewrite every reference to this POU
            // across the project — it is the largest change in this method, and it used to run before anything
            // that could refuse. A rename+edit whose edit was then rejected left the item renamed and its call
            // sites rewritten while the push reported failure, with nothing to put it back.
            //
            // `MoveItem` already learned exactly this and says so: it used to move first, and "the push reported
            // failure while the project had quietly half-changed". Same method, same lesson, one arm short.
            //
            // Parsing here is not a second guard: it is the SAME `StReader`/`NetworkCode` path the write runs,
            // pulled ahead of the mutation. What it cannot pre-check is a refusal that depends on the item's live
            // state (an unsupported body, a language change) — those are still caught by the write, which is why
            // the ORDER below (content, then move) stays as it is.
            if (op.SourceText is { } pre) ValidateSourceOrThrow(pre, name);

            ide.Rename(item, toName);                  // native rename → IDE rewrites references
            currentName = toName;
            // Refresh the staled handle, and FAIL on a miss. The rename reported success, so the item MUST be
            // findable under its new name; keeping the pre-rename handle writes the pushed content onto the OLD
            // identity and still returns "renamed+updated", which the receipt then bakes into the baseline.
            item = ItemLookup.Find(ide, currentName)
                ?? throw new BridgeException(BridgeErrorCodes.NotFound,
                    $"renamed '{name}' to '{currentName}' but the renamed item cannot be found — refusing to " +
                    "write through the pre-rename handle");
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

    /// <summary>Move an item to another folder — <see cref="IProjectTree.Move"/>, on every driver. The IDE
    /// relocates the object WHOLE: nothing is read, deleted or rebuilt, there is no window in which the item does
    /// not exist, and a graphical item moves like any other. The NAME is kept, so name-based references survive.
    /// <para><b>The delete-and-recreate arm is gone.</b> It existed for "a driver without a move", gated on
    /// <c>WritesPouAsOneDocument</c> on the reasoning that the two were the same measurement — and its own comment
    /// admitted what it cost: it REFUSED a graphical move outright (a diagram cannot be rebuilt from text), and a
    /// delete whose re-create then failed left a DUPLICATE rather than a no-op. It was "the arm only TwinCAT
    /// takes", and TwinCAT has a move now (DIALECT D4f), so it models a driver that does not exist.</para></summary>
    private static void MoveItem(IIdeDriver ide, ItemRef parent, string name, ItemRef item, string newFolder, string? sourceText)
    {
        var kind = ItemKind.Map(ide.KindCode(item));
        if (kind == null || !ItemKind.IsSourceKind(kind))
            throw new BridgeException(BridgeErrorCodes.Unsupported, $"cannot move '{name}': only source items (POUs/DUTs/GVLs) can be moved");

        // CONTENT FIRST, then the move — because the content write is the step that can REFUSE.
        // It used to move first, which meant a rejected move+edit (an unsupported CFC body, a language change,
        // malformed network text — all refused by the splice) left the item ALREADY RELOCATED, and
        // `ResolveTopLevelFolder` had already created the destination folder on the way. The push reported
        // failure while the project had quietly half-changed, and nothing put it back. Writing first makes
        // the refusal atomic: the item has not moved, so there is nothing to undo.
        if (sourceText is { } edited)
        {
            WriteItemFromSource(ide, parent, name, item, edited, newFolder);
            // RE-RESOLVE before moving. On TwinCAT the write is a document IMPORT, and an import invalidates every
            // handle into the item it replaced (DIALECT D4d) — so the handle this method was called with is dead
            // by the time the move needs it. That made a move+edit fail with "Item 'X' is deleted or invalidated
            // by an ealier operation!" on EVERY attempt, not intermittently: the same push always writes before
            // it moves, so no retry could ever succeed.
            //
            // The ordering itself is right and stays: the write is the step that can REFUSE, so writing first is
            // what makes a refusal atomic (nothing moved, nothing to undo). It just cannot reuse the handle
            // across it.
            item = ItemLookup.Find(ide, name)
                ?? throw new BridgeException(BridgeErrorCodes.NotFound,
                    $"'{name}' could not be found after its content was written — the write appears to have " +
                    "replaced it and the move cannot proceed.");
        }
        ide.Move(item, TreeNav.ResolveTopLevelFolder(ide, parent, newFolder));
    }

    /// <summary>Parse the pushed source the way the write will, and throw if it cannot be parsed — WITHOUT
    /// touching the IDE. Used to move a text-level refusal ahead of a rename, which is otherwise the first thing
    /// a set op does and the hardest to undo.</summary>
    private static void ValidateSourceOrThrow(string src, string name)
    {
        var split = StReader.Read(src);                       // throws InvalidSt on a malformed document
        // …and every graphical body it carries, root and members alike: network text that does not parse is the
        // most common way an edit is refused, and it is knowable before anything is mutated.
        foreach (var body in new[] { split.Body }.Concat(split.Members.Select(m => m.Body)))
            if (body is { } b && Graph.NetworkText.Is(b)) NetworkCode.Validate(b);
    }

    /// <summary>Create-or-update an item and its children from full canonical ST source. Shared by the
    /// set create/update path and the move recreate, so both apply identical full-fidelity write semantics.</summary>
    private static void WriteItemFromSource(IIdeDriver ide, ItemRef parent, string name, ItemRef? existing, string src, string? folder)
    {
        var split = StReader.Read(src);


        // Children (method/action/property) are keyed by name, so two children sharing a name would silently
        // collapse: the second's CreateChild finds the first and WriteText overwrites it, losing a source item
        // while the push still reports accepted. The IDE itself can't hold two same-name children (an unmarked
        // overload). Reject the push with a clear reason instead of dropping code. This is NOT the top-level
        // opaque-item name invariant (which forbids a throwing dup guard because real projects repeat opaque
        // names) — it is duplicate children WITHIN one pushed source, which is unambiguously invalid.
        var dupChild = split.Members
            .GroupBy(c => c.Name, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault(g => g.Count() > 1);
        if (dupChild != null)
            throw new BridgeException(BridgeErrorCodes.DuplicateChild,
                $"'{name}' declares more than one child named '{dupChild.Key}' — a duplicate method/action/property " +
                "name is not representable (the IDE keys children by name; the duplicate would silently overwrite). " +
                "Rename or remove the duplicate.");

        var decl = split.Declaration;
        var impl = split.Body;
        var itemType = PouKindToCode(split.Kind);
        // Only POUs (program/function/function_block) have an implementation-body slot. DUTs, GVLs and
        // interfaces don't — pass NULL so WriteText leaves the (nonexistent) impl untouched; writing text to
        // a slot the COM object doesn't expose crashes TwinCAT. A POU with an EMPTY body still passes "" so
        // the body is CLEARED (TcObjectModel.WriteText / CodesysObjectModel.WriteSourceText write on non-null).
        var bodyImpl = split.Kind is ItemKind.Kinds.Program or ItemKind.Kinds.Function or ItemKind.Kinds.FunctionBlock ? impl : (string?)null;

        // A ROOT FBD/LD body IS the editable network text language (it leads with the NETWORK marker). Write it
        // back via the PLCopen transport. (Root CFC/SFC are unsupported and never reach push.)
        var pouVg = NetworkText.Is(impl);

        // Read-only enforcement for graphical bodies is by LIVE IDE STATE, not content: an existing CFC/SFC
        // body is refused by the body-type guard below (which reads `BodyLanguage`). The materialized
        // informational marker carries no semantics, so there is no content-marker check here.

        ItemRef pou;
        if (existing is not { } existingPou)
        {
            // Placement is a CREATE-only concern: resolve (and if needed create) the target folder from the full
            // tree path here, so an in-place update never re-walks or accidentally materializes the spine.
            var targetParent = TreeNav.ResolveTopLevelFolder(ide, parent, folder);

            // Validate a network-text body BEFORE creating the item — a refused push must not leave an orphaned,
            // unlisted stub POU behind that blocks the next create.
            if (pouVg) NetworkCode.Validate(impl);

            // The body language is passed UNCONDITIONALLY (null for ST). TwinCAT sets a POU's implementation
            // language at creation; CODESYS ignores the argument and takes the language from the body element on
            // import. There is no create-arm per language any more — the language is data.
            pou = ide.CreateChild(targetParent, name, itemType, NetworkText.LanguageOf(impl));
            // The COM reference from CreateChild is stale for interface items — re-find before writing anything,
            // and FAIL if the re-find misses rather than writing through the handle this very line calls dead. On
            // TwinCAT a write to a detached COM object can succeed silently, so the interface would land EMPTY
            // while the push reports "created" and the receipt bakes that into the client's baseline.
            if (itemType == ItemKind.PlcItf)
                pou = TreeNav.FindChild(ide, targetParent, name)
                    ?? throw new BridgeException(BridgeErrorCodes.NotFound,
                        $"created interface '{name}' but it cannot be found under its parent — refusing to write " +
                        "through the stale create handle");

        }
        else
        {
            pou = existingPou;
            // ONE export serves this whole update: the root's body-format guard, EVERY child's guard, and the
            // splice basis below. It used to be 1 + N + 1 separate exports, because `BodyLanguage` is a full
            // PLCopen export on CODESYS and the child guard called it once per child — so a POU with 20 methods
            // paid 22 exports to write one body. Reading the document once and answering every language question
            // from it is the same information for a 22nd of the IDE traffic.
            var doc = ide.ReadXml(pou);
            var parsed = PouReader.Parse(doc);

            // Validate every CHILD's body format BEFORE writing anything, so a refusal is atomic — exactly like the
            // root guard above. Checking inside the apply loop instead would leave the root body already written
            // while a child was refused: not data loss, but the IDE would hold the new root and the old child.
            foreach (var child in split.Members) BodyFormatGuard.RequireChildFormatWritable(ide, pou, child, itemType, parsed);

            // ONE write, whatever the body language — the splice dispatches to the language's codec. This is
            // the merge: a network-text body no longer takes a separate write that carried only the body and
            // silently dropped the declaration and the member reconciliation.
            ide.WriteXml(pou, PouDocument.Splice(doc, name, split, establishing: false));
            RestoreChildFolders(ide, name, split);
            return;
        }

        // THE single-document write for a CREATE: declaration, body, children, accessors, all in ONE merge import.
        // (The UPDATE takes the same write above, reusing the export it already read for the guards.)
        //
        // Create reaches here because the POU now EXISTS: `CreateChild` above made it, so it has an export to
        // splice. `pou-writes-via-plcopen` §3.3 read "a POU that does not exist yet has no export to splice" as a
        // reason to keep create on the per-child API — but that is only true BEFORE the create, and the create
        // path is what decides when that is. Measured on 3.5.21.40: a just-created POU exports with both an
        // `<InterfaceAsPlainText>` and a `<body>`, which are exactly the two elements the splice needs.
        ide.WriteXml(pou, PouDocument.Splice(ide.ReadXml(pou), name, split, establishing: true));
        RestoreChildFolders(ide, name, split);
    }

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
    private static void RestoreChildFolders(IIdeDriver ide, string name, ItemContent split)
    {
        var foldered = split.Members.Where(c => !string.IsNullOrEmpty(c.Folder)).ToList();
        if (foldered.Count == 0) return;
        // The POU is re-found ONCE PER MEMBER, not once. The import rewrites the object, and a handle captured
        // before it is not something to trust on the write path — but the MOVE can rewrite it too: on a vendor
        // where a member is not a separate file, placing one is a round trip through the enclosing POU's own
        // archive (TwinCAT, DIALECT D4j), which leaves every handle into that POU dead. Hoisting the lookup out
        // of the loop worked only for as long as CODESYS, whose move touches nothing but the moved object, was
        // the only driver that reached here.
        //
        // A MISS is not "nothing to do". The document has ALREADY landed and the import has already flattened the
        // POU's internal folders, so returning quietly leaves every member at the POU root while the push reports
        // success and the receipt bakes the flattened tree into the client's baseline — the engineer's structure
        // is gone and `volt status` says clean.
        foreach (var child in foldered)
        {
            if (ItemLookup.Find(ide, name) is not { } pou)
                throw new BridgeException(BridgeErrorCodes.NotFound,
                    $"'{name}' cannot be found after its document was imported, so its members cannot be put back " +
                    "into their folders — the import has already flattened them");
            if (TreeNav.FindChild(ide, pou, child.Name) is not { } flattened) continue;   // already inside a folder
            ide.Move(flattened, TreeNav.ResolveFolder(ide, pou, child.Folder));
        }
    }

    /// <summary>Walk the POU subtree and delete in-POU children (method/action/property — NOT transitions,
    /// which no reader models, so they can never be in <paramref name="keep"/>) whose name is not in it. Folders are descended (recursed first, so a deletion never
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
            // Only the members the SOURCE models — see ItemKind.IsPouSourceMember. Reconciling against the wider
            // IsInlinedInPou set deleted things no reader can ever put in `keep`: a TRANSITION is never written
            // to the file, so the first push of an SFC-bearing POU silently deleted the engineer's transitions.
            // The folder exclusion is implied by the predicate now.
            if (ItemKind.IsPouSourceMember(s.Kind) && !keep.Contains(s.Name))
                ide.Delete(parent, s.Name);
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
}
