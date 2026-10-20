using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Volt.Contracts;

/// <summary>The <c>grep</c> request: a pattern searched line by line in the text <c>fetch</c> ships for each item
/// (openspec <c>grep-item-sources</c>).</summary>
public class GrepRequest : BoundRequest
{
    /// <summary>What to find in each line: a .NET regular expression, or plain text with <see cref="Literal"/>.
    /// Required and non-empty.</summary>
    [JsonPropertyName("pattern")]
    public string Pattern { get; set; } = "";

    /// <summary>Match <see cref="Pattern"/> as plain text, not as a regular expression. Absent = false.</summary>
    [JsonPropertyName("literal")]
    public bool Literal { get; set; }

    /// <summary>Match case exactly. Absent = false: IEC 61131-3 identifiers are case-insensitive, so <c>fb_motor</c>
    /// finds <c>FB_Motor</c>.</summary>
    [JsonPropertyName("caseSensitive")]
    public bool CaseSensitive { get; set; }

    /// <summary>Path globs, matched ignoring case against the item's path as <c>refs</c> publishes it: <c>*</c> within
    /// one segment, <c>**</c> across segments (zero or more), <c>?</c> one character within a segment. An item is
    /// searched when any glob matches it. Absent = every item; <c>[]</c> = none.</summary>
    [JsonPropertyName("paths")]
    public List<string>? Paths { get; set; }

    /// <summary>The most matches answered, 1–1000. Absent = 200.</summary>
    [JsonPropertyName("limit")]
    public int? Limit { get; set; }
}

/// <summary>The <c>grep</c> answer: the matching LINES, never whole sources.</summary>
public class GrepResponse
{
    /// <summary>Every matching line, in ordinal path order then line order, at most the request's <c>limit</c>.</summary>
    [JsonPropertyName("matches")]
    public List<GrepMatch> Matches { get; set; } = new();

    /// <summary>Path → version for every item with a returned match: the version <c>refs</c> states, so a client knows
    /// whether the item it holds is the one that matched.</summary>
    [JsonPropertyName("items")]
    public Dictionary<string, string> Items { get; set; } = new();

    /// <summary>How many items were searched.</summary>
    [JsonPropertyName("searched")]
    public int Searched { get; set; }

    /// <summary>Every match found, returned or not, counted up to 10000 — where the search stops, so 10000 reads "at
    /// least 10000".</summary>
    [JsonPropertyName("totalMatches")]
    public int TotalMatches { get; set; }

    /// <summary>True when <see cref="TotalMatches"/> exceeds the matches returned.</summary>
    [JsonPropertyName("truncated")]
    public bool Truncated { get; set; }

    /// <summary>Every item in scope whose text, or part of it, was not searched, with why: an item <c>fetch</c> ships no
    /// text for (<c>unreadable</c>, the reason <c>refs</c> gives), or one with a body that reads
    /// <c>IMPLEMENTATION &lt;LANG&gt; UNSUPPORTED</c> (its other lines were searched).</summary>
    [JsonPropertyName("notSearched")]
    public List<NotSearchedItem> NotSearched { get; set; } = new();

    /// <summary>Folders the walk could not enumerate, as <c>refs</c> answers them: what is under them was not searched.</summary>
    [JsonPropertyName("unwalkedFolders")]
    public List<string> UnwalkedFolders { get; set; } = new();
}

/// <summary>One matching line.</summary>
public class GrepMatch
{
    /// <summary>The item's path, <c>&lt;folder&gt;/&lt;name&gt;.&lt;kind&gt;</c>.</summary>
    [JsonPropertyName("path")]
    public string Path { get; set; } = "";

    /// <summary>The 1-based line number in the item's fetched <c>sourceText</c>.</summary>
    [JsonPropertyName("line")]
    public int Line { get; set; }

    /// <summary>The whole line, without its line ending, byte for byte as fetched — cut to 500 characters with
    /// <c>…</c>.</summary>
    [JsonPropertyName("text")]
    public string Text { get; set; } = "";
}

/// <summary>An item in scope whose text, or part of it, was not searched: its path and why.</summary>
public sealed record NotSearchedItem
{
    public NotSearchedItem() { }

    public NotSearchedItem(string name, string reason) { Name = name; Reason = reason; }

    [JsonPropertyName("name")]
    public string Name { get; init; } = "";

    [JsonPropertyName("reason")]
    public string Reason { get; init; } = "";
}
