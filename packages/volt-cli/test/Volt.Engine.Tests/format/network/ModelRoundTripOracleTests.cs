using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.St;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// THE MODEL ROUND-TRIP ORACLE over the largest set of vendor-shaped models the offline suite has: every graphical
/// body in <c>packages/volt-lsp-iec/test-corpus</c> (six real projects), per body and per network (task 2.2; spec,
/// "the round trip is checked on tokens and on models"). For each model <c>m</c>: the writer refuses it by name, or
/// <c>Read(Write(m)) ≅ m</c> (<see cref="NetworkModelOracle"/>).
///
/// <para><b>The corpus is network text v2</b> since task 5.5 re-pulled its graphical bodies through the v2 bridge, so
/// its bodies become models through THE reader, against the scope a push reads them against — built from the
/// project's own declarations. The v1 reader this file used to harvest with (<c>V1CorpusReader</c>, a test fixture)
/// is deleted with the v1 corpus it read. A body the pull refused is its marker in the corpus, not network text, so
/// it is not here: the pull named it. The TwinCAT archives and the CODESYS reader doubles run the oracle in their own
/// suites.</para>
///
/// <para><b>The tables are pinned.</b> A count moving is a change in what v2 can spell or in what the corpus holds,
/// and must be looked at, never re-pinned blind.</para>
/// </summary>
public class ModelRoundTripOracleTests
{
    // ── the LSP corpus ──────────────────────────────────────────────────────────────────────────────

    static readonly Lazy<(Dictionary<string, (NetworkBody Body, NetworkScope Scope)> Read, List<string> Unreadable)> Corpus = new(HarvestCorpus);

    public static TheoryData<string> CorpusIds()
    {
        var d = new TheoryData<string>();
        foreach (var k in Corpus.Value.Read.Keys) d.Add(k);
        return d;
    }

    [Theory]
    [MemberData(nameof(CorpusIds))]
    public void Every_corpus_body_round_trips_or_is_refused_by_name(string id) =>
        NetworkModelOracle.Check(id, Corpus.Value.Read[id].Body, Corpus.Value.Read[id].Scope);

    [Fact]
    public void Corpus_tally()
    {
        // Every corpus body is v2 text the pull wrote; its own reader must read every one of them. And the writer has
        // already written every one, so a refusal here is the writer refusing a model it read back from its own text —
        // none is expected. (The 34 are every v2 marker in the corpus; what the pull refused is its marker, not here.)
        Assert.True(Corpus.Value.Unreadable.Count == 0, "v2 cannot read: " + string.Join("\n", Corpus.Value.Unreadable));
        NetworkModelOracle.AssertTally("corpus",
            Corpus.Value.Read.Select(kv => NetworkModelOracle.Check(kv.Key, kv.Value.Body, kv.Value.Scope)),
            bodies: 34, networks: 157, refused: new Dictionary<string, int>());
    }

    /// <summary>The corpus again, ONE NETWORK AT A TIME. The marker is per body, so one refused network hides
    /// every other network of its body from the check above; here each network is a body of its own, and a
    /// refusal costs only itself. (Wires are per network and labels are text, so a network stands alone.)</summary>
    static readonly Lazy<Dictionary<string, (NetworkBody Body, NetworkScope Scope)>> CorpusNetworks = new(() =>
        Corpus.Value.Read.SelectMany(kv => kv.Value.Body.Networks.Select((n, i) => (Id: $"{kv.Key}/{i}", Body: new NetworkBody(kv.Value.Body.Language, new[] { n }), kv.Value.Scope)))
            .ToDictionary(x => x.Id, x => (x.Body, x.Scope), StringComparer.Ordinal));

    public static TheoryData<string> CorpusNetworkIds()
    {
        var d = new TheoryData<string>();
        foreach (var k in CorpusNetworks.Value.Keys) d.Add(k);
        return d;
    }

    [Theory]
    [MemberData(nameof(CorpusNetworkIds))]
    public void Every_corpus_network_round_trips_or_is_refused_by_name(string id) =>
        NetworkModelOracle.Check(id, CorpusNetworks.Value[id].Body, CorpusNetworks.Value[id].Scope);

    [Fact]
    public void Corpus_network_tally() =>
        NetworkModelOracle.AssertTally("corpus networks",
            CorpusNetworks.Value.Select(kv => NetworkModelOracle.Check(kv.Key, kv.Value.Body, kv.Value.Scope)),
            bodies: 157, networks: 157, refused: new Dictionary<string, int>());

    // ── harvesting ──────────────────────────────────────────────────────────────────────────────────

    // Only a file with an IMPLEMENTATION LD|FBD LINE holds network text; checked before splitting, so the ~30k corpus items that
    // hold none are never parsed.
    static readonly Regex V2Marker = new(@"(?mi)^\s*IMPLEMENTATION[ \t]+(FBD|LD)\s*$", RegexOptions.Compiled);

    /// <summary>Every graphical body of the corpus, read by the v2 reader against the scope the push reads it against
    /// (<see cref="NetworkScope.FromDeclarations"/> over the project's own files, each body with its own declarations:
    /// <see cref="SourceScopes.BodiesOf"/>). A body the reader refuses is the pull's own text failing its own reader,
    /// and is reported, never skipped.</summary>
    static (Dictionary<string, (NetworkBody, NetworkScope)>, List<string>) HarvestCorpus()
    {
        var corpus = CorpusProjects.CorpusRoot();
        var read = new Dictionary<string, (NetworkBody, NetworkScope)>(StringComparer.Ordinal);
        var unreadable = new List<string>();
        foreach (var root in Directory.EnumerateDirectories(corpus).OrderBy(d => d, StringComparer.Ordinal))
        {
            var files = Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)
                .OrderBy(f => f, StringComparer.Ordinal).ToList();
            var project = new CorpusProject(files);
            foreach (var file in files)
            {
                if (CorpusProjects.KindOf(file) is not ItemKind.Kinds.Pou)
                    continue;
                if (!V2Marker.IsMatch(File.ReadAllText(file))) continue;
                var rel = Path.GetRelativePath(corpus, file).Replace('\\', '/');
                var n = 0;
                foreach (var (body, declaration) in SourceScopes.BodiesOf(CorpusProjects.Split(file)))
                {
                    if (body is null || !NetworkText.Is(body)) continue;
                    var id = $"{rel}#{n++}";
                    var scope = project.Scope(declaration);
                    var result = NetworkTextReader.Read(body, scope);
                    // Kept with the body: the oracle writes it back against the declarations it was read with.
                    if (result.Ok) read[id] = (result.Body!, scope);
                    else unreadable.Add(id + " " + string.Join("; ", result.Diagnostics.Select(d => $"{d.Code} {d.Message}")));
                }
            }
        }
        return (read, unreadable);
    }
}
