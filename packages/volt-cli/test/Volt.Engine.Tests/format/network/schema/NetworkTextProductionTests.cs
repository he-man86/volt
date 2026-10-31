using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text.RegularExpressions;
using Volt.Engine.Format.Network;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Engine.Tests.Format.Network.Schema;

/// <summary>
/// TEXT → MODEL → TEXT OVER EVERY PRODUCTION THE REFERENCE SHOWS (openspec <c>nwl-schema-completeness-gate</c> 2.2): each
/// statement example of <c>docs/network-text.html</c> — the marks, the elements, EN/ENO and outputs, wires, the Execute box —
/// is read and written back, and must come back as itself: a text that reads to a model the writer spells differently is a
/// second spelling. Each example of the Errors table must be refused by the reader. The examples are taken from the page
/// itself, so a production added to the reference is checked without a hand list.
/// </summary>
public class NetworkTextProductionTests
{
    /// <summary>The declarations the reference's examples assume.</summary>
    static readonly string[] Scope =
    {
        "instance t1 TON",
        "fb TON IN PT => Q ET",
        "instance r1 R_TRIG",
        "fb R_TRIG CLK => Q",
        "function f IN IN2 => err",
        "function g IN => Q",
        "program p => OUT",
        "function LIMIT MN IN MX =>",
        "instance f1 Fx",
        "name a b c d e i j k n q t v x y go ok msg count start stop motor lamp speed done s",
    };

    /// <summary>The reference's examples name a function <c>f</c> with an output <c>err</c> and one with none: each statement is
    /// read against both, and any that reads must write back as itself.</summary>
    static IEnumerable<NetworkScope> Scopes() => new[] { "function f IN IN2 => err", "function f IN IN2 =>" }
        .Select(f => new NetworkTextCase("doc", "doc", "", null, null, null, null,
            Scope.Select(l => l.StartsWith("function f ", StringComparison.Ordinal) ? f : l).ToList()).ScopeOf());

    static NetworkScope ScopeOf() => Scopes().First();

    static string Page => File.ReadAllText(Path.Combine(CorpusProjects.CliRoot().FullName, "docs", "network-text.html")).Replace("\r\n", "\n");

    static string Section(string id)
    {
        var start = Page.IndexOf($"<h2 id=\"{id}\">", StringComparison.Ordinal);
        Assert.True(start >= 0, $"the reference has no section '{id}'");
        var end = Page.IndexOf("<h2 ", start + 1, StringComparison.Ordinal);
        return Page.Substring(start, (end < 0 ? Page.Length : end) - start);
    }

    /// <summary>The statements a section shows: every <c>&lt;code&gt;</c> ending in <c>;</c>, and every <c>&lt;pre&gt;</c> — a
    /// network as a whole, or its lines one statement each (the reference aligns <c>:=</c> for reading; one space is the text's).</summary>
    static IEnumerable<string> Statements(string section)
    {
        foreach (Match m in Regex.Matches(section, "<code>([^<]*;)</code>"))
            if (!m.Groups[1].Value.Contains(" : ", StringComparison.Ordinal))   // a declaration, not a statement
                yield return WebUtility.HtmlDecode(m.Groups[1].Value);
        foreach (Match m in Regex.Matches(section, "<pre>(.*?)</pre>", RegexOptions.Singleline))
        {
            var pre = WebUtility.HtmlDecode(m.Groups[1].Value);
            if (pre.StartsWith("%", StringComparison.Ordinal)) { yield return pre; continue; }
            foreach (var st in Lines(pre)) yield return Regex.Replace(st, @"^(\S+) +:=", "$1 :=");
        }
    }

    /// <summary>A block's statements: split after each <c>;</c> that ends a line outside a string (an Execute box's ST spans lines).</summary>
    static IEnumerable<string> Lines(string block)
    {
        var start = 0;
        var inString = false;
        for (var i = 0; i < block.Length; i++)
        {
            if (block[i] == '$' && inString) { i++; continue; }
            if (block[i] == '\'') inString = !inString;
            if (!inString && block[i] == ';' && (i + 1 == block.Length || block[i + 1] == '\n'))
            {
                yield return block.Substring(start, i + 1 - start);
                start = i + 2;
            }
        }
    }

    static string Network(string stmt) => stmt.StartsWith("%LANGUAGE", StringComparison.Ordinal) ? stmt + "\n"
        : "%LANGUAGE LD\n" + (stmt.StartsWith("%NETWORK", StringComparison.Ordinal) ? "" : "%NETWORK\n") + stmt + "\n";

    public static IEnumerable<object[]> Productions() =>
        new[] { "marks", "elements", "outputs", "wires", "execute" }.Select(Section).SelectMany(Statements).Distinct().Select(s => new object[] { s });

    [Theory]
    [MemberData(nameof(Productions))]
    public void A_production_of_the_reference_reads_and_writes_back_as_itself(string statement)
    {
        var text = Network(statement);
        var read = 0;
        var errors = new List<string>();
        foreach (var scope in Scopes())
        {
            NetworkBody body;
            try { body = StNetworkReader.Read(text, scope); }
            catch (StNetworkReadException e) { errors.Add(e.Message); continue; }
            read++;
            Assert.Equal(text, StNetworkWriter.Write(body, scope));
        }
        Assert.True(read > 0, $"'{statement}' reads against none of the reference's declarations: {string.Join("; ", errors)}");
    }

    /// <summary>The Errors table's NETWORK_PARSE rows: the reader's refusals (a NETWORK_UNSUPPORTED row is the push's, against
    /// declarations the example names in prose).</summary>
    public static IEnumerable<object[]> Refusals() =>
        Regex.Matches(Section("diagnostics"), "<tr><td class=\"name\">NETWORK_PARSE</td>(.*?)</tr>").Cast<Match>()
            .SelectMany(m => Statements(m.Groups[1].Value)).Distinct().Select(s => new object[] { s });

    [Theory]
    [MemberData(nameof(Refusals))]
    public void An_error_of_the_reference_is_refused(string statement)
    {
        var text = Network(statement);
        var scope = ScopeOf();
        // a refusal is the reader's (NETWORK_PARSE), or the writer's for a model it has no spelling of (NETWORK_UNSUPPORTED)
        var refused = false;
        try { StNetworkWriter.Write(StNetworkReader.Read(text, scope), scope); }
        catch (StNetworkReadException) { refused = true; }
        catch (StNetworkUnspellableException) { refused = true; }
        Assert.True(refused, $"'{statement}' is accepted");
    }

    [Fact]
    public void The_reference_shows_its_productions()
    {
        Assert.True(Productions().Count() >= 50, $"{Productions().Count()} productions");
        Assert.True(Refusals().Count() >= 8, $"{Refusals().Count()} refusals");
    }
}
