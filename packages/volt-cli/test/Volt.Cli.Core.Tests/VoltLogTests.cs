using System;
using System.IO;
using System.Linq;
using Volt.Cli.Core.Diagnostics;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>The durable logger writes timestamped, source-tagged, leveled lines to a daily per-source file in
/// the shared store — the thing a field issue is diagnosed from (and what the collect-diagnostics zip bundles).</summary>
public class VoltLogTests
{
    [Fact]
    public void A_logged_line_lands_in_the_durable_store_with_timestamp_source_and_level()
    {
        var dir = Path.Combine(Path.GetTempPath(), "volt-log-test-" + Guid.NewGuid().ToString("N"));
        try
        {
            VoltLog.Init("codesys", dir);
            VoltLog.Warn("degraded: no project selected");

            // Filter by THIS source's file (like the Raw test below): VoltLog's dir is process-global, so a
            // parallel test class logging a different source can leak a second file into this dir — not this
            // test's concern. We assert our codesys line landed in a codesys-YYYY-MM-DD.log.
            var file = Assert.Single(Directory.GetFiles(dir, "codesys-*.log"));
            var content = File.ReadAllText(file);
            Assert.Contains("[codesys]", content);
            Assert.Contains("[warn]", content);
            Assert.Contains("degraded: no project selected", content);
            Assert.Matches(@"\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\]", content); // timestamp
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public void A_workers_raw_output_is_tagged_with_the_worker_source()
    {
        var dir = Path.Combine(Path.GetTempPath(), "volt-log-test-" + Guid.NewGuid().ToString("N"));
        try
        {
            VoltLog.Init("connector", dir);
            VoltLog.Raw("twincat", "attached to Untitled1 / PLC1");

            var file = Assert.Single(Directory.GetFiles(dir, "twincat-*.log"));
            Assert.Contains("[twincat] attached to Untitled1 / PLC1", File.ReadAllText(file));
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }
}
