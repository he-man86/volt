using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Item;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.Task;
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
        // THE PRE-FLIGHT WALK IS THE SLOW HALF OF A PUSH, and it says so now. `Versioning.SafeVersion`
        // MATERIALIZES each item — declaration + implementation, assembled to ST — so on a real project this is
        // a full read before the first write, and it used to run in silence: the client's bar sat on the bare
        // title until the `applying` phase, which on `Lenze_MID-S100` is most of the wall clock.
        onProgress?.Invoke(new ProgressFrame { Operation = Ops.Push, Phase = "checking" });

        // ...AND IT IS SKIPPED WHEN NOTHING WILL READ IT. `--force` tells PushConflicts to skip every per-item
        // `ifVersion` check, so the only consumer left is the project-level LEASE — and that runs only when the
        // caller quoted one. A plain `push --force` therefore paid for materializing every item in the project
        // to build two maps that nothing then looked at. The item CACHE is still needed either way: it is what
        // the apply boundary resolves each op against, and it comes from the walk, not from the read.
        // `returnSources` reads them too: the answer carries every item whose version the push CHANGED, which only a
        // pre-apply version can tell.
        var needVersions = !request.Force || request.ExpectedProjectVersion != null || request.ReturnSources == true;
        var currentVersions = new Dictionary<string, string>();
        var gatedVersions = new Dictionary<string, string>();
        var itemCache = new Dictionary<string, (ItemRef Item, string Folder)>(StringComparer.OrdinalIgnoreCase);
        // Held, not just iterated: `Complete` is what makes ABSENCE from this walk meaningful, and the
        // create pre-flight below needs exactly that (see `WillCreate`).
        var walk = ide.WalkItems();
        foreach (var it in walk.Items)
        {
            var kind = ItemKind.Map(it.KindCode);
            if (kind == null) continue;
            if (ItemKind.IsAddressableItem(it.KindCode)) itemCache[it.Name] = (it.Item, it.Folder);
            if (!needVersions) continue;
            // Resilient: a malformed item must not crash the push. It still gets a (sentinel) version and stays
            // in itemCache — its ItemRef comes from WalkItems, not the read — so it remains deletable.
            var v = Versioning.SafeVersion(ide, it.Name, kind, it.Item, it.Folder);
            var version = v.Version;
            // Keyed by the item's WIRE IDENTITY (see VersionedItem) — the client can only quote back an identity
            // it was GIVEN, so the ifVersion gate has to look it up under that same one. `itemCache` above stays
            // BARE on purpose: that is the IDE's OWN lookup key, one rung below the wire.
            currentVersions[v.Identity] = version;
            if (ProjectSnapshot.IsTracked(it.KindCode)) gatedVersions[v.Identity] = version;
        }
        // Where each object the driver NAMES but must not open sits (UnreadableObject.Kinds: a TwinCAT POU, DIALECT
        // C2i). A forced set recreates such an item, and keeps it in this folder unless the op moves it.
        var notOpened = walk.UnreadableObjects.Where(o => o.Kinds is not null)
            .GroupBy(o => o.Name, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Folder, StringComparer.OrdinalIgnoreCase);
        // An object the walk could not classify counts here exactly as on refs and fetch, or the gate would refuse
        // every push quoting refs' projectVersion while it stays unreadable.
        if (needVersions)
        {
            Versioning.CountUnclassifiable(walk, currentVersions);
            Versioning.CountUnclassifiable(walk, gatedVersions);
        }

        // Null when the walk skipped the reads. NOT the empty string: this value is published as
        // `PushResponse.currentProjectVersion` on EVERY rejection, including one raised mid-apply long after
        // the gate, so a `--force` push refused by a NETWORK_* body or an UNSUPPORTED shape would have handed
        // the client `""` where it had always had the real hash. `RejectAt` computes it on demand instead —
        // a rejection is not the hot path, and paying for it there costs nothing a successful push notices.
        string? currentProjectVersion = needVersions ? Hasher.ComputeProjectVersion(gatedVersions) : null;

        // EVERY NAME AN OP CARRIES IS A WIRE NAME, checked before anything reads the ops.
        var ops = request.Ops;
        try
        {
            RequireWireNames(ops);
            RequireOneOpPerItem(ops);
        }
        catch (PushRefusal refusal)
        {
            VoltLog.Info($"push {request.Ops.Count} ops — REJECTED ({refusal.OpName}: {refusal.Message}) ({sw.ElapsedMilliseconds}ms)");
            return PushResponse.RejectedResult(
                new List<PushConflict> { new() { Name = refusal.OpName, Reason = refusal.Message, Code = BridgeErrorCodes.BadRequest } },
                currentProjectVersion ?? ProjectSnapshot.Walk(ide, operation: "push-reject").ProjectVersion);
        }

        var conflicts = PushConflicts.DetectConflicts(ops, request.ExpectedProjectVersion, request.Force,
                                                      currentVersions, currentProjectVersion, walk.Complete,
                                                      // the IDE resolves a name case-insensitively (itemCache), so this does too
                                                      new HashSet<string>(walk.UnreadableObjects.Select(o => o.Name), StringComparer.OrdinalIgnoreCase));
        PushResponse RejectAll(List<PushConflict> refused)
        {
            VoltLog.Info($"push {ops.Count} ops — REJECTED ({refused.Count} conflicts: {string.Join(", ", refused.Take(5).Select(c => c.Name))}{(refused.Count > 5 ? "..." : "")}) ({sw.ElapsedMilliseconds}ms)");
            // COMPUTED ON DEMAND when the pre-flight skipped it. A `--force` push with no lease never builds the version
            // map, and a rejection publishes `currentProjectVersion` regardless — so without this it handed back `""`
            // where it had always given the real hash. A rejection is not the hot path.
            return PushResponse.RejectedResult(refused,
                currentProjectVersion ?? ProjectSnapshot.Walk(ide, operation: "push-reject").ProjectVersion);
        }

        // THE LEASE IS ANSWERED WITHOUT THE PRE-FLIGHT: the project moved since the client read it, so no item's verdict
        // means anything until it pulls (openspec `push-keeps-what-landed` design D1). The gate's own list goes with it.
        if (conflicts.Any(c => c.Code == ConflictCodes.StaleProjectVersion)) return RejectAll(conflicts);

        var pushedDeclarations = DeclarationsIn(ops);

        // VALIDATE EVERY OP BEFORE APPLYING ANY OF THEM. Ops are applied in a loop and a throw returns
        // immediately, so whatever had already been written STAYS written — a push of 174 items refused on the
        // 158th left 157 objects in the project and a workspace that had pushed none of them. Measured on
        // `Lenze_MID-S100`.
        //
        // Everything decidable from the SOURCE TEXT alone is decided here, where nothing has been touched yet:
        // a malformed ST document, network text that does not parse or is not canonical, a duplicate child. That
        // is the class a real push fails on, and it is exactly the class that needs no IDE to detect. It used to
        // run per-op instead, just ahead of the rename inside `ApplySetItem` — which guarded that one step and
        // nothing before it; hoisting it here subsumed that guard, so the local copy is gone rather than left
        // as a call that can no longer throw.
        //
        // The driver is asked too (`ICodeStore.ValidateSource`), for the refusals it can decide from the text
        // without touching the IDE — TwinCAT's PLCopen writer refuses several body shapes from a pure function
        // of the parsed model, and those used to fire from inside the write with earlier ops already landed.
        //
        // What this still does NOT make atomic is a refusal that genuinely needs the LIVE project: a type the
        // driver cannot resolve, a body the IDE itself rejects on import. Those stay possible, and the apply loop
        // below reports them in structure: what landed, the refused op, and every op it did not reach.
        var applied = new List<(string Action, string Name)>();  // what each op did, for the write receipt in the log
        var opTotal = ops.Count;

        // A refusal here reads EXACTLY like one from the apply loop below — same conflict shape, same codes. The
        // client cannot tell which pass refused it, and should not have to: both mean "this op's text is not
        // something Volt can write". The difference is only in what is left behind, and pre-flight leaves
        // nothing.
        //
        // EVERY REFUSAL IS COLLECTED, and still nothing is written (openspec `push-keeps-what-landed` design D1). The
        // pre-flight returned at its FIRST refusal, and the gate's per-item conflicts returned before it ran at all, so a
        // batch with two malformed items — or a stale item and a malformed one — cost one round trip per refusal. The
        // pre-flight now runs over every op the gate did not name, and the answer is the UNION in request order, one
        // conflict per op: a client regenerates exactly the refused items and re-sends the rest unchanged. The batch
        // stays all-or-nothing — items reference each other (a pushed FB using a pushed DUT), so applying the rest lands
        // a project no op-level check can say builds.
        var refusedByGate = new HashSet<string>(conflicts.Select(c => c.Name), StringComparer.OrdinalIgnoreCase);
        var preflight = new List<PushConflict>();
        // EACH SET OP'S TEXT, READ AND VALIDATED ONCE (openspec bridge-refusal-review D8/D12), by the op's name — one op per
        // wire identity (RequireOneOpPerItem). The apply writes from these: no second read, no second validation.
        var validated = new Dictionary<string, ValidatedSource>(StringComparer.OrdinalIgnoreCase);
        foreach (var op in ops)
        {
            if (refusedByGate.Contains(op.Name)) continue;   // its text is about to be replaced by the pull its code asks for

            // AN ITEM THE DRIVER MUST NOT OPEN (DIALECT C2i) is refused here too, without force, by name. The gate lets
            // a delete of it through as idempotent — it has no version entry — and the pre-flight's other checks read
            // `itemCache`, which never holds it; so the first refusal used to be `ApplyToUnopened`'s, from the apply
            // loop, after the batch's earlier ops had landed.
            if (!request.Force && notOpened.ContainsKey(Materializer.Bare(op.Name)))
            {
                var u = walk.UnreadableObjects.First(o => o.Kinds is not null
                    && string.Equals(o.Name, Materializer.Bare(op.Name), StringComparison.OrdinalIgnoreCase));
                preflight.Add(ConflictFor(op, new BridgeException(BridgeErrorCodes.Unreadable, $"'{u.Name}' is not read: {u.Reason}")));
                continue;
            }

            // A READ-ONLY DESCRIPTOR (`.projectsettings`, `.device`, `.library`, …) is something the IDE RENDERS, not
            // something a push writes — on either vendor, whichever route materialized it. Refused by name, as what it
            // is. It used to reach the ST reader and come back INVALID_ST, "Unexpected composite POU kind", which
            // blamed the text for being what the file is meant to be. A DELETE of one is the same refusal: it used to pass
            // here (only sets were checked), so the batch's earlier ops landed and the delete then reached the vendor
            // object — TwinCAT's synthesized settings marker, whose parent read threw an unnamed binder error, or a live
            // CODESYS descriptor, removed.
            if (ReadOnlyKindOf(op) is { } readOnly)
            {
                preflight.Add(ConflictFor(op, new BridgeException(BridgeErrorCodes.Unsupported,
                    $"'{readOnly.Name}' is read-only: a {readOnly.Kind} descriptor is rendered from the IDE and is never " +
                    "pushed. Change it in the IDE and pull.")));
                continue;
            }

            if (op is not SetItemOp { SourceText: { } text } set) continue;
            // A `.task` is a DESCRIPTOR, not assembled ST, so it is gated by its own format. Routing it
            // through `ValidateSourceOrThrow` would refuse every task push as a malformed document.
            try
            {
                // …and the driver, for what its vendor cannot hold of the settings the gate read (`ICodeStore.ValidateTask`).
                if (ItemKind.IsTaskWireName(set.Name)) ide.ValidateTask(TaskDescriptorFormat.Gate(text));
                else
                {
                    var creating = WillCreate(walk, itemCache, Materializer.Bare(set.Name));
                    // Read by the kind of the name the op LANDS under — its extension, never the text's header.
                    var cached = itemCache.TryGetValue(Materializer.Bare(set.Name), out var held) ? held.Item : (ItemRef?)null;
                    var source = ValidateSourceOrThrow(ide, Materializer.Bare(set.Name), text, creating, pushedDeclarations,
                                          ItemKind.KindForWireName(set.ToName ?? set.Name)!, cached);
                    validated[set.Name] = source;
                    var bodies = source.Bodies;
                    // …and what only the DRIVER can decide without writing. This is the class the comment above
                    // used to name as out of reach — a body one vendor's format cannot express — and it is out
                    // of reach only for the ENGINE: TwinCAT's PLCopen writer is a pure function of the parsed
                    // body, so asking it here costs one throwaway serialization and moves a whole family of
                    // refusals in front of the first write. Proved live in
                    // `test/e2e/graphical/refused-shapes.test.ts`, which used to watch a two-item push write the
                    // first and refuse the second.
                    //
                    // EVERY BODY THE WRITE WOULD CREATE, and the driver says which those are: an update rewrites
                    // just the networks that CHANGED of a body the IDE holds, so such a body can legitimately carry
                    // a shape the whole-body writer refuses — an Execute box the engineer drew, in a network this
                    // edit does not touch — while a NEW member of the same item is created whole. This asked only
                    // on a new ITEM, so that member was refused mid-batch, after the earlier ops had landed
                    // (openspec bridge-refusal-review 2.28, D21). The driver is handed the item the op writes into
                    // (null for a create) and the MODELS the engine just validated, never the text (2.27, D8/D12).
                    if (bodies.Count > 0)
                        ide.ValidateSource(creating ? null : cached ?? ItemLookup.Find(ide, Materializer.Bare(set.Name)), bodies);
                }
            }
            catch (Exception ex) { preflight.Add(ConflictFor(op, ex)); }
        }
        if (conflicts.Count + preflight.Count > 0)
        {
            // REQUEST ORDER, each op at most once: a client reading the list top-down meets its ops in the order it sent
            // them. The gate names ops by their `name`, exactly as the pre-flight does.
            var position = ops.Select((op, i) => (op.Name, i)).GroupBy(x => x.Name, StringComparer.OrdinalIgnoreCase)
                              .ToDictionary(g => g.Key, g => g.First().i, StringComparer.OrdinalIgnoreCase);
            return RejectAll(conflicts.Concat(preflight)
                .Select((c, k) => (c, k))
                .OrderBy(x => position.TryGetValue(x.c.Name, out var at) ? at : int.MaxValue).ThenBy(x => x.k)
                .Select(x => x.c).ToList());
        }
        onProgress?.Invoke(new ProgressFrame { Operation = Ops.Push, Done = 0, Total = opTotal, Phase = "applying" });
        var inApplyOrder = InFolderDepthOrder(ops).ToList();
        var appliedOps = new List<PushOp>();
        List<PushConflict>? notLanded = null;
        for (var k = 0; k < inApplyOrder.Count; k++)
        {
            var op = inApplyOrder[k];
            var outcome = new OpOutcome();
            // A structured network-text diagnostic (parser / round-trip gate) carries a stable code + source
            // line; any other throw is reason-only. `ConflictFor` handles both, and is shared with the pre-flight.
            try { applied.Add((ApplyOp(ide, itemCache, notOpened, op, request.Force, validated, outcome), op.Name)); }
            catch (Exception ex)
            {
                // THE LIVE IDE REFUSED THIS OP, and the push STOPS here (openspec `push-keeps-what-landed`, design D2/D3).
                // The ops before it are written and are NOT rolled back — a delete cannot be undone, and a half-undone
                // push is worse than a half-done one — and the ops after it are not applied: going on would move the
                // project further from both the workspace's baseline and its HEAD. What of the refused op itself the IDE
                // kept is in its reason (`ConflictFor`).
                var refused = ConflictFor(op, ex, outcome);
                VoltLog.Info($"push {opTotal} ops — REFUSED at {op.Name} ({ex.Message}), {applied.Count} already applied ({sw.ElapsedMilliseconds}ms)");
                // Nothing applied in full → `accepted:false`, exactly as a pre-flight refusal: the one op's partial effect
                // (an update's declaration, a create whose removal failed) is stated in its reason, not in `accepted`.
                if (applied.Count == 0) return RejectAll(new List<PushConflict> { refused });
                // Something landed → `accepted:true` with the receipt and a conflict per op NOT landed, so "each op landed
                // unless a conflict names it" holds: the refused op, then every op after it in APPLY order.
                notLanded = new List<PushConflict> { refused };
                notLanded.AddRange(inApplyOrder.Skip(k + 1).Select(rest => new PushConflict
                {
                    Name = rest.Name, Code = ConflictCodes.NotAttempted,
                    Reason = $"not applied: the push stopped at '{op.Name}'",
                }));
                break;
            }
            appliedOps.Add(op);
            // Report AFTER applying (like FetchService), so the final frame carries Done == Total (100%).
            onProgress?.Invoke(new ProgressFrame { Operation = Ops.Push, Done = applied.Count, Total = opTotal });
        }

        // The partial path runs what the full path runs: on TwinCAT the applied ops are not saved without this.
        ide.FlushPendingWrites();

        // PRUNE THE FOLDERS THIS PUSH EMPTIED — the derivation Volt's git-shaped interface was missing.
        //
        // Git has no directory entity either (deleting the last file under `a/b/` records exactly that one
        // path) and still REMOVES the directory from the working tree, as a consequence of the file going.
        // Volt kept the IDE folder for ever, while git pruned the workspace side for free — so the two halves
        // diverged, silently and permanently, because an empty folder is UNREPRESENTABLE on the wire (the
        // `folders` map is keyed by item) and the next pull can neither see it nor report it as drift.
        //
        // Measured on both vendors before this was written: neither prunes on its own, and both expose the
        // primitive (`probe-empty-folder-lifecycle.py` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/probe-empty-folder-lifecycle.py`) for CODESYS; a COM tree walk for TwinCAT, where
        // `VltFold/New` and `VltFold/Old` both sat at children=0 after a folder rename moved every item out).
        //
        // The candidates are the folders items LEFT, read from the PRE-APPLY cache: a delete empties the
        // folder the item was in, and a move empties the one it came FROM. `PruneEmptied` then removes only
        // those that are actually empty afterwards, so a folder still holding anything — or one that was
        // already empty before this push, which is the engineer's — is untouched.
        // GUARDED, because it runs AFTER every op has landed and been flushed. It is the only step in this
        // method that is not inside the reject path, and it must not be: a prune is cosmetic, and it calls
        // into the live vendor (`ChildCount`, `ChildAt`, `Delete`) where a COM fault is an ordinary event —
        // `ItemLookup` and `BeckhoffDriver` both wrap `ChildCount` for exactly that reason. Letting one throw
        // out of here would fail a push that FULLY SUCCEEDED: no receipt, so the client never persists the new
        // baseline, and its next push reports a conflict over changes already in the IDE.
        // Over the APPLIED ops only: a refused or unattempted delete or move emptied nothing.
        try { TreeNav.PruneEmptied(ide, EmptiedFolders(itemCache, appliedOps)); }
        catch (Exception ex) { VoltLog.Warn($"push: could not prune an emptied folder: {ex.Message}"); }

        // The receipt is a FRESH FULL snapshot — the SAME walk /refs uses (ProjectSnapshot), NOT a reuse of the
        // pre-apply versions. A native rename on TwinCAT rewrites the referencing items, which are NOT in the op set
        // (DIALECT C2p; CODESYS does not), so reusing their pre-apply versions would report a stale baseline; the client persists this
        // receipt as its IDE baseline with no follow-up /refs, so it must match /refs exactly.
        //
        // WITH `returnSources` THE SAME WALK KEEPS THE TEXT of every item the push CHANGED (openspec
        // `st-roundtrip-fixed-point`, route A): each item a LANDED `set` left (under the name it landed as — `toName`
        // for a rename — matched as the IDE matches a name, keyed by the IDE's spelling), AND each item whose version
        // differs from the pre-apply walk's — the callers a native rename rewrote (TwinCAT, DIALECT C2p), which no op names (gate 3 review: a
        // client never told their text changed adopts their new version over the old text, and its next push of one
        // writes the old name back over the rename). An item named by a conflict (`name`, `renamedTo`) is re-read by
        // the client, never answered. The walk already materialized each item to hash its version, through the same
        // StWriter a fetch renders with — so the answer is what a read gives, its version the `newItems` one, and no
        // item is read twice. A delete leaves nothing, and an item the walk could not materialize is kept by no one.
        Func<string, string, bool>? keepText = null;
        if (request.ReturnSources == true)
        {
            var landed = LandedSetNames(appliedOps);
            var refused = new HashSet<string>(
                (notLanded ?? new List<PushConflict>()).SelectMany(c => new[] { c.Name, c.RenamedTo }).OfType<string>(),
                StringComparer.OrdinalIgnoreCase);
            keepText = (name, version) => !refused.Contains(name)
                && (landed.Contains(name) || !currentVersions.TryGetValue(name, out var before) || before != version);
        }
        var receipt = ProjectSnapshot.Walk(ide, operation: "push-receipt", keepText: keepText);
        var newSources = keepText is null ? null : receipt.Texts;

        // The receipt walk can be SHORT for the same reasons a read walk can, and the client rebuilds its
        // baseline from it — so it has to be told, exactly as `refs`/`fetch` tell it.
        if (notLanded is not null)
        {
            VoltLog.Info($"push {ops.Count} ops — accepted IN PART [{FormatApplied(applied)}], not landed: " +
                         $"{string.Join(", ", notLanded.Select(c => $"{c.Name} {c.Code}"))} ({receipt.FullVersions.Count} items) ({sw.ElapsedMilliseconds}ms)");
            var partial = PushResponse.PartialResult(receipt.ProjectVersion, receipt.FullVersions, receipt.Folders,
                                                     receipt.UnwalkedFolders, notLanded);
            partial.NewSources = newSources;
            return partial;
        }
        VoltLog.Info($"push {ops.Count} ops — accepted [{FormatApplied(applied)}] ({receipt.FullVersions.Count} items) ({sw.ElapsedMilliseconds}ms)");
        var accepted = PushResponse.AcceptedResult(receipt.ProjectVersion, receipt.FullVersions, receipt.Folders,
                                                   receipt.UnwalkedFolders);
        accepted.NewSources = newSources;
        return accepted;
    }

    /// <summary>The wire name each LANDED <c>set</c> op left its item under — <c>toName</c> for a rename, else
    /// <c>name</c> — case-insensitive, because the IDE resolves a name that way and the receipt keys it by the IDE's own
    /// spelling.</summary>
    private static HashSet<string> LandedSetNames(IEnumerable<PushOp> appliedOps) =>
        new(appliedOps.OfType<SetItemOp>().Select(set => set.ToName ?? set.Name), StringComparer.OrdinalIgnoreCase);


    /// <summary>What a refused op left behind of ITSELF, recorded by the write path as it happens — so the conflict is
    /// worded from what DID happen, after it happened (openspec <c>push-keeps-what-landed</c> design D2). Only a create
    /// can leave something: <see cref="Rollback"/> sets <see cref="Created"/> to the name it tried to remove, and
    /// <see cref="RollbackFault"/> when that removal itself failed (the object then stays in the project). An update's
    /// partial effect (its declaration, a member it deleted) is the member refusal's own text, from
    /// <c>MemberRefusal</c>.</summary>
    private sealed class OpOutcome
    {
        public string? Created;
        public Exception? RollbackFault;
        /// <summary>What of a refused UPDATE the IDE kept (its declaration, a member it deleted or created), when the
        /// refusal's own message does not already say it.</summary>
        public string? UpdateKept;
        /// <summary>What of a refused UPDATE the IDE kept when the member refusal's OWN text already says it
        /// (<c>MemberRefusal</c> words it into the exception, so <see cref="UpdateKept"/> stays null rather than say it
        /// twice). The fact without the words: it makes the conflict <c>partiallyApplied</c>.</summary>
        public bool KeptInRefusal;
        /// <summary>A native rename that ran before the op was refused: the IDE renamed the item (and, on TwinCAT,
        /// rewrote every reference to it — DIALECT C2p), and that stays — the item is no longer under the op's name. <c>From</c>/<c>To</c> are BARE
        /// (the reason's words); <c>WireName</c> is the FULL name the item now has (<c>PushConflict.RenamedTo</c>).</summary>
        public (string From, string To, string WireName)? Renamed;
        /// <summary>The forced replace of an item the IDE will not open deleted that object before its create was
        /// refused: the original is gone.</summary>
        public string? Replaced;
        /// <summary>The folders this op's CREATE made to place its item (a toFolder that did not exist yet), by path,
        /// recorded as each is made. A rollback removes the item, not them, so they stay — as a refused move's do
        /// (<c>RecordMoveKept</c>).</summary>
        public readonly List<string> FoldersCreated = new();

        /// <summary>Anything of the op stays in the project: every fact above except a create that was rolled back.</summary>
        public bool PartiallyApplied => UpdateKept is not null || KeptInRefusal || RollbackFault is not null
                                        || Renamed is not null || Replaced is not null || FoldersCreated.Count > 0;
    }

    /// <summary>The conflict a refused op is reported with — the pre-flight's and the apply loop's alike.
    ///
    /// <para><b>The code the refusal already computed, not just the parser's.</b> This read <c>netEx?.Code</c> alone, so
    /// only a network-text diagnostic kept its code and every <c>BridgeException</c> arrived as <c>code: null</c> —
    /// NOT_FOUND, UNSUPPORTED, DUPLICATE_CHILD, BAD_REQUEST, INVALID_ST. Since a push answers every refusal as a conflict
    /// rather than an error frame, those were unobservable as codes, and callers matched the English instead. The two
    /// vocabularies stay disjoint by construction: <c>BridgeException</c> implements <c>ICodedError</c>,
    /// <c>NetworkTextException</c> deliberately does not (it carries its own <c>Code</c>) — do NOT "tidy" that, or
    /// <c>PipeServer</c> would stamp a NETWORK_* value onto an ERROR FRAME.</para>
    ///
    /// <para><b>A driver's <c>NotSupportedException</c> IS an UNSUPPORTED refusal</b>, mapped here rather than rewritten
    /// at ~20 raise sites (a <see cref="ChildRefusedException"/> is one). And never null: anything that is not a coded
    /// error, a network-text diagnostic or a vendor "cannot" is a fault nobody classified, and INTERNAL_ERROR is exactly
    /// what the frame vocabulary calls that.</para>
    ///
    /// <para><b>The reason describes the refusal and nothing else</b> — no client instruction (no "volt pull", no "push
    /// again"): the CLI renders its own advice from the code, and a client that is not the CLI has no such command. Only
    /// what of the op the IDE KEPT is added, worded HERE, once, for a classified and an unclassified refusal alike: the
    /// live <c>METHOD Log</c> refusal arrived unclassified and WAS rolled back, and its reason said nothing of it.</para></summary>
    private static PushConflict ConflictFor(PushOp op, Exception ex, OpOutcome? outcome = null)
    {
        var netEx = ex as NetworkTextException;
        var code = (ex as ICodedError)?.ErrorCode
                   ?? netEx?.Code
                   ?? (ex is NotSupportedException ? BridgeErrorCodes.Unsupported : BridgeErrorCodes.InternalError);
        var reason = outcome?.Created switch
        {
            null when outcome?.UpdateKept is { } kept => $"{ex.Message} — {kept}",
            null => ex.Message,
            { } n when outcome.RollbackFault is null => $"{ex.Message} — '{n}' is not created (the create is rolled back)",
            { } n => $"{ex.Message} — '{n}' was created and could not be removed ({outcome.RollbackFault.Message}): " +
                     $"'{n}' remains in the project",
        };
        // The steps of the op that ran BEFORE the write that refused, and stay: a native rename (the item is no longer
        // under the op's name, so a client re-sending the op would name an item that is gone), and the delete of a forced
        // replace (the original object is gone).
        if (outcome?.Renamed is { } rn)
            reason += $" — '{rn.From}' was renamed to '{rn.To}' before it (the IDE rewrote the references to it) and stays renamed";
        if (outcome?.Replaced is { } replaced)
            reason += $" — the IDE's '{replaced}' was deleted before it, to be replaced, and stays deleted";
        foreach (var folder in outcome?.FoldersCreated ?? new List<string>())
            reason += $" — the folder '{folder}' was created before it and stays";
        var stale = ex as StaleItemVersionException;
        // The same facts as FIELDS (openspec `push-partially-applied-flag`), so a caller branches on them and never on
        // the reason above. Absent (null) when nothing of the op stays — never false.
        return new PushConflict
        {
            Name = op.Name, Reason = reason, Code = code, Line = netEx?.Line,
            YourVersion = stale?.YourVersion, CurrentVersion = stale?.CurrentVersion,
            PartiallyApplied = outcome?.PartiallyApplied == true ? true : null,
            RenamedTo = outcome?.Renamed?.WireName,
            Remains = outcome?.RollbackFault is not null ? true : null,
        };
    }

    /// <summary>A STALE ITEM VERSION caught at the last moment (<see cref="RequireUnchanged"/>,
    /// <see cref="RequireUnchangedBeforeDelete"/>), carrying both versions so its conflict row has the pre-apply gate's
    /// shape (<c>PushConflicts</c>): one code, one shape (openspec bridge-refusal-review 2.14/2.15, task 8.4).</summary>
    private sealed class StaleItemVersionException : BridgeException
    {
        public string YourVersion { get; }
        public string CurrentVersion { get; }
        public StaleItemVersionException(string yourVersion, string currentVersion, string message)
            : base(ConflictCodes.StaleItemVersion, message)
        {
            YourVersion = yourVersion;
            CurrentVersion = currentVersion;
        }
    }

    /// <summary>The folders items LEAVE in this push — a delete's folder, and a move's ORIGIN.
    ///
    /// <para>Read from the pre-apply cache, because after the ops run the item is no longer there to ask. A
    /// move's DESTINATION is deliberately absent: it has just gained an item and cannot be empty.</para></summary>
    private static IEnumerable<string> EmptiedFolders(
        Dictionary<string, (ItemRef Item, string Folder)> itemCache, IReadOnlyList<PushOp> ops)
    {
        foreach (var op in ops)
        {
            if (!itemCache.TryGetValue(Materializer.Bare(op.Name), out var cached)) continue;
            switch (op)
            {
                case DeleteItemOp:
                    yield return cached.Folder;
                    break;
                // A move, i.e. a set naming a DIFFERENT folder. `ToFolder` absent means "keep the current
                // folder" and is not a move — the same distinction `ApplySetItem` draws, and the empty string
                // is a real destination (the tree root) rather than an absence.
                case SetItemOp { ToFolder: { } to } when !string.Equals(to, cached.Folder, StringComparison.OrdinalIgnoreCase):
                    yield return cached.Folder;
                    break;
            }
        }
    }

    /// <summary>The ops, DEEPEST FOLDER FIRST — so a folder's contents are created before an item that shares
    /// the folder's name sits beside it.
    ///
    /// <para><b>TwinCAT will not create a folder whose name an object at that level already has</b> (DIALECT
    /// D34, measured across all four kind × order cells). The two may COEXIST happily; what is refused is
    /// making the FOLDER second, with the vendor's own words — <c>A file or folder with the name 'X' already
    /// exists on disk at this location</c>. So it is an ORDER constraint, and order is something a push can
    /// choose.</para>
    ///
    /// <para>Depth descending is SUFFICIENT and needs no name analysis: an item inside <c>F/X</c> has folder
    /// depth <c>depth(F)+1</c> while the item named <c>X</c> at <c>F</c> has <c>depth(F)</c>, so the child
    /// always sorts first, at any nesting. Measured cost: `lenze-mid` holds a folder `UDT_CamControlLS/` beside
    /// a DUT of that name — the only such pair in six real projects — and four of its DUTs could not be
    /// migrated without this.</para>
    ///
    /// <para><b>STABLE, and that matters more than the sort.</b> Ops at equal depth keep the order they
    /// arrived in, so this adds one rule and changes nothing else. It also does not make order a CONTRACT:
    /// nothing may depend on it for correctness — a push already carries its own declarations precisely
    /// because two items can reference each other and no order can satisfy both (see
    /// <see cref="DeclarationsIn"/>). This is a preference that removes a vendor refusal, not a guarantee.</para></summary>
    private static IEnumerable<PushOp> InFolderDepthOrder(IReadOnlyList<PushOp> ops) =>
        ops.Select((op, i) => (op, i))
           .OrderByDescending(x => x.op is SetItemOp { ToFolder: { } f } ? Depth(f) : 0)
           .ThenBy(x => x.i)
           .Select(x => x.op);

    /// <summary>How many folders deep a placement is. Empty or null is the top level, depth 0.</summary>
    private static int Depth(string folder) =>
        string.IsNullOrEmpty(folder) ? 0 : folder.Count(c => c == '/') + 1;

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

    /// <summary>Every declaration arriving in this push, by BARE name — the push's own answer to "what type is
    /// this?", which the IDE cannot always give.
    ///
    /// <para>A graphical box can call through a name its own POU does not declare. Resolving it walks OTHER
    /// items' declarations (`Mach1_AuxData.IEC_TIMERS.OffDelayLockDrives` = a GVL, a struct, then the timer),
    /// and the driver asked the live IDE for them. That answers only for items that are ALREADY there: pushing
    /// a whole project into an empty one failed on `Mach1_Drives` because the struct it walks through was
    /// hundreds of ops further down the same push. Op order is not a contract and cannot be made one — two
    /// items may legitimately reference each other — so the answer is not to sort the ops, it is to stop asking
    /// a question the push already holds the answer to.</para>
    ///
    /// <para>BARE names, because that is the key the resolver walks with — the IDE's own lookup key. The wire
    /// carries FULL names (`Mach1_AuxData.gvl`), converted here exactly as <see cref="ApplyOp"/> does.</para>
    ///
    /// <para>Each item carries its WIRE KIND too, so a pushed GVL is a global list by its extension, never by its
    /// first code line (openspec <c>push-without-header-check</c> 5.Q.7, <see cref="PushedDeclarations"/>).</para>
    ///
    /// <para>Built ONCE per push, after the pre-flight refused two ops on one wire name
    /// (<see cref="RequireOneOpPerItem"/>). Two KINDS of one bare name can still both be here; the first keeps the
    /// name.</para></summary>
    private static PushedDeclarations DeclarationsIn(IReadOnlyList<PushOp> ops)
    {
        var items = new List<(string Name, string? Kind, string Declaration)>();
        foreach (var op in ops)
        {
            if (op is not SetItemOp { SourceText: { } src } set) continue;
            // The name the item will HAVE — a rename+edit is indexed under its new name, because the bodies
            // being pushed alongside it are the ones that reference it by that name.
            var wireName = set.ToName ?? set.Name;
            if (ItemKind.IsTaskWireName(wireName)) continue;   // a descriptor declares nothing
            var name = Materializer.Bare(wireName);
            var kind = ItemKind.KindForWireName(wireName)!;   // a wire name, checked by RequireWireNames

            // A source text that does not parse is NOT failed here. This index is a lookup, and the op that
            // carries the bad text is the one that must report it — with its own name, its own line number and
            // the whole apply loop's error handling around it. Failing here would blame the first item pushed.
            try { items.Add((name, kind, StReader.Read(src, kind).Declaration)); }
            catch (Exception) { /* the op's own write reports it */ }
        }
        return PushedDeclarations.FromWire(items);
    }

    /// <summary>REFUSE IF THE ITEM MOVED UNDER US — the last-moment check, against the state the IDE is in
    /// RIGHT NOW rather than the pre-apply walk.
    ///
    /// <para>The per-item <c>ifVersion</c> gate runs ONCE, in the walk that precedes the batch, and a real
    /// push then hashes every item in the project, resolves conflicts and applies every earlier op before
    /// reaching this one. On TwinCAT the IDE stays interactive the whole time, so an engineer can move, delete
    /// or edit the very item we are about to write inside that window — and the check meant to protect them
    /// ran before they touched it.</para>
    ///
    /// <para>This narrows the window; nothing here can close it, because nothing can hold the IDE still. What
    /// it guarantees is that an edit made BEFORE this line is never silently overwritten.</para>
    ///
    /// <para>The <see cref="Versioning.Unreadable"/> exemption is correct and load-bearing: you cannot
    /// re-verify a hash that could never be computed in the first place.</para></summary>
    private static void RequireUnchanged(string name, string? folder, ItemContent live, string? ifVersion)
    {
        if (ifVersion is not { } expected || expected == Versioning.Unreadable) return;

        // NOT `folder ?? ""`. `Hasher.ComputeItemVersion` requires both inputs for a stated reason: an item at
        // the project ROOT and an item whose folder failed to read would hash identically, so defaulting turns
        // a failure into "no change". An `ifVersion` only reaches here for an item the walk found, where the
        // folder is never null - so a null IS a bug, and saying so beats hashing something that merely looks
        // right.
        if (folder is null)
            throw new BridgeException(BridgeErrorCodes.InternalError,
                $"'{name}': cannot verify the item version without its folder");

        // A STALE ITEM VERSION, and coded as one (openspec bridge-refusal-review 2.14): the pre-apply gate's own code for
        // the same fact. It answered BAD_REQUEST, which tells a client its request was malformed.
        var now = Hasher.ComputeItemVersion(folder, StWriter.Write(live));
        if (now != expected)
            throw new StaleItemVersionException(expected, now,
                $"'{name}' changed in the IDE while this push was being applied — refusing to overwrite it.");
    }

    /// <summary>The same check for a DELETE, which has to read the item to make it — and reads it for that
    /// reason alone, on an item it is about to destroy. Worth one read: a delete is the single op that cannot
    /// be undone, so a concurrent edit lost here is lost for good, and the receipt would report the item
    /// cleanly gone while status said in sync.</summary>
    private static void RequireUnchangedBeforeDelete(IIdeDriver ide, string name, ItemRef item, string? folder, string? ifVersion)
    {
        if (ifVersion is not { } expected || expected == Versioning.Unreadable) return;
        if (folder is null) return;   // no folder, no comparable hash — the walk could not have produced one either

        // THE SAME BASIS THE WALK USED, not the ST writer. A delete can target ANY addressable item, and a
        // non-source one — a `.task` — is versioned from its MANIFEST, not from assembled ST. Hashing
        // `StWriter.Write(ReadContent(...))` for it produces a value the client could never have been given,
        // so every task delete would be refused as "changed in the IDE". `Versioning.SafeVersion` is the one
        // place that knows which basis a kind uses, and an unreadable item comes back as the sentinel, which
        // the caller above has already exempted.
        var kind = ItemKind.Map(ide.KindCode(item));
        if (kind is null) return;
        var now = Versioning.SafeVersion(ide, name, kind, item, folder).Version;
        // A stale item version, coded as the set arm's (openspec bridge-refusal-review 2.15).
        if (now != Versioning.Unreadable && now != expected)
            throw new StaleItemVersionException(expected, now,
                $"'{name}' changed in the IDE while this push was being applied — refusing to delete it.");
    }

    /// <summary>Apply one op and return a short label of what it did (created/updated/renamed/moved/deleted),
    /// used only for the log receipt.</summary>
    private static string ApplyOp(IIdeDriver ide,
        Dictionary<string, (ItemRef Item, string Folder)> itemCache, IReadOnlyDictionary<string, string> notOpened,
        PushOp op, bool force, IReadOnlyDictionary<string, ValidatedSource> validated, OpOutcome outcome)
    {
        // The wire carries FULL names; the IDE is extensionless. Convert once, here, at the boundary.
        var name = Materializer.Bare(op.Name);
        var inCache = itemCache.TryGetValue(name, out var cached);
        ItemRef? existing = null;
        if (inCache) existing = cached.Item;
        else
        {
            var (found, untouchable) = ItemLookup.Locate(ide, name);
            if (untouchable is { } u) return ApplyToUnopened(ide, u, notOpened, op, force, validated, outcome);
            existing = found;
        }
        var currentFolder = inCache ? cached.Folder : "";

        switch (op)
        {
            case SetItemOp set when ItemKind.IsTaskWireName(set.Name):
                return ApplySetTask(ide, name, existing, set, outcome);
            case SetItemOp set:
                return ApplySetItem(ide, name, existing, currentFolder, set, force, validated, outcome);
            // A DELETE NAMES ONE WIRE ITEM, and the bare lookup above cannot say which: `X.dut` and `X.pou` both
            // resolve to the object `X`. So the op's kind is checked against the object's own kind, and a delete of a
            // name of another kind finds nothing, with or without force (force drops a version gate; it never widens
            // what a name means). Every kind has one extension, so the kind and the bare name are the whole wire name.
            case DeleteItemOp when existing is { } found && !NamesThisItem(ide, found, op.Name):
                return "no-op";
            case DeleteItemOp when existing is { } del:
                // THE SAME LAST-MOMENT CHECK THE SET ARM DOES, and for a stronger reason: this is the one op
                // that cannot be undone. The per-item `ifVersion` gate runs once in the pre-apply walk, and a
                // real push then hashes the whole project, resolves conflicts and applies every earlier op —
                // on TwinCAT the IDE stays interactive throughout. The caller sent the strongest guard the
                // wire offers and it was checked against a snapshot stale by the length of the batch, so an
                // engineer's edit landing in that window was destroyed by the delete, reported as gone, and
                // status said in sync.
                // `inCache ? … : null`, NOT `currentFolder`. That variable collapses "the item is at the
                // project ROOT" and "this push never saw the item in its walk, so it has no idea where it is"
                // onto the same empty string — harmless for the set arm, which is about to write a folder
                // anyway, and wrong here: the guard hashes the item's CURRENT folder into the version it
                // compares, so an item resolved by `ItemLookup.Find` (the walk skipped its subtree) would be
                // hashed against the root, never match, and be refused with a message blaming a concurrent
                // edit that never happened. Null is the honest answer and the guard already stands down on it.
                RequireUnchangedBeforeDelete(ide, name, del, inCache ? cached.Folder : null,
                                             force ? null : op.IfVersion);
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

    /// <summary>An op on an item the driver names but must not OPEN (<see cref="ItemLookup.Untouchable"/>: a TwinCAT POU
    /// whose text the IDE does not read as a POU, whose tree item crashes TcXaeShell after a load — DIALECT C2i).
    ///
    /// <para>Without force it is refused UNREADABLE, by name, like every unreadable item (the pre-flight already
    /// refused a set; a delete reaches here). With force — the documented way past an unreadable item — it is
    /// handled through the PARENT, by name, never through the item's own handle: a delete is the parent's delete, and
    /// a set deletes it and creates the pushed item in its place (the same folder unless the op moves it). Both were
    /// measured to leave the IDE alive. An op whose extension names a kind the object cannot be (it is a POU) does
    /// not reach it: the name means another item, and force never widens what a name means.</para></summary>
    private static string ApplyToUnopened(IIdeDriver ide, ItemLookup.Untouchable u,
        IReadOnlyDictionary<string, string> notOpened, PushOp op, bool force,
        IReadOnlyDictionary<string, ValidatedSource> validated, OpOutcome outcome)
    {
        if (!force)
            throw new BridgeException(BridgeErrorCodes.Unreadable,
                $"'{u.Name}' is not read: {u.Reason}");
        if (ItemKind.KindForWireName(op.Name) is not { } kind || !u.Kinds.Contains(kind))
            throw new BridgeException(BridgeErrorCodes.Unreadable,
                $"'{op.Name}' names a {ItemKind.KindForWireName(op.Name) ?? "?"}, and the IDE's '{u.Name}' is a {string.Join(" or ", u.Kinds)} that is " +
                $"not read ({u.Reason}). Delete or replace it under its own kind.");

        switch (op)
        {
            case DeleteItemOp:
                ide.Delete(u.Parent, u.Name);
                return "deleted";
            case SetItemOp set:
                if (set.SourceText is null)
                    throw new BridgeException(BridgeErrorCodes.BadRequest,
                        $"set '{set.Name}': '{u.Name}' is replaced, not updated, so the op needs sourceText");
                // The folder it sits in comes from the walk that named it; without it the recreate would land at the
                // root — a move nobody asked for.
                var folder = set.ToFolder ?? (notOpened.TryGetValue(u.Name, out var f) ? f
                    : throw new BridgeException(BridgeErrorCodes.InternalError,
                        $"'{u.Name}' is not opened, and this push's walk did not say which folder it sits in"));
                var wireName = set.ToName ?? set.Name;
                ide.Delete(u.Parent, u.Name);
                outcome.Replaced = u.Name;   // gone from here on, whatever the create below does
                WriteItemFromSource(ide, Materializer.Bare(wireName), wireName, existing: null,
                                    SourceOf(validated, set), folder, outcome);
                return "replaced";
            default:
                throw new BridgeException(BridgeErrorCodes.BadRequest,
                    $"push op for '{u.Name}' has no recognised 'op' discriminator — expected \"set\" or \"deleteItem\".");
        }
    }

    /// <summary>Is <paramref name="wireName"/> the wire name of <paramref name="item"/>, the object the bare lookup
    /// resolved it to? The kinds must agree — the tree says what the object IS, the extension what the op names. Every
    /// kind has ONE extension (a DUT is <c>X.dut</c>, openspec <c>push-without-header-check</c> 5.P), so the kind and
    /// the bare name are the whole wire name: no content is read, and an item whose content cannot be read is
    /// deleted by its name under the generic unreadable rule like any other.</summary>
    private static bool NamesThisItem(IIdeDriver ide, ItemRef item, string wireName)
    {
        var kind = ItemKind.Map(ide.KindCode(item));
        return kind is not null && kind == ItemKind.KindForWireName(wireName);
    }

    /// <summary>EVERY NAME A PUSH OP CARRIES — its <c>name</c> and a set's <c>toName</c> — IS A WIRE NAME: its
    /// extension names an item kind, as every name <c>refs</c>/<c>fetch</c> publish does. Anything else is refused
    /// <c>BAD_REQUEST</c> before a read or a write, forced or not.
    ///
    /// <para><b>Why a name with no kind cannot just be tried.</b> The apply resolves an op by its BARE name, so
    /// <c>X</c> or <c>X.foo</c> reaches whatever object is called <c>X</c>, while every check keyed by the full name
    /// misses it: the version gate finds no such key and passes a set as a create, and the kind check has no kind to
    /// hold the text to — so such a set overwrote the live object with no version check (forced, it also moved it).
    /// Force drops a version gate; it never makes a name mean something. The retired per-subtype DUT names and
    /// per-kind POU names are such names: a DUT is <c>X.dut</c> and a POU <c>X.pou</c> (openspec
    /// <c>push-without-header-check</c> 5.P, 5.Q).</para></summary>
    private static void RequireWireNames(IEnumerable<PushOp> ops)
    {
        foreach (var op in ops)
            foreach (var name in new[] { op.Name, (op as SetItemOp)?.ToName })
                if (name is not null && ItemKind.KindForWireName(name) is null)
                    throw new PushRefusal(op.Name,
                        $"'{name}' is not a wire name: its extension names no item kind. A push names each item " +
                        "exactly as refs/fetch published it, so this op could only be " +
                        "applied by guessing which item it means. Pull, and push the names the workspace holds.");
    }

    /// <summary>ONE OP PER WIRE IDENTITY (openspec <c>push-without-header-check</c> 5.Q.6, design 5.Qb Q2). The identities
    /// an op touches are its <c>name</c> and a set's <c>toName</c>, compared case-insensitively as identity is everywhere
    /// else; a second op touching one is refused, before anything is applied.
    ///
    /// <para><b>Why.</b> The apply resolves each op from the PRE-APPLY walk's cache, which a delete never updates. So
    /// <c>deleteItem X</c> + <c>set X</c> wrote through the handle of the object it had just deleted, and <c>set X</c> +
    /// <c>deleteItem X</c> wrote it and then deleted it: either way the object was GONE, and with it the class the wire
    /// does not carry — measured forced on a Pro2193 copy (<c>scripts/merged-classes.log</c>): a persistent list deleted
    /// and the push failing on its dead GUID, a check function deleted under an ACCEPTED push. The CLI sent this batch
    /// for a file moved and edited past git's rename threshold; it pairs the two rows into one move+edit now.</para>
    ///
    /// <para>Two kinds of one BARE name (<c>deleteItem X.pou</c> + <c>set X.dut</c>, either order) are two wire
    /// identities, but the apply's cache is keyed by the BARE name — the IDE's own lookup key — so the set resolved
    /// the handle of the POU the delete had just removed: a push REJECTED with one item already written. That pair
    /// is refused here too, by name. Writing a re-type in one push is <c>bridge-refusal-review</c>'s (its 4.32
    /// "re-type route"); two SETS of one bare name are not this rule's (a fb and its visualization are two IDE
    /// objects, and a set never touches a visualization).</para></summary>
    private static void RequireOneOpPerItem(IEnumerable<PushOp> ops)
    {
        var touchedBy = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var deletedBare = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);   // bare → wire name
        var setBare = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var op in ops)
            foreach (var name in new[] { op.Name, (op as SetItemOp)?.ToName }.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                if (name is null) continue;
                var verb = op is DeleteItemOp ? "deleteItem" : "set";
                if (touchedBy.TryGetValue(name, out var first))
                    throw new PushRefusal(op.Name,
                        $"'{name}' is named by two ops in this push ({first}, {verb}). One op per item: an update, a " +
                        "rename and a move are one `set`; a delete and a create of the same name are two pushes.");
                touchedBy[name] = verb;

                var bare = Materializer.Bare(name);
                var (mine, other) = op is DeleteItemOp ? (deletedBare, setBare) : (setBare, deletedBare);
                if (other.TryGetValue(bare, out var otherName))
                    throw new PushRefusal(op.Name,
                        $"'{otherName}' and '{name}' are one IDE object '{bare}' (the IDE names an object without its " +
                        "kind), and this push deletes one and sets the other. A re-type in one push is not written: " +
                        "delete in one push, create in the next.");
                if (!mine.ContainsKey(bare)) mine[bare] = name;
            }
    }

    /// <summary>Create or update a TASK from its descriptor — the one non-source kind a push may write.
    ///
    /// <para>The body was already GATED in the pre-flight, and is gated again here for the same reason every
    /// other write re-checks: this method is reachable on its own and a silent reshape of a schedule is worse
    /// than a refusal. Gating is a parse, not an IDE call, so it costs nothing worth saving.</para>
    ///
    /// <para>DELETING a task needs nothing here: `.task` is pushable now, so a removed file becomes an
    /// ordinary <c>deleteItem</c> op and the generic delete removes the object. What a task does NOT get is
    /// the move path — <c>MoveItem</c> refuses a non-source kind, and a task lives in the Task Configuration
    /// by definition, so there is nowhere for it to move to.</para></summary>
    private static string ApplySetTask(IIdeDriver ide, string name, ItemRef? existing, SetItemOp op, OpOutcome outcome)
    {
        if (op.SourceText is not { } src)
            throw new BridgeException(BridgeErrorCodes.BadRequest,
                $"set '{op.Name}': a task carries all of its state in its descriptor, so a push over one must " +
                "send sourceText (there is no separate body to leave unchanged).");
        var settings = TaskDescriptorFormat.Gate(src);

        ItemRef task;

        ItemRef? createdParent = null;   // set only when THIS op creates the task
        var action = "updated";
        if (existing is { } found)
        {
            task = found;
            // A renamed `.task` file is a renamed TASK, through the IDE's own rename, so whatever the IDE rewrites
            // of what references the task by name it rewrites (a POU reference is rewritten on TwinCAT and not on
            // CODESYS, DIALECT C2p; a task reference is unmeasured) — Volt rewrites nothing of its own.
            if (op.ToName is { } toName && !string.Equals(Materializer.Bare(toName), name, StringComparison.Ordinal))
            {
                ide.Rename(task, Materializer.Bare(toName));
                // Recorded the moment the rename RETURNS, before the re-find: a re-find that misses (a stale tree) does
                // not undo it, and the conflict must say the task is no longer under its old name.
                outcome.Renamed = (name, Materializer.Bare(toName), toName);   // kept if anything after it is refused
                task = ItemLookup.Find(ide, Materializer.Bare(toName))
                    ?? throw new BridgeException(BridgeErrorCodes.NotFound,
                        $"task '{name}' could not be found after being renamed to '{toName}'");
                action = "renamed+updated";
            }
        }
        else
        {
            createdParent = TreeNav.ResolveTaskParent(ide, op.ToFolder, outcome.FoldersCreated);
            task = ide.CreateChild(createdParent.Value, name, ItemKind.PlcTask);
            action = "created";
        }

        // A REFUSED TASK CREATE LEAVES NOTHING BEHIND — the same rule as an item's, for the same reason, and it
        // was missing here.
        //
        // `WriteTask` refuses a setting this vendor cannot express, by name and on purpose: TwinCAT has no
        // spelling for a CODESYS TIME literal, so `Interval: t#4ms` is rejected rather than rounded into a
        // number that means something else. Correct — and the task had already been CREATED, so the project
        // kept an empty one wearing the engineer's name, with no schedule at all.
        //
        // MEASURED: migrating `bakon-nano` into a blank TwinCAT project refused `RecipeTask.task` on its
        // interval and left the task behind; the recovery pull then hit `CONFLICT in 1 file(s)` on that very
        // file — the workspace had dropped it (refused) while the IDE still held the shell. A task with no
        // schedule is worse than a POU shell: it is in the call chain and runs nothing.
        //
        // AN UPDATE'S REFUSED WRITE MAY HAVE LANDED PART OF ITSELF — neither vendor's `WriteTask` is atomic (TwinCAT
        // applies the schedule and deletes the old calls before it refuses the call list; CODESYS sets `kind_of_task`
        // before a later member refuses), and the engine cannot see inside it. So it ASKS: the task's descriptor is read
        // before the write and again after the refusal, and a difference is what stays (review of
        // `push-partially-applied-flag` 1+2).
        var before = createdParent is null ? ide.ReadManifest(task, ItemKind.Kinds.Task) : null;
        try
        {
            ide.WriteTask(task, settings);
        }
        catch when (createdParent is { } parent && Rollback(ide, parent, name, outcome))
        {
            throw;   // unreachable: the filter returns false, so the original refusal propagates untouched.
        }
        catch when (before is not null && RecordKept(outcome, TaskKept(ide, outcome.Renamed?.To ?? name, before)))
        {
            throw;   // unreachable: the filter returns false.
        }
        return action;
    }

    /// <summary>Apply one unified change. A rename uses the IDE's native rename (TwinCAT rewrites the call sites,
    /// CODESYS does not — DIALECT C2p) and
    /// precedes a move; a move recreates in the new folder (name kept ⇒ name-based references survive); a
    /// content change goes through the shared full-fidelity writer. Each facet absent = unchanged.</summary>
    private static string ApplySetItem(IIdeDriver ide, string name, ItemRef? existing,
                                   string currentFolder, SetItemOp op, bool force,
                                   IReadOnlyDictionary<string, ValidatedSource> validated, OpOutcome outcome)
    {
        // An EMPTY sourceText is not refused here: a DUT or a GVL is written as sent, empty or not, and a POU or an
        // interface with no text was already refused by the pre-flight's read (it has nothing to split).

        // CREATE — no existing item; sourceText is required, toFolder is the placement.
        if (existing is not { } item)
        {
            if (op.SourceText is null)
                throw new BridgeException(BridgeErrorCodes.BadRequest, $"set '{op.Name}': a new item needs sourceText");
            WriteItemFromSource(ide, name, op.Name, existing: null, SourceOf(validated, op), op.ToFolder, outcome);
            return "created";
        }

        var currentName = name;
        var renamed = false;
        var toName = op.ToName is { } t ? Materializer.Bare(t) : null;
        // ORDINAL, because this asks "did the NAME change", not "does it name the same thing".
        //
        // It was OrdinalIgnoreCase, and IEC identifiers being case-insensitive is exactly why that reads as
        // right and is not: `Calc` and `calc` DO name the same object, so the comparison answered "no change"
        // and the rename never ran. The push reported accepted, the IDE kept the old spelling, and the receipt
        // baked the pushed spelling into the client's baseline — so `volt status` said in sync over an edit that
        // landed nothing, which is the worst class there is. Every other identity compare in the repo is
        // case-INsensitive on purpose; this one is not an identity compare.
        //
        // The pushed name is what the engineer typed, and casing is the whole content of this edit: it is what
        // the IDE displays and what the workspace file is called.
        var moves = op.ToFolder is { } dest && !string.Equals(dest, currentFolder, StringComparison.OrdinalIgnoreCase);
        // The last-moment check of a content write — see `WriteItemFromSource` — and FORCE skips it there too.
        var lastMomentVersion = force ? null : op.IfVersion;
        var renames = toName != null && !string.Equals(toName, currentName, StringComparison.Ordinal);
        // THE LAST-MOMENT CHECK OF AN EDIT THAT ALSO RENAMES OR MOVES RUNS FIRST, before anything of the op lands — not in
        // the write after it. The native rename rewrites the item's OWN header (`FUNCTION_BLOCK Old` -> `FUNCTION_BLOCK
        // New`), so its version after the rename is never the client's: checked in the write, every rename+edit was refused
        // STALE_ITEM_VERSION — after the rename had run (and, on TwinCAT, rewritten every call site), which stayed. Measured live
        // 2026-10-04 (CODESYS SP21, openspec `push-partially-applied-flag` 3.1). And a move's write (`MoveItem`) hashes
        // against the DESTINATION folder and was handed no version at all, so a move+edit (or rename+move+edit) of an
        // item edited in the IDE meanwhile overwrote that edit and reported accepted (gate review of step 3). Checked here,
        // once, against the item and folder the client's version names: an item edited in the IDE meanwhile is refused
        // before the rename, the move and the write. An edit in place keeps its check in the write, where the content
        // read for the format guard is already in hand.
        if (op.SourceText is not null && (renames || moves) && lastMomentVersion is not null)
        {
            RequireUnchanged(name, currentFolder, ide.ReadContent(item), lastMomentVersion);
            lastMomentVersion = null;   // checked, against the right state: the write after the rename must not re-ask
        }
        if (renames && toName is not null)
        {
            // THE PUSHED TEXT IS ALREADY VALIDATED, by the batch pre-flight in `Handle` — nothing that could
            // be refused on its text is still in flight by the time a rename runs. It used to be re-checked
            // right here, because a native rename on TwinCAT rewrites every reference to this POU across the
            // project (DIALECT C2p; CODESYS rewrites none): the largest change in this method, and once the first
            // thing a set op did. A rename+edit whose edit was then rejected left the item renamed (and its call
            // sites rewritten) while the push
            // reported failure, with nothing to put it back.
            //
            // Pre-flighting the WHOLE BATCH subsumes that guard and covers the ops before this one too, so the
            // local re-parse became a call that could never throw. What neither can pre-check is a refusal that
            // depends on the item's LIVE state (an unsupported body, a language change) — those are still
            // caught by the write, which is why the ORDER below (content, then move) stays as it is.
            ide.Rename(item, toName);                  // native rename → TwinCAT rewrites references (DIALECT C2p)
            currentName = toName;
            // Recorded the moment the rename RETURNS — before the re-find below, whose miss (a stale tree) does not undo
            // it. Withdrawn only where the IDE is shown to have ignored it (the case-only check).
            outcome.Renamed = (name, currentName, op.ToName!);   // kept if a later step of this op is refused (`ConflictFor`)
            // Refresh the staled handle, and FAIL on a miss. The rename reported success, so the item MUST be
            // findable under its new name; keeping the pre-rename handle writes the pushed content onto the OLD
            // identity and still returns "renamed+updated", which the receipt then bakes into the baseline.
            item = ItemLookup.Find(ide, currentName)
                ?? throw new BridgeException(BridgeErrorCodes.NotFound,
                    $"renamed '{name}' to '{currentName}' but the renamed item cannot be found — refusing to " +
                    "write through the pre-rename handle");

            // AND THE RENAME ACTUALLY TOOK. The lookup above is case-INsensitive — it has to be, that is the
            // identity rule everywhere else — so on a CASE-ONLY rename it finds the item under its OLD spelling
            // and cannot tell a performed rename from an ignored one. It is the only step in this method whose
            // success it cannot verify.
            //
            // BOTH VENDORS DO PERFORM IT, measured live 2026-09-01 (CODESYS 3.5.21.40 and TcXaeShell 15.0):
            // `VltE2E_caseprobe` came back as `VltE2E_caseprobE` on each. So this is not covering for a known
            // vendor limit — it is covering for the fact that we could not otherwise KNOW. An IDE that quietly
            // no-ops the call would have the push report "renamed", the receipt bake the new spelling into the
            // client's baseline, and `volt status` say in sync while the IDE shows the old name, for as long as
            // the workspace exists.
            //
            // (An earlier run of that measurement said TwinCAT ignored it. That reading came from a connector
            // still running the previously-published worker — a STALE BRIDGE, the trap this repo has hit before.
            // Re-measured against a freshly built worker, the two vendors agree.)
            var landed = ide.Name(item);
            if (!string.Equals(landed, currentName, StringComparison.Ordinal))
            {
                outcome.Renamed = null;   // the IDE kept the old spelling: nothing was renamed
                throw new BridgeException(BridgeErrorCodes.Unsupported,
                    $"this IDE did not apply the rename '{name}' -> '{currentName}': the item is still called " +
                    $"'{landed}'. A rename that changes only LETTER CASE is not supported here; a name that " +
                    "differs by more than case is.");
            }
            renamed = true;
        }

        // A toFolder that differs from the item's current folder is a MOVE. ABSENT (null) means “keep the
        // current folder”, so an in-place edit that doesn't restate the full tree path isn't misread as a move.
        //
        // THE EMPTY STRING IS A DESTINATION, NOT AN ABSENCE — the tree root, which on CODESYS is the project's
        // own POU pool. This read `{ Length: > 0 }`, folding the two together, and that contradicted the wire
        // contract one file over (`SetItemOp`: “ToFolder ?? (current folder)”, each field ABSENT = unchanged).
        // The cost was silent: dragging an item OUT of the Application and into the POU pool builds a rename
        // op carrying `ToFolder = ""`, which was read as “no move” — so the push reported ACCEPTED, the IDE kept
        // the item where it was, and the next pull put the file back. The engineer's move undone, with nothing
        // anywhere saying so. `volt push` has always sent NULL for an unchanged folder (Commands.cs), so the
        // distinction was already being made by the one client that matters.
        if (moves)
        {
            MoveItem(ide, currentName, op.ToName ?? op.Name, item, op.ToFolder!,
                     op.SourceText is null ? null : SourceOf(validated, op), outcome);   // recreate in the new folder
            return renamed ? "renamed+moved" : "moved";
        }
        if (op.SourceText is not null)
        {
            // FORCE deliberately overrides a diverged IDE, so it skips the last-moment check too - passing
            // `ifVersion` through regardless made `volt push --force` refuse the very case it exists for. A rename+edit
            // was checked before its rename (above), so it passes none.
            WriteItemFromSource(ide, currentName, op.ToName ?? op.Name, item, SourceOf(validated, op),
                                currentFolder, outcome, lastMomentVersion); // content update in place
            return renamed ? "renamed+updated" : "updated";
        }
        return renamed ? "renamed" : "no-op";          // rename-only (or a bare no-op set)
    }

    /// <summary>The read-only kind an op names — a delete by its name, a set by either of its names (the one it targets
    /// and the one it lands under) — or null when every name is writable. A name whose extension names no kind is not
    /// this check's question.</summary>
    private static (string Name, string Kind)? ReadOnlyKindOf(PushOp op)
    {
        foreach (var name in new[] { op.Name, (op as SetItemOp)?.ToName })
            if (name is not null && ItemKind.KindForWireName(name) is { } kind && ItemKind.IsReadOnlyKind(kind))
                return (name, kind);
        return null;
    }

    /// <summary>Move an item to another folder — <see cref="IProjectTree.Move"/>, on every driver. The IDE
    /// relocates the object WHOLE: nothing is read, deleted or rebuilt, there is no window in which the item does
    /// not exist, and a graphical item moves like any other. The NAME is kept, so name-based references survive.
    /// <para><b>The delete-and-recreate arm is gone.</b> It existed for "a driver without a move", gated on
    /// a per-vendor write fork that no longer exists either — and its own comment
    /// admitted what it cost: it REFUSED a graphical move outright (a diagram cannot be rebuilt from text), and a
    /// delete whose re-create then failed left a DUPLICATE rather than a no-op. It was "the arm only TwinCAT
    /// takes", and TwinCAT has a move now (DIALECT D4f), so it models a driver that does not exist.</para></summary>
    private static void MoveItem(IIdeDriver ide, string name, string wireName, ItemRef item, string newFolder,
                                 ValidatedSource? source, OpOutcome outcome)
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
        // WHAT OF THIS OP HAS LANDED, step by step — the text written in place, a destination folder created, the move
        // itself — for a refusal of any LATER step to state (step 2 review, round 2): the content write that makes a
        // refusal atomic is also the one step nothing undoes once a later step fails.
        var textLanded = false;
        var newFolders = new List<string>();
        var moved = false;
        try
        {
            if (source is { } edited)
            {
                WriteItemFromSource(ide, name, wireName, item, edited, newFolder, outcome);
                textLanded = true;
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
            ide.Move(item, TreeNav.ResolveTopLevelFolder(ide, newFolder, newFolders));
            moved = true;

            // AND WRITE AGAIN, because a move can REPLACE the item rather than relocate it.
            //
            // Measured on TwinCAT: a move-only push keeps the item's body exactly, and a move+edit push lands the
            // move but comes back with the OLD body - the edit written moments earlier is gone. The move there is an
            // export/delete/import of the item's own document (DIALECT D4f), and the export serializes what has been
            // PERSISTED, not the write still in flight. So the edit was never in the archive that got re-imported.
            //
            // This is the same fact the re-resolve above already encodes - a move replaces the item - carried to its
            // conclusion: a replaced item needs its content applied to the thing that exists AFTERWARDS. Writing
            // first is still what makes a refusal atomic (nothing has moved yet), so both writes earn their place:
            // the first one can refuse, the second one lands. On a driver whose move truly relocates, the second
            // write finds the content already correct and is the price of not encoding a per-vendor quirk in the
            // engine.
            if (source is { } settle)
            {
                var relocated = ItemLookup.Find(ide, name)
                    ?? throw new BridgeException(BridgeErrorCodes.NotFound,
                        $"'{name}' could not be found after being moved — the edit cannot be re-applied, so the " +
                        "push is failed rather than leaving the item holding its pre-edit content.");
                WriteItemFromSource(ide, name, wireName, relocated, settle, newFolder, outcome);
            }
        }
        // A filter, returning false, so the original exception reaches the client untouched (as `RecordKept`). It runs
        // AFTER the inner write's own filter, so what that write recorded is kept and this is added to it.
        catch when (RecordMoveKept(outcome, name, newFolder, textLanded, newFolders, moved))
        {
            throw;   // unreachable: the filter returns false.
        }
    }

    /// <summary>What of a refused move(+edit) landed before the step that refused: its text written in place, the
    /// destination folders created, the move. Always false: an exception filter.</summary>
    private static bool RecordMoveKept(OpOutcome outcome, string name, string newFolder, bool textLanded,
                                       List<string> newFolders, bool moved)
    {
        var parts = new List<string>();
        if (textLanded) parts.Add($"the pushed text of '{name}' was written before it and stays");
        parts.AddRange(newFolders.Select(f => $"the folder '{f}' was created before it and stays"));
        if (moved) parts.Add($"'{name}' was moved to '{(newFolder.Length == 0 ? "<the tree root>" : newFolder)}' before it and stays there");
        if (outcome.UpdateKept is { } inner) parts.Add(inner);
        if (parts.Count > 0) outcome.UpdateKept = string.Join(", and ", parts);
        return false;
    }

    /// <summary>Parse the pushed source the way the write will, and throw if it cannot be parsed — WITHOUT
    /// WRITING to the IDE. This is the batch PRE-FLIGHT's worker (<see cref="Handle"/>): running it over every
    /// op before the first write is what makes a push all-or-nothing for the class of refusal that is
    /// decidable from the text alone, which is the class a real push fails on.
    ///
    /// <para>A graphical body is read against the declarations it can see (network text v2: an FB call's type, a
    /// wire name's collisions — <see cref="IIdeDriver.NetworkScopeFor"/>), and the ones the push does not carry are
    /// the IDE's. So this READS the project — once per operation, indexed in one walk the driver shares with the
    /// write (<see cref="ProjectDeclarations"/>) — and never per op, which is the cost <see cref="WillCreate"/> is
    /// written against.</para></summary>
    /// <returns>The source as the push writes it, and every network-text body it carries as the model this validated it
    /// into, with its scope and where it sits — what the driver's own pre-flight is handed
    /// (<see cref="ICodeStore.ValidateSource"/>) and what the apply WRITES from (<see cref="WriteItemFromSource"/>), so the
    /// text is read and each body validated ONCE (openspec bridge-refusal-review D8/D12).</returns>
    private static ValidatedSource ValidateSourceOrThrow(IIdeDriver ide, string name, string src, bool isCreate,
                                              PushedDeclarations pushedDeclarations, string wireKind, ItemRef? existing)
    {
        var split = StReader.Read(src, wireKind, name);      // throws InvalidSt when the text cannot be split into what the push writes

        // A NAME THE IDE REFUSES, from the word alone (openspec `push-keeps-what-landed` 3.1). Both vendors refuse a POU
        // or a METHOD / ACTION / PROPERTY named like a reserved word (`Log`, `INT_TO_REAL`, `__NEW` …) whatever the
        // project and the member kind, and only the driver knows its vendor's measured words. Measured live the refusal
        // came from the apply loop, after the batch's earlier ops had landed. Every member the text carries is asked, on
        // an update too: an existing member can not hold a word its IDE refuses to create, so only a NEW one can be refused.
        // A name that is no identifier is the same refusal by the same door (bridge-refusal-review 3.1: measured on both
        // vendors for all six kinds; it was the reader's unmeasured INVALID_ST). Each name is asked with the kind it
        // creates: a driver answers its words only for the kinds they were measured on.
        if (isCreate && wireKind == ItemKind.Kinds.Pou && ide.RefusedName(ItemKind.Kinds.Pou, name) is { } pouRefusal)
            throw new ChildRefusedException($"the IDE refuses to create '{name}': {pouRefusal}", ChildRefusalCause.Name);
        foreach (var m in split.Members)
        {
            if (m.Kind is ItemKind.Kinds.Method or ItemKind.Kinds.Action or ItemKind.Kinds.Property
                    or ItemKind.Kinds.InterfaceMethod or ItemKind.Kinds.InterfaceProperty
                && ide.RefusedName(m.Kind, m.Name) is { } memberRefusal)
                throw new ChildRefusedException($"the IDE refuses to create {m.Kind} '{m.Name}' in '{name}': {memberRefusal}",
                                                ChildRefusalCause.Name);
        }
        RefuseMemberCreates(ide, name, split, isCreate, existing);
        // …and an INTERFACE property's GET/SET the driver cannot write, from the text alone (`ICodeStore.ValidateInterfaceAccessor`:
        // CODESYS a body, TwinCAT any edit). It was refused from inside the write, after the batch's earlier ops — and on
        // CODESYS the interface's and the property's own declarations — had landed (review of bridge-refusal-review 3a+3b).
        foreach (var m in split.Members)
        {
            if (m.Kind != ItemKind.Kinds.InterfaceProperty) continue;
            if (m.Getter is { } get) ide.ValidateInterfaceAccessor(get);
            if (m.Setter is { } set) ide.ValidateInterfaceAccessor(set);
        }
        // …and every graphical body it carries, root and members alike: network text that does not parse is the
        // most common way an edit is refused, and it is knowable before anything is mutated.
        //
        // ACCESSORS INCLUDED. A property's code lives in its GET/SET, not in a body of its own — `StReader`
        // gives a property `Body: ""` and puts the text in `Getter`/`Setter` — so enumerating `m.Body` alone
        // walked past every graphical accessor in the push. That is not a theoretical hole: the drivers each
        // run `NetworkText.Validate` on an accessor themselves (CodesysDriver.Content WriteAccessor,
        // BeckhoffDriver.Content Collect), so a non-canonical GET body WAS refused — for the first time from
        // inside the write, after the earlier ops of the same push had already landed in the live IDE and
        // could not be rolled back. Which is precisely what this pre-flight exists to stop.
        // `BodyFormatGuard.RequireAuthorable` already splits members this way for the same reason.
        // Each body against ITS OWN scope (`SourceScopes.BodiesOf`: a member's declarations, then its owner's), the
        // one the driver writes a pulled body against — network text v2 reads a call head as an FB instance, and a
        // wire name as free, only against the declarations (`NetworkScope`).
        var bodies = SourceScopes.Validated(split, declaration => ide.NetworkScopeFor(declaration, pushedDeclarations));

        // AND A CREATE'S UNSUPPORTED REFUSAL, which is text-decidable in exactly the same way. A body Volt cannot
        // author materializes as its UNSUPPORTED line (`IMPLEMENTATION CFC UNSUPPORTED`), and pushing that at an EXISTING item is the
        // ordinary no-op — the splice leaves the body alone — while pushing it at an item that does not exist
        // yet can only land an empty POU. `BodyFormatGuard` therefore refuses it, but it did so from inside
        // `WriteItemFromSource`, on the create arm, i.e. after the earlier ops of the batch had already been
        // committed. Migrating a real project into an empty one is precisely the push that hits it — every
        // CFC/SFC POU in the source — which is why `scripts/corpus-migration.ts` needs a retry loop at all.
        //
        // Whether it APPLIES is the one part that is not text-decidable, so it is resolved by the caller the
        // same way `ApplyOp` resolves it (cache, then live lookup) rather than guessed at: a pre-flight that
        // refused an UPDATE carrying an UNSUPPORTED line would break every push of a project that merely contains a CFC
        // POU, which is a far worse failure than the late refusal this replaces.
        if (isCreate) BodyFormatGuard.RequireAuthorable(split);
        return new ValidatedSource(split, bodies);
    }

    /// <summary>The source the pre-flight read and validated for <paramref name="op"/>. Every set op that carries text and
    /// reaches the apply was pre-flighted (a refused one rejects the whole batch first), so a miss is Volt's bug —
    /// INTERNAL_ERROR, never a second read of the text.</summary>
    private static ValidatedSource SourceOf(IReadOnlyDictionary<string, ValidatedSource> validated, SetItemOp op) =>
        validated.TryGetValue(op.Name, out var source)
            ? source
            : throw new BridgeException(BridgeErrorCodes.InternalError,
                $"set '{op.Name}' reached the apply without the source the pre-flight validated for it");

    /// <summary>A MEMBER CREATE THE IDE REFUSES FROM ITS ARGUMENT, before the first write (bridge-refusal-review 1+2d
    /// review; <see cref="IIdeDriver.RefusedMemberCreate"/>): TwinCAT creates an interface member with its type and cannot
    /// create one that states none. Its driver refused that create from inside the apply loop, after the batch's earlier
    /// ops and the item's own declaration had landed. Only a member the push CREATES is asked about — every member of a
    /// new item, and on an update one the IDE does not hold under that name and kind (<see cref="ReconcileMembers"/>'s
    /// rule): an existing member is written through, never created, so its declaration is the build's to judge. The
    /// IDE's members are read only when the driver refuses one, which is rare; an update the walk did not cache is
    /// looked up live.</summary>
    private static void RefuseMemberCreates(IIdeDriver ide, string name, ItemContent split, bool isCreate, ItemRef? existing)
    {
        var refused = split.Members
            .Select(m => (Member: m, Why: ide.RefusedMemberCreate(m.Kind, m.Name, CreateSeed(m))))
            .Where(x => x.Why is not null).ToList();
        if (refused.Count == 0) return;
        var held = new List<Member>();
        if (!isCreate && (existing ?? ItemLookup.Find(ide, name)) is { } item) held = ide.ReadContent(item).Members.ToList();
        foreach (var (m, why) in refused)
        {
            if (held.Any(h => string.Equals(h.Name, m.Name, StringComparison.OrdinalIgnoreCase) && h.Kind == m.Kind)) continue;
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"'{name}': the IDE cannot create its {m.Kind.Replace('_', ' ')} '{m.Name}': {why}");
        }
    }

    /// <summary>Does this op CREATE — is there no such item right now?
    ///
    /// <para>Answered from the PRE-APPLY WALK and nothing else, because the pre-flight walks the IDE no more than
    /// once — that is the property that makes it free to run over every op. A first cut called <c>ItemLookup.Find</c> here,
    /// which is a fresh tree walk PER OP: the same answer, bought with the one cost this pass is not allowed to
    /// have (measured immediately — the live TwinCAT suite went from ~5 minutes to over 20).</para>
    ///
    /// <para><c>Complete</c> is the whole reason absence can be read as "not there": a walk that skipped a
    /// folder says "there may be items under here I did not see", never "these are gone". So an incomplete walk
    /// declines to decide and leaves the verdict to the driver's own guard, exactly where it was before. That is
    /// not a fallback in the sense of a guess — a pre-flight that said "create" where the apply path says
    /// "update" would refuse a push of any project that merely CONTAINS a CFC POU, which is far worse than
    /// refusing it a moment later.</para></summary>
    private static bool WillCreate(WalkResult walk, Dictionary<string, (ItemRef Item, string Folder)> itemCache,
                                   string bare) =>
        walk.Complete && !itemCache.ContainsKey(bare);

    /// <summary>The kind of a wire name the pre-flight ADMITTED (<see cref="RequireWireNames"/> refuses every op whose
    /// name or toName has an extension that names no kind, before anything is applied). Null here is therefore Volt's
    /// bug, not the client's request — INTERNAL_ERROR (openspec <c>bridge-refusal-review</c> 2.16).</summary>
    private static string AdmittedKind(string wireName) =>
        ItemKind.KindForWireName(wireName)
        ?? throw new BridgeException(BridgeErrorCodes.InternalError,
            $"'{wireName}' reached the apply with no item kind, which the pre-flight's wire-name check admits for no op");

    /// <summary>Create-or-update an item and its children from full canonical ST source. Shared by the
    /// set create/update path and the move recreate, so both apply identical full-fidelity write semantics.
    /// <paramref name="name"/> is the BARE IDE name the write resolves by; <paramref name="wireName"/> is the FULL
    /// name the op lands under (its <c>toName</c> for a rename), whose extension is the kind.</summary>
    private static void WriteItemFromSource(IIdeDriver ide, string name, string wireName, ItemRef? existing,
                                        ValidatedSource source, string? folder, OpOutcome outcome,
                                        string? ifVersion = null)
    {
        // THE WIRE KIND DECIDES, create or update — read off the FULL name, and the text's header is never read
        // (openspec `push-without-header-check`): the text is written as sent, and the IDE's build reports what is
        // wrong with it. This was once handed the BARE name, so `KindForWireName` answered null for every item and
        // the write believed the text's header: a function block's text pushed as `X.dut` over the FB `X` was
        // written, and the receipt named `X.pou` for an op sent as `X.dut`.
        // The kind is the one the pre-flight read the text by — the name the op LANDS under (RequireWireNames, openspec
        // bridge-refusal-review 2.16).
        //
        // THE TEXT IS NOT READ AGAIN (openspec bridge-refusal-review D8): the pre-flight read it and validated every network
        // body once, and the write takes that content and those models. A move+edit writes twice from the one reading.
        var split = source.Content;
        if (split.Kind != AdmittedKind(wireName))
            throw new BridgeException(BridgeErrorCodes.InternalError,
                $"'{wireName}' is written from a source the pre-flight read as a {split.Kind}");


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

        var impl = split.Body;
        var itemType = PouKindToCode(split.Kind);
        // Only POUs (program/function/function_block) have an implementation-body slot. DUTs, GVLs and
        // interfaces don't — pass NULL so WriteText leaves the (nonexistent) impl untouched; writing text to
        // a slot the COM object doesn't expose crashes TwinCAT. A POU with an EMPTY body still passes "" so
        // the body is CLEARED (TcObjectModel.WriteText / CodesysObjectModel.WriteSourceText write on non-null).

        // Read-only enforcement for an EXISTING graphical body is by LIVE IDE STATE, not content: it is refused
        // by the body-type guard below. On a CREATE there is no live state to read, and the UNSUPPORTED line is the only
        // evidence there is — see `BodyFormatGuard.RequireAuthorable`, called on that arm.

        ItemRef pou;
        ItemRef? createdParent = null;   // set only when THIS op creates the item; drives the rollback at the end
        var declarationLanded = false;   // the item's declaration was written ahead of its members (see below)
        var changes = new MemberChanges();  // what the member reconcile did to the IDE before anything refused (an update's)
        var memberRefusalWorded = false;    // the refusal already says what of the update landed (`MemberRefusal`)
        ItemContent? live = null;
        if (existing is not { } existingPou)
        {
            // Placement is a CREATE-only concern: resolve (and if needed create) the target folder from the full
            // tree path here, so an in-place update never re-walks or accidentally materializes the spine.
            var targetParent = TreeNav.ResolveTopLevelFolder(ide, folder, outcome.FoldersCreated);

            // The body was validated BEFORE anything is created — by the pre-flight, once (D8) — so a refused push leaves
            // no orphaned, unlisted stub POU behind that blocks the next create.
            BodyFormatGuard.RequireAuthorable(split);

            // The body language is passed UNCONDITIONALLY (null for ST). TwinCAT sets a POU's implementation
            // language at creation; CODESYS takes it from the content. There is no create-arm per language - the
            // language is data.
            // THE IDE MAY REFUSE THE ITEM'S OWN NAME, in the words it refuses a member's: measured live 2026-10-03 (CODESYS
            // SP21, openspec `push-keeps-what-landed` 2.2) — `LOG.pou` and `Log.dut` "The name '…' is not valid for this
            // object.", nothing created. Worded as the ITEM's refusal; nothing was created, so there is nothing to roll back.
            try { pou = ide.CreateChild(targetParent, name, itemType, NetworkText.LanguageOf(impl)); }
            catch (ChildRefusedException ex)
            {
                throw new BridgeException(BridgeErrorCodes.Unsupported, $"the IDE refused to create '{name}': {ex.Message}", ex);
            }
            createdParent = targetParent;      // for the rollback below — the item did not exist before this op
            // The COM reference from CreateChild is stale for interface items - re-find before writing anything,
            // and FAIL if the re-find misses rather than writing through the handle this very line calls dead. On
            // TwinCAT a write to a detached COM object can succeed silently, so the interface would land EMPTY
            // while the push reports "created" and the receipt bakes that into the client's baseline.
            //
            // A miss is a refusal of the CREATE like any other, so the object CreateChild made is rolled back (or said to
            // remain) — this ran outside the rollback below, and left it with nothing said (review of
            // `push-partially-applied-flag` 1+2).
            if (itemType == ItemKind.PlcItf)
            {
                try
                {
                    pou = TreeNav.FindChild(ide, targetParent, name)
                        ?? throw new BridgeException(BridgeErrorCodes.NotFound,
                            $"created interface '{name}' but it cannot be found under its parent - refusing to write " +
                            "through the stale create handle");
                }
                catch when (Rollback(ide, targetParent, name, outcome))
                {
                    throw;   // unreachable: the filter returns false.
                }
            }
        }
        else
        {
            pou = existingPou;

            // Validate the WHOLE write before any of it lands, so a refusal is atomic. The guard decides from
            // the IDE's LIVE body, which arrives in the content the driver returns - a body Volt cannot author
            // must never be overwritten by a textual push, and a UNSUPPORTED line must not be written over one it can.
            live = ide.ReadContent(pou);

            // A PUSH MAY NOT RE-TYPE AN EXISTING ITEM BY ITS NAME. The IDE's kind comes from the object's CLASS — it
            // really is a POU, a DUT, a GVL, an interface — and the op's kind from its wire name's extension. They are
            // compared here, and nothing else is: the text's header is not read, and the TEXT is written as sent (a POU
            // whose text now says PROGRAM where it said FUNCTION_BLOCK is still `X.pou`, an ordinary content change).
            // What is refused is a NAME of another family than the object the IDE publishes: `X.dut` over the POU `X`.
            //
            // It is reachable from an ordinary edit: renaming `X.pou` to `X.dut` produces `ToName = "X.dut"` whose
            // BARE name is unchanged, so the rename compare degrades it to a plain content write. And when git does
            // not pair the two paths as a rename, the ops are `set X.dut` + `delete X.pou`, which land on the SAME
            // object — under an accepted push.
            //
            // Delete-and-recreate is the only honest route, and it is the engineer's call because it loses the
            // object's identity. `ReconcileMembers` already reasons exactly this way one level down, for a
            // MEMBER whose kind changed; this is the same rule for the item.
            if (!string.Equals(live.Kind, split.Kind, StringComparison.Ordinal))
                throw new BridgeException(BridgeErrorCodes.Unsupported,
                    $"'{name}' is a {live.Kind} in the IDE and this push names it a {split.Kind} ('{wireName}'). A " +
                    "push cannot re-type an object by its NAME: the name's extension is the kind `refs` publishes it " +
                    "under. Delete it and create it again if that is what you mean — that discards the object's " +
                    "identity, so it is not done for you.");

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
            // The content is already in hand (`live`, read one line up for the format guard), so this costs no
            // extra IDE round trip — the helper takes it rather than reading again.
            RequireUnchanged(name, folder, live, ifVersion);

            BodyFormatGuard.RequireWritable(live, split, ide.RefusedLanguageChange);
        }

        // ONE read of the live item, used by all three of the guard, the reconciler and the write filter. These
        // were two separate ReadContent calls back to back, each walking every member and reading its
        // declaration, body and accessors, to answer two questions about the same unchanged snapshot.
        live ??= ide.ReadContent(pou);

        // A REFUSED CREATE LEAVES NOTHING BEHIND.
        //
        // The create site above already says this — "a refused push must not leave an orphaned, unlisted stub
        // POU behind that blocks the next create" — and validates the text before creating. But the text is
        // only the half that is knowable up front. TwinCAT's graphical CREATE resolves the body through a
        // PLCopen import, and the importer can come back with FEWER networks than were pushed (PLCopen has no
        // element for an empty one, D25); `Stamp` then refuses, correctly, from inside this write.
        //
        // MEASURED: pushing a two-network LD body whose second network holds only a label was refused with
        // "the number of networks changes (1 -> 2)" — and left `PROGRAM X / VAR / END_VAR / NETWORK 0 FBD` in
        // the project. An empty shell wearing the engineer's POU name, which the next pull then materializes as
        // if they had written it. That shell is what a corpus migration read back as five separate losses;
        // there was no silent success anywhere, only a refusal whose wreckage looked like one.
        //
        // Best-effort, and deliberately: the rollback must never replace the REAL refusal with its own failure.
        // The engineer needs the reason the push was refused; a delete that also fails is a second problem, not
        // a better message. It spans the whole sequence below (design 5.Qa, O2): a member the IDE refuses is as
        // much a refusal of the create as a content write it refuses.
        try
        {
            // THE ITEM'S OWN DECLARATION BEFORE ITS MEMBERS (openspec `push-without-header-check` 5.Q.4, design O2). Which
            // members a POU accepts follows its TEXT on CODESYS (DIALECT C2k): FUNCTION text refuses a method, a property,
            // an action and a transition, and members created before such text lands are KEPT by the IDE afterwards. So the
            // IDE is shown the text the client sent before any member is created, and judges the members against it — not
            // against the seed Volt created the item with, nor the text it held before. A create AND an update: an update
            // that turns a function block's text into FUNCTION text and adds a method is the same silent state otherwise.
            //
            // The DECLARATION alone, and only when it changes and a member is about to be created: the declaration is what
            // the IDE judges a member by, and the BODY must stay last — on TwinCAT a member write rewrites the enclosing
            // POU's file and loses a body written before it (the order `BeckhoffDriver.WriteContent` documents), so the
            // body travels with the members in the one write below, which restates the declaration (the same text).
            if (CreatesMembers(live, split) && Text(live.Declaration) != Text(split.Declaration))
            {
                ide.WriteContent(pou, split with { Body = null, Members = new List<Member>() }, source.Bodies);
                declarationLanded = true;
                // A write may replace the item on a vendor whose handles do not survive a change (TwinCAT, D4d), so the
                // member reconcile below starts from a fresh handle there, as the content write after it does.
                if (!ide.HandlesSurviveStructureChange)
                    pou = ItemLookup.Find(ide, name)
                        ?? throw new BridgeException(BridgeErrorCodes.NotFound,
                            $"'{name}' cannot be found after its declaration was written — refusing to create its " +
                            "members through a handle the write invalidated");
            }

            // The member SET, for a create and an update alike. A create reaches here with the item existing but
            // empty, so every member the source declares is new; an update reconciles against what is there.
            if (ReconcileMembers(ide, pou, live, split, changes, MemberRefusal))
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
            ide.WriteContent(pou, OnlyChanged(live, split), source.Bodies);
        }
        catch when (createdParent is { } parent && Rollback(ide, parent, name, outcome))
        {
            throw;   // unreachable: the filter returns false. Present so the compiler sees a complete catch.
        }
        // AN UPDATE REFUSED AFTER PART OF IT LANDED says which part, whatever refused it. A member refusal the driver
        // classifies words it itself (`MemberRefusal`, below); any OTHER failure after the declaration was written, or
        // after the reconcile deleted a member, said nothing of either — the item is the engineer's and is not restored
        // (`CreateRollbackTests`), so the conflict is the only place the client learns what the IDE now holds (openspec
        // `push-keeps-what-landed`, spec "whatever of the refused op itself the IDE kept"). A filter, returning false,
        // so the original exception reaches the client untouched — the same shape as the create's rollback.
        catch when (createdParent is null && !memberRefusalWorded && RecordKept(outcome, UpdateLanded()))
        {
            throw;   // unreachable: the filter returns false.
        }

        // What of an UPDATE has already landed when it is refused: the declaration when it was written first, and every
        // step the member reconcile took before it — a member it DELETED (deletes run first, so a member the push drops is
        // gone from the IDE when a create is refused — 5Qa review) or CREATED, a POU-internal folder it created, a member it
        // moved, an accessor it deleted or created (step 2 review, round 2: a refused update could leave a property without
        // its GET and say nothing of it). Null when nothing landed.
        string? UpdateLanded()
        {
            if (!changes.Any && !declarationLanded) return null;
            var parts = new List<string>();
            if (changes.Deleted.Count > 0)
                parts.Add($"its {Members(changes.Deleted)} " + (changes.Deleted.Count == 1
                    ? "was deleted before it and stays deleted" : "were deleted before it and stay deleted"));
            // A member created before the refusal stays too, holding the SEED it was created with, not the pushed text
            // (the content write that would have filled it is what refused) — step 2 review, finding 4.
            if (changes.Created.Count > 0)
                parts.Add($"its {Members(changes.Created)} " + (changes.Created.Count == 1
                    ? "was created before it and stays (with its seed text)" : "were created before it and stay (with their seed text)"));
            parts.AddRange(changes.Folders.Select(f => $"the folder '{f}' was created in '{name}' before it and stays"));
            parts.AddRange(changes.Moved.Select(mv =>
                $"its {mv.Member.Kind.Replace('_', ' ')} '{mv.Member.Name}' was moved to " +
                $"'{(mv.To.Length == 0 ? "<the POU root>" : mv.To)}' before it and stays there"));
            parts.AddRange(changes.AccessorsDeleted.Select(x =>
                $"the {x.Accessor} accessor of property '{x.Property}' was deleted before it and stays deleted"));
            parts.AddRange(changes.AccessorsCreated.Select(x =>
                $"the {x.Accessor} accessor of property '{x.Property}' was created before it and stays (without the pushed text)"));
            var members = string.Join(", and ", parts);
            if (!declarationLanded) return members.Length == 0 ? null : members;
            return $"the declaration of '{name}' was written before it and stays" + (members.Length == 0 ? "" : $", and {members}");

            static string Members(List<Member> ms) => string.Join(", ", ms.Select(m => $"{m.Kind.Replace('_', ' ')} '{m.Name}'"));
        }

        // What a member the IDE refuses to create is reported with: the IDE's own reason, and what of the item has
        // already landed on an UPDATE — what `UpdateLanded` says, and that the rest was NOT written (the refusal comes
        // before the content write). Nothing on a CREATE: what a create leaves is decided by the rollback, which has not
        // run yet when this is worded, so `ConflictFor` words it from the rollback's outcome (design D2).
        string? MemberRefusal()
        {
            if (createdParent is not null) return null;
            memberRefusalWorded = true;
            var landed = UpdateLanded();
            outcome.KeptInRefusal = landed is not null;
            if (declarationLanded)
                return landed + (!changes.Any ? "; its members and body were not" : "; its other members and body were not written");
            // After a native rename the item is NOT untouched — the rename rewrote its header, and `ConflictFor` says it
            // stays renamed — so "nothing of it was written" would contradict that in the same reason (gate review of
            // step 3, seen live on CODESYS). Only what this write did is said here; the rename is worded once, there.
            if (landed is null)
                return outcome.Renamed is null ? $"nothing of '{name}' was written" : $"nothing but the rename of '{name}' was written";
            return $"{landed}; nothing else of '{name}' was written";
        }
    }

    /// <summary>What <see cref="ReconcileMembers"/> has done to the IDE so far, recorded as each step lands — so an update
    /// refused after any of it can say exactly what stays (openspec <c>push-keeps-what-landed</c>, spec "whatever of the
    /// refused op itself the IDE kept"). Every mutation the reconcile makes is one of these.</summary>
    private sealed class MemberChanges
    {
        public readonly List<Member> Deleted = new();
        public readonly List<Member> Created = new();
        /// <summary>POU-internal folders created to place a member, by path from the POU.</summary>
        public readonly List<string> Folders = new();
        public readonly List<(Member Member, string To)> Moved = new();
        public readonly List<(string Property, string Accessor)> AccessorsDeleted = new();
        public readonly List<(string Property, string Accessor)> AccessorsCreated = new();

        public bool Any => Deleted.Count + Created.Count + Folders.Count + Moved.Count
                           + AccessorsDeleted.Count + AccessorsCreated.Count > 0;
    }

    /// <summary>What of an existing task's refused settings write stays: null when the task reads back exactly as it did
    /// before the write. A task that cannot be read back is NOT assumed unchanged — that would claim a fact nobody
    /// measured — so the conflict says it may have changed, and is <c>partiallyApplied</c> (the client re-reads it).</summary>
    private static string? TaskKept(IIdeDriver ide, string name, string before)
    {
        try
        {
            var task = ItemLookup.Find(ide, name)
                ?? throw new BridgeException(BridgeErrorCodes.NotFound, $"task '{name}' cannot be found");
            var after = ide.ReadManifest(task, ItemKind.Kinds.Task);
            return after == before ? null
                : $"part of the settings of '{name}' was written before it and stays (the IDE now holds: " +
                  $"{after.Trim().Replace("\n", "; ")})";
        }
        catch (Exception ex)
        {
            return $"the task '{name}' could not be read back after the refusal ({ex.Message}), so part of its settings " +
                   "may have been written and stay";
        }
    }

    /// <summary>Record what of a refused UPDATE landed, for <see cref="ConflictFor"/>. Always false: an exception filter.</summary>
    private static bool RecordKept(OpOutcome outcome, string? kept)
    {
        outcome.UpdateKept = kept;
        return false;
    }

    /// <summary>Will reconciling <paramref name="pushed"/>'s members against <paramref name="live"/> CREATE one — a
    /// member the project lacks, or one whose kind changed (deleted and created again)? The question
    /// <see cref="ReconcileMembers"/> answers by doing it, asked first so the declaration can land before.</summary>
    private static bool CreatesMembers(ItemContent live, ItemContent pushed)
    {
        var liveKind = live.Members.ToDictionary(m => m.Name, m => m.Kind, StringComparer.OrdinalIgnoreCase);
        return pushed.Members.Any(m => !liveKind.TryGetValue(m.Name, out var k) || k != m.Kind);
    }

    /// <summary>Delete an item this push had just created, from an exception FILTER so the original exception
    /// keeps its stack and is the one that reaches the client.
    ///
    /// <para>Always returns FALSE, so the catch block never runs and the throw propagates untouched. A filter
    /// is the right place because it runs BEFORE the stack unwinds and cannot swallow what it is reacting to —
    /// the alternative, catch-delete-rethrow, is one stray `throw ex;` away from losing the reason.</para>
    ///
    /// <para><b>It RECORDS what happened</b> on <paramref name="outcome"/>, for the conflict to say: the create was
    /// removed, or the removal failed and the object stays. A failed removal used to be a log line only, so the client
    /// was told nothing of an object its next create would collide with (openspec <c>push-keeps-what-landed</c> 2a).</para></summary>
    private static bool Rollback(IIdeDriver ide, ItemRef parent, string name, OpOutcome outcome)
    {
        outcome.Created = name;
        try
        {
            ide.Delete(parent, Materializer.Bare(name));
            VoltLog.Debug($"push: rolled back the create of '{name}' after its write was refused");
        }
        catch (Exception ex)
        {
            // The shell survives. Say so — in the log, and in the conflict (`ConflictFor`), because it is the state the
            // engineer's project is actually in.
            outcome.RollbackFault = ex;
            VoltLog.Warn($"push: '{name}' was created and its content refused, and the create could NOT be " +
                         $"rolled back — the item is left in the project: {ex.Message}");
        }
        return false;
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
        // THE ITEM'S OWN BODY GETS THE SAME RULE ITS MEMBERS DO.
        //
        // `WriteContent` wrote the POU's own declaration and body UNCONDITIONALLY on both drivers, at the end
        // of both paths — so editing one method rewrote the enclosing POU's body too, though nothing in it had
        // changed. Every neighbouring writer already refuses that: `TcNetworkWriter.Apply` returns null when
        // the archive already says exactly this, `CodesysNetworkWriter` compares before `Set`, and this method
        // has always dropped unchanged MEMBERS. The textual top-level body was the one thing left out.
        //
        // It is not free. TwinCAT regenerates a POU's `<LineIds>` — its per-line identity for breakpoints and
        // ONLINE CHANGE — on any whole-body write, because `ImplementationText` has no line-level form. A
        // needless rewrite therefore renumbers every line of a body the engineer did not touch, and an online
        // change to a running PLC sees a bigger delta than the edit actually was.
        //
        // NULL is the established way to say "leave it alone": both drivers write an implementation only when
        // it is non-null, and the member path already passes null for an ACTION's declaration. This says the
        // same thing with the same word.
        //
        // BOTH SIDES MUST BE NON-NULL to skip, and that is the careful part rather than a hedge. `null` on the
        // live side is not "empty" — it is a body that was not read (an IDE item with no implementation),
        // and treating it as equal to a pushed "" would silently skip a write. An EMPTY pushed body against a
        // live one that HAS text still differs, so it is still written, and clearing a body still works: that
        // exact case was a real data-loss bug on TwinCAT (`!IsNullOrEmpty` where it needed `!= null`), and it
        // stays fixed because "" and null are never conflated here.
        if (live.Body is not null && pushed.Body is not null && Text(live.Body) == Text(pushed.Body))
            pushed = pushed with { Body = null };

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

    /// <summary>Compare on the text as it LANDS: both drivers trim exactly ONE thing on write, the line
    /// terminator the wire adds, so a trailing newline is not a change and everything else is.
    ///
    /// <para><c>TrimEnd('\n')</c>, matching <c>BodyText</c> in both drivers. This read <c>TrimEnd()</c> under
    /// a comment asserting "the drivers trim" — they trim NEWLINES; trailing SPACES on the last line survive
    /// the write. No reachable loss is known through it today (<c>StReader</c> normalises a declaration's
    /// trailing whitespace before it ever gets here), so this is alignment rather than a fix — but a
    /// change-detector that is laxer than the writer it gates can only ever fail one way: by deciding an edit
    /// is not an edit.</para></summary>
    private static string Text(string? s) => (s ?? "").TrimEnd('\n');

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
    private static bool ReconcileMembers(IIdeDriver ide, ItemRef pou, ItemContent live, ItemContent pushed,
                                         MemberChanges changes, Func<string?> landed)
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
            changes.Deleted.Add(m);
            mutated = true;
        }

        foreach (var m in pushed.Members)
        {
            if (have.Contains(m.Name) && !retyped.Contains(m.Name)) continue;
            var site = TreeNav.ResolveFolder(ide, Owner(), m.Folder, changes.Folders);
            // A MEMBER THE IDE WILL NOT TAKE IS REFUSED BY NAME, with the IDE's own reason (openspec
            // `push-without-header-check` 5.Q.4). Which members a POU accepts follows its TEXT (DIALECT C2k: FUNCTION
            // text refuses every member kind; text that declares nothing refuses a method and a property), and the
            // declaration has already been shown to the IDE. ONLY the vendor's own refusal, which the driver recognises
            // (ChildRefusedException): any other failure — a stale handle, a transport fault — is not the text's doing
            // and propagates as the fault it is, the create still rolled back by the filter above.
            try { ide.CreateChild(site, m.Name, ItemKind.MemberCode(m.Kind), CreateSeed(m)); }
            catch (ChildRefusedException ex)
            {
                // The declaration hint only where it is TRUE: a refused KIND follows the declaration (C2k); a refused NAME
                // does not — the function block that refuses a method named `Log` takes methods (measured on both
                // vendors, openspec `push-keeps-what-landed` 1.1 / 1.G).
                var said = ex.Message.TrimEnd();
                said = landed() is { } l ? $"{said} — {l}." : said.EndsWith(".", StringComparison.Ordinal) ? said : said + ".";
                var hint = ex.Cause == ChildRefusalCause.Kind
                    ? " Which members a POU accepts follows its declaration (a FUNCTION takes none)."
                    : "";
                throw new BridgeException(BridgeErrorCodes.Unsupported,
                    $"'{name}': the IDE refused to create its {m.Kind.Replace('_', ' ')} '{m.Name}': {said}{hint}", ex);
            }
            changes.Created.Add(m);
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

            ide.Move(member.Value, TreeNav.ResolveFolder(ide, Owner(), m.Folder, changes.Folders));
            changes.Moved.Add((m, m.Folder ?? ""));
            mutated = true;
        }

        // A property's ACCESSORS are children too, so they are reconciled here with everything else that is a
        // child. They were briefly done in the drivers, on the reasoning that only a driver can ask which child
        // is the SET; that is not so - the vendors both name them "Get" and "Set", which is what the original
        // fix relied on, and doing it here is what lets the INTERFACE rule below be stated once.
        foreach (var m in pushed.Members)
        {
            var accessors = ItemKind.ShapeOf(m.Kind).Accessors;
            if (accessors == AccessorShape.None) continue;
            var isInterface = accessors == AccessorShape.DeclarationsOnly;
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

            mutated |= ReconcileAccessor(ide, prop.Value, m.Name, "Get",
                                         isInterface ? ItemKind.PlcItfPropGet : ItemKind.PlcPropGet, m.Getter, changes);

            // Re-find the PROPERTY only where the accessor create just invalidated it.
            if (mutated && !ide.HandlesSurviveStructureChange)
            {
                propParent = TreeNav.FindFolder(ide, Owner(), m.Folder);
                prop = propParent is null ? null : TreeNav.FindChild(ide, propParent.Value, m.Name);
            }
            if (prop is null)
                throw new BridgeException(BridgeErrorCodes.NotFound,
                    $"'{m.Name}': the property vanished while its accessors were being reconciled");

            mutated |= ReconcileAccessor(ide, prop.Value, m.Name, "Set",
                                         isInterface ? ItemKind.PlcItfPropSet : ItemKind.PlcPropSet, m.Setter, changes);
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
    private static bool ReconcileAccessor(IIdeDriver ide, ItemRef property, string propertyName, string name, int kindCode,
                                          Accessor? accessor, MemberChanges changes)
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
            changes.AccessorsDeleted.Add((propertyName, name));
            return true;
        }
        if (exists) return false;
        ide.CreateChild(property, name, kindCode);
        changes.AccessorsCreated.Add((propertyName, name));
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
        ItemKind.ShapeOf(m.Kind).Signature
            ? m.ReturnType ?? m.DataType
            // A PROPERTY HAS NO BODY OF ITS OWN — its ACCESSORS carry the code, and with it the language.
            // Reading `m.Body` alone always answered null for one, so `create_property` made its Get and
            // Set as ST, and a graphical accessor then had nowhere to be written: the aspect is an
            // `STImplementationObject`, which has no `NetworkList`. Methods and actions never hit this
            // because their body IS their code.
            : NetworkText.LanguageOf(m.Body)
              ?? NetworkText.LanguageOf(m.Getter?.Code)
              ?? NetworkText.LanguageOf(m.Setter?.Code);

    internal static int PouKindToCode(string kind) => kind switch
    {
        // ONE seed per kind (design 5.Qa, S1): every POU is created as a function block whatever its text, as every DUT
        // is created as a struct — the vendor takes the kind the TEXT declares (DIALECT C2f/C2g; TwinCAT's compiler too,
        // C2h), and a function block accepts every member kind until the declaration says otherwise (C2k).
        ItemKind.Kinds.Pou => ItemKind.PlcPou,
        ItemKind.Kinds.Dut => ItemKind.PlcDut, ItemKind.Kinds.Gvl => ItemKind.PlcGvl, ItemKind.Kinds.Interface => ItemKind.PlcItf,
        // No fallback: an unrecognized top-level kind is a bug (a new kind missed here), not a Program — and it is
        // coded as Volt's bug (openspec bridge-refusal-review 2.17), not as the client's malformed request.
        _ => throw new BridgeException(BridgeErrorCodes.InternalError,
            $"no create code for the top-level kind '{kind}': the pre-flight admits only a writable source kind"),
    };

    // The splitter only ever emits method/action/property as textual children; interface vs non-interface is
    // the isInterface flag (the parent's kind), NOT a distinct child-kind string — so there is no
    // "interface_method"/"interface_property" arm. An unknown kind throws rather than defaulting to action.
}
