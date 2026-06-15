using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Xml.Linq;
using VoltBridge.Core.Fbd;
using VoltBridge.Core.Fbd.Vg;
using Xunit;
using Xunit.Abstractions;

namespace VoltBridge.Core.Tests;

/// <summary>
/// Coverage harness over a REAL captured corpus: each <c>fixtures/corpus/*.xml</c> is raw PLCopenXML
/// harvested from a live project (the bridge's <c>/raw</c> route — see script/harvest-corpus.ts). For
/// every &lt;FBD&gt;/&lt;LD&gt; body it asserts the invariant that must hold at any coverage level:
///
///     a body either round-trips with all its constructs preserved, or its push is REFUSED —
///     never silently dropped.
///
/// "Round-trips" means structural equivalence (positions/localIds are non-goals): same VG fixed point
/// and the same set of top-level constructs survive. The test prints which constructs are still
/// refused — that IS the live to-do list toward 100%. Empty corpus → nothing to check (passes); it
/// activates as real bodies are harvested. No authoring required: open a project, run the harvester.
/// </summary>
public class FbdCorpusRoundTripTests
{
    private readonly ITestOutputHelper _out;
    public FbdCorpusRoundTripTests(ITestOutputHelper o) => _out = o;

    // Two sources: a COMMITTED set of representative bodies (runs in CI), plus the LOCAL harvested
    // corpus (gitignored — real captured projects, runs when you've harvested).
    private static readonly string[] CorpusDirs =
    {
        Path.Combine(AppContext.BaseDirectory, "fixtures", "roundtrip"),
        Path.Combine(AppContext.BaseDirectory, "fixtures", "corpus"),
    };

    [Fact]
    public void Captured_bodies_round_trip_or_are_refused_never_silently_dropped()
    {
        var files = CorpusDirs.Where(Directory.Exists).SelectMany(d => Directory.GetFiles(d, "*.xml")).ToArray();
        if (files.Length == 0) { _out.WriteLine("no fixtures — add to fixtures/roundtrip or harvest a project"); return; }

        int bodies = 0, covered = 0, refused = 0;
        var refusedConstructs = new SortedSet<string>();

        foreach (var file in files)
        {
            XDocument doc;
            try { doc = XDocument.Parse(File.ReadAllText(file)); } catch { continue; }
            var ns = doc.Root!.GetDefaultNamespace();
            foreach (var body in doc.Descendants(ns + "FBD").Concat(doc.Descendants(ns + "LD")))
            {
                bodies++;
                var before = Constructs(body);
                var miniDoc = new XElement(ns + "pou", new XAttribute("name", "P"),
                    new XElement(ns + "body", new XElement(body))).ToString();

                var g0 = PlcOpenReader.ReadBody(PlcOpenDocument.FindFbdLdBody(miniDoc)!);
                string vg0;
                string spliced;
                try
                {
                    vg0 = VgWriter.Write(g0);
                    var newBody = PlcOpenWriter.WriteBody(VgParser.Parse(vg0));   // VG must re-parse
                    spliced = PlcOpenDocument.SpliceFbdLdBody(miniDoc, newBody);  // and the guard must allow it
                }
                catch (Exception ex) when (ex is InvalidOperationException or VgParseException)
                {
                    // Safe (a push would fail loudly, not corrupt) — these are the to-do list, not failures.
                    refused++;
                    foreach (var c in before.Except(Modeled)) refusedConstructs.Add(c);
                    if (ex is VgParseException) refusedConstructs.Add("vg-reparse:" + ex.Message.Split(':')[0]);
                    continue;
                }

                covered++;
                var after = Constructs(PlcOpenDocument.FindFbdLdBody(spliced)!);
                var lost = before.Except(after).ToList();
                Assert.True(lost.Count == 0,
                    $"{Path.GetFileName(file)}: silently dropped on push: {string.Join(", ", lost)}");
                // HASH DRIFT guard: the VG (what the bridge hashes) must be a fixed point through the
                // full push round-trip — else an unchanged body would re-hash differently and be
                // falsely flagged as edited (scaffolding we add: localIds/positions/xhtml/typeNames).
                Assert.True(vg0 == VgWriter.Write(PlcOpenReader.ReadBody(PlcOpenDocument.FindFbdLdBody(spliced)!)),
                    $"{Path.GetFileName(file)}: hash drift — round-trip changed the VG");
            }
        }

        _out.WriteLine($"corpus: {files.Length} files, {bodies} bodies — {covered} round-trip, {refused} refused (safe)");
        if (refusedConstructs.Count > 0)
            _out.WriteLine("still to model (refused): " + string.Join(", ", refusedConstructs));
    }

    // Top-level construct kinds + the block-internal blind spots we track. vendorElement is the one
    // sanctioned drop, so it's excluded from the no-loss check.
    private static readonly HashSet<string> Modeled = new()
        { "block", "inVariable", "outVariable", "label", "jump", "return", "comment" };

    private static HashSet<string> Constructs(XElement body)
    {
        var ns = body.Name.Namespace;
        var s = new HashSet<string>(body.Elements().Select(e => e.Name.LocalName));
        s.Remove("vendorElement");
        if (body.Descendants(ns + "inOutVariables").Any(io => io.Elements(ns + "variable").Any())) s.Add("block:inout");
        if (body.Descendants(ns + "outputVariables").Elements(ns + "variable").Any(HasPinMod)) s.Add("pin:outmod");
        if (body.Descendants(ns + "connectionPointIn").Any(c => c.Elements(ns + "connection").Count() > 1)) s.Add("pin:multiconn");
        return s;
    }

    private static bool HasPinMod(XElement v)
    {
        if ((string?)v.Attribute("negated") == "true") return true;
        if ((string?)v.Attribute("edge") is { } e && e is not ("" or "none")) return true;
        if ((string?)v.Attribute("storage") is { } st && st is not ("" or "none")) return true;
        return false;
    }
}
