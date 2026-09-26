using System.Text.RegularExpressions;

namespace Volt.Engine.Format.St
{
    /// <summary>
    /// <c>(* @volt-implementation *)</c> — the line that says where a POU's DECLARATION ends and its
    /// IMPLEMENTATION begins. A graphical body's marker also names its language:
    /// <c>(* @volt-implementation LD *)</c> / <c>(* @volt-implementation FBD *)</c>.
    ///
    /// <para><b>Why it exists.</b> The vendors keep those two apart (CODESYS writes them through separate
    /// scripting members; <c>WriteSourceText</c> takes them as two arguments), and a Volt workspace keeps one
    /// text per item. Something has to divide that text on push, and until now it was INFERRED — the last
    /// <c>END_VAR</c>, or the end of a wrapped header, then a rule about which trailing comments and pragmas
    /// belonged to which side. Every one of those rules was written after a bug:</para>
    /// <list type="bullet">
    /// <item>trailing comments belong to the declaration — measured on <c>pro2193</c>, whose <c>BitLogic</c> has
    /// fourteen members ending <c>END_VAR</c>, blank, comment, and NOT ONE body starting with a comment. Reading
    /// that comment as the body's first line drifted twenty files.</item>
    /// <item>a wrapped header is one declaration — <c>EXTENDS</c>/<c>IMPLEMENTS</c> on their own lines were being
    /// written into the BODY, so a derived function block's base class landed in its implementation.</item>
    /// <item>a conditional-compile pragma is NOT trivia — <c>{IF defined(X)}</c> opens a block the body closes,
    /// and sweeping the opener into the declaration cut it in half. CODESYS answered "This code is not supported
    /// in declaration part" and "'ELSE' found without matching 'if'".</item>
    /// </list>
    ///
    /// <para><b>The language form.</b> A graphical body's view (FBD or LD) is one property of the whole body, so
    /// network text states it once, here — v1 printed it on every network header, which invited a per-network
    /// edit nothing applied (openspec <c>network-text-literal-nwl</c> 3.3). The marker line then belongs to the
    /// BODY as well as ending the declaration: <see cref="StReader"/> keeps it as the body's first line, so a body
    /// alone says what it is (<c>NetworkText.Is</c>), and <see cref="StWriter"/> writes it in the bare marker's
    /// place rather than beside it. An ST body keeps the bare marker.</para>
    ///
    /// <para><b>It is a COMMENT</b>, so a file carrying it is still valid ST that a vendor's editor accepts, and
    /// it is deliberately the same shape as <see cref="Volt.Engine.Format.Body.BodyMarker"/>'s
    /// <c>(* @volt-graphical: LANG *)</c>.</para>
    ///
    /// <para><b>A file without it is REFUSED, never guessed.</b> Falling back to the old inference would keep
    /// every bug above alive on exactly the inputs nobody tested, and hide which files had been migrated. The
    /// refusal names the fix: pull the project once.</para>
    /// </summary>
    public static class ImplementationMarker
    {
        public const string Text = "(* @volt-implementation *)";

        // Bare, or naming a graphical language. Exact in its words, free in its spacing — the same match the
        // network text reader makes on a body's first line, so the two cannot disagree about what a marker is.
        private static readonly Regex Line = new(@"^\s*\(\*\s*@volt-implementation(?:\s+(FBD|LD))?\s*\*\)\s*$",
                                                 RegexOptions.Compiled | RegexOptions.CultureInvariant);

        /// <summary>The marker of a graphical body in <paramref name="language"/> (<c>FBD</c> or <c>LD</c>).</summary>
        public static string For(string language) => $"(* @volt-implementation {language} *)";

        /// <summary>True when items of this kind HAVE an implementation to separate — and therefore carry the
        /// marker. A GVL and a DUT are a declaration and nothing else; an INTERFACE and its members are
        /// SIGNATURES, so there is no boundary to record and a marker would invent one. The writer and the
        /// reader both ask this, so they cannot disagree about which files carry it — the two of them holding
        /// the same rule separately is how the boundary bugs got in.</summary>
        public static bool AppliesTo(string kind) =>
            kind != Volt.Engine.Item.ItemKind.Kinds.Gvl &&
            kind != Volt.Engine.Item.ItemKind.Kinds.Dut &&
            kind != Volt.Engine.Item.ItemKind.Kinds.Interface &&
            kind != Volt.Engine.Item.ItemKind.Kinds.InterfaceMethod &&
            kind != Volt.Engine.Item.ItemKind.Kinds.InterfaceProperty;

        /// <summary>True when this line IS a marker, bare or with a language (whitespace around it ignored,
        /// nothing else on it).</summary>
        public static bool Is(string line) => Line.IsMatch(line);

        /// <summary>The language a marker line names (<c>FBD</c> / <c>LD</c>), or null for the bare marker and for
        /// a line that is no marker.</summary>
        public static string? LanguageOf(string line)
        {
            var m = Line.Match(line);
            return m.Success && m.Groups[1].Success ? m.Groups[1].Value : null;
        }

        /// <summary>The index of the marker line in <paramref name="lines"/>, or -1.</summary>
        public static int IndexIn(System.Collections.Generic.IList<string> lines, int from = 0)
        {
            for (int i = from; i < lines.Count; i++)
                if (Is(lines[i])) return i;
            return -1;
        }

        /// <summary>A body as the text around it spells it: its marker line and the rest. A graphical body STARTS
        /// with its own marker (the language form), which then stands where the bare marker would; any other body
        /// is preceded by the bare marker.</summary>
        public static (string Marker, string Code) Split(string body)
        {
            var eol = body.IndexOf('\n');
            var first = eol < 0 ? body : body.Substring(0, eol);
            if (LanguageOf(first) is null) return (Text, body);
            return (first.Trim(), eol < 0 ? "" : body.Substring(eol + 1));
        }

        /// <summary>The inverse of <see cref="Split"/>: the body a marker line and the text after it make.</summary>
        public static string Join(string markerLine, string rest) =>
            LanguageOf(markerLine) is null ? rest : rest.Length == 0 ? markerLine.Trim() : markerLine.Trim() + "\n" + rest;
    }
}
