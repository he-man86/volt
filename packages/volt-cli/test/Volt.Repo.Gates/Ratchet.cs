using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Xunit;
using Volt.Tests.Shared;

namespace Volt.Repo.Gates;

/// <summary>
/// The C# source of <c>packages/volt-cli/src</c> read as CODE: one entry per line with its comment cut off, keyed by the
/// path relative to <c>src/</c> with <c>/</c> separators. <c>bin/</c> and <c>obj/</c> are not source.
///
/// <para>A <c>//</c> comment and a <c>///</c> doc line are prose, not code: a gate counts what the code does, and a
/// comment that NAMES a vendor while explaining the seam is the opposite of the drift these gates catch. String literals
/// stay: a vendor's word in a string the code compares against is code.</para>
/// </summary>
internal static class SourceScan
{
    public static string SrcDir()
    {
        var src = Path.Combine(RepoPaths.PackageDir().FullName, "src");
        Assert.True(Directory.Exists(src), $"volt-cli sources not found at {src}");
        return src;
    }

    /// <summary>Every source file under <paramref name="relDir"/> (relative to <c>src/</c>), as
    /// (relative path, 1-based line number, code without its comment).</summary>
    public static IEnumerable<(string File, int Line, string Code)> Lines(string relDir, Func<string, bool>? fileFilter = null)
    {
        var root = SrcDir();
        var dir = Path.Combine(root, relDir.Replace('/', Path.DirectorySeparatorChar));
        Assert.True(Directory.Exists(dir), $"source folder not found: src/{relDir}");
        foreach (var file in Directory.EnumerateFiles(dir, "*.cs", SearchOption.AllDirectories).OrderBy(f => f, StringComparer.Ordinal))
        {
            var rel = Path.GetRelativePath(root, file).Replace(Path.DirectorySeparatorChar, '/');
            if (rel.Contains("/bin/", StringComparison.Ordinal) || rel.Contains("/obj/", StringComparison.Ordinal)) continue;
            if (fileFilter != null && !fileFilter(rel)) continue;
            var n = 0;
            foreach (var raw in File.ReadLines(file))
            {
                n++;
                var code = CodeOf(raw);
                if (code.Length > 0) yield return (rel, n, code);
            }
        }
    }

    /// <summary>The code part of one line: a <c>///</c> line is none of it, and a <c>//</c> outside a string literal ends
    /// it.</summary>
    public static string CodeOf(string raw)
    {
        var t = raw.TrimStart();
        if (t.StartsWith("//", StringComparison.Ordinal) || t.StartsWith("*", StringComparison.Ordinal)
            || t.StartsWith("/*", StringComparison.Ordinal)) return "";
        var inString = false;
        for (var i = 0; i < raw.Length - 1; i++)
        {
            var c = raw[i];
            if (c == '\\' && inString) { i++; continue; }
            if (c == '"') inString = !inString;
            else if (!inString && c == '/' && raw[i + 1] == '/') return raw.Substring(0, i).TrimEnd();
        }
        return raw.TrimEnd();
    }

    /// <summary>Occurrences of <paramref name="pattern"/> per file over <paramref name="lines"/>.</summary>
    public static SortedDictionary<string, int> CountPerFile(IEnumerable<(string File, int Line, string Code)> lines, Regex pattern)
    {
        var counts = new SortedDictionary<string, int>(StringComparer.Ordinal);
        foreach (var (file, _, code) in lines)
        {
            var hits = pattern.Matches(code).Count;
            if (hits == 0) continue;
            counts[file] = counts.TryGetValue(file, out var c) ? c + hits : hits;
        }
        return counts;
    }
}

/// <summary>
/// A RATCHET: a count of sites a rule should not have, pinned per file at today's number. A file may only go DOWN.
///
/// <para>Above its pin, or a file with no pin, fails: a new site bypasses the rule. BELOW its pin fails too, asking for
/// the pin to be lowered in the same commit — a ratchet that is not tightened lets the count drift back up to the old
/// number unseen. A file at 0 is dropped from the pins. The failure prints today's counts as the C# literal to paste.</para>
/// </summary>
internal static class Ratchet
{
    public static void Hold(string rule, IReadOnlyDictionary<string, int> pinned, IReadOnlyDictionary<string, int> actual, string note)
    {
        var up = new List<string>();
        var down = new List<string>();
        foreach (var (file, count) in actual)
        {
            var pin = pinned.TryGetValue(file, out var p) ? p : 0;
            if (count > pin) up.Add($"{file}: {count} (pinned {pin})");
            else if (count < pin) down.Add($"{file}: {count} (pinned {pin})");
        }
        foreach (var (file, pin) in pinned)
            if (!actual.ContainsKey(file)) down.Add($"{file}: 0 (pinned {pin})");

        if (up.Count == 0 && down.Count == 0) return;
        var msg = new StringBuilder();
        msg.Append(rule).Append('\n');
        if (up.Count > 0)
            msg.Append("ABOVE the ratchet — a new site bypasses the rule:\n  ").Append(string.Join("\n  ", up)).Append('\n')
               .Append(note).Append('\n');
        if (down.Count > 0)
            msg.Append("BELOW the ratchet — tighten the pin in this commit, so the count cannot drift back:\n  ")
               .Append(string.Join("\n  ", down)).Append('\n');
        msg.Append("Today's counts (total ").Append(actual.Values.Sum()).Append("):\n").Append(Literal(actual));
        Assert.Fail(msg.ToString());
    }

    public static string Literal(IReadOnlyDictionary<string, int> counts) =>
        string.Join("\n", counts.Select(kv => $"        [\"{kv.Key}\"] = {kv.Value},"));
}
