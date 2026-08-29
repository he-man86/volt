using System;
using System.Linq;
using Volt.Connector;
using Volt.Wire;
using Xunit;
using Volt.Contracts;

namespace Volt.Connector.Tests;

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
    public void The_worker_cli_flags_are_spelled_once_and_pinned()
    {
        // The connector reaches the TwinCAT worker by process argv, a contract with no ProjectReference behind it.
        // Both sides now reference WorkerCli, so a rename is a build error rather than a child that exits non-zero,
        // a probe that reads as "failed", and an XAE that silently never gets a bridge. The VALUES are pinned here
        // too: they are also read by an already-installed worker exe, so changing one is a compatibility break, not
        // a rename. (Referencing the consts at all is half the point — it is what makes the rename fail to compile.)
        Assert.Equal("--list-xae-pids", WorkerCli.ListXaePids);
        Assert.Equal("--xae-pid", WorkerCli.XaePid);
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
