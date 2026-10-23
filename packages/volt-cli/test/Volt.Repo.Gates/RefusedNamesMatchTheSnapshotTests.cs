using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Xunit;
using Volt.Tests.Shared;

namespace Volt.Repo.Gates;

/// <summary>
/// EACH DRIVER REFUSES EXACTLY THE NAMES ITS IDE WAS MEASURED TO REFUSE (openspec <c>push-keeps-what-landed</c> 3.1;
/// since openspec <c>vendor-fact-probe</c> 4.1 the measurement is the vendor-fact snapshot).
///
/// <para>The push pre-flight asks the driver whether its IDE refuses a POU or member name (<c>IVendorStore.RefusedName</c>),
/// and each driver answers from a word list. The lists are not a rule: a rule fitted to the measured words reproduces
/// them, but outside them it is a guess, and a pre-flight that guesses refuses a push the IDE would take. So the lists
/// are the measurements themselves — every word a live IDE refused in the <c>refused-names</c> fact of
/// <c>scripts/vendor-facts.&lt;vendor&gt;.json</c> (<c>bun scripts/vendor-facts.ts &lt;vendor&gt;</c> asks each frozen word as a
/// METHOD, and the cross-check words as an ACTION, a PROPERTY and a top-level FB, through the vendor API), upper-cased
/// (the refusal is case-insensitive, measured), per vendor — and this gate holds the source to them.</para>
///
/// <para>Until 2026-10-11 the gate read six probe logs (<c>scripts/member-name-refusal{,-families,-verify}{,-tc}.log</c>,
/// deleted with <c>probe-member-name-refusal.ts</c>; <c>git show 5312b799fe:packages/volt-cli/scripts/…</c>): a second
/// record of the same fact, written by a script the table replaced (design 4).</para>
///
/// <para>Regenerate after a new snapshot: <c>VOLT_WRITE_REFUSED_NAMES=1 dotnet test test/Volt.Repo.Gates</c>.</para>
/// </summary>
public class RefusedNamesMatchTheSnapshotTests
{
    private const string Fact = "refused-names";
    private static readonly string[] Kinds = { "METHOD", "ACTION", "PROPERTY", "TOPLEVEL" };

    public static IEnumerable<object[]> Vendors() => new[]
    {
        new object[] { "codesys", "Volt.Ide.Codesys", "CodesysRefusedNames", "CODESYS SP21" },
        new object[] { "twincat", "Volt.Ide.Twincat", "TcRefusedNames", "TcXaeShell (TwinCAT 3.1.4024)" },
    };

    [Theory]
    [MemberData(nameof(Vendors))]
    public void The_drivers_word_list_is_the_snapshots_refusals(string vendor, string project, string cls, string ide)
    {
        var path = Path.Combine(RepoRoot(), "packages", "volt-cli", "src", project, "Driver", cls + ".cs");
        HoldsExactly(path, cls, Refused(vendor), words => Render(project, cls, ide, vendor, words));
    }

    /// <summary>THE WORDS BOTH VENDORS REFUSE, for what above the seam needs the fact with no driver to ask: the CLI's
    /// post-push comparison (<c>PushedText.SameBody</c> — the CLI links no driver) and the engine tests' scopes
    /// (<c>Scopes.RefusedPouName</c>). A word both IDEs refuse as a POU name is no FB type on either (openspec
    /// <c>bridge-refusal-review</c> D4; review of step 4a: the CLI read every elementary type as an instance, and the
    /// corpus oracle ran on a 25-word stand-in that lacked <c>DATE_AND_TIME</c>, <c>__XWORD</c>, <c>BIT</c>, …).</summary>
    [Fact]
    public void The_engines_word_list_is_what_both_vendors_refused()
    {
        var path = Path.Combine(RepoRoot(), "packages", "volt-cli", "src", "Volt.Engine", "Ide", "BothVendorsRefusedNames.cs");
        var both = Refused("codesys").Intersect(Refused("twincat"), StringComparer.Ordinal).OrderBy(w => w, StringComparer.Ordinal).ToList();
        HoldsExactly(path, "BothVendorsRefusedNames", both, RenderBoth);
    }

    // ── the gate's own teeth, on synthetic snapshots ───────────────────────────────────────────────────────────────

    private static string Snapshot(string groups, string steps = "\"create fb: accepted\"") =>
        $"{{ \"{Fact}\": {{ \"steps\": [{steps}], {groups} }} }}";

    private static string Group(string key, string accepted = "", string refused = "", string other = "", string unexplained = "") =>
        $"\"{key}\": {{ \"accepted\": [{accepted}], \"refused\": [{refused}], \"other\": [{other}], \"unexplained\": [{unexplained}] }}";

    [Fact]
    public void The_refused_words_are_the_union_of_every_group_upper_cased_and_sorted()
    {
        var json = Snapshot(Group("METHOD.a", "\"Run\"", "\"log\", \"INT\"") + ", " + Group("ACTION.vocabulary", "\"Run\"", "\"LOG\""));
        Assert.Equal(new[] { "INT", "LOG" }, RefusedIn(json, "s.json"));
    }

    [Fact]
    public void A_word_refused_as_one_kind_and_accepted_as_another_fails()
    {
        var json = Snapshot(Group("METHOD.a", refused: "\"Log\"") + ", " + Group("TOPLEVEL.vocabulary", "\"LOG\""));
        var e = Assert.ThrowsAny<Exception>(() => RefusedIn(json, "s.json"));
        Assert.Contains("refused as one kind and accepted as another: LOG", e.Message);
    }

    [Fact]
    public void A_name_created_under_another_name_fails_naming_it()
    {
        var json = Snapshot(Group("METHOD.a", other: "\"Foo -> Foo_1\""));
        var e = Assert.ThrowsAny<Exception>(() => RefusedIn(json, "s.json"));
        Assert.Contains("Foo -> Foo_1", e.Message);
    }

    [Fact]
    public void A_refusal_that_is_not_the_vendors_name_refusal_fails_naming_the_word_and_its_text()
    {
        // A COM fault, a kind refusal, a busy IDE: none is the NAME's verdict, and a word in the list refuses a push the
        // IDE would take. The core files it under `unexplained` with the vendor's words; the gate refuses it.
        var json = Snapshot(Group("METHOD.a", "\"Run\"", unexplained: "\"Go: COMException: RPC_E_SERVERCALL_RETRYLATER\""));
        var e = Assert.ThrowsAny<Exception>(() => RefusedIn(json, "s.json"));
        Assert.Contains("Go: COMException: RPC_E_SERVERCALL_RETRYLATER", e.Message);
    }

    [Fact]
    public void A_snapshot_that_asks_a_kind_no_casing_control_fails()
    {
        // The lists match case-insensitively because the refusal was MEASURED to be: a snapshot that no longer asks
        // another spelling of a word it asks has not measured it.
        var json = Snapshot(Group("METHOD.a", "\"Run\"", "\"LOG\"") + ", " + Group("METHOD.casing-1", refused: "\"log\""));
        Assert.Equal(new[] { "LOG" }, RefusedIn(json, "s.json"));
        var e = Assert.ThrowsAny<Exception>(() => CaseInsensitivityMeasuredIn(json, "s.json"));
        Assert.Contains("ACTION", e.Message);
        Assert.DoesNotContain("METHOD", e.Message);
        var stray = Snapshot(Group("METHOD.a", "\"Run\"") + ", " + Group("METHOD.casing-1", refused: "\"log\""));
        Assert.Contains("METHOD log", Assert.ThrowsAny<Exception>(() => CaseInsensitivityMeasuredIn(stray, "s.json")).Message);
    }

    [Fact]
    public void A_spelling_with_another_verdict_than_its_word_fails_as_a_case_sensitive_refusal()
    {
        var json = Snapshot(Group("METHOD.a", refused: "\"LOG\"") + ", " + Group("METHOD.casing-1", "\"log\""));
        var e = Assert.ThrowsAny<Exception>(() => RefusedIn(json, "s.json"));
        Assert.Contains("METHOD LOG is refused as LOG and accepted as log — the IDE refuses case-sensitively", e.Message);
    }

    [Theory]
    [MemberData(nameof(Vendors))]
    public void The_snapshot_measured_the_refusal_case_insensitive_for_every_kind(string vendor, string project, string cls, string ide)
    {
        _ = (project, cls, ide);
        var file = Path.Combine(RepoRoot(), "packages", "volt-cli", "scripts", $"vendor-facts.{vendor}.json");
        CaseInsensitivityMeasuredIn(File.ReadAllText(file), Path.GetFileName(file));
    }

    [Fact]
    public void A_snapshot_without_the_fact_an_unknown_kind_or_a_refused_step_fails()
    {
        Assert.Contains("has no `refused-names` fact", Assert.ThrowsAny<Exception>(() => RefusedIn("{ \"x\": {} }", "s.json")).Message);
        Assert.Contains("`FUNCTION.a`", Assert.ThrowsAny<Exception>(() => RefusedIn(Snapshot(Group("FUNCTION.a")), "s.json")).Message);
        var refusedStep = Snapshot(Group("METHOD.a"), "\"create fb: refused: no\"");
        Assert.Contains("create fb: refused: no", Assert.ThrowsAny<Exception>(() => RefusedIn(refusedStep, "s.json")).Message);
    }

    // ── reading the snapshot ───────────────────────────────────────────────────────────────────────────────────────

    private static List<string> Refused(string vendor)
    {
        var file = Path.Combine(RepoRoot(), "packages", "volt-cli", "scripts", $"vendor-facts.{vendor}.json");
        Assert.True(File.Exists(file), $"{file} is missing — bun scripts/vendor-facts.ts {vendor} --write records it");
        return RefusedIn(File.ReadAllText(file), Path.GetFileName(file));
    }

    /// <summary>Every word the IDE refused in the snapshot's <c>refused-names</c> fact, upper-cased, sorted. Each group
    /// is <c>&lt;KIND&gt;.&lt;group&gt;</c> with the names <c>accepted</c> (created under exactly that name), <c>refused</c>, and
    /// <c>other</c> (created under another name — no verdict, so it fails the gate). A word refused as one kind and
    /// accepted as another fails too: the list is per word because the verdict was measured to be.</summary>
    internal static List<string> RefusedIn(string json, string file)
    {
        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty(Fact, out var fact) || fact.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException($"{file} has no `{Fact}` fact — bun scripts/vendor-facts.ts records it");
        var verdicts = new Dictionary<(string Kind, string Word), bool>();
        var spelled = new Dictionary<(string Kind, string Word), string>();
        foreach (var group in fact.EnumerateObject())
        {
            if (group.Name == "steps")
            {
                var notAccepted = group.Value.EnumerateArray().Select(s => s.GetString()!).Where(s => !s.EndsWith(": accepted", StringComparison.Ordinal)).ToList();
                if (notAccepted.Count > 0) throw new InvalidDataException($"{file}: `{Fact}` did not run whole: {string.Join(" | ", notAccepted)}");
                continue;
            }
            var kind = group.Name.Split('.')[0];
            if (!Kinds.Contains(kind)) throw new InvalidDataException($"{file}: `{Fact}` has a group `{group.Name}` of no kind the drivers ask ({string.Join(", ", Kinds)})");
            var other = Names(group.Value, "other");
            if (other.Count > 0) throw new InvalidDataException($"{file}: `{group.Name}` created names under other names: {string.Join(", ", other)}");
            var unexplained = Names(group.Value, "unexplained");
            if (unexplained.Count > 0)
                throw new InvalidDataException($"{file}: `{group.Name}` holds refusals that are not the IDE's name refusal (a fault, a kind refusal — no verdict on the name): {string.Join(" | ", unexplained)}");
            foreach (var (names, refused) in new[] { (Names(group.Value, "accepted"), false), (Names(group.Value, "refused"), true) })
                foreach (var w in names)
                {
                    var key = (kind, w.ToUpperInvariant());
                    if (verdicts.TryGetValue(key, out var was) && was != refused)
                    {
                        var (r, a) = refused ? (w, spelled[key]) : (spelled[key], w);
                        throw new InvalidDataException($"{file}: {kind} {key.Item2} is refused as {r} and accepted as {a} — the IDE refuses case-sensitively, and every list matching OrdinalIgnoreCase is wrong");
                    }
                    verdicts[key] = refused;
                    spelled[key] = w;
                }
        }
        var byWord = verdicts.GroupBy(v => v.Key.Word).ToList();
        var split = byWord.Where(g => g.Select(v => v.Value).Distinct().Count() > 1).Select(g => g.Key).OrderBy(w => w, StringComparer.Ordinal).ToList();
        if (split.Count > 0) throw new InvalidDataException($"{file}: refused as one kind and accepted as another: {string.Join(" ", split)}");
        return byWord.Where(g => g.First().Value).Select(g => g.Key).OrderBy(w => w, StringComparer.Ordinal).ToList();
    }

    /// <summary>The snapshot ASKED another spelling of a word it asks, for every kind: the <c>&lt;KIND&gt;.casing-N</c> groups
    /// (the logs' <c>log</c> / <c>Log</c> / <c>lOg</c>, <c>To_Bool</c>, <c>__Foo</c> …), each word also asked in a
    /// vocabulary group of the same kind. <see cref="RefusedIn"/> refuses a spelling whose verdict differs.</summary>
    internal static void CaseInsensitivityMeasuredIn(string json, string file)
    {
        using var doc = JsonDocument.Parse(json);
        var fact = doc.RootElement.GetProperty(Fact);
        var findings = new List<string>();
        foreach (var kind in Kinds)
        {
            var groups = fact.EnumerateObject().Where(g => g.Name.StartsWith(kind + ".", StringComparison.Ordinal)).ToList();
            bool IsCasing(JsonProperty g) => g.Name.StartsWith(kind + ".casing-", StringComparison.Ordinal);
            IEnumerable<string> All(JsonProperty g) => Names(g.Value, "accepted").Concat(Names(g.Value, "refused"));
            var casing = groups.Where(IsCasing).SelectMany(All).ToList();
            if (casing.Count == 0) { findings.Add($"{kind} asks no casing control (no `{kind}.casing-N` group)"); continue; }
            var asked = groups.Where(g => !IsCasing(g)).SelectMany(All).ToDictionary(w => w.ToUpperInvariant(), w => w);
            foreach (var w in casing)
                if (!asked.TryGetValue(w.ToUpperInvariant(), out var as_) || as_ == w)
                    findings.Add($"{kind} {w} is a casing control of no other spelling the kind asks");
        }
        if (findings.Count > 0)
            throw new InvalidDataException($"{file}: `{Fact}` did not measure that the refusal is case-insensitive: {string.Join("; ", findings)}");
    }

    private static List<string> Names(JsonElement group, string key) =>
        group.TryGetProperty(key, out var list) && list.ValueKind == JsonValueKind.Array
            ? list.EnumerateArray().Select(x => x.GetString()!).ToList()
            : throw new InvalidDataException($"a `{Fact}` group has no `{key}` list");

    // ── the generated sources ──────────────────────────────────────────────────────────────────────────────────────

    private static void HoldsExactly(string path, string cls, List<string> expected, Func<List<string>, string> render)
    {
        if (Environment.GetEnvironmentVariable("VOLT_WRITE_REFUSED_NAMES") == "1")
            File.WriteAllText(path, render(expected), new UTF8Encoding(false));

        Assert.True(File.Exists(path), $"{path} is missing — VOLT_WRITE_REFUSED_NAMES=1 writes it from the snapshots");
        var actual = Regex.Matches(File.ReadAllText(path), "\"([^\"]+)\",").Cast<Match>().Select(m => m.Groups[1].Value).ToList();
        Assert.Equal(actual.Count, actual.Distinct(StringComparer.Ordinal).Count());
        var missing = expected.Except(actual).ToList();
        var extra = actual.Except(expected).ToList();
        Assert.True(missing.Count == 0 && extra.Count == 0,
            $"{cls}.cs drifted from the snapshot — not listed: {string.Join(" ", missing.Take(20))}; never measured as refused: " +
            $"{string.Join(" ", extra.Take(20))}. VOLT_WRITE_REFUSED_NAMES=1 rewrites it.");
    }

    private static string Render(string project, string cls, string ide, string vendor, List<string> words)
    {
        var sb = new StringBuilder();
        sb.Append("// GENERATED by test/Volt.Repo.Gates/RefusedNamesMatchTheSnapshotTests.cs (VOLT_WRITE_REFUSED_NAMES=1) from\n");
        sb.Append($"// scripts/vendor-facts.{vendor}.json, fact `refused-names` — do not edit; re-measure and regenerate.\n");
        sb.Append("using System;\nusing System.Collections.Generic;\n\n");
        sb.Append($"namespace {project};\n\n");
        sb.Append($"/// <summary>Every name {ide} REFUSED, live, for a new POU or METHOD / ACTION / PROPERTY ({words.Count} words;\n");
        sb.Append("/// openspec <c>push-keeps-what-landed</c> 3.1). Matched case-insensitively, as the IDE refuses (measured). Only measured\n");
        sb.Append("/// words: a word no probe asked reaches the IDE, whose refusal the push reports from the apply loop.</summary>\n");
        sb.Append($"internal static class {cls}\n{{\n");
        sb.Append("    internal static readonly HashSet<string> Words = new HashSet<string>(StringComparer.OrdinalIgnoreCase)\n    {\n");
        for (var i = 0; i < words.Count; i += 6)
            sb.Append("        ").Append(string.Join(" ", words.Skip(i).Take(6).Select(w => $"\"{w}\","))).Append('\n');
        sb.Append("    };\n}\n");
        return sb.ToString();
    }

    private static string RenderBoth(List<string> words)
    {
        var sb = new StringBuilder();
        sb.Append("// GENERATED by test/Volt.Repo.Gates/RefusedNamesMatchTheSnapshotTests.cs (VOLT_WRITE_REFUSED_NAMES=1) from\n");
        sb.Append("// scripts/vendor-facts.{codesys,twincat}.json, fact `refused-names` — do not edit; re-measure and regenerate.\n");
        sb.Append("using System;\nusing System.Collections.Generic;\n\n");
        sb.Append("namespace Volt.Engine.Ide;\n\n");
        sb.Append($"/// <summary>Every name BOTH CODESYS SP21 and TcXaeShell (TwinCAT 3.1.4024) REFUSED, live, for a new POU or member\n");
        sb.Append($"/// ({words.Count} words; the intersection of the drivers' lists, openspec <c>push-keeps-what-landed</c> 3.1). A word both IDEs\n");
        sb.Append("/// refuse as a POU name is no FB type a body calls on either (openspec <c>bridge-refusal-review</c> D4). For what\n");
        sb.Append("/// asks with no driver to ask — the CLI's comparison; a driver answers from its own list.</summary>\n");
        sb.Append("public static class BothVendorsRefusedNames\n{\n");
        sb.Append("    public static readonly IReadOnlyCollection<string> Words = new HashSet<string>(StringComparer.OrdinalIgnoreCase)\n    {\n");
        for (var i = 0; i < words.Count; i += 6)
            sb.Append("        ").Append(string.Join(" ", words.Skip(i).Take(6).Select(w => $"\"{w}\","))).Append('\n');
        sb.Append("    };\n");
        sb.Append("\n    /// <summary>Whether both vendors refuse <paramref name=\"word\"/> as a POU name.</summary>\n");
        sb.Append("    public static bool Contains(string word) => ((HashSet<string>)Words).Contains(word);\n}\n");
        return sb.ToString();
    }

    private static string RepoRoot() => RepoPaths.RepoDir().FullName;
}
