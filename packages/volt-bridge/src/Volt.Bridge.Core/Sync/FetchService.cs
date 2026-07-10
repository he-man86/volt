using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Volt.Bridge.Core.Ide;
using Volt.Bridge.Core.Library;
using Volt.Bridge.Core.Wire;
using Volt.Bridge.Core.Workspace;

namespace Volt.Bridge.Core.Sync;

/// <summary><c>/fetch</c>: like <c>/refs</c>, but ships the materialized source for every item whose
/// version differs from the client's known version.
///
/// Aggregate versions (projectVersion, structureVersion) use bare-name keys — same as /refs and
/// PushService conflict detection. The wire Items and Changed[].Name use full-name keys.
///
/// The bridge omits objects the IDE won't compile (excluded-from-build) — they have no compiler ground
/// truth, so the LSP would only false-positive on them, and there is no side-channel marker field. Dead
/// (uncalled) code IS returned as ordinary source; the LSP decides reachability itself. Everything the
/// bridge returns is analyzable.</summary>
public static class FetchService
{
    public static FetchResponse Handle(IIdeDriver ide, FetchRequest request, Action<ProgressFrame>? onProgress = null)
    {
        if (!ide.IsConnected) throw BridgeException.PlcDisconnected();

        var isInit = request.Init;
        var knownItems = request.KnownItems ?? new Dictionary<string, string>();
        var onlyItems = request.OnlyItems != null && request.OnlyItems.Count > 0
            ? new HashSet<string>(request.OnlyItems) : null;

        // Normal /fetch without a knownItems baseline is ambiguous — did the client mean "everything" or
        // did it forget to supply a sidecar? The /init endpoint should be used for the first pull instead.
        // An onlyItems fetch without knownItems IS allowed (directed preview, used by E2E harness).
        if (!isInit && request.KnownItems == null && request.OnlyItems == null)
            throw new BridgeException(400, "NO_SIDECAR", "supply knownItems to diff against, or use POST /init for the first pull");

        var versions = new Dictionary<string, string>();
        var fullVersions = new Dictionary<string, string>();
        var folders = new Dictionary<string, string>();
        var changed = new List<FetchedItem>();

        // For the verbose fold: normalized library RESOLUTION → the .library ref's (folder, bare name), captured
        // from the ref items in THIS walk, so each element signature is foldered right beside its own .library file.
        var libByResolution = new Dictionary<string, (string Folder, string Name)>(System.StringComparer.OrdinalIgnoreCase);

        // Materialize the walk once so we know the total up front (for the progress fraction) and don't re-walk.
        var walked = ide.WalkItems();
        var total = walked.Count;
        var done = 0;
        onProgress?.Invoke(new ProgressFrame { Operation = "fetch", Done = 0, Total = total, Phase = "reading" });

        foreach (var it in walked)
        {
            // Report over the walk, throttled — a frame every ~25 items (and the last) keeps the bar smooth
            // without a write per item.
            done++;
            if (onProgress != null && (done % 25 == 0 || done == total))
                onProgress(new ProgressFrame { Operation = "fetch", Done = done, Total = total });

            var kind = ItemKind.Map(it.KindCode);
            if (kind == null) continue;
            // A container-manager (library / recipe / visualization manager) is a FOLDER, never a tracked item —
            // it only groups its children (see ItemKind.IsContainerManager). The driver walks already avoid
            // emitting it; this is the Core backstop so the invariant holds for EVERY vendor structurally, not
            // per-driver — a stray manager can never materialize as a stub file.
            if (ItemKind.IsContainerManager(it.KindCode)) continue;
            // Excluded-from-build objects have no compiler ground truth — omit them so the LSP never
            // false-positives on code the IDE itself doesn't compile.
            if (it.ExcludeFromBuild) continue;

            // Resilient: a malformed item must not crash a fetch of OTHER items. Unreadable → skip its BODY (it
            // can't be materialized), never throw for the whole batch.
            var version = Versioning.SafeVersion(ide, it.Name, kind, it.Item, it.Folder, out var mat);
            // The aggregate project/structure version must cover EVERY walked item — readable or not, and
            // regardless of the onlyItems subset — so it matches /refs and the push receipt (an unreadable item
            // still exists and is tracked with its sentinel version). Recorded here, before the body gates below;
            // otherwise a single unreadable item makes /fetch's projectVersion diverge from /refs'.
            versions[it.Name] = version;
            if (mat == null) continue;
            var fullName = mat.FullName;

            if (onlyItems != null && !onlyItems.Contains(it.Name) && !onlyItems.Contains(fullName)) continue;

            fullVersions[fullName] = version;
            folders[fullName] = it.Folder ?? "";

            if (request.Verbose)
            {
                if (kind == "library")
                {
                    // A library ref's body IS its manifest (LIBRARY/NAMESPACE/RESOLUTION/DEPENDENCIES…). Capture
                    // RESOLUTION → (folder, name) so the verbose fold places each library's signatures under
                    // `<folder>/<name>/`, beside its `.library` file.
                    var res = Regex.Match(mat.Text, @"^RESOLUTION (.+)$", RegexOptions.Multiline).Groups[1].Value.Trim();
                    if (res.Length > 0) libByResolution[res] = (it.Folder ?? "", it.Name);
                }
            }

            if (!isInit && knownItems.TryGetValue(fullName, out var known) && known == version) continue;

            changed.Add(new FetchedItem
            {
                Name = fullName,
                // A `.library` ref is nested INTO its own library folder so `<lib>.library` sits beside the
                // signatures it describes (`Library Manager/<lib>/<lib>.library`). Only the FOLDER changes; the
                // item NAME (the protocol identity) is untouched, and library refs are read-only (no push impact).
                Folder = kind == "library" ? LibraryFolder(it.Folder, it.Name) : it.Folder,
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

        if (request.Verbose)
        {
            // EVERY referenced-library element signature rides through as a read-only item (no referenced-only gate
            // — the AI gets the full public API of the used libraries). This is the slow second phase on a big
            // project (precompile + render), so flag it as its own indeterminate phase.
            onProgress?.Invoke(new ProgressFrame { Operation = "fetch", Done = done, Total = total, Phase = "rendering libraries" });
            AppendLibrarySignatures(ide, libByResolution, changed);
        }

        var removed = isInit ? new List<string>() : knownItems.Keys.Where(k => !fullVersions.ContainsKey(k)).ToList();

        return new FetchResponse
        {
            ProjectVersion = Hasher.ComputeProjectVersion(versions),
            StructureVersion = Hasher.ComputeStructureVersion(versions),
            Changed = changed,
            Removed = removed,
            Items = fullVersions,
            Folders = folders,
        };
    }

    /// <summary>Render the SIGNATURE (declaration only) of EVERY referenced-library element and add it as a
    /// read-only <see cref="FetchedItem"/> beside its library's `.library` file (folder
    /// <c>&lt;lib folder&gt;/&lt;lib name&gt;</c>, name <c>&lt;Element&gt;&lt;ext&gt;</c>). No referenced-only gate:
    /// the full public API of every used library is materialized so the AI/LSP can resolve into any of it. The
    /// library is matched to its `.library` ref by RESOLUTION; an unmatched lib falls back to the shared Library
    /// Manager folder. Extraction precompiles the libraries first (see <c>ExtractLibrarySignatures</c>). TwinCAT
    /// returns none. The version is a content hash — read-only, never a push target.</summary>
    private static void AppendLibrarySignatures(IIdeDriver ide, Dictionary<string, (string Folder, string Name)> libByResolution, List<FetchedItem> changed)
    {
        // The Library Manager base folder (all refs share it) — home of the LOUD `(unresolved)` marker below.
        var libManBase = libByResolution.Values.Select(v => v.Folder).FirstOrDefault(f => f.Length > 0) ?? "";
        foreach (var sig in ide.ExtractLibrarySignatures())
        {
            if (LibSignatureRenderer.Render(sig) is not { } r) continue;
            string libFolder;
            if (libByResolution.TryGetValue(sig.LibraryPath, out var lib))
                // Identified: fold the element beside its library's `.library` file (matched by RESOLUTION).
                libFolder = LibraryFolder(lib.Folder, lib.Name);
            else
                // NOT identified: its owning library matched no `.library` ref by RESOLUTION (CODESYS facade /
                // Interfaces-Implementation split). Do NOT silently drop it and do NOT guess it into a real
                // library's folder — surface it LOUD under an explicit `(unresolved)` marker so the matching gap
                // is impossible to miss (nothing lost, no hidden bug). See openspec bridge-diagnostics-observability.
                libFolder = LibraryFolder(LibraryFolder(libManBase, "(unresolved)"), Sanitize(sig.LibraryPath.Split(',')[0].Trim()));
            var fileName = $"{Sanitize(sig.Name)}{r.Ext}";
            changed.Add(new FetchedItem
            {
                Name = fileName,
                Folder = libFolder,
                SourceText = r.Text,
                Version = Hasher.ComputeItemVersion(libFolder, r.Text),
            });
        }
    }

    private static string Sanitize(string s) => Regex.Replace(s, "[<>:\"/\\\\|?*]", "_").Trim();

    /// <summary>A library's own workspace folder — its element folder, holding both the `.library` stub and the
    /// element signatures (`Library Manager/&lt;lib&gt;/`). One definition so the stub and its elements always
    /// colocate.</summary>
    private static string LibraryFolder(string? folder, string name) =>
        string.IsNullOrEmpty(folder) ? Sanitize(name) : $"{folder}/{Sanitize(name)}";

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
