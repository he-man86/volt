using System;
using System.Linq;
using Volt.Cli.Connector;
using Xunit;

namespace Volt.Cli.Connector.Tests;

/// <summary>The pure parse half of the XAE pid probe — one pid per stdout line, ignoring blanks / noise / dupes.
/// (The spawn+timeout half runs a live subprocess, not unit-tested.)</summary>
public class TwincatXaeProbeTests
{
    [Fact]
    public void Parses_one_pid_per_line()
    {
        Assert.Equal(new[] { 100, 200, 300 }, TwincatXaeProbe.Parse("100\n200\n300\n").OrderBy(x => x));
    }

    [Fact]
    public void Ignores_blank_and_non_numeric_lines_and_dedupes()
    {
        // CRLF, a stray diagnostic line, a blank, and a duplicate pid — only distinct positive pids survive.
        Assert.Equal(new[] { 100, 200 }, TwincatXaeProbe.Parse("100\r\n\r\nlist-xae-pids: oops\n200\n100\n").OrderBy(x => x));
    }

    [Fact]
    public void Empty_output_is_no_pids()
    {
        Assert.Empty(TwincatXaeProbe.Parse(""));
    }

    [Fact]
    public void A_missing_worker_exe_is_a_probe_FAILURE_not_no_xae()
    {
        // ListPids returns null (failure) — NOT an empty list — when it can't run the probe. This is the guard that
        // keeps a persistently-failing probe from reaping every healthy worker: the caller leaves the fleet alone on
        // null and only reaps on a SUCCESSFUL empty enumeration. (An empty list means "ran, saw no XAE".)
        Assert.Null(TwincatXaeProbe.ListPids(null, TimeSpan.FromSeconds(1)));
        Assert.Null(TwincatXaeProbe.ListPids(@"C:\volt\definitely\not\here\VoltBridgeTwincat.exe", TimeSpan.FromSeconds(1)));
    }
}
