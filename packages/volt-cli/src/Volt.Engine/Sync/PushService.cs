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
        var needVersions = !request.Force || request.ExpectedProjectVersion != null;
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

        // Empty when the walk skipped the reads — and unread in that case, because the only thing that consumes
        // it is the lease comparison, which is exactly the branch that turns the reads back on.
        var currentProjectVersion = needVersions ? Hasher.ComputeProjectVersion(gatedVersions) : "";
        var conflicts = PushConflicts.DetectConflicts(request.Ops, request.ExpectedProjectVersion, request.Force, currentVersions, currentProjectVersion);
        if (conflicts.Count > 0)
        {
            VoltLog.Info($"push {request.Ops.Count} ops — REJECTED ({conflicts.Count} conflicts: {string.Join(", ", conflicts.Take(5).Select(c => c.Name))}{(conflicts.Count > 5 ? "..." : "")}) ({sw.ElapsedMilliseconds}ms)");
            return PushResponse.RejectedResult(conflicts, currentProjectVersion);
        }

        var pushedDeclarations = DeclarationsIn(request.Ops);

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
        // driver cannot resolve, a body the IDE itself rejects on import. Those stay possible, and the rejection
        // below says so rather than implying nothing happened.
        var applied = new List<(string Action, string Name)>();  // what each op did, for the write receipt in the log
        var opTotal = request.Ops.Count;

        // A refusal here reads EXACTLY like one from the apply loop below — same conflict shape, same codes. The
        // client cannot tell which pass refused it, and should not have to: both mean "this op's text is not
        // something Volt can write". The difference is only in what is left behind, and pre-flight leaves
        // nothing.
        PushResponse Reject(PushOp op, Exception ex)
        {
            var netEx = ex as NetworkTextException;
            // THE CODE THE REFUSAL ALREADY COMPUTED, not just the parser's.
            //
            // This read `netEx?.Code` alone, so only a network-text diagnostic kept its code and every
            // `BridgeException` on this path arrived as `code: null` — NOT_FOUND, UNSUPPORTED,
            // DUPLICATE_CHILD, BAD_REQUEST, INVALID_ST, INVALID_CODE_HEADER. Since a push catches EVERY
            // exception and returns a rejection rather than an error frame, those six were unreachable as
            // codes anywhere on the wire: five of the ten `BridgeErrorCodes` values could not be observed by
            // a client at all. So callers matched the English message instead — the e2e suite asserted on an
            // exact sentence, and the CLI gave up and printed the prose — which means a caller cannot tell
            // "pull and retry" from "this shape can never be written".
            //
            // The two vocabularies stay disjoint by construction: `BridgeException` implements
            // `ICodedError`, `NetworkTextException` deliberately does not (it carries its own `Code`), so
            // there is no case where both apply. Do NOT "tidy" that by making NetworkTextException an
            // ICodedError — `PipeServer` stamps any ICodedError's code onto an ERROR FRAME, which would let
            // a NETWORK_* value escape into a vocabulary that is documented as BridgeErrorCodes.
            var code = (ex as ICodedError)?.ErrorCode ?? netEx?.Code;
            VoltLog.Info($"push {opTotal} ops — REJECTED ({op.Name}: {ex.Message}, {applied.Count} already applied) ({sw.ElapsedMilliseconds}ms)");
            // NAME WHAT ALREADY LANDED. The ops before this one are written and are not rolled back (a delete
            // cannot be undone, and a half-undone push is worse than a half-done one), so a rejection that reads
            // as "nothing happened" is a lie the user acts on. Saying the count — and the one thing that
            // reconciles it — is the difference between a confusing project and a recoverable one.
            var reason = applied.Count == 0
                ? ex.Message
                : $"{ex.Message} — NOTE: {applied.Count} of {opTotal} item(s) were already written to the IDE " +
                  "before this one failed, and are not rolled back. Run `volt pull` to take them into the " +
                  "workspace, then push again.";
            return PushResponse.RejectedResult(
                new List<PushConflict> { new() { Name = op.Name, Reason = reason, Code = code, Line = netEx?.Line } },
                currentProjectVersion);
        }

        foreach (var op in request.Ops)
        {
            if (op is not SetItemOp { SourceText: { } text } set) continue;
            // A `.task` is a DESCRIPTOR, not assembled ST, so it is gated by its own format. Routing it
            // through `ValidateSourceOrThrow` would refuse every task push as a malformed document.
            try
            {
                if (IsTask(set.Name)) TaskDescriptorFormat.Gate(text);
                else
                {
                    var creating = WillCreate(walk, itemCache, Materializer.Bare(set.Name));
                    // Only a CREATE compares the extension with the text. An UPDATE that disagrees is a RE-TYPE,
                    // and `ItemKindIsNotRewritable` refuses it with the better message — it can name what the
                    // object actually is, which a create has nothing to ask.
                    ValidateSourceOrThrow(text, creating, creating ? ItemKind.KindForWireName(set.Name) : null);
                    // …and what only the DRIVER can decide without writing. This is the class the comment above
                    // used to name as out of reach — a body one vendor's format cannot express — and it is out
                    // of reach only for the ENGINE: TwinCAT's PLCopen writer is a pure function of the parsed
                    // body, so asking it here costs one throwaway serialization and moves a whole family of
                    // refusals in front of the first write. Proved live in
                    // `test/e2e/graphical/refused-shapes.test.ts`, which used to watch a two-item push write the
                    // first and refuse the second.
                    //
                    // A CREATE ONLY, and the asymmetry is the vendor's own: an update rewrites just the
                    // networks that CHANGED, so a body can legitimately carry a shape the whole-body writer
                    // refuses — an Execute box the engineer drew in the IDE, in a network this edit does not
                    // touch. Validating the whole body on an update would refuse that edit, which is a worse
                    // failure than the partial write this is here to stop.
                    if (creating) ide.ValidateSource(set.Name, text, pushedDeclarations);
                }
            }
            catch (Exception ex) { return Reject(op, ex); }
        }
        onProgress?.Invoke(new ProgressFrame { Operation = Ops.Push, Done = 0, Total = opTotal, Phase = "applying" });
        foreach (var op in InFolderDepthOrder(request.Ops))
        {
            // A structured network-text diagnostic (parser / round-trip gate) carries a stable code + source
            // line; any other throw is reason-only. `Reject` handles both, and is shared with the pre-flight.
            try { applied.Add((ApplyOp(ide, itemCache, op, request.Force, pushedDeclarations), op.Name)); }
            catch (Exception ex) { return Reject(op, ex); }
            // Report AFTER applying (like FetchService), so the final frame carries Done == Total (100%).
            onProgress?.Invoke(new ProgressFrame { Operation = Ops.Push, Done = applied.Count, Total = opTotal });
        }

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
        // primitive (`scripts/probe-empty-folder-lifecycle.py` for CODESYS; a COM tree walk for TwinCAT, where
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
        try { TreeNav.PruneEmptied(ide, EmptiedFolders(itemCache, request.Ops)); }
        catch (Exception ex) { VoltLog.Warn($"push: could not prune an emptied folder: {ex.Message}"); }

        // The receipt is a FRESH FULL snapshot — the SAME walk /refs uses (ProjectSnapshot), NOT a reuse of the
        // pre-apply versions. A native rename rewrites the bodies of referencing items that are NOT in the op
        // set, so reusing their pre-apply versions would report a stale baseline; the client persists this
        // receipt as its IDE baseline with no follow-up /refs, so it must match /refs exactly.
        var receipt = ProjectSnapshot.Walk(ide, operation: "push-receipt");

        VoltLog.Info($"push {request.Ops.Count} ops — accepted [{FormatApplied(applied)}] ({receipt.FullVersions.Count} items) ({sw.ElapsedMilliseconds}ms)");
        return PushResponse.AcceptedResult(receipt.ProjectVersion, receipt.FullVersions, receipt.Folders);
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
    /// <para>Built ONCE per push. A same-name collision keeps the FIRST: two ops naming the same item is a
    /// malformed request that <see cref="ApplyOp"/> is the right place to fail on, and silently letting the
    /// later one win here would resolve types against a declaration the push never applies.</para></summary>
    private static Dictionary<string, string> DeclarationsIn(IReadOnlyList<PushOp> ops)
    {
        var byName = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var op in ops)
        {
            if (op is not SetItemOp { SourceText: { } src } set) continue;
            // The name the item will HAVE — a rename+edit is indexed under its new name, because the bodies
            // being pushed alongside it are the ones that reference it by that name.
            var name = Materializer.Bare(set.ToName ?? set.Name);
            if (byName.ContainsKey(name)) continue;

            // A source text that does not parse is NOT failed here. This index is a lookup, and the op that
            // carries the bad text is the one that must report it — with its own name, its own line number and
            // the whole apply loop's error handling around it. Failing here would blame the first item pushed.
            try { byName[name] = StReader.Read(src).Declaration; }
            catch (Exception) { /* the op's own write reports it */ }
        }
        return byName;
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

        if (Hasher.ComputeItemVersion(folder, StWriter.Write(live)) != expected)
            throw new BridgeException(BridgeErrorCodes.BadRequest,
                $"'{name}' changed in the IDE while this push was being applied — refusing to overwrite " +
                "it. Pull first, then push again.");
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
        if (now != Versioning.Unreadable && now != expected)
            throw new BridgeException(BridgeErrorCodes.BadRequest,
                $"'{name}' changed in the IDE while this push was being applied — refusing to delete it. " +
                "Pull first, then push again.");
    }

    /// <summary>Apply one op and return a short label of what it did (created/updated/renamed/moved/deleted),
    /// used only for the log receipt.</summary>
    private static string ApplyOp(IIdeDriver ide,
        Dictionary<string, (ItemRef Item, string Folder)> itemCache, PushOp op, bool force,
        IReadOnlyDictionary<string, string> pushedDeclarations)
    {
        // The wire carries FULL names; the IDE is extensionless. Convert once, here, at the boundary.
        var name = Materializer.Bare(op.Name);
        var inCache = itemCache.TryGetValue(name, out var cached);
        ItemRef? existing = inCache ? cached.Item : ItemLookup.Find(ide, name);
        var currentFolder = inCache ? cached.Folder : "";

        switch (op)
        {
            case SetItemOp set when IsTask(set.Name):
                return ApplySetTask(ide, name, existing, set);
            case SetItemOp set:
                return ApplySetItem(ide, name, existing, currentFolder, set, force, pushedDeclarations);
            case DeleteItemOp when existing is { } del:
                // THE SAME LAST-MOMENT CHECK THE SET ARM DOES, and for a stronger reason: this is the one op
                // that cannot be undone. The per-item `ifVersion` gate runs once in the pre-apply walk, and a
                // real push then hashes the whole project, resolves conflicts and applies every earlier op —
                // on TwinCAT the IDE stays interactive throughout. The caller sent the strongest guard the
                // wire offers and it was checked against a snapshot stale by the length of the batch, so an
                // engineer's edit landing in that window was destroyed by the delete, reported as gone, and
                // status said in sync.
                RequireUnchangedBeforeDelete(ide, name, del, currentFolder, force ? null : op.IfVersion);
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

    /// <summary>Is this wire name a TASK? Read off the extension, because routing happens before the item is
    /// resolved — a create has no handle to ask, and the pre-flight runs earlier still.</summary>
    private static bool IsTask(string wireName) => ItemKind.KindForWireName(wireName) == ItemKind.Kinds.Task;

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
    private static string ApplySetTask(IIdeDriver ide, string name, ItemRef? existing, SetItemOp op)
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
            // A renamed `.task` file is a renamed TASK. The IDE's own rename runs first so anything that
            // references the task by name is rewritten by the IDE rather than left dangling by Volt.
            if (op.ToName is { } toName && !string.Equals(Materializer.Bare(toName), name, StringComparison.Ordinal))
            {
                ide.Rename(task, Materializer.Bare(toName));
                task = ItemLookup.Find(ide, Materializer.Bare(toName))
                    ?? throw new BridgeException(BridgeErrorCodes.NotFound,
                        $"task '{name}' could not be found after being renamed to '{toName}'");
                action = "renamed+updated";
            }
        }
        else
        {
            createdParent = TreeNav.ResolveTaskParent(ide, op.ToFolder);
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
        try
        {
            ide.WriteTask(task, settings);
        }
        catch when (createdParent is { } parent && Rollback(ide, parent, name))
        {
            throw;   // unreachable: the filter returns false, so the original refusal propagates untouched.
        }
        return action;
    }

    /// <summary>Apply one unified change. A rename uses the IDE's native rename (rewrites call-sites) and
    /// precedes a move; a move recreates in the new folder (name kept ⇒ name-based references survive); a
    /// content change goes through the shared full-fidelity writer. Each facet absent = unchanged.</summary>
    private static string ApplySetItem(IIdeDriver ide, string name, ItemRef? existing,
                                   string currentFolder, SetItemOp op, bool force,
                                   IReadOnlyDictionary<string, string> pushedDeclarations)
    {
        if (op.SourceText is { } st && string.IsNullOrWhiteSpace(st))
            throw new BridgeException(BridgeErrorCodes.BadRequest, $"set '{op.Name}': sourceText is empty");

        // CREATE — no existing item; sourceText is required, toFolder is the placement.
        if (existing is not { } item)
        {
            if (op.SourceText is null)
                throw new BridgeException(BridgeErrorCodes.BadRequest, $"set '{op.Name}': a new item needs sourceText");
            WriteItemFromSource(ide, name, existing: null, op.SourceText, op.ToFolder, pushedDeclarations);
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
        if (toName != null && !string.Equals(toName, currentName, StringComparison.Ordinal))
        {
            // THE PUSHED TEXT IS ALREADY VALIDATED, by the batch pre-flight in `Handle` — nothing that could
            // be refused on its text is still in flight by the time a rename runs. It used to be re-checked
            // right here, because a native rename makes the IDE rewrite every reference to this POU across the
            // project: the largest change in this method, and once the first thing a set op did. A rename+edit
            // whose edit was then rejected left the item renamed and its call sites rewritten while the push
            // reported failure, with nothing to put it back.
            //
            // Pre-flighting the WHOLE BATCH subsumes that guard and covers the ops before this one too, so the
            // local re-parse became a call that could never throw. What neither can pre-check is a refusal that
            // depends on the item's LIVE state (an unsupported body, a language change) — those are still
            // caught by the write, which is why the ORDER below (content, then move) stays as it is.
            ide.Rename(item, toName);                  // native rename → IDE rewrites references
            currentName = toName;
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
                throw new BridgeException(BridgeErrorCodes.Unsupported,
                    $"this IDE did not apply the rename '{name}' -> '{currentName}': the item is still called " +
                    $"'{landed}'. A rename that changes only LETTER CASE is not supported here — rename it in " +
                    "the IDE and pull, or pick a name that differs by more than case.");
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
        if (op.ToFolder is { } toFolder && !string.Equals(toFolder, currentFolder, StringComparison.OrdinalIgnoreCase))
        {
            MoveItem(ide, currentName, item, toFolder, op.SourceText, pushedDeclarations);   // recreate in the new folder
            return renamed ? "renamed+moved" : "moved";
        }
        if (op.SourceText is { } src)
        {
            // FORCE deliberately overrides a diverged IDE, so it skips the last-moment check too - passing
            // `ifVersion` through regardless made `volt push --force` refuse the very case it exists for.
            WriteItemFromSource(ide, currentName, item, src, currentFolder,
                                pushedDeclarations, force ? null : op.IfVersion); // content update in place
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
    private static void MoveItem(IIdeDriver ide, string name, ItemRef item, string newFolder,
                                 string? sourceText, IReadOnlyDictionary<string, string> pushedDeclarations)
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
            WriteItemFromSource(ide, name, item, edited, newFolder, pushedDeclarations);
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
        ide.Move(item, TreeNav.ResolveTopLevelFolder(ide, newFolder));

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
        if (sourceText is { } settle)
        {
            var moved = ItemLookup.Find(ide, name)
                ?? throw new BridgeException(BridgeErrorCodes.NotFound,
                    $"'{name}' could not be found after being moved — the edit cannot be re-applied, so the " +
                    "push is failed rather than leaving the item holding its pre-edit content.");
            WriteItemFromSource(ide, name, moved, settle, newFolder, pushedDeclarations);
        }
    }

    /// <summary>Parse the pushed source the way the write will, and throw if it cannot be parsed — WITHOUT
    /// touching the IDE. This is the batch PRE-FLIGHT's worker (<see cref="Handle"/>): running it over every
    /// op before the first write is what makes a push all-or-nothing for the class of refusal that is
    /// decidable from the text alone, which is the class a real push fails on.</summary>
    private static void ValidateSourceOrThrow(string src, bool isCreate, string? wireKind = null)
    {
        var split = StReader.Read(src, wireKind);            // throws InvalidSt on a malformed document, or a kind the name contradicts
        // …and every graphical body it carries, root and members alike: network text that does not parse is the
        // most common way an edit is refused, and it is knowable before anything is mutated.
        //
        // ACCESSORS INCLUDED. A property's code lives in its GET/SET, not in a body of its own — `StReader`
        // gives a property `Body: ""` and puts the text in `Getter`/`Setter` — so enumerating `m.Body` alone
        // walked past every graphical accessor in the push. That is not a theoretical hole: the drivers each
        // run `NetworkTextGate.Validate` on an accessor themselves (CodesysDriver.Content WriteAccessor,
        // BeckhoffDriver.Content Collect), so a non-canonical GET body WAS refused — for the first time from
        // inside the write, after the earlier ops of the same push had already landed in the live IDE and
        // could not be rolled back. Which is precisely what this pre-flight exists to stop.
        // `BodyFormatGuard.RequireAuthorable` already splits members this way for the same reason.
        var bodies = new List<string?> { split.Body };
        foreach (var m in split.Members) { bodies.Add(m.Body); bodies.Add(m.Getter?.Body); bodies.Add(m.Setter?.Body); }
        foreach (var body in bodies)
            if (body is { } b && NetworkText.Is(b)) NetworkTextGate.Validate(b);

        // AND A CREATE'S MARKER REFUSAL, which is text-decidable in exactly the same way. A body Volt cannot
        // author materializes as `(* @volt-graphical: CFC *)`, and pushing that at an EXISTING item is the
        // ordinary no-op — the splice leaves the body alone — while pushing it at an item that does not exist
        // yet can only land an empty POU. `BodyFormatGuard` therefore refuses it, but it did so from inside
        // `WriteItemFromSource`, on the create arm, i.e. after the earlier ops of the batch had already been
        // committed. Migrating a real project into an empty one is precisely the push that hits it — every
        // CFC/SFC POU in the source — which is why `scripts/corpus-migration.ts` needs a retry loop at all.
        //
        // Whether it APPLIES is the one part that is not text-decidable, so it is resolved by the caller the
        // same way `ApplyOp` resolves it (cache, then live lookup) rather than guessed at: a pre-flight that
        // refused an UPDATE carrying a marker would break every push of a project that merely contains a CFC
        // POU, which is a far worse failure than the late refusal this replaces.
        if (isCreate) BodyFormatGuard.RequireAuthorable(split);
    }

    /// <summary>Does this op CREATE — is there no such item right now?
    ///
    /// <para>Answered from the PRE-APPLY WALK and nothing else, because the pre-flight touches no IDE — that is
    /// the property that makes it free to run over every op. A first cut called <c>ItemLookup.Find</c> here,
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

    /// <summary>Create-or-update an item and its children from full canonical ST source. Shared by the
    /// set create/update path and the move recreate, so both apply identical full-fidelity write semantics.</summary>
    private static void WriteItemFromSource(IIdeDriver ide, string name, ItemRef? existing,
                                        string src, string? folder,
                                        IReadOnlyDictionary<string, string> pushedDeclarations,
                                        string? ifVersion = null)
    {
        // ALWAYS the wire kind, create or update. It was create-only at first, which left every UPDATE still
        // taking the kind from the header — and an update that disagrees is a RE-TYPE, which the guard below
        // catches with a better message but only AFTER the reader has already believed the text.
        var split = StReader.Read(src, ItemKind.KindForWireName(name));


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

        // Read-only enforcement for an EXISTING graphical body is by LIVE IDE STATE, not content: it is refused
        // by the body-type guard below. On a CREATE there is no live state to read, and the marker is the only
        // evidence there is — see `BodyFormatGuard.RequireAuthorable`, called on that arm.

        ItemRef pou;
        ItemRef? createdParent = null;   // set only when THIS op creates the item; drives the rollback at the end
        ItemContent? live = null;
        if (existing is not { } existingPou)
        {
            // Placement is a CREATE-only concern: resolve (and if needed create) the target folder from the full
            // tree path here, so an in-place update never re-walks or accidentally materializes the spine.
            var targetParent = TreeNav.ResolveTopLevelFolder(ide, folder);

            // Validate the body BEFORE creating the item - a refused push must not leave an orphaned, unlisted
            // stub POU behind that blocks the next create.
            // `impl is not null` changes nothing at run time — `NetworkText.Is` is false for a null body — but it is the
            // form the compiler can PROVE: netstandard2.0 has no [NotNullWhen] to carry that fact out of `Is`, and without
            // it every build of the push path printed CS8604 here.
            if (pouIsNetwork && impl is not null) NetworkTextGate.Validate(impl);
            BodyFormatGuard.RequireAuthorable(split);

            // The body language is passed UNCONDITIONALLY (null for ST). TwinCAT sets a POU's implementation
            // language at creation; CODESYS takes it from the content. There is no create-arm per language - the
            // language is data.
            pou = ide.CreateChild(targetParent, name, itemType, NetworkText.LanguageOf(impl));
            createdParent = targetParent;      // for the rollback below — the item did not exist before this op
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

            // A PUSH MAY NOT RE-TYPE AN EXISTING ITEM. The IDE's kind comes from the TREE — the object really is
            // a function block, a program, a DUT — and a declaration write cannot change that: it writes TEXT
            // into an object whose type is already decided. Accepting one wrote `PROGRAM X` over a live function
            // block (CODESYS additionally CLEARS the body), reported `updated`, and the CLI then saved a receipt
            // and ref pair asserting the workspace and the IDE agree — over a project that no longer builds.
            //
            // It is reachable from an ordinary edit: renaming `X.fb` to `X.prg` produces `ToName = "X.prg"`
            // whose BARE name is unchanged, so the rename compare degrades it to a plain content write. And when
            // git does not pair the two paths as a rename, the ops are `set X.prg` + `delete X.fb`, which land on
            // the SAME object — the set re-types it and the delete then removes it, under an accepted push.
            //
            // Delete-and-recreate is the only honest route, and it is the engineer's call because it loses the
            // object's identity. `ReconcileMembers` already reasons exactly this way one level down, for a
            // MEMBER whose kind changed; this is the same rule for the item.
            if (!string.Equals(live.Kind, split.Kind, StringComparison.Ordinal))
                throw new BridgeException(BridgeErrorCodes.Unsupported,
                    $"'{name}' is a {live.Kind} in the IDE and this push declares it a {split.Kind}. A push " +
                    "writes an object's TEXT and cannot change what it IS. Delete it and create it again if that " +
                    "is what you mean — that discards the object's identity, so it is not done for you.");

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
        // a better message.
        try
        {
            ide.WriteContent(pou, OnlyChanged(live, split), pushedDeclarations);
        }
        catch when (createdParent is { } parent && Rollback(ide, parent, name))
        {
            throw;   // unreachable: the filter returns false. Present so the compiler sees a complete catch.
        }
    }

    /// <summary>Delete an item this push had just created, from an exception FILTER so the original exception
    /// keeps its stack and is the one that reaches the client.
    ///
    /// <para>Always returns FALSE, so the catch block never runs and the throw propagates untouched. A filter
    /// is the right place because it runs BEFORE the stack unwinds and cannot swallow what it is reacting to —
    /// the alternative, catch-delete-rethrow, is one stray `throw ex;` away from losing the reason.</para></summary>
    private static bool Rollback(IIdeDriver ide, ItemRef parent, string name)
    {
        try
        {
            ide.Delete(parent, Materializer.Bare(name));
            VoltLog.Debug($"push: rolled back the create of '{name}' after its content write was refused");
        }
        catch (Exception ex)
        {
            // The shell survives. Say so — it is the state the engineer's project is actually in, and a silent
            // failure here is how it would be discovered by a later push refusing to create over it.
            VoltLog.Warn($"push: '{name}' was created and its content refused, and the create could NOT be " +
                         $"rolled back — an empty item is left in the project: {ex.Message}");
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
        // live side is not "empty" — it is a body that was not read (a marker, an unreadable graphical body),
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
            // A PROPERTY HAS NO BODY OF ITS OWN — its ACCESSORS carry the code, and with it the language.
            // Reading `m.Body` alone always answered null for one, so `create_property` made its Get and
            // Set as ST, and a graphical accessor then had nowhere to be written: the aspect is an
            // `STImplementationObject`, which has no `NetworkList`. Methods and actions never hit this
            // because their body IS their code.
            : NetworkText.LanguageOf(m.Body)
              ?? NetworkText.LanguageOf(m.Getter?.Code)
              ?? NetworkText.LanguageOf(m.Setter?.Code);

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
