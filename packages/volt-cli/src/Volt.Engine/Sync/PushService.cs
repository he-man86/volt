using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Item;
using Volt.Engine.Format.Network;
using Volt.Engine.Ide;
using Volt.Engine.Library;
using Volt.Engine.Format.St;
using Volt.Engine.Format.Body;

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
            try { applied.Add((ApplyOp(ide, parent, itemCache, op, request.Force), op.Name)); }
            catch (Exception ex)
            {
                // A structured network-text diagnostic (parser / round-trip gate) carries a stable code + source line;
                // any other throw is reason-only.
                var netEx = ex as NetworkTextException;
                VoltLog.Info($"push {request.Ops.Count} ops — REJECTED ({op.Name}: {ex.Message}) ({sw.ElapsedMilliseconds}ms)");
                return PushResponse.RejectedResult(
                    new List<PushConflict> { new() { Name = op.Name, Reason = ex.Message, Code = netEx?.Code, Line = netEx?.Line } },
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
        Dictionary<string, (ItemRef Item, string Folder)> itemCache, PushOp op, bool force)
    {
        // The wire carries FULL names; the IDE is extensionless. Convert once, here, at the boundary.
        var name = Materializer.Bare(op.Name);
        var inCache = itemCache.TryGetValue(name, out var cached);
        ItemRef? existing = inCache ? cached.Item : ItemLookup.Find(ide, name);
        var currentFolder = inCache ? cached.Folder : "";

        switch (op)
        {
            case SetItemOp set:
                return ApplySetItem(ide, parent, name, existing, currentFolder, set, force);
            case DeleteItemOp when existing is { } del:
                // `ide.Name(del)`, NOT the wire `name`: `del` is the already-resolved handle, so this is the item's
                // ACTUAL IDE name. itemCache resolves case-INSENSITIVELY while the drivers' child scan matches
                // case-SENSITIVELY, so a case-divergent wire name found the item here and then matched nothing in
                // the driver — silently on CODESYS, as a raw COM error on TwinCAT. Shared Core, so this fixes both.
                ide.Delete(ide.Parent(del), ide.Name(del));
                return "deleted";
            case DeleteItemOp:
                return "no-op";  // idempotent delete of an item that isn't there — the legitimate case

            default:
                // NOT the same thing. This arm used to cover both, so an op that is neither a set nor a delete —
                // a missing `op` discriminator, or a PascalCase one — deserialized as the concrete BASE PushOp,
                // matched nothing, and was reported as an accepted no-op. A client whose ops all silently did
                // nothing got `accepted: true` and a receipt.
                throw new BridgeException(BridgeErrorCodes.BadRequest,
                    $"push op for '{name}' has no recognised 'op' discriminator — expected \"set\" or " +
                    "\"deleteItem\" (lower-camel, exactly). The op was ignored rather than applied.");
        }
    }

    /// <summary>Apply one unified change. A rename uses the IDE's native rename (rewrites call-sites) and
    /// precedes a move; a move recreates in the new folder (name kept ⇒ name-based references survive); a
    /// content change goes through the shared full-fidelity writer. Each facet absent = unchanged.</summary>
    private static string ApplySetItem(IIdeDriver ide, ItemRef parent, string name, ItemRef? existing,
                                   string currentFolder, SetItemOp op, bool force)
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
            // FORCE deliberately overrides a diverged IDE, so it skips the last-moment check too - passing
            // `ifVersion` through regardless made `volt push --force` refuse the very case it exists for.
            WriteItemFromSource(ide, parent, currentName, item, src, currentFolder,
                                force ? null : op.IfVersion); // content update in place
            return renamed ? "renamed+updated" : "updated";
        }
        return renamed ? "renamed" : "no-op";          // rename-only (or a bare no-op set)
    }

    /// <summary>Move an item to another folder — <see cref="IProjectTree.Move"/>, on every driver. The IDE
    /// relocates the object WHOLE: nothing is read, deleted or rebuilt, there is no window in which the item does
    /// not exist, and a graphical item moves like any other. The NAME is kept, so name-based references survive.
    /// <para><b>The delete-and-recreate arm is gone.</b> It existed for "a driver without a move", gated on
    /// a per-vendor write fork that no longer exists either — and its own comment
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
            if (body is { } b && NetworkText.Is(b)) NetworkTextGate.Validate(b);
    }

    /// <summary>Create-or-update an item and its children from full canonical ST source. Shared by the
    /// set create/update path and the move recreate, so both apply identical full-fidelity write semantics.</summary>
    private static void WriteItemFromSource(IIdeDriver ide, ItemRef parent, string name, ItemRef? existing,
                                        string src, string? folder, string? ifVersion = null)
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

        // A ROOT FBD/LD body IS the editable network text language (it leads with the NETWORK marker). Write it
        // back via the PLCopen transport. (Root CFC/SFC are unsupported and never reach push.)
        var pouIsNetwork = NetworkText.Is(impl);

        // Read-only enforcement for graphical bodies is by LIVE IDE STATE, not content: an existing CFC/SFC
        // body is refused by the body-type guard below (which reads `BodyLanguage`). The materialized
        // informational marker carries no semantics, so there is no content-marker check here.

        ItemRef pou;
        ItemContent? live = null;
        if (existing is not { } existingPou)
        {
            // Placement is a CREATE-only concern: resolve (and if needed create) the target folder from the full
            // tree path here, so an in-place update never re-walks or accidentally materializes the spine.
            var targetParent = TreeNav.ResolveTopLevelFolder(ide, parent, folder);

            // Validate a network-text body BEFORE creating the item - a refused push must not leave an orphaned,
            // unlisted stub POU behind that blocks the next create.
            if (pouIsNetwork) NetworkTextGate.Validate(impl);

            // The body language is passed UNCONDITIONALLY (null for ST). TwinCAT sets a POU's implementation
            // language at creation; CODESYS takes it from the content. There is no create-arm per language - the
            // language is data.
            pou = ide.CreateChild(targetParent, name, itemType, NetworkText.LanguageOf(impl));
            // The COM reference from CreateChild is stale for interface items - re-find before writing anything,
            // and FAIL if the re-find misses rather than writing through the handle this very line calls dead. On
            // TwinCAT a write to a detached COM object can succeed silently, so the interface would land EMPTY
            // while the push reports "created" and the receipt bakes that into the client's baseline.
            if (itemType == ItemKind.PlcItf)
                pou = TreeNav.FindChild(ide, targetParent, name)
                    ?? throw new BridgeException(BridgeErrorCodes.NotFound,
                        $"created interface '{name}' but it cannot be found under its parent - refusing to write " +
                        "through the stale create handle");
        }
        else
        {
            pou = existingPou;

            // Validate the WHOLE write before any of it lands, so a refusal is atomic. The guard decides from
            // the IDE's LIVE body, which arrives in the content the driver returns - a body Volt cannot author
            // must never be overwritten by a textual push, and a marker must not be written over one it can.
            live = ide.ReadContent(pou);

            // LAST-MOMENT CHECK, against the state the IDE is in RIGHT NOW.
            //
            // The per-item `ifVersion` gate runs once, in the pre-apply walk, and a real push then does a lot
            // between that walk and this write: hash every item in the project, resolve conflicts, and apply
            // every earlier op in the batch. An engineer working in the IDE the whole time can MOVE, DELETE or
            // EDIT the very item we are about to overwrite inside that window, and the check that was supposed
            // to protect them ran before they touched it.
            //
            // It costs NOTHING to close most of that: the version is a hash of the materialized text, and the
            // content it is taken from is already in hand (`live`, read one line up for the format guard). No
            // extra IDE round trip - just do not trust a reading that is now seconds old.
            //
            // This narrows the window; it cannot close it, because nothing here can hold the IDE still. What it
            // guarantees is that an edit made before this line is never silently overwritten.
            if (ifVersion is { } expected && expected != Versioning.Unreadable)
            {
                var now = Hasher.ComputeItemVersion(folder ?? "", StWriter.Write(live));
                if (now != expected)
                    throw new BridgeException(BridgeErrorCodes.BadRequest,
                        $"'{name}' changed in the IDE while this push was being applied — refusing to overwrite " +
                        "it. Pull first, then push again.");
            }

            BodyFormatGuard.RequireWritable(live, split);
        }

        // ONE read of the live item, used by all three of the guard, the reconciler and the write filter. These
        // were two separate ReadContent calls back to back, each walking every member and reading its
        // declaration, body and accessors, to answer two questions about the same unchanged snapshot.
        live ??= ide.ReadContent(pou);

        // The member SET, for a create and an update alike. A create reaches here with the item existing but
        // empty, so every member the source declares is new; an update reconciles against what is there.
        if (ReconcileMembers(ide, pou, live, split))
            // Creating or deleting a member INVALIDATES every handle into the POU on TwinCAT: a member is not a
            // separate file there, so placing one is a round trip through the enclosing POU's own archive
            // (DIALECT D4j), and the import replaces the item (D4d). The next write through the captured handle
            // fails with "Unbound tree item" — which is how this surfaced, on 40-odd e2e tests at once. Re-find
            // from a FRESH tree root, because the PARENT handle dies with it.
            pou = ItemLookup.Find(ide, name)
                ?? throw new BridgeException(BridgeErrorCodes.NotFound,
                    $"'{name}' cannot be found after reconciling its members — refusing to write through a " +
                    "handle the member create invalidated");

        // ONE call, for create and update alike: declaration, body, members and accessors together.
        //
        // Everything that used to sit here went with the PLCopen transport, and each piece was a VENDOR fact
        // wearing engine clothing:
        //   - `ReadXml` + `PouDocument.Splice` + `WriteXml`: the document round-trip itself.
        //   - `WriteDeclarations` AFTER the document write. That ordering was measured and real - TwinCAT's
        //     importer REGENERATES a declaration from the typed <interface> when the document carries no
        //     verbatim block, so an aspect write placed first was silently undone (`x : INT;` came back
        //     `x: INT;`) - but it is a fact about one vendor's IMPORTER, and there is no import now.
        //   - `RestoreChildFolders`: PLCopen carries no folder membership, so its import flattened a POU's
        //     internal folders and Volt re-placed them from the pushed source. Nothing flattens them now.
        //   - `BodyFormatGuard.RequireChildFormatWritable` over a parsed document: the guard's POLICY (decide
        //     from the IDE's LIVE body language, never from the incoming text) is right and survives - inside
        //     the driver, which is the only layer that can ask the IDE cheaply.
        ide.WriteContent(pou, OnlyChanged(live, split));
    }

    /// <summary>Drop the members whose content the IDE already has, so a push writes what an engineer CHANGED
    /// rather than everything they sent.
    ///
    /// <para>Every member used to be rewritten on every push. Editing one line of a function block's body
    /// re-wrote all twenty of its methods, and each of those is a separate
    /// GetObjectToModify/SetObject transaction in the IDE - the bulk of an update's cost, and all of it work
    /// nobody asked for. This is the same rule the graphical writers already follow: a body whose rendered form
    /// is unchanged is not written at all.</para>
    ///
    /// <para>Safe because <paramref name="live"/> IS the IDE's state, read moments ago in this same push, and
    /// because a member absent from the list means "leave it alone", never "delete it" - removal is
    /// <see cref="ReconcileMembers"/>'s job and has already happened. A member the reconciler just CREATED is
    /// not in the snapshot, so it is correctly seen as changed and written.</para></summary>
    private static ItemContent OnlyChanged(ItemContent live, ItemContent pushed)
    {
        if (pushed.Members.Count == 0) return pushed;

        var byName = new Dictionary<string, Member>(StringComparer.OrdinalIgnoreCase);
        foreach (var m in live.Members) byName[m.Name] = m;

        var changed = pushed.Members.Where(m => !byName.TryGetValue(m.Name, out var was) || !Same(was, m)).ToList();
        return changed.Count == pushed.Members.Count ? pushed : pushed with { Members = changed };
    }

    /// <summary>Does this member need writing? Compared on EVERYTHING a write carries - declaration, body, the
    /// two accessors, and the FOLDER.
    /// <para>Folder was left out of this first, on the reasoning that placement is structure and handled
    /// earlier. It is not: a member whose text is identical but whose folder moved was then dropped from the
    /// write and never re-placed. `Every_foldered_child_arrives_with_its_folder` caught it immediately, which is
    /// the whole reason that test exists. Anything that differs at all is written.</para></summary>
    private static bool Same(Member a, Member b) =>
        Text(a.Declaration) == Text(b.Declaration)
        && Text(a.Body) == Text(b.Body)
        && string.Equals(a.Folder ?? "", b.Folder ?? "", StringComparison.Ordinal)
        && Same(a.Getter, b.Getter)
        && Same(a.Setter, b.Setter);

    private static bool Same(Accessor? a, Accessor? b) =>
        a is null ? b is null
        : b is not null && Text(a.Declaration) == Text(b.Declaration) && Text(a.Body) == Text(b.Body);

    /// <summary>Compare on the text as it LANDS: the drivers trim, so a trailing newline is not a change.</summary>
    private static string Text(string? s) => (s ?? "").TrimEnd();

    /// <summary>Bring the member SET into line with the pushed source: create what the source declares and the
    /// project lacks, remove what the project has and the source dropped.
    ///
    /// <para><b>This is new work, and it had no owner for a moment.</b> Nothing here used to create or remove a
    /// member: the PLCopen IMPORT did it as a side effect of the document write — it "ADDS a child present only
    /// in the document, REMOVES one absent from it" — so the engine only ever handed over a document. With the
    /// document gone, the responsibility surfaced, and it belongs here rather than in a driver: creating and
    /// deleting a child is <see cref="IProjectTree"/>, which both vendors already implement, and keeping it in
    /// one place is what keeps the removal rule honest.</para>
    ///
    /// <para><b>The removal rule is the dangerous half.</b> It reconciles against the members the driver
    /// REPORTS, which are only the kinds that materialize into the file. A transition is inlined in a POU and is
    /// not a member — no reader models one, so it can never appear in a pushed source — and reconciling against
    /// the wider "inlined in a POU" set is exactly how a push once deleted every transition of an SFC POU on its
    /// first write, silently.</para></summary>
    /// <returns><c>true</c> when the project was mutated, so the caller knows its handles may be stale.</returns>
    private static bool ReconcileMembers(IIdeDriver ide, ItemRef pou, ItemContent live, ItemContent pushed)
    {
        var have = new HashSet<string>(live.Members.Select(m => m.Name), StringComparer.OrdinalIgnoreCase);
        var want = new HashSet<string>(pushed.Members.Select(m => m.Name), StringComparer.OrdinalIgnoreCase);

        var mutated = false;
        var name = ide.Name(pou);

        // Re-resolving the POU costs a FULL PROJECT WALK, so only pay it where a create actually invalidates
        // the handle. The loop used to pay it after every mutation on both vendors - 19 walks for a 20-member
        // POU - because it assumed the worse case for both. The driver states which case it is.
        ItemRef Owner()
        {
            if (!mutated || ide.HandlesSurviveStructureChange) return pou;
            return pou = ItemLookup.Find(ide, name) ?? pou;
        }

        // A member whose KIND changed is a DIFFERENT OBJECT, so it is deleted and recreated rather than written
        // through. `have`/`want` are keyed on NAME alone, so `PROPERTY Ready` -> `METHOD Ready` used to be
        // neither created nor deleted: the method's declaration was written into the property's Interface
        // aspect, its body went to an Implementation aspect a property does not have (a silent no-op), and the
        // old GET/SET stayed compiled in. `BodyFormatGuard` cannot see it - both shapes are Textual.
        var liveKind = live.Members.ToDictionary(m => m.Name, m => m.Kind, StringComparer.OrdinalIgnoreCase);
        var retyped = new HashSet<string>(
            pushed.Members.Where(m => liveKind.TryGetValue(m.Name, out var k) && k != m.Kind).Select(m => m.Name),
            StringComparer.OrdinalIgnoreCase);

        // DELETES RUN FIRST. The create loop used to run first, and its CreateChild calls are already committed
        // when a later delete throws - so a rejected push left the project MUTATED, and a rename of a foldered
        // member left BOTH copies behind. Removing first also makes the retype case a plain delete-then-create.
        foreach (var m in live.Members)
        {
            if (want.Contains(m.Name) && !retyped.Contains(m.Name)) continue;
            // Delete it WHERE IT LIVES. This passed `Owner()` and dropped `m.Folder`, and DeleteChild scans
            // direct children only - so a member inside a POU sub-folder could never be deleted at all, failing
            // loudly on every retry with "no child named 'Act' under 'FB_FolderChild'".
            var site = TreeNav.FindFolder(ide, Owner(), m.Folder) ?? Owner();
            ide.Delete(site, m.Name);
            mutated = true;
        }

        foreach (var m in pushed.Members)
        {
            if (have.Contains(m.Name) && !retyped.Contains(m.Name)) continue;
            ide.CreateChild(TreeNav.ResolveFolder(ide, Owner(), m.Folder),
                            m.Name, ItemKind.MemberCode(m.Kind), CreateSeed(m));
            mutated = true;
        }

        // PLACEMENT IS STRUCTURE, so it is reconciled here with create and delete rather than in a driver.
        //
        // `Same()` deliberately counts a folder change so a folder-only move is not dropped by `OnlyChanged`,
        // and its doc said the member was then "re-placed". Nothing re-placed it: the drivers resolve a member
        // by bare name across every sub-folder and never read `m.Folder`, so a `%FOLDER` edit was ACCEPTED,
        // landed nothing, and the receipt then hashed the OLD folder into the client's baseline - after which
        // `volt status` reported "in sync" while the workspace and the IDE disagreed about where the member is.
        var liveFolder = live.Members.ToDictionary(m => m.Name, m => m.Folder ?? "", StringComparer.OrdinalIgnoreCase);
        foreach (var m in pushed.Members)
        {
            // A member the loops above just created is already in the right folder.
            if (!liveFolder.TryGetValue(m.Name, out var was) || retyped.Contains(m.Name)) continue;
            if (string.Equals(was, m.Folder ?? "", StringComparison.Ordinal)) continue;

            var from = TreeNav.FindFolder(ide, Owner(), was);
            var member = from is null ? null : TreeNav.FindChild(ide, from.Value, m.Name);
            if (member is null)
                throw new BridgeException(BridgeErrorCodes.NotFound,
                    $"'{m.Name}': cannot be found at '{(was.Length == 0 ? "<the POU root>" : was)}' to move it");

            ide.Move(member.Value, TreeNav.ResolveFolder(ide, Owner(), m.Folder));
            mutated = true;
        }

        // A property's ACCESSORS are children too, so they are reconciled here with everything else that is a
        // child. They were briefly done in the drivers, on the reasoning that only a driver can ask which child
        // is the SET; that is not so - the vendors both name them "Get" and "Set", which is what the original
        // fix relied on, and doing it here is what lets the INTERFACE rule below be stated once.
        foreach (var m in pushed.Members)
        {
            if (m.Kind is not (ItemKind.Kinds.Property or ItemKind.Kinds.InterfaceProperty)) continue;
            var isInterface = m.Kind == ItemKind.Kinds.InterfaceProperty;
            // FIND, never find-or-create. This used ResolveFolder - which CREATES - for a pure lookup, so a
            // pushed `%FOLDER` that did not match where the property actually sits made a real empty folder
            // inside the engineer's POU, missed the property inside the folder it had just created, and then
            // `continue`d - silently skipping the reconciliation, so a SET the engineer deleted from the source
            // stayed live in the IDE running its old code while the push reported "updated".
            var propParent = TreeNav.FindFolder(ide, Owner(), m.Folder);
            var prop = propParent is null ? null : TreeNav.FindChild(ide, propParent.Value, m.Name);
            if (prop is null)
                throw new BridgeException(BridgeErrorCodes.NotFound,
                    $"'{m.Name}': the property is in the pushed source but cannot be found in the project" +
                    (string.IsNullOrEmpty(m.Folder) ? "" : $" under '{m.Folder}'") +
                    " — refusing to report the push applied when its accessors were never reconciled");

            mutated |= ReconcileAccessor(ide, prop.Value, "Get",
                                         isInterface ? ItemKind.PlcItfPropGet : ItemKind.PlcPropGet, m.Getter);

            // Re-find the PROPERTY only where the accessor create just invalidated it.
            if (mutated && !ide.HandlesSurviveStructureChange)
            {
                propParent = TreeNav.FindFolder(ide, Owner(), m.Folder);
                prop = propParent is null ? null : TreeNav.FindChild(ide, propParent.Value, m.Name);
            }
            if (prop is null)
                throw new BridgeException(BridgeErrorCodes.NotFound,
                    $"'{m.Name}': the property vanished while its accessors were being reconciled");

            mutated |= ReconcileAccessor(ide, prop.Value, "Set",
                                         isInterface ? ItemKind.PlcItfPropSet : ItemKind.PlcPropSet, m.Setter);
        }

        return mutated;
    }

    /// <summary>Make a property's GET or SET exist, or not, to match the pushed source. <b>Presence is the
    /// object</b> - a null accessor means the source dropped it, and dropping it must DELETE it.
    ///
    /// <para>Creating one is what TwinCAT needs: it makes a property with no accessors, so a pushed
    /// `GET ... END_GET` had nothing to be written into and the property came back empty. CODESYS makes both
    /// with the property and exposes no call to add one later, so its driver refuses that create by name -
    /// a documented divergence, not a fallback.</para>
    ///
    /// <para>Deleting one is what a silent no-op used to be: the source said GET only, the push was accepted,
    /// and the SET stayed in the project running its old code.</para></summary>
    private static bool ReconcileAccessor(IIdeDriver ide, ItemRef property, string name, int kindCode,
                                          Accessor? accessor)
    {
        // Ask the DRIVER whether it is there, never walk for it: enumerating an interface property's accessor
        // children can hard-crash TcXaeShell, which is exactly why InterfacePropertyAccessors is a per-vendor
        // call rather than a tree walk this could do itself.
        var isItf = kindCode is ItemKind.PlcItfPropGet or ItemKind.PlcItfPropSet;
        bool exists;
        if (isItf)
        {
            var (get, set) = ide.InterfacePropertyAccessors(property);
            exists = kindCode == ItemKind.PlcItfPropGet ? get : set;
        }
        else exists = TreeNav.FindChild(ide, property, name) is not null;

        if (accessor is null)
        {
            if (!exists) return false;
            ide.Delete(property, name);
            return true;
        }
        if (exists) return false;
        ide.CreateChild(property, name, kindCode);
        return true;
    }

    /// <summary>The one value a vendor wants when CREATING this member: the declared TYPE for an interface
    /// member, the body LANGUAGE for everything else.
    ///
    /// <para>This is the read side of <see cref="Member.ReturnType"/> and <see cref="Member.DataType"/>, which
    /// the ST reader has always filled and which nothing consumed — so every interface member was created with
    /// a body language as its type, and TwinCAT answered "Object reference not set to an instance of an object"
    /// for an interface PROPERTY. An interface member has no body, so the language it was being handed was
    /// always null anyway: the two halves were never in competition.</para></summary>
    private static string? CreateSeed(Member m) =>
        m.Kind is ItemKind.Kinds.InterfaceMethod or ItemKind.Kinds.InterfaceProperty
            ? m.ReturnType ?? m.DataType
            : NetworkText.LanguageOf(m.Body);

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
