using System;
using System.Collections.Generic;
using System.Text;

namespace Volt.Ide.Codesys;

/// <summary>The driver's last library-signature extraction, reused while the libraries it was taken against are the
/// ones the latest walk found — every Library Manager's every reference, by its manifest, in the same project.
/// <para>Why it exists: a graphical body that calls a LIBRARY block (<c>t1 : TON</c>) asks the network scope for the
/// library's signature, and on CODESYS every extraction is a <c>Build</c> of every application. The scope is rebuilt
/// for every operation, so without this each <c>refs</c>, <c>fetch</c> and <c>push</c> that materialized such a body
/// compiled the project — measured 1-2.5 s per <c>refs</c> for one tiny FBD method on a 76-item fixture, 5-9 s per
/// push, and a read that rewrites the engineer's message view. A library's API cannot move without its manifest
/// moving, so the manifests are the key (the session cache, <c>Volt.Engine.Library.LibrarySignatureCache</c>, keys
/// the directed read on the same signal: every walked ref's version).</para>
/// <para>No key, no reuse: a walk that could not read a Library Manager whole states no key, and each ask extracts.</para></summary>
internal sealed class LibrarySignatureMemo
{
    private object? _project;
    private string? _key;
    private IReadOnlyList<Volt.Engine.Library.LibSignature>? _signatures;

    /// <summary>The key of a walk's libraries: each reference's folder and manifest, in walk order. Null when the walk
    /// did not read every Library Manager whole (<paramref name="complete"/> false).</summary>
    public static string? KeyOf(IEnumerable<(string Folder, string Manifest)> libraries, bool complete)
    {
        if (!complete) return null;
        var sb = new StringBuilder();
        foreach (var (folder, manifest) in libraries)
            sb.Append(folder).Append('\u0001').Append(manifest).Append('\u0002');
        return sb.ToString();
    }

    /// <summary>The extraction taken against <paramref name="project"/> and <paramref name="key"/>, else a fresh one
    /// from <paramref name="extract"/>, remembered for the next ask when <paramref name="key"/> is stated.</summary>
    public IReadOnlyList<Volt.Engine.Library.LibSignature> Get(object? project, string? key,
                                                            Func<IReadOnlyList<Volt.Engine.Library.LibSignature>> extract)
    {
        if (key is not null && _signatures is not null && ReferenceEquals(project, _project) && key == _key)
            return _signatures;
        var signatures = extract();
        (_project, _key, _signatures) = key is null ? (null, null, null) : (project, key, signatures);
        return signatures;
    }
}
