using System;
using System.IO;
using System.Linq;
using Volt.Wire;
using Xunit;
using Volt.Contracts;

namespace Volt.Contracts.Tests;

/// <summary>The durable logger writes timestamped, source-tagged, leveled lines to a daily per-source file in
/// the shared store — the thing a field issue is diagnosed from.</summary>
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

    /// <summary>Retention deletes only what this source OWNS. The log store is shared: the installer drops
    /// <c>install-*.log</c> / <c>uninstall-*.log</c> there, LogWindow surfaces them in the support bundle and
    /// `scripts/test-install.ts` reads them — none of which is a VoltLog source, so nothing else would ever
    /// re-create them. A component that prunes its neighbours' files destroys the record of the install a
    /// support case is about.</summary>
    [Fact]
    public void Retention_prunes_only_this_sources_own_files()
    {
        var dir = Path.Combine(Path.GetTempPath(), "volt-log-test-" + Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(dir);
            var stale = DateTime.Now.AddDays(-30);
            var foreign = Path.Combine(dir, "install-20260101.log");   // the installer's, not ours
            var mine = Path.Combine(dir, "connector-2026-01-01.log");  // ours, and genuinely stale
            File.WriteAllText(foreign, "setup log an engineer still needs");
            File.WriteAllText(mine, "our own stale line");
            File.SetLastWriteTime(foreign, stale);
            File.SetLastWriteTime(mine, stale);

            VoltLog.Init("connector", dir); // Init prunes

            Assert.True(File.Exists(foreign), "retention deleted a file this source does not own");
            Assert.False(File.Exists(mine), "retention failed to delete this source's own stale file");
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }
}
