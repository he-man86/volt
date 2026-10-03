using System.Collections.Generic;
using System.Text.RegularExpressions;

using Volt.Contracts;
using Volt.Engine.Format.Body;

namespace Volt.Engine.Format.St
{
    /// <summary>
    /// <c>IMPLEMENTATION &lt;LANG&gt;</c> — the line that says where a body's DECLARATION ends, where its
    /// IMPLEMENTATION begins, and what that implementation is: <c>IMPLEMENTATION ST</c>, <c>IMPLEMENTATION LD</c> or
    /// <c>IMPLEMENTATION FBD</c> for a body Volt shows, and <c>IMPLEMENTATION &lt;LANG&gt; UNSUPPORTED</c> for one it does
    /// not. The ONE place the spelling lives on the bridge side (openspec <c>implementation-keyword</c>); the LSP mirrors
    /// it in one module of its own.
    ///
    /// <para><b>Why a boundary is stated at all.</b> The vendors keep the two halves apart (CODESYS writes them
    /// through separate scripting members; <c>WriteSourceText</c> takes them as two arguments), and a Volt workspace
    /// keeps one text per item. Something has to divide that text on push, and it used to be INFERRED — the last
    /// <c>END_VAR</c>, or the end of a wrapped header, then a rule about which trailing comments and pragmas belonged
    /// to which side. Every one of those rules was written after a bug:</para>
    /// <list type="bullet">
    /// <item>trailing comments belong to the declaration — measured on <c>pro2193</c>, whose <c>BitLogic</c> has
    /// fourteen members ending <c>END_VAR</c>, blank, comment, and NOT ONE body starting with a comment. Reading
    /// that comment as the body's first line drifted twenty files.</item>
    /// <item>a wrapped header is one declaration — <c>EXTENDS</c>/<c>IMPLEMENTS</c> on their own lines were being
    /// written into the BODY, so a derived function block's base class landed in its implementation.</item>
    /// <item>a conditional-compile pragma is NOT trivia — <c>{IF defined(X)}</c> opens a block the body closes,
    /// and sweeping the opener into the declaration cut it in half.</item>
    /// </list>
    ///
    /// <para><b>Why a keyword, and why every body states its language.</b> The boundary was
    /// a <c>@volt</c>-tagged comment that every engineer had to have explained, and ST was its unstated
    /// default. A keyword reads like the rest of ST, and a stated language is the ONE signal for how a body is read:
    /// <c>ST</c> goes to the ST path, <c>LD</c>/<c>FBD</c> to network text. A body that contradicts what it states
    /// is refused by name (<see cref="StReader"/>), never re-read as the other language. The price, accepted:
    /// <c>IMPLEMENTATION</c> is not IEC 61131-3, so it is stripped on push and the IDE never sees it, and it is a
    /// reserved name no workspace identifier may take — a name spelled like the line could otherwise be read as one.</para>
    ///
    /// <para><b>A body Volt does not show states that on the same line: its language, then <c>UNSUPPORTED</c></b>
    /// (owner decisions 2026-09-28, sections 2b and 3b). CFC, SFC and IL always — Volt does not read them — and LD/FBD
    /// when the body holds a shape network text has no spelling for yet. One word on every language, because it means
    /// one thing: NO implementation code is shown. The body under the line is empty, a push never writes the IDE's body
    /// (<see cref="Written"/>), and the item's DECLARATION stays editable and is pushed as usual — so a hidden body
    /// blocks neither a pull nor a push, and nothing the IDE holds is overwritten. A bare <c>IMPLEMENTATION CFC</c>
    /// (2b's spelling) is no line a body can state and is refused by name. The line replaced the old marker comment,
    /// which carried the REASON in the file; an LD/FBD body's reason now reaches the pull message instead
    /// (<see cref="Volt.Engine.Item.ItemContent.Unsupported"/>), and no <c>(* @volt-… *)</c> comment of any kind is
    /// written. One in a pushed file is a comment; only where a region has NO boundary line is it read, as the hint that
    /// the file predates the line (<see cref="FindRetiredComment"/>, openspec <c>bridge-refusal-review</c> 2.1).</para>
    ///
    /// <para><b>Where the line rides in memory.</b> An ST body is written into the IDE as it stands, so it carries no
    /// line; a network-text body's language is one property of the whole body, so its keyword line stays its FIRST
    /// line (<see cref="Volt.Engine.Format.Network.NetworkText.LanguageOf"/>); a hidden body IS its line, in its one
    /// spelling (<see cref="IsUnsupportedBody"/>). <see cref="Split"/> and <see cref="Join"/> are the one translation
    /// between the file and that.</para>
    ///
    /// <para><b>A file without the line is REFUSED, never guessed</b> — the refusal names the fix, pull the project
    /// once. The retired comments are not tolerated: there were no users, so there is no translator.</para>
    /// </summary>
    public static class ImplementationMarker
    {
        public const string Keyword = "IMPLEMENTATION";

        /// <summary>The word after a language that states a body Volt does not show.</summary>
        public const string UnsupportedWord = "UNSUPPORTED";

        // Every line a body can state, alone on the line: the keyword, a language, and UNSUPPORTED — which `Parse`
        // requires after CFC, SFC and IL and refuses after ST. Spacing is layout and the words are case-insensitive, as
        // ST keywords are.
        private static readonly Regex Line = new(@"^\s*IMPLEMENTATION[ \t]+(ST|LD|FBD|CFC|SFC|IL)(?:[ \t]+(UNSUPPORTED))?\s*$",
                                                 RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

        // The SHAPE of the line, whatever it states: the keyword alone, or the keyword and whatever follows it on the
        // line, when that opens with a word. A line of this shape that is no boundary line — no language, one no body
        // can state, UNSUPPORTED where it cannot stand, or code after the language — is refused NAMING the line, rather
        // than passing as code the IDE then cannot compile. Opening with a word keeps `IMPLEMENTATION := 1;` out: that
        // names something, and a name is the IDE's to take (openspec bridge-refusal-review 1.2).
        private static readonly Regex Shape = new(@"^\s*IMPLEMENTATION(?:[ \t]+([A-Za-z_].*?))?\s*$",
                                                  RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

        /// <summary>The prefix every retired Volt comment carried after its <c>(*</c>: <c>@volt-implementation</c> on
        /// the boundary, and the same prefix on the marker that stood for a body Volt could not write.</summary>
        private const string RetiredTag = "@volt-";

        /// <summary>The boundary line of a body Volt READS (<c>ST</c>, <c>LD</c> or <c>FBD</c>).</summary>
        public static string For(string language) => $"{Keyword} {language}";

        /// <summary>The line of a body Volt does not show: <c>IMPLEMENTATION &lt;LANG&gt; UNSUPPORTED</c>, for CFC, SFC, IL,
        /// and an LD/FBD body network text cannot represent. Never for ST — Volt shows every ST body.</summary>
        public static string Unsupported(string language) =>
            language is Languages.Ld or Languages.Fbd or Languages.Cfc or Languages.Sfc or Languages.Il
                ? $"{Keyword} {language} {UnsupportedWord}"
                : throw new System.ArgumentException($"'{language}' is no language whose body Volt hides", nameof(language));

        /// <summary>Is this a language Volt never shows a body in — CFC, SFC or IL? Its line always carries
        /// <c>UNSUPPORTED</c>; stated bare, it is refused naming the line to write.</summary>
        public static bool IsNeverShown(string language) =>
            language is Languages.Cfc or Languages.Sfc or Languages.Il;

        /// <summary>True when items of this kind HAVE an implementation to separate — and therefore carry the
        /// line. A GVL and a DUT are a declaration and nothing else; an INTERFACE and its members are SIGNATURES, so
        /// there is no boundary to record and a line would invent one. The writer and the reader both ask this, so
        /// they cannot disagree about which files carry it.</summary>
        public static bool AppliesTo(string kind) =>
            kind != Volt.Engine.Item.ItemKind.Kinds.Gvl &&
            kind != Volt.Engine.Item.ItemKind.Kinds.Dut &&
            kind != Volt.Engine.Item.ItemKind.Kinds.Interface &&
            kind != Volt.Engine.Item.ItemKind.Kinds.InterfaceMethod &&
            kind != Volt.Engine.Item.ItemKind.Kinds.InterfaceProperty;

        /// <summary>What a boundary line states, in its one spelling, or null for a line that is none.</summary>
        private static (string Language, bool Unsupported)? Parse(string line)
        {
            var m = Line.Match(line);
            if (!m.Success) return null;
            var language = m.Groups[1].Value.ToUpperInvariant();
            var unsupported = m.Groups[2].Success;
            // ST is always shown, so UNSUPPORTED after it states nothing; CFC, SFC and IL are never shown, so without it
            // they state nothing either — section 2b's bare `IMPLEMENTATION CFC` is no longer a line (StReader names it).
            if (unsupported ? language == Languages.St : IsNeverShown(language)) return null;
            return (language, unsupported);
        }

        /// <summary>True when this line IS a boundary line — shown or UNSUPPORTED — and nothing else is on it.</summary>
        public static bool Is(string line) => Parse(line) is not null;

        /// <summary>The language a boundary line hands a READER, in its one spelling (<c>ST</c>, <c>LD</c>, <c>FBD</c>),
        /// or null: for a line that is no boundary line, and for an UNSUPPORTED one, whose body no reader reads.</summary>
        public static string? LanguageOf(string line) =>
            Parse(line) is { Unsupported: false } p ? p.Language : null;

        /// <summary>True when this line states a body Volt does not show: <c>IMPLEMENTATION &lt;LANG&gt; UNSUPPORTED</c>.</summary>
        public static bool IsUnsupported(string line) => Parse(line) is { Unsupported: true };

        /// <summary>The language of a body Volt does not show (<see cref="IsUnsupportedBody"/>), or null for any other
        /// body.</summary>
        public static string? UnsupportedLanguageOf(string? body) =>
            IsUnsupportedBody(body) ? Parse(body!.Trim())!.Value.Language : null;

        /// <summary>The body a driver WRITES for <paramref name="body"/>: the body itself, or null — "leave the IDE's
        /// implementation alone", the word both vendors' writers already have for a slot not to touch — for a body Volt
        /// does not show. The ONE place that decision is made, and every writer on both vendors asks it.
        ///
        /// <para>An UNSUPPORTED line has no text form: written into the IDE it would replace a chart or a ladder with
        /// the words of the line — or, where the aspect has no text document at all (a CODESYS CFC POU), fail after
        /// the declaration had committed, so that a project holding one diagram could never be pushed again. Null
        /// keeps the IDE's body byte for byte and lets the declaration land, which is what makes the declaration of a
        /// hidden body editable.</para></summary>
        public static string? Written(string? body) => IsUnsupportedBody(body) ? null : body;

        /// <summary>A boundary line in its one spelling — single spaces, upper case — however it was typed.</summary>
        public static string Canonical(string line) =>
            Parse(line) is { } p
                ? p.Unsupported ? Unsupported(p.Language) : $"{Keyword} {p.Language}"
                : throw new System.ArgumentException($"'{line}' is no {Keyword} line", nameof(line));

        /// <summary>Is this body a body Volt does not show — its UNSUPPORTED line, alone? The whole body, and nothing
        /// else: a body that is the line and more is no such body (the reader refuses code under the line before it
        /// gets here).</summary>
        public static bool IsUnsupportedBody(string? body)
        {
            if (body is null) return false;
            var text = body.Trim();
            return text.IndexOf('\n') < 0 && IsUnsupported(text);
        }

        /// <summary>What a line of the keyword's SHAPE states: <c>""</c> for the keyword alone, what follows it as
        /// written otherwise, and null for a line of any other shape. Only <see cref="Is"/> makes a boundary; this is
        /// how the reader finds the lines it must refuse by name.</summary>
        public static string? Stated(string line)
        {
            var m = Shape.Match(line);
            return !m.Success ? null : m.Groups[1].Success ? m.Groups[1].Value.Trim() : "";
        }

        /// <summary>The first <c>(* @volt-… *)</c> comment in <paramref name="lines"/> — a comment of a Volt from before
        /// the keyword — as its line index and its text on that line, or null. Only a real comment counts: <c>(*</c>
        /// inside a string, a pragma or a <c>//</c> comment opens nothing (<see cref="StTrivia"/>). A comment NESTED in
        /// another counts too — "no Volt comment survives" has no depth at which it stops holding.</summary>
        public static (int Line, string Text)? FindRetiredComment(IList<string> lines)
        {
            foreach (var (line, column) in StTrivia.CommentOpenings(lines))
            {
                var text = lines[line];
                var after = text.Substring(column + 2).TrimStart();
                if (!after.StartsWith(RetiredTag, System.StringComparison.OrdinalIgnoreCase)) continue;
                var close = text.IndexOf("*)", column + 2, System.StringComparison.Ordinal);
                return (line, (close < 0 ? text.Substring(column) : text.Substring(column, close + 2 - column)).Trim());
            }
            return null;
        }

        /// <summary>The index of the line that states the body in <paramref name="lines"/> — one member's region, or
        /// the POU's — or -1: the first line of the keyword's shape that starts OUTSIDE every comment. More than one is
        /// the caller's to refuse (<see cref="StatedLinesIn"/>).
        ///
        /// <para>Outside every comment, because <c>IMPLEMENTATION ST</c> is a line an engineer can plausibly write
        /// in documentation. A comment may open after code on its line (bakon-nano: <c>:= TRUE;(*NOT (</c> spanning
        /// lines) and comments NEST, as the LSP lexer nests them — so this asks <see cref="StTrivia"/>, which tracks
        /// both, and not the line-start scan the structure reader uses.</para></summary>
        public static int IndexIn(IList<string> lines)
        {
            var stated = StatedLinesIn(lines);
            return stated.Count > 0 ? stated[0] : -1;
        }

        /// <summary>Every line of the keyword's SHAPE (<see cref="Stated"/>) outside every comment, in order.</summary>
        public static List<int> StatedLinesIn(IList<string> lines)
        {
            var open = StTrivia.OpenAtStart(lines);
            var found = new List<int>();
            for (int i = 0; i < lines.Count; i++)
                if (!open[i] && Stated(lines[i]) is not null) found.Add(i);
            return found;
        }

        /// <summary>An ST body the IDE holds, as a driver hands it up — refused when a line of it has the keyword's
        /// shape outside every comment.
        ///
        /// <para>In memory an ST body carries no line (<see cref="Split"/> gives it <c>IMPLEMENTATION ST</c> on the way
        /// to the file), so its text alone must not read as one of the other bodies. An ST body whose whole text is
        /// <c>IMPLEMENTATION CFC UNSUPPORTED</c> is indistinguishable from a CFC body, one opening <c>IMPLEMENTATION LD</c> from a
        /// ladder, and one holding the line further down gives a file with two boundaries. Pulled, each states a
        /// language the body does not have; pushed back, it is skipped as UNSUPPORTED, written as network text, or
        /// refused forever. Only the driver knows the body is ST, so it asks here, and the item is refused by name
        /// (the pull lists it unreadable) instead of pulled under the wrong language. Such text does not compile in the
        /// IDE either, so the fix is an edit there.</para></summary>
        public static string RequireStBody(string body)
        {
            var lines = body.Replace("\r\n", "\n").Split('\n');
            var stated = StatedLinesIn(lines);
            if (stated.Count == 0) return body;
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"the ST body in the IDE holds the line '{lines[stated[0]].Trim()}' (line {stated[0] + 1}), which a " +
                $"workspace file reads as the {Keyword} line that states a body's language, so the body cannot be " +
                "pulled as ST. Edit that line in the IDE.");
        }

        /// <summary>A body as the file spells it: its boundary line and the text under it. A network-text body
        /// STARTS with its own keyword line, an UNSUPPORTED body IS its line and has nothing under it, and any other body
        /// is ST and is headed by <c>IMPLEMENTATION ST</c>.</summary>
        public static (string Line, string Code) Split(string body)
        {
            if (IsUnsupportedBody(body)) return (Canonical(body.Trim()), "");
            var eol = body.IndexOf('\n');
            var first = eol < 0 ? body : body.Substring(0, eol);
            var rest = eol < 0 ? "" : body.Substring(eol + 1);
            if (LanguageOf(first) is { } lang && Languages.IsNetwork(lang)) return (For(lang), rest);
            return (For(Languages.St), body);
        }

        /// <summary>The inverse of <see cref="Split"/>, for a body the reader has already checked against the line
        /// that states it: an ST body is its code, a network-text body keeps its keyword line in front, and an UNSUPPORTED
        /// body is its line alone, in its one spelling.</summary>
        public static string Join(string line, string code)
        {
            if (IsUnsupported(line)) return Canonical(line);
            var lang = LanguageOf(line) ?? throw new System.ArgumentException($"'{line}' states no body language", nameof(line));
            if (!Languages.IsNetwork(lang)) return code;
            return code.Length == 0 ? For(lang) : For(lang) + "\n" + code;
        }
    }
}
