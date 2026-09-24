using System;
using System.IO;
using System.Text;
using Volt.Contracts;
using Xunit;

namespace Volt.Contracts.Tests;

/// <summary>
/// The whole of the <c>logs</c> op's logic. It is a pure function over a directory precisely so it can be
/// tested without standing up a host, and the cases below are the ones a real support call hits: a bridge
/// asked at 00:05, a file another process is still appending to, and a budget smaller than the day.
/// </summary>
public class LogTailTests : IDisposable
{
    private readonly string _dir;

    public LogTailTests()
    {
        _dir = Path.Combine(Path.GetTempPath(), "volt-logtail-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_dir);
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch { /* best effort */ }
    }

    private void Write(string name, string content) =>
        File.WriteAllText(Path.Combine(_dir, name), content);

    private static string Lines(string prefix, int count)
    {
        var sb = new StringBuilder();
        for (var i = 0; i < count; i++) sb.Append(prefix).Append(i).Append('\n');
        return sb.ToString();
    }

    // ── the "nothing yet" answers, which must not look like failures ──

    /// <summary>A fresh install, or logging never enabled. This is a REAL answer: an error here would send a
    /// support conversation chasing a broken log path when the truth is that nothing has happened yet.</summary>
    [Fact]
    public void No_directory_is_an_empty_answer_not_an_error()
    {
        var res = LogTail.Read(Path.Combine(_dir, "does-not-exist"), "codesys");
        Assert.Equal("", res.Text);
        Assert.Empty(res.Files);
        Assert.False(res.Truncated);
    }

    [Fact]
    public void No_files_for_this_source_is_an_empty_answer()
    {
        Write("connector-2026-09-24.log", "not mine\n");
        var res = LogTail.Read(_dir, "codesys");
        Assert.Equal("", res.Text);
        Assert.Empty(res.Files);
    }

    /// <summary>The directory is shared by every component. A bridge answers for ITSELF — interleaving the
    /// connector's clock and process into the same apparent story is worse than returning less.</summary>
    [Fact]
    public void Another_sources_files_are_never_read()
    {
        Write("codesys-2026-09-24.log", "mine\n");
        Write("connector-2026-09-24.log", "SECRET-OTHER-SOURCE\n");
        Write("twincat-2026-09-24.log", "SECRET-OTHER-SOURCE\n");

        var res = LogTail.Read(_dir, "codesys");
        Assert.Contains("mine", res.Text);
        Assert.DoesNotContain("SECRET-OTHER-SOURCE", res.Text);
        Assert.Single(res.Files);
    }

    // ── ordering and the day boundary ──

    [Fact]
    public void Text_reads_forwards_in_time()
    {
        Write("codesys-2026-09-23.log", "older\n");
        Write("codesys-2026-09-24.log", "newer\n");

        var res = LogTail.Read(_dir, "codesys");
        Assert.True(
            res.Text.IndexOf("older", StringComparison.Ordinal) <
            res.Text.IndexOf("newer", StringComparison.Ordinal),
            $"expected chronological order, got: {res.Text}");
    }

    /// <summary>The 00:05 case. Today's file is two lines long and the question is about last night — stopping
    /// at the day boundary would answer "the bridge did almost nothing" exactly when that is most misleading.
    /// </summary>
    [Fact]
    public void Spills_into_the_previous_day_when_today_is_short()
    {
        Write("codesys-2026-09-23.log", Lines("yesterday-", 50));
        Write("codesys-2026-09-24.log", "today-only-line\n");

        var res = LogTail.Read(_dir, "codesys");
        Assert.Contains("today-only-line", res.Text);
        Assert.Contains("yesterday-49", res.Text);
        Assert.Equal(2, res.Files.Count);
    }

    [Fact]
    public void Files_are_listed_newest_first()
    {
        Write("codesys-2026-09-22.log", "a\n");
        Write("codesys-2026-09-23.log", "b\n");
        Write("codesys-2026-09-24.log", "c\n");

        var res = LogTail.Read(_dir, "codesys");
        Assert.Equal(
            new[] { "codesys-2026-09-24.log", "codesys-2026-09-23.log", "codesys-2026-09-22.log" },
            res.Files);
    }

    // ── the budget ──

    [Fact]
    public void Returns_the_NEWEST_lines_when_the_budget_is_small()
    {
        Write("codesys-2026-09-24.log", Lines("line-", 500));

        var res = LogTail.Read(_dir, "codesys", maxBytes: 200);
        Assert.True(res.Truncated);
        Assert.Contains("line-499", res.Text);
        Assert.DoesNotContain("line-0\n", res.Text);
    }

    /// <summary>A cut lands mid-line and leaves a fragment at the FRONT. Half a line is not a log line and the
    /// caller cannot tell which half it got, so it is dropped — `truncated` already says something went.</summary>
    [Fact]
    public void A_truncated_read_never_starts_mid_line()
    {
        Write("codesys-2026-09-24.log", Lines("aaaaaaaaaaaaaaaaaaaa-", 100));

        var res = LogTail.Read(_dir, "codesys", maxBytes: 150);
        Assert.True(res.Truncated);
        foreach (var line in res.Text.Split('\n'))
            Assert.True(line.Length == 0 || line.StartsWith("aaaaaaaaaaaaaaaaaaaa-", StringComparison.Ordinal),
                $"line starts mid-way: '{line}'");
    }

    [Fact]
    public void Truncated_is_false_when_everything_fitted()
    {
        Write("codesys-2026-09-24.log", "short\n");
        var res = LogTail.Read(_dir, "codesys", maxBytes: 64 * 1024);
        Assert.False(res.Truncated);
        Assert.Equal("short\n", res.Text);
    }

    /// <summary>This crosses a pipe and possibly a network. A caller asking for "everything" on a bridge that
    /// has been up a fortnight is asking for the retention window.</summary>
    [Fact]
    public void A_huge_request_is_capped_rather_than_honoured()
    {
        Write("codesys-2026-09-24.log", Lines("x-", 200_000));

        var res = LogTail.Read(_dir, "codesys", maxBytes: int.MaxValue);
        Assert.True(Encoding.UTF8.GetByteCount(res.Text) <= LogTail.HardCapBytes);
        Assert.True(res.Truncated);
    }

    [Fact]
    public void A_nonsense_budget_does_not_throw()
    {
        Write("codesys-2026-09-24.log", Lines("x-", 10));
        foreach (var budget in new[] { 0, -1, int.MinValue })
        {
            var res = LogTail.Read(_dir, "codesys", budget);
            Assert.NotNull(res.Text);
        }
    }

    // ── concurrency and failure ──

    /// <summary>VoltLog is appending to the newest file while this reads it. Without FileShare.ReadWrite the
    /// read throws exactly when the bridge is busy — which is when the tail is wanted.</summary>
    [Fact]
    public void Reads_a_file_that_is_being_appended_to()
    {
        var path = Path.Combine(_dir, "codesys-2026-09-24.log");
        File.WriteAllText(path, "first\n");

        using (var writer = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite))
        {
            var bytes = Encoding.UTF8.GetBytes("second\n");
            writer.Write(bytes, 0, bytes.Length);
            writer.Flush();

            var res = LogTail.Read(_dir, "codesys");
            Assert.Contains("first", res.Text);
        }
    }

    [Fact]
    public void An_empty_file_is_skipped_not_listed()
    {
        Write("codesys-2026-09-24.log", "");
        var res = LogTail.Read(_dir, "codesys");
        Assert.Equal("", res.Text);
        Assert.Empty(res.Files);
    }

    [Fact]
    public void The_source_is_echoed_back()
    {
        Write("twincat-2026-09-24.log", "hello\n");
        Assert.Equal("twincat", LogTail.Read(_dir, "twincat").Source);
    }
}
