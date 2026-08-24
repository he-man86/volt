using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text.RegularExpressions;
using Volt.Engine.Ide;
using Volt.Engine.Library;
using Volt.Engine.Wire;
using Volt.Engine.Workspace;

using Volt.Cli.Transport;

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
        var walked = ide.WalkItems();
        var total = walked.Count; // the signature count folds in AFTER we know whether we're extracting (below)
        var done = 0;
        var unmapped = 0;    // KindCode the table doesn't map (opaque/unknown type) — dropped from the pull
        var unreadable = 0;  // exists + tracked, but body couldn't be materialized (SafeVersion logs the why at Warn)
        // The live .library file versions (fullName → version), captured in the loop — the change signal for the
        // referenced-library set. Compared to the client's knownItems to decide whether to extract.
        var liveLibVersions = new Dictionary<string, string>();
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
            if (mat == null) { unreadable++; continue; }
            var fullName = mat.FullName;

            if (onlyItems != null && !onlyItems.Contains(it.Name) && !onlyItems.Contains(fullName)) continue;

            fullVersions[fullName] = version;
            folders[fullName] = folder;

            if (kind == ItemKind.Kinds.Library)
            {
                // A library ref's body IS its manifest (LIBRARY/NAMESPACE/RESOLUTION/DEPENDENCIES…). Capture
                // RESOLUTION → (folder, name) so each library's signatures land under `<folder>/<name>/`, beside
                // its `.library` file.
                var res = ResolutionLine.Match(mat.Text).Groups[1].Value.Trim();
                if (res.Length > 0) libByResolution[res] = (walkedFolder, it.Name);
                // The .library file's version IS the change signal for its library (the manifest encodes the
                // resolved name+version); collect it to decide whether the signatures need re-extracting.
                liveLibVersions[fullName] = version;
            }

            if (!isInit && knownItems.TryGetValue(fullName, out var known) && known == version) continue;

            changed.Add(new FetchedItem
            {
                Name = fullName,
                Folder = folder,
                Version = version,
                SourceText = mat.Text,
            });
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
        var projectChanged = changed.Count;

        // Extract the referenced-library signatures ONLY when they're needed: never for a directed onlyItems preview,
        // never on a fetch whose .library versions all match the client's knownItems (no library changed — a
        // library's API is immutable per version, so the client's existing signature files still stand), and always
        // on init. This is the whole optimization: the precompile (Build) runs iff a .library version changed.
        var librariesUnchanged = !isInit && LibrariesUnchanged(liveLibVersions, knownItems);
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
        var (libRenderNull, libUnmatched) = AppendLibrarySignatures(libSigs, libByResolution, changed, onProgress, done, total);
        var librarySignatures = changed.Count - projectChanged; // read-only library API files, written beside each .library

        var removed = isInit ? new List<string>() : knownItems.Keys.Where(k => !fullVersions.ContainsKey(k)).ToList();

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

    /// <summary>Render the SIGNATURE (declaration only) of EVERY referenced-library element and add it as a
    /// read-only <see cref="FetchedItem"/> beside its library's `.library` file (folder
    /// <c>&lt;lib folder&gt;/&lt;lib name&gt;</c>, name <c>&lt;Element&gt;&lt;ext&gt;</c>). No referenced-only gate:
    /// the full public API of every used library is materialized so the AI/LSP can resolve into any of it. The
    /// library is matched to its `.library` ref by RESOLUTION; an unmatched lib falls back to the shared Library
    /// Manager folder. Takes the signatures <c>Handle</c> already extracted up front (so their count folds into the
    /// one progress total); renders them, ticking the shared bar. TwinCAT returns none. The version is a content
    /// hash — read-only, never a push target.</summary>
    /// <returns>(renderNull, unmatched): how many element signatures couldn't be rendered, and how many
    /// were foldered under `(unresolved)` because their owning library matched no `.library` ref.</returns>
    private static (int RenderNull, int Unmatched) AppendLibrarySignatures(
        IReadOnlyList<LibSignature> sigs, Dictionary<string, (string Folder, string Name)> libByResolution,
        List<FetchedItem> changed, Action<ProgressFrame>? onProgress, int startDone, int total)
    {
        // The Library Manager base folder (all refs share it) — home of the LOUD `(unresolved)` marker below.
        var libManBase = libByResolution.Values.Select(v => v.Folder).FirstOrDefault(f => f.Length > 0) ?? "";
        var renderNull = 0;
        var unmatched = 0;
        var i = 0;
        foreach (var sig in sigs)
        {
            // Tick the shared progress bar (throttled, ~every 25) as each signature renders — the same continuous
            // fraction as the item walk, picking up where it left off (startDone == walked.Count).
            i++;
            if (onProgress != null && (i % 25 == 0 || i == sigs.Count))
                onProgress(new ProgressFrame { Operation = Ops.Fetch, Done = startDone + i, Total = total });

            // Render-null: a sub-signature (method/property — covered by its parent FB) or an unknown POUType.
            if (LibSignatureRenderer.Render(sig) is not { } r) { renderNull++; VoltLog.Debug($"fetch skip: render-null lib sig '{sig.Name}' (pouType={sig.PouType}, lib={sig.LibraryPath})"); continue; }
            string libFolder;
            if (libByResolution.TryGetValue(sig.LibraryPath, out var lib))
                // Identified: fold the element beside its library's `.library` file (matched by RESOLUTION).
                libFolder = LibraryFolder(lib.Folder, lib.Name);
            else
            {
                // NOT identified: its owning library matched no `.library` ref by RESOLUTION (CODESYS facade /
                // Interfaces-Implementation split). Do NOT silently drop it and do NOT guess it into a real
                // library's folder — surface it LOUD under an explicit `(unresolved)` marker so the matching gap
                // is impossible to miss (nothing lost, no hidden bug). See openspec bridge-diagnostics-observability.
                libFolder = LibraryFolder(LibraryFolder(libManBase, "(unresolved)"), Sanitize(sig.LibraryPath.Split(',')[0].Trim()));
                unmatched++;
                VoltLog.Debug($"fetch: lib element '{sig.Name}' — owning library '{sig.LibraryPath}' matched no .library ref, foldered under (unresolved)");
            }
            var fileName = $"{Sanitize(sig.Name)}{r.Ext}";
            changed.Add(new FetchedItem
            {
                Name = fileName,
                Folder = libFolder,
                SourceText = r.Text,
                Version = Hasher.ComputeItemVersion(libFolder, r.Text),
            });
        }
        return (renderNull, unmatched);
    }

    // The `.library` file extension, from the canonical registry (not a literal) — used to spot a removed library
    // in the client's knownItems (only .library keys are relevant to the library-change decision).
    private static readonly string LibraryExt = "." + ItemKind.ExtFor(ItemKind.Kinds.Library);

    // The RESOLUTION line of a `.library` manifest (written by LibraryManifest.Build). Hoisted to a static so it
    // isn't recompiled per library item on every walk.
    private static readonly Regex ResolutionLine = new Regex(@"^RESOLUTION (.+)$", RegexOptions.Multiline);

    /// <summary>True when the referenced-library set is unchanged versus the client's <paramref name="knownItems"/>:
    /// every live <c>.library</c> version matches what the client already has, AND no <c>.library</c> the client
    /// knows has been removed. An add, a version bump, or a removal all make it false ⇒ re-extract. Reuses the same
    /// per-file version hash carried in knownItems — no separate fingerprint.</summary>
    public static bool LibrariesUnchanged(IReadOnlyDictionary<string, string> liveLibVersions, IReadOnlyDictionary<string, string> knownItems)
    {
        foreach (var kv in liveLibVersions)
            if (!knownItems.TryGetValue(kv.Key, out var known) || known != kv.Value) return false; // added or changed
        foreach (var key in knownItems.Keys)
            if (key.EndsWith(LibraryExt, StringComparison.OrdinalIgnoreCase) && !liveLibVersions.ContainsKey(key)) return false; // removed
        return true;
    }

    /// <summary>Format the non-zero drop tallies for the completion log — e.g. <c> (skipped: 2 unmapped-kind,
    /// 1 unreadable)</c>, or empty when nothing was dropped. Keeps the common clean-pull line uncluttered.</summary>
    private static string Drops(params (string Label, int Count)[] tallies)
    {
        var hit = tallies.Where(t => t.Count > 0).Select(t => $"{t.Count} {t.Label}").ToList();
        return hit.Count == 0 ? "" : $" (skipped: {string.Join(", ", hit)})";
    }

    private static string Sanitize(string s) => Regex.Replace(s, "[<>:\"/\\\\|?*]", "_").Trim();

    /// <summary>A library's own workspace folder — its element folder, holding both the `.library` stub and the
    /// element signatures (`Library Manager/&lt;lib&gt;/`). One definition so the stub and its elements always
    /// colocate.</summary>
    private static string LibraryFolder(string? folder, string name) => Library.LibraryLayout.FolderFor(folder, name);

    /// <summary>Collapse same-name entries to the last (matching the name-keyed version map), preserving the
    /// order names first appeared. A no-op when all names are unique (the common case — source names are unique).</summary>
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
