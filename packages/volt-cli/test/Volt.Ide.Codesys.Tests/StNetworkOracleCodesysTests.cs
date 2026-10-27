using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Tests.Shared;
using Xunit;
using static Volt.Tests.Shared.NwlArchive;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// The plain-ST round-trip oracle (openspec <c>network-text-st</c> 2.2; <see cref="StNetworkOracle"/>) over the five
/// recorded CODESYS corpora (<c>test/fixtures/nwl-corpus/*.nwl.xml</c>): each network hydrated as the completeness oracle
/// hydrates it, read by the shipped <see cref="CodesysNetworkReader"/> → plain ST → model, against the scope a pull writes
/// that body in (its declarations from the corpus project).
/// </summary>
public class StNetworkOracleCodesysTests
{
    static readonly string[] Corpora = { "lenze-mid", "pro2193", "awa-palletizer", "bakon-nano", "CodesysTestProject" };

    [Fact]
    public void Every_CODESYS_corpus_network_round_trips_or_is_unsupported_by_name()
    {
        var dir = CorpusDir(CorpusProjects.CliRoot().FullName);
        var results = new List<StNetworkOracle.Result>();
        foreach (var name in Corpora)
        {
            var corpus = ReadCorpus(Path.Combine(dir, name + ".nwl.xml"));
            var project = CorpusProject.At(Path.Combine(CorpusProjects.CorpusRoot(), corpus.Name));
            var api = new CodesysNwlCompletenessOracleTests.ApiView(corpus);
            foreach (var body in corpus.Bodies)
            {
                var id = name + "/" + body.Path;
                var language = body.Impl.Str("DefaultViewMode") == "Ld" ? BodyLanguage.Ld : BodyLanguage.Fbd;
                var scope = CodesysNwlCompletenessOracleTests.ScopeOf(project, body, id);
                var hydrated = new CodesysNwlCompletenessOracleTests.Hydrate(api, body.Path).Impl(body.Impl);
                for (var i = 0; i < hydrated.NetworkList.Count; i++)
                {
                    Network net;
                    try { net = CodesysNetworkReader.ReadNetwork(hydrated.NetworkList[i], i); }
                    catch (UnrepresentableBodyException e) { results.Add(StNetworkOracle.Refused(id, i, "read: " + e.Reason)); continue; }
                    results.Add(StNetworkOracle.Check(id, i, language, net, scope));
                }
            }
        }
        var report = StNetworkOracle.Report("CODESYS corpora", results);
        StNetworkOracle.Save("codesys", report, results);
        StNetworkOracle.AssertTally(results, report, identical: 294, stored: 83, new Dictionary<string, int>(StringComparer.Ordinal)
        {
            // Open for the owner (design.md): %UNSUPPORTED in the read-only phase, spelled by 3.0.
            ["a Parallel with a side effect on a branch"] = 5,   // lenze-mid: TOF, TON, 3x fc_CamC_CC_UDT
            ["an FB box with no instance"] = 4,                  // the ??? instance, lenze-mid POU (excluded from build)
            ["an edge contact"] = 1,
            // Niche, accepted loss (design.md 1.1: 1 occurrence in the corpora).
            ["a lone leaf item"] = 1,
        });
    }

    /// <summary>The LSP's corpora hold each LD/FBD body as the shipped pull writes it (2.1 "Migration";
    /// <see cref="CorpusNetworkText"/>): rendered from the recorded archive, spliced into its file.</summary>
    [Fact]
    public void The_corpus_LD_FBD_bodies_are_what_a_pull_writes()
    {
        var dir = CorpusDir(CorpusProjects.CliRoot().FullName);
        var stale = new List<string>();
        foreach (var name in Corpora)
        {
            var corpus = ReadCorpus(Path.Combine(dir, name + ".nwl.xml"));
            var project = CorpusProject.At(Path.Combine(CorpusProjects.CorpusRoot(), corpus.Name));
            var api = new CodesysNwlCompletenessOracleTests.ApiView(corpus);
            foreach (var body in corpus.Bodies)
            {
                var id = name + "/" + body.Path;
                var language = body.Impl.Str("DefaultViewMode") == "Ld" ? BodyLanguage.Ld : BodyLanguage.Fbd;
                var scope = CodesysNwlCompletenessOracleTests.ScopeOf(project, body, id);
                var shown = CodesysNetworkReader.ReadShown(new CodesysNwlCompletenessOracleTests.Hydrate(api, body.Path).Impl(body.Impl), language);
                var pulled = StNetworkWriter.WritePulled(shown, scope).TrimEnd('\n');
                var path = body.Path.Split('/');
                var member = body.Owner is "POUObject" ? null : path[path.Length - 1];
                var pou = member is null ? path[path.Length - 1] : path[path.Length - 2];
                var file = project.FileOf(pou) ?? throw new InvalidDataException($"{id}: no corpus file for the POU '{pou}'");
                CorpusNetworkText.Check(file, CorpusNetworkText.Spliced(file, member, pulled), stale);
            }
        }
        Assert.True(stale.Count == 0, CorpusNetworkText.Regenerate + ":\n" + string.Join("\n", stale.Distinct()));
    }
}
