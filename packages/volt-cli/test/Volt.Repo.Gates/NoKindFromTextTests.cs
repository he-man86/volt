using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Xunit;

namespace Volt.Repo.Gates;

/// <summary>
/// NO KIND OR NAME FROM A TEXT, AND NO RETIRED EXTENSION (openspec <c>push-without-header-check</c> 5.F.2).
///
/// <para>An item's kind is its IDE class and its wire name is a pure function of that kind: every POU is
/// <c>X.pou</c>, every DUT <c>X.dut</c> (5.P, 5.Q). Before this change Volt read a declaration's first code line to
/// pick a kind or a subtype in five places (<c>CodesysTypeMap.RefinePou</c> / <c>LeadingKeyword</c>,
/// <c>CodeHelper.TryDutSubtype</c>, <c>StDeclaration.IsGlobalListHeader</c>, <c>CodeHelper.ParseCodeHeader</c>), and
/// each one came back at least once after it was "removed". This gate keeps them out by grep, with the allow-list
/// written here: each entry names one file by its PATH (not its file name) and the exact number of lines in it that
/// match, so a stale entry, a second file of that name, or a new read beside the allowed ones all fail.</para>
///
/// <para>Three rules: (1) no <c>Volt.*</c> source outside the files listed reads a declaration's first code line or
/// spells a header keyword (<c>TYPE</c> / <c>STRUCT</c> / <c>UNION</c> / <c>FUNCTION_BLOCK</c> / <c>FUNCTION</c> /
/// <c>INTERFACE</c> / <c>PROGRAM</c> / <c>VAR_GLOBAL</c>) in a string — in upper case anywhere, in any case where only
/// a classifier puts it (<see cref="HeaderPattern"/>); (2) the deleted classifiers and the vendor's per-object parse / precompile signature
/// — the kind source 5.D measured and the owner rejected for the class — are named nowhere in <c>src</c>; (3) no
/// product source spells <c>.struct</c> / <c>.enum</c> / <c>.union</c> / <c>.alias</c> / <c>.prg</c> / <c>.fb</c> /
/// <c>.fun</c> as an extension, in a comment or a string — code, docs, the VS Code manifest and the doc site.</para>
/// </summary>
public class NoKindFromTextTests
{
    // ── rule 1: header reads and header keywords ────────────────────────────────────────────────────────────────

    /// <summary>The helpers that read a declaration's first code line (or a member's), by name.</summary>
    private static readonly Regex HeaderReader =
        new(@"\b(HeaderLine|FirstCodeLine|FirstMemberLine|PouHeaderKeyword|MemberHeaderKeyword|CodeOn)\b",
            RegexOptions.CultureInvariant);

    private const string Keywords = "TYPE|STRUCT|UNION|FUNCTION_BLOCK|FUNCTION|INTERFACE|PROGRAM|VAR_GLOBAL";

    /// <summary>A header keyword in upper case as a whole word anywhere in a string — the shape of every deleted
    /// classifier (<c>"TYPE"</c>, <c>@"^\s*VAR_GLOBAL\b"</c>, <c>StartsWith("PROGRAM")</c>, <c>"FUNCTION "</c>, the
    /// word that tells a FUNCTION from a FUNCTION_BLOCK). Case-sensitive here because in any case these are English
    /// words every message spells ("type", "function", "interface").</summary>
    private static readonly Regex HeaderKeyword = new($@"\b({Keywords})\b", RegexOptions.CultureInvariant);

    /// <summary>The same keyword in ANY case where only a classifier puts it, judged per literal: a regex anchor leads
    /// to it (<c>@"^\s*var_global\b"</c> with <c>RegexOptions.IgnoreCase</c>, <c>@"(?i)^type\b"</c>); the literal is
    /// a keyword and a trailing space, a <c>StartsWith</c> prefix (<c>"Function "</c>); or the literal is one of the
    /// keywords that are no English word (<c>"var_global"</c>, <c>"struct"</c>). A bare <c>"type"</c> /
    /// <c>"Interface"</c> / <c>"function"</c> / <c>"program"</c> is not judged: those are COM property names and
    /// PLCopen attribute values the drivers WRITE, dozens of them, and <c>"program"</c> is
    /// <c>WireVocabularyGuardTests</c>'.</summary>
    private static readonly Regex HeaderPattern =
        new($@"\^(?:\\{{1,2}}s[*+?]?|\s|\(\?\w+\))*(?<kw>{Keywords})\b|^\s*(?<kw>{Keywords})\s+$|^\s*(?<kw>VAR_GLOBAL|STRUCT|UNION|FUNCTION_BLOCK)\s*$",
            RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

    /// <summary>One allow-list entry: how many lines of that file match — exactly, so a new read or keyword added
    /// beside the allowed ones changes the count and fails — and why those lines decide no kind.</summary>
    private readonly record struct Allowance(int Lines, string Why);

    /// <summary>Where a header read is not a kind or name decision — path under <c>packages/volt-cli/src</c>,
    /// forward slashes (never a bare file name: a second <c>StReader.cs</c> elsewhere is not pre-authorised).</summary>
    private static readonly Dictionary<string, Allowance> MayReadHeaders = new(StringComparer.Ordinal)
    {
        ["Volt.Engine/Format/St/StReader.cs"] = new(6,
            "the child splitter (5.E) and the outer END line the pull mirrors from the header (5.Q.3)"),
        ["Volt.Engine/Format/St/StWriter.cs"] = new(1,
            "writes the END line that mirrors the declaration's own header (5.Q.3) — file format, no kind"),
        ["Volt.Engine/Sync/Materializer.cs"] = new(2,
            "holds a member's text to its CLASS (5.Q.5) and logs the END-line fallback; decides nothing"),
        ["Volt.Engine/Format/St/CodeHelper.cs"] = new(3, "HeaderLine / CodeOn themselves"),
        ["Volt.Engine/Format/St/StDeclaration.cs"] = new(5,
            "network-text scope: is a callee callable / a function block (analysis, 5.Qa knock-on)"),
    };

    /// <summary>Where a header keyword in a string is not a read that decides a kind — path as above.</summary>
    private static readonly Dictionary<string, Allowance> MaySpellHeaderKeywords = new(StringComparer.Ordinal)
    {
        ["Volt.Engine/Format/St/StReader.cs"] = new(1, "the END line mirror's three keywords (PouHeaderKeyword)"),
        ["Volt.Engine/Format/St/StWriter.cs"] = new(1, "the END line's fallback keyword"),
        ["Volt.Engine/Format/St/StDeclaration.cs"] = new(2,
            "network-text scope's callable / function-block header patterns"),
        ["Volt.Engine/Sync/Materializer.cs"] = new(1, "a log line naming the END-line fallback"),
        ["Volt.Engine/Library/LibSignatureRenderer.cs"] = new(8,
            "WRITES a library item's text from the vendor's signature; reads no text"),
        ["Volt.Engine/Format/Network/NetworkTextReader.cs"] = new(3,
            "network text's own `??? : TYPE(…)` spelling, in refusal messages"),
        ["Volt.Ide.Codesys/Ide/CodesysNetworkWriter.cs"] = new(1, "the word TYPE in a refusal message"),
        ["Volt.Engine/Sync/PushService.cs"] = new(1,
            "a refused member create's message: which members a POU accepts follows its declaration (a FUNCTION takes none)"),
        ["Volt.Ide.Codesys/Driver/CodesysRefusedNames.cs"] = new(7,
            "the NAMES CODESYS refuses for a POU or member (FUNCTION, PROGRAM, TYPE … are among them) — a word list, read by no header"),
        ["Volt.Ide.Twincat/Driver/TcRefusedNames.cs"] = new(7,
            "the NAMES TwinCAT refuses for a POU or member (FUNCTION, PROGRAM, TYPE … are among them) — a word list, read by no header"),
    };

    // ── rule 2: the deleted classifiers and the per-object vendor parse ─────────────────────────────────────────

    /// <summary>Named nowhere in src code. <c>GetSignature</c> / <c>FindSignature</c> / <c>ParseInterface</c> /
    /// <c>POUType</c> are CODESYS's per-object precompile signature and parser (DIALECT C2j): the kind source 5.D
    /// stopped, because the class states it. Library signatures come from the library-wide listing, not these.</summary>
    private static readonly Regex DeletedKindSource =
        new(@"\b(IsGlobalListHeader|TryDutSubtype|DutSubtype|TcDutSubtype|RefinePou|LeadingKeyword|ParseCodeHeader|GetSignature|FindSignature|ParseInterface|POUType)\b",
            RegexOptions.CultureInvariant);

    /// <summary>Rules 1 and 2 over <paramref name="files"/> (path under src, forward slashes → text). An allow-listed
    /// file whose matching line count differs from its entry is a finding; with <paramref name="wholeTree"/>, so is
    /// an entry whose file is not there at all (a stale entry pre-authorises the next file at that path).</summary>
    private static List<string> Rule1And2Findings(IReadOnlyDictionary<string, string> files, bool wholeTree)
    {
        var findings = new List<string>();
        var reads = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        var spells = new Dictionary<string, List<string>>(StringComparer.Ordinal);

        void Tally(Dictionary<string, Allowance> allow, Dictionary<string, List<string>> seen, string rel, string line)
        {
            if (!allow.ContainsKey(rel)) { findings.Add(line); return; }
            if (!seen.TryGetValue(rel, out var l)) seen[rel] = l = new List<string>();
            l.Add(line);
        }

        foreach (var (rel, text) in files)
        {
            var code = Split(text, Lang.CSharp, out var strings, out var literals).Code;
            var codeLines = code.Split('\n');
            var stringLines = strings.Split('\n');
            var patternLines = literals.Where(l => HeaderPattern.IsMatch(l.Text)).ToLookup(l => l.Line);
            for (var i = 0; i < codeLines.Length; i++)
            {
                var where = $"{rel}:{i + 1}";
                if (DeletedKindSource.Match(codeLines[i]) is { Success: true } d)
                    findings.Add($"{where}: names `{d.Value}`, a deleted kind source");
                if (HeaderReader.Match(codeLines[i]) is { Success: true } r)
                    Tally(MayReadHeaders, reads, rel, $"{where}: reads a header ({r.Value})");
                var k = HeaderKeyword.Match(stringLines[i]);
                var spelled = k.Success ? k.Value
                    : patternLines[i].Select(l => HeaderPattern.Match(l.Text).Groups["kw"].Value).FirstOrDefault();
                if (spelled is not null) Tally(MaySpellHeaderKeywords, spells, rel, $"{where}: a string spells `{spelled}`");
            }
        }

        foreach (var (allow, seen, what) in new[] { (MayReadHeaders, reads, "header read"), (MaySpellHeaderKeywords, spells, "keyword") })
            foreach (var (rel, a) in allow)
            {
                if (!files.ContainsKey(rel)) { if (wholeTree) findings.Add($"{rel}: allow-listed for {what}s but gone"); continue; }
                var lines = seen.TryGetValue(rel, out var l) ? l : new List<string>();
                if (lines.Count != a.Lines)
                    findings.Add($"{rel}: allow-listed for {a.Lines} {what} line(s), holds {lines.Count} — review each " +
                                 "and set the count:\n    " + string.Join("\n    ", lines));
            }
        return findings;
    }

    [Fact]
    public void No_source_outside_the_splitter_reads_a_header_to_decide_a_kind_or_a_name()
    {
        var src = Path.Combine(RepoRoot(), "packages", "volt-cli", "src");
        var files = Files(src, ".cs").ToDictionary(f => Path.GetRelativePath(src, f).Replace('\\', '/'), File.ReadAllText,
                                                   StringComparer.Ordinal);
        Assert.True(files.Count >= 60, $"only {files.Count} .cs file(s) under {src} — the gate is not looking at the toolchain.");

        var findings = Rule1And2Findings(files, wholeTree: true);
        Assert.True(findings.Count == 0,
            "A kind or a name comes from the IDE's class, never from a text (openspec push-without-header-check 5.F). " +
            "These lines read a header, spell a header keyword or name a deleted kind source:\n  " +
            string.Join("\n  ", findings));
    }

    // ── rule 3: the retired extensions ──────────────────────────────────────────────────────────────────────────

    /// <summary>A retired extension: after a name (<c>X.struct</c>, <c>`X.fb`</c>) or standing alone after a quote,
    /// space, parenthesis, glob star or list separator (<c>`.enum`</c>, <c>".fun"</c>, <c>*.fb</c>, <c>a,.enum</c>).
    /// Not a call (<c>s.union(</c>), not a longer word and not a dotted key (<c>diagnostics.enum-comparison</c>).</summary>
    private static readonly Regex RetiredExtension =
        new(@"(?:\w|(?<=[\s`'""(/\[}*,:]))\.(struct|enum|union|alias|prg|fb|fun)\b(?![\w(-])", RegexOptions.CultureInvariant);

    /// <summary>Files that may spell one — path relative to the repo, forward slashes → exact line count and why.</summary>
    private static readonly Dictionary<string, Allowance> MaySpellRetired = new(StringComparer.Ordinal)
    {
        ["packages/volt-cli/src/Volt.Engine/Ide/DIALECT.md"] = new(7,
            "the vendor-fact census: rows that served the subtype are KEPT as history notes (5.F.1)"),
        ["packages/volt-lsp-iec/src/source-extensions.test.ts"] = new(3,
            "pins that the retired extensions are no source kind"),
        ["packages/volt-control/src/state/files.test.ts"] = new(4, "pins that the retired DUT extensions are no POU file"),
        ["packages/volt-cli/docs/items.html"] = new(2,
            "the migration notes: what a workspace's old POU / DUT names were and that they are refused (5.P / 5.Q)"),
        ["packages/volt-cli/docs/wire.html"] = new(2, "the wire's refusal of the old POU / DUT names, spelled out"),
    };

    /// <summary>The product's sources: every package's code and its docs for readers, the VS Code manifest (it
    /// declares the source extensions) and the static doc site's prose (<c>DocDataTests</c> gates only its fact
    /// tables). Test trees spell a retired name to prove it is refused.</summary>
    private static IEnumerable<string> ProductSources(string root)
    {
        var p = Path.Combine(root, "packages");
        foreach (var dir in new[] { "volt-cli/src", "volt-control/src", "volt-lsp-iec/src", "volt-vscode/src",
                                    "volt-desktop/src", "volt-web/app" })
            foreach (var f in Files(Path.Combine(p, dir), ".cs", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".md", ".mdx"))
                yield return f;
        foreach (var f in Files(Path.Combine(p, "volt-cli", "docs"), ".html", ".md"))
            yield return f;
        foreach (var f in new[] { "CLAUDE.md", "packages/volt-cli/ARCHITECTURE.md",
                                  "packages/volt-vscode/package.json" })
            yield return Path.Combine(root, f);
        foreach (var readme in Directory.EnumerateFiles(p, "README.md", SearchOption.TopDirectoryOnly)
                     .Concat(Directory.EnumerateDirectories(p).Select(d => Path.Combine(d, "README.md"))).Where(File.Exists))
            yield return readme;
    }

    [Fact]
    public void No_product_source_spells_a_retired_extension()
    {
        var root = RepoRoot();
        var files = ProductSources(root).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        Assert.True(files.Count >= 500, $"only {files.Count} source file(s) — the gate is not looking at the product.");

        var offenders = new List<string>();
        var allowed = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var f in files)
        {
            var rel = Path.GetRelativePath(root, f).Replace('\\', '/');
            var lines = Prose(f, File.ReadAllText(f)).Split('\n');
            for (var i = 0; i < lines.Length; i++)
            {
                if (RetiredExtension.Match(lines[i]) is not { Success: true } m) continue;
                var line = $"{rel}:{i + 1}: `{m.Value.TrimStart()}`";
                if (!MaySpellRetired.ContainsKey(rel)) { offenders.Add(line); continue; }
                if (!allowed.TryGetValue(rel, out var l)) allowed[rel] = l = new List<string>();
                l.Add(line);
            }
        }
        foreach (var (rel, a) in MaySpellRetired)
        {
            var lines = allowed.TryGetValue(rel, out var l) ? l : new List<string>();
            if (lines.Count != a.Lines)
                offenders.Add($"{rel}: allow-listed for {a.Lines} line(s), holds {lines.Count} — review each and set " +
                              "the count:\n    " + string.Join("\n    ", lines));
        }

        Assert.True(offenders.Count == 0,
            "Every POU is X.pou and every DUT X.dut (openspec push-without-header-check 5.P / 5.Q). These comments or " +
            "strings spell a retired extension — say what it was in words, or name the current one:\n  " +
            string.Join("\n  ", offenders));
    }

    // ── the gate's own teeth ────────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("var n = $\"{bare}.struct\";")]
    [InlineData("// Until 5.Q the wire named a POU `X.prg` / `X.fb` / `X.fun`.")]
    [InlineData("/// <c>X.enum</c> is refused")]
    [InlineData("const exts = [\".union\", \".alias\"]")]
    [InlineData("if (c === \"volt push\") return [{ c: \"ok\", t: \"  ✓ pushed FB_Conveyor.fb → IDE\" }]")]
    [InlineData("\"filenamePattern\": \"*.fb\"")]
    [InlineData("// matches *.enum files")]
    [InlineData("const exts = \"a,.enum\"")]
    [InlineData("// the kinds:.prg")]
    public void Rule_3_catches_a_retired_extension(string line) =>
        Assert.Matches(RetiredExtension, Prose("x.ts", line));

    [Theory]
    [InlineData("const target = bindInOut(lw, arg, param, held(), routine.body, routine.fb, instance)")]
    [InlineData("seen.add(`FB:${n.fb}`)")]
    [InlineData("var x = $\"{routine.fb}\";")]
    [InlineData("if (union !== undefined) return p.path.length === union.union.path.length + 1")]
    [InlineData("// `enumerate` the table; a structural check")]
    [InlineData("const head = s.union(other)")]
    [InlineData("\"volt.iec.diagnostics.enum-comparison\": {")]
    public void Rule_3_passes_code_that_is_no_extension(string line) =>
        Assert.DoesNotMatch(RetiredExtension, Prose("x.cs", line));

    [Theory]
    [InlineData("var rx = new Regex(@\"^\\s*VAR_GLOBAL\\b\");", "VAR_GLOBAL")]
    [InlineData("if (head.StartsWith(\"TYPE\")) return Kinds.Dut;", "TYPE")]
    [InlineData("return word == \"FUNCTION_BLOCK\" ? a : b;", "FUNCTION_BLOCK")]
    [InlineData("if (Regex.IsMatch(head, @\"^\\s*var_global\\b\", RegexOptions.IgnoreCase)) return k;", "var_global")]
    [InlineData("return head.StartsWith(\"FUNCTION \") ? a : b;", "FUNCTION")]
    [InlineData("if (head.StartsWith(\"Interface \")) return k;", "Interface")]
    [InlineData("var rx = new Regex(@\"^\\s*Type\\b\");", "Type")]
    [InlineData("if (head.Trim() == \"var_global\") return k;", "var_global")]
    [InlineData("var rx = new Regex(\"(?i)^\\\\s*function\\\\b\");", "function")]
    public void Rule_1_catches_a_header_keyword_in_a_string(string line, string keyword)
    {
        var findings = Rule1And2Findings(new Dictionary<string, string> { ["Volt.Engine/Sync/Classifier.cs"] = line }, false);
        Assert.Contains(findings, f => f.EndsWith($"a string spells `{keyword}`"));
    }

    [Theory]
    [InlineData("throw new InvalidOperationException(\"the type of an interface function is unknown\");")]
    [InlineData("Log(\"Type mismatch: \" + name);")]
    public void Rule_1_passes_a_message_that_spells_the_words(string line) =>
        Assert.Empty(Rule1And2Findings(new Dictionary<string, string> { ["Volt.Engine/Sync/Classifier.cs"] = line }, false));

    /// <summary>An allow-list entry names one file by its path, not its name: a second file of that name elsewhere is
    /// not pre-authorised.</summary>
    [Fact]
    public void Rule_1_allows_by_path_not_by_file_name()
    {
        var findings = Rule1And2Findings(new Dictionary<string, string>
        {
            ["Volt.Ide.Twincat/Ide/StDeclaration.cs"] = "var h = CodeHelper.HeaderLine(d);",
        }, false);
        Assert.Contains(findings, f => f.StartsWith("Volt.Ide.Twincat/Ide/StDeclaration.cs:1: reads a header"));
    }

    /// <summary>An allow-list entry counts its lines exactly: a classifier added beside the allowed reads fails.</summary>
    [Fact]
    public void Rule_1_catches_a_new_read_inside_an_allow_listed_file()
    {
        const string rel = "Volt.Engine/Sync/Materializer.cs";
        var text = File.ReadAllText(Path.Combine(RepoRoot(), "packages", "volt-cli", "src", rel));
        Assert.Empty(Rule1And2Findings(new Dictionary<string, string> { [rel] = text }, false));
        var grown = text + "\npublic static string Kind(string d) => CodeHelper.HeaderLine(d).StartsWith(\"PROGRAM\") ? \"prg\" : \"pou\";\n";
        var findings = Rule1And2Findings(new Dictionary<string, string> { [rel] = grown }, false);
        Assert.Contains(findings, f => f.StartsWith($"{rel}: allow-listed for") && f.Contains("header read"));
        Assert.Contains(findings, f => f.StartsWith($"{rel}: allow-listed for") && f.Contains("keyword"));
    }

    [Theory]
    [InlineData("// a TYPE … END_TYPE declaration is written as sent")]
    [InlineData("/// <c>PROGRAM</c> text under a POU object")]
    [InlineData("var t = ItemKind.Kinds.Dut; // STRUCT or not")]
    public void Rule_1_reads_no_comment(string line)
    {
        Split(line, Lang.CSharp, out var strings);
        Assert.DoesNotMatch(HeaderKeyword, strings);
    }

    [Theory]
    [InlineData("var kind = CodeHelper.TryDutSubtype(decl);")]
    [InlineData("if (StDeclaration.IsGlobalListHeader(d)) yield return d;")]
    [InlineData("var t = parser.ParseInterface().POUType;")]
    [InlineData("var sig = ctx.GetSignature(guid);")]
    public void Rule_2_catches_a_deleted_kind_source(string line) =>
        Assert.Matches(DeletedKindSource, Split(line, Lang.CSharp, out _).Code);

    // ── a source file split into code, string contents and comments (line structure kept) ───────────────────────

    private enum Lang { CSharp, Script, Prose }

    private readonly record struct Parts(string Code, string Comments);

    /// <summary>What rule 3 reads: comments and string contents (interpolations removed — they are code), or the whole
    /// text of a document.</summary>
    private static string Prose(string path, string text)
    {
        var ext = Path.GetExtension(path).ToLowerInvariant();
        if (ext is ".md" or ".mdx" or ".html") return text;
        var parts = Split(text, ext == ".cs" ? Lang.CSharp : Lang.Script, out var strings);
        var a = parts.Comments.ToCharArray();
        for (var i = 0; i < a.Length; i++) if (strings[i] != ' ' && strings[i] != '\n') a[i] = strings[i];
        return new string(a);
    }

    /// <summary>Three same-length views of <paramref name="text"/> — code, comment text, string contents — each blank
    /// (spaces) where the others are, newlines kept, so a line number is the same in all three. A small scanner:
    /// <c>//</c> and <c>/* */</c> comments; <c>"…"</c> and <c>'…'</c> with backslash escapes; C# <c>@"…"</c> (<c>""</c>
    /// escape) and <c>$"…{code}…"</c>; script <c>`…${code}…`</c>. Enough for a grep gate, not a compiler.</summary>
    private static Parts Split(string text, Lang lang, out string strings) => Split(text, lang, out strings, out _);

    /// <summary>One string literal's contents (interpolations removed) and the 0-based line it starts on.</summary>
    private readonly record struct Literal(int Line, string Text);

    private static Parts Split(string text, Lang lang, out string strings, out List<Literal> literals)
    {
        var n = text.Length;
        var found = new List<Literal>();
        var open = new Stack<(int Line, StringBuilder Text)>();
        var line = 0;
        var code = new StringBuilder(n);
        var com = new StringBuilder(n);
        var str = new StringBuilder(n);
        void Put(char c, int view)
        {
            var blank = c == '\n' ? '\n' : ' ';
            code.Append(view == 0 ? c : blank);
            com.Append(view == 1 ? c : blank);
            str.Append(view == 2 ? c : blank);
            if (view == 2 && open.Count > 0) open.Peek().Text.Append(c);
            if (c == '\n') line++;
        }

        var i = 0;
        // Code until `close` (a `}` ending an interpolation at depth 0), or to the end when close is '\0'.
        void Code(char close)
        {
            var depth = 0;
            while (i < n)
            {
                var c = text[i];
                if (close != '\0' && c == close && depth == 0) return;
                if (c == '{') depth++;
                else if (c == '}') depth--;
                if (c == '/' && i + 1 < n && text[i + 1] == '/')
                {
                    while (i < n && text[i] != '\n') Put(text[i++], 1);
                    continue;
                }
                if (c == '/' && i + 1 < n && text[i + 1] == '*')
                {
                    Put(text[i++], 1); Put(text[i++], 1);
                    while (i < n && !(text[i] == '*' && i + 1 < n && text[i + 1] == '/')) Put(text[i++], 1);
                    if (i < n) { Put(text[i++], 1); Put(text[i++], 1); }
                    continue;
                }
                var verbatim = lang == Lang.CSharp && (c == '@' || c == '$') && Peek("@\"", "$@\"", "@$\"", "$\"");
                if (verbatim || c == '"' || (c == '\'' && lang == Lang.Script) || (c == '`' && lang == Lang.Script)
                    || (c == '\'' && lang == Lang.CSharp && IsCharLiteral()))
                {
                    String();
                    continue;
                }
                Put(c, 0);
                i++;
            }
        }

        bool Peek(params string[] heads) => heads.Any(h => string.CompareOrdinal(text, i, h, 0, h.Length) == 0);
        bool IsCharLiteral() => i + 2 < n && (text[i + 2] == '\'' || (text[i + 1] == '\\' && i + 3 < n && text[i + 3] == '\''));

        void String()
        {
            open.Push((line, new StringBuilder()));
            try { Literal(); }
            finally { var (at, t) = open.Pop(); found.Add(new Literal(at, t.ToString())); }
        }

        void Literal()
        {
            var interpolated = false;
            var verbatim = false;
            while (text[i] is '@' or '$')
            {
                interpolated |= text[i] == '$';
                verbatim |= text[i] == '@';
                Put(text[i++], 0);
            }
            var quote = text[i];
            if (quote == '`') interpolated = true;
            Put(text[i++], 0);
            while (i < n)
            {
                var c = text[i];
                if (c == '\\' && !verbatim && i + 1 < n) { Put(c, 2); Put(text[i + 1], 2); i += 2; continue; }
                if (c == quote)
                {
                    if (verbatim && i + 1 < n && text[i + 1] == quote) { Put(c, 2); Put(c, 2); i += 2; continue; }
                    Put(c, 0); i++;
                    return;
                }
                if (c == '\n' && quote != '`' && !verbatim) return;   // an unclosed literal ends at the line
                if (interpolated && quote == '`' && c == '$' && i + 1 < n && text[i + 1] == '{')
                {
                    Put(text[i++], 0); Put(text[i++], 0); Code('}');
                    if (i < n) Put(text[i++], 0);
                    continue;
                }
                if (interpolated && quote != '`' && c == '{')
                {
                    if (i + 1 < n && text[i + 1] == '{') { Put(c, 2); Put(c, 2); i += 2; continue; }
                    Put(text[i++], 0); Code('}');
                    if (i < n) Put(text[i++], 0);
                    continue;
                }
                Put(c, 2);
                i++;
            }
        }

        Code('\0');
        strings = str.ToString();
        literals = found;
        return new Parts(code.ToString(), com.ToString());
    }

    private static IEnumerable<string> Files(string dir, params string[] exts)
    {
        if (!Directory.Exists(dir)) throw new DirectoryNotFoundException($"the gate names {dir}, which is gone");
        var sep = Path.DirectorySeparatorChar;
        return Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories)
            .Where(f => exts.Contains(Path.GetExtension(f), StringComparer.OrdinalIgnoreCase))
            .Where(f => !f.Contains($"{sep}bin{sep}") && !f.Contains($"{sep}obj{sep}")
                        && !f.Contains($"{sep}node_modules{sep}") && !f.Contains($"{sep}dist{sep}"));
    }

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "CLAUDE.md"))) dir = dir.Parent;
        Assert.True(dir is not null, "could not locate the repo root from the test output folder");
        return dir!.FullName;
    }
}
