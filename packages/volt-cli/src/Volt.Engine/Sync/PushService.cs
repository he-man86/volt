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


        // Pre-apply walk: conflict detection (per-item ifVersion guards) + the apply-boundary item cache. The item
        // cache is keyed by BARE IDE name (the IDE's own key); the version maps by wire identity. `currentVersions`
        // is deliberately UNGATED: per-item lookup/delete must see EVERY item (incl. container-managers). The
        // PROJECT-level lease version MUST hash the same gated set /refs/fetch/receipt use (ProjectSnapshot.IsTracked),
        // or every push wrongly reports "pull first".
        // The walk MATERIALIZES each item, so it is the slow half of a push: it gets its own progress phase.
        onProgress?.Invoke(new ProgressFrame { Operation = Ops.Push, Phase = "checking" });

        // The READS are skipped when nothing consumes them: `--force` skips every per-item check, leaving the lease
        // (only when quoted), `returnSources` (needs pre-apply versions) and a RENAME — TwinCAT's native rename
        // rewrites items no op names (DIALECT C2o, C2p), put back from these texts after the apply
        // (`PutBackWhatTheRenameTouched`). The item CACHE is needed either way; it comes from the walk, not the read.
        var renaming = request.Ops.OfType<SetItemOp>().Any(s => s.ToName is { } to
            && !string.Equals(Materializer.Bare(to), Materializer.Bare(s.Name), StringComparison.Ordinal));
        var needVersions = !request.Force || request.ExpectedProjectVersion != null || request.ReturnSources == true || renaming;
        var textsBefore = renaming ? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) : null;
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
            if (textsBefore is not null && v.Materialized is { } was) textsBefore[was.FullName] = was.Text;
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

        // Null when the walk skipped the reads — NOT "": every rejection publishes it as
        // `PushResponse.currentProjectVersion`, so a rejection computes the real hash on demand instead (`RejectAll`).
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
            // COMPUTED ON DEMAND when the pre-flight skipped it: a rejection always publishes the real hash.
            return PushResponse.RejectedResult(refused,
                currentProjectVersion ?? ProjectSnapshot.Walk(ide, operation: "push-reject").ProjectVersion);
        }

        // THE LEASE IS ANSWERED WITHOUT THE PRE-FLIGHT: the project moved since the client read it, so no item's verdict
        // means anything until it pulls (openspec `push-keeps-what-landed` design D1). The gate's own list goes with it.
        if (conflicts.Any(c => c.Code == ConflictCodes.StaleProjectVersion)) return RejectAll(conflicts);

        var pushedDeclarations = DeclarationsIn(ops);

        // VALIDATE EVERY OP BEFORE APPLYING ANY OF THEM: an op the apply loop refuses leaves the earlier ops written
        // (measured on `Lenze_MID-S100`: 157 of 174 items landed before the refusal). Everything decidable from the
        // SOURCE TEXT alone — a malformed ST document, network text that does not parse or is incomplete, a duplicate
        // child — is decided here, and so is what the driver can decide without touching the IDE
        // (`ICodeStore.ValidateSource`: TwinCAT's archive builder is a pure function of the parsed model). A refusal
        // that needs the LIVE project (a type the driver cannot resolve, a body the IDE rejects on import) stays
        // possible; the apply loop reports it in structure: what landed, the refused op, every op it did not reach.
        var applied = new List<(string Action, string Name)>();  // what each op did, for the write receipt in the log
        var opTotal = ops.Count;

        // A refusal here reads EXACTLY like one from the apply loop — same conflict shape, same codes; pre-flight just
        // leaves nothing behind. EVERY REFUSAL IS COLLECTED (openspec `push-keeps-what-landed` D1): the answer is the
        // UNION over every op the gate did not name, in request order, one conflict per op, so a client regenerates
        // exactly the refused items. The batch stays all-or-nothing — items reference each other (a pushed FB using a
        // pushed DUT), so applying the rest lands a project no op-level check can say builds.
        var refusedByGate = new HashSet<string>(conflicts.Select(c => c.Name), StringComparer.OrdinalIgnoreCase);
        var preflight = new List<PushConflict>();
        // EACH SET OP'S TEXT, READ AND VALIDATED ONCE (openspec bridge-refusal-review D8/D12), by the op's name — one op per
        // wire identity (RequireOneOpPerItem). The apply writes from these: no second read, no second validation.
        var validated = new Dictionary<string, ValidatedSource>(StringComparer.OrdinalIgnoreCase);
        foreach (var op in ops)
        {
            if (refusedByGate.Contains(op.Name)) continue;   // its text is about to be replaced by the pull its code asks for

            // AN ITEM THE DRIVER MUST NOT OPEN (DIALECT C2i) is refused here, without force, by name: the gate lets a
            // delete of it through (no version entry) and `itemCache` never holds it, so nothing else stops it before
            // `ApplyToUnopened` in the apply loop.
            if (!request.Force && notOpened.ContainsKey(Materializer.Bare(op.Name)))
            {
                var u = walk.UnreadableObjects.First(o => o.Kinds is not null
                    && string.Equals(o.Name, Materializer.Bare(op.Name), StringComparison.OrdinalIgnoreCase));
                preflight.Add(ConflictFor(op, new BridgeException(BridgeErrorCodes.Unreadable, $"'{u.Name}' is not read: {u.Reason}")));
                continue;
            }

            // A READ-ONLY DESCRIPTOR (`.projectsettings`, `.device`, `.library`, …) is something the IDE RENDERS, not
            // something a push writes — on either vendor. A set AND a delete of one are refused by name, before any op
            // lands (a delete otherwise reaches the vendor object). BAD_REQUEST, not UNSUPPORTED: it is Volt's rule,
            // not the IDE refusing a text (openspec bridge-refusal-review V.1).
            if (ReadOnlyKindOf(op) is { } readOnly)
            {
                preflight.Add(ConflictFor(op, new BridgeException(BridgeErrorCodes.BadRequest,
                    $"'{readOnly.Name}' is read-only: a {readOnly.Kind} descriptor is rendered from the IDE and is never " +
                    "pushed. Change it in the IDE and pull.")));
                continue;
            }

            // A MOVE INTO A NODE THAT CANNOT HOLD AN ITEM (`Device`, `Task Configuration`) is refused here, before any op
            // lands (openspec bridge-refusal-review 4.31): CODESYS accepts such a move and leaves the object where it was,
            // so the push said "moved" and the next pull moved the file back. Only a MOVE of an item the IDE holds — a
            // create keeps the vendor's own create refusal.
            if (op is SetItemOp { ToFolder: { } toFolder } mover
                && itemCache.TryGetValue(Materializer.Bare(mover.Name), out var placed)
                && !string.Equals(toFolder, placed.Folder, StringComparison.OrdinalIgnoreCase)
                && TreeNav.RefusedMoveTarget(ide, toFolder) is { } notAHolder)
            {
                preflight.Add(ConflictFor(op, new BridgeException(BridgeErrorCodes.Unsupported,
                    $"'{Materializer.Bare(mover.Name)}' cannot move into '{toFolder}': {notAHolder}")));
                continue;
            }

            if (op is not SetItemOp { SourceText: { } text } set) continue;
            // A `.task` is a DESCRIPTOR, not assembled ST, so it is gated by its own format. Routing it
            // through `ValidateSourceOrThrow` would refuse every task push as a malformed document.
            try
            {
                // …and the driver, for what its vendor cannot hold of the settings the gate read (`ICodeStore.ValidateTask`).
                if (ItemKind.IsTaskWireName(set.Name)) ide.ValidateTask(TaskDescriptorFormat.Read(text));
                else
                {
                    var creating = WillCreate(walk, itemCache, Materializer.Bare(set.Name));
                    // Read by the kind of the name the op LANDS under — its extension, never the text's header.
                    var cached = itemCache.TryGetValue(Materializer.Bare(set.Name), out var held) ? held.Item : (ItemRef?)null;
                    var source = ValidateSourceOrThrow(ide, Materializer.Bare(set.Name), text, creating, pushedDeclarations,
                                          ItemKind.KindForWireName(set.ToName ?? set.Name)!, cached);
                    validated[set.Name] = source;
                    var bodies = source.Bodies;
                    // …and what only the DRIVER can decide without writing: a body one vendor's format cannot
                    // express (TwinCAT's archive builder, one throwaway build; e2e
                    // `test/e2e/graphical/refused-shapes.test.ts`). Asked of EVERY BODY THE WRITE WOULD CREATE, which
                    // the driver decides: an update rewrites only the changed networks of a body the IDE holds, while
                    // a NEW member of an existing item is created whole (openspec bridge-refusal-review 2.28, D21). The
                    // driver gets the item written into (null for a create) and the validated MODELS, never the text
                    // (2.27, D8/D12).
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
                .OrderBy(x => position.TryGetValue(x.c.Name, out var at) ? at : int.MaxValue, Comparer<int>.Default).ThenBy(x => x.k, Comparer<int>.Default)
                .Select(x => x.c).ToList());
        }
        onProgress?.Invoke(new ProgressFrame { Operation = Ops.Push, Done = 0, Total = opTotal, Phase = "applying" });
        var inApplyOrder = InFolderDepthOrder(ops).ToList();
        var appliedOps = new List<PushOp>();
        var appliedAt = new List<(int At, PushOp Op)>();
        var lastRenameAt = -1;   // apply position of the last op whose rename landed (it may have stayed on a refused op)
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
                if (outcome.Renamed is not null) lastRenameAt = k;
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
            appliedAt.Add((k, op));
            if (outcome.Renamed is not null) lastRenameAt = k;
            // Report AFTER applying (like FetchService), so the final frame carries Done == Total (100%).
            onProgress?.Invoke(new ProgressFrame { Operation = Ops.Push, Done = applied.Count, Total = opTotal });
        }

        // The partial path runs what the full path runs: on TwinCAT the applied ops are not saved without this.
        ide.FlushPendingWrites();

        // PRUNE THE FOLDERS THIS PUSH EMPTIED, as git removes a directory whose last file went (the rationale and
        // the measurement are on `TreeNav.PruneEmptied`). Candidates are the folders the APPLIED deletes and moves
        // LEFT, from the pre-apply cache; only those actually empty afterwards go.
        // GUARDED: it runs after every op landed, it is cosmetic, and a COM fault in the live vendor is ordinary —
        // a throw here would fail a push that FULLY SUCCEEDED (no receipt, so the client's next push conflicts).
        try { TreeNav.PruneEmptied(ide, EmptiedFolders(itemCache, appliedOps)); }
        catch (Exception ex) { VoltLog.Warn($"push: could not prune an emptied folder: {ex.Message}"); }

        if (textsBefore is not null && lastRenameAt >= 0)
        {
            PutBackWhatTheRenameTouched(ide, textsBefore, appliedAt, lastRenameAt, notLanded, pushedDeclarations, notOpened);
            ide.FlushPendingWrites();
        }

        // The receipt is a FRESH FULL snapshot — the SAME walk /refs uses (ProjectSnapshot), never the pre-apply
        // versions: the IDE can change items outside the op set while the push runs, and the client persists this
        // receipt as its IDE baseline with no follow-up /refs.
        //
        // WITH `returnSources` THE SAME WALK KEEPS THE TEXT of every item the push CHANGED (openspec
        // `st-roundtrip-fixed-point`, route A): each item a LANDED `set` left (under the name it landed as), AND each
        // item whose version differs from the pre-apply walk's — one the IDE changed beside the ops, whose old text the
        // client would otherwise push back. An item a conflict names (`name`, `renamedTo`) is re-read by the client,
        // never answered. The text is the walk's own materialization, so it is what a read gives and nothing is read
        // twice.
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

    /// <summary>A PUSH CHANGES EXACTLY THE ITEMS IT NAMES — a rename too (owner, 2026-10-04, openspec bridge-refusal-review
    /// 8.4). Each vendor's only item rename differs (DIALECT C2o, C2p): CODESYS rewrites the renamed item's header and
    /// nothing else; TwinCAT's runs XAE's rename refactoring, which also rewrites the item's own code references and every
    /// reference in other items, with no automation switch (its one switch is the engineer's own Options setting). So the
    /// engine puts back, after the apply, what the push did not send: an item no op names gets its pre-push text, a
    /// renamed item the push sent no text for gets its pre-push text with only the header renamed, and an item the push
    /// SENT before a later rename is written again, so the sent text wins. Each is Volt's own read written back through
    /// Volt's own write, and only where the text differs — on CODESYS that is nothing but the sent re-writes.</summary>
    private static void PutBackWhatTheRenameTouched(IIdeDriver ide, IReadOnlyDictionary<string, string> before,
        IReadOnlyList<(int At, PushOp Op)> applied, int lastRenameAt, IReadOnlyCollection<PushConflict>? notLanded,
        PushedDeclarations declarations, IReadOnlyDictionary<string, string> notOpened)
    {
        var landedAs = new Dictionary<string, SetItemOp>(StringComparer.OrdinalIgnoreCase);
        foreach (var (_, op) in applied) if (op is SetItemOp s) landedAs[s.ToName ?? s.Name] = s;
        // An item a conflict names is re-read by the client, never answered — and never put back.
        var refused = new HashSet<string>((notLanded ?? new List<PushConflict>())
            .SelectMany(c => new[] { c.Name, c.RenamedTo }).OfType<string>(), StringComparer.OrdinalIgnoreCase);
        var now = ProjectSnapshot.Walk(ide, operation: "push-rename-scope", keepText: (_, _) => true);
        var writes = new List<SetItemOp>();
        string? Before(string name) => before.TryGetValue(name, out var t) ? t : null;
        foreach (var entry in now.Texts)
        {
            var (name, text) = (entry.Key, entry.Value);
            if (refused.Contains(name)) continue;
            string? expected;
            if (landedAs.TryGetValue(name, out var op))
            {
                if (op.SourceText is not null) continue;   // sent: written again below when a later rename could reach it
                expected = op.ToName is { } to && before.TryGetValue(op.Name, out var was)
                           && !string.Equals(Materializer.Bare(to), Materializer.Bare(op.Name), StringComparison.Ordinal)
                    ? WithOnlyTheHeaderRenamed(name, was, text, Materializer.Bare(op.Name), Materializer.Bare(to))
                    : Before(name);
            }
            else expected = Before(name);
            if (expected is null || expected == text) continue;
            if (ItemKind.KindForWireName(name) is not { } kind || ItemKind.IsReadOnlyKind(kind)) continue;
            writes.Add(new SetItemOp { Name = name, SourceText = expected });
        }
        foreach (var (at, op) in applied)
            if (at < lastRenameAt && op is SetItemOp { SourceText: { } sent } s)
                writes.Add(new SetItemOp { Name = s.ToName ?? s.Name, SourceText = sent });

        foreach (var w in writes)
        {
            var sources = new Dictionary<string, ValidatedSource>(StringComparer.OrdinalIgnoreCase);
            if (!ItemKind.IsTaskWireName(w.Name))
                sources[w.Name] = ValidateSourceOrThrow(ide, Materializer.Bare(w.Name), w.SourceText!, isCreate: false,
                                                        declarations, ItemKind.KindForWireName(w.Name)!, existing: null);
            ApplyOp(ide, new Dictionary<string, (ItemRef Item, string Folder)>(StringComparer.OrdinalIgnoreCase), notOpened,
                    w, force: true, sources, new OpOutcome());
        }
        if (writes.Count > 0)
            VoltLog.Info($"push: put back {writes.Count} item(s) a rename reached: {string.Join(", ", writes.Select(w => w.Name))}");
    }

    /// <summary>The renamed item's pre-push text <paramref name="was"/> with only its header renamed, read off what the
    /// IDE made of it (<paramref name="now"/>): the FIRST place the two differ is the header — nothing above it names
    /// the item but a comment, and neither vendor rewrites a comment (DIALECT C2o) — and it must be <paramref name="from"/>
    /// becoming <paramref name="to"/>, whole word; everything after it is the pre-push text. No ST is parsed.</summary>
    private static string WithOnlyTheHeaderRenamed(string item, string was, string now, string from, string to)
    {
        var i = 0;
        while (i < was.Length && i < now.Length && was[i] == now[i]) i++;
        if (i == was.Length && i == now.Length) return now;
        while (i > 0 && IsIdentifierChar(was[i - 1])) i--;
        if (!WordAt(was, i, from) || !WordAt(now, i, to))
            throw new BridgeException(BridgeErrorCodes.InternalError,
                $"renamed '{from}' to '{to}', but the first change the IDE made to '{item}' is not its header's name");
        return now.Substring(0, i + to.Length) + was.Substring(i + from.Length);

        static bool IsIdentifierChar(char c) => char.IsLetterOrDigit(c) || c == '_';
        static bool WordAt(string s, int at, string word) =>
            at + word.Length <= s.Length
            && string.Compare(s, at, word, 0, word.Length, StringComparison.OrdinalIgnoreCase) == 0
            && (at + word.Length == s.Length || !IsIdentifierChar(s[at + word.Length]));
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
        /// <summary>A native rename that ran before the op was refused: the IDE renamed the item (what TwinCAT's
        /// rename rewrote beside it is put back — DIALECT C2p), and that stays — the item is no longer under the op's name. <c>From</c>/<c>To</c> are BARE
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
    /// <para><b>The code the refusal already computed</b> — a <c>BridgeException</c>'s as much as a network-text
    /// diagnostic's — since a push answers every refusal as a conflict, never an error frame. The two vocabularies stay
    /// disjoint by construction: <c>BridgeException</c> implements <c>ICodedError</c>, <c>NetworkTextException</c>
    /// deliberately does not (it carries its own <c>Code</c>) — do NOT "tidy" that, or <c>PipeServer</c> would stamp a
    /// NETWORK_* value onto an ERROR FRAME.</para>
    ///
    /// <para><b>A driver's <c>NotSupportedException</c> IS an UNSUPPORTED refusal</b>, mapped here rather than rewritten
    /// at ~20 raise sites (a <see cref="ChildRefusedException"/> is one). And never null: anything that is not a coded
    /// error, a network-text diagnostic or a vendor "cannot" is a fault nobody classified, and INTERNAL_ERROR is exactly
    /// what the frame vocabulary calls that.</para>
    ///
    /// <para><b>The reason describes the refusal and nothing else</b> — no client instruction (no "volt pull", no "push
    /// again"): the CLI renders its own advice from the code, and a client that is not the CLI has no such command. Only
    /// what of the op the IDE KEPT is added, worded HERE, once, for a classified and an unclassified refusal alike.</para></summary>
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
            reason += $" — '{rn.From}' was renamed to '{rn.To}' before it and stays renamed";
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
    /// always sorts first, at any nesting (`lenze-mid`'s folder `UDT_CamControlLS/` beside a DUT of that name).</para>
    ///
    /// <para><b>STABLE:</b> ops at equal depth keep their order. Order is still no CONTRACT — nothing may depend on
    /// it for correctness (two items can reference each other; see <see cref="DeclarationsIn"/>).</para></summary>
    private static IEnumerable<PushOp> InFolderDepthOrder(IReadOnlyList<PushOp> ops) =>
        ops.Select((op, i) => (op, i))
           .OrderByDescending(x => x.op is SetItemOp { ToFolder: { } f } ? Depth(f) : 0, Comparer<int>.Default)
           .ThenBy(x => x.i, Comparer<int>.Default)
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
    /// <para>A graphical box can call through a name its own POU does not declare, resolved through OTHER items'
    /// declarations (`Mach1_AuxData.IEC_TIMERS.OffDelayLockDrives` = a GVL, a struct, then the timer). The live IDE
    /// answers only for items already there, and op order cannot be made a contract (two items may reference each
    /// other), so the push answers from its own declarations first.</para>
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
    /// <para>The per-item <c>ifVersion</c> gate runs ONCE, in the pre-apply walk, and the IDE stays interactive
    /// while the batch runs. This narrows that window (nothing can hold the IDE still): an edit made BEFORE this
    /// line is never silently overwritten.</para>
    ///
    /// <para>The <see cref="Versioning.Unreadable"/> exemption is correct and load-bearing: you cannot
    /// re-verify a hash that could never be computed in the first place.</para></summary>
    private static void RequireUnchanged(string name, string? folder, ItemContent live, string? ifVersion)
    {
        if (ifVersion is not { } expected || expected == Versioning.Unreadable) return;

        // NOT `folder ?? ""`: an item at the ROOT and one whose folder failed to read would hash identically. An
        // `ifVersion` only reaches here for an item the walk found, so a null folder IS a bug.
        if (folder is null)
            throw new BridgeException(BridgeErrorCodes.InternalError,
                $"'{name}': cannot verify the item version without its folder");

        // A STALE ITEM VERSION, coded as the pre-apply gate codes the same fact (openspec bridge-refusal-review 2.14).
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

        // THE SAME BASIS THE WALK USED (`Versioning.SafeVersion`), not the ST writer: a delete can target a
        // non-source item — a `.task` — versioned from its MANIFEST. An unreadable item comes back as the sentinel.
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
                // THE SAME LAST-MOMENT CHECK THE SET ARM DOES — a delete is the one op that cannot be undone.
                // `inCache ? … : null`, NOT `currentFolder`: that collapses "at the ROOT" and "not seen by the walk"
                // onto "", and the guard hashes the folder, so an item found by `ItemLookup.Find` would never match.
                // Null makes the guard stand down.
                RequireUnchangedBeforeDelete(ide, name, del, inCache ? cached.Folder : null,
                                             force ? null : op.IfVersion);
                // `ide.Name(del)`, NOT the wire `name`: itemCache resolves case-INSENSITIVELY while the drivers'
                // child scan matches case-SENSITIVELY, so only the item's ACTUAL IDE name reaches it.
                ide.Delete(ide.Parent(del), ide.Name(del));
                return "deleted";
            case DeleteItemOp:
                return "no-op";  // idempotent delete of an item that isn't there — the legitimate case

            default:
                // An op that is neither a set nor a delete (a missing or PascalCase `op` discriminator deserializes
                // as the BASE PushOp) is refused, never an accepted no-op.
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
                // root — a move nobody asked for. A walk that names no folder for it did not READ that folder (the
                // lookup found the item, the walk skipped where it sits): ITEM_UNVERIFIED, the walk's gap, not a Volt bug
                // (it was INTERNAL_ERROR; openspec bridge-refusal-review V.1).
                var folder = set.ToFolder ?? (notOpened.TryGetValue(u.Name, out var f) ? f
                    : throw new BridgeException(ConflictCodes.ItemUnverified,
                        $"'{u.Name}' is not opened, and this push's walk did not read the folder it sits in, so there is " +
                        "no folder to recreate it in"));
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
    /// <c>X.foo</c> reaches the object <c>X</c> while every check keyed by the full name misses it (no version entry, no
    /// kind to hold the text to). Force drops a version gate; it never makes a name mean something. The retired
    /// per-subtype names are such names: a DUT is <c>X.dut</c>, a POU <c>X.pou</c> (openspec
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
    /// <para><b>Why.</b> The apply resolves each op from the PRE-APPLY walk's cache, which a delete never updates, so a
    /// delete + set of one item writes through a dead handle or deletes what it wrote — losing the object and the
    /// class the wire does not carry (measured on a Pro2193 copy, <c>merged-classes.log</c>, deleted:
    /// <c>git show 5312b799fe:packages/volt-cli/scripts/merged-classes.log</c>).</para>
    ///
    /// <para>Two kinds of one BARE name (<c>deleteItem X.pou</c> + <c>set X.dut</c>, either order) are two wire
    /// identities but one cache key (the IDE's), so that pair is refused too, by name, stating the two-push remedy
    /// (<c>bridge-refusal-review</c> 4.32, the "re-type route"). Two SETS of one bare name are not this rule's (an FB
    /// and its visualization are two IDE objects, and a set never touches a visualization).</para></summary>
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
                // THE RE-TYPE ROUTE STAYS REFUSED (bridge-refusal-review 4.32, owner default): git pairs a similar edit
                // as ONE renaming `set`, which the re-type guard refuses, so accepting this unpaired form would make one
                // intent depend on git's similarity score. A re-type discards the object's identity — the engineer's call.
                if (other.TryGetValue(bare, out var otherName))
                {
                    var (deleted, created) = op is DeleteItemOp ? (name, otherName) : (otherName, name);
                    throw new PushRefusal(op.Name,
                        $"'{otherName}' and '{name}' are one IDE object '{bare}' (the IDE names an object without its " +
                        "kind), and this push deletes one and sets the other. A re-type in one push is not written: " +
                        $"commit the deletion of '{deleted}' and `volt push`, then commit '{created}' and `volt push`.");
                }
                if (!mine.ContainsKey(bare)) mine[bare] = name;
            }
    }

    /// <summary>Create or update a TASK from its descriptor — the one non-source kind a push may write.
    ///
    /// <para>The body was GATED in the pre-flight and is gated again here (a parse, no IDE call): this method is
    /// reachable on its own, and a silent reshape of a schedule is worse than a refusal.</para>
    ///
    /// <para>A task DELETE is the generic <c>deleteItem</c>. A task has no move path: <c>MoveItem</c> refuses a
    /// non-source kind, and a task lives in the Task Configuration by definition.</para></summary>
    private static string ApplySetTask(IIdeDriver ide, string name, ItemRef? existing, SetItemOp op, OpOutcome outcome)
    {
        if (op.SourceText is not { } src)
            throw new BridgeException(BridgeErrorCodes.BadRequest,
                $"set '{op.Name}': a task carries all of its state in its descriptor, so a push over one must " +
                "send sourceText (there is no separate body to leave unchanged).");
        var settings = TaskDescriptorFormat.Read(src);

        ItemRef task;

        ItemRef? createdParent = null;   // set only when THIS op creates the task
        var action = "updated";
        if (existing is { } found)
        {
            task = found;
            // A renamed `.task` file is a renamed TASK, through the IDE's own rename, and what that rename rewrites
            // beside it is put back after the apply (`PutBackWhatTheRenameTouched`, DIALECT C2p).
            if (op.ToName is { } toName && !string.Equals(Materializer.Bare(toName), name, StringComparison.Ordinal))
            {
                ide.Rename(task, Materializer.Bare(toName));
                // Recorded the moment the rename RETURNS, before the re-find: a re-find that misses (a stale tree) does
                // not undo it, and the conflict must say the task is no longer under its old name.
                outcome.Renamed = (name, Materializer.Bare(toName), toName);   // kept if anything after it is refused
                task = Refind(ide, Materializer.Bare(toName), $"task '{name}' could not be found after being renamed to '{toName}'");
                action = "renamed+updated";
            }
        }
        else
        {
            createdParent = TreeNav.ResolveTaskParent(ide, op.ToFolder, outcome.FoldersCreated);
            task = ide.CreateChild(createdParent.Value, name, ItemKind.PlcTask, null, null);   // a task has no object-property carrier
            action = "created";
        }

        // A REFUSED TASK CREATE LEAVES NOTHING BEHIND, as an item's does. `WriteTask` refuses a setting this vendor
        // cannot express, by name (TwinCAT has no spelling for `Interval: t#4ms`) — after the task was CREATED, and a
        // task with no schedule is in the call chain and runs nothing (measured migrating `bakon-nano` into TwinCAT).
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

    /// <summary>Apply one unified change. A rename uses the IDE's native rename (what TwinCAT's also rewrites beside the item
    /// is put back after the apply — DIALECT C2p) and
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
        // ORDINAL, because this asks "did the NAME change", not "does it name the same thing": a case-only rename
        // (`Calc` -> `calc`) is a real edit — what the IDE displays and the workspace file is called — and an
        // ignore-case compare would skip it and report accepted. Every IDENTITY compare stays case-insensitive.
        var moves = op.ToFolder is { } dest && !string.Equals(dest, currentFolder, StringComparison.OrdinalIgnoreCase);
        // The last-moment check of a content write — see `WriteItemFromSource` — and FORCE skips it there too.
        var lastMomentVersion = force ? null : op.IfVersion;
        var renames = toName != null && !string.Equals(toName, currentName, StringComparison.Ordinal);
        // THE LAST-MOMENT CHECK OF AN EDIT THAT ALSO RENAMES OR MOVES RUNS FIRST, before anything of the op lands, against
        // the item and folder the client's version names: the native rename rewrites the item's OWN header, so its
        // version afterwards is never the client's, and a move's write hashes against the DESTINATION folder (openspec
        // `push-partially-applied-flag` 3.1). An edit in place keeps its check in the write, where the live content is
        // already in hand.
        if (op.SourceText is not null && (renames || moves) && lastMomentVersion is not null)
        {
            RequireUnchanged(name, currentFolder, ReadLive(ide, item, name), lastMomentVersion);
            lastMomentVersion = null;   // checked, against the right state: the write after the rename must not re-ask
        }
        if (renames && toName is not null)
        {
            // THE PUSHED TEXT IS ALREADY VALIDATED by the batch pre-flight in `Handle`, so nothing refusable on its text
            // is in flight when the rename runs. A refusal that depends on the item's LIVE state (an unsupported body,
            // a language change) is still caught by the write — which is why the ORDER below (content, then move) stays.
            ide.Rename(item, toName);                  // native rename; what it rewrites beside the item is put back (C2p)
            currentName = toName;
            // Recorded the moment the rename RETURNS — before the re-find below, whose miss (a stale tree) does not undo
            // it. Withdrawn only where the IDE is shown to have ignored it (the case-only check).
            outcome.Renamed = (name, currentName, op.ToName!);   // kept if a later step of this op is refused (`ConflictFor`)
            // Refresh the staled handle, and FAIL on a miss: the pre-rename handle would write onto the OLD identity.
            item = Refind(ide, currentName,
                $"renamed '{name}' to '{currentName}' but the renamed item cannot be found — refusing to " +
                "write through the pre-rename handle");

            // AND THE RENAME ACTUALLY TOOK. The lookup above is case-INsensitive (the identity rule), so on a CASE-ONLY
            // rename it cannot tell a performed rename from an ignored one. Both vendors perform it (measured live
            // 2026-09-01, CODESYS 3.5.21.40 and TcXaeShell 15.0); this check exists because nothing else would KNOW if an
            // IDE quietly no-opped it.
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
        // THE EMPTY STRING IS A DESTINATION, NOT AN ABSENCE — the tree root, which on CODESYS is the project's own POU
        // pool (`SetItemOp`: each field ABSENT = unchanged; `volt push` sends NULL for an unchanged folder).
        if (moves)
        {
            MoveItem(ide, currentName, op.ToName ?? op.Name, item, op.ToFolder!,
                     op.SourceText is null ? null : SourceOf(validated, op), outcome);   // recreate in the new folder
            return renamed ? "renamed+moved" : "moved";
        }
        if (op.SourceText is not null)
        {
            // FORCE deliberately overrides a diverged IDE, so it skips the last-moment check too. A rename+edit was
            // checked before its rename (above), so it passes none.
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
    /// <para>Both vendors have a move (TwinCAT: DIALECT D4f), so there is no delete-and-recreate arm.</para></summary>
    private static void MoveItem(IIdeDriver ide, string name, string wireName, ItemRef item, string newFolder,
                                 ValidatedSource? source, OpOutcome outcome)
    {
        var kind = ItemKind.Map(ide.KindCode(item));
        // A move takes a source item only — Volt's wire rule, so BAD_REQUEST (openspec bridge-refusal-review V.1). Reached when the op's bare name finds an object of
        // another kind, a task (the one addressable non-source kind, `.task` routing aside).
        if (kind == null || !ItemKind.IsSourceKind(kind))
            throw new BridgeException(BridgeErrorCodes.BadRequest, $"cannot move '{name}': only source items (POUs/DUTs/GVLs) can be moved");

        // CONTENT FIRST, then the move — the content write is the step that can REFUSE, so a refused move+edit leaves
        // the item unmoved and no destination folder created.
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
                // RE-RESOLVE before moving: on TwinCAT the write is a document IMPORT, which invalidates every handle
                // into the item it replaced (DIALECT D4d), so the handle this method was called with is dead.
                item = Refind(ide, name,
                    $"'{name}' could not be found after its content was written — the write appears to have " +
                    "replaced it and the move cannot proceed.");
            }
            ide.Move(item, TreeNav.ResolveTopLevelFolder(ide, newFolder, newFolders));

            // AND THE MOVE TOOK (openspec bridge-refusal-review 4.31). An IDE can accept the call and leave the object —
            // CODESYS does for a target that is no folder — and "moved" would then be baked into the client's baseline
            // while the IDE disagrees. The pre-flight refuses the targets known to do that; this catches any other.
            if (!TreeNav.FolderHolds(ide, newFolder, name, kind))
            {
                // By name AND kind: a same-named item of another kind (an FB's visualization) is not the one that moved.
                var stayed = ide.WalkItems().Items.FirstOrDefault(i =>
                    string.Equals(i.Name, name, StringComparison.OrdinalIgnoreCase) && ItemKind.Map(i.KindCode) == kind);
                throw new BridgeException(BridgeErrorCodes.Unsupported,
                    $"this IDE did not apply the move of '{name}' to '{(newFolder.Length == 0 ? "<the tree root>" : newFolder)}': " +
                    (stayed is null
                        ? "the item is in neither folder afterwards."
                        : $"the item is still in '{(stayed.Folder.Length == 0 ? "<the tree root>" : stayed.Folder)}'."));
            }
            moved = true;

            // AND WRITE AGAIN, because a move can REPLACE the item rather than relocate it: TwinCAT's move is an
            // export/delete/import of the item's own document (DIALECT D4f), and the export serializes what has been
            // PERSISTED, so a move+edit came back with the OLD body (measured). The first write can refuse, the second
            // lands; where a move truly relocates, the second finds the content already correct — the price of not
            // encoding a per-vendor quirk in the engine.
            if (source is { } settle)
            {
                var relocated = Refind(ide, name,
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
        // Throws InvalidSt when the text cannot be split into what the push writes. FOLDED as the IDE's content is
        // (openspec abstract-member-parity): a file pulled before the fold states `IMPLEMENTATION ST` with an empty body
        // under an ABSTRACT member, which is the same content as `IMPLEMENTATION NONE`.
        var split = AbstractMemberFold.Apply(StReader.Read(src, wireKind, name));

        // A NAME THE IDE REFUSES, from the word alone (openspec `push-keeps-what-landed` 3.1). Both vendors refuse a POU
        // or a METHOD / ACTION / PROPERTY named like a reserved word (`Log`, `INT_TO_REAL`, `__NEW` …) whatever the
        // project and the member kind, and only the driver knows its vendor's measured words. Measured live the refusal
        // came from the apply loop, after the batch's earlier ops had landed. Only a member the push CREATES is asked: one
        // the IDE already holds under the item (same kind, same name) is written through, and its name is the IDE's own
        // (openspec codesys-existing-unicode-members: a Chinese project's CJK methods made every write to their POUs
        // refused, though nothing was created). A name that is no identifier is the same refusal by the same door
        // (bridge-refusal-review 3.1). Each name is asked with the kind it creates: a driver answers its words only for
        // the kinds they were measured on. The IDE's members are read only when a name is refused, which is rare.
        if (isCreate && wireKind == ItemKind.Kinds.Pou && ide.RefusedName(ItemKind.Kinds.Pou, name) is { } pouRefusal)
            throw new ChildRefusedException($"the IDE refuses to create '{name}': {pouRefusal}", ChildRefusalCause.Name);
        var refusedNames = split.Members
            .Where(m => m.Kind is ItemKind.Kinds.Method or ItemKind.Kinds.Action or ItemKind.Kinds.Property
                            or ItemKind.Kinds.InterfaceMethod or ItemKind.Kinds.InterfaceProperty)
            .Select(m => (Member: m, Why: ide.RefusedName(m.Kind, m.Name)))
            .Where(x => x.Why is not null).ToList();
        if (refusedNames.Count > 0)
        {
            var held = HeldMembers(ide, name, isCreate, existing);
            foreach (var (m, why) in refusedNames)
                if (!Holds(held, m))
                    throw new ChildRefusedException($"the IDE refuses to create {m.Kind} '{m.Name}' in '{name}': {why}",
                                                    ChildRefusalCause.Name);
        }
        RefuseMemberCreates(ide, name, split, isCreate, existing);
        // …and object properties the vendor has no measured member for (openspec bridge-one-to-one §1.1: TwinCAT, every
        // key) — from the text alone, before the first write, on the item and on every member it carries.
        ide.ValidateProperties($"'{name}'", split.Properties, isCreate);
        foreach (var m in split.Members)
            ide.ValidateProperties($"'{name}': its {m.Kind.Replace('_', ' ')} '{m.Name}'", m.Properties, isCreate);
        // …and an INTERFACE property's GET/SET the driver cannot write, from the text alone (`ICodeStore.ValidateInterfaceAccessor`:
        // CODESYS a body, TwinCAT any edit; review of bridge-refusal-review 3a+3b).
        foreach (var m in split.Members)
        {
            if (m.Kind != ItemKind.Kinds.InterfaceProperty) continue;
            if (m.Getter is { } get) ide.ValidateInterfaceAccessor(get);
            if (m.Setter is { } set) ide.ValidateInterfaceAccessor(set);
        }
        // …and every graphical body it carries, root and members alike: network text that does not parse is the
        // most common way an edit is refused, and it is knowable before anything is mutated.
        //
        // ACCESSORS INCLUDED: a property's code lives in its GET/SET (`StReader` gives the property `Body: ""`), so
        // `m.Body` alone would walk past every graphical accessor. Each body against ITS OWN scope (`SourceScopes.BodiesOf`: a member's declarations, then its owner's), the
        // one the driver writes a pulled body against — network text v2 reads a call head as an FB instance, and a
        // wire name as free, only against the declarations (`NetworkScope`).
        var bodies = SourceScopes.Validated(split, declaration => ide.NetworkScopeFor(declaration, pushedDeclarations));

        // AND A CREATE'S UNSUPPORTED REFUSAL, text-decidable the same way: an UNSUPPORTED line
        // (`IMPLEMENTATION CFC UNSUPPORTED`) over an EXISTING item is the ordinary no-op, but on a create it can only land
        // an empty POU. Whether it is a create is decided by the caller from the walk (`WillCreate`), never guessed: an
        // UPDATE carrying the line must pass, or no project containing a CFC POU could be pushed.
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

    /// <summary>The LIVE item an update reads before it writes (the format guard, the member reconcile, the last-moment
    /// version, a refused member create).
    ///
    /// <para><b>An item the IDE does not return at all cannot be updated in place, forced or not.</b> A driver that holds
    /// the item and cannot read it whole — a member the IDE holds no declaration for, on both vendors — refuses it
    /// <c>UNREADABLE</c>. Force skips the version GATE, not this read, so the refusal says what does work: fix it in the
    /// IDE, or replace it — delete, then create, two pushes because one push names an item once
    /// (<c>ErrorCodeVocabularyTests</c>).</para></summary>
    private static ItemContent ReadLive(IIdeDriver ide, ItemRef item, string name)
    {
        // FOLDED (openspec abstract-member-parity): an ABSTRACT member with no code is `IMPLEMENTATION NONE` whatever the
        // object's slot, so the version gate, the format guard and `OnlyChanged` all see the text the fetch publishes.
        try { return AbstractMemberFold.Apply(ide.ReadContent(item)); }
        catch (Exception ex) when (ex is ICodedError { ErrorCode: BridgeErrorCodes.Unreadable })
        {
            throw new BridgeException(BridgeErrorCodes.Unreadable,
                $"'{name}' cannot be updated in place, with or without force: the IDE does not return it ({ex.Message}). " +
                "Fix it in the IDE, or replace it — push its deleteItem, then push it again as a create.", ex);
        }
    }

    /// <summary>A MEMBER CREATE THE IDE REFUSES FROM ITS ARGUMENT, before the first write (bridge-refusal-review 1+2d
    /// review; <see cref="IIdeDriver.RefusedMemberCreate"/>): TwinCAT creates an interface member with its type and cannot
    /// create one that states none. Only a member the push CREATES is asked about — every member of a
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
        var held = HeldMembers(ide, name, isCreate, existing);
        foreach (var (m, why) in refused)
        {
            if (Holds(held, m)) continue;
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"'{name}': the IDE cannot create its {m.Kind.Replace('_', ' ')} '{m.Name}': {why}");
        }
    }

    /// <summary>The members the IDE holds under the item an update writes (none for a create), read live — the set a
    /// pushed member is "existing" against (<see cref="ReconcileMembers"/>'s rule: same name, case-insensitively, and
    /// same kind).</summary>
    private static List<Member> HeldMembers(IIdeDriver ide, string name, bool isCreate, ItemRef? existing) =>
        !isCreate && (existing ?? ItemLookup.Find(ide, name)) is { } item ? ReadLive(ide, item, name).Members.ToList() : new List<Member>();

    private static bool Holds(List<Member> held, Member m) =>
        held.Any(h => string.Equals(h.Name, m.Name, StringComparison.OrdinalIgnoreCase) && h.Kind == m.Kind);

    /// <summary>Does this op CREATE — is there no such item right now?
    ///
    /// <para>Answered from the PRE-APPLY WALK and nothing else: the pre-flight walks the IDE at most once.
    /// <c>ItemLookup.Find</c> here is a tree walk PER OP (the live TwinCAT suite went from ~5 to over 20 minutes).</para>
    ///
    /// <para><c>Complete</c> is what lets absence read as "not there". An incomplete walk declines to decide and leaves
    /// the verdict to the write's own guard — not a guess: saying "create" where the apply says "update" would refuse a
    /// push of any project that merely CONTAINS a CFC POU.</para></summary>
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
        // THE WIRE KIND DECIDES, create or update — read off the FULL name the op LANDS under, as the pre-flight read
        // the text by (openspec bridge-refusal-review 2.16); the text's header is never read (`push-without-header-check`):
        // the text is written as sent, and the IDE's build reports what is wrong with it.
        //
        // THE TEXT IS NOT READ AGAIN (openspec bridge-refusal-review D8): the pre-flight read it and validated every network
        // body once, and the write takes that content and those models. A move+edit writes twice from the one reading.
        var split = source.Content;
        if (split.Kind != AdmittedKind(wireName))
            throw new BridgeException(BridgeErrorCodes.InternalError,
                $"'{wireName}' is written from a source the pre-flight read as a {split.Kind}");


        // Children are keyed by name, and the IDE cannot hold two same-name children, so a duplicate WITHIN one pushed
        // source would silently overwrite one. Refused. (Not the top-level name invariant, where real projects repeat
        // names across kinds and a throwing guard is forbidden.)
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

            // The body language is passed UNCONDITIONALLY (null for ST): TwinCAT sets a POU's implementation language at
            // creation; CODESYS takes it from the content.
            // THE IDE MAY REFUSE THE ITEM'S OWN NAME (openspec `push-keeps-what-landed` 2.2, CODESYS SP21: `LOG.pou`
            // "The name '…' is not valid for this object."), creating nothing — so nothing to roll back.
            try { pou = ide.CreateChild(targetParent, name, itemType, NetworkText.LanguageOf(impl), split.Properties.Class); }
            catch (ChildRefusedException ex)
            {
                throw new BridgeException(BridgeErrorCodes.Unsupported, $"the IDE refused to create '{name}': {ex.Message}", ex);
            }
            createdParent = targetParent;      // for the rollback below — the item did not exist before this op
            // The COM reference from CreateChild is stale for interface items: re-find before writing, and FAIL on a
            // miss — on TwinCAT a write to a detached COM object can succeed silently, landing an EMPTY interface. A miss
            // is a refusal of the CREATE, so the object is rolled back (`push-partially-applied-flag` 1+2).
            if (itemType == ItemKind.PlcItf)
            {
                try
                {
                    pou = TreeNav.FindChild(ide, targetParent, name)
                        ?? throw new BridgeException(BridgeErrorCodes.IdeLostItem,
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
            live = ReadLive(ide, pou, name);

            // A PUSH MAY NOT RE-TYPE AN EXISTING ITEM BY ITS NAME. The IDE's kind comes from the object's CLASS — it
            // really is a POU, a DUT, a GVL, an interface — and the op's kind from its wire name's extension. They are
            // compared here, and nothing else is: the text's header is not read, and the TEXT is written as sent (a POU
            // whose text now says PROGRAM where it said FUNCTION_BLOCK is still `X.pou`, an ordinary content change).
            // What is refused is a NAME of another family than the object the IDE publishes: `X.dut` over the POU `X`
            // (reachable from renaming `X.pou` to `X.dut`, whose BARE name is unchanged). Delete-and-recreate is the
            // engineer's call, because it loses the object's identity — the same rule `ReconcileMembers` applies to a
            // member.
            if (!string.Equals(live.Kind, split.Kind, StringComparison.Ordinal))
                throw new BridgeException(BridgeErrorCodes.Unsupported,
                    $"'{name}' is a {live.Kind} in the IDE and this push names it a {split.Kind} ('{wireName}'). A " +
                    "push cannot re-type an object by its NAME: the name's extension is the kind `refs` publishes it " +
                    "under. Delete it and create it again if that is what you mean — that discards the object's " +
                    "identity, so it is not done for you.");

            // …NOR CHANGE ITS CLASS (openspec bridge-one-to-one §1.1 "Classes", §3): a class (`%CLASS CHECK CheckBounds`,
            // …) never changes in place (DIALECT C2l), so a `%CLASS` line pushed onto an object of another class — or
            // dropped from one that has a class — is refused by name before anything is written: never a delete + create
            // (the object's identity), never ignored.
            RefuseClassChange($"'{name}'", live.Properties.Class, split.Properties.Class);
            // …and the same for every MEMBER, before anything is written (the declaration may land first, below): a member
            // whose kind changed, a member whose class changed — a renamed one included — is refused by name (task 3.4).
            RefuseMemberRetypes(name, live, split);

            // LAST-MOMENT CHECK, against the state the IDE is in RIGHT NOW (see `RequireUnchanged`). The content is
            // already in hand (`live`, read for the format guard), so it costs no extra IDE round trip.
            RequireUnchanged(name, folder, live, ifVersion);

            BodyFormatGuard.RequireWritable(live, split, ide.RefusedLanguageChange);
        }

        // ONE read of the live item, used by the guard, the reconciler and the write filter alike.
        live ??= ReadLive(ide, pou, name);

        // A REFUSED CREATE LEAVES NOTHING BEHIND. The text was validated before creating, but some refusals come from
        // inside the write — a refusal only the live IDE can give (a member it will not create, a write it rejects) —
        // and an empty shell under the engineer's name would be pulled as if they had written it. Best-effort, deliberately: the rollback never replaces the REAL refusal with
        // its own failure. It spans the whole sequence below (design 5.Qa, O2): a refused member is as much a refusal
        // of the create as a refused content write.
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
                    pou = Refind(ide, name,
                        $"'{name}' cannot be found after its declaration was written — refusing to create its " +
                        "members through a handle the write invalidated");
            }

            // The member SET, for a create and an update alike. A create reaches here with the item existing but
            // empty, so every member the source declares is new; an update reconciles against what is there.
            if (ReconcileMembers(ide, pou, live, split, changes, MemberRefusal))
                // Creating or deleting a member INVALIDATES every handle into the POU on TwinCAT: placing one is a round
                // trip through the enclosing POU's own archive (DIALECT D4j), and the import replaces the item (D4d).
                // Re-find from a FRESH tree root, because the PARENT handle dies with it.
                pou = Refind(ide, name,
                    $"'{name}' cannot be found after reconciling its members — refusing to write through a " +
                    "handle the member create invalidated");

            // ONE call, for create and update alike: declaration, body, members and accessors together.
            // A member the reconcile RENAMED is the live member under its new name (task 3.4): compared as that, so an
            // unchanged body — an abstract method's `IMPLEMENTATION NONE` on an object with no slot — is not written.
            ide.WriteContent(pou, OnlyChanged(AfterRenames(live, changes), split), source.Bodies);
        }
        catch when (createdParent is { } parent && Rollback(ide, parent, name, outcome))
        {
            throw;   // unreachable: the filter returns false. Present so the compiler sees a complete catch.
        }
        // AN UPDATE REFUSED AFTER PART OF IT LANDED says which part, whatever refused it (a classified member refusal
        // words it itself, `MemberRefusal`). The item is the engineer's and is not restored, so the conflict is the only
        // place the client learns what the IDE now holds (openspec `push-keeps-what-landed`). A filter, returning false,
        // so the original exception reaches the client untouched.
        catch when (createdParent is null && !memberRefusalWorded && RecordKept(outcome, UpdateLanded()))
        {
            throw;   // unreachable: the filter returns false.
        }

        // What of an UPDATE has already landed when it is refused: the declaration when it was written first, and every
        // step the member reconcile took before it — a member it DELETED (deletes run first) or CREATED, a POU-internal
        // folder it created, a member it moved or renamed, an accessor it deleted or created. Null when nothing landed.
        string? UpdateLanded()
        {
            if (!changes.Any && !declarationLanded) return null;
            var parts = new List<string>();
            if (changes.Deleted.Count > 0)
                parts.Add($"its {Members(changes.Deleted)} " + (changes.Deleted.Count == 1
                    ? "was deleted before it and stays deleted" : "were deleted before it and stay deleted"));
            // A member created before the refusal stays too, holding the SEED it was created with, not the pushed text
            // (the content write that would have filled it is what refused).
            if (changes.Created.Count > 0)
                parts.Add($"its {Members(changes.Created)} " + (changes.Created.Count == 1
                    ? "was created before it and stays (with its seed text)" : "were created before it and stay (with their seed text)"));
            parts.AddRange(changes.Renamed.Select(r =>
                $"its {r.From.Kind.Replace('_', ' ')} '{r.From.Name}' was renamed '{r.To}' before it and stays renamed"));
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
            // After a native rename the item is NOT untouched (`ConflictFor` says it stays renamed), so only what this
            // write did is said here; the rename is worded once, there.
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
        /// <summary>Members renamed through the vendor's rename (task 3.4), each from its live record to its new name.</summary>
        public readonly List<(Member From, string To)> Renamed = new();

        public bool Any => Deleted.Count + Created.Count + Folders.Count + Moved.Count
                           + AccessorsDeleted.Count + AccessorsCreated.Count + Renamed.Count > 0;
    }

    /// <summary>What of an existing task's refused settings write stays: null when the task reads back exactly as it did
    /// before the write. A task that cannot be read back is NOT assumed unchanged — that would claim a fact nobody
    /// measured — so the conflict says it may have changed, and is <c>partiallyApplied</c> (the client re-reads it).</summary>
    private static string? TaskKept(IIdeDriver ide, string name, string before)
    {
        try
        {
            var task = Refind(ide, name, $"task '{name}' cannot be found");
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
    /// removed, or the removal failed and the object stays (openspec <c>push-keeps-what-landed</c> 2a).</para></summary>
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

    /// <summary><paramref name="live"/> as the IDE holds it after the reconcile: each renamed member under its new name,
    /// and each member it CREATED as the abstract method class (<see cref="CreateClass"/>) as that object stands — no body
    /// slot, which reads <c>IMPLEMENTATION NONE</c>, its declaration the create's seed (unknown here, so it differs and is
    /// written). So the write sends such a member its declaration and NOT its NONE body: the object has no slot to take
    /// one (the drivers' <c>RequireSlot</c>, D26), and NONE is exactly what it holds. Everything else as it was.</summary>
    private static ItemContent AfterRenames(ItemContent live, MemberChanges changes)
    {
        var createdAbstract = changes.Created
            .Where(m => CreateClass(m)?.Word == ObjectClass.AbstractMethod && m.Properties.Class is null)
            .Select(m => m with { Declaration = "" })
            .ToList();
        if (changes.Renamed.Count == 0 && createdAbstract.Count == 0) return live;
        return live with
        {
            Members = live.Members.Select(m => changes.Renamed.FirstOrDefault(r => ReferenceEquals(r.From, m)) is { From: not null } r
                    ? m with { Name = r.To } : m)
                .Concat(createdAbstract).ToList(),
        };
    }

    /// <summary>Drop the members whose content the IDE already has, so a push writes what an engineer CHANGED
    /// rather than everything they sent.
    ///
    /// <para>Each member write is a separate IDE transaction (CODESYS GetObjectToModify/SetObject), so an unchanged
    /// member is not written — the rule the graphical writers follow for an unchanged body.</para>
    ///
    /// <para>Safe because <paramref name="live"/> IS the IDE's state, read moments ago in this same push, and
    /// because a member absent from the list means "leave it alone", never "delete it" - removal is
    /// <see cref="ReconcileMembers"/>'s job and has already happened. A member the reconciler just CREATED is
    /// not in the snapshot, so it is correctly seen as changed and written.</para></summary>
    private static ItemContent OnlyChanged(ItemContent live, ItemContent pushed)
    {
        // THE ITEM'S OWN BODY GETS THE SAME RULE ITS MEMBERS DO. A needless whole-body write is not free: TwinCAT
        // regenerates a POU's `<LineIds>` — its per-line identity for breakpoints and ONLINE CHANGE — on any whole-body
        // write, so an online change would see a bigger delta than the edit. NULL is "leave it alone" (both drivers
        // write an implementation only when it is non-null).
        //
        // BOTH SIDES MUST BE NON-NULL to skip: a live `null` is a body that was not read, not "empty". An EMPTY pushed
        // body against live text still differs and is written, so clearing a body works ("" and null are never
        // conflated — the TwinCAT empty-body data-loss bug).
        if (live.Body is not null && pushed.Body is not null && Text(live.Body) == Text(pushed.Body))
            pushed = pushed with { Body = null };

        if (pushed.Members.Count == 0) return pushed;

        var byName = new Dictionary<string, Member>(StringComparer.OrdinalIgnoreCase);
        foreach (var m in live.Members) byName[m.Name] = m;

        // …AND EVERY MEMBER AND ACCESSOR BODY TOO (openspec abstract-member-parity): an unchanged body of a member whose
        // declaration changed is dropped the same way (null), so an unchanged `IMPLEMENTATION NONE` never reaches a driver — a
        // live member with no body slot always reads NONE, so NONE reaches a driver only over live code or on a create,
        // and both have a slot.
        var changed = pushed.Members
            .Where(m => !byName.TryGetValue(m.Name, out var was) || !Same(was, m))
            .Select(m => byName.TryGetValue(m.Name, out var was) && was.Kind == m.Kind ? WithoutUnchangedBodies(was, m) : m)
            .ToList();
        return pushed with { Members = changed };
    }

    /// <summary><paramref name="pushed"/> with each body that equals <paramref name="live"/>'s dropped (null). Both
    /// sides non-null, as for the item's own body: a live null is "not read", never "empty".</summary>
    private static Member WithoutUnchangedBodies(Member live, Member pushed)
    {
        if (live.Body is not null && pushed.Body is not null && Text(live.Body) == Text(pushed.Body))
            pushed = pushed with { Body = null };
        if (live.Getter?.Body is not null && pushed.Getter?.Body is not null && Text(live.Getter.Body) == Text(pushed.Getter.Body))
            pushed = pushed with { Getter = pushed.Getter with { Body = null } };
        if (live.Setter?.Body is not null && pushed.Setter?.Body is not null && Text(live.Setter.Body) == Text(pushed.Setter.Body))
            pushed = pushed with { Setter = pushed.Setter with { Body = null } };
        return pushed;
    }

    /// <summary>Does this member need writing? Compared on EVERYTHING a write carries - declaration, body, the
    /// two accessors, and the FOLDER.
    /// <para>The folder included: a member whose text is identical but whose folder moved must still be written and
    /// re-placed (`Every_foldered_child_arrives_with_its_folder`). Anything that differs at all is written.</para></summary>
    private static bool Same(Member a, Member b) =>
        Text(a.Declaration) == Text(b.Declaration)
        && Equals(a.Properties, b.Properties)   // a properties-only edit is a change (openspec bridge-one-to-one §3)
        && Text(a.Body) == Text(b.Body)
        && string.Equals(a.Folder ?? "", b.Folder ?? "", StringComparison.Ordinal)
        && Same(a.Getter, b.Getter)
        && Same(a.Setter, b.Setter);

    private static bool Same(Accessor? a, Accessor? b) =>
        a is null ? b is null
        : b is not null && Text(a.Declaration) == Text(b.Declaration) && Text(a.Body) == Text(b.Body);

    /// <summary>Compare on the text as it LANDS — every character, trailing newlines included: the drivers read and write
    /// a text verbatim (openspec <c>bridge-one-to-one</c> §1.1, <c>trailing-newline-cache</c>), so a trailing newline is
    /// a change like any other. A change-detector laxer than the writer it gates can only fail one way: by deciding an
    /// edit is not an edit.</summary>
    private static string Text(string? s) => s ?? "";

    /// <summary>Bring the member SET into line with the pushed source: create what the source declares and the
    /// project lacks, remove what the project has and the source dropped.
    ///
    /// <para>It lives here rather than in a driver: creating and deleting a child is <see cref="IProjectTree"/>, which
    /// both vendors implement, and keeping it in one place is what keeps the removal rule honest.</para>
    ///
    /// <para><b>The removal rule is the dangerous half.</b> It reconciles against the members the driver
    /// REPORTS, which are only the kinds that materialize into the file. A transition is inlined in a POU and is
    /// not a member — no reader models one, so it can never appear in a pushed source — and reconciling against
    /// the wider "inlined in a POU" set would delete every transition of an SFC POU on its first write, silently.</para></summary>
    /// <returns><c>true</c> when the project was mutated, so the caller knows its handles may be stale.</returns>
    private static bool ReconcileMembers(IIdeDriver ide, ItemRef pou, ItemContent live, ItemContent pushed,
                                         MemberChanges changes, Func<string?> landed)
    {
        var have = new HashSet<string>(live.Members.Select(m => m.Name), StringComparer.OrdinalIgnoreCase);
        var want = new HashSet<string>(pushed.Members.Select(m => m.Name), StringComparer.OrdinalIgnoreCase);

        var mutated = false;
        var name = ide.Name(pou);

        // Re-resolving the POU costs a FULL PROJECT WALK, so it is paid only where a create actually invalidates the
        // handle — the driver states which case it is (`HandlesSurviveStructureChange`, DIALECT D4d/D4j).
        ItemRef Owner()
        {
            if (!mutated || ide.HandlesSurviveStructureChange) return pou;
            return pou = ItemLookup.Find(ide, name) ?? pou;
        }

        // `have`/`want` are keyed on NAME alone, so a member whose KIND changed would be neither created nor deleted.
        // A RE-TYPE AND A CLASS CHANGE ARE REFUSED BY NAME (task 3.4, DIALECT C2l) before anything of the update is
        // written — by the write's update arm (`RefuseMemberRetypes`); a create has no live member to differ from.

        // A RENAME KEEPS THE OBJECT (openspec bridge-one-to-one §3, task 3.4): per member kind, exactly ONE live member the
        // text dropped and ONE it added is that member renamed — through the vendor's rename, which keeps its GUID, its
        // class and its properties (C2n); a delete + create would lose them. More than one on either side stays delete + create
        // (no pairing is guessed); the text carries every spelled member, so only the unspelled GUID differs then.
        foreach (var (from, to) in RenamePairs(live, pushed))
        {
            var site = TreeNav.FindFolder(ide, Owner(), from.Folder) ?? Owner();
            var member = TreeNav.FindChild(ide, site, from.Name)
                ?? throw new BridgeException(BridgeErrorCodes.IdeLostItem,
                    $"'{name}': its {from.Kind.Replace('_', ' ')} '{from.Name}' cannot be found to rename it '{to.Name}'");
            ide.Rename(member, to.Name);
            changes.Renamed.Add((from, to.Name));
            mutated = true;
            have.Remove(from.Name);
            have.Add(to.Name);
        }

        // DELETES RUN FIRST: a create is committed the moment it returns, so a later delete that throws would leave a
        // renamed foldered member in BOTH places.
        foreach (var m in live.Members)
        {
            if (want.Contains(m.Name) || changes.Renamed.Any(r => ReferenceEquals(r.From, m))) continue;
            // Delete it WHERE IT LIVES: a driver's delete scans direct children only.
            var site = TreeNav.FindFolder(ide, Owner(), m.Folder) ?? Owner();
            ide.Delete(site, m.Name);
            changes.Deleted.Add(m);
            mutated = true;
        }

        foreach (var m in pushed.Members)
        {
            if (have.Contains(m.Name)) continue;
            var site = TreeNav.ResolveFolder(ide, Owner(), m.Folder, changes.Folders);
            // A MEMBER THE IDE WILL NOT TAKE IS REFUSED BY NAME, with the IDE's own reason (openspec
            // `push-without-header-check` 5.Q.4). Which members a POU accepts follows its TEXT (DIALECT C2k: FUNCTION
            // text refuses every member kind; text that declares nothing refuses a method and a property), and the
            // declaration has already been shown to the IDE. ONLY the vendor's own refusal, which the driver recognises
            // (ChildRefusedException): any other failure — a stale handle, a transport fault — is not the text's doing
            // and propagates as the fault it is, the create still rolled back by the filter above.
            try { ide.CreateChild(site, m.Name, ItemKind.MemberCode(m.Kind), CreateSeed(m), CreateClass(m)); }
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

        // PLACEMENT IS STRUCTURE, so it is reconciled here with create and delete rather than in a driver: the drivers
        // resolve a member by bare name across every sub-folder and never read `m.Folder`, so this is the only place a
        // `%FOLDER` edit lands.
        var liveFolder = live.Members.ToDictionary(m => m.Name, m => m.Folder ?? "", StringComparer.OrdinalIgnoreCase);
        foreach (var (from, to) in changes.Renamed) liveFolder[to] = from.Folder ?? "";   // a renamed member is where it was
        foreach (var m in pushed.Members)
        {
            // A member the loops above just created is already in the right folder.
            if (!liveFolder.TryGetValue(m.Name, out var was)) continue;
            if (string.Equals(was, m.Folder ?? "", StringComparison.Ordinal)) continue;

            var from = TreeNav.FindFolder(ide, Owner(), was);
            var member = from is null ? null : TreeNav.FindChild(ide, from.Value, m.Name);
            if (member is null)
                throw new BridgeException(BridgeErrorCodes.IdeLostItem,
                    $"'{m.Name}': cannot be found at '{(was.Length == 0 ? "<the POU root>" : was)}' to move it");

            ide.Move(member.Value, TreeNav.ResolveFolder(ide, Owner(), m.Folder, changes.Folders));
            changes.Moved.Add((m, m.Folder ?? ""));
            mutated = true;
        }

        // A property's ACCESSORS are children too, reconciled here with everything else: both vendors name them "Get"
        // and "Set", and doing it here states the INTERFACE rule once.
        foreach (var m in pushed.Members)
        {
            var accessors = ItemKind.ShapeOf(m.Kind).Accessors;
            if (accessors == AccessorShape.None) continue;
            var isInterface = accessors == AccessorShape.DeclarationsOnly;
            // FIND, never find-or-create: a lookup must not make an empty folder inside the engineer's POU, and a
            // property it cannot find is refused, never skipped (a dropped SET would stay live).
            var propParent = TreeNav.FindFolder(ide, Owner(), m.Folder);
            var prop = propParent is null ? null : TreeNav.FindChild(ide, propParent.Value, m.Name);
            if (prop is null)
                throw new BridgeException(BridgeErrorCodes.IdeLostItem,
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
                throw new BridgeException(BridgeErrorCodes.IdeLostItem,
                    $"'{m.Name}': the property vanished while its accessors were being reconciled");

            mutated |= ReconcileAccessor(ide, prop.Value, m.Name, "Set",
                                         isInterface ? ItemKind.PlcItfPropSet : ItemKind.PlcPropSet, m.Setter, changes);
        }

        return mutated;
    }

    /// <summary>The members a push RENAMES (task 3.4): per member kind, the one live member the text dropped paired with
    /// the one it added — and none for a kind with more than one on either side (no pairing is guessed).</summary>
    private static List<(Member From, Member To)> RenamePairs(ItemContent live, ItemContent pushed)
    {
        var have = new HashSet<string>(live.Members.Select(m => m.Name), StringComparer.OrdinalIgnoreCase);
        var want = new HashSet<string>(pushed.Members.Select(m => m.Name), StringComparer.OrdinalIgnoreCase);
        var pairs = new List<(Member, Member)>();
        foreach (var kind in live.Members.Select(m => m.Kind).Distinct())
        {
            var dropped = live.Members.Where(m => m.Kind == kind && !want.Contains(m.Name)).ToList();
            var added = pushed.Members.Where(m => m.Kind == kind && !have.Contains(m.Name)).ToList();
            // NOT ACROSS THE BODY SLOT. The vendor's rename keeps the CLASS, and an abstract method's class is not
            // spelled — it follows the text (§1.1 `AbstractPOUMethodObject`): `IMPLEMENTATION NONE` on one side and a body
            // on the other would carry the wrong class over (no slot for the code, or a slot the text no longer states).
            // Such a pair stays a delete and a create, which makes the class the text states (`CreateClass`). A
            // PROPERTY's slots are its accessors' (an abstract property's GET is the slotless
            // `InterfacePropertyAccessorObject`), so each accessor's slot is compared too.
            if (dropped.Count == 1 && added.Count == 1 && Slots(dropped[0]) == Slots(added[0])) pairs.Add((dropped[0], added[0]));
        }
        return pairs;

        static (bool, bool, bool) Slots(Member m) => (IsNone(m.Stated), IsNone(m.Getter?.Stated), IsNone(m.Setter?.Stated));
        static bool IsNone(StatedLanguage? s) => s?.IsNone == true;
    }

    /// <summary>The CLASS a member is created as: the one its <c>%CLASS</c> line spells, else — for a METHOD stated
    /// <c>IMPLEMENTATION NONE</c> (an ABSTRACT method with no code, after <see cref="AbstractMemberFold"/>) — the vendor's
    /// abstract method class, which the text states without a line (design §1.1 <c>AbstractPOUMethodObject</c>: "a create of
    /// METHOD ABSTRACT with no code makes the vendor's abstract class").</summary>
    private static ObjectClass? CreateClass(Member m) =>
        m.Properties.Class
        ?? (m.Kind == ItemKind.Kinds.Method && m.Stated?.IsNone == true ? ObjectClass.AbstractMethodClass : null);

    /// <summary>Find <paramref name="name"/> again after a step that may have replaced its handle, or refuse with
    /// IDE_LOST_ITEM and <paramref name="lost"/>: the step reported success, so the item MUST be there.</summary>
    private static ItemRef Refind(IIdeDriver ide, string name, string lost) =>
        ItemLookup.Find(ide, name) ?? throw new BridgeException(BridgeErrorCodes.IdeLostItem, lost);

    /// <summary>A member whose KIND changed under its name, or whose CLASS changed — in place or across a rename — is
    /// refused by name before anything of the update is written (task 3.4, DIALECT C2l): a kind is a class, and a class
    /// never changes in place, so a delete + create would lose the object's identity and class. The remedy is stated:
    /// drop the member in one push and add it as the new kind in the next.</summary>
    private static void RefuseMemberRetypes(string name, ItemContent live, ItemContent pushed)
    {
        var liveMember = live.Members.GroupBy(m => m.Name, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        foreach (var m in pushed.Members)
        {
            if (!liveMember.TryGetValue(m.Name, out var was)) continue;
            if (was.Kind != m.Kind)
                throw new BridgeException(BridgeErrorCodes.Unsupported,
                    $"'{name}': its {was.Kind.Replace('_', ' ')} '{m.Name}' is pushed as a {m.Kind.Replace('_', ' ')}. A member's " +
                    "kind is its class in the IDE, and a class never changes in place (DIALECT C2l): to make it another kind, " +
                    "push the item without the member, then push it again with the new one — two pushes, which discards the " +
                    "member's identity, so it is not done for you.");
            RefuseClassChange($"'{name}': its {m.Kind.Replace('_', ' ')} '{m.Name}'", was.Properties.Class, m.Properties.Class);
        }
        foreach (var (from, to) in RenamePairs(live, pushed))
            RefuseClassChange($"'{name}': its {from.Kind.Replace('_', ' ')} '{from.Name}' (renamed '{to.Name}')",
                              from.Properties.Class, to.Properties.Class);
    }

    /// <summary>A pushed <c>%CLASS</c> that differs from the class the IDE holds — another class, a class on a plain object,
    /// or none on an object that has one — refused by name (DIALECT C2l: a class never changes in place). The remedy is
    /// stated: delete the object and create it again, two pushes, which discards its identity, so it is not done for
    /// you.</summary>
    private static void RefuseClassChange(string what, ObjectClass? held, ObjectClass? pushed)
    {
        if (Equals(held, pushed)) return;
        static string Said(ObjectClass? c) => c is null ? "the plain class (no %CLASS line)" : $"'%CLASS {c}'";
        throw new BridgeException(BridgeErrorCodes.Unsupported,
            $"{what} is {Said(held)} in the IDE, and this push states {Said(pushed)}. A class never changes in place " +
            "(DIALECT C2l): to make it another class, delete it and create it again — two pushes, since one push names an " +
            "item once — which discards the object's identity, so it is not done for you.");
    }

    /// <summary>Make a property's GET or SET exist, or not, to match the pushed source. <b>Presence is the
    /// object</b> - a null accessor means the source dropped it, and dropping it must DELETE it.
    ///
    /// <para>Creating one is what TwinCAT needs: it makes a property with no accessors. CODESYS makes both with the
    /// property and exposes no call to add one later, so its driver refuses that create by name — a documented
    /// divergence, not a fallback.</para></summary>
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
        ide.CreateChild(property, name, kindCode, null, null);   // an accessor: no class of its own
        changes.AccessorsCreated.Add((propertyName, name));
        return true;
    }

    /// <summary>The one value a vendor wants when CREATING this member: the declared TYPE for an interface
    /// member, the body LANGUAGE for everything else.
    ///
    /// <para>The read side of <see cref="Member.ReturnType"/> and <see cref="Member.DataType"/>: TwinCAT creates an
    /// interface member with its type, and answers "Object reference not set to an instance of an object" for none.
    /// An interface member has no body, so the two halves never compete.</para></summary>
    private static string? CreateSeed(Member m) =>
        ItemKind.ShapeOf(m.Kind).Signature
            ? m.ReturnType ?? m.DataType
            // A PROPERTY HAS NO BODY OF ITS OWN — its ACCESSORS carry the code, and with it the language: an accessor
            // created as ST is an `STImplementationObject`, which has no `NetworkList` for a graphical body.
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
}
