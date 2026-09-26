using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Volt.Engine.Format.Network;
using Xunit;
using Parallel = Volt.Engine.Format.Network.Parallel;

namespace Volt.Engine.Tests;

/// <summary>
/// THE MODEL ROUND-TRIP ORACLE over the largest set of vendor-shaped models the offline suite has: every graphical
/// body in <c>packages/volt-lsp-iec/test-corpus</c> (six real projects), per body and per network (task 2.2; spec,
/// "the round trip is checked on tokens and on models"). For each model <c>m</c>: the writer refuses it by name, or
/// <c>Read(Write(m)) ≅ m</c> (<see cref="NetworkModelOracle"/>).
///
/// <para><b>The corpus is still network text v1</b> until task 6.1 re-pulls it from the live IDEs, so its bodies
/// become models through <see cref="V1CorpusReader"/> — a test fixture, not a second product reader (v1 text is
/// refused on push). The v1 TESTS this file also used to harvest are gone with the swap (3.7): each shape they pinned
/// is a v2 golden now (<see cref="SplitShapeGoldensTests"/>, <see cref="NetworkTextRoundTripTests"/>), and those
/// run the same oracle. The TwinCAT archives and the CODESYS reader doubles run it in their own suites.</para>
///
/// <para><b>The refusal tables are pinned, by reason.</b> A v1-read model carries no output slot, no connection
/// slot and no main output index (v1 never read them; the drivers fill them from the vendor, task 3.10), so the
/// writer refuses what it would otherwise have to guess — that is the spec's "null is not a default", measured.
/// A count moving is a change in what v2 can spell or in what the sources hold, and must be looked at, never
/// re-pinned blind.</para>
/// </summary>
public class ModelRoundTripOracleTests
{
    // ── the LSP corpus ──────────────────────────────────────────────────────────────────────────────

    static readonly Lazy<(Dictionary<string, NetworkBody> Read, List<string> Unreadable)> Corpus = new(HarvestCorpus);

    public static TheoryData<string> CorpusIds()
    {
        var d = new TheoryData<string>();
        foreach (var k in Corpus.Value.Read.Keys) d.Add(k);
        return d;
    }

    [Theory]
    [MemberData(nameof(CorpusIds))]
    public void Every_corpus_body_round_trips_or_is_refused_by_name(string id) =>
        NetworkModelOracle.Check(id, Corpus.Value.Read[id]);

    [Fact]
    public void Corpus_tally()
    {
        // Every corpus body is v1 text Volt wrote; the v1 reader must read every one of them.
        Assert.True(Corpus.Value.Unreadable.Count == 0, "v1 cannot read: " + string.Join("\n", Corpus.Value.Unreadable));
        NetworkModelOracle.AssertTally("corpus",
            Corpus.Value.Read.Select(kv => NetworkModelOracle.Check(kv.Key, kv.Value)),
            bodies: 13, networks: 34, refused: new Dictionary<string, int>
            {
                ["a consumed box with no stored connection slot"] = 13,          // no ConnectedSlot in v1 (task 3.10)
                // A consumed box missing BOTH facts in v1 (EN or a positional pin) is named by the ENO one, refused first (review
                // of section 2, finding 5): 15 of the former 28 slot refusals, the same bodies.
                ["a box whose ENO output was not read"] = 15,
                ["an FB instance the declarations do not name"] = 1,             // census 1.12: SUPER^, ATD_TorqueControl
            });
    }

    /// <summary>The corpus again, ONE NETWORK AT A TIME. The marker is per body, so one refused network hides
    /// every other network of its body from the check above; here each network is a body of its own, and a
    /// refusal costs only itself. (Wires are per network and labels are text, so a network stands alone.)</summary>
    static readonly Lazy<Dictionary<string, NetworkBody>> CorpusNetworks = new(() =>
        Corpus.Value.Read.SelectMany(kv => kv.Value.Networks.Select((n, i) => (Id: $"{kv.Key}#{i}", Body: new NetworkBody(kv.Value.Language, new[] { n }))))
            .ToDictionary(x => x.Id, x => x.Body, StringComparer.Ordinal));

    public static TheoryData<string> CorpusNetworkIds()
    {
        var d = new TheoryData<string>();
        foreach (var k in CorpusNetworks.Value.Keys) d.Add(k);
        return d;
    }

    [Theory]
    [MemberData(nameof(CorpusNetworkIds))]
    public void Every_corpus_network_round_trips_or_is_refused_by_name(string id) =>
        NetworkModelOracle.Check(id, CorpusNetworks.Value[id]);

    [Fact]
    public void Corpus_network_tally() =>
        NetworkModelOracle.AssertTally("corpus networks",
            CorpusNetworks.Value.Select(kv => NetworkModelOracle.Check(kv.Key, kv.Value)),
            bodies: 206, networks: 206, refused: new Dictionary<string, int>
            {
                // v1 never read a consumer's connection slot (task 3.10 fills it): a consumed call's positional
                // outputs would be placed by a slot the model does not have.
                ["a consumed box with no stored connection slot"] = 108,
                // …and one with EN or a positional pin misses whether it has an ENO too, refused first (review of section
                // 2, finding 5): 57 of the former 165, the same networks.
                ["a box whose ENO output was not read"] = 57,
                // A wire fed by a data producer (census 1.17: FB/function outputs, 11 in Lenze) or by a ladder leaf
                // not every use of which is boolean: its type is never guessed, and v1 carried no output types.
                ["a wire of unknown type"] = 6,
                ["an FB instance the declarations do not name"] = 1,             // census 1.12: SUPER^
            });

    // ── harvesting ──────────────────────────────────────────────────────────────────────────────────

    static DirectoryInfo CliRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "Volt.sln"))) dir = dir.Parent;
        Assert.True(dir != null, "could not locate Volt.sln above the test assembly");
        return dir!;
    }

    static readonly Regex V1Header = new(@"(?m)^NETWORK\s+\d+\s+(FBD|LD)\b", RegexOptions.Compiled);

    static readonly Regex Implementation = new(@"^\(\*\s*@volt-implementation\s*\*\)\s*$", RegexOptions.Compiled);

    static (Dictionary<string, NetworkBody>, List<string>) HarvestCorpus()
    {
        var corpus = Path.GetFullPath(Path.Combine(CliRoot().FullName, "..", "volt-lsp-iec", "test-corpus"));
        Assert.True(Directory.Exists(corpus), "missing LSP corpus at " + corpus);
        var read = new Dictionary<string, NetworkBody>(StringComparer.Ordinal);
        var unreadable = new List<string>();
        var pous = Directory.EnumerateFiles(corpus, "*", SearchOption.AllDirectories)
            .Where(f => f.EndsWith(".prg") || f.EndsWith(".fb") || f.EndsWith(".fun"))
            .OrderBy(f => f, StringComparer.Ordinal);
        foreach (var file in pous)
        {
            var text = File.ReadAllText(file);
            if (!V1Header.IsMatch(text)) continue;
            var lines = text.Replace("\r", "").Split('\n');
            var rel = Path.GetRelativePath(corpus, file).Replace('\\', '/');
            for (var i = 0; i < lines.Length; i++)
            {
                if (!Implementation.IsMatch(lines[i])) continue;
                // The body: consecutive NETWORK … END_NETWORK blocks after the marker, blank lines between.
                var body = new StringBuilder();
                var j = i + 1;
                while (j < lines.Length)
                {
                    if (lines[j].Trim().Length == 0) { j++; continue; }
                    if (!V1Header.IsMatch(lines[j])) break;
                    while (j < lines.Length)
                    {
                        body.Append(lines[j]).Append('\n');
                        if (lines[j++] == "END_NETWORK") break;
                    }
                }
                if (body.Length == 0) continue;
                var id = $"{rel}:{i + 2}";
                try { read[id] = V1CorpusReader.Parse(body.ToString()); }
                catch (Exception e) { unreadable.Add(id + " " + e.Message); }
            }
        }
        return (read, unreadable);
    }
}
