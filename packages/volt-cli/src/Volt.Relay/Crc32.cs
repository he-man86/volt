namespace Volt.Relay
{
    /// <summary>CRC-32 (IEEE 802.3), the one a gzip trailer carries. Here because neither net48 nor netstandard2.0 ships one
    /// (System.IO.Hashing is a package, a second DLL in the IDE's process for 15 lines). Pinned by its published check value,
    /// CRC32("123456789") = 0xCBF43926 (ChunkFramingTests).</summary>
    internal static class Crc32
    {
        private static readonly uint[] Table = Build();

        private static uint[] Build()
        {
            var table = new uint[256];
            for (uint n = 0; n < 256; n++)
            {
                var c = n;
                for (var k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
                table[n] = c;
            }
            return table;
        }

        public static uint Of(byte[] data, int start, int count)
        {
            var crc = 0xFFFFFFFFu;
            for (var i = start; i < start + count; i++) crc = Table[(crc ^ data[i]) & 0xff] ^ (crc >> 8);
            return ~crc;
        }
    }
}
