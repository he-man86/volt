using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using Volt.Engine.Format.Network;
using Volt.Engine.Item;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// WHAT A PULL DOES WITH EVERY STORED ASSIGN AND OPERAND STATE (openspec <c>ide-model-mapping</c> 2.1). The recording
/// <c>test/fixtures/nwl-schema/assign-states.3.5.21.40.json</c> holds one row per state measured on a live CODESYS: the body as
/// stored (each network's trees, every operand's members and flags), then what the IDE made of it (build messages, what a
/// simulation run with a changing input wrote, the editor's picture), and whether it came back after a save and a reopen.
/// Each state stands in the IDE-authored fixture <c>CodesysAssignStates.3.5.21.40.project</c>; the live twin over the same
/// rows is <c>test/e2e/graphical/nwl-assign-states.test.ts</c>. Here each state is laid over the doubles, read by the shipped
/// reader and written by the shipped writer: a pull that changes fails, naming the state.
/// <c>VOLT_WRITE_ASSIGN_STATES=1</c> rewrites the rows' <c>pull</c>; read the diff, never re-pin blind.
/// </summary>
public class CodesysAssignStatesTests
{
    static string Dir => Path.Combine(CorpusProjects.CliRoot().FullName, "test", "fixtures", "nwl-schema");
    static string RecordingFile => Path.Combine(Dir, "assign-states.3.5.21.40.json");
    static bool Writing => Environment.GetEnvironmentVariable("VOLT_WRITE_ASSIGN_STATES") == "1";

    static readonly Lazy<JsonDocument> Recording = new(() => JsonDocument.Parse(File.ReadAllText(RecordingFile)));

    static NetworkScope Scope(JsonElement root)
    {
        var callees = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var c in root.GetProperty("callees").EnumerateObject()) callees[c.Name] = c.Value.GetProperty("declaration").GetString()!;
        var own = string.Format(root.GetProperty("holder").GetString()!.Replace("%s", "{0}"), "Holder");
        return NetworkScope.FromDeclarations(own, n => callees.TryGetValue(n, out var d) ? d : null,
            () => Array.Empty<string>(), n => callees.ContainsKey(n) ? ItemKind.Kinds.Pou : null, Scopes.RefusedPouName, _ => null);
    }

    static string? S(JsonElement e) => e.ValueKind == JsonValueKind.Null ? null : e.GetString();
    static bool B(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    static Nwl.Flags? Flags(JsonElement e)
    {
        if (e.ValueKind == JsonValueKind.Null) return null;
        var bits = e.GetProperty("bits").EnumerateArray().Select(b => b.GetString()!).ToHashSet();
        var f = new Nwl.Flags
        {
            Negation = bits.Contains("Negation"), Set = bits.Contains("Set"), Jump = bits.Contains("Jump"),
            Return = bits.Contains("Return"), Rtrig = bits.Contains("Rtrig"), Ftrig = bits.Contains("Ftrig"),
        };
        f.Fixed = B(e, "fixed");
        return f;
    }

    static Nwl.Operand? Operand(JsonElement e)
    {
        if (e.ValueKind == JsonValueKind.Null) return null;
        return new Nwl.Operand
        {
            OperandExpr = S(e.GetProperty("expr"))!,
            Type = S(e.GetProperty("type")) ?? "",
            Comment = S(e.GetProperty("comment")) ?? "",
            StoredSymbolComment = S(e.GetProperty("symbolComment")) ?? "",
            StoredAddress = S(e.GetProperty("address")) ?? "",
            Boolean = B(e, "boolean"),
            IsLValue = B(e, "lvalue"),
            IsInstance = B(e, "isInstance"),
            Flags = Flags(e.GetProperty("flags")),
        };
    }

    static object? Tree(JsonElement e)
    {
        if (e.ValueKind == JsonValueKind.Null) return null;
        switch (e.GetProperty("t").GetString())
        {
            case "leaf":
                return new Nwl.BoxTreeOperand { Operand = Operand(e.GetProperty("op"))! };
            case "assign":
            {
                var a = new Nwl.BoxTreeAssign { RValue = Tree(e.GetProperty("rvalue")), Flags = Flags(e.GetProperty("flags")) };
                foreach (var o in e.GetProperty("outputs").EnumerateArray()) a.Outputs.List.Add(Operand(o)!);
                return a;
            }
            case "terminator":
                return new Nwl.BoxTreeTerminator { Input = Tree(e.GetProperty("input")), Flags = Flags(e.GetProperty("flags")) };
            case "box":
            {
                static bool? Nb(JsonElement v) => v.ValueKind switch { JsonValueKind.True => true, JsonValueKind.False => false, _ => null };
                static string[] Ls(JsonElement v) => v.EnumerateArray().Select(x => x.GetString()!).ToArray();
                var outputs = e.GetProperty("outputs").EnumerateArray().Select(Operand).ToList();
                var box = new Nwl.BoxTreeBox
                {
                    BoxType = e.GetProperty("boxType").GetString()!,
                    Instance = Operand(e.GetProperty("instance")) ?? new Nwl.Operand { OperandExpr = null! },
                    CallType = (Nwl.Operator)Enum.Parse(typeof(Nwl.Operator), e.GetProperty("callType").GetString()!),
                    En = Nb(e.GetProperty("en")),
                    Eno = Nb(e.GetProperty("eno")),
                    InputItemList = e.GetProperty("inputs").EnumerateArray().Select(i => Tree(i)!).ToArray(),
                    InputParams = new Nwl.ParamList { Names = Ls(e.GetProperty("inputNames")), Types = Ls(e.GetProperty("inputTypes")) },
                    OutputParams = new Nwl.ParamList { Names = Ls(e.GetProperty("outputNames")), Types = Ls(e.GetProperty("outputTypes")) },
                    MainOutputIndex = outputs.IndexOf(null) is var main && main >= 0 ? main : null,
                    ProvidesSTSnippetAnswer = false,
                    Flags = Flags(e.GetProperty("flags")),
                };
                if (e.GetProperty("inputFlags").ValueKind != JsonValueKind.Null)
                    box.InputFlags = e.GetProperty("inputFlags").EnumerateArray().Select(f => (object)Flags(f)!).ToArray();
                foreach (var o in outputs) box.Outputs.AppendOutputItem(o!);
                return box;
            }
            default:
                throw new InvalidOperationException("the recording holds a tree these doubles do not describe: " + e.GetProperty("t").GetString());
        }
    }

    /// <summary>The body lines a pull shows for the state, the language and network lines left out, as the live twin reads them.</summary>
    static string Pulled(JsonElement state, NetworkScope scope)
    {
        var language = state.GetProperty("language").GetString() == "LD" ? BodyLanguage.Ld : BodyLanguage.Fbd;
        var shown = state.GetProperty("stored").EnumerateArray().Select((n, i) =>
        {
            var net = new Nwl.Network { Label = n.GetProperty("label").GetString() ?? "" }.With(n.GetProperty("trees").EnumerateArray().Select(t => Tree(t)!).ToArray());
            return CodesysNetworkReader.ReadNetworkShown(net, i);
        }).ToArray();
        var text = StNetworkWriter.WritePulled(new NetworkBody(language, shown), scope);
        return string.Join(" / ", text.Replace("\r\n", "\n").Split('\n').Skip(1).Where(l => l.Trim().Length > 0 && l != "%NETWORK"));
    }

    [Fact]
    public void Every_state_pulls_as_recorded()
    {
        var root = Recording.Value.RootElement;
        var scope = Scope(root);
        var states = root.GetProperty("states").EnumerateArray().ToList();
        var pulled = states.ToDictionary(s => s.GetProperty("id").GetString()!, s =>
        {
            try { return Pulled(s, scope); }
            catch (Exception e) { return "THROWS " + e.GetType().Name + ": " + e.Message; }
        });
        if (Writing)
        {
            var text = File.ReadAllText(RecordingFile);
            var written = new StringBuilder();
            var at = 0;
            foreach (var s in states)
            {
                var id = s.GetProperty("id").GetString()!;
                var start = text.IndexOf("\"id\": \"" + id + "\"", at, StringComparison.Ordinal);
                Assert.True(start >= 0, id);
                var pull = text.IndexOf("\"pull\": ", start, StringComparison.Ordinal);
                var end = text.IndexOf('\n', pull);
                written.Append(text, at, pull - at).Append("\"pull\": ").Append(JsonSerializer.Serialize(pulled[id])).Append(text[end - 1] == ',' ? "," : "");
                at = end;
            }
            written.Append(text, at, text.Length - at);
            File.WriteAllText(RecordingFile, written.ToString());
            return;
        }
        Assert.Empty(states.Where(s => pulled[s.GetProperty("id").GetString()!] != s.GetProperty("pull").GetString())
            .Select(s => $"{s.GetProperty("id").GetString()} {s.GetProperty("language").GetString()} {s.GetProperty("what").GetString()}: pulled '{pulled[s.GetProperty("id").GetString()!]}', recorded '{s.GetProperty("pull").GetString()}'").Take(20));
    }

    /// <summary>Two states that build or run apart must never pull alike: a push of that text would be another program. Runs are
    /// compared only between states the driver observed through the same variables (a run string names them): an S coil is
    /// watched from FALSE, an R coil from TRUE, so their counts are not the same measurement.</summary>
    [Fact]
    public void No_two_states_that_build_or_run_apart_pull_alike()
    {
        var states = Recording.Value.RootElement.GetProperty("states").EnumerateArray()
            .Where(s => !s.GetProperty("pull").GetString()!.StartsWith("%UNSUPPORTED", StringComparison.Ordinal) && s.GetProperty("measured").GetProperty("run").ValueKind != JsonValueKind.Null)
            .Select(s => (Id: s.GetProperty("id").GetString()!, Language: s.GetProperty("language").GetString()!, Pull: s.GetProperty("pull").GetString()!,
                Outcome: s.GetProperty("measured").GetProperty("build").EnumerateArray().Any(m => m.GetString()!.Contains(" Error ", StringComparison.Ordinal))
                    ? "does not build" : "runs " + s.GetProperty("measured").GetProperty("run").GetString()))
            .ToList();
        static string Watched(string outcome) => string.Join(" ", System.Text.RegularExpressions.Regex.Matches(outcome, @"(\w+)=")
            .Cast<System.Text.RegularExpressions.Match>().Select(m => m.Groups[1].Value));
        var apart = states.GroupBy(s => (s.Language, s.Pull))
            .Where(g => g.Select(s => s.Outcome == "does not build").Distinct().Count() > 1
                || g.Where(s => s.Outcome != "does not build").GroupBy(s => Watched(s.Outcome)).Any(w => w.Select(s => s.Outcome).Distinct().Count() > 1))
            .Select(g => $"'{g.Key.Pull}' ({g.Key.Language}): " + string.Join(" | ", g.GroupBy(s => s.Outcome).Select(x => x.Key + " <- " + string.Join(" ", x.Select(s => s.Id)))));
        Assert.Empty(apart);
    }
}
