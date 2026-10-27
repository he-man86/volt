using System;
using System.Globalization;
using System.IO;
using System.IO.Compression;

namespace Volt.Relay
{
    /// <summary>The relay's chunked request as ONE gzip member (RFC 1952) that must inflate to an exact length (openspec
    /// relay-chunked-results). The runtime inflates; the bridge reads the header and checks the trailer itself, exactly as
    /// the relay does: the set's last 8 bytes are CRC32 of the output and ISIZE.
    ///
    /// <para>The deflate data goes to <see cref="DeflateStream"/>, not <see cref="GZipStream"/>, because GZipStream handles
    /// the member's framing differently per runtime (measured 2026-10-27): it checks the trailer itself and refuses a bad
    /// one with its own runtime- and culture-specific message (net10 "The archive entry was compressed using an
    /// unsupported compression method.", net48 the OS language's "invalid data"), it accepts a missing trailer on both,
    /// and it inflates a second member on net10 but not on net48. Handed only the bytes between the header and the last
    /// 8, the inflater sees no framing at all, and every answer is the bridge's own — one answer on both vendor hosts.
    /// A missing or cut trailer leaves something other than the real trailer in the last 8 bytes, so it fails the CRC32
    /// check. Where the deflate data ends is the inflater's and it does not say, so the bridge does NOT check it: bytes
    /// between the end of the deflate data and the last 8 (a second member among them) and deflate data with no final
    /// block pass when the last 8 are the real trailer — the frame served is then the one that trailer vouches for
    /// (known divergences, ChunkFramingTests).</para></summary>
    internal static class Gzip
    {
        /// <summary>Thrown for anything that keeps the slices from being one gzip member of the stated length; its message
        /// completes "the chunks of &lt;id&gt; …".</summary>
        internal sealed class BrokenException : Exception
        {
            public BrokenException(string message) : base(message) { }
        }

        private const int Trailer = 8;

        private static string N(long value) => value.ToString(CultureInfo.InvariantCulture);

        private static BrokenException NotInflating(string why) => new BrokenException("do not inflate (" + why + ")");

        /// <summary>The <paramref name="bytes"/> bytes <paramref name="gzip"/>[0, <paramref name="length"/>) inflates to,
        /// or a <see cref="BrokenException"/>. Inflating stops one byte past <paramref name="bytes"/>, so an overlong set is
        /// never inflated whole.</summary>
        public static byte[] Inflate(byte[] gzip, int length, int bytes)
        {
            var at = ReadHeader(gzip, length);
            var trailer = length - Trailer;
            if (trailer < at)
                throw new BrokenException("are " + N(length) + " B, too short for their " + N(at) +
                                          " B gzip header and the 8-byte trailer (CRC32 and ISIZE)");

            var output = new byte[bytes];
            var written = 0;
            try
            {
                using (var deflate = new DeflateStream(new MemoryStream(gzip, at, trailer - at, writable: false), CompressionMode.Decompress))
                {
                    int n;
                    while (written < bytes && (n = deflate.Read(output, written, bytes - written)) > 0) written += n;
                    if (written == bytes && deflate.ReadByte() >= 0)
                        throw new BrokenException("inflate past the " + N(bytes) + " B chunk 0 states");
                }
            }
            // The runtime's message is its own and in the OS language: the bridge names the defect in its own words.
            catch (InvalidDataException) { throw NotInflating("the deflate data is not valid"); }

            if (UInt32(gzip, trailer) != Crc32.Of(output, 0, written))
                throw new BrokenException("fail the gzip CRC32 check");
            var isize = UInt32(gzip, trailer + 4);
            if (isize != (uint)written)
                throw new BrokenException("end with ISIZE " + N(isize) + " in the gzip trailer, not the " + N(written) + " B they inflate to");
            if (written < bytes)
                throw new BrokenException("inflate to " + N(written) + " B, not the " + N(bytes) + " B chunk 0 states");
            return output;
        }

        private static uint UInt32(byte[] b, int at) =>
            (uint)(b[at] | b[at + 1] << 8 | b[at + 2] << 16 | b[at + 3] << 24);

        /// <summary>Where the deflate data starts: after the fixed 10 bytes and every optional field FLG names.</summary>
        private static int ReadHeader(byte[] gzip, int length)
        {
            const int FHCRC = 0x02, FEXTRA = 0x04, FNAME = 0x08, FCOMMENT = 0x10;
            if (length < 10) throw NotInflating(length >= 2 && gzip[0] == 0x1f && gzip[1] == 0x8b ? "the gzip header is cut short" : "not a gzip header");
            if (gzip[0] != 0x1f || gzip[1] != 0x8b) throw NotInflating("not a gzip header");
            if (gzip[2] != 8) throw NotInflating("gzip compression method " + N(gzip[2]) + ", not deflate");
            var flags = gzip[3];
            if ((flags & 0xE0) != 0) throw NotInflating("reserved gzip header flags are set");

            var at = 10;
            if ((flags & FEXTRA) != 0)
            {
                if (at + 2 > length) throw NotInflating("the gzip header is cut short");
                at += 2 + (gzip[at] | gzip[at + 1] << 8);
            }
            if ((flags & FNAME) != 0) at = PastZero(gzip, at, length);
            if ((flags & FCOMMENT) != 0) at = PastZero(gzip, at, length);
            if ((flags & FHCRC) != 0)
            {
                if (at + 2 > length) throw NotInflating("the gzip header is cut short");
                if ((gzip[at] | gzip[at + 1] << 8) != (Crc32.Of(gzip, 0, at) & 0xFFFF)) throw NotInflating("the gzip header CRC does not match");
                at += 2;
            }
            if (at > length) throw NotInflating("the gzip header is cut short");
            return at;
        }

        private static int PastZero(byte[] gzip, int at, int length)
        {
            if (at > length) throw NotInflating("the gzip header is cut short");
            var zero = Array.IndexOf(gzip, (byte)0, at, length - at);
            if (zero < 0) throw NotInflating("the gzip header is cut short");
            return zero + 1;
        }
    }
}
