using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text.RegularExpressions;

using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Ide;
using Volt.Engine.Library;
using Volt.Engine.Source.Body;
using Volt.Engine.Item;

namespace Volt.Engine.Sync;

/// <summary><c>/fetch</c>: like <c>/refs</c>, but ships the materialized source for every item whose
/// version differs from the client's known version.
///
/// Aggregate versions (projectVersion, structureVersion) use bare-name keys — same as /refs and
/// PushService conflict detection. The wire Items and Changed[].Name use full-name keys.
///
/// Every walked item is returned as ordinary source — the bridge draws no build-relevance distinction.
/// Dead (uncalled) code and exclude-from-build objects alike ship as plain files; the LSP decides
/// reachability itself.</summary>
public static class FetchService
{
    public static FetchResponse Handle(IIdeDriver ide, FetchRequest request, Action<ProgressFrame>? onProgress = null)
    {
        // Connected + right-project guard (replaces the client's old pre-op health check) — atomic with the walk.
        var bound = OpGuard.RequireBoundProject(ide, request.ExpectedPlatform, request.ExpectedProjectName);

        var isInit = request.Init;
        var knownItems = request.KnownItems ?? new Dictionary<string, string>();
        var onlyItems = request.OnlyItems != null && request.OnlyItems.Count > 0
            ? new HashSet<string>(request.OnlyItems) : null;

        // A normal fetch without a knownItems baseline is ambiguous — did the client mean "everything" or
        // did it forget to supply a sidecar? The init op (`volt init`) is the first pull instead.
        // An onlyItems fetch without knownItems IS allowed (directed preview, used by E2E harness).
        if (!isInit && request.KnownItems == null && request.OnlyItems == null)
            throw new BridgeException(BridgeErrorCodes.NoSidecar, "supply knownItems to diff against, or run `volt init` for the first pull");

        var versions = new Dictionary<string, string>();
        var fullVersions = new Dictionary<string, string>();
        var folders = new Dictionary<string, string>();
        var changed = new List<FetchedItem>();

        // Normalized library RESOLUTION → the .library ref's (folder, bare name), captured from the ref items in
        // THIS walk, so each element signature is foldered right beside its own .library file.
        var libByResolution = new Dictionary<string, (string Folder, string Name)>(System.StringComparer.OrdinalIgnoreCase);

        var sw = Stopwatch.StartNew();

        // Walk the project FIRST — the walk is build-free (a tree descent, no precompile). We extract the referenced-
        // library signatures ONLY when a library actually changed, decided below from the .library files' own versions
        // (each is hashed like any other file), so the expensive precompile runs on a real library change, not every
        // fetch. Ordering is safe: the precompile reads its own language model, never the walked item handles, and
        // every item is already materialized by the time we (maybe) build — so a build can't stale a handle
        // mid-materialize (the same property that lets the onlyItems preview skip the build).
        var walk = ide.WalkItems();
        var walked = walk.Items;
        var total = walked.Count; // the signature count folds in AFTER we know whether we're extracting (below)
        var done = 0;
        var unmapped = 0;    // KindCode the table doesn't map (opaque/unknown type) — dropped from the pull
        var unreadable = 0;  // exists + tracked, but body couldn't be materialized (SafeVersion logs the why at Warn)
        // The live .library file versions (fullName → version), captured in the loop — the change signal for the
        // referenced-library set. Compared to the client's knownItems to decide whether to extract.
        var liveLibVersions = new Dictionary<string, string>();
        // Items the walk SAW but could not read. They exist; they are simply not in this response.
        var unreadableBareNames = new HashSet<string>(System.StringComparer.Ordinal);
        // `.library` stubs the walk skipped as unchanged, held in case the signatures get re-rendered.
        var skippedLibraryStubs = new List<FetchedItem>();
        onProgress?.Invoke(new ProgressFrame { Operation = Ops.Fetch, Done = 0, Total = total });

        foreach (var it in walked)
        {
            // Report over the walk, throttled — a frame every ~25 items (and the last) keeps the bar smooth
            // without a write per item.
            done++;
            if (onProgress != null && (done % 25 == 0 || done == total))
                onProgress(new ProgressFrame { Operation = Ops.Fetch, Done = done, Total = total });

            var kind = ItemKind.Map(it.KindCode);
            if (kind == null) { unmapped++; VoltLog.Debug($"fetch skip: unmapped-kind '{it.Name}' (kindCode={it.KindCode})"); continue; }
            // A container-manager (library / recipe / visualization manager) is a FOLDER, never a tracked item —
            // it only groups its children (see ItemKind.IsContainerManager). The driver walks already avoid
            // emitting it; this is the Core backstop so the invariant holds for EVERY vendor structurally, not
            // per-driver — a stray manager can never materialize as a stub file.
            if (ItemKind.IsContainerManager(it.KindCode)) continue;
            // The two skips above == ProjectSnapshot.IsTracked(it.KindCode) — kept expanded here (as in
            // ProjectSnapshot.Walk) for the per-reason counters/logs. A third skip added to either walk must be
            // added to the other, or fetch and refs stop producing the same version map (EndpointParityTests).

            // Resilient: a malformed item must not crash a fetch of OTHER items. Unreadable → skip its BODY (it
            // can't be materialized), never throw for the whole batch.
            // Hasher REQUIRES a folder: defaulting a missing one to "" would hash identically to a legitimately
            // empty folder and silently drift the item's version instead of surfacing the walk bug. So fail loud.
            var walkedFolder = it.Folder ?? throw new BridgeException(BridgeErrorCodes.InternalError,
                $"the project walk returned item '{it.Name}' with no folder");
            // ONE folder per item, from here on. A `.library` lives in its OWN folder beside the signatures it
            // describes, and that has to be true for every view of it: the version hash below, the `folders` map,
            // and the Changed entry. It used to be applied to the Changed entry ALONE, so a single response told
            // the client the file was at `Library Manager/` while writing it to `Library Manager/<lib>/`, and
            // hashed the version over the folder it is not in. Same rule now runs in ProjectSnapshot, so /refs
            // and the push receipt agree too.
            var folder = Versioning.FolderOf(kind, walkedFolder, it.Name);
            var version = Versioning.SafeVersion(ide, it.Name, kind, it.Item, walkedFolder, out var mat);
            // The aggregate project/structure version must cover EVERY walked item — readable or not, and
            // regardless of the onlyItems subset — so it matches /refs and the push receipt (an unreadable item
            // still exists and is tracked with its sentinel version). Recorded here, before the body gates below;
            // otherwise a single unreadable item makes /fetch's projectVersion diverge from /refs'.
            versions[it.Name] = version;
            if (mat == null)
            {
                // It could not be READ. It has not gone anywhere — the line above just recorded it with the
                // Unreadable sentinel for exactly that reason. Remember the bare name so the removal pass below
                // does not mistake "absent from this response" for "deleted from the project"; without this a
                // pull DELETES the engineer's file for a POU sitting in the IDE.
                //
                // Keyed by BARE name rather than a reconstructed `name.ext`: the full name normally comes from
                // the materialized item, which is null here, and re-deriving it would lean on the very kind
                // mapping that may be what defeated the read. IEC guarantees bare names are unique among source
                // items, which is what makes this safe.
                unreadableBareNames.Add(it.Name);
                unreadable++;
                continue;
            }
            var fullName = mat.FullName;

            if (onlyItems != null && !onlyItems.Contains(it.Name) && !onlyItems.Contains(fullName)) continue;

            fullVersions[fullName] = version;
            folders[fullName] = folder;

            if (kind == ItemKind.Kinds.Library)
            {
                // A library ref's body IS its manifest (LIBRARY/NAMESPACE/RESOLUTION/DEPENDENCIES…). Capture
                // RESOLUTION → (folder, name) so each library's signatures land under `<folder>/<name>/`, beside
                // its `.library` file.
                var res = LibraryFetch.ResolutionLine.Match(mat.Text).Groups[1].Value.Trim();
                if (res.Length > 0) libByResolution[res] = (walkedFolder, it.Name);
                // The .library file's version IS the change signal for its library (the manifest encodes the
                // resolved name+version); collect it to decide whether the signatures need re-extracting.
                liveLibVersions[fullName] = version;
            }

            var item = new FetchedItem
            {
                Name = fullName,
                Folder = folder,
                Version = version,
                SourceText = mat.Text,
            };

            if (!isInit && knownItems.TryGetValue(fullName, out var known) && known == version)
            {
                // Unchanged, so normally there is nothing to send. A `.library` STUB is the exception: if the
                // signatures end up re-rendered, `Changed` is the COMPLETE picture per library folder (the flag
                // below says so, and `IdeTree` acts on it), and a folder arriving WITHOUT its stub reads as
                // "this library is gone". Whether that happens is not known until the walk finishes, so hold the
                // stub rather than deciding here.
                if (kind == ItemKind.Kinds.Library) skippedLibraryStubs.Add(item);
                continue;
            }

            changed.Add(item);
        }

        // The wire is keyed by NAME: `versions`/`Items` collapse same-name WALK items last-write-wins, so `changed`
        // must agree — otherwise a legitimately-repeated opaque name (IEC guarantees uniqueness only for SOURCE
        // items) would materialize as TWO files while the version map tracks one, orphaning a file. Collapse to
        // the last occurrence per full name (a no-op for unique source names). This runs BEFORE the library
        // signatures are appended: those are identified by folder + name (many libraries legitimately export an
        // element with the same short name), so name-collapsing them would silently drop distinct library files.
        changed = DedupeByFullName(changed);
        // Project source items in this diff — captured BEFORE the library signatures are appended, so the two are
        // never conflated: `changed` below would otherwise mix a handful of edited POUs with thousands of read-only
        // library API files and read as nonsense ("880 items, 8104 changed").
        // Decided BEFORE `projectChanged` is taken: whether the held stubs belong in `changed` depends on it,
        // and they are project-tree items rather than signatures, so counting them here keeps the log honest.
        var libsWillRefresh = onlyItems == null && !(!isInit && LibraryFetch.LibrariesUnchanged(liveLibVersions, knownItems));
        if (libsWillRefresh && skippedLibraryStubs.Count > 0)
        {
            // A library whose own version did not move still has to be described, or the client deletes it. That
            // costs more than one file: with the stub gone `IdeTree.LibraryRoots` stops recognising the folder,
            // so everything under it loses both the removal exemption and the read-only guard — and a `.dut`
            // there becomes PUSHABLE as a project item, keyed by bare name, either creating junk inside the
            // Library Manager or overwriting the project's own DUT of the same short name. `volt status` stays
            // clean throughout, because the sidecar still lists it.
            changed.AddRange(skippedLibraryStubs);
            changed = DedupeByFullName(changed);
        }

        var projectChanged = changed.Count;

        // Extract the referenced-library signatures ONLY when they're needed: never for a directed onlyItems preview,
        // never on a fetch whose .library versions all match the client's knownItems (no library changed — a
        // library's API is immutable per version, so the client's existing signature files still stand), and always
        // on init. This is the whole optimization: the precompile (Build) runs iff a .library version changed.
        var librariesUnchanged = !isInit && LibraryFetch.LibrariesUnchanged(liveLibVersions, knownItems);
        // ONE decision, named — because the RESPONSE has to tell the client which of the two worlds it is in.
        // Signatures re-rendered ⇒ Changed carries the complete set per library folder, so anything the client
        // still holds there is gone. Not re-rendered ⇒ Changed carries no signatures at all, so the client must
        // keep what it has. Without this flag the client cannot tell the cases apart and had to keep them
        // always — which is why a removed library's signatures were immortal.
        var librariesRefreshed = onlyItems == null && !librariesUnchanged;
        IReadOnlyList<LibSignature> libSigs = librariesRefreshed
            ? ide.ExtractLibrarySignatures()
            : Array.Empty<LibSignature>();
        total = done + libSigs.Count; // fold the (now known) signature count into the bar's tail

        // EVERY referenced-library element signature rides through as a read-only item (no referenced-only gate —
        // the AI gets the full public API of the used libraries). Render the signatures now, ticking the SAME
        // progress bar (no separate phase); `done` == walked.Count here (the walk finished).
        var (libRenderNull, libUnmatched) = LibraryFetch.AppendLibrarySignatures(libSigs, libByResolution, changed, onProgress, done, total);
        var librarySignatures = changed.Count - projectChanged; // read-only library API files, written beside each .library

        // "Known to the client, and this walk produced no version for it" — MINUS the items the walk saw and
        // could not read. Absence from the response otherwise carries two meanings the wire cannot separate,
        // "this is gone" and "this defeated the reader", and the response already counts the second in its
        // `unreadable` drop tally while describing it as the first.
        var removed = isInit || !walk.Complete
            ? new List<string>()
            : knownItems.Keys
                .Where(k => !fullVersions.ContainsKey(k) && !unreadableBareNames.Contains(BareNameOf(k)))
                .ToList();

        // A PARTIAL walk can report no deletions at all, and that is the only honest answer available. Deletion
        // is derived from absence, and a folder the driver could not enumerate makes absence meaningless for
        // everything beneath it — a single faulting folder would otherwise delete the engineer's files for every
        // POU under it. Loud, because the alternative is a pull that quietly syncs less of the project than it
        // claims: the drivers already logged the skip (CODESYS at Warn, TwinCAT at Debug — off by default) and
        // neither reached the code that had to act on it.
        if (!walk.Complete)
            VoltLog.Warn(
                $"fetch: the project walk was INCOMPLETE — {walk.UnwalkedFolders.Count} folder(s) could not be " +
                $"enumerated ({string.Join(", ", walk.UnwalkedFolders)}). Deletions are suppressed for this " +
                "fetch: items under those folders were not seen, which is not the same as gone.");

        var drops = Drops(("unmapped-kind", unmapped), ("unreadable", unreadable),
                          ("lib-render-null", libRenderNull), ("lib-unmatched", libUnmatched));
        var libClause = librarySignatures > 0 ? $", {librarySignatures} library signatures" : "";
        VoltLog.Debug($"fetch{(isInit ? " init" : "")}: {projectChanged} of {fullVersions.Count} project items changed, {removed.Count} removed{libClause}{drops} ({sw.ElapsedMilliseconds}ms)");

        return new FetchResponse
        {
            ProjectVersion = Hasher.ComputeProjectVersion(versions),
            StructureVersion = Hasher.ComputeStructureVersion(versions),
            Changed = changed,
            Removed = removed,
            Items = fullVersions,
            Folders = folders,
            LibrariesRefreshed = librariesRefreshed,
            // Echo the project we actually walked, so the client can confirm it before merging. This is the LIVE
            // identity the guard checked, not a cached health row — the echo can't disagree with what was walked.
            Platform = bound.Vendor,
            ProjectName = bound.ProjectName,
        };
    }


    // The `.library` file extension, from the canonical registry (not a literal) — used to spot a removed library
    // in the client's knownItems (only .library keys are relevant to the library-change decision).

    // The RESOLUTION line of a `.library` manifest (written by LibraryManifest.Build). Hoisted to a static so it
    // isn't recompiled per library item on every walk.


    /// <summary>Format the non-zero drop tallies for the completion log — e.g. <c> (skipped: 2 unmapped-kind,
    /// 1 unreadable)</c>, or empty when nothing was dropped. Keeps the common clean-pull line uncluttered.</summary>
    private static string Drops(params (string Label, int Count)[] tallies)
    {
        var hit = tallies.Where(t => t.Count > 0).Select(t => $"{t.Count} {t.Label}").ToList();
        return hit.Count == 0 ? "" : $" (skipped: {string.Join(", ", hit)})";
    }



    /// <summary>Collapse same-name entries to the last (matching the name-keyed version map), preserving the
    /// order names first appeared. A no-op when all names are unique (the common case — source names are unique).</summary>
    /// <summary>A wire name without its kind extension — <c>FB_A.fb</c> → <c>FB_A</c>.
    /// <para>Used only to match a client-known name against an item the WALK saw but could not read, where the
    /// materialized full name is unavailable by definition. A library signature path keeps its folder prefix and
    /// simply never matches a walked bare name, which is correct: those are not walk items.</para></summary>
    private static string BareNameOf(string wireName)
    {
        var dot = wireName.LastIndexOf('.');
        return dot <= 0 ? wireName : wireName.Substring(0, dot);
    }

    private static List<FetchedItem> DedupeByFullName(List<FetchedItem> items)
    {
        var byName = new Dictionary<string, FetchedItem>(items.Count);
        var order = new List<string>();
        foreach (var it in items)
        {
            if (!byName.ContainsKey(it.Name)) order.Add(it.Name);
            byName[it.Name] = it;   // last wins
        }
        return byName.Count == items.Count ? items : order.ConvertAll(n => byName[n]);
    }
}
