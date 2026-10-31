using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json.Nodes;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Engine.Tests.Format.Network.Schema;

/// <summary>
/// THE NWL SCHEMA CENSUS IS GENERATED AND GATED (openspec <c>nwl-schema-completeness-gate</c> 1.1), the way
/// <c>DocDataTests</c> gates the docs: <c>test/fixtures/nwl-schema/census.&lt;version&gt;.json</c> is what
/// <see cref="NwlSchemaCensus.Read"/> reads from the CODESYS assembly, and <c>model-map.&lt;version&gt;.txt</c> is the census
/// mapped onto Volt's model with every member the model does not carry listed. <c>VOLT_WRITE_NWL_SCHEMA=1</c> rewrites both;
/// otherwise any difference fails. The census is read only where that CODESYS is installed (the dev machine); the map, the
/// disposition cross-check and the model members are checked everywhere, against the committed census.
/// </summary>
public class NwlSchemaCensusTests
{
    static bool Writing => Environment.GetEnvironmentVariable("VOLT_WRITE_NWL_SCHEMA") == "1";

    const string Regenerate = "regenerate with VOLT_WRITE_NWL_SCHEMA=1 dotnet test test/Volt.Engine.Tests --filter NwlSchemaCensusTests";

    static string MapPath => Path.Combine(Path.GetDirectoryName(NwlSchemaCensus.FixturePath)!, $"model-map.{NwlSchemaCensus.Version}.txt");

    internal static JsonObject Committed() => JsonNode.Parse(File.ReadAllText(NwlSchemaCensus.FixturePath))!.AsObject();

    /// <summary>Every archived (class, member) of the committed census.</summary>
    internal static IEnumerable<(string Class, string Member, string Type)> Members(JsonObject census) =>
        census["classes"]!.AsArray().SelectMany(c => c!["members"]!.AsArray().Select(m =>
            (c["class"]!.GetValue<string>(), m!["member"]!.GetValue<string>(), m["type"]!.GetValue<string>())));

    [Fact]
    public void The_census_is_what_the_CODESYS_assembly_declares()
    {
        if (!NwlSchemaCensus.AssemblyPresent)
        {
            Assert.True(File.Exists(NwlSchemaCensus.FixturePath), "the committed census is missing; " + Regenerate);
            return;   // CI has no CODESYS: the committed census stands, the tests below check it
        }
        var read = NwlSchemaCensus.Read();
        Write(NwlSchemaCensus.FixturePath, read);
    }

    [Fact]
    public void Every_census_member_maps_onto_the_model_or_is_a_listed_finding()
    {
        var census = Committed();
        var keys = Members(census).Select(m => m.Class + "." + m.Member).ToList();
        var unmapped = keys.Where(k => !NwlSchemaModelMap.Map.ContainsKey(k)).ToList();
        var stale = NwlSchemaModelMap.Map.Keys.Where(k => !keys.Contains(k)).ToList();
        Assert.True(unmapped.Count == 0 && stale.Count == 0,
            $"the census and NwlSchemaModelMap differ — census members with no map entry: [{string.Join(", ", unmapped)}]; " +
            $"map entries the census does not hold: [{string.Join(", ", stale)}]");

        // the model member a map entry names exists
        var model = typeof(Volt.Engine.Format.Network.NetworkBody).Assembly;
        foreach (var (key, target) in NwlSchemaModelMap.Map)
        {
            if (target is null) continue;
            var path = target.Split(new[] { NwlSchemaModelMap.Partial }, StringSplitOptions.None)[0].Split('.');
            var type = model.GetType("Volt.Engine.Format.Network." + path[0]);
            Assert.True(type is not null && type.GetProperty(path[1]) is not null, $"{key} maps to {target}, which the model does not have");
        }

        Write(MapPath, MapReport(census));
    }

    [Fact]
    public void Every_census_member_has_its_disposition_in_the_member_table()
    {
        // NwlDisposition (test/shared/NwlCompleteness.cs) is the archive oracle's member list, written from stored archives;
        // the census is the assembly's. A member the assembly declares and the table does not name is one no archive showed.
        var missing = Members(Committed()).Where(m => NwlDisposition.Of(m.Class, m.Member) is null)
            .Select(m => m.Class + "." + m.Member).ToList();
        Assert.True(missing.Count == 0, "census members NwlDisposition has no rule for: " + string.Join(", ", missing));
        var censusClasses = Committed()["classes"]!.AsArray().Select(c => c!["class"]!.GetValue<string>()).ToHashSet();
        var extra = NwlDisposition.Rules.Where(r => censusClasses.Contains(r.Class) && !r.Member.StartsWith("api.", StringComparison.Ordinal))
            .Where(r => !Members(Committed()).Any(m => m.Class == r.Class && m.Member == r.Member)).Select(r => r.Key).ToList();
        Assert.True(extra.Count == 0, "NwlDisposition rules for members the assembly does not declare: " + string.Join(", ", extra));
    }

    static string MapReport(JsonObject census)
    {
        var sb = new StringBuilder();
        sb.Append($"# NWL schema → Volt's network model (CODESYS {NwlSchemaCensus.Version}). Generated by NwlSchemaCensusTests; {Regenerate}.\n");
        var members = Members(census).ToList();
        var findings = members.Where(m => NwlSchemaModelMap.Map[m.Class + "." + m.Member] is not { } t || t.Contains(NwlSchemaModelMap.Partial)).ToList();
        sb.Append($"# {census["classes"]!.AsArray().Count} classes, {members.Count} archived members, {census["flagBits"]!.AsArray().Count} flag bits, " +
                  $"{census["slots"]!.AsArray().Count} slots; {findings.Count} members the model does not carry (whole or part).\n\n");
        sb.Append("## carried\n");
        foreach (var m in members.Where(m => !findings.Contains(m)))
            sb.Append($"{m.Class}.{m.Member} : {m.Type} -> {NwlSchemaModelMap.Map[m.Class + "." + m.Member]}\n");
        sb.Append("\n## not carried by the model (findings), with the member table's disposition\n");
        foreach (var m in findings)
        {
            var rule = NwlDisposition.Of(m.Class, m.Member);
            var part = NwlSchemaModelMap.Map[m.Class + "." + m.Member] is { } t ? " [" + t.Replace(NwlSchemaModelMap.Partial, "; ") + "]" : "";
            sb.Append($"{m.Class}.{m.Member} : {m.Type}{part} — {rule?.Code.ToString() ?? "?"}: {rule?.Text ?? "(no rule)"}\n");
        }
        return sb.ToString();
    }

    static void Write(string path, string content)
    {
        if (Writing)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, content);
            return;
        }
        Assert.True(File.Exists(path), $"{path} is missing; {Regenerate}");
        var have = File.ReadAllText(path).Replace("\r\n", "\n");
        Assert.True(have == content, $"{Path.GetFileName(path)} is not what the schema gives; {Regenerate}");
    }
}
