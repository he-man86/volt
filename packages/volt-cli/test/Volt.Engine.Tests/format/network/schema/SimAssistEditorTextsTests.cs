using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Volt.Engine.Format.Network;
using Volt.Engine.Item;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Engine.Tests.Format.Network.Schema;

/// <summary>
/// The texts Sim-Assist's LD/FBD editor tests produce (openspec <c>nwl-schema-completeness-gate</c> 1.2), committed as
/// <c>test/fixtures/nwl-schema/sim-assist-editor-texts.v1.jsonl</c>: each body goes text → model → text through the
/// reader and the writer and either writes back as itself or is refused by name. A text that reads and writes back
/// differently is a second spelling, and fails here naming it.
///
/// <para>"As itself" is up to layout: a blank line or a run of spaces between tokens is no spelling (the writer puts one
/// space and no blank line). Every refusal is one the table below expects, each citing why the text is not network
/// text: an older spelling a design replaced, or a text the editor should not produce (listed for Sim-Assist).</para>
/// </summary>
public class SimAssistEditorTextsTests(Xunit.Abstractions.ITestOutputHelper output)
{
    static string Path_ => Path.Combine(Path.GetDirectoryName(NwlSchemaCensus.FixturePath)!, "sim-assist-editor-texts.v1.jsonl");

    /// <summary>The expected refusals: what the reader names, and the decision or the editor defect behind it.</summary>
    static readonly (string Names, string Why)[] Expected =
    {
        ("a (* comment in the code",
            "(a) an inline ST comment: a network's comment is its // lines before the code, and an operand's is COMMENT(a, 'why') (nwl-schema-completeness-gate, operand comment)"),
        ("a // comment after the code starts",
            "(a) a trailing // comment: as above, COMMENT(a, 'why') or the network's // lines (nwl-schema-completeness-gate, operand comment)"),
        ("is read and names no output",
            "(a) an FB box read with no output named: a box with several outputs is closed by the one its consumer reads, t1(…).Q (network-output-member)"),
        ("is the body's w",
            "(c) the editor names wires out of order: wires are w1, w2, … across the body in the order the text first names them (network-text-st, wire numbering)"),
        ("an edge mark on the coil",
            "(c) the editor's edge command marks a coil: the IDE runs it unmarked, measured live (openspec nwl-box-storage-map); the edge is on the value, y := RISING(a)"),
        ("a bracket that groups nothing",
            "(c) the editor brackets one operand or a chain nothing tighter holds: a bracket groups a chain inside a tighter or the same chain"),
    };

    const string TonDeclaration =
        "FUNCTION_BLOCK TON\nVAR_INPUT\n\tIN : BOOL;\n\tPT : TIME;\nEND_VAR\nVAR_OUTPUT\n\tQ : BOOL;\n\tET : TIME;\nEND_VAR\nEND_FUNCTION_BLOCK";

    public sealed record Text(int Line, string Op, string Declaration, string Body);

    public static IReadOnlyList<Text> Texts()
    {
        var lines = File.ReadAllLines(Path_);
        Assert.Contains("\"volt\":\"a292dd0f66\"", lines[0]);
        var texts = new List<Text>();
        for (var n = 1; n < lines.Length; n++)
        {
            var o = JsonNode.Parse(lines[n])!;
            var all = o["text"]!.GetValue<string>().Replace("\r\n", "\n").Split('\n');
            var lang = Array.FindIndex(all, x => x.StartsWith("%LANGUAGE", StringComparison.Ordinal));
            var end = Array.FindLastIndex(all, x => x.StartsWith("END_", StringComparison.Ordinal));
            Assert.True(lang > 0 && end > lang, $"line {n + 1}: no declaration, %LANGUAGE line and END_ around the body");
            texts.Add(new(n + 1, o["op"]!.GetValue<string>(), string.Join("\n", all.Take(lang)),
                string.Join("\n", all.Skip(lang).Take(end - lang)) + "\n"));
        }
        return texts;
    }

    /// <summary>The body's own declaration, and TON — the one library FB the editor's fixtures declare — by its
    /// standard interface.</summary>
    static NetworkScope ScopeOf(string declaration) =>
        NetworkScope.FromDeclarations(declaration, n => Is(n, "TON") ? TonDeclaration : null, () => Array.Empty<string>(),
            n => Is(n, "TON") ? ItemKind.Kinds.Pou : null, Scopes.RefusedPouName, Scopes.NoLibrary);

    static bool Is(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);

    /// <summary>The text with its layout dropped: no blank line, no trailing blank, one space for every run.</summary>
    static string Layout(string s) => Regex.Replace(Regex.Replace(s, @"[ \t]+", " "), @" ?\n[\s]*", "\n").Trim();

    [Fact]
    public void Every_editor_text_writes_back_as_itself_or_is_refused_by_a_cited_name()
    {
        var failures = new List<string>();
        var refused = new Dictionary<string, int>();
        var verdicts = new StringBuilder("# the bridge reader's verdict on each line of sim-assist-editor-texts.v1.jsonl (the LSP's test compares its own); " +
            "regenerate with VOLT_WRITE_NWL_SHAPES=1 dotnet test test/Volt.Engine.Tests --filter SimAssistEditorTextsTests\n");
        foreach (var t in Texts())
        {
            var scope = ScopeOf(t.Declaration);
            try
            {
                var back = StNetworkWriter.Write(StNetworkReader.Read(t.Body, scope), scope);
                if (Layout(back) != Layout(t.Body))
                    failures.Add($"line {t.Line} ({t.Op}) has a second spelling:\n{t.Body}-- writes back as --\n{back}");
                verdicts.Append(t.Line).Append(" accept\n");
            }
            catch (StNetworkReadException e)
            {
                var why = Expected.FirstOrDefault(x => e.Message.Contains(x.Names, StringComparison.Ordinal)).Why;
                if (why is null) failures.Add($"line {t.Line} ({t.Op}) is refused for no cited reason: {e.Message}\n{t.Body}");
                else refused[why] = refused.GetValueOrDefault(why) + 1;
                verdicts.Append(t.Line).Append(" refuse ").Append(e.Message).Append('\n');
            }
        }
        Assert.True(failures.Count == 0, $"{failures.Count} editor texts:\n" + string.Join("\n\n", failures.Take(20)));
        output.WriteLine($"{Texts().Count - refused.Values.Sum()} write back as themselves; " + string.Join("; ", refused.Select(r => $"{r.Value} {r.Key}")));
        // every expected refusal still occurs: a reason that no longer refuses anything is a stale entry
        Assert.All(Expected, x => Assert.True(refused.ContainsKey(x.Why), $"no text is refused any more for: {x.Why}"));
        var path = Path.ChangeExtension(Path_, ".verdicts.txt");
        if (Environment.GetEnvironmentVariable("VOLT_WRITE_NWL_SHAPES") == "1") File.WriteAllText(path, verdicts.ToString());
        Assert.True(File.Exists(path) && File.ReadAllText(path).Replace("\r\n", "\n") == verdicts.ToString(),
            $"{Path.GetFileName(path)} is not the reader's verdicts; regenerate with VOLT_WRITE_NWL_SHAPES=1");
    }
}
