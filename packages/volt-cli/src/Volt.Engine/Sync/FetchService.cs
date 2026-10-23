using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text.RegularExpressions;

using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Ide;
using Volt.Engine.Library;
using Volt.Engine.Format.Body;
using Volt.Engine.Item;
using Volt.Engine.Seam;

namespace Volt.Engine.Sync;

/// <summary><c>/fetch</c>: like <c>/refs</c>, but ships the materialized source for every item whose
/// version differs from the client's known version.
///
/// <b>EVERY key here is the item's PATH</b> (<c>&lt;folder&gt;/&lt;name&gt;.&lt;kind&gt;</c>) - the aggregate versions
/// included. IEC makes names unique within a kind, not across them (<c>CM_Carrier.pou</c> beside
/// <c>CM_Carrier.visualization</c>), and not across applications either (two devices each holding <c>PLC_PRG</c>), so a
/// shorter key lets one item shadow the other in <c>projectVersion</c> and in the push's <c>ifVersion</c> gate (the V71
/// data-loss bug; openspec <c>multi-application-tree</c>). The identity is derived in ONE place,
/// <c>VersionedItem.Identity</c>, and every map below keys on it.
///
/// Every walked item is returned as ordinary source. Dead (uncalled) code and exclude-from-build objects alike
/// ship as plain files (the exclusion is a <c>%EXCLUDE_FROM_BUILD</c> property line); the LSP decides reachability
/// itself.</summary>
public static class FetchService
{
    public static FetchResponse Handle(HostLink link, FetchRequest request, Action<ProgressFrame>? onProgress = null)
    {
        // Connected + right-project guard — atomic with the walk.
        var bound = OpGuard.RequireBoundProject(link, request.ExpectedPlatform, request.ExpectedProjectName);

        var isInit = request.Init;
        var knownItems = request.KnownItems ?? new Dictionary<string, string>();
        // `[]` MEANS "THESE ZERO ITEMS", everywhere — never collapsed to null, which would read as "every item" to the
        // per-item filter and run the full library-signature extraction for a directed preview of nothing.
        // An ADDRESSED path finds the IDE item ignoring case, as push's `name`/`to` do (openspec one-path-comparer); the
        // answer spells the IDE's path. A HELD key (`knownItems`) stays exact: see Removal.
        var onlyItems = request.OnlyItems is null ? null : new HashSet<string>(request.OnlyItems, StringComparer.OrdinalIgnoreCase);

        // A normal fetch without a knownItems baseline is ambiguous — did the client mean "everything" or
        // did it forget to supply a sidecar? The init op (`volt init`) is the first pull instead.
        // An onlyItems fetch without knownItems IS allowed (directed preview, used by E2E harness).
        // BAD_REQUEST: the request lacks a field the wire needs; the message names the fields, not a CLI command
        // (openspec bridge-refusal-review V.3).
        if (!isInit && request.KnownItems == null && request.OnlyItems == null)
            throw new BridgeException(BridgeErrorCodes.BadRequest,
                "a fetch needs a baseline: send `knownItems` (or `onlyItems` for a directed read), or `init: true` for a first pull");

        var fullVersions = new Dictionary<string, string>();
        var changed = new List<FetchedItem>();

        // EVERY walked `.library` ref — named or not — so each element signature is foldered right beside its owning
        // .library file by the ONE matcher (LibraryMatcher). Captured BEFORE the onlyItems skip: the owner of a repeated
        // RESOLUTION and the different-RESOLUTION refusal both need the refs a directed read did not name.
        var libRefs = new List<LibraryRef>();
        var namedLibRefs = new List<LibraryRef>();

        var sw = Stopwatch.StartNew();

        // Walk the project FIRST — the walk is build-free (a tree descent, no precompile). We extract the referenced-
        // library signatures ONLY when a library actually changed, decided below from the .library files' own versions
        // (each is hashed like any other file), so the expensive precompile runs on a real library change, not every
        // fetch. Ordering is safe: the precompile reads its own language model, never the walked item handles, and
        // every item is already materialized by the time we (maybe) build — so a build can't stale a handle
        // mid-materialize (the same property that lets the onlyItems preview skip the build).
        //
        // THE walk refs answers with (`ProjectSnapshot.Walk`): its gates, its version map (every walked item, readable
        // or not, regardless of onlyItems — so the aggregate matches /refs and the push receipt) and its unreadable
        // list. Fetch adds, per readable item, the onlyItems subset, the library refs and the changed bodies.
        // The live .library file versions (path → version), captured in the walk — the change signal for the
        // referenced-library set. Compared to the client's knownItems to decide whether to extract.
        var liveLibVersions = new Dictionary<string, string>();
        // `.library` stubs the walk skipped as unchanged, held in case the signatures get re-rendered.
        var skippedLibraryStubs = new List<FetchedItem>();

        void OnItem(WalkedItem it, string folder, VersionedItem v)
        {
            if (v.Materialized is not { } mat) return;   // unreadable: the snapshot names it and spares it from removal
            var version = v.Version;
            var path = v.Identity;
            var named = onlyItems == null || onlyItems.Contains(path);

            if (it.Kind == ItemKind.Kinds.Library)
            {
                // A library ref's body IS its manifest (LIBRARY/NAMESPACE/RESOLUTION/DEPENDENCIES…). Its RESOLUTION
                // is what the matcher joins each signature's LibraryPath to, so the library's signatures land under
                // `<folder>/<name>/`, beside its `.library` file.
                var res = LibraryFetch.ResolutionLine.Match(mat.Text).Groups[1].Value.Trim();
                var libRef = new LibraryRef(mat.FullName, it.Name, it.Folder, res, version, null);
                libRefs.Add(libRef);
                if (onlyItems != null && named) namedLibRefs.Add(libRef);
                // The .library file's version IS the change signal for its library (the manifest encodes the
                // resolved name+version); collect it to decide whether the signatures need re-extracting.
                liveLibVersions[path] = version;
            }

            if (!named) return;

            fullVersions[path] = version;

            var item = new FetchedItem
            {
                Name = path,
                Version = version,
                SourceText = mat.Text,
                Unsupported = UnsupportedOf(mat),
            };

            if (!isInit && knownItems.TryGetValue(path, out var known) && known == version)
            {
                // Unchanged, so normally there is nothing to send. A `.library` STUB is the exception: if the
                // signatures end up re-rendered, `Changed` is the COMPLETE picture per library folder (the flag
                // below says so, and `IdeTree` acts on it), and a folder arriving WITHOUT its stub reads as
                // "this library is gone". Whether that happens is not known until the walk finishes, so hold the
                // stub rather than deciding here.
                if (it.Kind == ItemKind.Kinds.Library) skippedLibraryStubs.Add(item);
                return;
            }

            changed.Add(item);
        }

        var snap = ProjectSnapshot.Walk(link, onProgress, Ops.Fetch, phase: null, onItem: OnItem);
        var unwalkedFolders = snap.UnwalkedFolders;
        var done = snap.Walked;
        // Each library ref's APPLICATION, now that the walk has stated them: a signature extracted for one application
        // lands beside that application's own `.library` (design §6), never another's.
        libRefs = libRefs.Select(r => r with { Application = ItemPath.ApplicationOf(r.Path, snap.Applications) }).ToList();
        namedLibRefs = libRefs.Where(r => namedLibRefs.Any(n => n.Path == r.Path)).ToList();

        // The wire is keyed by PATH: `versions`/`Items` collapse two walk items of one path last-write-wins, so
        // `changed` must agree — otherwise they would materialize as TWO entries for one file while the version map
        // tracks one. Collapse to the last occurrence per path (a no-op on a real tree, where a folder holds one object
        // of a name and kind).
        changed = DedupeByPath(changed);
        // Project source items in this diff — captured BEFORE the library signatures are appended, so the two are
        // never conflated: `changed` below would otherwise mix a handful of edited POUs with thousands of read-only
        // library API files and read as nonsense ("880 items, 8104 changed").
        // `librariesRefreshed` is ONE decision, computed ONCE, BEFORE `projectChanged` is taken: whether the held stubs
        // belong in `changed` depends on it, and the stubs and the signature render must agree on it.
        // A known library this read did not SEE is not a removed one: refreshing over it would answer "complete set"
        // with its signatures missing, and the client drops them all (environment-dependency-audit 2.0 — a CODESYS
        // library manager named unreadable leaves its folder unwalked). Seen-or-gone is decided by THE removal rule,
        // per folder: absent from a manager the walk DID read is removed, whatever other folder it could not read.
        var goneFromWalk = Removal.Removed(knownItems.Keys, fullVersions.Keys, snap.Unreadable.Select(u => u.Name), unwalkedFolders, snap.Applications, request.KnownApplications, link.Catalog.Kinds);
        var unseenLibrary = knownItems.Keys.Any(k =>
            k.EndsWith(LibraryFetch.LibraryExt, StringComparison.OrdinalIgnoreCase) && !liveLibVersions.ContainsKey(k)
            && !goneFromWalk.Contains(k));
        var librariesRefreshed = onlyItems == null
            && (isInit || (!LibraryFetch.LibrariesUnchanged(liveLibVersions, knownItems) && !unseenLibrary));
        if (librariesRefreshed && skippedLibraryStubs.Count > 0)
        {
            // A library whose own version did not move still has to be described, or the client deletes it. That
            // costs more than one file: with the stub gone `IdeTree.LibraryRoots` stops recognising the folder,
            // so everything under it loses both the removal exemption and the read-only guard — and a `.dut`
            // there becomes PUSHABLE as a project item, keyed by bare name, either creating junk inside the
            // Library Manager or overwriting the project's own DUT of the same short name. `volt status` stays
            // clean throughout, because the sidecar still lists it.
            changed.AddRange(skippedLibraryStubs);
            changed = DedupeByPath(changed);
        }

        var projectChanged = changed.Count;

        // Extract the referenced-library signatures ONLY when they're needed: on a full fetch, never when its .library
        // versions all match the client's knownItems (no library changed — a library's API is immutable per version,
        // so the client's existing signature files still stand), and always on init. This is the whole optimization:
        // the precompile (Build) runs iff a .library version changed.
        // ONE decision, named — because the RESPONSE has to tell the client which of the two worlds it is in.
        // Signatures re-rendered ⇒ Changed carries the complete set per library folder, so anything the client
        // still holds there is gone. Not re-rendered ⇒ Changed carries no signatures at all, so the client must
        // keep what it has. Without this flag the client cannot tell the cases apart and had to keep them
        // always — which is why a removed library's signatures were immortal.
        //
        // A DIRECTED read that names a `.library` returns that library's signatures too (openspec
        // directed-library-signatures): the same extraction — neither vendor has a per-library call (DIALECT C2c) — taken
        // from the session's cache when every walked library's version is the one it was extracted against (on CODESYS
        // every extraction is a `Build(app)` that rewrites the engineer's message view), and only the NAMED libraries'
        // signatures rendered. `librariesRefreshed` stays false on it: the answer is complete for the named folders
        // only. `LibraryManifestOnly` (volt show BRIDGE) answers the manifest alone and touches nothing.
        var project = $"{bound.Vendor}\n{bound.ProjectName}";
        var directedLibraries = onlyItems != null && namedLibRefs.Count > 0 && !request.LibraryManifestOnly;
        IReadOnlyList<LibSignature> libSigs;
        if (librariesRefreshed)
        {
            libSigs = link.Driver.ExtractLibrarySignatures();
            link.Session.LibrarySignatureCache.Store(project, libRefs, libSigs);
        }
        else if (directedLibraries)
        {
            if (link.Session.LibrarySignatureCache.Reuse(project, libRefs) is { } cached) libSigs = cached;
            else
            {
                libSigs = link.Driver.ExtractLibrarySignatures();
                link.Session.LibrarySignatureCache.Store(project, libRefs, libSigs);
            }
        }
        else libSigs = Array.Empty<LibSignature>();
        var total = done + libSigs.Count; // fold the (now known) signature count into the bar's tail

        // EVERY referenced-library element signature rides through as a read-only item (no referenced-only gate —
        // the AI gets the full public API of the used libraries). Render the signatures now, ticking the SAME
        // progress bar (no separate phase); `done` is every walked object here (the walk finished).
        var (libRenderNull, libUnmatched) = directedLibraries
            ? LibraryFetch.AppendNamed(libSigs, libRefs, namedLibRefs, changed, onProgress, done, total)
            : LibraryFetch.AppendAll(libSigs, libRefs, changed, onProgress, done, total);
        var librarySignatures = changed.Count - projectChanged; // read-only library API files, written beside each .library

        // "Known to the client, and this walk produced no version for it" — MINUS the items the walk saw and
        // could not read. Absence from the response otherwise carries two meanings the wire cannot separate,
        // "this is gone" and "this defeated the reader", and the response already counts the second in its
        // `unreadable` drop tally while describing it as the first.
        // NOTHING OUTSIDE THE SUBSET IS "REMOVED": `onlyItems` skips items before they reach `fullVersions`, and a
        // client acts on `removed` (`IdeTree.BuildVoltIdeTree`), so a directed fetch with a real baseline would wipe the
        // workspace down to the subset. Absence is only evidence of deletion where you looked — the same rule `Removal`
        // applies per folder to a PARTIAL walk.
        var removed = isInit || onlyItems != null
            ? new List<string>()
            : goneFromWalk;

        // Loud, because the alternative is a pull that quietly syncs less of the project than it claims: the
        // drivers already logged the skip (CODESYS at Warn, TwinCAT at Debug — off by default) and neither reached
        // the code that had to act on it.
        if (unwalkedFolders.Count > 0)
            VoltLog.Warn(
                $"fetch: the project walk was INCOMPLETE — {unwalkedFolders.Count} folder(s) could not be " +
                $"enumerated ({string.Join(", ", unwalkedFolders)}). An item under those folders is reported " +
                "removed by this fetch only when the walk found it at another path of its own application (moved): " +
                "items there were not seen, which is not the same as gone.");

        var drops = Drops(("unreadable", snap.Unreadable.Count),
                          ("lib-render-null", libRenderNull), ("lib-unmatched", libUnmatched));
        var libClause = librarySignatures > 0 ? $", {librarySignatures} library signatures" : "";
        VoltLog.Debug($"fetch{(isInit ? " init" : "")}: {projectChanged} of {fullVersions.Count} project items changed, {removed.Count} removed{libClause}{drops} ({sw.ElapsedMilliseconds}ms)");

        return new FetchResponse
        {
            ProjectVersion = snap.ProjectVersion,
            Changed = changed,
            Removed = removed,
            Items = fullVersions,
            Applications = snap.Applications.ToList(),
            // The items the walk found and could not materialize. Already tracked (with the Unreadable sentinel,
            // so the removal pass does not read "absent" as "deleted") and already counted in the log — naming
            // them on the wire is what makes an item that simply never arrives visible to a client at all.
            Unreadable = snap.Unreadable,
            UnreadableNodes = snap.UnreadableNodes,
            // The caveat travels WITH the answer. `removed` above already spares everything under these
            // folders; saying so is what lets a client keep the baseline entries it did not see as well.
            UnwalkedFolders = unwalkedFolders.ToList(),
            LibrariesRefreshed = librariesRefreshed,
            // Echo the project we actually walked, so the client can confirm it before merging. This is the LIVE
            // identity the guard checked, not a cached health row — the echo can't disagree with what was walked.
            Platform = bound.Vendor,
            ProjectName = bound.ProjectName,
        };
    }


    /// <summary>The item's <c>IMPLEMENTATION LD|FBD UNSUPPORTED</c> bodies with why — the wire's <c>unsupported</c>, or
    /// null when it has none. A CFC, SFC or IL body is hidden too, and carries no reason: its line says it all.</summary>
    private static List<UnsupportedBody>? UnsupportedOf(WorkspaceItem mat)
    {
        var bodies = mat.Hidden.Where(h => h.Reason is not null)
            .Select(h => new UnsupportedBody { Member = h.Member, Language = h.Language, Reason = h.Reason! }).ToList();
        return bodies.Count == 0 ? null : bodies;
    }

    /// <summary>Format the non-zero drop tallies for the completion log — e.g. <c> (skipped: 2 unmapped-kind,
    /// 1 unreadable)</c>, or empty when nothing was dropped. Keeps the common clean-pull line uncluttered.</summary>
    private static string Drops(params (string Label, int Count)[] tallies)
    {
        var hit = tallies.Where(t => t.Count > 0).Select(t => $"{t.Count} {t.Label}").ToList();
        return hit.Count == 0 ? "" : $" (skipped: {string.Join(", ", hit)})";
    }

    /// <summary>Collapse same-path entries to the last (matching the path-keyed version map), preserving the
    /// order paths first appeared. A no-op when all paths are unique (the case on a real tree).</summary>
    private static List<FetchedItem> DedupeByPath(List<FetchedItem> items)
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
