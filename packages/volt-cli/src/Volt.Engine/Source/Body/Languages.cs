using System;

namespace Volt.Engine.Source.Body
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
        /// Volt round-trips ST textually and FBD/LD graphically; CFC, SFC and IL are unsupported.</summary>
        public static bool IsNetwork(string? language) =>
            language is Fbd or Ld;

        /// <summary>Is this a DIAGRAM Volt cannot express as text? CFC and SFC.
        /// <para>Also the answer to WHERE such a body may sit. TC6 gives ST, IL, FBD, LD and SFC a direct
        /// <c>&lt;body&gt;</c> child named for the language; CFC is a CODESYS extension the schema has no place
        /// for, so it goes under a vendor <c>addData</c> block — beside an empty <c>&lt;ST&gt;</c> the schema
        /// still wants, the decoy that once made a direct-children scan call a CFC body textual.
        /// <see cref="T:Volt.Engine.Source.Body.BodyElement"/> looks for a diagram in BOTH positions, which widens a
        /// rule that had been narrowed to CFC alone: a diagram has no write path, so finding one anywhere can
        /// only lead to a refusal, whereas a nested SFC that goes unfound is flattened through that same decoy.
        /// FBD and LD are excluded for the mirror-image reason — Volt writes those, so recognising one in a
        /// position Volt would not write it back to is how the reader and the writer came to disagree.</para>
        /// <para>Deliberately NOT "every unsupported language": IL is unsupported too, but it is textual, so it
        /// has no diagram to protect and never sits in the nested position. <c>BodyCodec.For(l).Unsupported</c>
        /// answers that wider question, and the two are not interchangeable.</para></summary>
        public static bool IsDiagram(string? language) =>
            language is Cfc or Sfc;
    }
}
