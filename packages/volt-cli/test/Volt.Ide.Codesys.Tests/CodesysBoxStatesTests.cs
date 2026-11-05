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
/// WHAT A PULL DOES WITH EVERY STORED BOX STATE (openspec <c>nwl-box-storage-map</c>). The recording
/// <c>test/fixtures/nwl-schema/box-states.3.5.21.40.json</c> holds one row per state measured on a live CODESYS: the members as
/// stored, then what the IDE made of them (build messages, what a simulation run wrote, the editor's layout). Here each row
/// is laid over the doubles, read by the shipped reader and written by the shipped writer. The live twin, over the same rows,
/// is <c>test/e2e/graphical/nwl-box-states.test.ts</c>.
/// <list type="bullet">
/// <item>a pull that changes is a failure: <see cref="Every_state_pulls_as_recorded"/>;</item>
/// <item>two states the IDE builds or runs apart must never pull alike: <see cref="No_two_states_that_build_or_run_apart_pull_alike"/>;</item>
/// <item>two that the editor draws apart and still pull alike lose their picture: each is named in
/// <c>box-states.picture-losses.txt</c>, the gap list for the owner, so a new one fails: <see cref="Every_lost_picture_is_named"/>.</item>
/// </list>
/// <c>VOLT_WRITE_BOX_STATES=1</c> rewrites the rows' <c>pull</c> and the loss list; read the diff, never re-pin blind.
/// </summary>
public class CodesysBoxStatesTests
{
    static string Dir => Path.Combine(CorpusProjects.CliRoot().FullName, "test", "fixtures", "nwl-schema");
    static string RecordingFile => Path.Combine(Dir, "box-states.3.5.21.40.json");
    static string LossFile => Path.Combine(Dir, "box-states.picture-losses.txt");
    static bool Writing => Environment.GetEnvironmentVariable("VOLT_WRITE_BOX_STATES") == "1";

    sealed class Row
    {
        public string Id = "", Kind = "", Language = "", Position = "", BoxType = "", CallType = "", Pull = "", Build = "", Layout = "";
        public string? Instance, Target, Run;
        public bool? En, Eno;
        public bool Extensible, Snippet;
        public int? InputFlagsLength;
        public List<string> Flags = new(), InputNames = new(), InputTypes = new(), OutputNames = new(), OutputTypes = new();
        public List<string?> Inputs = new(), Outputs = new();
        public bool Builds => Build.Length == 0;
        public string ListText => "[" + string.Join(",", Outputs.Select(o => o is null ? "null" : "'" + o + "'")) + "]";
    }

    static readonly Lazy<(JsonDocument Doc, List<Row> Rows)> Recording = new(() =>
    {
        var doc = JsonDocument.Parse(File.ReadAllText(RecordingFile));
        var rows = new List<Row>();
        foreach (var r in doc.RootElement.GetProperty("states").EnumerateArray())
        {
            static string? S(JsonElement e) => e.ValueKind == JsonValueKind.Null ? null : e.GetString();
            static bool? B(JsonElement e) => e.ValueKind == JsonValueKind.Null ? null : e.GetBoolean();
            static List<string> Ls(JsonElement e) => e.EnumerateArray().Select(x => x.GetString()!).ToList();
            static List<string?> Ln(JsonElement e) => e.EnumerateArray().Select(x => S(x)).ToList();
            var m = r.GetProperty("measured");
            rows.Add(new Row
            {
                Id = r.GetProperty("id").GetString()!,
                Kind = r.GetProperty("kind").GetString()!,
                Language = r.GetProperty("language").GetString()!,
                Position = r.GetProperty("position").GetString()!,
                BoxType = r.GetProperty("boxType").GetString()!,
                Instance = S(r.GetProperty("instance")),
                Target = S(r.GetProperty("target")),
                CallType = r.GetProperty("callType").GetString()!,
                En = B(r.GetProperty("en")),
                Eno = B(r.GetProperty("eno")),
                Flags = Ls(r.GetProperty("flags")),
                InputFlagsLength = r.GetProperty("inputFlagsLength").ValueKind == JsonValueKind.Null ? null : r.GetProperty("inputFlagsLength").GetInt32(),
                Inputs = Ln(r.GetProperty("inputs")),
                InputNames = Ls(r.GetProperty("inputNames")),
                InputTypes = Ls(r.GetProperty("inputTypes")),
                Outputs = Ln(r.GetProperty("outputs")),
                OutputNames = Ls(r.GetProperty("outputNames")),
                OutputTypes = Ls(r.GetProperty("outputTypes")),
                Extensible = r.GetProperty("extensible").GetBoolean(),
                Snippet = r.GetProperty("snippet").GetBoolean(),
                Pull = r.TryGetProperty("pull", out var pull) ? pull.GetString()! : "",
                Build = string.Join("; ", m.GetProperty("build").EnumerateArray().Select(x => x.GetString()!).Where(x => x.Contains(" Error ") || x.Contains("Error "))),
                Run = S(m.GetProperty("run")),
                Layout = m.GetProperty("layout").ValueKind == JsonValueKind.Null ? "" : m.GetProperty("layout").GetString()!,
            });
        }
        return (doc, rows);
    });

    static NetworkScope Scope(JsonElement root)
    {
        var callees = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var c in root.GetProperty("callees").EnumerateObject()) callees[c.Name] = c.Value.GetProperty("declaration").GetString()!;
        var own = string.Format(root.GetProperty("holder").GetString()!.Replace("%s", "{0}"), "Holder");
        return NetworkScope.FromDeclarations(own, n => callees.TryGetValue(n, out var d) ? d : null,
            () => Array.Empty<string>(), n => callees.ContainsKey(n) ? ItemKind.Kinds.Pou : null, Scopes.RefusedPouName, _ => null);
    }

    /// <summary>The stored box of a row, in the doubles the reader's reflection walks.</summary>
    static object Stored(Row r)
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = r.BoxType,
            Instance = new Nwl.Operand { OperandExpr = r.Instance! },
            CallType = Enum.TryParse<Nwl.Operator>(r.CallType, out var call) ? call : Nwl.Operator.And,
            ContainsExtensibleInputs = r.Extensible,
            En = r.En,
            Eno = r.Eno,
            InputItemList = r.Inputs.Select(i => (object)Nwl.Leaf(i ?? "")).ToArray(),
            InputParams = new Nwl.ParamList { Names = r.InputNames.ToArray(), Types = r.InputTypes.ToArray() },
            OutputParams = new Nwl.ParamList { Names = r.OutputNames.ToArray(), Types = r.OutputTypes.ToArray() },
            MainOutputIndex = r.Outputs.IndexOf(null) is var main && main >= 0 ? main : null,
            ProvidesSTSnippetAnswer = string.Equals(r.BoxType, "execute", StringComparison.OrdinalIgnoreCase),
            Flags = new Nwl.Flags
            {
                Negation = r.Flags.Contains("Negation"), Set = r.Flags.Contains("Set"), Jump = r.Flags.Contains("Jump"),
                Return = r.Flags.Contains("Return"), Rtrig = r.Flags.Contains("Rtrig"), Ftrig = r.Flags.Contains("Ftrig"),
            },
        };
        if (r.InputFlagsLength is { } flags) box.InputFlags = Enumerable.Range(0, flags).Select(_ => (object)new Nwl.Flags()).ToArray();
        foreach (var o in r.Outputs) box.Outputs.AppendOutputItem(o is null ? null! : new Nwl.Operand { OperandExpr = o });
        if (r.Snippet)
        {
            var st = new _3S.CoDeSys.STObject.STImplementationObject();
            Nwl.TextDocument.ThrowsAfterInsert = false;
            try { st.TextDocument.Insert(0, "m := 1;"); }
            finally { Nwl.TextDocument.ThrowsAfterInsert = true; }
            box.STSnippet = new Nwl.STSnippet { Snippet = st };
        }
        if (r.Position != "consumed") return box;
        var assign = new Nwl.BoxTreeAssign { RValue = box };
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = r.Target!, IsLValue = true });
        return assign;
    }

    /// <summary>The body lines a pull shows for the row's one network, the language and network lines left out.</summary>
    static string Pulled(Row r, NetworkScope scope)
    {
        var language = r.Language == "LD" ? BodyLanguage.Ld : BodyLanguage.Fbd;
        var shown = CodesysNetworkReader.ReadNetworkShown(new Nwl.Network().With(Stored(r)), 0);
        var text = StNetworkWriter.WritePulled(new NetworkBody(language, new[] { shown }), scope);
        return string.Join(" / ", text.Replace("\r\n", "\n").Split('\n').Skip(1).Where(l => l.Trim().Length > 0 && l != "%NETWORK"));
    }

    static bool Refused(string pull) => pull.StartsWith("%UNSUPPORTED", StringComparison.Ordinal);

    [Fact]
    public void Every_state_pulls_as_recorded()
    {
        var (doc, rows) = Recording.Value;
        var scope = Scope(doc.RootElement);
        var pulled = rows.ToDictionary(r => r.Id, r =>
        {
            try { return Pulled(r, scope); }
            catch (Exception e) { return "THROWS " + e.GetType().Name + ": " + e.Message; }
        });
        if (Writing)
        {
            // the rows' `pull`, written in place of the old value: every other byte of the recording stands
            var text = File.ReadAllText(RecordingFile);
            var written = new StringBuilder();
            var at = 0;
            foreach (var r in rows)
            {
                var id = text.IndexOf("\"id\": \"" + r.Id + "\"", at, StringComparison.Ordinal);
                Assert.True(id >= 0, r.Id);
                var pull = text.IndexOf("\"pull\": ", id, StringComparison.Ordinal);
                var end = text.IndexOf('\n', pull);
                written.Append(text, at, pull - at).Append("\"pull\": ").Append(JsonSerializer.Serialize(pulled[r.Id])).Append(text[end - 1] == ',' ? "," : "");
                at = end;
            }
            written.Append(text, at, text.Length - at);
            File.WriteAllText(RecordingFile, written.ToString());
            return;
        }
        Assert.Empty(rows.Where(r => pulled[r.Id] != r.Pull).Select(r => $"{r.Id} {r.Kind} {r.Language} {r.Position} {r.ListText}: pulled '{pulled[r.Id]}', recorded '{r.Pull}'").Take(20));
    }

    /// <summary>The states that hold one pull text and differ in whether the IDE builds them or in what the build runs: a push of
    /// that text would be another program than one of them. Left out: a run nothing read, and a CallType other than the one the
    /// editor derives from the callee, which only the object model can store (no IDE command writes one, design.md) and which the
    /// reader, having no callee, cannot compare.</summary>
    [Fact]
    public void No_two_states_that_build_or_run_apart_pull_alike()
    {
        var (_, rows) = Recording.Value;
        var apart = rows.Where(r => !Refused(r.Pull) && !r.Kind.StartsWith("calltype ", StringComparison.Ordinal) && (r.Run is not null || !r.Builds))
            .GroupBy(r => (r.Language, r.Pull))
            .Where(g => g.Select(r => r.Builds ? "runs " + r.Run : "does not build").Distinct().Count() > 1)
            .Select(g => $"'{g.Key.Pull}' ({g.Key.Language}): " + string.Join(" | ", g.GroupBy(r => r.Builds ? "runs " + r.Run : "does not build").Select(x => x.Key + " <- " + string.Join(" ", x.Select(r => r.Id + r.ListText)))))
            .ToList();
        Assert.Empty(apart);
    }

    [Fact]
    public void Every_lost_picture_is_named()
    {
        var (_, rows) = Recording.Value;
        var lost = new List<string>();
        foreach (var g in rows.Where(r => !Refused(r.Pull) && r.Layout.Length > 0).GroupBy(r => (r.Language, r.Position, r.Pull)).OrderBy(g => g.Key.Pull, StringComparer.Ordinal).ThenBy(g => g.Key.Language, StringComparer.Ordinal))
        {
            var layouts = g.GroupBy(r => r.Layout).ToList();
            if (layouts.Count < 2) continue;
            lost.Add($"{g.Key.Language} {g.Key.Position} `{g.Key.Pull}`: " + string.Join(" / ", layouts.Select(l => string.Join(" = ", l.Select(r => r.ListText + (r.En is null ? " en=null" : "") + (r.Eno is null ? " eno=null" : "")).Distinct()))));
        }
        var known = "# Stored box states the editor draws apart and a pull shows alike (openspec nwl-box-storage-map): one line per pull text,\n# the stored lists of each drawing joined by =, the drawings by /. Generated by CodesysBoxStatesTests; regenerate with\n# VOLT_WRITE_BOX_STATES=1 and read the diff. Nothing here builds or runs apart (No_two_states_that_build_or_run_apart_pull_alike).\n" + string.Join("\n", lost) + "\n";
        if (Writing) { File.WriteAllText(LossFile, known); return; }
        Assert.Equal(File.ReadAllText(LossFile).Replace("\r\n", "\n"), known);
    }

    /// <summary>The faults stay in the recording: a state the IDE faults on is filed, never authored into the fixture.</summary>
    [Fact]
    public void The_states_the_IDE_faults_on_are_filed()
    {
        var (doc, rows) = Recording.Value;
        Assert.True(doc.RootElement.GetProperty("faults").GetArrayLength() > 0);
        Assert.NotEmpty(rows);
    }
}
