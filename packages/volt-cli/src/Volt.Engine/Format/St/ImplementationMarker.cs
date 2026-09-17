namespace Volt.Engine.Format.St
{
    /// <summary>
    /// <c>(* @volt-implementation *)</c> — the line that says where a POU's DECLARATION ends and its
    /// IMPLEMENTATION begins.
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
    /// <para>Three exceptions to one guess, each paid for in data. And the guess is invisible when it is wrong:
    /// the two halves are re-joined on read, so the bytes round-trip byte-for-byte while the IDE holds them
    /// split in the wrong place. A marker ends the class — there is nothing left to classify.</para>
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

        /// <summary>True when this line IS the marker (leading/trailing whitespace ignored, nothing else on it).</summary>
        public static bool Is(string line) => line.Trim() == Text;

        /// <summary>The index of the marker line in <paramref name="lines"/>, or -1.</summary>
        public static int IndexIn(System.Collections.Generic.IList<string> lines, int from = 0)
        {
            for (int i = from; i < lines.Count; i++)
                if (Is(lines[i])) return i;
            return -1;
        }
    }
}
