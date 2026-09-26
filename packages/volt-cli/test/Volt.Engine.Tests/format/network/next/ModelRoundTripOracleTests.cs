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
/// THE MODEL ROUND-TRIP ORACLE over every network body the repo can produce offline (task 2.2; spec, "the round
/// trip is checked on tokens and on models"). For each model <c>m</c>: the v2 writer refuses it by name, or
/// <c>Read(Write(m)) ≅ m</c> (<see cref="NextModelOracle"/>). The sources, each a theory so a failure names its
/// body:
/// <list type="bullet">
/// <item><b>v1 test texts</b> — every network-text literal in the test sources (InlineData, constants, bodies,
/// concatenated literals), read with the v1 <see cref="NetworkTextReader"/>. Harvested by scanning the sources
/// rather than listed, so a v1 test added later is in the oracle without anyone remembering to add it.</item>
/// <item><b>v1 test models</b> — the models the v1 tests build in code (<see cref="V1BuiltModels"/>), transcribed
/// by the test that builds them, because a model constructed inside a test method cannot be harvested.</item>
/// <item><b>the LSP corpus</b> — every graphical body in <c>packages/volt-lsp-iec/test-corpus</c> (six real
/// projects' pulled v1 text), read with the v1 reader.</item>
/// </list>
/// The TwinCAT archives run through the same oracle in <c>Volt.Ide.Twincat.Tests</c>, which can reach
/// <c>TcNetworkReader</c>.
///
/// <para><b>The refusal tables are pinned, by reason.</b> A v1-read model carries no output slot, no connection
/// slot and no main output index (v1 never read them; the drivers fill them in phase 2, task 3.10), so the v2
/// writer refuses what it would otherwise have to guess — that is the spec's "null is not a default", measured.
/// A count moving is a change in what v2 can spell or in what the sources hold, and must be looked at, never
/// re-pinned blind.</para>
/// </summary>
public class ModelRoundTripOracleTests
{
    // ── v1 test texts ───────────────────────────────────────────────────────────────────────────────

    static readonly Lazy<(Dictionary<string, NetworkBody> Read, List<string> Unreadable)> V1Texts = new(HarvestV1Texts);

    public static TheoryData<string> V1TextIds()
    {
        var d = new TheoryData<string>();
        foreach (var k in V1Texts.Value.Read.Keys) d.Add(k);
        return d;
    }

    [Theory]
    [MemberData(nameof(V1TextIds))]
    public void Every_v1_test_text_round_trips_or_is_refused_by_name(string id) =>
        NextModelOracle.Check(id, V1Texts.Value.Read[id]);

    [Fact]
    public void V1_test_texts_tally() =>
        NextModelOracle.AssertTally("v1 test texts",
            V1Texts.Value.Read.Select(kv => NextModelOracle.Check(kv.Key, kv.Value)),
            bodies: 67, networks: 69, refused: new Dictionary<string, int>
            {
                // v1 text spells an enabled box's rung continuing as the `en` echo, and v1 never read which output
                // slot that consumer is connected to — ENO or main — so the model has no ConnectedSlot to spell.
                ["an enabled box connected by a slot other than ENO"] = 11,
            });

    // ── v1 test models ──────────────────────────────────────────────────────────────────────────────

    public static TheoryData<string> V1ModelIds()
    {
        var d = new TheoryData<string>();
        foreach (var k in V1BuiltModels.Keys) d.Add(k);
        return d;
    }

    [Theory]
    [MemberData(nameof(V1ModelIds))]
    public void Every_v1_test_model_round_trips_or_is_refused_by_name(string id) =>
        NextModelOracle.Check(id, V1BuiltModels[id]);

    [Fact]
    public void V1_test_models_tally() =>
        NextModelOracle.AssertTally("v1 test models",
            V1BuiltModels.Select(kv => NextModelOracle.Check(kv.Key, kv.Value)),
            bodies: 15, networks: 15, refused: new Dictionary<string, int>
            {
                // The v1 tests hand a DEFINING Demux object to its consumers (FanOutShape x2) or bury one under a
                // Parallel (UnspellableCoil); the vendor defines a wire at the top level only (census 1.8).
                ["a Demux definition below the top level"] = 3,
                ["a return with a named target"] = 1,                   // CoilAssign/return: a Return bit on `out`
                ["a rung driving a coil and a jump together"] = 4,      // marker-only (spec)
                ["a rung driving several jumps"] = 1,                   // marker-only (spec)
                ["an enabled box connected by a slot other than ENO"] = 1,   // no ConnectedSlot, as above
                ["falling-edge coil"] = 1,                              // marker-only (census 1.7: 0 of 576)
                ["negated coil"] = 1,
                ["rising-edge coil"] = 1,
            });

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
        NextModelOracle.Check(id, Corpus.Value.Read[id]);

    [Fact]
    public void Corpus_tally()
    {
        // Every corpus body is v1 text Volt wrote; the v1 reader must read every one of them.
        Assert.True(Corpus.Value.Unreadable.Count == 0, "v1 cannot read: " + string.Join("\n", Corpus.Value.Unreadable));
        NextModelOracle.AssertTally("corpus",
            Corpus.Value.Read.Select(kv => NextModelOracle.Check(kv.Key, kv.Value)),
            bodies: 18, networks: 75, refused: new Dictionary<string, int>
            {
                ["a wire of unknown type"] = 1,                                  // a data wire, no OutputTypes in v1
                ["an enabled box connected by a slot other than ENO"] = 23,      // no ConnectedSlot in v1
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
        NextModelOracle.Check(id, CorpusNetworks.Value[id]);

    [Fact]
    public void Corpus_network_tally() =>
        NextModelOracle.AssertTally("corpus networks",
            CorpusNetworks.Value.Select(kv => NextModelOracle.Check(kv.Key, kv.Value)),
            bodies: 298, networks: 298, refused: new Dictionary<string, int>
            {
                // A wire fed by a data producer (census 1.17: FB/function outputs, 11 in Lenze): its type is the
                // box's output type, which v1 text never carried — never guessed.
                ["a wire of unknown type"] = 14,
                ["an enabled box connected by a slot other than ENO"] = 66,
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

    /// <summary>The network-text span of a literal: from its first v1 header through its last END_NETWORK.</summary>
    static string? NetworkSpan(string s)
    {
        var m = V1Header.Match(s);
        if (!m.Success) return null;
        var end = s.LastIndexOf("END_NETWORK", StringComparison.Ordinal);
        return end < m.Index ? s.Substring(m.Index) : s.Substring(m.Index, end + "END_NETWORK".Length - m.Index) + "\n";
    }

    static (Dictionary<string, NetworkBody>, List<string>) HarvestV1Texts()
    {
        var test = Path.Combine(CliRoot().FullName, "test");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var read = new Dictionary<string, NetworkBody>(StringComparer.Ordinal);
        var unreadable = new List<string>();
        foreach (var file in Directory.EnumerateFiles(test, "*.cs", SearchOption.AllDirectories).OrderBy(f => f, StringComparer.Ordinal))
        {
            var rel = Path.GetRelativePath(test, file).Replace('\\', '/');
            // v2's own tests are v2 text; bin/obj are build output.
            if (rel.Contains("/bin/") || rel.Contains("/obj/") || rel.Contains("/next/")) continue;
            var n = 0;
            foreach (var lit in CSharpLiterals.Of(File.ReadAllText(file)))
            {
                if (NetworkSpan(lit) is not { } span || !seen.Add(span)) continue;
                var id = $"{rel}#{++n}";
                try { read[id] = NetworkTextReader.Parse(span); }
                catch (Exception) { unreadable.Add(id); }   // a v1 diagnostics test's deliberately bad text
            }
        }
        return (read, unreadable);
    }

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
                try { read[id] = NetworkTextReader.Parse(body.ToString()); }
                catch (Exception e) { unreadable.Add(id + " " + e.Message); }
            }
        }
        return (read, unreadable);
    }

    // ── the models the v1 tests build in code ───────────────────────────────────────────────────────

    static Leaf L(string t, Flags? f = null) => new(new Operand(t), f ?? Flags.None);
    static Input In(Node v) => new(null, v, Flags.None);
    static Box And(Node a, Node b, string type = "AND") =>
        new(type, null, CallKind.Operator, new[] { In(a), In(b) }, Array.Empty<Output>(), null, null, Flags.None);
    static Operand Coil(string t, Flags? f = null) => new(t, IsLValue: true, Flags: f);
    static NetworkBody Body(BodyLanguage lang, params Node[] trees) =>
        new(lang, new[] { new Network(0, null, null, null, false, trees) });

    /// <summary>Every model a v1 network test constructs, keyed by the test that builds it (file.test[/case]).</summary>
    static readonly IReadOnlyDictionary<string, NetworkBody> V1BuiltModels = BuildV1Models();

    static Dictionary<string, NetworkBody> BuildV1Models()
    {
        var m = new Dictionary<string, NetworkBody>(StringComparer.Ordinal);
        var jump = new Flags(Jump: true);
        var ret = new Flags(Return: true);

        // FanOutShapeTests
        m["FanOutShape.MultiOutputAssign"] = Body(BodyLanguage.Ld, new Assign(L("a"), new[] { Coil("out1"), Coil("out2") }, Flags.None));
        {
            // The v1 test hands the DEFINING Demux object to its consumers as their value; the vendor readers
            // build a reference (Input null). Kept as the test builds it: the oracle covers what exists.
            var demux = new Demux(1, L("a"), Flags.None);
            m["FanOutShape.DemuxAndTwoAssigns"] = Body(BodyLanguage.Ld, demux,
                new Assign(demux, new[] { Coil("out1") }, Flags.None), new Assign(demux, new[] { Coil("out2") }, Flags.None));
        }
        m["FanOutShape.A_fold_keeps_each_targets_own_operator"] = Body(BodyLanguage.Ld,
            new Assign(L("a"), new[] { Coil("out1"), Coil("out2", Flags.None with { Set = true }) }, Flags.None));
        m["FanOutShape.An_enabled_box_driving_several_coils"] = Body(BodyLanguage.Ld, new Assign(
            new Box("AND", null, CallKind.Operator, new[] { In(L("a")), In(L("b")) }, Array.Empty<Output>(), L("en"), null, Flags.None),
            new[] { Coil("out1"), Coil("out2") }, Flags.None));
        {
            var wire = new Demux(3, L("a"), Flags.None);
            m["FanOutShape.A_folded_assign_fed_by_a_WIRE"] = Body(BodyLanguage.Ld, wire,
                new Assign(wire, new[] { Coil("single") }, Flags.None),
                new Assign(wire, new[] { Coil("out1"), Coil("out2") }, Flags.None));
        }

        // JumpDestinationTests
        foreach (var (first, second) in new[] { ("Onwards", "out"), ("out", "Onwards") })
            m[$"JumpDestination.The_rendered_jump_names_the_flagged_target/{first}-{second}"] = Body(BodyLanguage.Ld,
                new Assign(new Terminator(null, Flags.None),
                    new[] { first, second }.Select(n => new Operand(n, IsLValue: true, Flags: n == "Onwards" ? jump : Flags.None)).ToArray(),
                    jump));

        // NetworkTextRoundTripTests
        m["RoundTrip.An_operand_whose_own_text_is_unsafe"] = Body(BodyLanguage.Fbd,
            new Assign(And(L("a"), L("arr[j + 1]")), new[] { new Operand("out") }, Flags.None));
        m["RoundTrip.A_fan_out_wire_renders_as_a_named_LET"] = Body(BodyLanguage.Fbd,
            new Demux(7, And(L("a"), L("b")), Flags.None),
            new Assign(new Demux(7, null, Flags.None), new[] { new Operand("out1") }, Flags.None),
            new Assign(new Demux(7, null, Flags.None), new[] { new Operand("out2") }, Flags.None));
        m["RoundTrip.A_wire_whose_name_a_variable_already_holds"] = Body(BodyLanguage.Fbd,
            new Demux(5, And(L("g5"), L("b")), Flags.None),
            new Assign(new Demux(5, null, Flags.None), new[] { new Operand("out1") }, Flags.None),
            new Assign(new Demux(5, null, Flags.None), new[] { new Operand("out2") }, Flags.None));

        // ParallelRenderTests
        m["ParallelRender.A_fed_parallel"] = Body(BodyLanguage.Ld,
            new Assign(new Parallel(L("c"), new Node[] { L("a"), L("b") }, Flags.None), new[] { new Operand("out") }, Flags.None));
        m["ParallelRender.An_unfed_parallel"] = Body(BodyLanguage.Ld,
            new Assign(new Parallel(null, new Node[] { L("a"), L("b") }, Flags.None), new[] { new Operand("out") }, Flags.None));
        m["ParallelRender.A_minted_wire_does_not_capture_a_declared_variable"] = Body(BodyLanguage.Ld,
            new Assign(L("a"), new[] { new Operand("out1"), new Operand("out2") }, Flags.None),
            new Assign(L("g1"), new[] { new Operand("outC") }, Flags.None));
        m["ParallelRender.A_negated_parallel"] = Body(BodyLanguage.Ld,
            new Assign(new Parallel(null, new Node[] { L("a"), L("b") }, Flags.None with { Negated = true }), new[] { new Operand("out") }, Flags.None));

        // UnspellableCoilTests
        Node CoilAssign(Flags f) => new Assign(L("a"), new[] { Coil("out", f) }, Flags.None);
        foreach (var (name, f) in new[]
                 {
                     ("negated", Flags.None with { Negated = true }), ("rising", Flags.None with { Rising = true }),
                     ("falling", Flags.None with { Falling = true }), ("plain", Flags.None),
                     ("set", Flags.None with { Set = true }), ("reset", Flags.None with { Reset = true }),
                     ("return", Flags.None with { Return = true }),
                 })
            m["UnspellableCoil.CoilAssign/" + name] = Body(BodyLanguage.Ld, CoilAssign(f));
        m["UnspellableCoil.The_walk_reaches_a_coil_nested_under_ld_structure"] = Body(BodyLanguage.Ld,
            new Parallel(null, new Node[] { new Demux(7, CoilAssign(Flags.None with { Rising = true }), Flags.None) }, Flags.None));
        foreach (var jumpFirst in new[] { true, false })
        {
            var j = new Operand("Onwards", IsLValue: true, Flags: jump);
            var c = new Operand("out", IsLValue: true, Flags: Flags.None);
            m["UnspellableCoil.A_rung_driving_a_coil_AND_a_jump/" + (jumpFirst ? "jump-first" : "coil-first")] = Body(BodyLanguage.Ld,
                new Assign(new Terminator(null, Flags.None), jumpFirst ? new[] { j, c } : new[] { c, j }, jump));
        }
        m["UnspellableCoil.A_rung_driving_TWO_jumps"] = Body(BodyLanguage.Ld, new Assign(new Terminator(null, Flags.None),
            new[] { new Operand("Onwards", IsLValue: true, Flags: jump), new Operand("Elsewhere", IsLValue: true, Flags: jump) }, jump));
        m["UnspellableCoil.A_lone_jump"] = Body(BodyLanguage.Ld,
            new Assign(new Terminator(null, Flags.None), new[] { new Operand("Onwards", IsLValue: true, Flags: jump) }, jump));
        m["UnspellableCoil.A_lone_return"] = Body(BodyLanguage.Ld,
            new Assign(new Terminator(null, Flags.None), new[] { new Operand("???", IsLValue: true, Flags: ret) }, ret));
        m["UnspellableCoil.A_plain_fan_out"] = Body(BodyLanguage.Ld, new Assign(L("a"),
            new[] { new Operand("out1", IsLValue: true, Flags: Flags.None), new Operand("out2", IsLValue: true, Flags: Flags.None) }, Flags.None));
        return m;
    }
}

/// <summary>
/// The string literals of a C# source file, with adjacent <c>"…" + "…"</c> concatenations joined — enough of the
/// lexical grammar to harvest test texts: regular, verbatim and raw literals, char literals and comments skipped
/// so a quote inside one does not open a string. An interpolated literal is skipped whole: its holes are values
/// only the running test knows.
/// </summary>
internal static class CSharpLiterals
{
    public static IEnumerable<string> Of(string s)
    {
        var tokens = new List<(char Kind, string Text)>();   // 'L' literal, '+' plus, 'o' anything else
        var i = 0;
        while (i < s.Length)
        {
            var c = s[i];
            if (char.IsWhiteSpace(c)) { i++; continue; }
            if (c == '/' && At(s, i + 1) == '/') { while (i < s.Length && s[i] != '\n') i++; continue; }
            if (c == '/' && At(s, i + 1) == '*') { var e = s.IndexOf("*/", i + 2, StringComparison.Ordinal); i = e < 0 ? s.Length : e + 2; continue; }
            if (c == '\'')
            {
                i++;
                if (At(s, i) == '\\') i += 2; else i++;
                while (i < s.Length && s[i] != '\'') i++;
                i++;
                tokens.Add(('o', ""));
                continue;
            }
            if (c == '$' || (c == '@' && At(s, i + 1) == '$'))
            {
                var j = i;
                while (j < s.Length && (s[j] == '$' || s[j] == '@')) j++;
                if (At(s, j) == '"') { i = SkipInterpolated(s, j, verbatim: s.Substring(i, j - i).Contains('@')); tokens.Add(('o', "")); continue; }
            }
            if (c == '"' && At(s, i + 1) == '"' && At(s, i + 2) == '"')
            {
                var e = s.IndexOf("\"\"\"", i + 3, StringComparison.Ordinal);
                var raw = s.Substring(i + 3, (e < 0 ? s.Length : e) - i - 3);
                tokens.Add(('L', RawContent(raw)));
                i = e < 0 ? s.Length : e + 3;
                continue;
            }
            if (c == '@' && At(s, i + 1) == '"')
            {
                var sb = new StringBuilder();
                i += 2;
                while (i < s.Length)
                {
                    if (s[i] == '"') { if (At(s, i + 1) == '"') { sb.Append('"'); i += 2; continue; } i++; break; }
                    sb.Append(s[i++]);
                }
                tokens.Add(('L', sb.ToString()));
                continue;
            }
            if (c == '"')
            {
                var sb = new StringBuilder();
                i++;
                while (i < s.Length && s[i] != '"' && s[i] != '\n')
                {
                    if (s[i] == '\\')
                    {
                        var e = At(s, i + 1);
                        switch (e)
                        {
                            case 'n': sb.Append('\n'); break;
                            case 'r': sb.Append('\r'); break;
                            case 't': sb.Append('\t'); break;
                            case '0': sb.Append('\0'); break;
                            case 'u':
                                sb.Append((char)Convert.ToInt32(s.Substring(i + 2, 4), 16));
                                i += 4;
                                break;
                            default: sb.Append(e); break;
                        }
                        i += 2;
                        continue;
                    }
                    sb.Append(s[i++]);
                }
                i++;
                tokens.Add(('L', sb.ToString()));
                continue;
            }
            if (c == '+' && At(s, i + 1) != '+' && At(s, i + 1) != '=') { tokens.Add(('+', "+")); i++; continue; }
            if (char.IsLetterOrDigit(c) || c == '_') { while (i < s.Length && (char.IsLetterOrDigit(s[i]) || s[i] == '_')) i++; tokens.Add(('o', "")); continue; }
            tokens.Add(('o', c.ToString()));
            i++;
        }

        for (var k = 0; k < tokens.Count; k++)
        {
            if (tokens[k].Kind != 'L') continue;
            var sb = new StringBuilder(tokens[k].Text);
            while (k + 2 < tokens.Count && tokens[k + 1].Kind == '+' && tokens[k + 2].Kind == 'L')
            {
                sb.Append(tokens[k + 2].Text);
                k += 2;
            }
            yield return sb.ToString();
        }
    }

    static char At(string s, int i) => i < s.Length ? s[i] : '\0';

    static int SkipInterpolated(string s, int quote, bool verbatim)
    {
        var i = quote + 1;
        var depth = 0;
        while (i < s.Length)
        {
            var c = s[i];
            if (depth == 0 && !verbatim && c == '\\') { i += 2; continue; }
            if (depth == 0 && c == '"') { if (verbatim && At(s, i + 1) == '"') { i += 2; continue; } return i + 1; }
            if (c == '{') { if (depth == 0 && At(s, i + 1) == '{') { i += 2; continue; } depth++; }
            else if (c == '}') { if (depth == 0 && At(s, i + 1) == '}') { i += 2; continue; } depth--; }
            else if (depth > 0 && c == '"') { i++; while (i < s.Length && s[i] != '"') { if (s[i] == '\\') i++; i++; } }
            i++;
        }
        return i;
    }

    /// <summary>A raw literal's content: a multi-line one drops its first and last line and the closing line's
    /// indentation from every line.</summary>
    static string RawContent(string raw)
    {
        if (!raw.Contains('\n')) return raw;
        var lines = raw.Replace("\r", "").Split('\n');
        var indent = lines[^1].Length;
        return string.Join("\n", lines.Skip(1).Take(lines.Length - 2).Select(l => l.Length >= indent ? l.Substring(indent) : l.TrimStart()));
    }
}
