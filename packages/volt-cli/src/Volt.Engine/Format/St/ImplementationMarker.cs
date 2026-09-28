using System.Collections.Generic;
using System.Text.RegularExpressions;

using Volt.Engine.Format.Body;

namespace Volt.Engine.Format.St
{
    /// <summary>
    /// <c>IMPLEMENTATION &lt;LANG&gt;</c> — the line that says where a body's DECLARATION ends, where its
    /// IMPLEMENTATION begins, and what language that implementation is in: <c>IMPLEMENTATION ST</c>,
    /// <c>IMPLEMENTATION LD</c> or <c>IMPLEMENTATION FBD</c>. The ONE place the spelling lives on the bridge side
    /// (openspec <c>implementation-keyword</c>); the LSP mirrors it in one module of its own.
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
    /// <para><b>Where the language rides in memory.</b> An ST body is written into the IDE as it stands, so it
    /// carries no line; a network-text body's language is one property of the whole body, so its keyword line stays
    /// its FIRST line (<see cref="Volt.Engine.Format.Network.NetworkText.LanguageOf"/>); a body Volt cannot write is
    /// its <see cref="BodyMarker"/> line, which stands in the keyword's place and states that the body has no text
    /// form. <see cref="Split"/> and <see cref="Join"/> are the one translation between the file and that.</para>
    ///
    /// <para><b>A file without the line is REFUSED, never guessed</b> — the refusal names the fix, pull the project
    /// once. The retired comment is not tolerated: there were no users, so there is no translator.</para>
    /// </summary>
    public static class ImplementationMarker
    {
        public const string Keyword = "IMPLEMENTATION";

        // Exactly the keyword and a language a body can state, alone on the line. Spacing is layout and the words are
        // case-insensitive, as ST keywords are.
        private static readonly Regex Line = new(@"^\s*IMPLEMENTATION[ \t]+(ST|LD|FBD)\s*$",
                                                 RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

        // The SHAPE of the line, whatever it states: the keyword alone, or the keyword and one word. A line of this
        // shape that is no boundary line — no language, or one no body can state — is refused NAMING what it
        // states, rather than passing as code the IDE then cannot compile.
        private static readonly Regex Shape = new(@"^\s*IMPLEMENTATION(?:[ \t]+([A-Za-z_][A-Za-z0-9_]*))?\s*$",
                                                  RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

        // The retired comment. Recognised for ONE purpose: to refuse a file from before the change by name, where it
        // stands as that file's boundary. Without it, the pre-change shape of a body Volt cannot write — the comment,
        // THEN the marker line — would find its boundary at the marker line and push the comment into the IDE as the
        // tail of the declaration. Anywhere else it is an ordinary comment (see StReader.SplitAtBoundary).
        private static readonly Regex Retired = new(@"^\s*\(\*\s*@volt-implementation\b[^*]*\*\)\s*$",
                                                    RegexOptions.Compiled | RegexOptions.CultureInvariant);

        /// <summary>The boundary line stating <paramref name="language"/> (<c>ST</c>, <c>LD</c> or <c>FBD</c>).</summary>
        public static string For(string language) => $"{Keyword} {language}";

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

        /// <summary>True when this line IS a boundary line: the keyword and a language, nothing else on it.</summary>
        public static bool Is(string line) => Line.IsMatch(line);

        /// <summary>The language a boundary line states, in its one spelling (<c>ST</c>, <c>LD</c>, <c>FBD</c>), or
        /// null for a line that is no boundary line.</summary>
        public static string? LanguageOf(string line)
        {
            var m = Line.Match(line);
            return m.Success ? m.Groups[1].Value.ToUpperInvariant() : null;
        }

        /// <summary>What a line of the keyword's SHAPE states: <c>""</c> for the keyword alone, the word after it
        /// as written otherwise, and null for a line of any other shape. Only <see cref="Is"/> makes a boundary;
        /// this is how the reader finds the lines it must refuse by name.</summary>
        public static string? Stated(string line)
        {
            var m = Shape.Match(line);
            return !m.Success ? null : m.Groups[1].Success ? m.Groups[1].Value : "";
        }

        /// <summary>The line is spelled like the retired boundary comment. Only standing directly above a marker line
        /// does it mark a file from before the change (refused naming <c>volt pull</c>).</summary>
        public static bool IsRetired(string line) => Retired.IsMatch(line);

        /// <summary>The line opens with a <see cref="BodyMarker"/> — the statement of a body Volt cannot write,
        /// which stands where the keyword line would. Opens, not is: anything after it on the line is the reader's to
        /// refuse by name.</summary>
        public static bool IsMarkerLine(string line) => BodyMarker.Opens(line);

        /// <summary>The index of the line that states the body in <paramref name="lines"/> — one member's region, or
        /// the POU's — or -1. Only a line that starts OUTSIDE every comment counts.
        ///
        /// <para>The FIRST line of the keyword's shape when there is one; otherwise the LAST <see cref="BodyMarker"/>
        /// line. The keyword wins because a marker line is spelled like a comment, and the pull writes a declaration's
        /// comments through verbatim: a declaration may hold <c>(* @volt-graphical: … *)</c> as the engineer's note,
        /// and taking it as the boundary made that item pullable and never pushable. A body that IS a marker is the
        /// whole rest of its region, so its marker line is the last one; any other above it is declaration text. More
        /// than one line of the keyword's shape is the caller's to refuse (<see cref="StatedLinesIn"/>).</para>
        ///
        /// <para>Outside every comment, because <c>IMPLEMENTATION ST</c> is a line an engineer can plausibly write
        /// in documentation. A comment may open after code on its line (bakon-nano: <c>:= TRUE;(*NOT (</c> spanning
        /// lines) and comments NEST, as the LSP lexer nests them — so this asks <see cref="StTrivia"/>, which tracks
        /// both, and not the line-start scan the structure reader uses.</para></summary>
        public static int IndexIn(IList<string> lines)
        {
            var stated = StatedLinesIn(lines);
            if (stated.Count > 0) return stated[0];
            var open = StTrivia.OpenAtStart(lines);
            for (int i = lines.Count - 1; i >= 0; i--)
                if (!open[i] && IsMarkerLine(lines[i])) return i;
            return -1;
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

        /// <summary>A body as the file spells it: its boundary line and the text under it. A network-text body
        /// STARTS with its own keyword line, a body Volt cannot write IS its marker line — the whole body, nothing
        /// else (<see cref="BodyMarker.Is"/>) — and any other body is ST and is headed by <c>IMPLEMENTATION ST</c>,
        /// including an ST body that merely opens with a comment spelled like the marker.</summary>
        public static (string Line, string Code) Split(string body)
        {
            var eol = body.IndexOf('\n');
            var first = eol < 0 ? body : body.Substring(0, eol);
            var rest = eol < 0 ? "" : body.Substring(eol + 1);
            if (LanguageOf(first) is { } lang && Languages.IsNetwork(lang)) return (For(lang), rest);
            if (BodyMarker.Is(body)) return (body.Trim(), "");
            return (For(Languages.St), body);
        }

        /// <summary>The inverse of <see cref="Split"/>, for a body the reader has already checked against the line
        /// that states it: an ST body is its code, a network-text body keeps its keyword line in front, and a body
        /// Volt cannot write is its marker line alone.</summary>
        public static string Join(string line, string code)
        {
            if (IsMarkerLine(line)) return line.Trim();
            var lang = LanguageOf(line) ?? throw new System.ArgumentException($"'{line}' states no body language", nameof(line));
            if (!Languages.IsNetwork(lang)) return code;
            return code.Length == 0 ? For(lang) : For(lang) + "\n" + code;
        }
    }
}
