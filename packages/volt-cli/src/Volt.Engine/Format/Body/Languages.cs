using System;

namespace Volt.Engine.Format.Body
{
    /// <summary>The IEC body languages, and the two questions every layer asks about one.
    /// <para><b>Level 0 on purpose:</b> every layer that asks these questions sits above this table, so none of them
    /// has to own it and no layer depends on another just to name a language.</para></summary>
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
