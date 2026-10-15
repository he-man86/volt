using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Engine.Ide;
using Volt.Tests.Shared;
using Xunit;
using static Volt.Tests.Shared.NwlArchive;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE NWL COMPLETENESS ORACLE, TWINCAT HALF (openspec <c>ld-fbd-coverage</c> 1b.3, gate 1b-3): every LD/FBD body of
/// the TwinCAT corpus — <c>twincat-project14</c>'s two, whose archives are the <c>&lt;NWL&gt;&lt;XmlArchive&gt;</c> of
/// their <c>.TcPOU</c> (a copy of the committed <c>TwinCAT Project14</c> fixture's, kept in
/// <c>test/fixtures/nwl-corpus/twincat-project14</c> so no tier that opens the live project can move this oracle's
/// input; <see cref="The_archives_are_the_fixtures_and_the_corpus_is_their_pull"/> ties it to both) — goes NWL →
/// network text → NWL through the SHIPPED code, and every archived member that is not a measured cache must come back
/// (<see cref="NwlDisposition"/>; a member the table does not name fails by name).
///
/// <para><b>What "back" is on this vendor: the IMPORT, the path where members can be lost.</b> An unchanged push writes
/// nothing (<see cref="An_unchanged_push_writes_nothing"/>: <c>TcNetworkWriter.Apply</c> answers null, so comparing its
/// output with the archive compares the archive with itself — the first version of this oracle did, gate 1b-3). What a
/// push BUILDS goes through TwinCAT's PLCopen import: a CREATE imports the whole body, a shape change REBUILDS one
/// network. Both run here over the IDE's own answers: the PLCopen document the shipped <c>TcPlcOpenWriter</c> lowers each
/// body (and each network alone, renumbered to 0, as <c>RebuildNetwork</c> sends it) to is committed in
/// <c>nwl-corpus/twincat-project14/import</c>, the IDE's import of it is RECORDED beside it
/// (<c>scripts/record-tc-import.ps1</c>, a live XAE), and the oracle runs the shipped post-import code over the
/// recording — <c>TcObjectModel.Adopted</c>, then <c>BeckhoffDriver.Stamp</c> (create) or
/// <c>BeckhoffDriver.Spliceable</c>, the splice and <c>TcNetworkWriter.Apply</c> (rebuild) — and compares with the
/// stored archive. A committed document that is no longer today's lowering fails by name: re-record.</para>
/// </summary>
public class TcNwlCompletenessOracleTests
{
    const string Corpus = "twincat-project14";

    /// <summary>One corpus body, read and round-tripped through text.</summary>
    sealed class Body
    {
        public string File = "", Bare = "", Id = "", View = "", StoredXml = "";
        public ArchiveNode Stored = new("NWLImplementationObject");
        public NetworkBody Back = null!;
        public NetworkScope Scope = null!;
        public int Networks;
        public List<string> Unlisted = new();
    }

    sealed class PathRun
    {
        /// <summary>Unit (a body or a network) → the reason the path refused it, by name.</summary>
        public Dictionary<string, string> Refused = new(StringComparer.Ordinal);
        public List<(string Unit, List<NwlFinding> Findings)> Findings = new();
    }

    static readonly Lazy<List<Body>> Bodies = new(ReadBodies);
    static readonly Lazy<PathRun> Create = new(() => Traced("create", RunCreate(Bodies.Value)));
    static readonly Lazy<PathRun> Rebuild = new(() => Traced("rebuild", RunRebuild(Bodies.Value)));

    /// <summary>VOLT_NWL_ORACLE_TRACE=&lt;file&gt;: every refusal and every finding of the path, one line each (appended).</summary>
    static PathRun Traced(string path, PathRun run)
    {
        if (Environment.GetEnvironmentVariable("VOLT_NWL_ORACLE_TRACE") is { Length: > 0 } trace)
            File.AppendAllLines(trace, run.Refused.Select(r => $"{path} REFUSED {r.Key}: {r.Value}")
                .Concat(run.Findings.SelectMany(f => f.Findings.Select(x => $"{path} FINDING {x}")))
                .Append($"{path} DRAFT\n" + NwlLedger.Draft(run.Findings)));
        return run;
    }

    static string Dir => Path.Combine(CorpusDir(CorpusProjects.CliRoot().FullName), Corpus);
    static string ImportDir => Path.Combine(Dir, "import");

    static List<Body> ReadBodies()
    {
        var project = CorpusProject.At(Path.Combine(CorpusProjects.CorpusRoot(), Corpus));
        var bodies = new List<Body>();
        foreach (var file in Directory.EnumerateFiles(Dir, "*.TcPOU").OrderBy(f => f, StringComparer.Ordinal))
        {
            var doc = XDocument.Load(file, LoadOptions.PreserveWhitespace);
            foreach (var nwl in doc.Descendants("NWL"))
                bodies.Add(Read(project, Path.GetFileName(file), nwl));
        }
        return bodies;
    }

    static Body Read(CorpusProject project, string file, XElement nwl)
    {
        var owner = nwl.Ancestors().First(a => a.Attribute("Name") is not null);
        if (owner.Name.LocalName != "POU") throw new InvalidDataException($"{file}: a member body — the corpus holds POU bodies only");
        var bare = (string)owner.Attribute("Name")!;
        var id = $"{Corpus}/{file}#POU:{bare}";
        var impl = Impl(nwl);
        var body = new Body
        {
            File = file, Bare = bare, Id = id, Stored = Archive(impl, null), StoredXml = nwl.ToString(SaveOptions.DisableFormatting),
            Networks = TcArchive.List(impl, "NetworkList").Count,
            View = TcArchive.ViewMode(impl) ?? throw new InvalidDataException($"{id}: a body with no view"),
        };
        body.Unlisted.AddRange(NwlCompare.Unlisted(body.Stored).Distinct());
        var language = body.View switch
        {
            "Ld" => BodyLanguage.Ld,
            "Fbd" => BodyLanguage.Fbd,
            var v => throw new InvalidDataException($"{id}: a body in view '{v}' — the corpus holds LD and FBD only"),
        };
        var source = project.FileOf(bare) ?? throw new InvalidDataException($"{id}: no corpus file");
        body.Scope = project.Scope(SourceScopes.SitesOf(CorpusProjects.Split(source)).Single(s => s.Site.Member is null).Declaration);

        // The corpus pulls no TwinCAT body UNSUPPORTED (census 0.1): a refusal here is a red test, not an outcome.
        var text = NetworkTextWriter.Write(TcNetworkReader.Read(impl, language), body.Scope);
        var back = NetworkTextReader.Read(text, body.Scope);
        Assert.True(back.Ok, $"{id}: the text the writer wrote does not read back:\n{text}");
        body.Back = back.Body!;
        return body;
    }

    static XElement Impl(XElement nwl) =>
        nwl.DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");

    // ── the PLCopen documents and their recorded imports ──────────────────────────────────────────────────────────

    /// <summary>The scratch POU a body's (<paramref name="network"/> null) or one network's import is recorded under.</summary>
    static string ScratchName(Body b, int? network) =>
        "VoltNwl_" + b.Bare + (network is { } i ? "_n" + i.ToString(CultureInfo.InvariantCulture) : "");

    /// <summary>Every document the oracle imports: the whole body (create), and each network alone, renumbered to 0
    /// (rebuild — exactly the body <c>RebuildNetwork</c> lowers). A lowering that refuses is that path's refusal.</summary>
    static IEnumerable<(string Name, Body Body, int? Network, Func<XDocument> Lower)> Documents(IEnumerable<Body> bodies)
    {
        foreach (var b in bodies)
        {
            yield return (ScratchName(b, null), b, null, () => TcPlcOpenWriter.WriteProject(ScratchName(b, null), b.Back));
            for (var i = 0; i < b.Back.Networks.Count; i++)
            {
                var n = i;
                yield return (ScratchName(b, n), b, n, () => TcPlcOpenWriter.WriteProject(ScratchName(b, n),
                    new NetworkBody(b.Back.Language, new[] { b.Back.Networks[n] with { Order = 0 } })));
            }
        }
    }

    /// <summary>A document as the driver hands it to the import (<c>XDocument.Save</c>), in text.</summary>
    static string DocText(XDocument d)
    {
        var file = Path.GetTempFileName();
        try { d.Save(file); return File.ReadAllText(file); }
        finally { File.Delete(file); }
    }

    /// <summary>The IDE's answer to the document <paramref name="name"/>, as <c>scripts/record-tc-import.ps1</c> recorded
    /// it: the scratch POU's <c>ImplementationText</c>.</summary>
    static string Recorded(string name)
    {
        var file = Path.Combine(ImportDir, name + ".nwl.xml");
        if (!File.Exists(file))
            throw new InvalidDataException($"no recorded import '{file}' — record it: scripts/record-tc-import.ps1 (scripts/README.md)");
        return File.ReadAllText(file);
    }

    static PathRun RunCreate(List<Body> bodies)
    {
        var run = new PathRun();
        foreach (var d in Documents(bodies).Where(d => d.Network is null))
        {
            var b = d.Body;
            try { d.Lower(); }
            catch (Exception e) when (e is NotSupportedException or NetworkTextException) { run.Refused[b.Id] = "lower: " + e.Message; continue; }
            string built;
            try { built = TcObjectModel.Adopted(Recorded(d.Name), b.View); }
            catch (Volt.Engine.BridgeException e) { run.Refused[b.Id] = "import: " + e.Message; continue; }
            string final;
            try { final = BeckhoffDriver.Stamp(built, b.Back, b.Scope); }
            catch (NotSupportedException e) { run.Refused[b.Id] = "stamp: " + e.Message; continue; }
            var written = Archive(Impl(XElement.Parse(final, LoadOptions.PreserveWhitespace)), null);
            var s = (ArchiveList)b.Stored["NetworkList"]!;
            var w = (ArchiveList)written["NetworkList"]!;
            if (s.Items.Count != w.Items.Count) { run.Refused[b.Id] = $"create: {s.Items.Count} networks stored, {w.Items.Count} built"; continue; }
            run.Findings.Add((b.Id, NwlCompare.Node(b.Stored, written, b.Id, "NetworkList")));
            for (var i = 0; i < s.Items.Count; i++)
                run.Findings.Add(($"{b.Id}#{i}", NwlCompare.Node((ArchiveNode)s.Items[i]!, (ArchiveNode)w.Items[i]!, $"{b.Id}#{i}")));
        }
        return run;
    }

    static PathRun RunRebuild(List<Body> bodies)
    {
        var run = new PathRun();
        foreach (var d in Documents(bodies).Where(d => d.Network is not null))
        {
            var b = d.Body;
            var i = d.Network!.Value;
            var unit = $"{b.Id}#{i}";
            try { d.Lower(); }
            catch (Exception e) when (e is NotSupportedException or NetworkTextException) { run.Refused[unit] = "lower: " + e.Message; continue; }
            XElement rebuilt;
            try { rebuilt = BeckhoffDriver.Spliceable(TcObjectModel.Adopted(Recorded(d.Name), b.View), b.Back.Networks[i]); }
            catch (Exception e) when (e is InvalidOperationException or Volt.Engine.BridgeException) { run.Refused[unit] = "import: " + e.Message; continue; }
            // The splice Apply makes (`networks[i].ReplaceWith(rebuilt)`), then the stamp it makes on the spliced network.
            var doc = XElement.Parse(b.StoredXml, LoadOptions.PreserveWhitespace);
            TcArchive.List(Impl(doc), "NetworkList")[i].ReplaceWith(rebuilt);
            var spliced = doc.ToString(SaveOptions.DisableFormatting);
            string final;
            try { final = TcNetworkWriter.Apply(spliced, b.Back, b.Scope) ?? spliced; }
            catch (NotSupportedException e) { run.Refused[unit] = "stamp: " + e.Message; continue; }
            var written = (ArchiveList)Archive(Impl(XElement.Parse(final, LoadOptions.PreserveWhitespace)), null)["NetworkList"]!;
            var stored = (ArchiveList)b.Stored["NetworkList"]!;
            run.Findings.Add((unit, NwlCompare.Node((ArchiveNode)stored.Items[i]!, (ArchiveNode)written.Items[i]!, unit)));
        }
        return run;
    }

    // ── the TwinCAT archive as the shared archive model ────────────────────────────────────────────────────────────

    /// <summary>One <c>&lt;o&gt;</c> of an <c>XmlArchive</c> as an <see cref="ArchiveNode"/>: <c>&lt;v n&gt;</c> a scalar
    /// (<c>"…"</c> a string, <c>true</c>/<c>false</c>, <c>17L</c> an Int64, <c>5</c> an Int32, a <c>t=</c> attribute an
    /// enum), <c>&lt;n n/&gt;</c> null, <c>&lt;o n t&gt;</c> a node, <c>&lt;l2|a|l n cet&gt;</c> a list whose items are
    /// typed by <c>cet</c> or their own <c>t</c>. A string is the text between its quotes, as <see cref="TcArchive"/>
    /// reads it.</summary>
    static ArchiveNode Archive(XElement o, string? cls)
    {
        var node = new ArchiveNode((string?)o.Attribute("t") ?? cls ?? throw new InvalidDataException("an untyped archive node"));
        foreach (var c in o.Elements())
        {
            var name = (string?)c.Attribute("n") ?? throw new InvalidDataException($"<{c.Name.LocalName}> member without a name in {node.Class}");
            node.Members.Add(new(name, Value(c, null)));
        }
        return node;
    }

    static object? Value(XElement c, string? cet) => c.Name.LocalName switch
    {
        "n" => null,
        "v" => Scalar(c, cet),
        "o" => Archive(c, cet),
        "l2" or "a" or "l" => new ArchiveList(c.Elements().Select(x => Value(x, (string?)c.Attribute("cet")))),
        var other => throw new InvalidDataException($"an archive element <{other}> this reading does not know"),
    };

    static ArchiveScalar Scalar(XElement v, string? cet)
    {
        var text = v.Value;
        if (v.Attribute("t") is { } enumType) return E(text);
        if (cet == "String") return S(text);     // a string list's items are bare
        if (text.Length >= 2 && text[0] == '"' && text[text.Length - 1] == '"') return S(text.Substring(1, text.Length - 2));
        if (text is "true" or "false") return B(text == "true");
        if (text.EndsWith("L", StringComparison.Ordinal) && long.TryParse(text.Substring(0, text.Length - 1), NumberStyles.Integer, CultureInfo.InvariantCulture, out var l)) return L(l);
        if (int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var i)) return I(i);
        throw new InvalidDataException($"an archive scalar '{text}' this reading does not know");
    }

    // ── the tests ──────────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The census's TwinCAT corpus: 2 bodies (ladderLabel, POUexecute), 6 networks.</summary>
    [Fact]
    public void The_corpus_is_the_census()
    {
        Assert.Equal(2, Bodies.Value.Count);
        Assert.Equal(6, Bodies.Value.Sum(b => b.Networks));
    }

    /// <summary>THE INPUT IS TIED TO ITS SOURCES (gate 1b-3): each archive is byte for byte the committed
    /// <c>TwinCAT Project14</c> fixture file of its name (exactly one), and the corpus file the scope is read from holds,
    /// as its body, exactly the text the shipped pull writes from that archive — so a re-saved fixture or a re-pulled
    /// corpus fails here instead of leaving the oracle judging a stale archive against fresh declarations.</summary>
    [Fact]
    public void The_archives_are_the_fixtures_and_the_corpus_is_their_pull()
    {
        var fixture = Path.Combine(CorpusProjects.CliRoot().FullName, "test", "fixtures", "TwinCAT Project14");
        var copies = Directory.EnumerateFiles(Dir, "*.TcPOU").ToList();
        Assert.Equal(2, copies.Count);
        foreach (var copy in copies)
        {
            var sources = Directory.EnumerateFiles(fixture, Path.GetFileName(copy), SearchOption.AllDirectories).ToList();
            Assert.True(sources.Count == 1, $"{Path.GetFileName(copy)}: {sources.Count} fixture files of that name");
            Assert.True(File.ReadAllBytes(sources[0]).SequenceEqual(File.ReadAllBytes(copy)),
                $"{copy} is not the bytes of {sources[0]} — copy the fixture again, and re-record (scripts/record-tc-import.ps1)");
        }
        var project = CorpusProject.At(Path.Combine(CorpusProjects.CorpusRoot(), Corpus));
        foreach (var b in Bodies.Value)
        {
            var site = SourceScopes.SitesOf(CorpusProjects.Split(project.FileOf(b.Bare)!)).Single(s => s.Site.Member is null);
            var pulled = NetworkTextWriter.Write(TcNetworkReader.Read(Impl(XElement.Parse(b.StoredXml)), b.Back.Language), b.Scope);
            Assert.Equal(pulled, site.Body + "\n");   // the item file's reader hands the body without its closing line break
        }
    }

    /// <summary>A member the archive holds that the table does not name fails BY NAME.</summary>
    [Fact]
    public void Every_archived_member_is_in_the_table()
    {
        var unlisted = Bodies.Value.SelectMany(b => b.Unlisted).Distinct().OrderBy(k => k, StringComparer.Ordinal).ToList();
        Assert.True(unlisted.Count == 0, "members the disposition table does not name: " + string.Join(", ", unlisted));
    }

    /// <summary>AN UNCHANGED PUSH WRITES NOTHING: the round-tripped model applied to the archive it was read from answers
    /// null on every body — which is why the in-place write is no completeness evidence (every member it does not write
    /// would match by construction) and the oracle runs the import.</summary>
    [Fact]
    public void An_unchanged_push_writes_nothing() =>
        Assert.All(Bodies.Value, b => Assert.Null(TcNetworkWriter.Apply(b.StoredXml, b.Back, b.Scope)));

    /// <summary>The committed PLCopen documents are what the shipped lowering writes today, each with its recorded import —
    /// a lowering change makes the recording stale, which is re-recorded, never compared blind.
    /// <c>VOLT_WRITE_NWL_IMPORT=1</c> rewrites the documents (then record: <c>scripts/record-tc-import.ps1</c>).</summary>
    [Fact]
    public void The_recorded_imports_are_of_todays_lowering()
    {
        var expected = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var d in Documents(Bodies.Value))
        {
            try { expected[d.Name] = DocText(d.Lower()); }
            catch (Exception e) when (e is NotSupportedException or NetworkTextException) { }   // the path's refusal (Refusal_tally): nothing to import
        }
        if (Environment.GetEnvironmentVariable("VOLT_WRITE_NWL_IMPORT") == "1")
        {
            Directory.CreateDirectory(ImportDir);
            foreach (var f in Directory.EnumerateFiles(ImportDir, "*.plcopen.xml")) File.Delete(f);
            foreach (var kv in expected) File.WriteAllText(Path.Combine(ImportDir, kv.Key + ".plcopen.xml"), kv.Value);
        }
        var committed = Directory.EnumerateFiles(ImportDir, "*.plcopen.xml")
            .ToDictionary(f => Path.GetFileName(f).Replace(".plcopen.xml", ""), File.ReadAllText, StringComparer.Ordinal);
        Assert.Equal(expected.Keys.OrderBy(k => k, StringComparer.Ordinal), committed.Keys.OrderBy(k => k, StringComparer.Ordinal));
        foreach (var kv in expected)
            Assert.True(kv.Value == committed[kv.Key], $"{kv.Key}.plcopen.xml is not today's lowering — VOLT_WRITE_NWL_IMPORT=1, then re-record");
        var recorded = Directory.EnumerateFiles(ImportDir, "*.nwl.xml").Select(f => Path.GetFileName(f).Replace(".nwl.xml", ""));
        Assert.Equal(expected.Keys.OrderBy(k => k, StringComparer.Ordinal), recorded.OrderBy(k => k, StringComparer.Ordinal));
    }

    /// <summary>What each path refuses, by unit and reason. Pinned: a count moving is a shape learned or lost.</summary>
    [Fact]
    public void Refusal_tally()
    {
        Assert.Equal(CreateRefused.OrderBy(k => k.Key, StringComparer.Ordinal).ToList(),
                     Create.Value.Refused.OrderBy(k => k.Key, StringComparer.Ordinal).ToList());
        Assert.Equal(RebuildRefused.OrderBy(k => k.Key, StringComparer.Ordinal).ToList(),
                     Rebuild.Value.Refused.OrderBy(k => k.Key, StringComparer.Ordinal).ToList());
    }

    /// <summary>THE ORACLE, CREATE: every non-cache member of every network comes back through the whole-body import and
    /// the stamp, or its loss is a known one.</summary>
    [Fact]
    public void Every_member_comes_back_through_a_create_or_is_a_known_loss() =>
        NwlLedger.AssertExactly("twincat create", Create.Value.Findings, KnownCreate);

    /// <summary>THE ORACLE, REBUILD: every non-cache member of the rebuilt network comes back through the one-network
    /// import, the splice and the stamp, or its loss is a known one.</summary>
    [Fact]
    public void Every_member_comes_back_through_a_rebuild_or_is_a_known_loss() =>
        NwlLedger.AssertExactly("twincat rebuild", Rebuild.Value.Findings, KnownRebuild);

    // The create path compares NO network of this corpus (gate 1b-3): POUexecute's whole-body lowering is refused (its
    // wire network, TcUnmeasured), and ladderLabel's import drops its EMPTY network (PLCopen has no network element,
    // D25), so the stamp refuses the count — a create of either is refused by name, never applied thinner.
    const string WireUnmeasured = "TwinCAT: network {0} changes shape and holds the wire g1 fed by the leaf 'b'. Volt rebuilds a " +
        "changed network through TwinCAT's PLCopen import, which is not measured for that shape, so the push is refused " +
        "before the import rather than risk a network that comes back different. The IDE can make this change.";

    static readonly Dictionary<string, string> CreateRefused = new(StringComparer.Ordinal)
    {
        ["twincat-project14/POUexecute.TcPOU#POU:POUexecute"] = "lower: " + string.Format(CultureInfo.InvariantCulture, WireUnmeasured, 3),
        // The import drops the empty network (D25), so the stamp cannot pair its networks one for one (ld-fbd-coverage 1b.4:
        // the stamp stays positional; this said "cannot ADD one through the archive", which was never what happened).
        ["twincat-project14/ladderLabel.TcPOU#POU:ladderLabel"] = "stamp: TwinCAT: the import built 1 network(s) for the 2 " +
            "pushed, so its networks cannot be stamped one for one: the import drops an empty network and builds one network " +
            "per connected rung (DIALECT D25).",
    };

    static readonly Dictionary<string, string> RebuildRefused = new(StringComparer.Ordinal)
    {
        ["twincat-project14/POUexecute.TcPOU#POU:POUexecute#0"] = "lower: TwinCAT: this graphical body contains an Execute box, and " +
            "Volt's TwinCAT lowering has no spelling for it, so the push cannot write it. The IDE can create it.",
        ["twincat-project14/POUexecute.TcPOU#POU:POUexecute#2"] = "lower: " + string.Format(CultureInfo.InvariantCulture, WireUnmeasured, 1),
        ["twincat-project14/ladderLabel.TcPOU#POU:ladderLabel#1"] = "import: TwinCAT: the PLCopen import produced an empty body. The " +
            "document was accepted but nothing was built from it, so the push is failed rather than reported as applied.",
    };

    static readonly NwlKnown[] KnownCreate =
    {
    };

    /// <summary>Every loss the rebuild shows today (3 networks compared: POUexecute #1 and #3, ladderLabel #0), with the
    /// task that closes it. The import answers before any build, so a member the IDE re-derives on compile reads as lost
    /// here — which is exactly what the 2.2 rows measure.</summary>
    static readonly NwlKnown[] KnownRebuild =
    {
        new("BoxTreeAssign.Id — changed", 3, 3, "2.2 nwl-item-id (R)"),
        new("BoxTreeBox.EN — changed", 2, 2, "2.2 nwl-box-en-eno (R): the import answers null where the IDE stored false"),
        new("BoxTreeBox.ENO — changed", 2, 2, "2.2 nwl-box-en-eno (R): the import answers null where the IDE stored false"),
        new("BoxTreeBox.Id — changed", 2, 2, "2.2 nwl-item-id (R)"),
        new("BoxTreeOperand.Id — changed", 2, 4, "2.2 nwl-item-id (R)"),
        new("BoxTreeTerminator.Id — changed", 1, 1, "2.2 nwl-item-id (R)"),
        new("Flags.Fixed in BoxTreeAssign.OutputItems.OutputItems.Flags — changed", 2, 2, "2.2 nwl-flags-fixed (R)"),
        new("Flags.Fixed in BoxTreeBox.Flags — changed", 2, 2, "2.2 nwl-flags-fixed (R)"),
        new("Flags.Fixed in BoxTreeOperand.Operand.Flags — changed", 2, 4, "2.2 nwl-flags-fixed (R)"),
        new("Network.Id — changed", 3, 3, "2.2 nwl-item-id (R)"),
        new("Operand.Boolean in BoxTreeAssign.OutputItems.OutputItems — changed", 1, 1, "2.2 nwl-operand-boolean (R)"),
        new("Operand.Id in BoxTreeAssign.OutputItems.OutputItems — changed", 3, 3, "2.2 nwl-item-id (R)"),
        new("Operand.Id in BoxTreeBox.Instance — changed", 2, 2, "2.2 nwl-item-id (R)"),
        new("Operand.Id in BoxTreeOperand.Operand — changed", 2, 4, "2.2 nwl-item-id (R)"),
        new("Operand.LValue in BoxTreeAssign.OutputItems.OutputItems — changed", 3, 3, "2.3 D: true exactly for an assign target or a box output slot (the import answers false, the stamp writes none)"),
        new("Operand.Type in BoxTreeAssign.OutputItems.OutputItems — changed", 3, 3, "2.2 nwl-operand-type (R)"),
        new("Operand.Type in BoxTreeBox.Instance — changed", 2, 2, "2.2 nwl-instance-type (R)"),
        new("Operand.Type in BoxTreeOperand.Operand — changed", 2, 4, "2.2 nwl-operand-type (R)"),
        new("OutputItemList.OutputItems in BoxTreeBox.OutputItems — list length changed", 2, 2, "2.3 D (the null slots) + design gap (1b.3): a call's unconnected output pins"),
        new("ParamList.Names in BoxTreeBox.OutputParam — list length changed", 2, 2, "2.2 nwl-output-param-names (R): the import names one generic 'Out1' for TON's Q, ET + design gap (1b.3)"),
        new("ParamList.Types in BoxTreeBox.InputParam — changed", 2, 4, "2.2 nwl-param-types (R)"),
        new("ParamList.Types in BoxTreeBox.OutputParam — list length changed", 2, 2, "2.2 nwl-param-types (R)"),
    };
}
