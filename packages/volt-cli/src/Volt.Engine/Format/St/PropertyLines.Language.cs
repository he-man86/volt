using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

using Volt.Contracts;
using Volt.Engine.Format.Body;

namespace Volt.Engine.Format.St;

/// <summary>
/// <c>%LANGUAGE &lt;LANG&gt;</c> — the property line that ends a body's declaration, starts its body and states what the
/// body is (openspec <c>language-line</c>): <c>%LANGUAGE ST</c>, <c>%LANGUAGE LD</c> or <c>%LANGUAGE FBD</c> for a body
/// Volt shows, and <c>%LANGUAGE &lt;LANG&gt; UNSUPPORTED</c> for one it does not. One of the closed keys
/// (<see cref="PropertyLines.Keys"/>, first of them), so there is one <c>%</c>-line grammar; the LSP mirrors it in
/// <c>frontend/syntax/format/object-properties.ts</c>.
///
/// <para><b>Why a boundary is stated at all.</b> The vendors keep a declaration and a body apart, and a Volt workspace
/// keeps one text per item, so something divides that text on push. Inferring it — the last <c>END_VAR</c>, a wrapped
/// header, which trailing comments belong to which side — is wrong on real projects.</para>
///
/// <para><b>The line.</b> The key, then one language word, then optionally <c>UNSUPPORTED</c>; the words in any case,
/// single spaces in the one spelling (<see cref="CanonicalLanguageLine"/>). The language picks the reader: <c>ST</c> the ST
/// path, <c>LD</c>/<c>FBD</c> network text. <c>UNSUPPORTED</c> states a body Volt does not show — always after CFC, SFC
/// and IL, after a language Volt has never seen (the vendor's own word, <see cref="VendorLanguage"/>), and after LD/FBD
/// for a body network text cannot spell; never after ST. Nothing stands under such a line, and a push never writes that
/// body (<see cref="Written"/>), while the declaration above it stays editable.</para>
///
/// <para><b>No line.</b> A METHOD, or a property's GET/SET, whose IDE object has no body slot (DIALECT C2n) is written
/// with no <c>%LANGUAGE</c> line and nothing after its declaration; its property lines close the declaration. Every other
/// body states its line, and a region with none is refused naming the fix, <c>volt pull</c>.</para>
///
/// <para><b>Where the line rides in memory.</b> An ST body is written into the IDE as it stands, so it carries no line;
/// a network-text body keeps its line as its FIRST line (<see cref="Volt.Engine.Format.Network.NetworkText.LanguageOf"/>);
/// a hidden body IS its line. <see cref="SplitBody"/> and <see cref="JoinBody"/> are the one translation between the file
/// and that.</para>
/// </summary>
public static partial class PropertyLines
{
    public const string LanguageKey = "LANGUAGE";

    /// <summary>The word after a language that states a body Volt does not show.</summary>
    public const string UnsupportedWord = "UNSUPPORTED";

    /// <summary>The line of a body Volt READS (<c>ST</c>, <c>LD</c> or <c>FBD</c>).</summary>
    public static string LanguageLine(string language) => $"%{LanguageKey} {language}";

    /// <summary>The line of a body Volt does not show: <c>%LANGUAGE &lt;LANG&gt; UNSUPPORTED</c>, for CFC, SFC, IL, an
    /// LD/FBD body network text cannot represent, and a language Volt has never seen under the vendor's own name for it
    /// (<see cref="VendorLanguage"/>). Never for ST — Volt shows every ST body.</summary>
    public static string UnsupportedLine(string language) =>
        language != Languages.St && IsLanguageWord(language)
            ? $"%{LanguageKey} {language} {UnsupportedWord}"
            : throw new ArgumentException($"'{language}' is no language whose body Volt hides", nameof(language));

    /// <summary>A language Volt has never seen — an unknown view mode, body aspect or archive root — as the line states
    /// it: the vendor's own name, upper case. Its body is hidden like a CFC chart's, so the item's declaration and members
    /// still pull. Two names stay refused, naming them: one that is no word, which the line cannot state, and ST, which
    /// Volt never hides (niche: accepted loss, 0 occurrences in the six corpora).</summary>
    public static string VendorLanguage(string vendorName)
    {
        var language = vendorName.ToUpperInvariant();
        if (!IsLanguageWord(language))
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"the body's language is '{vendorName}', a name Volt has never seen and cannot state on its %{LanguageKey} " +
                "line, where a language is a word.");
        if (language == Languages.St)
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"the body's language is '{vendorName}' in a form Volt does not read, and Volt shows every ST body — it " +
                "has no line for a hidden one.");
        return language;
    }

    /// <summary>A word the line can state as a language — and not the word UNSUPPORTED itself.</summary>
    private static bool IsLanguageWord(string language) =>
        LanguageWord.IsMatch(language) && !language.Equals(UnsupportedWord, StringComparison.OrdinalIgnoreCase);

    private static readonly Regex LanguageWord = new(@"^[A-Za-z_][A-Za-z0-9_]*$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>Is this a language Volt never shows a body in — CFC, SFC or IL? Its line always carries UNSUPPORTED.</summary>
    private static bool IsNeverShown(string language) => language is Languages.Cfc or Languages.Sfc or Languages.Il;

    /// <summary>One of the three languages a reader reads: ST, LD, FBD.</summary>
    private static bool IsRead(string language) => language is Languages.St or Languages.Ld or Languages.Fbd;

    /// <summary>Is <paramref name="line"/> a <c>%LANGUAGE</c> line — the key, whatever it states? Such a line is never
    /// code (no IEC direct address opens <c>%L</c>), so it is the body's boundary or it is refused, naming what it lacks
    /// (<see cref="LanguageLineProblem"/>).</summary>
    public static bool IsLanguageLine(string line) => KeyOf(line) == LanguageKey;

    /// <summary>What a <c>%LANGUAGE</c> line states, in its one spelling, or null for a line that states nothing a body can.</summary>
    private static (string Language, bool Unsupported)? ParseLanguage(string line)
    {
        if (!IsLanguageLine(line)) return null;
        var words = ValueWords(line);
        if (words.Length is 0 or > 2) return null;
        var language = words[0].ToUpperInvariant();
        if (!IsLanguageWord(language)) return null;
        if (words.Length == 2)
            return words[1].Equals(UnsupportedWord, StringComparison.OrdinalIgnoreCase) && language != Languages.St
                ? (language, true) : null;
        return IsRead(language) ? (language, false) : null;
    }

    /// <summary>The words after the key, split at spaces and tabs.</summary>
    private static string[] ValueWords(string line)
    {
        var t = line.Trim();
        return t.Substring(1 + LanguageKey.Length).Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
    }

    /// <summary>Why a <c>%LANGUAGE</c> line states no body, as the refusal says it — or null for a line that states one.</summary>
    public static string? LanguageLineProblem(string line)
    {
        if (ParseLanguage(line) is not null) return null;
        var words = ValueWords(line);
        var readLines = $"{LanguageLine(Languages.St)}, {LanguageLine(Languages.Ld)} or {LanguageLine(Languages.Fbd)}";
        if (words.Length == 0) return $"it states no language — a body states one: {readLines}";
        var word = words[0].ToUpperInvariant();
        if (words.Length == 1 && IsNeverShown(word))
            return $"Volt shows no {word} body, so its line is '{UnsupportedLine(word)}', with nothing under it. Pull the " +
                   "item again to get it";
        if (words.Length == 2 && word == Languages.St && words[1].Equals(UnsupportedWord, StringComparison.OrdinalIgnoreCase))
            return $"Volt shows every ST body, so ST is never {UnsupportedWord}: state '{LanguageLine(Languages.St)}'";
        return $"'{string.Join(" ", words)}' is no language a body can state. The line states one of ST, LD or FBD, or — " +
               "for a body Volt does not show — its language (LD, FBD, CFC, SFC, IL or the IDE's own word) and " +
               $"{UnsupportedWord}. Code goes under the line, and a body in another language is edited in the IDE";
    }

    /// <summary>The language a <c>%LANGUAGE</c> line hands a READER, in its one spelling (<c>ST</c>, <c>LD</c>,
    /// <c>FBD</c>), or null: for a line that is no such line, and for an UNSUPPORTED one, whose body no reader reads.</summary>
    public static string? LanguageOf(string line) => ParseLanguage(line) is { Unsupported: false } p ? p.Language : null;

    /// <summary>True when this line states a body Volt does not show: <c>%LANGUAGE &lt;LANG&gt; UNSUPPORTED</c>.</summary>
    public static bool IsUnsupportedLine(string line) => ParseLanguage(line) is { Unsupported: true };

    /// <summary>The language of a body Volt does not show (<see cref="IsUnsupportedBody"/>), or null for any other body.</summary>
    public static string? UnsupportedLanguageOf(string? body) =>
        IsUnsupportedBody(body) ? ParseLanguage(body!.Trim())!.Value.Language : null;

    /// <summary>Is this body one Volt does not show — its UNSUPPORTED line, alone?</summary>
    public static bool IsUnsupportedBody(string? body)
    {
        if (body is null) return false;
        var text = body.Trim();
        return text.IndexOf('\n') < 0 && IsUnsupportedLine(text);
    }

    /// <summary>The body a driver WRITES for <paramref name="body"/>: the body itself, or null — "leave the IDE's
    /// implementation alone", the word both vendors' writers have for a slot not to touch — for a body Volt does not show,
    /// and for a member with no body slot (no body at all). The ONE place that decision is made.</summary>
    public static string? Written(string? body) => IsUnsupportedBody(body) ? null : body;

    /// <summary>A <c>%LANGUAGE</c> line in its one spelling — single spaces, upper case — however it was typed.</summary>
    private static string CanonicalLanguageLine(string line) =>
        ParseLanguage(line) is { } p
            ? p.Unsupported ? UnsupportedLine(p.Language) : LanguageLine(p.Language)
            : throw new ArgumentException($"'{line}' states no body language", nameof(line));

    /// <summary>Every <c>%LANGUAGE</c> line (<see cref="IsLanguageLine"/>, the key alone) outside every comment, in order,
    /// in <paramref name="lines"/> — one member's region, or the POU's. The first states the body; more than one is the
    /// caller's to refuse. Outside every comment, nested ones and those opened after code included (<see cref="StTrivia"/>).</summary>
    public static List<int> LanguageLinesIn(IList<string> lines)
    {
        var open = StTrivia.OpenAtStart(lines);
        var found = new List<int>();
        for (int i = 0; i < lines.Count; i++)
            if (!open[i] && IsLanguageLine(lines[i])) found.Add(i);
        return found;
    }

    /// <summary>The line the format no longer reads — <c>IMPLEMENTATION</c>, a word, optionally <c>UNSUPPORTED</c>, alone
    /// on its line — outside every comment in <paramref name="lines"/>, or null. Named in one refusal: a region that
    /// states no <c>%LANGUAGE</c> line and holds this one is a file written before the line was renamed.</summary>
    public static string? RetiredLineIn(IList<string> lines)
    {
        var open = StTrivia.OpenAtStart(lines);
        for (int i = 0; i < lines.Count; i++)
            if (!open[i] && RetiredLine.IsMatch(lines[i])) return lines[i].Trim();
        return null;
    }

    /// <summary>The refusal of <see cref="RetiredLineIn"/>'s line, naming it and <paramref name="what"/>.</summary>
    public static BridgeException RetiredLineRefusal(string what, string line) =>
        new(BridgeErrorCodes.InvalidSt,
            $"{what} holds '{line}': `IMPLEMENTATION` is no longer read — pull again (it is now `%{LanguageKey} <LANG>`).");

    private static readonly Regex RetiredLine = new(@"^\s*IMPLEMENTATION[ \t]+[A-Za-z_][A-Za-z0-9_]*(?:[ \t]+UNSUPPORTED)?\s*$",
                                                    RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

    /// <summary>An ST body the IDE holds, as a driver hands it up — refused when a line of it IS a <c>%LANGUAGE</c> line
    /// outside every comment: in memory an ST body carries no line, so such a body would read back from the file as
    /// another body (a hidden one, a ladder, or a body with two boundaries). Such text does not compile in the IDE either,
    /// so the fix is an edit there; the pull lists the item unreadable, by name.</summary>
    public static string RequireStBody(string body)
    {
        var lines = body.Replace("\r\n", "\n").Split('\n');
        var stated = LanguageLinesIn(lines);
        if (stated.Count == 0) return body;
        throw new BridgeException(BridgeErrorCodes.Unsupported,
            $"the ST body in the IDE holds the line '{lines[stated[0]].Trim()}' (line {stated[0] + 1}), which a workspace " +
            $"file reads as the %{LanguageKey} line that states a body's language, so the body cannot be pulled as ST. Edit " +
            "that line in the IDE.");
    }

    /// <summary>A body as the file spells it: its <c>%LANGUAGE</c> line and the text under it. A network-text body STARTS
    /// with its own line, an UNSUPPORTED body IS its line and has nothing under it, and any other body is ST and is headed
    /// by <c>%LANGUAGE ST</c>.</summary>
    public static (string Line, string Code) SplitBody(string body)
    {
        if (IsUnsupportedBody(body)) return (CanonicalLanguageLine(body.Trim()), "");
        var eol = body.IndexOf('\n');
        var first = eol < 0 ? body : body.Substring(0, eol);
        var rest = eol < 0 ? "" : body.Substring(eol + 1);
        if (LanguageOf(first) is { } lang && Languages.IsNetwork(lang)) return (LanguageLine(lang), rest);
        return (LanguageLine(Languages.St), body);
    }

    /// <summary>The inverse of <see cref="SplitBody"/>, for a body the reader has already checked against its line: an ST
    /// body is its code, a network-text body keeps its line in front, and an UNSUPPORTED body is its line alone.</summary>
    public static string JoinBody(string line, string code)
    {
        if (IsUnsupportedLine(line)) return CanonicalLanguageLine(line);
        var lang = LanguageOf(line) ?? throw new ArgumentException($"'{line}' states no body language", nameof(line));
        if (!Languages.IsNetwork(lang)) return code;
        return code.Length == 0 ? LanguageLine(lang) : LanguageLine(lang) + "\n" + code;
    }
}
