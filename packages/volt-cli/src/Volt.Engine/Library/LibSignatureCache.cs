using System;
using System.Collections.Generic;

namespace Volt.Engine.Library;

/// <summary>
/// Caches referenced-library signature extraction by a fingerprint of the referenced-library set (each entry
/// encodes name+version). A library's rendered API is IMMUTABLE for a given version — only a version swap (or an
/// added/removed library) changes it, never a line of code — so an unchanged fingerprint proves the previously
/// extracted signatures are still valid, and the (expensive) precompile can be skipped.
///
/// This is deliberately a tiny standalone class (not folded into the driver) so the hit/miss logic is unit-testable
/// with no IDE. It caches ONLY the library-signature path — project-item versions are always computed from a live
/// walk, so an edit on either side is never masked.
/// </summary>
public sealed class LibSignatureCache
{
    private string? _fingerprint;
    private IReadOnlyList<LibSignature>? _signatures;

    /// <summary>Cold extractions (cache misses) so far — surfaced for observability + tests ("did this fetch build?").</summary>
    public int MissCount { get; private set; }

    /// <summary>Return the cached signatures when <paramref name="fingerprint"/> matches the last extraction;
    /// otherwise run <paramref name="extract"/> (the precompile), cache it under the new fingerprint, and return it.</summary>
    public IReadOnlyList<LibSignature> GetOrExtract(string fingerprint, Func<IReadOnlyList<LibSignature>> extract)
    {
        if (_signatures is not null && fingerprint == _fingerprint) return _signatures;
        _signatures = extract();
        _fingerprint = fingerprint;
        MissCount++;
        return _signatures;
    }
}
