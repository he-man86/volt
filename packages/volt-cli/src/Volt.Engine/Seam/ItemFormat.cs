using System;
using System.Text.RegularExpressions;
using Volt.Contracts;

namespace Volt.Engine.Seam;

/// <summary>A source kind's FILE layout: how a <see cref="Content"/> is spelled as its workspace file and read back
/// (<c>Write(Read(Write(x))) == Write(x)</c>). Named in the kind's row; the format asks the <see cref="LanguageRegistry"/>
/// for each body under an <c>IMPLEMENTATION &lt;LANG&gt;</c> line (<see cref="ImplementationLine"/>).
/// <para>The layout is not the body language: the IEC layout (<c>PROGRAM … END_PROGRAM</c>, member blocks) holds ST, LD
/// and FBD bodies, and an SCL or L5X layout would hold its own. Hence one format per kind row, one reader per language.</para></summary>
public interface IItemFormat
{
    /// <summary>The format's name: two hosts registering one kind must name the same format.</summary>
    string Name { get; }

    string Write(Content content);

    /// <summary>Read <paramref name="text"/> as an item of <paramref name="kind"/> named <paramref name="name"/> (the bare
    /// name the path gives), as <paramref name="vendor"/> shows its languages. A text that does not read is the client's:
    /// a coded refusal naming the line.</summary>
    Content Read(string text, string kind, string name, Catalog catalog, string vendor);
}

/// <summary>THE <c>IMPLEMENTATION</c> line: one grammar for every format and every vendor (vendor-neutrality S2). Which
/// languages a line may state SHOWN comes from the <see cref="LanguageRegistry"/>, not from a list here.</summary>
public static class ImplementationLine
{
    public const string Keyword = "IMPLEMENTATION";

    private static readonly Regex Shape = new(@"^\s*IMPLEMENTATION[ \t]+([A-Za-z_][A-Za-z0-9_]*)(?:[ \t]+(UNSUPPORTED))?\s*$",
                                              RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

    /// <summary>The line of <paramref name="body"/>: <c>IMPLEMENTATION ST</c>, <c>IMPLEMENTATION CFC UNSUPPORTED</c>,
    /// <c>IMPLEMENTATION NONE</c>.</summary>
    public static string For(BodyText body) => body.Form switch
    {
        BodyForm.Shown => $"{Keyword} {body.Language}",
        BodyForm.Hidden => $"{Keyword} {body.Language} {LanguageRegistry.UnsupportedWord}",
        BodyForm.Abstract => $"{Keyword} {LanguageRegistry.NoneWord}",
        _ => throw new ArgumentOutOfRangeException(nameof(body)),
    };

    /// <summary>Does <paramref name="line"/> have the line's shape (whatever language it states)?</summary>
    public static bool Is(string line) => Shape.IsMatch(line ?? "");

    /// <summary>What a line states, for <paramref name="vendor"/>: a shown body of a language it shows, a hidden body of any
    /// language word, or an abstract member. The code is filled by the caller. A shown language the vendor does not show
    /// is the text's error (<c>INVALID_ST</c>, the layout code), naming the languages it does show.</summary>
    public static BodyText Parse(string line, LanguageRegistry languages, string vendor)
    {
        line ??= "";
        var m = Shape.Match(line);
        if (!m.Success) throw new BridgeException(BridgeErrorCodes.InvalidSt, $"'{line}' is no {Keyword} line");
        var language = m.Groups[1].Value.ToUpperInvariant();
        var hidden = m.Groups[2].Success;
        if (language == LanguageRegistry.NoneWord && !hidden) return BodyText.Abstract;
        if (!LanguageRegistry.IsLanguageWord(language))
            throw new BridgeException(BridgeErrorCodes.InvalidSt, $"'{line.Trim()}' states no language");
        if (hidden) return BodyText.Hidden(language, "");
        if (!languages.IsShown(language, vendor))
            throw new BridgeException(BridgeErrorCodes.InvalidSt,
                $"'{line.Trim()}': this bridge shows no {language} body (it shows {string.Join(", ", languages.ShownBy(vendor))}); " +
                $"a body it hides is stated '{Keyword} {language} {LanguageRegistry.UnsupportedWord}'");
        return BodyText.Shown(language, "");
    }
}
