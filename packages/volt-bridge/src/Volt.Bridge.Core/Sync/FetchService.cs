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
/// The bridge only returns items that have compiler ground truth: an object the IDE won't compile
/// (excluded-from-build) or a POU CODESYS never compiled (dead/uncalled code, detectable only on a
/// <c>verbose</c> fetch that ran a build) is OMITTED entirely — the LSP can't analyze it without false
/// positives, and there is no side-channel marker field. Everything the bridge returns is analyzable.</summary>
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
        // Every identifier the PROJECT source mentions — the "referenced" set that gates which library element
        // signatures are materialized (referenced-only). Case-insensitive (IEC identifiers are).
        var referenced = new HashSet<string>(System.StringComparer.OrdinalIgnoreCase);
        // Project POU items (FB/PRG/FUNCTION), for the dead-code check: a POU CODESYS never compiled is uncalled.
        var pouItems = new List<(string BareName, string FullName)>();

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
                    // A library ref's body IS its manifest (LIBRARY/NAMESPACE/RESOLUTION/…). Capture RESOLUTION →
                    // (folder, name) so the verbose fold can place each library's signatures under `<folder>/<name>/`.
                    var res = Regex.Match(mat.Text, @"^RESOLUTION (.+)$", RegexOptions.Multiline).Groups[1].Value.Trim();
                    if (res.Length > 0) libByResolution[res] = (it.Folder ?? "", it.Name);
                }
                else
                {
                    // Collect every identifier this project item's source mentions — the referenced-only gate below.
                    foreach (Match m in IdentifierRx.Matches(mat.Text)) referenced.Add(m.Value);
                }
                if (kind == "program" || kind == "function" || kind == "function_block")
                    pouItems.Add((it.Name, fullName));
            }

            if (knownItems.TryGetValue(fullName, out var known) && known == version) continue;

            changed.Add(new FetchedItem
            {
                Name = fullName,
                Folder = it.Folder,
                Version = version,
                SourceText = mat.Text,
            });
        }

        if (request.Verbose)
        {
            // Referenced-library element signatures ride through as ordinary read-only items.
            AppendLibrarySignatures(ide, libByResolution, referenced, changed);

            // Dead code: a project POU CODESYS did NOT compile (absent from the compiled model) is uncalled and
            // has no compiler ground truth — omit it entirely (drop from changed + versions), like an excluded
            // object. Null ⇒ can't determine (build failed / TwinCAT) → omit nothing.
            var compiled = ide.GetCompiledPouNames();
            if (compiled != null)
            {
                var deadFull = new HashSet<string>(
                    pouItems.Where(p => !compiled.Contains(p.BareName)).Select(p => p.FullName));
                if (deadFull.Count > 0)
                {
                    changed.RemoveAll(c => deadFull.Contains(c.Name));
                    foreach (var p in pouItems)
                        if (deadFull.Contains(p.FullName)) { versions.Remove(p.BareName); fullVersions.Remove(p.FullName); }
                }
            }
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

    private static readonly Regex IdentifierRx = new(@"[A-Za-z_][A-Za-z0-9_]*", RegexOptions.Compiled);

    /// <summary>Render the SIGNATURE (declaration only) of every referenced-library element the PROJECT actually
    /// names (`referenced`) and add it as a regular read-only <see cref="FetchedItem"/> beside the library's own
    /// `.library` file: folder <c>&lt;lib folder&gt;/&lt;lib name&gt;</c>, name <c>&lt;Element&gt;&lt;ext&gt;</c>.
    /// Referenced-only keeps the tree small AND correctly includes used SYSTEM-library elements (e.g. the `BLINK`
    /// FB a project `EXTENDS`, `StrReplaceA`) that a blanket system-library skip would drop — while excluding the
    /// thousands of never-referenced elements. Member access into an unmaterialized type is conservatively
    /// unchecked, so no transitive closure is needed. The library is matched to its `.library` ref by RESOLUTION;
    /// an unmatched lib falls back to the shared Library Manager folder. Extraction precompiles the libraries first
    /// (see <c>ExtractLibrarySignatures</c>). TwinCAT returns none. The version is a content hash — read-only, never
    /// a push target.</summary>
    private static void AppendLibrarySignatures(IIdeDriver ide, Dictionary<string, (string Folder, string Name)> libByResolution, HashSet<string> referenced, List<FetchedItem> changed)
    {
        // Fallback folder for a signature whose library didn't match a .library ref (should be rare now that the
        // full dependency tree is materialized): the folder shared by the known library refs.
        var fallbackFolder = libByResolution.Values.Select(v => v.Folder).FirstOrDefault(f => f.Length > 0) ?? "";
        foreach (var sig in ide.ExtractLibrarySignatures())
        {
            if (!referenced.Contains(sig.Name)) continue; // referenced-only: the project source names this element
            if (LibSignatureRenderer.Render(sig) is not { } r) continue;
            // Join the element's owning library ("name, version (company)") to its .library ref (matched by
            // RESOLUTION, case-insensitively) for the folder + name; fall back to the raw path segment.
            var (folder, name) = libByResolution.TryGetValue(sig.LibraryPath, out var lib)
                ? (lib.Folder, lib.Name)
                : (fallbackFolder, Sanitize(sig.LibraryPath.Split(',')[0]));
            var libFolder = $"{folder}/{Sanitize(name)}";
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
}
