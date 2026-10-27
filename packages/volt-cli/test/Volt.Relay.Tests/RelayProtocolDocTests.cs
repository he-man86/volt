using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Xunit;

namespace Volt.Relay.Tests;

/// <summary>The words <c>docs/relay-protocol.md</c> quotes for a client, read from the doc itself (review of gate step 6:
/// the doc's refusal table was hand-copied from the code, and nothing turned red when the two drifted). A quoted message is
/// a template: each <c>&lt;…&gt;</c> stands for one value, everything else is literal. The tests that drive each refusal
/// match the bridge's actual message against these, so a reworded refusal and a stale doc row both fail.</summary>
internal static class RelayProtocolDoc
{
    private static string? _text;

    public static string Text => _text ??= File.ReadAllText(Locate());

    private static string Locate()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
        {
            var doc = Path.Combine(dir.FullName, "docs", "relay-protocol.md");
            if (File.Exists(doc) && File.Exists(Path.Combine(dir.FullName, "Volt.sln"))) return doc;
        }
        throw new FileNotFoundException("docs/relay-protocol.md was not found above " + AppContext.BaseDirectory);
    }

    /// <summary>An anchored regex for a quoted template: <c>&lt;…&gt;</c> matches one non-empty value.</summary>
    public static Regex Template(string template)
    {
        var pattern = new StringBuilder("^");
        var at = 0;
        foreach (Match hole in Regex.Matches(template, "<[^<>]+>"))
        {
            pattern.Append(Regex.Escape(template.Substring(at, hole.Index - at))).Append(".+?");
            at = hole.Index + hole.Length;
        }
        pattern.Append(Regex.Escape(template.Substring(at))).Append('$');
        return new Regex(pattern.ToString(), RegexOptions.CultureInvariant | RegexOptions.Singleline);
    }

    /// <summary>The <c>&lt;reason&gt;</c> column of the refusal table under "Relay → bridge: a large request".</summary>
    public static IReadOnlyList<string> RefusalReasons()
    {
        var lines = Text.Replace("\r\n", "\n").Split('\n');
        var head = Array.FindIndex(lines, l => l.StartsWith("| `<reason>` |", StringComparison.Ordinal));
        Assert.True(head >= 0, "relay-protocol.md has no refusal table (a header row starting \"| `<reason>` |\")");
        var reasons = new List<string>();
        for (var i = head + 2; i < lines.Length && lines[i].StartsWith("|", StringComparison.Ordinal); i++)
            reasons.Add(CodeSpan(lines[i].Split('|')[1].Trim()));
        Assert.True(reasons.Count >= 15, "only " + reasons.Count + " refusal row(s) read from relay-protocol.md");
        return reasons;
    }

    /// <summary>The quoted intake refusal of an id too long for a chunk header.</summary>
    public static Regex IdRefusal()
    {
        var spans = Regex.Matches(Text, "`(the request id \\([^`]+)`");
        Assert.True(spans.Count == 1, spans.Count + " quoted id refusal(s) in relay-protocol.md, not 1");
        return Template(Regex.Replace(spans[0].Groups[1].Value, "\\s*\\n\\s*", " "));
    }

    /// <summary>The text of a cell that is one code span, <c>`x`</c> or <c>`` x ``</c>.</summary>
    private static string CodeSpan(string cell)
    {
        var fence = cell.StartsWith("``", StringComparison.Ordinal) ? "``" : "`";
        Assert.True(cell.StartsWith(fence, StringComparison.Ordinal) && cell.EndsWith(fence, StringComparison.Ordinal) &&
            cell.Length > 2 * fence.Length, "a refusal cell that is not one code span: " + cell);
        var inner = cell.Substring(fence.Length, cell.Length - 2 * fence.Length);
        return fence == "``" ? inner.Trim(' ') : inner;
    }
}

public class RelayProtocolDocTests
{
    /// <summary>Every row of the doc's refusal table is a refusal the bridge gives, and every refusal the bridge gives is a
    /// row: the reasons are the exact ones <see cref="ChunkedRequestTests.Broken"/> drives through a tunnel (that theory
    /// asserts each message whole), plus the connection bound, driven on the assembly.</summary>
    [Fact]
    public void The_refusal_table_and_the_refusals_the_bridge_gives_are_one_set()
    {
        var rows = RelayProtocolDoc.RefusalReasons().Select(r => (Row: r, Regex: RelayProtocolDoc.Template(r))).ToList();
        var given = ChunkedRequestTests.Broken().Select(c => (string)c[2])
            .Append(ChunkAssemblyBoundsTests.OverfillConnection().Reason).ToList();

        var undocumented = given.Where(g => !rows.Any(r => r.Regex.IsMatch(g))).ToList();
        var unproven = rows.Where(r => !given.Any(g => r.Regex.IsMatch(g))).Select(r => r.Row).ToList();

        Assert.True(undocumented.Count == 0 && unproven.Count == 0,
            "refusals with no row in relay-protocol.md:\n  " + string.Join("\n  ", undocumented) +
            "\nrows no driven refusal gives:\n  " + string.Join("\n  ", unproven));
    }
}
