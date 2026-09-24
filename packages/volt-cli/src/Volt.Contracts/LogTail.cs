using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace Volt.Contracts;

/// <summary>Reads the tail of a VoltLog directory.
///
/// <para>A pure function over a directory and a source name, deliberately: it is the whole of the
/// <c>logs</c> op's logic, and a host is an expensive thing to stand up in a test. <see cref="BridgePipeHost"/>
/// does nothing but call this and wrap the result.</para>
///
/// <para>It reads. It never writes, never prunes and never creates the directory — VoltLog owns all three,
/// and a diagnostic op that mutates the thing it is diagnosing is its own bug report.</para></summary>
public static class LogTail
{
    public const int DefaultMaxBytes = 64 * 1024;
    public const int HardCapBytes = 1024 * 1024;

    /// <summary>Read the last <paramref name="maxBytes"/> of <paramref name="source"/>'s log, newest lines
    /// last, cut at a line boundary.</summary>
    /// <param name="dir">The VoltLog directory. A missing directory is "nothing logged yet", not an error.</param>
    /// <param name="source">The host's OWN source. Other sources' files in the same directory are not read —
    /// see the remarks.</param>
    /// <param name="maxBytes">Null for the default; clamped to the hard cap.</param>
    /// <exception cref="IOException">A file that exists and cannot be read. Deliberately NOT swallowed: an
    /// empty string would read as "nothing happened", which is the opposite of the truth and the single most
    /// misleading answer this op could give.</exception>
    /// <remarks>
    /// <para><b>This source only.</b> The directory holds every component's files (`connector-*.log` sits
    /// beside `codesys-*.log`). A host answers for itself; a caller that wants the connector's tail asks the
    /// connector. Mixing them would interleave two clocks and two processes into one apparent story.</para>
    ///
    /// <para><b>Spills backwards across days.</b> Files rotate daily, so at 00:05 today's file is a few lines
    /// long. Stopping there would answer "the bridge did almost nothing" precisely when someone is asking what
    /// it did overnight — so the walk continues into the previous day's file until the budget is spent or the
    /// files run out.</para>
    ///
    /// <para><b>Opened shared for read AND write.</b> VoltLog is appending to the newest file while this
    /// reads it. <see cref="FileShare.ReadWrite"/> is not defensive padding: without it the read throws
    /// exactly when the bridge is busy, which is when the tail is wanted.</para>
    /// </remarks>
    public static LogsResponse Read(string dir, string source, int? maxBytes = null)
    {
        var budget = Math.Min(Math.Max(maxBytes ?? DefaultMaxBytes, 1), HardCapBytes);
        var response = new LogsResponse { Source = source };

        if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return response;

        // Newest first. Ordinal on `{source}-{yyyy-MM-dd}.log` sorts by date because the date is fixed-width
        // and big-endian — the reason VoltLog writes it that way round.
        var files = new List<string>(Directory.GetFiles(dir, source + "-*.log"));
        files.Sort(StringComparer.Ordinal);
        files.Reverse();
        if (files.Count == 0) return response;

        var chunks = new List<string>();
        var used = 0;

        foreach (var file in files)
        {
            if (used >= budget) { response.Truncated = true; break; }

            var (text, hadMore) = ReadTailOf(file, budget - used);
            if (text.Length == 0 && !hadMore) continue;

            chunks.Add(text);
            response.Files.Add(Path.GetFileName(file));
            used += Encoding.UTF8.GetByteCount(text);
            if (hadMore) { response.Truncated = true; break; }
        }

        chunks.Reverse(); // oldest chunk first, so the text reads forwards in time
        response.Text = string.Join("", chunks);
        return response;
    }

    /// <summary>The last <paramref name="budget"/> bytes of one file, cut forward to the next line boundary.
    /// Returns the text and whether anything was left behind.</summary>
    private static (string Text, bool HadMore) ReadTailOf(string path, int budget)
    {
        using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
        {
            var length = fs.Length;
            if (length == 0) return ("", false);

            var take = (int)Math.Min(length, budget);
            var hadMore = take < length;
            fs.Seek(length - take, SeekOrigin.Begin);

            var buffer = new byte[take];
            var read = 0;
            while (read < take)
            {
                var n = fs.Read(buffer, read, take - read);
                if (n <= 0) break;
                read += n;
            }

            var text = Encoding.UTF8.GetString(buffer, 0, read);

            // A mid-line cut leaves a fragment at the FRONT. Drop it: half a line is not a log line, and the
            // caller cannot tell which half it got. `truncated` already says something was dropped.
            if (hadMore)
            {
                var nl = text.IndexOf('\n');
                text = nl >= 0 ? text.Substring(nl + 1) : "";
            }

            return (text, hadMore);
        }
    }
}
