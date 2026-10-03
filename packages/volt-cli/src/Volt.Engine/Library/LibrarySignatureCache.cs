using System.Collections.Generic;

namespace Volt.Engine.Library;

/// <summary>The session's last raw library-signature extraction, for DIRECTED reads (openspec
/// <c>directed-library-signatures</c> design §3, Choice 2 — the owner's recorded decision: "the extraction is cached per
/// library RESOLUTION in the session, so repeated reads cost one extraction").
/// <para>Why it exists: on CODESYS every extraction runs <c>Build(app)</c> — 22.4-22.9 s after one edit on Pro2193 — and
/// REPLACES the engineer's compiler message view, while the precompiled library set an edit or a Clean leaves untouched
/// (7229 → 7229, tasks.md 1.2). So a client reading libraries one at a time would pay a build per read for an API that
/// cannot have moved.</para>
/// <para>The key is EVERY walked ref's <c>.library</c> version — the change signal the full fetch already trusts
/// (archived <c>cache-library-signatures</c> D1: any library added, removed or moved re-extracts) — plus the bound
/// project. Not only the NAMED refs' (gate step 3, finding 2): the answer depends on refs nobody named, because the
/// matcher is built over every ref plus the extraction's paths, and both refusals (one path claimed by different
/// RESOLUTIONs; one wildcard over two compiled versions) depend on which compiled paths the extraction holds. Keyed on
/// the named refs alone, adding or upgrading an UNNAMED library let a reused extraction answer signatures where a fresh
/// read refuses and a full fetch keeps them <c>(unresolved)</c>. Library changes are rare, so the wider key costs a
/// re-extraction only where the full fetch pays one too. The cache holds the raw extraction only: matching, warnings
/// and counts run fresh on every read. The full fetch never READS it (it extracts iff a library moved, always on init);
/// its extraction refreshes it. The hole D1 already has stays, and is the only one: a wildcard ref that re-resolves
/// mid-session WITHOUT any manifest change is missed exactly as the full fetch misses it.</para>
/// <para>Vendor-neutral and held by the session (<see cref="Ide.DriverBase"/>), so a driver supplies nothing beyond its
/// <c>ExtractLibrarySignatures</c>.</para></summary>
public sealed class LibrarySignatureCache
{
    private readonly object _gate = new();
    private string? _project;
    private Dictionary<string, string>? _versions;
    private IReadOnlyList<LibSignature>? _signatures;

    /// <summary>The cached extraction, when it was taken against <paramref name="project"/> and EVERY walked ref in
    /// <paramref name="all"/> still has the version it had then — none added, none removed, none moved; null otherwise.</summary>
    internal IReadOnlyList<LibSignature>? Reuse(string project, IReadOnlyCollection<LibraryRef> all)
    {
        lock (_gate)
        {
            if (_signatures is null || _versions is null || _project != project || _versions.Count != all.Count) return null;
            foreach (var r in all)
                if (!_versions.TryGetValue(r.Key, out var v) || v != r.Version) return null;
            return _signatures;
        }
    }

    /// <summary>Record <paramref name="signatures"/> as the extraction taken against every walked ref's version.</summary>
    internal void Store(string project, IEnumerable<LibraryRef> all, IReadOnlyList<LibSignature> signatures)
    {
        var versions = new Dictionary<string, string>(System.StringComparer.Ordinal);
        foreach (var r in all) versions[r.Key] = r.Version;
        lock (_gate)
        {
            _project = project;
            _versions = versions;
            _signatures = signatures;
        }
    }
}
