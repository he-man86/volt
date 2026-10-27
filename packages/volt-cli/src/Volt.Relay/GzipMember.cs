using System;
using System.Globalization;

namespace Volt.Relay
{
    /// <summary>Decoding ONE gzip member (RFC 1952) whose deflate data (RFC 1951) must inflate to an exact length — the
    /// relay's chunked request (openspec relay-chunked-results).
    ///
    /// <para>Written here, not borrowed from <c>GZipStream</c>, because the stream cannot be held to the member's framing
    /// and answers differently per runtime: on net48 (CODESYS in-proc) and net10 (the TwinCAT worker) alike it ends
    /// without an error when the CRC32/ISIZE trailer is missing, and a second member after the first is accepted on one
    /// and read on the other. This decoder knows exactly where the deflate data ends, so it requires what the contract
    /// says the slices ARE: one gzip member, its trailer verified, nothing after it — one answer on both vendor hosts.
    /// The inflater is a port of zlib's <c>contrib/puff</c> (Mark Adler's reference decoder), which counts every input
    /// byte it uses and refuses every malformed code.</para></summary>
    internal static class GzipMember
    {
        /// <summary>Thrown for anything that keeps the slices from being one gzip member of the stated length; its message
        /// completes "the chunks of &lt;id&gt; …".</summary>
        internal sealed class BrokenException : Exception
        {
            public BrokenException(string message) : base(message) { }
        }

        private static string N(long value) => value.ToString(CultureInfo.InvariantCulture);

        private static BrokenException NotInflating(string why) => new BrokenException("do not inflate (" + why + ")");

        /// <summary>The <paramref name="bytes"/> bytes <paramref name="gzip"/>[0, <paramref name="length"/>) inflates to,
        /// or a <see cref="BrokenException"/>. Output past <paramref name="bytes"/> is refused as it happens, so an overlong
        /// set is never inflated whole.</summary>
        public static byte[] Inflate(byte[] gzip, int length, int bytes)
        {
            var at = ReadHeader(gzip, length);
            var output = new byte[bytes];
            var deflate = new Puff(gzip, at, length, output);
            deflate.Run();
            if (deflate.Written < bytes)
                throw new BrokenException("inflate to " + N(deflate.Written) + " B, not the " + N(bytes) + " B chunk 0 states");

            var after = length - deflate.Consumed;
            if (after < 8)
                throw new BrokenException("end without the whole 8-byte gzip trailer (CRC32 and ISIZE): " + N(after) + " B of it arrived");
            if (after > 8)
                throw new BrokenException("carry " + N(after - 8) + " B after the gzip member");
            var trailer = deflate.Consumed;
            if (UInt32(gzip, trailer) != Crc32.Of(output, 0, bytes))
                throw new BrokenException("fail the gzip CRC32 check");
            var isize = UInt32(gzip, trailer + 4);
            if (isize != (uint)bytes)
                throw new BrokenException("end with ISIZE " + N(isize) + " in the gzip trailer, not the " + N(bytes) + " B they inflate to");
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

        /// <summary>RFC 1951 inflate, ported from zlib's <c>contrib/puff/puff.c</c>. Input is taken one byte at a time and
        /// only when a code needs it, so <see cref="Consumed"/> is exactly where the deflate data ends.</summary>
        private sealed class Puff
        {
            private const int MaxBits = 15, MaxLCodes = 286, MaxDCodes = 30, FixLCodes = 288;

            private readonly byte[] _in;
            private readonly int _inEnd;
            private int _inAt;
            private readonly byte[] _out;
            private int _outAt;
            private int _bitBuf, _bitCnt;

            public Puff(byte[] input, int start, int end, byte[] output) { _in = input; _inAt = start; _inEnd = end; _out = output; }

            public int Consumed => _inAt;
            public int Written => _outAt;

            public void Run()
            {
                int last;
                do
                {
                    last = Bits(1);
                    switch (Bits(2))
                    {
                        case 0: Stored(); break;
                        case 1: Codes(Fixed.Length, Fixed.Distance); break;
                        case 2: Dynamic(); break;
                        default: throw NotInflating("deflate block type 3, which does not exist");
                    }
                } while (last == 0);
            }

            private int Bits(int need)
            {
                var val = _bitBuf;
                while (_bitCnt < need)
                {
                    if (_inAt == _inEnd) throw NotInflating("the deflate data ends before its last block");
                    val |= _in[_inAt++] << _bitCnt;
                    _bitCnt += 8;
                }
                _bitBuf = val >> need;
                _bitCnt -= need;
                return val & ((1 << need) - 1);
            }

            private void Put(byte value)
            {
                if (_outAt == _out.Length) throw Overlong();
                _out[_outAt++] = value;
            }

            private BrokenException Overlong() => new BrokenException("inflate past the " + N(_out.Length) + " B chunk 0 states");

            private void Stored()
            {
                _bitBuf = 0;
                _bitCnt = 0;
                if (_inAt + 4 > _inEnd) throw NotInflating("the deflate data ends before its last block");
                var len = _in[_inAt] | _in[_inAt + 1] << 8;
                if (_in[_inAt + 2] != (~len & 0xff) || _in[_inAt + 3] != ((~len >> 8) & 0xff))
                    throw NotInflating("a stored deflate block whose length does not match its complement");
                _inAt += 4;
                if (_inAt + len > _inEnd) throw NotInflating("the deflate data ends before its last block");
                if (_outAt + len > _out.Length) throw Overlong();
                Buffer.BlockCopy(_in, _inAt, _out, _outAt, len);
                _inAt += len;
                _outAt += len;
            }

            private int Decode(Huffman h)
            {
                int code = 0, first = 0, index = 0;
                for (var len = 1; len <= MaxBits; len++)
                {
                    code |= Bits(1);
                    int count = h.Count[len];
                    if (code - count < first) return h.Symbol[index + (code - first)];
                    index += count;
                    first += count;
                    first <<= 1;
                    code <<= 1;
                }
                throw NotInflating("a deflate code that is not in its table");
            }

            private static readonly short[] LBase = { 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258 };
            private static readonly short[] LExt = { 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0 };
            private static readonly short[] DBase = { 1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577 };
            private static readonly short[] DExt = { 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13 };

            private void Codes(Huffman length, Huffman distance)
            {
                int symbol;
                do
                {
                    symbol = Decode(length);
                    if (symbol < 256) Put((byte)symbol);
                    else if (symbol > 256)
                    {
                        symbol -= 257;
                        if (symbol >= 29) throw NotInflating("a deflate length code past the table");
                        var len = LBase[symbol] + Bits(LExt[symbol]);
                        var d = Decode(distance);
                        if (d >= 30) throw NotInflating("a deflate distance code past the table");
                        var dist = DBase[d] + Bits(DExt[d]);
                        if (dist > _outAt) throw NotInflating("a deflate distance before the start of the data");
                        if (_outAt + len > _out.Length) throw Overlong();
                        for (var k = 0; k < len; k++, _outAt++) _out[_outAt] = _out[_outAt - dist];
                    }
                } while (symbol != 256);
            }

            private static readonly byte[] Order = { 16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15 };

            private void Dynamic()
            {
                var nlen = Bits(5) + 257;
                var ndist = Bits(5) + 1;
                var ncode = Bits(4) + 4;
                if (nlen > MaxLCodes || ndist > MaxDCodes) throw NotInflating("a dynamic deflate block with more codes than exist");

                var lengths = new short[MaxLCodes + MaxDCodes];
                int index;
                for (index = 0; index < ncode; index++) lengths[Order[index]] = (short)Bits(3);
                for (; index < 19; index++) lengths[Order[index]] = 0;
                var lencode = new Huffman(MaxLCodes);
                if (lencode.Construct(lengths, 0, 19) != 0) throw NotInflating("an incomplete code-length code");

                index = 0;
                while (index < nlen + ndist)
                {
                    var symbol = Decode(lencode);
                    if (symbol < 16) lengths[index++] = (short)symbol;
                    else
                    {
                        short len = 0;
                        if (symbol == 16)
                        {
                            if (index == 0) throw NotInflating("a repeated code length with nothing before it");
                            len = lengths[index - 1];
                            symbol = 3 + Bits(2);
                        }
                        else if (symbol == 17) symbol = 3 + Bits(3);
                        else symbol = 11 + Bits(7);
                        if (index + symbol > nlen + ndist) throw NotInflating("more code lengths than codes");
                        while (symbol-- > 0) lengths[index++] = len;
                    }
                }
                if (lengths[256] == 0) throw NotInflating("a dynamic deflate block with no end-of-block code");

                var err = lencode.Construct(lengths, 0, nlen);
                if (err < 0 || (err > 0 && nlen - lencode.Count[0] != 1)) throw NotInflating("an incomplete literal/length code");
                var distcode = new Huffman(MaxDCodes);
                err = distcode.Construct(lengths, nlen, ndist);
                if (err < 0 || (err > 0 && ndist - distcode.Count[0] != 1)) throw NotInflating("an incomplete distance code");

                Codes(lencode, distcode);
            }

            private static class Fixed
            {
                public static readonly Huffman Length = new Huffman(FixLCodes);
                public static readonly Huffman Distance = new Huffman(MaxDCodes);

                static Fixed()
                {
                    var lengths = new short[FixLCodes];
                    int symbol;
                    for (symbol = 0; symbol < 144; symbol++) lengths[symbol] = 8;
                    for (; symbol < 256; symbol++) lengths[symbol] = 9;
                    for (; symbol < 280; symbol++) lengths[symbol] = 7;
                    for (; symbol < FixLCodes; symbol++) lengths[symbol] = 8;
                    Length.Construct(lengths, 0, FixLCodes);
                    for (symbol = 0; symbol < MaxDCodes; symbol++) lengths[symbol] = 5;
                    Distance.Construct(lengths, 0, MaxDCodes);
                }
            }

            private sealed class Huffman
            {
                public readonly short[] Count = new short[MaxBits + 1];
                public readonly short[] Symbol;

                public Huffman(int symbols) { Symbol = new short[symbols]; }

                /// <summary>0 for a complete code, negative for an over-subscribed one, positive for an incomplete one.</summary>
                public int Construct(short[] length, int offset, int n)
                {
                    Array.Clear(Count, 0, Count.Length);
                    for (var symbol = 0; symbol < n; symbol++) Count[length[offset + symbol]]++;
                    if (Count[0] == n) return 0;

                    var left = 1;
                    for (var len = 1; len <= MaxBits; len++)
                    {
                        left <<= 1;
                        left -= Count[len];
                        if (left < 0) return left;
                    }

                    var offs = new short[MaxBits + 1];
                    for (var len = 1; len < MaxBits; len++) offs[len + 1] = (short)(offs[len] + Count[len]);
                    for (var symbol = 0; symbol < n; symbol++)
                        if (length[offset + symbol] != 0) Symbol[offs[length[offset + symbol]]++] = (short)symbol;
                    return left;
                }
            }
        }

        /// <summary>CRC-32 (IEEE 802.3, the gzip one).</summary>
        private static class Crc32
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
}
