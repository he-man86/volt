using System;
using Volt.Contracts;

namespace Volt.Engine.Seam;

/// <summary>A source kind's FILE layout: how a <see cref="Content"/> is spelled as its workspace file and read back
/// (<c>Write(Read(Write(x))) == Write(x)</c>). Named in the kind's row; the format asks the <see cref="LanguageRegistry"/>
/// for each body under a <c>%LANGUAGE &lt;LANG&gt;</c> line (<see cref="LanguageLine"/>).
/// <para>The layout is not the body language: the IEC layout (<c>PROGRAM … END_PROGRAM</c>, member blocks) holds ST, LD
/// and FBD bodies, and an SCL or L5X layout would hold its own. Hence one format per kind row, one reader per language.</para></summary>
public interface IItemFormat
{
    /// <summary>The format's name: two hosts registering one kind must name the same format.</summary>
    string Name { get; }

    /// <summary>The file of <paramref name="content"/>, an item named <paramref name="name"/> (the bare name the path gives,
    /// for a refusal that names it). A content the layout has no spelling for is refused, coded, naming the item.</summary>
    string Write(Content content, string name);

    /// <summary>Read <paramref name="text"/> as an item of <paramref name="kind"/> named <paramref name="name"/> (the bare
    /// name the path gives), as <paramref name="vendor"/> shows its languages. A text that does not read is the client's:
    /// a coded refusal naming the line.</summary>
    Content Read(string text, string kind, string name, Catalog catalog, string vendor);

    /// <summary>The line of <paramref name="text"/>, this format's file of an item of <paramref name="kind"/> named
    /// <paramref name="name"/>, that holds line <paramref name="objectLine"/> of the vendor object a build diagnostic names
    /// — the item's own (<paramref name="member"/> null) or a member's — counted as a vendor counts it: the object's
    /// declaration lines, then its code lines. Null when the format cannot place it with certainty; the diagnostic then
    /// carries no line (wire-final-shape 3.6b: every line on the wire is a line of the fetched text).</summary>
    int? LineOf(string text, string kind, string name, string? member, int objectLine);
}

/// <summary>THE <c>%LANGUAGE</c> line: one grammar for every format and every vendor (vendor-neutrality S2) — the key
/// (<see cref="Volt.Engine.Format.St.PropertyLines.LanguageKey"/>), a language word, optionally <c>UNSUPPORTED</c>. Which
/// languages a line may state SHOWN comes from the <see cref="LanguageRegistry"/>, not from a list here. A member with no
/// body slot has no line (<see cref="BodyForm.NoSlot"/>).</summary>
public static class LanguageLine
{
    /// <summary>The line of <paramref name="body"/>: <c>%LANGUAGE ST</c>, <c>%LANGUAGE CFC UNSUPPORTED</c>. A member with
    /// no body slot has none, and asking for it is the caller's bug.</summary>
    public static string For(BodyText body) => body.Form switch
    {
        BodyForm.Shown => $"%{Key} {body.Language}",
        BodyForm.Hidden => $"%{Key} {body.Language} {LanguageRegistry.UnsupportedWord}",
        BodyForm.NoSlot => throw new VoltInvariantException("a member with no body slot states no %LANGUAGE line"),
        _ => throw new ArgumentOutOfRangeException(nameof(body)),
    };

    private const string Key = Volt.Engine.Format.St.PropertyLines.LanguageKey;

    /// <summary>Is <paramref name="line"/> a <c>%LANGUAGE</c> line (whatever it states)?</summary>
    public static bool Is(string line) => Volt.Engine.Format.St.PropertyLines.IsLanguageLine(line ?? "");

    /// <summary>What a line states, for <paramref name="vendor"/>: a shown body of a language it shows, or a hidden body of
    /// any language word. The code is filled by the caller. A line that states no language, or a shown language the vendor
    /// does not show, is the text's error (<c>INVALID_ST</c>, the layout code), naming the languages it does show.</summary>
    public static BodyText Parse(string line, LanguageRegistry languages, string vendor)
    {
        line ??= "";
        if (!Is(line)) throw new BridgeException(BridgeErrorCodes.InvalidSt, $"'{line}' is no %{Key} line");
        var words = line.Trim().Substring(1 + Key.Length).Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
        var language = words.Length > 0 ? words[0].ToUpperInvariant() : "";
        var hidden = words.Length == 2 && words[1].Equals(LanguageRegistry.UnsupportedWord, StringComparison.OrdinalIgnoreCase);
        if (words.Length is 0 or > 2 || (words.Length == 2 && !hidden) || !LanguageRegistry.IsLanguageWord(language))
            throw new BridgeException(BridgeErrorCodes.InvalidSt, $"'{line.Trim()}' states no language");
        if (hidden) return BodyText.Hidden(language, "");
        if (!languages.IsShown(language, vendor))
            throw new BridgeException(BridgeErrorCodes.InvalidSt,
                $"'{line.Trim()}': this bridge shows no {language} body (it shows {string.Join(", ", languages.ShownBy(vendor))}); " +
                $"a body it hides is stated '%{Key} {language} {LanguageRegistry.UnsupportedWord}'");
        return BodyText.Shown(language, "");
    }
}
