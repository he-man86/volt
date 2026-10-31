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
        StNetworkOracle.AssertTally(results, report, identical: 331, stored: 57, new Dictionary<string, int>(StringComparer.Ordinal));
    }

    /// <summary>THE CALLEES A PUSH MEETS OUT OF REACH (openspec network-output-member 1.2 "A callee no declaration in reach
    /// states", 2.1): every box of the corpora whose reading needs its callee's declaration while none in reach states it
    /// (<see cref="NetworkPairing.RefuseUnbuildableBoxes"/>), read against the scope a PUSH reads the body in — the project's
    /// declarations and every library's signatures. The push refuses such a box by name; the count is pinned.</summary>
    [Fact]
    public void The_callees_a_push_meets_out_of_reach_are_counted()
    {
        var dir = CorpusDir(CorpusProjects.CliRoot().FullName);
        var found = new List<string>();
        foreach (var name in Corpora)
        {
            var corpus = ReadCorpus(Path.Combine(dir, name + ".nwl.xml"));
            var project = CorpusProject.At(Path.Combine(CorpusProjects.CorpusRoot(), corpus.Name));
            var api = new CodesysNwlCompletenessOracleTests.ApiView(corpus);
            foreach (var body in corpus.Bodies)
            {
                var id = name + "/" + body.Path;
                var scope = PushScopeOf(project, body, id);
                var hydrated = new CodesysNwlCompletenessOracleTests.Hydrate(api, body.Path).Impl(body.Impl);
                for (var i = 0; i < hydrated.NetworkList.Count; i++)
                {
                    try { NetworkPairing.RefuseUnbuildableBoxes("CODESYS", CodesysNetworkReader.ReadNetwork(hydrated.NetworkList[i], i), scope); }
                    catch (NetworkTextException e) { found.Add($"{id} #{i}: {e.Message}"); }
                }
            }
        }
        Assert.True(found.Count == 0, $"{found.Count} boxes:\n" + string.Join("\n", found));
    }

    /// <summary>A ROOT BOX'S STORED MOVED PIN (openspec network-output-member 1.2): a root hands nothing on, so no text spells
    /// its main output and no model holds it; MainOutputIndex is read-only on a built box (N21). An unchanged network keeps it
    /// (the change gate); a rebuild drops it, named by the rebuild-loss warning (<see cref="RebuildLoss.RootMainOutput"/>).
    /// Known divergence — niche: accepted loss (1 occurrence in the corpora). The mark fails the day the model holds it.</summary>
    [Fact]
    public void A_root_box_storing_a_moved_pin_is_a_known_divergence()
    {
        var dir = CorpusDir(CorpusProjects.CliRoot().FullName);
        var moved = new List<(string Where, Box Read, int Index)>();
        foreach (var name in Corpora)
        {
            var corpus = ReadCorpus(Path.Combine(dir, name + ".nwl.xml"));
            var api = new CodesysNwlCompletenessOracleTests.ApiView(corpus);
            foreach (var body in corpus.Bodies)
            {
                var hydrated = new CodesysNwlCompletenessOracleTests.Hydrate(api, body.Path).Impl(body.Impl);
                for (var i = 0; i < hydrated.NetworkList.Count; i++)
                {
                    var net = (Nwl.Network)hydrated.NetworkList[i];
                    for (var k = 0; k < net.NetworkItemCount; k++)
                        if (net.GetTree(k) is Nwl.BoxTreeBox { MainOutputIndex: int index and not 0 } box)
                            moved.Add(($"{name}/{body.Path} #{i}: {box.BoxType} stores MainOutputIndex {index}",
                                       (Box)CodesysNetworkReader.ReadNetwork(net, i).Trees[k], index));
                }
            }
        }
        Assert.Equal(new[] { "lenze-mid/Device/Plc Logic/Application/FirstErrorCapture/call_FirstErrorCapture_FB #4: L_FECA.L_GetErrorTextFromFileReadArray stores MainOutputIndex 1" },
                     moved.Select(m => m.Where).ToArray());
        ExpectRed.Until("network-output-member: niche: accepted loss (1 occurrence in the corpora)",
            "a root box's stored main output other than its first is held by no model",
            () => Assert.All(moved, m => Assert.Equal(m.Index, m.Read.ConnectedSlot)));
    }

    static NetworkScope PushScopeOf(CorpusProject project, CorpusBody body, string id)
    {
        var path = body.Path.Split('/');
        var member = body.Owner is "POUObject" ? null : path[path.Length - 1];
        var pou = member is null ? path[path.Length - 1] : path[path.Length - 2];
        var file = project.FileOf(pou) ?? throw new InvalidDataException($"{id}: no corpus file for the POU '{pou}'");
        var sites = Volt.Engine.Ide.SourceScopes.SitesOf(CorpusProjects.Split(file))
            .Where(s => s.Site.Accessor is null && string.Equals(s.Site.Member, member, StringComparison.OrdinalIgnoreCase))
            .ToList();
        if (sites.Count != 1) throw new InvalidDataException($"{id}: {sites.Count} body sites in {file} for '{member ?? "(the POU)"}'");
        return project.PushScope(sites[0].Declaration);
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
