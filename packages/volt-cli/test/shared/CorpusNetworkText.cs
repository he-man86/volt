using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace Volt.Tests.Shared;

/// <summary>
/// THE CORPORA'S LD/FBD BODIES AS A PULL WRITES THEM (openspec <c>network-text-st</c> 2.1, "Migration": the corpus is
/// re-pulled through the plain-ST writer). The LSP's corpora (<c>packages/volt-lsp-iec/test-corpus/</c>) are each
/// project's pulled workspace, and their LD/FBD bodies are rendered from the recorded archives
/// (<c>test/fixtures/nwl-corpus</c>) exactly as the shipped pull renders an IDE's — <c>ReadShown</c>, then
/// <c>StNetworkWriter.WritePulled</c> against the body's scope — and spliced into the file in place of the body it held.
/// <c>VOLT_WRITE_CORPUS_TEXT=1</c> rewrites the files; otherwise the vendor suites FAIL where a file's body is not what a
/// pull writes, so a writer change and the corpus cannot drift apart.
/// </summary>
public static class CorpusNetworkText
{
    public static bool Writing => Environment.GetEnvironmentVariable("VOLT_WRITE_CORPUS_TEXT") == "1";

    private static readonly Regex LanguageLine = new(@"^%LANGUAGE (LD|FBD)\s*$", RegexOptions.CultureInvariant);

    /// <summary>The body's lines run to the first line that closes or opens an element (<c>END_…</c>, <c>METHOD</c>,
    /// <c>ACTION</c>, <c>PROPERTY</c>), outside an Execute box's CODE string.</summary>
    private static readonly Regex ElementLine = new(@"^(END_[A-Z_]+|METHOD|ACTION|PROPERTY)\b", RegexOptions.CultureInvariant);

    /// <summary><paramref name="file"/>'s text with the LD/FBD body of <paramref name="member"/> (null: the POU's own) put as
    /// <paramref name="pulled"/> — the body as a pull writes it, its <c>%LANGUAGE</c> line first, no newline at its end.</summary>
    public static string Spliced(string file, string? member, string pulled)
    {
        var text = File.ReadAllText(file);
        var crlf = text.Contains("\r\n");
        var lines = text.Replace("\r\n", "\n").Split('\n').ToList();
        var from = 0;
        if (member is not null)
        {
            var header = new Regex(@"^(METHOD|ACTION)\b.*\b" + Regex.Escape(member) + @"\b", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
            from = lines.FindIndex(l => header.IsMatch(l));
            if (from < 0) throw new InvalidDataException($"{file}: no METHOD or ACTION '{member}'");
        }
        var start = lines.FindIndex(from, l => LanguageLine.IsMatch(l));
        if (start < 0) throw new InvalidDataException($"{file}: no LD/FBD body for '{member ?? "(the POU)"}'");
        var end = start + 1;
        char? open = null;
        for (; end < lines.Count; end++)
        {
            var l = lines[end];
            var inString = open is not null;
            open = OpenQuoteAfter(l, open);
            if (!inString && ElementLine.IsMatch(l)) break;
        }
        // the blank lines before the element's own line stay where they are
        var last = end;
        while (last > start + 1 && lines[last - 1].Trim().Length == 0) last--;
        lines.RemoveRange(start, last - start);
        lines.InsertRange(start, pulled.Replace("\r\n", "\n").Split('\n'));
        var joined = string.Join("\n", lines);
        return crlf ? joined.Replace("\n", "\r\n") : joined;
    }

    /// <summary>The quote of the string open at the end of <paramref name="line"/>, which starts inside <paramref name="open"/>'s:
    /// a line of an Execute box's <c>CODE := '…'</c> is its ST, never the element's end.</summary>
    private static char? OpenQuoteAfter(string line, char? open)
    {
        for (var k = 0; k < line.Length; k++)
        {
            var c = line[k];
            if (open is { } q)
            {
                if (c == '$') k++;
                else if (c == q) open = null;
            }
            else if (c == '\'' || c == '"') open = c;
            else if (c == '/' && k + 1 < line.Length && line[k + 1] == '/') break;
        }
        return open;
    }

    /// <summary>Write <paramref name="spliced"/> into <paramref name="file"/> (writing), or say where it differs (checking).</summary>
    public static void Check(string file, string spliced, List<string> stale)
    {
        if (Writing) { File.WriteAllText(file, spliced); return; }
        if (File.ReadAllText(file) != spliced) stale.Add(file);
    }

    public const string Regenerate = "the corpus file's LD/FBD bodies are not what a pull writes — regenerate with VOLT_WRITE_CORPUS_TEXT=1 on the vendor suites";
}
