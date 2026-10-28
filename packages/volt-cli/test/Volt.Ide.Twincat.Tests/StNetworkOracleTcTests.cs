using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// The plain-ST round-trip oracle (openspec <c>network-text-st</c> 2.2; <see cref="StNetworkOracle"/>) over TwinCAT's own
/// archives: <c>test/fixtures/nwl-corpus/twincat-project14</c> and the native corpus <c>test/fixtures/tc-native-corpus/import</c>,
/// each read by the shipped <see cref="TcNetworkReader"/> → plain ST → model. The archives carry no declarations, so the
/// scope is the FB instances their boxes name.
/// </summary>
public class StNetworkOracleTcTests
{
    static string Fixtures => Path.Combine(CorpusProjects.CliRoot().FullName, "test", "fixtures");

    [Fact]
    public void Every_TwinCAT_archive_network_round_trips_or_is_unsupported_by_name()
    {
        var results = new List<StNetworkOracle.Result>();
        foreach (var file in Directory.EnumerateFiles(Path.Combine(Fixtures, "nwl-corpus", "twincat-project14"), "*.TcPOU").OrderBy(f => f, StringComparer.Ordinal))
            foreach (var nwl in XDocument.Load(file, LoadOptions.PreserveWhitespace).Descendants("NWL"))
                Check("twincat-project14/" + Path.GetFileName(file), nwl, results);
        foreach (var file in Directory.EnumerateFiles(Path.Combine(Fixtures, "tc-native-corpus", "import"), "*.nwl.xml").OrderBy(f => f, StringComparer.Ordinal))
            Check("tc-native-corpus/" + Path.GetFileName(file), XElement.Load(file, LoadOptions.PreserveWhitespace), results);
        var report = StNetworkOracle.Report("TwinCAT archives", results);
        StNetworkOracle.Save("twincat", report, results);
        StNetworkOracle.AssertTally(results, report, identical: 143, stored: 8, new Dictionary<string, int>(StringComparer.Ordinal)
        {
            // Vn_int_to_real's coil `r`: CODESYS ST takes `s` and `r` for no name (1.2), and the LSP reads ST as CODESYS does.
            // A name ST cannot write: niche, accepted loss (owner, 2026-10-28; 0 occurrences in the corpora).
            ["a target that is no ST variable"] = 1,
            // Vn_fanout_two_wires: TwinCAT stored the import of two fan-outs with one wire defined twice and the other never
            // (no ST can define a variable it never assigns). Niche: accepted loss (0 occurrences in the corpora).
            ["a wire read and never defined"] = 1,
        });
    }

    /// <summary>The LSP's TwinCAT corpus holds each LD/FBD body as the shipped pull writes it (2.1 "Migration";
    /// <see cref="CorpusNetworkText"/>): rendered from the recorded archive, spliced into its file.</summary>
    [Fact]
    public void The_corpus_LD_FBD_bodies_are_what_a_pull_writes()
    {
        var project = CorpusProject.At(Path.Combine(CorpusProjects.CorpusRoot(), "twincat-project14"));
        var stale = new List<string>();
        foreach (var archive in Directory.EnumerateFiles(Path.Combine(Fixtures, "nwl-corpus", "twincat-project14"), "*.TcPOU").OrderBy(f => f, StringComparer.Ordinal))
        {
            var pou = Path.GetFileNameWithoutExtension(archive);
            var file = project.FileOf(pou) ?? throw new InvalidDataException($"no corpus file for the POU '{pou}'");
            var scope = project.Scope(project.DeclarationOf(pou));
            foreach (var nwl in XDocument.Load(archive, LoadOptions.PreserveWhitespace).Descendants("NWL"))
            {
                var impl = nwl.DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");
                var view = impl.Elements("v").FirstOrDefault(v => (string?)v.Attribute("n") == "DefaultViewMode")?.Value.Trim('"');
                var pulled = StNetworkWriter.WritePulled(TcNetworkReader.ReadShown(impl, view == "Ld" ? BodyLanguage.Ld : BodyLanguage.Fbd), scope).TrimEnd(NL);
                CorpusNetworkText.Check(file, CorpusNetworkText.Spliced(file, null, pulled), stale);
            }
        }
        Assert.True(stale.Count == 0, CorpusNetworkText.Regenerate + ": " + string.Join(", ", stale));
    }

    const char NL = (char)10;

    static void Check(string source, XElement nwl, List<StNetworkOracle.Result> results)
    {
        var impl = nwl.DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");
        var view = impl.Elements("v").FirstOrDefault(v => (string?)v.Attribute("n") == "DefaultViewMode")?.Value.Trim('"');
        var language = view == "Ld" ? BodyLanguage.Ld : BodyLanguage.Fbd;
        NetworkBody body;
        try { body = TcNetworkReader.Read(impl, language); }
        catch (UnrepresentableBodyException e)
        {
            results.Add(StNetworkOracle.Refused(source, -1, "read: " + e.Reason));
            return;
        }
        var scope = StNetworkOracle.InstancesOf(body);
        for (var i = 0; i < body.Networks.Count; i++)
            results.Add(StNetworkOracle.Check(source, i, language, body.Networks[i], scope));
    }
}
