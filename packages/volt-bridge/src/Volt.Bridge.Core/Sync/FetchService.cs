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
    public static FetchResponse Handle(IIdeDriver ide, FetchRequest request)
    {
        if (!ide.IsConnected) throw BridgeException.PlcDisconnected();

        var knownItems = request.KnownItems ?? new Dictionary<string, string>();
        var onlyItems = request.OnlyItems != null && request.OnlyItems.Count > 0
            ? new HashSet<string>(request.OnlyItems) : null;

        var versions = new Dictionary<string, string>();          // bare-name keys for aggregate hashing
        var fullVersions = new Dictionary<string, string>();       // full-name keys for wire Items
        var changed = new List<FetchedItem>();

        // For the verbose fold: normalized library RESOLUTION → the .library ref's (folder, bare name), captured
        // from the ref items in THIS walk, so each element signature is foldered right beside its own .library file.
        var libByResolution = new Dictionary<string, (string Folder, string Name)>(System.StringComparer.OrdinalIgnoreCase);

        foreach (var it in ide.WalkItems())
        {
            var kind = ItemKind.Map(it.KindCode);
            if (kind == null) continue;
            // Excluded-from-build objects have no compiler ground truth — omit them so the LSP never
            // false-positives on code the IDE itself doesn't compile.
            if (it.ExcludeFromBuild) continue;

            // Resilient: a malformed item must not crash a fetch of OTHER items. Unreadable → skip it (it can't
            // be materialized into a body), never throw for the whole batch.
            var version = Versioning.SafeVersion(ide, it.Name, kind, it.Item, it.Folder, out var mat);
            if (mat == null) continue;
            var fullName = mat.FullName;

            if (onlyItems != null && !onlyItems.Contains(it.Name) && !onlyItems.Contains(fullName)) continue;

            versions[it.Name] = version;
            fullVersions[fullName] = version;

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

            if (knownItems.TryGetValue(fullName, out var known) && known == version) continue;

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

        if (request.Verbose)
        {
            // EVERY referenced-library element signature rides through as a read-only item (no referenced-only gate
            // — the AI gets the full public API of the used libraries).
            AppendLibrarySignatures(ide, libByResolution, changed);
        }

        var removed = knownItems.Keys.Where(k => !fullVersions.ContainsKey(k)).ToList();

        return new FetchResponse
        {
            ProjectVersion = Hasher.ComputeProjectVersion(versions),
            StructureVersion = Hasher.ComputeStructureVersion(versions),
            Changed = changed,
            Removed = removed,
            Items = fullVersions,
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
}
