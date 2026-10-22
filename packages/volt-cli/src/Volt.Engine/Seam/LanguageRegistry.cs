using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Volt.Engine.Ide;

namespace Volt.Engine.Seam;

/// <summary>What a shown language's reader is handed besides the code: the declarations the body sees (its own, innermost
/// first, then its owner's) and the declarations the push itself carries, which answer before the IDE's.</summary>
public sealed record BodyContext(string? Declaration, PushedDeclarations Pushed)
{
    /// <summary>A body read outside any push (a test, a pull's own round trip).</summary>
    public static BodyContext Bare(string? declaration) => new(declaration, PushedDeclarations.None);
}

/// <summary>A shown language's reader: validates the code under its <c>IMPLEMENTATION &lt;LANG&gt;</c> line and returns the
/// model a host writes from (<see cref="PushedBody.Model"/>) — or throws the coded refusal, naming what does not read.
/// Network text's reader returns its network model; a plain-text language returns the code itself.</summary>
public interface IBodyReader
{
    object Read(string code, BodyContext context);
}

/// <summary>A language whose body is its text: nothing to validate, the model is the code (ST, SCL, a test vendor's own).</summary>
public sealed class PlainTextReader : IBodyReader
{
    public static readonly PlainTextReader Instance = new();
    private PlainTextReader() { }
    public object Read(string code, BodyContext context) => code;
}

/// <summary>One body language as a vendor declares it: with a <see cref="Reader"/> the vendor SHOWS it (its line is
/// <c>IMPLEMENTATION &lt;Name&gt;</c>, the body editable), without one it only HIDES it (<c>IMPLEMENTATION &lt;Name&gt; UNSUPPORTED</c>).</summary>
public sealed record LanguageRow(string Name, IBodyReader? Reader)
{
    public static LanguageRow Shown(string name, IBodyReader reader) =>
        new(name, reader ?? throw new ArgumentNullException(nameof(reader)));

    public static LanguageRow Hidden(string name) => new(name, null);
}

/// <summary>
/// THE body languages (vendor-neutrality S2): the <c>IMPLEMENTATION &lt;LANG&gt;</c> line keeps ONE grammar
/// (<see cref="ImplementationLine"/>), and which languages are shown comes from the readers the hosts register.
/// <para>A language NAME is one grammar across vendors — <c>IMPLEMENTATION FBD</c> means network text wherever it is
/// read — so two hosts registering two different readers under one name are refused. Whether a vendor SHOWS a language
/// is its own: one vendor may show <c>FBD</c> while another only hides it.</para>
/// </summary>
public sealed class LanguageRegistry
{
    /// <summary>The words the line reserves: an abstract member's <c>IMPLEMENTATION NONE</c>, and the hidden marker.</summary>
    public const string NoneWord = "NONE";
    public const string UnsupportedWord = "UNSUPPORTED";

    private static readonly Regex Word = new("^[A-Z][A-Z0-9_]*$", RegexOptions.CultureInvariant);

    private readonly Dictionary<string, IBodyReader?> _readers = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _readerOwner = new(StringComparer.Ordinal);
    private readonly Dictionary<string, SortedSet<string>> _shownBy = new(StringComparer.Ordinal);

    /// <summary>Is <paramref name="name"/> a word the line can state as a language?</summary>
    public static bool IsLanguageWord(string? name) =>
        name is not null && Word.IsMatch(name) && name != NoneWord && name != UnsupportedWord;

    public void Register(string vendor, IEnumerable<LanguageRow> rows)
    {
        if (rows is null) throw new ArgumentNullException(nameof(rows));
        foreach (var row in rows) Register(vendor, row);
    }

    public void Register(string vendor, LanguageRow row)
    {
        if (row is null) throw new ArgumentNullException(nameof(row));
        if (!IsLanguageWord(row.Name))
            throw new InvalidOperationException(
                $"vendor '{vendor}' cannot register the language '{row.Name}': a language is an upper-case word, and " +
                $"{NoneWord} and {UnsupportedWord} are the line's own words");
        if (!_readers.TryGetValue(row.Name, out var held)) _readers[row.Name] = null;
        if (row.Reader is { } reader)
        {
            if (held is not null && held.GetType() != reader.GetType())
                throw new InvalidOperationException(
                    $"vendor '{vendor}' reads '{row.Name}' with {reader.GetType().Name}, but '{_readerOwner[row.Name]}' reads it " +
                    $"with {held.GetType().Name}: one language name is one grammar");
            if (held is null) { _readers[row.Name] = reader; _readerOwner[row.Name] = vendor; }
            if (!_shownBy.TryGetValue(row.Name, out var shown)) _shownBy[row.Name] = shown = new SortedSet<string>(StringComparer.Ordinal);
            shown.Add(vendor);
        }
    }

    /// <summary>Every language a host registered (shown or hidden), in ordinal order.</summary>
    public IReadOnlyList<string> Names => _readers.Keys.OrderBy(x => x, StringComparer.Ordinal).ToList();

    /// <summary>Does <paramref name="vendor"/> show <paramref name="language"/>?</summary>
    public bool IsShown(string language, string vendor) =>
        _shownBy.TryGetValue(language ?? "", out var v) && v.Contains(vendor);

    /// <summary>The languages <paramref name="vendor"/> shows, in ordinal order: what <c>health</c> reports per bridge in
    /// protocol 2 (<c>languages</c>, instead of the one <c>networkText</c> bool).</summary>
    public IReadOnlyList<string> ShownBy(string vendor) =>
        _shownBy.Where(kv => kv.Value.Contains(vendor)).Select(kv => kv.Key).OrderBy(x => x, StringComparer.Ordinal).ToList();

    /// <summary>The reader of a shown language. A language nobody shows has none: Volt's bug to ask, refused by name.</summary>
    public IBodyReader Reader(string language) =>
        _readers.TryGetValue(language ?? "", out var r) && r is not null
            ? r
            : throw new ArgumentException($"no host reads the language '{language}'", nameof(language));
}
