using System;

namespace Volt.Engine.Format.Body
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

    }
}
