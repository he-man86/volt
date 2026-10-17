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
/// in, the RESOLUTION its manifest states, its version, and the APPLICATION it belongs to (null: the pool, or not yet
/// known).</summary>
internal sealed record LibraryRef(string FullName, string BareName, string WalkedFolder, string Resolution, string Version,
                                  string? Application)
{
    /// <summary>The library's own folder — its `.library` and every signature it owns (<see cref="LibraryLayout.FolderFor"/>).</summary>
    public string Folder => LibraryLayout.FolderFor(WalkedFolder, BareName);

    /// <summary>The `.library` file's path — its wire identity.</summary>
    public string Path => ItemPath.Of(Folder, FullName);

    /// <summary>A ref's identity in the session cache: its path. A full name alone is not one — Pro2193 holds
    /// 13 `System_Visu*.library` names twice, at the root Library Manager and the Application's (tasks.md 1.1).</summary>
    public string Key => Path;

    public override string ToString() => $"{Path} (RESOLUTION {Resolution})";
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
    /// <param name="Elsewhere">The signature was extracted for one application and only ANOTHER application's refs claim
    /// its library: that application's own extraction places it beside its own `.library` (CODESYS's precompiled set may
    /// span every application), so this copy is no element of this application's and is not rendered — never
    /// `(unresolved)`.</param>
    internal sealed record Claim(IReadOnlyList<LibraryRef> Claimants, LibraryRef? Owner, string? Ambiguity, bool Elsewhere = false);

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
        var keyed = new Dictionary<string, (string? Application, string LibraryPath)>(StringComparer.OrdinalIgnoreCase);
        foreach (var sig in sigs)
        {
            var key = Key(sig);
            var path = sig.LibraryPath;
            if (byPath.ContainsKey(key)) continue;
            keyed[key] = (sig.Application, path);
            // A signature extracted for ONE application is claimed by that application's refs, else by the pool's (a root
            // Library Manager every application sees) — never by another application's: each application has its own
            // Library Manager, and its signatures land under it (openspec multi-application-tree, design §6). A signature
            // no driver tied to an application (null) is claimed by any ref, as on a one-application project.
            var claimants = refs.Where(r => Claims(r.Resolution, path) && Sees(sig.Application, r)).ToList();
            if (sig.Application is not null && claimants.Any(r => SameApplication(r.Application, sig.Application)))
                claimants = claimants.Where(r => SameApplication(r.Application, sig.Application)).ToList();
            if (claimants.Count == 0)
            {
                byPath[key] = sig.Application is not null && refs.Any(r => Claims(r.Resolution, path))
                    ? new Claim(Array.Empty<LibraryRef>(), null, null, Elsewhere: true)
                    : Unclaimed;
                continue;
            }
            if (claimants.Select(r => r.Resolution).Distinct(StringComparer.OrdinalIgnoreCase).Count() > 1)
            {
                byPath[key] = new Claim(claimants, null,
                    $"the signature path '{path}' is claimed by refs with different RESOLUTIONs: {string.Join(", ", claimants)}");
                continue;
            }
            // The ordinal-least FULL name owns it, whatever the walk order. One full name in TWO folders of one scope (a
            // pool Library Manager beside an application's, when the signature names no application) is tie-broken by
            // walk order, the LAST walked — deterministic, and both stubs reach the client (each its own path), so the
            // signatures sit beside a stub the client holds either way (`IdeTree.LibraryRoots`, gate step 3, finding 1).
            var least = claimants.Select(r => r.FullName).OrderBy(n => n, StringComparer.Ordinal).First();
            var owner = claimants.Last(r => string.Equals(r.FullName, least, StringComparison.Ordinal));
            byPath[key] = new Claim(claimants, owner, null);
        }

        // One wildcard RESOLUTION whose title + company match TWO compiled versions has no one library to own: both
        // beside it would declare every element twice in one folder (design.md "or two compiled versions of X").
        // Within ONE application's extraction: the same RESOLUTION in two applications is two libraries, each its own.
        var wildcardGroups = byPath
            .Where(kv => kv.Value.Owner is { } o && IsWildcard(o.Resolution))
            .GroupBy(kv => (keyed[kv.Key].Application ?? "") + "\n" + kv.Value.Owner!.Resolution, StringComparer.OrdinalIgnoreCase)
            .Where(g => g.Count() > 1)
            .ToList();
        foreach (var g in wildcardGroups)
        {
            var keys = g.Select(kv => kv.Key).OrderBy(p => p, StringComparer.Ordinal).ToList();
            var paths = keys.Select(k => keyed[k].LibraryPath).ToList();
            var claimants = g.SelectMany(kv => kv.Value.Claimants).Distinct().ToList();
            var reason = $"the wildcard RESOLUTION '{g.First().Value.Owner!.Resolution}' of {string.Join(", ", claimants.Select(r => r.Path))} " +
                         $"matches {paths.Count} compiled libraries: {string.Join(", ", paths.Select(p => $"'{p}'"))}";
            foreach (var k in keys) byPath[k] = new Claim(claimants, null, reason);
        }
        return new LibraryMatcher(byPath);
    }

    /// <summary>The key a signature is claimed under: its library path, within the application it was extracted for.</summary>
    internal static string Key(LibSignature sig) =>
        sig.Application is null ? sig.LibraryPath : sig.Application + "\n" + sig.LibraryPath;

    /// <summary>May the ref <paramref name="r"/> own a signature extracted for <paramref name="application"/>? Its own
    /// application's refs and the pool's, or every ref when the signature names none.</summary>
    private static bool Sees(string? application, LibraryRef r) =>
        application is null || r.Application is null || SameApplication(r.Application, application);

    private static bool SameApplication(string? a, string? b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);

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
/// <para>Apart from <see cref="Volt.Engine.Sync.FetchService"/>'s project walk because it is independent of it: the
/// library pipeline runs off a version comparison, and it is the ONLY part of a fetch that can trigger a precompile.
/// Its layout rules sit beside <see cref="LibraryLayout"/>.</para></summary>
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
        return Render(sigs, matcher, refs, changed, onProgress, startDone, total);
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
            var claim = matcher.For(LibraryMatcher.Key(sig));
            var mine = claim.Claimants.Where(namedSet.Contains).ToList();
            if (mine.Count == 0) continue;
            if (claim.Ambiguity is { } why)
                throw new BridgeException(BridgeErrorCodes.Unsupported,
                    $"cannot read {string.Join(", ", mine.Select(r => r.Path))}: {why}. Volt does not pick an owner by order.");
            kept.Add(sig);
            claimedBy.UnionWith(mine);
        }
        foreach (var r in named.Where(r => !claimedBy.Contains(r)))
            VoltLog.Warn($"fetch: {r} matched no extracted signature — the directed read answers its manifest alone");
        VoltLog.Info($"fetch: {sigs.Count - kept.Count} extracted signatures claimed by no named library (of {sigs.Count})");
        return Render(kept, matcher, refs, changed, onProgress, startDone, total);
    }

    private static (int RenderNull, int Unmatched) Render(
        IReadOnlyList<LibSignature> sigs, LibraryMatcher matcher, IReadOnlyList<LibraryRef> refs,
        List<FetchedItem> changed, Action<ProgressFrame>? onProgress, int startDone, int total)
    {
        var renderNull = 0;
        var unmatched = 0;
        var elsewhere = 0;
        // ONE FILE PER PATH AND TEXT ACROSS APPLICATIONS: a pool library (the root Library Manager every application
        // sees) is claimed by its one ref from each application's extraction, and renders the same file at the same path
        // once per application — one library, so one file. Only another application's copy folds; what one extraction
        // gives twice stays as it was (gate review of step 3a, finding 7).
        var renderedFor = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
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
            if (matcher.For(LibraryMatcher.Key(sig)).Elsewhere) { elsewhere++; continue; }   // another application's to place
            if (LibSignatureRenderer.Render(sig) is not { } r) { renderNull++; VoltLog.Warn($"fetch skip: render-null lib sig '{sig.Name}' (pouType={sig.PouType}, lib={sig.LibraryPath})"); continue; }
            string libFolder;
            if (matcher.For(LibraryMatcher.Key(sig)).Owner is { } owner)
                // Identified: fold the element beside its owning library's `.library` file.
                libFolder = owner.Folder;
            else
            {
                // NOT identified: no ref claims its library (CODESYS facade / Interfaces-Implementation split), or the
                // claim is ambiguous (warned by the caller). Do NOT silently drop it and do NOT guess it into a real
                // library's folder — surface it LOUD under an explicit `(unresolved)` marker so the matching gap
                // is impossible to miss (nothing lost, no hidden bug). See openspec bridge-diagnostics-observability.
                libFolder = LibraryLayout.FolderFor(UnresolvedBase(refs, sig.Application), LibraryLayout.UnresolvedNameFor(sig.LibraryPath));
                unmatched++;
                VoltLog.Debug($"fetch: lib element '{sig.Name}' — owning library '{sig.LibraryPath}' {(matcher.For(LibraryMatcher.Key(sig)).Ambiguity is null ? "matched no .library ref" : "is claimed ambiguously")}, foldered under (unresolved)");
            }
            var fileName = $"{LibraryLayout.Sanitize(sig.Name)}{r.Ext}";
            var path = ItemPath.Of(libFolder, fileName);
            var renderedKey = path + "\n" + r.Text;
            if (renderedFor.TryGetValue(renderedKey, out var firstFor)
                && !string.Equals(firstFor, sig.Application, StringComparison.OrdinalIgnoreCase)) continue;
            renderedFor[renderedKey] = sig.Application;
            changed.Add(new FetchedItem
            {
                Name = path,
                SourceText = r.Text,
                Version = Hasher.ComputeItemVersion(libFolder, r.Text),
            });
        }
        // NOT RENDERED FOR THIS APPLICATION, and said so: an element of a library only another application lists is that
        // application's (CODESYS's precompiled set is one for the IDE). A library this application uses only
        // transitively is skipped the same way once another application lists it — niche, accepted loss (design §9).
        if (elsewhere > 0)
            VoltLog.Info($"fetch: {elsewhere} library signature(s) extracted for one application belong to a library only " +
                         "another application lists — rendered under that application's Library Manager, not this one's");
        return (renderNull, unmatched);
    }

    /// <summary>The `(unresolved)` tree's folder: under the Library Manager base folder — the first walked ref's of the
    /// signature's own application, else the first walked ref's — the home of the LOUD marker.</summary>
    private static string UnresolvedBase(IReadOnlyList<LibraryRef> refs, string? application) =>
        LibraryLayout.FolderFor(
            refs.Where(r => application is not null && string.Equals(r.Application, application, StringComparison.OrdinalIgnoreCase))
                .Select(r => r.WalkedFolder).FirstOrDefault(f => f.Length > 0)
            ?? refs.Select(r => r.WalkedFolder).FirstOrDefault(f => f.Length > 0) ?? "",
            LibraryLayout.UnresolvedFolder);

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
