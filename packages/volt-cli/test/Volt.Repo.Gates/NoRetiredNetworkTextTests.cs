using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text.RegularExpressions;
using Xunit;

namespace Volt.Repo.Gates;

/// <summary>
/// NETWORK TEXT IS WRITTEN IN THE NETWORK LANGUAGE, EVERYWHERE THE REPO SHOWS IT (openspec <c>network-language</c>;
/// <c>docs/network-text.html</c>). The forms the push refuses — a coil, jump or return as an assignment, <c>S=</c> /
/// <c>R=</c>, a coil inside a value, <c>.ENO</c>, a mark written as a word, a box written infix, the
/// <c>IMPLEMENTATION</c> line, a <c>WIRE:</c> line — stay out of every place that shows network text: the doc, the
/// accepted cases, the live suites, the corpus bodies, the VS Code grammar's tests, and the open openspec changes. Each
/// finding names <c>file:line</c>.
///
/// <para>The forms are the refusals of the bridge's reader (<c>StNetworkReader</c>, its messages "… is no network text")
/// and of the language server (<c>volt-lsp-iec/src/frontend/syntax/network/retired.ts</c>). Neither can be referenced
/// from here (this project references no package), so each form below carries the phrase its refusal says, and
/// <see cref="Each_form_is_one_the_readers_refuse"/> holds the two lists together: every form matches a case of the
/// shared refusal set (<c>test/fixtures/network-text-st/refuse</c>, run by both readers' suites) and its phrase stands
/// in the reader that raises it.</para>
/// </summary>
public class NoRetiredNetworkTextTests
{
    /// <summary>A retired form: what it is, the pattern on one statement line of network text, whether it needs network
    /// context, and where its refusal is said — each source (relative to the repo root) and the phrase it holds.</summary>
    public sealed record Form(string What, Regex Pattern, bool InNetwork, params (string File, string Phrase)[] Said);

    private const string Reader = "packages/volt-cli/src/Volt.Engine/Format/Network/StNetworkReader.cs";
    private const string Retired = "packages/volt-lsp-iec/src/frontend/syntax/network/retired.ts";
    private const string Receivers = "packages/volt-lsp-iec/src/frontend/syntax/network/receivers.ts";
    private const string PlainSt = "packages/volt-lsp-iec/src/analysis/checks/network/_plain-st.ts";
    private const string NetworkBox = "packages/volt-lsp-iec/src/frontend/types/infer/network-box.ts";
    private const string LanguageLine = "packages/volt-cli/src/Volt.Engine/Format/St/PropertyLines.Language.cs";
    private const string LspLanguageLine = "packages/volt-lsp-iec/src/frontend/syntax/format/object-properties.ts";

    private static Regex R(string p) => new(p, RegexOptions.CultureInvariant);

    /// <summary>THE RETIRED FORMS. A coil's receiver is any name but a wire of its network (a wire's definition, <c>w1 :=
    /// …</c>, is network text); a mark word stands before a value, a pin or a receiver; an infix word is a box. A
    /// <c>WIRE:</c> line is no statement either reader knows, so no message names it.</summary>
    public static readonly Form[] Forms =
    {
        new("a jump or the return as an assignment target", R(@"^\s*(JMP\.[\w?]+|RETURN)\s*:="), true,
            (Reader, "a jump or a return is a target of an"), (Receivers, "a jump or a return is a target of an ASSIGN")),
        new("a set coil, y S= a", R(@"^\s*[\w.?\[\]]+\s+S=\s"), true,
            (Reader, "y S= value is no network text"), (Retired, "y S= value is no network text")),
        new("a reset coil, y R= a", R(@"^\s*[\w.?\[\]]+\s+R=\s"), true,
            (Reader, "y R= value is no network text"), (Retired, "y R= value is no network text")),
        new("a coil as an assignment, y := a", R(@"^\s*(?<name>[\w.?\[\]]+)\s*:=\s*[^\s;]"), true,
            (Reader, "y := value is no network text"), (Retired, "y := value is no network text")),
        new("a coil inside a value, (y := a)", R(@"(?<![\w\]\)}^])\(\s*(?<name>[\w.?]+)\s*:="), true,
            (Reader, "(y := value) is no network text"), (Retired, "(y := value) is no network text")),
        new(".ENO", R(@"\.ENO\b"), true,
            (Reader, ".ENO is no network text"), (NetworkBox, ".ENO is no network text")),
        new("a mark written as a word, NOT a", R(@"(?<![\w.])(NOT|RISING|FALLING)\s+(:=|[\w.?]+\s*([;,)]|:=|\b(AND|OR)\b))"), true,
            (Reader, "a mark is a function around a value"), (Receivers, "a mark is a function around a value")),
        new("a box written infix, a XOR b", R(@"[\w)]\s+(XOR|MOD|ADD|SUB|MUL|DIV|GT|GE|LT|LE|EQ|NE)\s+[\w(]"), true,
            (Reader, "in a network every box is a call"), (PlainSt, "in a network every box is a call")),
        new("the IMPLEMENTATION line", R(@"^\s*IMPLEMENTATION\s+(ST|LD|FBD|IL|SFC|CFC)\b"), false,
            (LanguageLine, "IMPLEMENTATION"), (LspLanguageLine, "IMPLEMENTATION")),
        new("a WIRE: line", R(@"^\s*WIRE:"), false),
    };

    /// <summary>WHERE NETWORK TEXT IS SHOWN (relative to the repo root; a directory is scanned for the extensions given).</summary>
    private static readonly (string Path, string[] Extensions)[] Places =
    {
        ("packages/volt-cli/docs/network-text.html", Array.Empty<string>()),
        ("packages/volt-cli/test/fixtures/network-text-st/accept", new[] { ".cases" }),
        ("packages/volt-cli/test/e2e", new[] { ".ts" }),
        ("packages/volt-lsp-iec/test-corpus", new[] { ".pou" }),
        ("packages/volt-vscode/src", new[] { ".test.ts" }),
        ("openspec/changes", new[] { ".md" }),
    };

    /// <summary>THE ALLOWLIST: a line that quotes a retired form as the refusal a push gives today — the file, and a piece of
    /// the line. Each entry must still match a finding (a stale entry fails).</summary>
    private static readonly (string File, string Line)[] Allowed =
    {
        // the doc's error table: each row shows the text a push refuses
        ("packages/volt-cli/docs/network-text.html", "a coil, jump or return not written as"),
        ("packages/volt-cli/docs/network-text.html", "a mark written as a word"),
        ("packages/volt-cli/docs/network-text.html", "a box written infix"),
        ("packages/volt-cli/docs/network-text.html", "<code>.ENO</code> or <code>ENO =></code>"),
    };

    [Fact]
    public void No_place_that_shows_network_text_writes_a_retired_form()
    {
        var root = NoCodeCheckLeftTests.RepoRoot();
        var findings = Files(root).SelectMany(f => Scan(root, f)).ToList();
        var used = new HashSet<(string, string)>();
        var left = findings.Where(f =>
        {
            var allow = Allowed.FirstOrDefault(a => a.File == f.File && f.Raw.Contains(a.Line, StringComparison.Ordinal));
            if (allow.File is null) return true;
            used.Add(allow);
            return false;
        }).ToList();
        Assert.True(left.Count == 0, $"{left.Count} retired network-text forms (write each as docs/network-text.html does):\n" +
            string.Join("\n", left.Take(200).Select(f => $"  {f.File}:{f.Line}: {f.What}: {f.Raw.Trim()}")));
        var stale = Allowed.Where(a => !used.Contains(a)).ToList();
        Assert.True(stale.Count == 0, "allowlist entries no finding uses: " + string.Join(", ", stale.Select(a => $"{a.File} '{a.Line}'")));
    }

    /// <summary>THE TWO LISTS AGREE: every network form matches the text of a case the shared refusal set holds (so both
    /// readers' suites refuse it), and each source a form names (the bridge's reader, the language server) still says its
    /// refusal.</summary>
    [Fact]
    public void Each_form_is_one_the_readers_refuse()
    {
        var root = NoCodeCheckLeftTests.RepoRoot();
        var refuse = Path.Combine(root, "packages", "volt-cli", "test", "fixtures", "network-text-st", "refuse");
        var refused = Directory.EnumerateFiles(refuse, "*.cases").SelectMany(f => Scan(root, f)).Select(f => f.What).ToHashSet();
        var missing = Forms.Where(f => f.InNetwork && !refused.Contains(f.What)).Select(f => f.What).ToList();
        Assert.True(missing.Count == 0, "forms no refusal case holds: " + string.Join("; ", missing));
        foreach (var f in Forms)
            foreach (var (file, phrase) in f.Said)
                Assert.True(File.ReadAllText(Path.Combine(root, file)).Contains(phrase, StringComparison.Ordinal),
                    $"'{f.What}': {file} no longer says \"{phrase}\" — the form list follows the readers' refusals");
    }

    private sealed record Finding(string File, int Line, string What, string Raw);

    private static IEnumerable<string> Files(string root)
    {
        foreach (var (p, exts) in Places)
        {
            var full = Path.Combine(root, p.Replace('/', Path.DirectorySeparatorChar));
            if (File.Exists(full)) { yield return full; continue; }
            Assert.True(Directory.Exists(full), $"{p}: the place is gone — update the gate");
            foreach (var f in Directory.EnumerateFiles(full, "*", SearchOption.AllDirectories)
                         .Where(f => exts.Any(e => f.EndsWith(e, StringComparison.OrdinalIgnoreCase)))
                         .Where(f => !f.Replace('\\', '/').Contains("/archive/", StringComparison.Ordinal))
                         .Where(f => !f.Replace('\\', '/').Contains("/node_modules/", StringComparison.Ordinal))
                         .OrderBy(f => f, StringComparer.Ordinal))
                yield return f;
        }
    }

    private static readonly Regex WireDecl = R(@"\b(?<w>\w+)\s*:\s*ANY\b");
    private static readonly Regex Language = R(@"(?<![\w%])%LANGUAGE\s+(?<l>\w+)");
    private static readonly Regex Network = R(@"(?<![\w%])%NETWORK\b");
    private static readonly Regex End = R(@"^END_(PROGRAM|FUNCTION_BLOCK|FUNCTION|METHOD|ACTION|GET|SET|PROPERTY|INTERFACE|TRANSITION)\b");
    private static readonly Regex Comment = R(@"^(//|\*|/\*|#)");
    private static readonly Regex Quoted = R(@"'(?:\$.|[^'$])*'");
    /// <summary>A string left open on its line: a <c>'</c> where a value starts (after <c>(</c>, <c>,</c> or <c>:=</c>), not
    /// an apostrophe in a word.</summary>
    private static readonly Regex Opening = R(@"(?<=(\(|,|:=)\s*)'");

    /// <summary>The findings in one file. A line of network text is a line under <c>%LANGUAGE LD|FBD</c> or
    /// <c>%NETWORK</c>, up to the next <c>%LANGUAGE</c> or <c>END_…</c> line (in Markdown only inside a fenced block; in the
    /// doc, every line); a <c>\n</c> escape in a TypeScript string is a line break; an ST string (the Execute box's code,
    /// an operand) is no network text.</summary>
    private static IEnumerable<Finding> Scan(string root, string file)
    {
        var rel = Path.GetRelativePath(root, file).Replace('\\', '/');
        var markdown = file.EndsWith(".md", StringComparison.OrdinalIgnoreCase);
        var html = file.EndsWith(".html", StringComparison.OrdinalIgnoreCase);
        var ts = file.EndsWith(".ts", StringComparison.OrdinalIgnoreCase);
        bool net = html, fence = false, inString = false;
        var wires = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (n, raw, parts, spans) in Units(file, html, ts))
        {
            foreach (var part in parts)
            {
                if (spans) inString = false;
                var s = part;
                var t = s.TrimStart(' ', '\t', '"', '`', '[', '(', ',');
                if (markdown && t.StartsWith("```", StringComparison.Ordinal)) { fence = !fence; net = false; inString = false; continue; }
                if (inString)
                {
                    var close = Unquoted(s);
                    if (close < 0) continue;
                    inString = false;
                    s = s[(close + 1)..];
                    t = s.TrimStart();
                }
                if (t.StartsWith("===", StringComparison.Ordinal) || t.StartsWith("####", StringComparison.Ordinal)) { net = html; inString = false; continue; }
                foreach (var f in Forms.Where(f => !f.InNetwork && f.Pattern.IsMatch(t)))
                    yield return new Finding(rel, n, f.What, raw);
                if (Language.Match(s) is { Success: true } lang)
                {
                    net = (!markdown || fence) && (lang.Groups["l"].Value is "LD" or "FBD");
                    wires.Clear();
                    continue;
                }
                if (Network.IsMatch(s)) { net = !markdown || fence; wires.Clear(); continue; }
                if (End.IsMatch(t)) { net = html; continue; }
                if (!net || t.StartsWith('%') || Comment.IsMatch(t)) continue;
                if (t.StartsWith("VAR", StringComparison.Ordinal))
                {
                    foreach (Match w in WireDecl.Matches(t)) wires.Add(w.Groups["w"].Value);
                    continue;
                }
                var code = Quoted.Replace(t, "0");
                var open = Opening.Match(code) is { Success: true } o ? o.Index : -1;
                if (open >= 0) { inString = true; code = code[..open]; }
                if (ts) code = TrailingComment.Replace(code, "");
                foreach (var f in Forms.Where(f => f.InNetwork))
                {
                    var hit = f.Pattern.Matches(code).Any(m => !m.Groups["name"].Success || !wires.Contains(m.Groups["name"].Value));
                    if (!hit) continue;
                    yield return new Finding(rel, n, f.What, raw);
                    break;
                }
            }
        }
    }

    private static readonly Regex TrailingComment = R(@"\s//\s.*$");
    private static readonly Regex Code = R(@"<code>(?<c>.*?)</code>");

    /// <summary>The lines of a file as (line number, the line, its pieces of text): a TypeScript line split at its <c>\n</c>
    /// escapes; in the HTML doc only its code — a <c>&lt;pre&gt;</c> block's lines and each <c>&lt;code&gt;</c> span (<c>Spans</c>: each
    /// one on its own) — decoded.</summary>
    private static IEnumerable<(int Line, string Raw, string[] Parts, bool Spans)> Units(string file, bool html, bool ts)
    {
        var lines = File.ReadAllText(file).Replace("\r\n", "\n").Split('\n');
        var pre = false;
        for (var i = 0; i < lines.Length; i++)
        {
            var raw = lines[i];
            if (!html) { yield return (i + 1, raw, ts ? raw.Split(@"\n") : new[] { raw }, false); continue; }
            var at = raw.IndexOf("<pre>", StringComparison.Ordinal);
            if (at >= 0) { pre = true; raw = raw[(at + 5)..]; }
            if (pre)
            {
                var end = raw.IndexOf("</pre>", StringComparison.Ordinal);
                if (end >= 0) { pre = false; raw = raw[..end]; }
                yield return (i + 1, lines[i], new[] { WebUtility.HtmlDecode(Regex.Replace(raw, "<[^>]*>", "")) }, false);
                continue;
            }
            var spans = Code.Matches(raw).Select(m => WebUtility.HtmlDecode(Regex.Replace(m.Groups["c"].Value, "<[^>]*>", ""))).ToArray();
            if (spans.Length > 0) yield return (i + 1, raw, spans, true);
        }
    }

    /// <summary>The index of the first <c>'</c> in <paramref name="s"/> that no <c>$</c> escapes, or -1.</summary>
    private static int Unquoted(string s)
    {
        for (var i = 0; i < s.Length; i++)
        {
            if (s[i] == '$') { i++; continue; }
            if (s[i] == '\'') return i;
        }
        return -1;
    }
}
