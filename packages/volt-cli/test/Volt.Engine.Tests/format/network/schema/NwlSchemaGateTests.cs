using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Volt.Engine.Format.Network;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Engine.Tests.Format.Network.Schema;

/// <summary>
/// THE NWL COMPLETENESS GATE (openspec <c>nwl-schema-completeness-gate</c> 2.2), both directions, over every shape
/// <see cref="NwlShapes"/> generates from the schema census:
/// <list type="bullet">
/// <item>model â†’ text â†’ model is identical (<see cref="StNetworkOracle.Check"/>): a shape the writer spells reads back to
/// itself, so two models never share a text;</item>
/// <item>every shape has exactly one spelling or a refusal by name â€” the writer's (<c>%UNSUPPORTED</c>) or the CODESYS
/// reader's before any model; anything else fails, naming the shape;</item>
/// <item>text â†’ model â†’ text over every spelled text and every production the reference shows
/// (<c>docs/network-text.html</c>) finds no second spelling: a text that reads writes back as itself.</item>
/// </list>
/// The shapes are exported (2.3) to <c>test/fixtures/nwl-schema/shapes.v2.jsonl</c> with their class, slot, holder and flags,
/// with the coverage and cuts in <c>shapes.v2.coverage.txt</c>; <c>VOLT_WRITE_NWL_SHAPES=1</c> rewrites both, otherwise a
/// difference fails.
/// </summary>
public class NwlSchemaGateTests
{
    public const string ExportVersion = "v2";

    static string Dir => Path.GetDirectoryName(NwlSchemaCensus.FixturePath)!;
    public static string ExportPath => Path.Combine(Dir, $"shapes.{ExportVersion}.jsonl");
    static string CoveragePath => Path.Combine(Dir, $"shapes.{ExportVersion}.coverage.txt");

    const string Regenerate = "regenerate with VOLT_WRITE_NWL_SHAPES=1 dotnet test test/Volt.Engine.Tests --filter NwlSchemaGateTests";

    public sealed record Outcome(NwlShape Shape, string Kind, string? Text, string? Reason);

    public const string Spelled = "spelled";
    public const string WriterRefused = "refused";
    public const string VendorRefused = "vendor-refused";

    static readonly Lazy<IReadOnlyList<Outcome>> Outcomes = new(() => NwlShapes.All().Select(Judge).ToList());

    static Outcome Judge(NwlShape s)
    {
        if (s.VendorRefusal is { } marker) return new(s, VendorRefused, null, marker);
        var net = s.Body!.Networks[0];
        var r = StNetworkOracle.Check(s.Id, 0, s.Language, net, NwlShapes.Scope());
        return r.Bucket switch
        {
            StNetworkOracle.Identical or StNetworkOracle.Stored => new(s, Spelled, r.Text, null),
            StNetworkOracle.Unsupported => new(s, WriterRefused, null, r.Category),
            _ => new(s, "gap", r.Detail, r.Category),
        };
    }

    [Fact]
    public void Every_generated_shape_has_one_spelling_or_a_refusal_by_name()
    {
        var gaps = Outcomes.Value.Where(o => o.Kind == "gap").ToList();
        Assert.True(gaps.Count == 0, $"{gaps.Count} shapes have no spelling and no named refusal:\n" +
            string.Join("\n\n", gaps.Take(25).Select(g => $"{g.Shape.Id}: {g.Reason}\n{g.Text}")));
        Assert.All(Outcomes.Value.Where(o => o.Kind != Spelled), o => Assert.False(string.IsNullOrWhiteSpace(o.Reason)));
    }

    [Fact]
    public void A_spelled_text_reads_back_and_writes_as_itself()
    {
        var scope = NwlShapes.Scope();
        var second = new List<string>();
        foreach (var o in Outcomes.Value.Where(o => o.Kind == Spelled).GroupBy(o => o.Text).Select(g => g.First()))
        {
            var back = StNetworkWriter.Write(StNetworkReader.Read(o.Text!, scope), scope);
            if (back != o.Text) second.Add($"{o.Shape.Id}:\n{o.Text}\n-- writes back as --\n{back}");
        }
        Assert.True(second.Count == 0, "a spelled text has a second spelling:\n" + string.Join("\n\n", second.Take(20)));
    }

    [Fact]
    public void Every_class_slot_and_flag_of_the_census_is_generated()
    {
        var census = NwlSchemaCensusTests.Committed();
        var shapes = Outcomes.Value.Select(o => o.Shape).ToList();
        // every IBoxTree class in every IBoxTree slot the census names
        foreach (var slot in census["slots"]!.AsArray().Where(s => s!["accepts"]!.GetValue<string>() is "IBoxTree" or "IBoxTreeBox" or "Object"))
        {
            var name = slot!["slot"]!.GetValue<string>();
            foreach (var cls in slot["classes"]!.AsArray().Select(c => c!.GetValue<string>()).Where(c => c.StartsWith("BoxTree", StringComparison.Ordinal)))
            {
                if (name == "BoxTreeMux.Merger" && cls != "BoxTreeBox") continue;   // typed IBoxTreeBox
                Assert.True(shapes.Any(s => s.Depth == 1 && s.Slot.StartsWith(name, StringComparison.Ordinal)
                                            && s.Class.StartsWith(cls, StringComparison.Ordinal)), $"no shape puts {cls} in {name}");
            }
        }
        // every flag value of the census on every holder
        foreach (var bit in census["flagBits"]!.AsArray().Select(b => b!["value"]!.GetValue<int>()))
            foreach (var holder in shapes.Select(s => s.Holder).Where(h => h.Length > 0 && !NwlShapes.IsComment(h)).Distinct())
                Assert.True(shapes.Any(s => s.Holder == holder && s.Bits == bit), $"no shape sets {NwlShapes.BitsName(bit)} on {holder}");
        // the IL view the census's NWLDisplayMode holds is the one refused language
        Assert.Contains("IL=2", census["enums"]!["NWLDisplayMode"]!.AsArray().Select(v => v!.GetValue<string>()));
        Assert.Null(NetworkText.LanguageNamed(NetworkText.ViewLanguage("IL")));
    }

    [Fact]
    public void The_vendor_refusals_the_generator_names_are_the_CODESYS_reader_s()
    {
        var reader = File.ReadAllText(Path.Combine(CorpusProjects.CliRoot().FullName, "src", "Volt.Ide.Codesys", "Ide", "CodesysNetworkReader.cs"));
        foreach (var marker in Outcomes.Value.Where(o => o.Kind == VendorRefused).Select(o => o.Reason!).Distinct())
            Assert.True(reader.Contains("\"" + marker + "\"", StringComparison.Ordinal),
                $"the CODESYS reader raises no refusal named '{marker}'");
    }

    // â”€â”€ the map's verdict (openspec ide-model-mapping 2.3, design.md "Combinations against the map") â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    static readonly string[] Refusing = { "refused-inert", "refused-gap", "refused-fault", "cannot-store" };
    static bool Spells(NwlMapTests.Row r) => r.Status is "spelled" or "lost-inert";

    /// <summary>The map rows a state resolves to: its member's rows whose option names its place (a flag's or a comment's,
    /// <c>on the â€¦</c>) or its class word (a slot's), and whose first word is its value. A box in an assign's value is also
    /// every box row stored <c>consumed</c>.</summary>
    internal static IReadOnlyList<NwlMapTests.Row> Resolve(NwlShapes.State st)
    {
        var place = st.Place.StartsWith("on ", StringComparison.Ordinal);
        bool Names(NwlMapTests.Row r) => place
            ? r.Option.Contains(" " + st.Place, StringComparison.Ordinal) && (st.Value is null || r.Token == st.Value)
            : r.Option.Contains(st.Place, StringComparison.OrdinalIgnoreCase);
        var rows = NwlMapTests.Rows.Value.Where(r => r.Class == st.Class && r.Member == st.Member && Names(r));
        if (st is { Class: "BoxTreeAssign", Member: "RValue", Place: "box" })
            rows = rows.Concat(NwlMapTests.Rows.Value.Where(r => r.Class == "BoxTreeBox" && r.Option.Contains(" consumed", StringComparison.Ordinal)));
        return rows.ToList();
    }

    internal sealed record Verdict(Outcome Outcome, IReadOnlyList<NwlShapes.State> Uncovered, NwlShapes.State? Refuses, bool RefusalMapped, bool RowsSpell);

    static readonly Lazy<IReadOnlyList<Verdict>> Verdicts = new(() =>
    {
        var refusals = NwlMapTests.Rows.Value.Where(r => Refusing.Contains(r.Status)).Select(r => r.Text).ToHashSet(StringComparer.Ordinal);
        var cache = new Dictionary<NwlShapes.State, IReadOnlyList<NwlMapTests.Row>>();
        IReadOnlyList<NwlMapTests.Row> Rows(NwlShapes.State st) => cache.TryGetValue(st, out var r) ? r : cache[st] = Resolve(st);
        return Outcomes.Value.Select(o =>
        {
            var states = NwlShapes.States(o.Shape);
            var uncovered = states.Where(s => Rows(s).Count == 0).ToList();
            var refuses = states.FirstOrDefault(s => Rows(s).Count > 0 && !Rows(s).Any(Spells));
            // a refusal of the whole body stands on its row as the body's line (`%LANGUAGE FBD UNSUPPORTED`)
            var mapped = o.Kind == Spelled || refusals.Contains(o.Reason!) ||
                         states.Any(s => Rows(s).Any(r => Refusing.Contains(r.Status) && r.Text.Contains(" UNSUPPORTED", StringComparison.Ordinal)));
            var rowsSpell = uncovered.Count == 0 && refuses is null;
            return new Verdict(o, uncovered, refuses, mapped, rowsSpell);
        }).ToList();
    });

    [Fact]
    public void No_shape_is_spelled_where_the_map_refuses_it()
    {
        var bad = Verdicts.Value.Where(v => v.Outcome.Kind == Spelled && v.Refuses is not null)
            .Select(v => $"{v.Outcome.Shape.Id}: spelled, and the map's rows for {v.Refuses} all refuse it").ToList();
        Assert.True(bad.Count == 0, $"{bad.Count} shapes are spelled where the map refuses:\n" + string.Join("\n", bad.Take(25)));
    }

    [Fact]
    public void The_exported_shapes_are_what_the_generator_gives()
    {
        var all = Outcomes.Value;
        var sb = new StringBuilder();
        var opts = new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
        sb.Append(new JsonObject
        {
            ["version"] = ExportVersion,
            ["census"] = $"census.{NwlSchemaCensus.Version}.json",
            ["scope"] = new JsonArray(NwlShapes.ScopeLines.Select(l => (JsonNode)l).ToArray()),
            ["note"] = "one shape per line after this one: the schema class in the slot, flags set on the holder (none: no flag); " +
                       "outcome spelled (text: the network text a pull writes) | refused (the writer, a pull's %UNSUPPORTED line: reason) | " +
                       "vendor-refused (the CODESYS reader refuses the stored shape: reason). Depth 2 slots read outer>inner.",
        }.ToJsonString(opts)).Append('\n');
        foreach (var o in all)
        {
            var line = new JsonObject
            {
                ["language"] = o.Shape.Language == BodyLanguage.Ld ? "LD" : "FBD",
                ["depth"] = o.Shape.Depth,
                ["slot"] = o.Shape.Slot,
                ["class"] = o.Shape.Class,
                ["holder"] = o.Shape.Holder,
                ["flags"] = o.Shape.Flags,
                ["outcome"] = o.Kind,
            };
            if (o.Text is not null) line["text"] = o.Text;
            if (o.Reason is not null) line["reason"] = o.Reason;
            sb.Append(line.ToJsonString(opts)).Append('\n');
        }
        Gate(ExportPath, sb.ToString());
        Gate(CoveragePath, Coverage(all));
    }

    static string Coverage(IReadOnlyList<Outcome> all)
    {
        var sb = new StringBuilder();
        sb.Append($"# NWL shape coverage ({ExportVersion}), generated by NwlSchemaGateTests from census.{NwlSchemaCensus.Version}.json; {Regenerate}.\n");
        sb.Append($"shapes: {all.Count} â€” spelled {all.Count(o => o.Kind == Spelled)}, refused by the writer {all.Count(o => o.Kind == WriterRefused)}, " +
                  $"refused by the CODESYS reader {all.Count(o => o.Kind == VendorRefused)}, gaps {all.Count(o => o.Kind == "gap")}\n");
        sb.Append($"distinct spelled texts: {all.Where(o => o.Kind == Spelled).Select(o => o.Text).Distinct().Count()}\n");
        foreach (var d in all.GroupBy(o => o.Shape.Depth).OrderBy(g => g.Key))
            sb.Append($"depth {d.Key}: {d.Count()} shapes, {d.Select(o => o.Shape.Slot).Distinct().Count()} slots, {d.Select(o => o.Shape.Class).Distinct().Count()} classes\n");
        sb.Append($"flag values per holder: {NwlShapes.BitValues().Count} ({string.Join(", ", NwlShapes.BitValues().Select(NwlShapes.BitsName))})\n");
        sb.Append("\n## cut\n");
        foreach (var c in NwlShapes.Cuts) sb.Append("- ").Append(c).Append('\n');
        sb.Append("\n## refusals (shapes)\n");
        foreach (var g in all.Where(o => o.Kind != Spelled).GroupBy(o => o.Kind + ": " + o.Reason).OrderByDescending(g => g.Count()).ThenBy(g => g.Key, StringComparer.Ordinal))
            sb.Append($"{g.Count(),6}  {g.Key}\n");
        sb.Append("\n## per class Ã— slot at depth 1 (spelled/refused/vendor-refused)\n");
        foreach (var g in all.Where(o => o.Shape.Depth == 1).GroupBy(o => o.Shape.Slot + "  " + o.Shape.Class).OrderBy(g => g.Key, StringComparer.Ordinal))
            sb.Append($"{g.Key}: {g.Count(o => o.Kind == Spelled)}/{g.Count(o => o.Kind == WriterRefused)}/{g.Count(o => o.Kind == VendorRefused)}\n");

        var verdicts = Verdicts.Value;
        sb.Append($"\n## against the map (map.{NwlSchemaCensus.Version}.json; openspec ide-model-mapping 2.3)\n");
        sb.Append($"every state resolves to rows: {verdicts.Count(v => v.Uncovered.Count == 0)}; a state no row covers: {verdicts.Count(v => v.Uncovered.Count > 0)}; " +
                  $"spelled where the map refuses: {verdicts.Count(v => v.Outcome.Kind == Spelled && v.Refuses is not null)}\n");
        sb.Append("\n### refused, and no row holds the refusal (shapes)\n");
        foreach (var g in verdicts.Where(v => !v.RefusalMapped).GroupBy(v => v.Outcome.Kind + ": " + v.Outcome.Reason).OrderByDescending(g => g.Count()).ThenBy(g => g.Key, StringComparer.Ordinal))
            sb.Append($"{g.Count(),6}  {g.Key}\n");
        sb.Append("\n### refused where every state's rows spell: the rows lack the context that refuses it (shapes)\n");
        foreach (var g in verdicts.Where(v => v.Outcome.Kind != Spelled && v.RowsSpell).GroupBy(v => v.Outcome.Kind + ": " + v.Outcome.Reason).OrderByDescending(g => g.Count()).ThenBy(g => g.Key, StringComparer.Ordinal))
            sb.Append($"{g.Count(),6}  {g.Key}\n");
        sb.Append("\n### states no row covers: the measurement queue (shapes reaching each)\n");
        foreach (var g in verdicts.SelectMany(v => v.Uncovered).GroupBy(s => s.ToString()).OrderByDescending(g => g.Count()).ThenBy(g => g.Key, StringComparer.Ordinal))
            sb.Append($"{g.Count(),6}  {g.Key}\n");
        return sb.ToString();
    }

    static void Gate(string path, string content)
    {
        if (Environment.GetEnvironmentVariable("VOLT_WRITE_NWL_SHAPES") == "1")
        {
            File.WriteAllText(path, content);
            return;
        }
        Assert.True(File.Exists(path), $"{path} is missing; {Regenerate}");
        Assert.True(File.ReadAllText(path).Replace("\r\n", "\n") == content, $"{Path.GetFileName(path)} is not what the generator gives; {Regenerate}");
    }
}
