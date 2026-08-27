using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Model;
using Volt.Engine.Sync;
using Volt.Engine.Vocabulary;

namespace Volt.Engine.Library;

/// <summary>The referenced-library half of a fetch: deciding whether the signatures need re-rendering at all,
/// rendering each library element beside its <c>.library</c> stub, and the layout rules those files follow.
/// <para>It was ~120 lines inside <see cref="Volt.Engine.Sync.FetchService"/>, whose own job is the project
/// walk. The two are independent: the library pipeline runs off a version comparison, not off the walk, and it
/// is the ONLY part of a fetch that can trigger a precompile. Separating it also puts the layout rules beside
/// <see cref="LibraryLayout"/>, which is the one place they belong.</para></summary>
internal static class LibraryFetch
{
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
    internal static (int RenderNull, int Unmatched) AppendLibrarySignatures(
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
                libFolder = LibraryFolder(LibraryFolder(libManBase, "(unresolved)"), LibraryLayout.Sanitize(sig.LibraryPath.Split(',')[0].Trim()));
                unmatched++;
                VoltLog.Debug($"fetch: lib element '{sig.Name}' — owning library '{sig.LibraryPath}' matched no .library ref, foldered under (unresolved)");
            }
            var fileName = $"{LibraryLayout.Sanitize(sig.Name)}{r.Ext}";
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

    internal static readonly string LibraryExt = "." + ItemKind.ExtFor(ItemKind.Kinds.Library);

    internal static readonly Regex ResolutionLine = new Regex(@"^RESOLUTION (.+)$", RegexOptions.Multiline);

    /// <summary>True when the referenced-library set is unchanged versus the client's <paramref name="knownItems"/>:
    /// every live <c>.library</c> version matches what the client already has, AND no <c>.library</c> the client
    /// knows has been removed. An add, a version bump, or a removal all make it false ⇒ re-extract. Reuses the same
    /// per-file version hash carried in knownItems — no separate fingerprint.</summary>
    internal static bool LibrariesUnchanged(IReadOnlyDictionary<string, string> liveLibVersions, IReadOnlyDictionary<string, string> knownItems)
    {
        foreach (var kv in liveLibVersions)
            if (!knownItems.TryGetValue(kv.Key, out var known) || known != kv.Value) return false; // added or changed
        foreach (var key in knownItems.Keys)
            if (key.EndsWith(LibraryExt, StringComparison.OrdinalIgnoreCase) && !liveLibVersions.ContainsKey(key)) return false; // removed
        return true;
    }


    /// <summary>A library's own workspace folder — its element folder, holding both the `.library` stub and the
    /// element signatures (`Library Manager/&lt;lib&gt;/`). One definition so the stub and its elements always
    /// colocate.</summary>
    private static string LibraryFolder(string? folder, string name) => Library.LibraryLayout.FolderFor(folder, name);
}
