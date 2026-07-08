using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;

namespace Volt.Bridge.Connector
{
    /// <summary>Builds the ONE support bundle to ask a user for: every bridge's <c>/health</c> (which carries
    /// its wire + app version), the OS/runtime, and the connector version — zipped together with the durable
    /// logs — dropped on the Desktop. Turns "it broke" into a single file.</summary>
    internal static class Diagnostics
    {
        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };

        /// <summary>Gather + zip. Returns the archive path (on the Desktop), or null on failure.</summary>
        public static async Task<string?> CollectAsync(IEnumerable<VendorProvider> providers)
        {
            try
            {
                var snapshot = await BuildSnapshotAsync(providers).ConfigureAwait(false);
                var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                var dir = string.IsNullOrEmpty(desktop) ? Path.GetTempPath() : desktop;
                var outPath = Path.Combine(dir, $"volt-diagnostics-{DateTime.Now:yyyyMMdd-HHmmss}.zip");
                WriteZip(outPath, Log.Dir, snapshot);
                Log.Info($"collected diagnostics → {outPath}");
                return outPath;
            }
            catch (Exception ex)
            {
                Log.Error($"collect diagnostics failed: {ex.Message}");
                return null;
            }
        }

        private static async Task<string> BuildSnapshotAsync(IEnumerable<VendorProvider> providers)
        {
            var sb = new StringBuilder();
            sb.AppendLine("Volt diagnostics snapshot");
            sb.AppendLine("generated : " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
            sb.AppendLine("connector : " + (typeof(Diagnostics).Assembly.GetName().Version?.ToString() ?? "?"));
            sb.AppendLine("os        : " + RuntimeInformation.OSDescription);
            sb.AppendLine("runtime   : " + RuntimeInformation.FrameworkDescription);
            sb.AppendLine();
            foreach (var p in providers)
            {
                sb.AppendLine($"== {p.DisplayName} ({p.Id}) :{p.Port} [{p.Archetype}] ==");
                sb.AppendLine("  /health : " + await ProbeAsync(p.Port).ConfigureAwait(false));
                sb.AppendLine();
            }
            return sb.ToString();
        }

        private static async Task<string> ProbeAsync(int port)
        {
            try { return await Http.GetStringAsync($"http://127.0.0.1:{port}/health").ConfigureAwait(false); }
            catch (Exception ex) { return "unreachable: " + ex.Message; }
        }

        private static void WriteZip(string outPath, string logDir, string snapshot)
        {
            if (File.Exists(outPath)) File.Delete(outPath);
            using var fs = new FileStream(outPath, FileMode.CreateNew);
            using var zip = new ZipArchive(fs, ZipArchiveMode.Create);

            using (var w = new StreamWriter(zip.CreateEntry("snapshot.txt").Open(), Encoding.UTF8))
                w.Write(snapshot);

            if (Directory.Exists(logDir))
                foreach (var f in Directory.GetFiles(logDir, "*.log"))
                {
                    using var es = zip.CreateEntry("logs/" + Path.GetFileName(f)).Open();
                    // Share ReadWrite: a worker may be appending to today's file while we read it.
                    using var src = new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                    src.CopyTo(es);
                }
        }
    }
}
