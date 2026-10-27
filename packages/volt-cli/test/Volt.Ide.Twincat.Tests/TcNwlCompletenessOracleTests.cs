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
/// <para><b>What "back" is on this vendor: what a push BUILDS, the path where members can be lost.</b> An unchanged push
/// writes nothing (<see cref="An_unchanged_push_writes_nothing"/>: <c>TcNetworkWriter.Apply</c> answers null, so comparing
/// its output with the archive compares the archive with itself — the first version of this oracle did, gate 1b-3). A
/// CREATE builds the whole body natively (<see cref="TcArchiveBuilder"/>), a shape change REBUILDS one network the same way
/// and splices it in (<c>TcNetworkWriter.Splice</c>, then the change gate of <c>Apply</c>); both run here over the corpus
/// and are compared with the stored archive. (It ran over TwinCAT's recorded PLCopen imports until the native writer
/// replaced the import, openspec twincat-inproc-host.)</para>
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
        /// <summary>Unit → the item Ids the body it wrote holds more than once (gate 2-2).</summary>
        public Dictionary<string, string> DuplicateIds = new(StringComparer.Ordinal);
    }

    /// <summary>The Ids the NWL body <paramref name="impl"/> holds more than once, each with its count — none in any body
    /// the corpora hold (census 1b.1: 0 duplicates in 46 bodies).</summary>
    static string? DuplicateIds(XElement impl)
    {
        var dup = impl.Descendants("v").Where(TcIds.IsId).GroupBy(TcIds.Value)
            .Where(g => g.Count() > 1).OrderBy(g => g.Key).Select(g => $"{g.Key} ×{g.Count()}").ToList();
        return dup.Count == 0 ? null : string.Join(", ", dup);
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
        // Read back as the push reads it: the gate, the declarations' derivations included (a `.name` read's slot).
        var back = NetworkTextGate.Validate(text, body.Scope);
        Assert.True(back.Ok, $"{id}: the text the writer wrote does not read back:\n{text}");
        body.Back = back.Body!;
        return body;
    }

    static XElement Impl(XElement nwl) =>
        nwl.DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");

    static PathRun RunCreate(List<Body> bodies)
    {
        var run = new PathRun();
        foreach (var b in bodies)
        {
            string final;
            try { final = TcArchiveBuilder.Body(b.Back, b.Scope); }
            catch (Exception e) when (e is NotSupportedException or NetworkTextException) { run.Refused[b.Id] = "build: " + e.Message; continue; }
            if (DuplicateIds(Impl(XElement.Parse(final))) is { } dupCreate) run.DuplicateIds[b.Id] = dupCreate;
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
        foreach (var b in bodies)
            for (var i = 0; i < b.Back.Networks.Count; i++)
            {
                var unit = $"{b.Id}#{i}";
                XElement rebuilt;
                try { rebuilt = TcArchiveBuilder.NetworkGraph(b.Back.Networks[i], b.Scope); }
                catch (Exception e) when (e is NotSupportedException or NetworkTextException) { run.Refused[unit] = "build: " + e.Message; continue; }
                // The splice Apply makes (`TcNetworkWriter.Splice`: in place, laid out, with fresh Ids), then its change gate.
                var doc = XElement.Parse(b.StoredXml, LoadOptions.PreserveWhitespace);
                TcNetworkWriter.Splice(Impl(doc), TcArchive.List(Impl(doc), "NetworkList")[i], rebuilt);
                var spliced = doc.ToString(SaveOptions.DisableFormatting);
                string final;
                try { final = TcNetworkWriter.Apply(spliced, b.Back, b.Scope) ?? spliced; }
                catch (NotSupportedException e) { run.Refused[unit] = "apply: " + e.Message; continue; }
                if (DuplicateIds(Impl(XElement.Parse(final))) is { } dup) run.DuplicateIds[unit] = dup;
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
                $"{copy} is not the bytes of {sources[0]} — copy the fixture again");
        }
        var project = CorpusProject.At(Path.Combine(CorpusProjects.CorpusRoot(), Corpus));
        foreach (var b in Bodies.Value)
        {
            var site = SourceScopes.SitesOf(CorpusProjects.Split(project.FileOf(b.Bare)!)).Single(s => s.Site.Member is null);
            // the shipped pull: plain-ST network text (openspec network-text-st 2.1)
            var pulled = StNetworkWriter.WritePulled(TcNetworkReader.ReadShown(Impl(XElement.Parse(b.StoredXml)), b.Back.Language), b.Scope);
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

    /// <summary>THE ID IS THE IDE'S ALLOCATOR (C, vendor-facts `nwl-item-id`), SO ITS VALUE IS NOT COMPARED — BUT EVERY
    /// BODY A PUSH WRITES HOLDS EACH ID ONCE, as every body the corpora hold does (gate 2-2). A rebuilt network is built
    /// with its own ids from 2 and spliced into the live body, which renumbers them above the body's: spliced as it came,
    /// it would repeat Ids the kept networks hold, and TwinCAT keeps a stored Id across save and reopen (N28).</summary>
    [Fact]
    public void Every_body_a_push_writes_holds_each_id_once()
    {
        Assert.True(Rebuild.Value.Findings.Count > 0, "the rebuild path compared no network");
        Assert.Empty(Create.Value.DuplicateIds);
        Assert.Empty(Rebuild.Value.DuplicateIds);
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

    /// <summary>THE ORACLE, CREATE: every non-cache member of every network comes back through the native build of the
    /// whole body, or its loss is a known one.</summary>
    [Fact]
    public void Every_member_comes_back_through_a_create_or_is_a_known_loss() =>
        NwlLedger.AssertExactly("twincat create", Create.Value.Findings, KnownCreate);

    /// <summary>THE ORACLE, REBUILD: every non-cache member of the rebuilt network comes back through the native build of
    /// the one network, the splice and the change gate, or its loss is a known one.</summary>
    [Fact]
    public void Every_member_comes_back_through_a_rebuild_or_is_a_known_loss() =>
        NwlLedger.AssertExactly("twincat rebuild", Rebuild.Value.Findings, KnownRebuild);

    // Neither path refuses a network of this corpus: the PLCopen import refused POUexecute's leaf-fed wire network and its
    // Execute box, and dropped ladderLabel's empty network (D25) — none of which the native builder has a reason to.
    static readonly Dictionary<string, string> CreateRefused = new(StringComparer.Ordinal);

    static readonly Dictionary<string, string> RebuildRefused = new(StringComparer.Ordinal);

    /// <summary>Every loss a native CREATE shows today (all 6 networks compared), with the row that names it: members the
    /// IDE re-derives on compile (R) and the text does not carry, which a built body holds at the importer's values.</summary>
    static readonly NwlKnown[] KnownCreate =
    {
        new("BoxTreeBox.EN — changed", 3, 4, "2.2 nwl-box-en-eno (R): a built box shows no EN/ENO (null, as the importer wrote it) where the IDE stored false"),
        new("BoxTreeBox.ENO — changed", 3, 4, "2.2 nwl-box-en-eno (R): a built box shows no EN/ENO (null, as the importer wrote it) where the IDE stored false"),
        new("Flags.Fixed in BoxTreeAssign.OutputItems.OutputItems.Flags — changed", 3, 4, "2.2 nwl-flags-fixed (R): the importer's convention, the editor's is the inverse"),
        new("Flags.Fixed in BoxTreeBox.Flags — changed", 4, 5, "2.2 nwl-flags-fixed (R)"),
        new("Flags.Fixed in BoxTreeOperand.Operand.Flags — changed", 4, 8, "2.2 nwl-flags-fixed (R)"),
        new("Operand.Boolean in BoxTreeAssign.OutputItems.OutputItems — changed", 1, 1, "2.2 nwl-operand-boolean (R)"),
        new("Operand.Type in BoxTreeAssign.OutputItems.OutputItems — changed", 4, 5, "2.2 nwl-operand-type (R)"),
        new("Flags.Fixed in BoxTreeBox.OutputItems.OutputItems.Flags — changed", 2, 2, "2.2 nwl-flags-fixed (R) — 2R.6b: on the unwired ET slot a TON read by `.Q` is built with"),
        new("Operand.Type in BoxTreeBox.OutputItems.OutputItems — changed", 2, 2, "2.2 nwl-operand-type (R) — 2R.6b: on the unwired ET slot a TON read by `.Q` is built with"),
        new("ParamList.Types in BoxTreeBox.OutputParam — changed", 2, 4, "2R.6b: the outputs a TON read by `.Q` is built with have Volt's '' types, as CODESYS's ledger holds"),
        new("Operand.Type in BoxTreeBox.Instance — changed", 2, 2, "2.2 nwl-instance-type (R)"),
        new("Operand.Type in BoxTreeOperand.Operand — changed", 4, 8, "2.2 nwl-operand-type (R); 2R.3 (B6): a leaf feeding a split no longer takes its stored type (no split type in the text), as on CODESYS"),
        new("OutputItemList.OutputItems in BoxTreeBox.OutputItems — list length changed", 1, 2, "2R.3 B7 L: a call's stored slots beyond its text pins where its callee is an FB (TON ['Q', 'ET']) — lost on rebuild and named (RebuildLoss), as CODESYS's ledger holds — 2R.6b: a TON read by `.Q` is built with every output its declaration names, so 2 closed"),
        new("ParamList.Names in BoxTreeBox.OutputParam — list length changed", 1, 2, "2R.3 B7 L: an FB's stored output names beyond its text pins (TON ['Q', 'ET']) — lost on rebuild and named (RebuildLoss), as CODESYS's ledger holds — 2R.6b: a TON read by `.Q` is built with every output its declaration names, so 2 closed"),
        new("ParamList.Types in BoxTreeBox.InputParam — changed", 2, 4, "2.2 nwl-param-types (R)"),
        new("ParamList.Types in BoxTreeBox.OutputParam — list length changed", 1, 2, "2R.3 B7 L: the types of the output names above, which go with them — 2R.6b: a TON read by `.Q` is built with every output its declaration names, so 2 closed"),
        new("NWLImplementationObject.BranchCounter — changed", 1, 1, "the VarId allocator: a create starts it at the highest VarId it holds (1 for none)"),
    };

    /// <summary>Every loss a native REBUILD shows today (all 6 networks compared, each spliced into its stored body): the
    /// same members as a create's, network by network.</summary>
    static readonly NwlKnown[] KnownRebuild =
    {
        new("BoxTreeBox.EN — changed", 3, 4, "2.2 nwl-box-en-eno (R): a built box shows no EN/ENO (null, as the importer wrote it) where the IDE stored false"),
        new("BoxTreeBox.ENO — changed", 3, 4, "2.2 nwl-box-en-eno (R): a built box shows no EN/ENO (null, as the importer wrote it) where the IDE stored false"),
        new("Flags.Fixed in BoxTreeAssign.OutputItems.OutputItems.Flags — changed", 3, 4, "2.2 nwl-flags-fixed (R): the importer's convention, the editor's is the inverse"),
        new("Flags.Fixed in BoxTreeBox.Flags — changed", 4, 5, "2.2 nwl-flags-fixed (R)"),
        new("Flags.Fixed in BoxTreeOperand.Operand.Flags — changed", 4, 8, "2.2 nwl-flags-fixed (R)"),
        new("Operand.Boolean in BoxTreeAssign.OutputItems.OutputItems — changed", 1, 1, "2.2 nwl-operand-boolean (R)"),
        new("Operand.Type in BoxTreeAssign.OutputItems.OutputItems — changed", 4, 5, "2.2 nwl-operand-type (R)"),
        new("Flags.Fixed in BoxTreeBox.OutputItems.OutputItems.Flags — changed", 2, 2, "2.2 nwl-flags-fixed (R) — 2R.6b: on the unwired ET slot a TON read by `.Q` is built with"),
        new("Operand.Type in BoxTreeBox.OutputItems.OutputItems — changed", 2, 2, "2.2 nwl-operand-type (R) — 2R.6b: on the unwired ET slot a TON read by `.Q` is built with"),
        new("ParamList.Types in BoxTreeBox.OutputParam — changed", 2, 4, "2R.6b: the outputs a TON read by `.Q` is built with have Volt's '' types, as CODESYS's ledger holds"),
        new("Operand.Type in BoxTreeBox.Instance — changed", 2, 2, "2.2 nwl-instance-type (R)"),
        new("Operand.Type in BoxTreeOperand.Operand — changed", 4, 8, "2.2 nwl-operand-type (R); 2R.3 (B6): a leaf feeding a split no longer takes its stored type (no split type in the text), as on CODESYS"),
        new("OutputItemList.OutputItems in BoxTreeBox.OutputItems — list length changed", 1, 2, "2R.3 B7 L: a call's stored slots beyond its text pins where its callee is an FB (TON ['Q', 'ET']) — lost on rebuild and named (RebuildLoss), as CODESYS's ledger holds — 2R.6b: a TON read by `.Q` is built with every output its declaration names, so 2 closed"),
        new("ParamList.Names in BoxTreeBox.OutputParam — list length changed", 1, 2, "2R.3 B7 L: an FB's stored output names beyond its text pins (TON ['Q', 'ET']) — lost on rebuild and named (RebuildLoss), as CODESYS's ledger holds — 2R.6b: a TON read by `.Q` is built with every output its declaration names, so 2 closed"),
        new("ParamList.Types in BoxTreeBox.InputParam — changed", 2, 4, "2.2 nwl-param-types (R)"),
        new("ParamList.Types in BoxTreeBox.OutputParam — list length changed", 1, 2, "2R.3 B7 L: the types of the output names above, which go with them — 2R.6b: a TON read by `.Q` is built with every output its declaration names, so 2 closed"),
    };
}
