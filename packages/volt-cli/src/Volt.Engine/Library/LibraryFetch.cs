using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Volt.Contracts;
using Volt.Engine.Sync;
using Volt.Engine.Format.Body;
using Volt.Engine.Item;

namespace Volt.Engine.Library;

/// <summary>One walked <c>.library</c> reference: its FULL wire name, its bare (IDE) name, the folder the walk found it
/// in, the RESOLUTION its manifest states, and its version.</summary>
internal sealed record LibraryRef(string FullName, string BareName, string WalkedFolder, string Resolution, string Version)
{
    /// <summary>The library's own folder — its `.library` and every signature it owns (<see cref="LibraryLayout.FolderFor"/>).</summary>
    public string Folder => LibraryLayout.FolderFor(WalkedFolder, BareName);

    /// <summary>A ref's identity in the session cache: folder + full name. A full name alone is not one — Pro2193 holds
    /// 13 `System_Visu*.library` names twice, at the root Library Manager and the Application's (tasks.md 1.1).</summary>
    public string Key => Folder + "/" + FullName;

    public override string ToString() => $"{FullName} (RESOLUTION {Resolution})";
}

/// <summary>THE ONE matcher between an extracted signature's <c>LibraryPath</c> and the <c>.library</c> refs, for the full
/// fetch AND the directed read (openspec <c>directed-library-signatures</c> design §0 / §3 Choice 1). It is built over
/// EVERY walked ref, named or not: the owner of a repeated RESOLUTION and the different-RESOLUTION refusal both need the
/// refs nobody named.
/// <list type="bullet">
/// <item><b>Exact</b>: the ref's RESOLUTION equals the path, case-insensitive (CODESYS lower-cases <c>LibraryPath</c>:
/// <c>standard, 3.5.18.0 (system)</c>; TwinCAT keeps the case).</item>
/// <item><b>Wildcard</b>: a ref whose RESOLUTION version is <c>*</c> (<c>CmpIoMgr Interfaces, * (System)</c>) claims the
/// path with the same TITLE (before the first comma) AND COMPANY (the last parenthesis), case-insensitive — the rule
/// recorded on live strings in tasks.md 1.1. A path that carries no company is not claimed by a wildcard: no recorded
/// path lacks one, so it stays loudly <c>(unresolved)</c> rather than matching on the title alone.</item>
/// </list>
/// A path claimed by refs with ONE RESOLUTION (a placeholder and a direct ref to one compiled library — <c>CAA
/// Callback</c> + <c>CAA Callback Extern</c>, 4 of 5 CODESYS corpora) has one OWNER, the ref with the ordinal-least full
/// name, whatever the walk order (one full name in two folders: the LAST walked, the stub the fetch keeps). A path claimed by refs with DIFFERENT RESOLUTIONs, or one wildcard RESOLUTION that
/// claims more than one compiled library, has no owner: it is AMBIGUOUS, and the reason names the refs and the path(s).
/// Paths no ref claims are the facade split (<c>cmpusermgr implementation</c>, left to the owner).</summary>
internal sealed class LibraryMatcher
{
    internal sealed record Claim(IReadOnlyList<LibraryRef> Claimants, LibraryRef? Owner, string? Ambiguity);

    private static readonly Claim Unclaimed = new(Array.Empty<LibraryRef>(), null, null);
    private readonly Dictionary<string, Claim> _byPath;

    private LibraryMatcher(Dictionary<string, Claim> byPath) => _byPath = byPath;

    /// <summary>The claim on <paramref name="libraryPath"/> — one of the paths the matcher was built over.</summary>
    public Claim For(string libraryPath) => _byPath.TryGetValue(libraryPath, out var c) ? c : Unclaimed;

    /// <summary>Every claim that is ambiguous, one per distinct reason.</summary>
    public IEnumerable<string> Ambiguities => _byPath.Values.Select(c => c.Ambiguity).OfType<string>().Distinct(StringComparer.Ordinal);

    public static LibraryMatcher Over(IReadOnlyList<LibraryRef> refs, IEnumerable<LibSignature> sigs)
    {
        var byPath = new Dictionary<string, Claim>(StringComparer.OrdinalIgnoreCase);
        foreach (var path in sigs.Select(s => s.LibraryPath))
        {
            if (byPath.ContainsKey(path)) continue;
            var claimants = refs.Where(r => Claims(r.Resolution, path)).ToList();
            if (claimants.Count == 0) { byPath[path] = Unclaimed; continue; }
            if (claimants.Select(r => r.Resolution).Distinct(StringComparer.OrdinalIgnoreCase).Count() > 1)
            {
                byPath[path] = new Claim(claimants, null,
                    $"the signature path '{path}' is claimed by refs with different RESOLUTIONs: {string.Join(", ", claimants)}");
                continue;
            }
            // The ordinal-least FULL name owns it, whatever the walk order. One full name in TWO folders (Pro2193's root and
            // Application Library Managers) is tie-broken by the rule that decides which `.library` stub SURVIVES —
            // `FetchService.DedupeByFullName` keeps the LAST walked — so the signatures always sit beside the stub the
            // client receives (`refs` is in walk order and `Where` keeps it). A folder tie-break put them where the stub
            // had been deduped away: no `IdeTree.LibraryRoots` root, no read-only guard (gate step 3, finding 1).
            var least = claimants.Select(r => r.FullName).OrderBy(n => n, StringComparer.Ordinal).First();
            var owner = claimants.Last(r => string.Equals(r.FullName, least, StringComparison.Ordinal));
            byPath[path] = new Claim(claimants, owner, null);
        }

        // One wildcard RESOLUTION whose title + company match TWO compiled versions has no one library to own: both
        // beside it would declare every element twice in one folder (design.md "or two compiled versions of X").
        var wildcardGroups = byPath
            .Where(kv => kv.Value.Owner is { } o && IsWildcard(o.Resolution))
            .GroupBy(kv => kv.Value.Owner!.Resolution, StringComparer.OrdinalIgnoreCase)
            .Where(g => g.Count() > 1)
            .ToList();
        foreach (var g in wildcardGroups)
        {
            var paths = g.Select(kv => kv.Key).OrderBy(p => p, StringComparer.Ordinal).ToList();
            var claimants = g.SelectMany(kv => kv.Value.Claimants).Distinct().ToList();
            var reason = $"the wildcard RESOLUTION '{g.Key}' of {string.Join(", ", claimants.Select(r => r.FullName))} " +
                         $"matches {paths.Count} compiled libraries: {string.Join(", ", paths.Select(p => $"'{p}'"))}";
            foreach (var p in paths) byPath[p] = new Claim(claimants, null, reason);
        }
        return new LibraryMatcher(byPath);
    }

    private static bool Claims(string resolution, string path)
    {
        if (string.Equals(resolution, path, StringComparison.OrdinalIgnoreCase)) return true;
        if (Parse(resolution) is not { } r || r.Version != "*" || r.Company is null) return false;
        return Parse(path) is { Company: { } company } p
               && string.Equals(r.Title, p.Title, StringComparison.OrdinalIgnoreCase)
               && string.Equals(r.Company, company, StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsWildcard(string resolution) => Parse(resolution) is { Version: "*" };

    /// <summary><c>Title, Version (Company)</c> → its parts; the company is null when the string carries no trailing
    /// parenthesis. Null when there is no comma (no version to read).</summary>
    private static (string Title, string Version, string? Company)? Parse(string s)
    {
        var comma = s.IndexOf(',');
        if (comma < 0) return null;
        var title = s.Substring(0, comma).Trim();
        var rest = s.Substring(comma + 1).Trim();
        var open = rest.LastIndexOf('(');
        if (open < 0 || !rest.EndsWith(")", StringComparison.Ordinal)) return (title, rest, null);
        return (title, rest.Substring(0, open).Trim(), rest.Substring(open + 1, rest.Length - open - 2).Trim());
    }
}

/// <summary>The referenced-library half of a fetch: deciding whether the signatures need re-rendering at all,
/// rendering each library element beside its <c>.library</c> stub, and the layout rules those files follow.
/// <para>It was ~120 lines inside <see cref="Volt.Engine.Sync.FetchService"/>, whose own job is the project
/// walk. The two are independent: the library pipeline runs off a version comparison, not off the walk, and it
/// is the ONLY part of a fetch that can trigger a precompile. Separating it also puts the layout rules beside
/// <see cref="LibraryLayout"/>, which is the one place they belong.</para></summary>
internal static class LibraryFetch
{
    /// <summary>Render the SIGNATURE (declaration only) of EVERY referenced-library element and add it as a
    /// read-only <see cref="FetchedItem"/> beside its owning library's `.library` file (folder
    /// <c>&lt;lib folder&gt;/&lt;lib name&gt;</c>, name <c>&lt;Element&gt;&lt;ext&gt;</c>) — the FULL fetch. No referenced-only
    /// gate: the full public API of every used library is materialized so the AI/LSP can resolve into any of it. The
    /// owner comes from <see cref="LibraryMatcher"/>; an element with no owner (no ref claims it, or the claim is
    /// ambiguous — warned here, never resolved by order, never a throw that would make the project unpullable) goes
    /// LOUDLY under <c>(unresolved)</c>. Both vendors supply them (TwinCAT via `ProduceAllLibrarySignatures`). The
    /// version is a content hash — read-only, never a push target.</summary>
    /// <returns>(renderNull, unmatched): how many element signatures couldn't be rendered, and how many
    /// were foldered under `(unresolved)`.</returns>
    internal static (int RenderNull, int Unmatched) AppendAll(
        IReadOnlyList<LibSignature> sigs, IReadOnlyList<LibraryRef> refs,
        List<FetchedItem> changed, Action<ProgressFrame>? onProgress, int startDone, int total)
    {
        var matcher = LibraryMatcher.Over(refs, sigs);
        foreach (var why in matcher.Ambiguities)
            VoltLog.Warn($"fetch: {why} — its signatures are kept under {LibraryLayout.UnresolvedFolder}, attributed to neither");
        return Render(sigs, matcher, UnresolvedBase(refs), changed, onProgress, startDone, total);
    }

    /// <summary>The DIRECTED read's half (openspec <c>directed-library-signatures</c>): render only the signatures a NAMED
    /// ref claims, in their owner's folder — the bytes the full fetch writes (<see cref="AppendAll"/>), since both run
    /// the one matcher over every walked ref. A named ref that is a claimant of an ambiguous path refuses by name (the
    /// client asked for that library's API and no one owner exists); a named ref that claims nothing is named in a Warn;
    /// the extracted signatures no named library claimed are counted (the facade split stays visible).</summary>
    internal static (int RenderNull, int Unmatched) AppendNamed(
        IReadOnlyList<LibSignature> sigs, IReadOnlyList<LibraryRef> refs, IReadOnlyList<LibraryRef> named,
        List<FetchedItem> changed, Action<ProgressFrame>? onProgress, int startDone, int total)
    {
        var matcher = LibraryMatcher.Over(refs, sigs);
        var namedSet = new HashSet<LibraryRef>(named);
        var kept = new List<LibSignature>();
        var claimedBy = new HashSet<LibraryRef>();
        foreach (var sig in sigs)
        {
            var claim = matcher.For(sig.LibraryPath);
            var mine = claim.Claimants.Where(namedSet.Contains).ToList();
            if (mine.Count == 0) continue;
            if (claim.Ambiguity is { } why)
                throw new BridgeException(BridgeErrorCodes.Unsupported,
                    $"cannot read {string.Join(", ", mine.Select(r => r.FullName))}: {why}. Volt does not pick an owner by order.");
            kept.Add(sig);
            claimedBy.UnionWith(mine);
        }
        foreach (var r in named.Where(r => !claimedBy.Contains(r)))
            VoltLog.Warn($"fetch: {r} matched no extracted signature — the directed read answers its manifest alone");
        VoltLog.Info($"fetch: {sigs.Count - kept.Count} extracted signatures claimed by no named library (of {sigs.Count})");
        return Render(kept, matcher, UnresolvedBase(refs), changed, onProgress, startDone, total);
    }

    private static (int RenderNull, int Unmatched) Render(
        IReadOnlyList<LibSignature> sigs, LibraryMatcher matcher, string unresolvedBase,
        List<FetchedItem> changed, Action<ProgressFrame>? onProgress, int startDone, int total)
    {
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

            // Render-null: a POUType the renderer does not model, or a name that is not an IEC identifier. Neither
            // occurs on a measured SP21 project — which is why it WARNS: a library element the LSP never sees is
            // how return-less FUNCTIONs went missing, and a Debug line hid that.
            if (LibSignatureRenderer.Render(sig) is not { } r) { renderNull++; VoltLog.Warn($"fetch skip: render-null lib sig '{sig.Name}' (pouType={sig.PouType}, lib={sig.LibraryPath})"); continue; }
            string libFolder;
            if (matcher.For(sig.LibraryPath).Owner is { } owner)
                // Identified: fold the element beside its owning library's `.library` file.
                libFolder = owner.Folder;
            else
            {
                // NOT identified: no ref claims its library (CODESYS facade / Interfaces-Implementation split), or the
                // claim is ambiguous (warned by the caller). Do NOT silently drop it and do NOT guess it into a real
                // library's folder — surface it LOUD under an explicit `(unresolved)` marker so the matching gap
                // is impossible to miss (nothing lost, no hidden bug). See openspec bridge-diagnostics-observability.
                libFolder = LibraryLayout.FolderFor(unresolvedBase, LibraryLayout.UnresolvedNameFor(sig.LibraryPath));
                unmatched++;
                VoltLog.Debug($"fetch: lib element '{sig.Name}' — owning library '{sig.LibraryPath}' {(matcher.For(sig.LibraryPath).Ambiguity is null ? "matched no .library ref" : "is claimed ambiguously")}, foldered under (unresolved)");
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

    /// <summary>The `(unresolved)` tree's folder: under the Library Manager base folder (the first walked ref's), the
    /// home of the LOUD marker.</summary>
    private static string UnresolvedBase(IReadOnlyList<LibraryRef> refs) =>
        LibraryLayout.FolderFor(refs.Select(r => r.WalkedFolder).FirstOrDefault(f => f.Length > 0) ?? "", LibraryLayout.UnresolvedFolder);

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
}
