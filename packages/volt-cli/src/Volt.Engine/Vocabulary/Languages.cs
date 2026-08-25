using System;

namespace Volt.Engine.Vocabulary
{
    /// <summary>The IEC body languages, and the two questions every layer asks about one.
    /// <para><b>Level 0 on purpose.</b> These predicates were spelled out at six sites across three namespaces —
    /// the codec registry, the document splice, the graph splice, the network-text gate, the push guard and the
    /// graphical read. Putting the table BELOW all of them is cheaper than making any one of them the owner: the
    /// naive fix is to have the reader ask the codec, but that would make the PLCopen read half — currently free
    /// of every Volt dependency — depend on the body layer, deepening a cycle instead of removing one.</para></summary>
    public static class Languages
    {
        public const string St = "ST";
        public const string Il = "IL";
        public const string Fbd = "FBD";
        public const string Ld = "LD";
        public const string Cfc = "CFC";
        public const string Sfc = "SFC";

        /// <summary>Can this body be authored as NETWORK TEXT and written back? FBD and LD, and nothing else.
        /// Volt round-trips ST textually and FBD/LD graphically; every other language is read-only.</summary>
        public static bool IsNetwork(string? language) =>
            language is Fbd or Ld;

        /// <summary>Is this a DIAGRAM Volt cannot express as text? CFC and SFC.
        /// <para>Deliberately NOT "every read-only language": IL is read-only too, but it is textual, so it has no
        /// diagram to protect and it does not take the marker path for the same reason. Asking
        /// <c>BodyCodec.For(l).ReadOnly</c> answers the wider question, and the two are not interchangeable.</para></summary>
        public static bool IsDiagram(string? language) =>
            language is Cfc or Sfc;

        /// <summary>Is this language's body element nested under <c>&lt;body&gt;/&lt;addData&gt;/&lt;data&gt;</c>
        /// rather than being a direct child of <c>&lt;body&gt;</c>?
        /// <para><b>CFC only</b>, and it is measured: PLCopen TC6 defines ST, IL, FBD, LD and SFC as body
        /// languages, so each gets a direct element named for it; CFC is a CODESYS extension with no place in the
        /// schema, so it goes in a vendor <c>addData</c> block — beside an empty <c>&lt;ST&gt;</c> the schema still
        /// wants, which is the decoy that once made a direct-children scan call a CFC body textual. See DIALECT.md.
        /// <para>The reader used to look for CFC, SFC, FBD <em>and</em> LD in that position while only the CFC
        /// codec ever wrote there. A nested SFC/FBD/LD would therefore have been READ as that language and been
        /// invisible to the writer, whose empty sibling <c>&lt;ST&gt;</c> then qualifies as uncommitted and gets
        /// overwritten. No vendor emits that shape, which is exactly why nothing caught the disagreement.</para></para></summary>
        public static bool NestsInAddData(string? language) =>
            string.Equals(language, Cfc, StringComparison.Ordinal);
    }
}
