using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Xunit;

namespace Volt.Engine.Tests.Format.Network.Schema;

/// <summary>
/// THE MAP'S COMPLETENESS GATE (openspec <c>ide-model-mapping</c> 1.3). The map <c>test/fixtures/nwl-schema/map.3.5.21.40.json</c>
/// holds one row per member and option of the NWL model, in the row format of the change's design.md. This reads the census
/// (<c>census.3.5.21.40.json</c>, read from the vendor's DLL) and fails naming every member, and every option the census
/// enumerates (a flag bit, an enum member, true/false, null on a nullable), that has no row.
/// <para>A class not mapped yet stands in <see cref="Pending"/>, an explicit list that only shrinks: a pending class whose rows
/// are complete fails until it is taken off.</para>
/// <para>A row's evidence is checked too: its fixture resolves, every recorded state has a row, and a row's text is what a pull
/// of each state it cites shows today.</para>
/// </summary>
public class NwlMapTests
{
    /// <summary>The classes not mapped yet (tasks 2.1 and 2.2). Shrinks; never grows.</summary>
    static readonly string[] Pending = Array.Empty<string>();

    static readonly string[] Statuses = { "spelled", "lost-inert", "refused-inert", "refused-gap", "refused-fault", "cannot-store", "not-measured" };
    static readonly string[] Cells = { "same", "differs", "not-measured", "faults" };
    static readonly string[] Sources = { "census", "editor", "created" };

    static string Dir => Path.GetDirectoryName(NwlSchemaCensus.FixturePath)!;
    static string MapPath => Path.Combine(Dir, $"map.{NwlSchemaCensus.Version}.json");

    sealed record Row(int Line, string Class, string Member, string Kind, string Option, string Source, string Picture, string Code,
        string Run, string Persists, string Status, string Text, string? Fixture)
    {
        /// <summary>The stored value the row is about: the option's first word (<c>true</c>, <c>null</c>, <c>Negation</c>, <c>None</c>).</summary>
        public string Token => Option.Split(' ', ',')[0];
        public override string ToString() => $"row {Line} {Class}.{Member} [{Kind}] {Option}";
    }

    static readonly Lazy<List<Row>> Rows = new(() =>
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(MapPath));
        static string? S(JsonElement r, string n) => r.GetProperty(n).ValueKind == JsonValueKind.Null ? null : r.GetProperty(n).GetString();
        return doc.RootElement.GetProperty("rows").EnumerateArray().Select((r, i) => new Row(i + 1, S(r, "class")!, S(r, "member")!, S(r, "kind")!,
            S(r, "option")!, S(r, "source")!, S(r, "picture")!, S(r, "code")!, S(r, "run")!, S(r, "persists")!, S(r, "status")!, S(r, "text")!,
            S(r, "fixture"))).ToList();
    });

    sealed record Member(string Class, string Name, string Type);

    static readonly Lazy<(List<Member> Members, string[] FlagBits, Dictionary<string, string[]> Enums)> Census = new(() =>
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(NwlSchemaCensus.FixturePath));
        var root = doc.RootElement;
        var members = root.GetProperty("classes").EnumerateArray().SelectMany(c => c.GetProperty("members").EnumerateArray()
            .Select(m => new Member(c.GetProperty("class").GetString()!, m.GetProperty("member").GetString()!, m.GetProperty("type").GetString()!))).ToList();
        var bits = root.GetProperty("flagBits").EnumerateArray().Select(b => b.GetProperty("name").GetString()!).ToArray();
        var enums = root.GetProperty("enums").EnumerateObject().ToDictionary(e => e.Name,
            e => e.Value.EnumerateArray().Select(v => v.GetString()!.Split('=')[0]).ToArray(), StringComparer.Ordinal);
        return (members, bits, enums);
    });

    /// <summary>The options the census enumerates for a member's type; empty where the type has no closed set.</summary>
    static IEnumerable<string> Options(Member m)
    {
        var (_, bits, enums) = Census.Value;
        if (m.Type == "Boolean") return new[] { "true", "false" };
        if (m.Type == "Boolean?") return new[] { "true", "false", "null" };
        if (m.Type == "Flags") return bits;
        return enums.TryGetValue(m.Type, out var values) ? values : Array.Empty<string>();
    }

    /// <summary>What a class lacks: each member with no row, each option with no row.</summary>
    static IEnumerable<string> Missing(string cls)
    {
        var rows = Rows.Value;
        foreach (var m in Census.Value.Members.Where(m => m.Class == cls))
        {
            var own = rows.Where(r => r.Class == m.Class && r.Member == m.Name).ToList();
            if (own.Count == 0) { yield return $"{m.Class}.{m.Name} ({m.Type}): no row"; continue; }
            foreach (var o in Options(m).Where(o => !own.Any(r => r.Token == o)))
                yield return $"{m.Class}.{m.Name} ({m.Type}) option {o}: no row";
        }
    }

    [Fact]
    public void Every_member_and_option_of_a_mapped_class_has_a_row()
    {
        var classes = Census.Value.Members.Select(m => m.Class).Distinct().Where(c => !Pending.Contains(c));
        Assert.Empty(classes.SelectMany(Missing));
    }

    [Fact]
    public void BoxTreeBox_is_mapped()
    {
        Assert.DoesNotContain("BoxTreeBox", Pending);
        Assert.Empty(Missing("BoxTreeBox"));
    }

    [Fact]
    public void The_pending_list_only_names_classes_still_unmapped()
    {
        var census = Census.Value.Members.Select(m => m.Class).ToHashSet();
        Assert.Empty(Pending.Where(c => !census.Contains(c)).Select(c => $"{c}: not in the census"));
        Assert.Empty(Pending.Where(c => !Missing(c).Any()).Select(c => $"{c}: every member and option has a row; take it off the pending list"));
    }

    [Fact]
    public void Every_row_is_well_formed()
    {
        var members = Census.Value.Members.Select(m => (m.Class, m.Name)).ToHashSet();
        var bad = new List<string>();
        foreach (var r in Rows.Value)
        {
            if (!members.Contains((r.Class, r.Member))) bad.Add($"{r}: no such member in the census");
            if (!Statuses.Contains(r.Status)) bad.Add($"{r}: status '{r.Status}'");
            if (!Sources.Contains(r.Source)) bad.Add($"{r}: source '{r.Source}'");
            foreach (var (name, v) in new[] { ("picture", r.Picture), ("code", r.Code), ("run", r.Run), ("persists", r.Persists) })
                if (!Cells.Contains(v)) bad.Add($"{r}: {name} '{v}'");
            // measured without a fixture is an old pattern (design.md): a status other than not-measured names its evidence
            if (r.Status != "not-measured" && r.Fixture is null) bad.Add($"{r}: {r.Status} with no fixture");
            if (r.Status == "not-measured" && new[] { r.Picture, r.Code, r.Run }.Any(c => c is "same" or "differs"))
                bad.Add($"{r}: measured cells under not-measured");
        }
        var dupes = Rows.Value.GroupBy(r => (r.Class, r.Member, r.Kind, r.Option)).Where(g => g.Count() > 1).Select(g => $"{g.First()}: {g.Count()} rows");
        Assert.Empty(bad.Concat(dupes).Take(30));
    }

    sealed record State(string Id, string Pull);


    static (Dictionary<string, State> States, int Faults) Recording(string file)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(Dir, file)));
        var states = doc.RootElement.GetProperty("states").EnumerateArray()
            .ToDictionary(s => s.GetProperty("id").GetString()!, s => new State(s.GetProperty("id").GetString()!, s.GetProperty("pull").GetString()!));
        return (states, doc.RootElement.TryGetProperty("faults", out var f) ? f.GetArrayLength() : 0);
    }

    /// <summary>The recordings a fixture can cite, by prefix.</summary>
    static readonly Dictionary<string, string> Recordings = new(StringComparer.Ordinal)
    {
        ["box-states"] = $"box-states.{NwlSchemaCensus.Version}.json",
        ["assign-states"] = $"assign-states.{NwlSchemaCensus.Version}.json",
        ["class-states"] = $"class-states.{NwlSchemaCensus.Version}.json",
    };

    /// <summary>What a pull of a recorded state shows, as a row's text holds it: the text, or a refusal's wording alone.</summary>
    static string AsText(string pull) =>
        pull.StartsWith("%UNSUPPORTED \"", StringComparison.Ordinal) ? pull.Substring(14, pull.LastIndexOf('"') - 14) : pull;

    [Fact]
    public void Every_recorded_state_has_a_row_whose_text_is_its_pull()
    {
        var bad = new List<string>();
        foreach (var (prefix, file) in Recordings)
        {
            var (states, faults) = Recording(file);
            var cited = new HashSet<string>(StringComparer.Ordinal);
            var faultsCited = new HashSet<int>();
            foreach (var r in Rows.Value.Where(r => r.Fixture?.StartsWith(prefix + "#", StringComparison.Ordinal) == true))
            {
                var refs = r.Fixture!.Substring(prefix.Length + 1);
                if (refs.StartsWith("fault:", StringComparison.Ordinal))
                {
                    foreach (var i in refs.Substring(6).Split(',').Select(int.Parse))
                        if (i < faults) faultsCited.Add(i); else bad.Add($"{r}: no fault {i} in {file}");
                    continue;
                }
                foreach (var id in refs.Split(','))
                {
                    if (!states.TryGetValue(id, out var s)) { bad.Add($"{r}: no state {id} in {file}"); continue; }
                    cited.Add(id);
                    if (AsText(s.Pull) != r.Text) bad.Add($"{r}: state {id} pulls '{AsText(s.Pull)}', the row says '{r.Text}'");
                }
            }
            bad.AddRange(states.Keys.Where(id => !cited.Contains(id)).Select(id => $"{file} state {id}: no row"));
            bad.AddRange(Enumerable.Range(0, faults).Where(i => !faultsCited.Contains(i)).Select(i => $"{file} fault {i}: no row"));
        }
        var unknown = Rows.Value.Where(r => r.Fixture is { } f && !Recordings.Keys.Any(p => f.StartsWith(p + "#", StringComparison.Ordinal)))
            .Select(r => $"{r}: fixture '{r.Fixture}' names no recording");
        Assert.Empty(bad.Concat(unknown).Take(30));
    }
}
