using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Xunit;

namespace Volt.Repo.Gates;

/// <summary>
/// NO CODE CHECK LEFT IN THE BRIDGE (openspec <c>bridge-refusal-review</c> 6.2) — a RATCHET until that change closes.
///
/// <para>The bridge does not check the code: a refusal is allowed only where the write cannot be performed as sent
/// (no split, no child identity, no NWL model, no vendor slot). Each name below is a code check, a header read that
/// decides what a write means, or a code for a refusal the change deletes. The count is EXACT, taken at the change's
/// baseline (step 0, <c>2d4a1a46f2</c>): the step that deletes a name sets its count to 0 here in the same commit, a
/// count that grows is a check coming back, and a count that drops without the entry changing is a deletion nobody
/// recorded. Task 6.2 closes the ratchet: every entry is 0, and the names stay in the gate.</para>
///
/// <para>Code only — <c>//</c>, <c>///</c> and <c>/* */</c> are removed first, so a history note that names a
/// deleted helper is not a finding; a <c>//</c> inside a string literal is not a comment. String literals ARE code: a
/// retired code spelled in a string is still raised. Every MATCH counts, not every matching line.</para>
/// </summary>
public class NoCodeCheckLeftTests
{
    /// <summary>One retired name: the pattern, its exact count of matches in <c>packages/volt-cli/src</c> code
    /// today, and the task that takes it to 0.</summary>
    private readonly record struct Retired(string Pattern, int Count, string Task);

    private static readonly Dictionary<string, Retired> Names = new(StringComparer.Ordinal)
    {
        // Still in the code at the baseline.
        ["OpensNetwork"] = new(@"\bOpensNetwork\b", 2,
            "1.1 / 2.3: StReader sniffs an ST body for network text, and LD/FBD for its absence"),
        ["RefuseReservedNames"] = new(@"\bRefuseReservedNames\b", 0,
            "1.2: the identifier `implementation` refused anywhere in the code"),
        ["RefuseRetiredComment"] = new(@"\bRefuseRetiredComment\b", 0,
            "1.4: pull refuses an IDE text holding a `(* @volt-… *)` comment"),
        ["NETWORK_NOT_CANONICAL"] = new(@"\bNETWORK_NOT_CANONICAL\b|\bNetworkNotCanonical\b", 4,
            "2.12 / V.2: a complete, writable network model refused for its layout"),
        ["IsCallableHeader"] = new(@"\bIsCallableHeader\b", 2,
            "4.3: network scope reads a callee's header to decide FUNCTION or FB"),
        ["IsFunctionBlockType"] = new(@"\bIsFunctionBlockType\b", 2, "4.3: as IsCallableHeader"),
        ["FunctionBlockHeader"] = new(@"\bFunctionBlockHeader\b", 2, "4.3: as IsCallableHeader"),
        ["NonBlockTypeWords"] = new(@"\bNonBlockTypeWords\b", 2,
            "4.4: a hand copy of IEC types; an unknown type assumed to be a library FB"),
        ["HeaderLine outside CodeHelper"] = new(@"\bHeaderLine\s*\(", 2,
            "4.3: CodeHelper.HeaderLine is asked only by the child delimiting — today by StDeclaration's scope reads"),

        // Already at zero at the baseline: kept so they stay out.
        ["IsGlobalListHeader"] = new(@"\bIsGlobalListHeader\b", 0, "push-without-header-check 5Qb (Globals by wire kind)"),
        ["?? ItemKind.Kinds.Method"] = new(@"\?\?\s*ItemKind\.Kinds\.Method\b", 0,
            "push-without-header-check 5Qb (no fallback member kind)"),
        ["PlcPouFb"] = new(@"\bPlcPouFb\b", 0, "push-without-header-check 5Qa (no default POU kind)"),
        ["ParseCodeHeader"] = new(@"\bParseCodeHeader\b", 0, "push-without-header-check (no header check)"),
        ["INVALID_CODE_HEADER"] = new(@"\bINVALID_CODE_HEADER\b|\bInvalidCodeHeader\b", 0,
            "push-without-header-check (no header check)"),
    };

    /// <summary>Where a name's match is its definition, not a use — path under src → the names it may define.</summary>
    private static readonly Dictionary<string, string[]> Defines = new(StringComparer.Ordinal)
    {
        ["Volt.Engine/Format/St/CodeHelper.cs"] = new[] { "HeaderLine outside CodeHelper" },
    };

    [Fact]
    public void Every_retired_code_check_holds_its_recorded_count()
    {
        var src = Path.Combine(RepoRoot(), "packages", "volt-cli", "src");
        var files = Directory.EnumerateFiles(src, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}")
                        && !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}"))
            .ToDictionary(f => Path.GetRelativePath(src, f).Replace('\\', '/'), f => StripComments(File.ReadAllText(f)),
                          StringComparer.Ordinal);
        Assert.True(files.Count >= 60, $"only {files.Count} .cs file(s) under {src} — the gate is not looking at the toolchain.");

        var findings = new List<string>();
        foreach (var (name, r) in Names)
        {
            var hits = files
                .Where(f => !(Defines.TryGetValue(f.Key, out var d) && d.Contains(name)))
                .SelectMany(f => Hits(f.Value, name).Select(line => $"{f.Key}:{line}"))
                .ToList();
            if (hits.Count != r.Count)
                findings.Add($"`{name}` — recorded {r.Count}, found {hits.Count} ({r.Task}). " +
                             (hits.Count > r.Count ? "A retired check is coming back" : "Deleted: set its count here") +
                             (hits.Count > 0 ? ":\n    " + string.Join("\n    ", hits) : "."));
        }

        Assert.True(findings.Count == 0,
            "The bridge does not check the code (openspec bridge-refusal-review). Each count is exact; the step that " +
            "deletes a check sets it to 0 in the same commit:\n  " + string.Join("\n  ", findings));
    }

    // ── the gate's own teeth ────────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("/// <see cref=\"RefuseRetiredComment\"/> was deleted")]
    [InlineData("// OpensNetwork sniffed the body")]
    [InlineData("/* ParseCodeHeader\n   is gone */")]
    public void A_comment_naming_a_retired_check_is_no_finding(string source)
    {
        var code = StripComments(source);
        Assert.DoesNotContain(Names.Values, r => Regex.IsMatch(code, r.Pattern));
    }

    [Theory]
    [InlineData("var k = m.Kind ?? ItemKind.Kinds.Method;", "?? ItemKind.Kinds.Method")]
    [InlineData("throw new BridgeException(\"INVALID_CODE_HEADER\", msg);", "INVALID_CODE_HEADER")]
    [InlineData("var h = CodeHelper.HeaderLine(decl); // a scope read", "HeaderLine outside CodeHelper")]
    public void Code_naming_a_retired_check_is_counted(string source, string name) =>
        Assert.Matches(new Regex(Names[name].Pattern), StripComments(source));

    [Theory]
    [InlineData("var u = \"http://x\"; var h = CodeHelper.HeaderLine(decl);", "HeaderLine outside CodeHelper", 1)]
    [InlineData("var u = @\"C:\\a\\\"; IsCallableHeader(h);", "IsCallableHeader", 1)]
    [InlineData("var u = $\"{(a ? \"//\" : b)}\"; IsCallableHeader(h);", "IsCallableHeader", 1)]
    [InlineData("var c = '\"'; var u = \"//\"; IsCallableHeader(h);", "IsCallableHeader", 1)]
    [InlineData("var m = \"// RefuseRetiredComment\";", "RefuseRetiredComment", 1)]
    [InlineData("var a = CodeHelper.HeaderLine(x) + CodeHelper.HeaderLine(y);", "HeaderLine outside CodeHelper", 2)]
    public void Every_match_in_code_counts_even_after_a_string_holding_two_slashes(string source, string name, int count) =>
        Assert.Equal(count, Hits(StripComments(source), name).Count);

    /// <summary>The line of every MATCH of a retired name in comment-free code — two uses on one line are two hits,
    /// so a second use beside a counted one cannot come back unseen.</summary>
    private static List<int> Hits(string code, string name)
    {
        var lines = new List<int>();
        int line = 1, at = 0;
        foreach (Match m in Regex.Matches(code, Names[name].Pattern, RegexOptions.CultureInvariant))
        {
            for (; at < m.Index; at++) if (code[at] == '\n') line++;
            lines.Add(line);
        }
        return lines;
    }

    /// <summary>Source with <c>//</c>, <c>///</c> and <c>/* */</c> comments removed, newlines kept (a hit's line
    /// number is the file's). String and char literals are read as literals — a <c>//</c> inside <c>"http://…"</c>
    /// is not a comment — and kept, since a retired code spelled in a string is still raised. Interpolation holes
    /// (<c>$"{…}"</c>) are code, nested strings included. The toolchain has no raw (<c>"""</c>) literals.</summary>
    private static string StripComments(string source)
    {
        var o = new StringBuilder(source.Length);
        Code(source, 0, o, inHole: false);
        return o.ToString();
    }

    /// <summary>Copies code from <paramref name="i"/>, dropping comments; in an interpolation hole, stops after the
    /// <c>}</c> that closes it and returns the index past it.</summary>
    private static int Code(string s, int i, StringBuilder o, bool inHole)
    {
        var depth = 0;
        while (i < s.Length)
        {
            var c = s[i];
            var next = i + 1 < s.Length ? s[i + 1] : '\0';
            if (c == '/' && next == '/')
            {
                while (i < s.Length && s[i] != '\n') i++;
                continue;
            }
            if (c == '/' && next == '*')
            {
                var end = s.IndexOf("*/", i + 2, StringComparison.Ordinal);
                end = end < 0 ? s.Length : end + 2;
                o.Append('\n', s.AsSpan(i, end - i).Count('\n'));
                i = end;
                continue;
            }
            if (c == '"')
            {
                var p1 = i > 0 ? s[i - 1] : '\0';
                var p2 = i > 1 ? s[i - 2] : '\0';
                i = Literal(s, i, o, verbatim: p1 == '@' || (p1 == '$' && p2 == '@'),
                           interpolated: p1 == '$' || (p1 == '@' && p2 == '$'));
                continue;
            }
            if (c == '\'')
            {
                o.Append(c);
                for (i++; i < s.Length && s[i] != '\''; i++)
                {
                    if (s[i] == '\\') o.Append(s[i++]);
                    if (i < s.Length) o.Append(s[i]);
                }
                if (i < s.Length) o.Append(s[i++]);
                continue;
            }
            if (inHole && c == '{') depth++;
            if (inHole && c == '}' && depth-- == 0)
            {
                o.Append(c);
                return i + 1;
            }
            o.Append(c);
            i++;
        }
        return i;
    }

    /// <summary>Copies the string literal opening at <paramref name="i"/> and returns the index past its quote.</summary>
    private static int Literal(string s, int i, StringBuilder o, bool verbatim, bool interpolated)
    {
        o.Append(s[i++]);
        while (i < s.Length)
        {
            var c = s[i];
            var next = i + 1 < s.Length ? s[i + 1] : '\0';
            if (!verbatim && c == '\\')
            {
                o.Append(c);
                if (next != '\0') o.Append(next);
                i += 2;
                continue;
            }
            if (c == '"' && verbatim && next == '"')
            {
                o.Append("\"\"");
                i += 2;
                continue;
            }
            if (c == '"')
            {
                o.Append(c);
                return i + 1;
            }
            if (interpolated && c == '{')
            {
                if (next == '{')
                {
                    o.Append("{{");
                    i += 2;
                    continue;
                }
                o.Append(c);
                i = Code(s, i + 1, o, inHole: true);
                continue;
            }
            o.Append(c);
            i++;
        }
        return i;
    }

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "CLAUDE.md"))) dir = dir.Parent;
        Assert.True(dir is not null, "could not locate the repo root from the test output folder");
        return dir!.FullName;
    }
}
