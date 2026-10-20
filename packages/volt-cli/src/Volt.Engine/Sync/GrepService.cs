using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Engine.Library;

namespace Volt.Engine.Sync;

/// <summary><c>grep</c>: search the text <c>fetch</c> ships for each item, line by line, and answer the matching LINES
/// with the versions of the items they are in (openspec <c>grep-item-sources</c>).
///
/// <para><b>What is searched is what <c>fetch</c> ships as text</b>, from the same walk (<see cref="ProjectSnapshot"/>)
/// and the same materialization: an item's text here IS its <c>sourceText</c> there and the text its <c>refs</c> version
/// hashes, so a matched line is the fetched line at that number. No list of kinds or languages decides it: a network-text
/// body is searched because the bridge ships it as text, and a body that reads <c>IMPLEMENTATION &lt;LANG&gt;
/// UNSUPPORTED</c> is named in <c>notSearched</c> because its line is all the text there is. Libraries are out of scope —
/// a <c>.library</c> item and the signatures a fetch renders for it.</para></summary>
public static class GrepService
{
    public const int DefaultLimit = 200;
    public const int MaxLimit = 1000;

    /// <summary>Where the search stops counting, so a pattern such as <c>.</c> cannot make it unbounded.</summary>
    public const int CountCap = 10_000;

    /// <summary>The longest line text answered; a longer one is cut here and ends in <c>…</c>.</summary>
    public const int TextCap = 500;

    /// <summary>How long one line may take to match — a catastrophic pattern is refused, not run to the end.</summary>
    public static readonly TimeSpan LineTimeout = TimeSpan.FromMilliseconds(100);

    private sealed record Candidate(string Path, string Version, string Text);

    public static GrepResponse Handle(IIdeDriver ide, GrepRequest request, Action<ProgressFrame>? onProgress = null)
    {
        OpGuard.RequireBoundProject(ide, request.ExpectedPlatform, request.ExpectedProjectName);

        // Everything the request can get wrong is refused here, before the walk: nothing is searched for it.
        var limit = request.Limit ?? DefaultLimit;
        if (limit < 1 || limit > MaxLimit)
            throw new BridgeException(BridgeErrorCodes.BadRequest, $"`limit` must be 1–{MaxLimit}, not {limit}");
        var line = Pattern(request);
        var globs = request.Paths?.Select(Glob).ToList();
        bool InScope(string path) => globs is null || globs.Any(g => g.IsMatch(path));

        var sw = Stopwatch.StartNew();
        var candidates = new List<Candidate>();
        var notSearched = new List<NotSearchedItem>();
        void OnItem(ProjectItem it, string kind, string folder, VersionedItem v)
        {
            if (kind == ItemKind.Kinds.Library || v.Materialized is not { } mat || !InScope(v.Identity)) return;
            candidates.Add(new Candidate(v.Identity, v.Version, mat.Text));
            if (mat.Hidden.Count > 0)
                notSearched.Add(new NotSearchedItem(v.Identity, string.Join("; ", mat.Hidden.Select(Hidden))));
        }
        var snap = ProjectSnapshot.Walk(ide, onProgress, Ops.Grep, phase: "searching", onItem: OnItem);
        // The items fetch ships no text for, as refs names them — every one the walk saw, of known kind or not.
        notSearched.AddRange(snap.Unreadable
            .Where(u => InScope(u.Name) && !u.Name.EndsWith(LibraryFetch.LibraryExt, StringComparison.OrdinalIgnoreCase))
            .Select(u => new NotSearchedItem(u.Name, u.Reason)));

        var response = new GrepResponse
        {
            NotSearched = notSearched.OrderBy(n => n.Name, StringComparer.Ordinal).ToList(),
            UnwalkedFolders = snap.UnwalkedFolders.ToList(),
        };
        foreach (var c in candidates.OrderBy(c => c.Path, StringComparer.Ordinal))
        {
            if (response.TotalMatches >= CountCap) break;
            response.Searched++;
            var number = 0;
            foreach (var text in Lines(c.Text))
            {
                number++;
                if (!Matches(line, text, request.Pattern, c.Path, number)) continue;
                response.TotalMatches++;
                if (response.Matches.Count < limit)
                {
                    response.Matches.Add(new GrepMatch { Path = c.Path, Line = number, Text = Cut(text) });
                    response.Items[c.Path] = c.Version;
                }
                if (response.TotalMatches >= CountCap) break;
            }
        }
        response.Truncated = response.TotalMatches > response.Matches.Count;

        VoltLog.Debug($"grep: {response.TotalMatches} match(es) in {response.Searched} item(s), {response.NotSearched.Count} " +
                      $"not searched{(response.Truncated ? ", truncated" : "")} ({sw.ElapsedMilliseconds}ms)");
        return response;
    }

    /// <summary>The per-line matcher the request states: its regular expression, or its text as plain text — both under
    /// one case rule (<c>CultureInvariant</c>, ignoring case unless <c>caseSensitive</c>), so a literal and the regex
    /// that spells it match the same lines.</summary>
    private static Regex Pattern(GrepRequest request)
    {
        if (string.IsNullOrEmpty(request.Pattern))
            throw new BridgeException(BridgeErrorCodes.BadRequest, "a grep needs a `pattern`: the text or regular expression to find");
        var options = RegexOptions.CultureInvariant | (request.CaseSensitive ? RegexOptions.None : RegexOptions.IgnoreCase);
        try { return new Regex(request.Literal ? Regex.Escape(request.Pattern) : request.Pattern, options, LineTimeout); }
        catch (ArgumentException ex)
        {
            throw new BridgeException(BridgeErrorCodes.BadRequest,
                $"`pattern` is not a valid regular expression: {ex.Message} (send `literal: true` to find it as plain text)");
        }
    }

    private static bool Matches(Regex line, string text, string pattern, string path, int number)
    {
        try { return line.IsMatch(text); }
        catch (RegexMatchTimeoutException)
        {
            throw new BridgeException(BridgeErrorCodes.BadRequest,
                $"the pattern `{pattern}` timed out after {LineTimeout.TotalMilliseconds:0} ms on line {number} of {path}, " +
                "so nothing is answered: simplify it, or send `literal: true`");
        }
    }

    /// <summary>A path glob as a regular expression over the whole path, ignoring case: <c>**/</c> any leading
    /// segments (none included), <c>**</c> anything, <c>*</c> anything within a segment, <c>?</c> one character within a
    /// segment, every other character itself.</summary>
    private static Regex Glob(string glob)
    {
        var sb = new StringBuilder("^");
        for (var i = 0; i < glob.Length; i++)
        {
            var c = glob[i];
            if (c == '*' && i + 1 < glob.Length && glob[i + 1] == '*')
            {
                i++;
                if (i + 1 < glob.Length && glob[i + 1] == '/') { i++; sb.Append("(?:.*/)?"); }
                else sb.Append(".*");
            }
            else if (c == '*') sb.Append("[^/]*");
            else if (c == '?') sb.Append("[^/]");
            else sb.Append(Regex.Escape(c.ToString()));
        }
        return new Regex(sb.Append('$').ToString(), RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
    }

    /// <summary>The text's lines without their line endings — the lines a client sees when it splits the fetched text,
    /// so line N here is line N there. A text ending in a line ending has no empty line after it.</summary>
    private static IEnumerable<string> Lines(string text)
    {
        var lines = text.Split('\n');
        var count = lines.Length > 0 && lines[lines.Length - 1].Length == 0 ? lines.Length - 1 : lines.Length;
        for (var i = 0; i < count; i++)
            yield return lines[i].EndsWith("\r", StringComparison.Ordinal) ? lines[i].Substring(0, lines[i].Length - 1) : lines[i];
    }

    private static string Cut(string text)
    {
        if (text.Length <= TextCap) return text;
        var keep = char.IsHighSurrogate(text[TextCap - 1]) ? TextCap - 1 : TextCap;
        return text.Substring(0, keep) + "…";
    }

    private static string Hidden(HiddenBody h) =>
        $"{(h.Member is null ? "its body" : $"the body of '{h.Member}'")} reads IMPLEMENTATION {h.Language} UNSUPPORTED" +
        (h.Reason is { } why ? $" ({why})" : "");
}
