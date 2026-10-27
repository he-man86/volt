using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Volt.Engine.Format.Network;

namespace Volt.Tests.Shared;

/// <summary>
/// THE SHARED NETWORK-TEXT CASE SET (openspec <c>ld-fbd-coverage</c> design "2R.3"): <c>test/fixtures/network-text/</c>,
/// <c>accept/*.cases</c> (a text and the model it reads to) and <c>refuse/*.cases</c> (a text and the refusal it gets),
/// read by this suite and by the LSP's (<c>packages/volt-lsp-iec/src/frontend/types/network/network-cases.test.ts</c>) —
/// one source, so "the LSP refuses while typing what a push would refuse" is a parity both suites check, not two lists
/// kept in step by hand. A case one side accepts and the other refuses fails both.
///
/// <code>
///   #### name — one line: what the case pins, and the rule (B1 … B8, P1 … P13)
///   === scope            optional: `instance t1 TON`, `pou f`, `name x` — the declarations the body sees
///   === text             the body, its %LANGUAGE line first
///   === model            accept: the model it reads to (NetworkModelDump)
///   === canonical        accept, optional: the text the writer gives back where the case's text is not it
///   === refused          refuse: `CODE phrase` — the code and a phrase the refusal's message holds
/// </code>
/// </summary>
public sealed record NetworkTextCase(string File, string Name, string Text, string? Model, string? Canonical,
                                     string? RefusedCode, string? RefusedPhrase, IReadOnlyList<string> Scope)
{
    public bool Accept => RefusedCode is null;
    public override string ToString() => System.IO.Path.GetFileNameWithoutExtension(File) + "/" + Name;

    /// <summary>The scope the case's body is read against: its declared instances and POUs, and every name it spells.</summary>
    public NetworkScope ScopeOf()
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var pous = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var instances = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in Scope)
        {
            var w = line.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
            if (w.Length == 0) continue;
            switch (w[0])
            {
                case "instance" when w.Length == 3: instances[w[1]] = w[2]; break;
                case "pou" when w.Length == 2: pous.Add(w[1]); break;
                case "name" when w.Length >= 2: foreach (var n in w.Skip(1)) names.Add(n); break;
                default: throw new InvalidDataException($"{this}: a scope line is `instance <name> <type>`, `pou <name>` or `name <n>…`, not '{line}'.");
            }
        }
        return new NetworkScope(names, pous, instances);
    }
}

public static class NetworkTextCases
{
    public static string Root() => Path.Combine(CorpusProjects.CliRoot().FullName, "test", "fixtures", "network-text");

    public static IReadOnlyList<NetworkTextCase> All() =>
        Directory.EnumerateFiles(Root(), "*.cases", SearchOption.AllDirectories)
            .OrderBy(f => f, StringComparer.Ordinal)
            .SelectMany(Read)
            .ToList();

    public static IEnumerable<NetworkTextCase> Read(string file)
    {
        var accept = Path.GetFileName(Path.GetDirectoryName(file)) == "accept";
        var lines = File.ReadAllText(file).Replace("\r\n", "\n").Split('\n');
        string? name = null;
        string? section = null;
        var sections = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        var cases = new List<NetworkTextCase>();

        void Flush()
        {
            if (name is null) return;
            string? Get(string s) => sections.TryGetValue(s, out var l) ? string.Join("\n", TrimBlank(l)) : null;
            var text = Get("text") ?? throw new InvalidDataException($"{file}: the case '{name}' has no === text.");
            string? code = null, phrase = null;
            if (Get("refused") is { } refused)
            {
                var sp = refused.Trim().IndexOf(' ');
                code = sp < 0 ? refused.Trim() : refused.Trim().Substring(0, sp);
                phrase = sp < 0 ? null : refused.Trim().Substring(sp + 1).Trim();
            }
            if (accept && (code is not null || Get("model") is null))
                throw new InvalidDataException($"{file}: the accept case '{name}' states a model and no refusal.");
            if (!accept && code is null)
                throw new InvalidDataException($"{file}: the refuse case '{name}' states its refusal (=== refused CODE phrase).");
            cases.Add(new NetworkTextCase(file, name, text + "\n", Get("model"), Get("canonical") is { } c ? c + "\n" : null, code, phrase,
                sections.TryGetValue("scope", out var sc) ? sc.Where(l => l.Trim().Length > 0).Select(l => l.Trim()).ToList() : Array.Empty<string>()));
        }

        foreach (var line in lines)
        {
            if (line.StartsWith("#### ", StringComparison.Ordinal))
            {
                Flush();
                var head = line.Substring(5).Trim();
                var dash = head.IndexOf(" — ", StringComparison.Ordinal);
                name = dash < 0 ? head : head.Substring(0, dash).Trim();
                section = null;
                sections = new Dictionary<string, List<string>>(StringComparer.Ordinal);
                continue;
            }
            if (line.StartsWith("=== ", StringComparison.Ordinal))
            {
                section = line.Substring(4).Trim();
                sections[section] = new List<string>();
                continue;
            }
            if (section is not null) sections[section].Add(line);
        }
        Flush();
        var dup = cases.GroupBy(c => c.Name).FirstOrDefault(g => g.Count() > 1);
        if (dup is not null) throw new InvalidDataException($"{file}: two cases named '{dup.Key}'.");
        return cases;
    }

    private static IEnumerable<string> TrimBlank(List<string> lines)
    {
        var start = 0;
        var end = lines.Count;
        while (start < end && lines[start].Trim().Length == 0) start++;
        while (end > start && lines[end - 1].Trim().Length == 0) end--;
        return lines.Skip(start).Take(end - start);
    }
}
