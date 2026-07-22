using System.Collections.Generic;
using Volt.Engine.Library;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>The signature cache's hit/miss logic — the correctness-critical part, verified with no IDE. The live
/// CODESYS behaviour (build-free fingerprint, byte-identical output, no-precompile-on-hit) is covered by the e2e
/// suite; this pins the reuse-vs-re-extract decision, including that a fingerprint change (a library version swap /
/// add / remove) forces a fresh extraction.</summary>
public class LibSignatureCacheTests
{
    private static List<LibSignature> Sigs(string tag) => new()
    {
        new LibSignature(tag, "Lib, 1.0.0 (X)", "function_block",
            new List<LibVar>(), new List<LibVar>(), new List<LibVar>(), new List<LibVar>(), null, null),
    };

    [Fact]
    public void Same_fingerprint_reuses_the_cache_without_re_extracting()
    {
        var cache = new LibSignatureCache();
        var calls = 0;
        IReadOnlyList<LibSignature> Ext() { calls++; return Sigs("A"); }

        var first = cache.GetOrExtract("fp-A", Ext);
        var second = cache.GetOrExtract("fp-A", Ext); // hit — the precompile is skipped

        Assert.Equal(1, calls);
        Assert.Equal(1, cache.MissCount);
        Assert.Same(first, second);
    }

    [Fact]
    public void A_changed_fingerprint_re_extracts()
    {
        var cache = new LibSignatureCache();
        var calls = 0;
        IReadOnlyList<LibSignature> Ext() { calls++; return Sigs("v" + calls); }

        cache.GetOrExtract("libs@1.0", Ext); // cold
        cache.GetOrExtract("libs@2.0", Ext); // a library version bumped → miss
        cache.GetOrExtract("libs@2.0", Ext); // unchanged again → hit

        Assert.Equal(2, calls);
        Assert.Equal(2, cache.MissCount);
    }

    [Fact]
    public void First_call_always_extracts()
    {
        var cache = new LibSignatureCache();
        var calls = 0;
        cache.GetOrExtract("fp", () => { calls++; return Sigs("A"); });
        Assert.Equal(1, calls);
        Assert.Equal(1, cache.MissCount);
    }
}
