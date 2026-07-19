using System;
using System.IO;
using System.IO.Compression;
using System.Text.Json;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// Collect diagnostics — the one file to ask a customer for. Zips the shared log store plus a snapshot (the
    /// connector's <see cref="ConnectorView"/> + OS/runtime/version) to the Desktop for a support ticket. The
    /// README advertises this; here it is.
    /// </summary>
    public static class Diagnostics
    {
        public static string Collect(string logDir, ConnectorView snapshot, string version)
        {
            var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
            var desktop = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
            var zipPath = Path.Combine(desktop, $"volt-diagnostics-{stamp}.zip");

            var work = Path.Combine(Path.GetTempPath(), "volt-diag-" + stamp);
            Directory.CreateDirectory(work);
            try
            {
                var snap = new
                {
                    at = DateTime.Now.ToString("o"),
                    connectorVersion = version,
                    os = Environment.OSVersion.VersionString,
                    runtime = Environment.Version.ToString(),
                    status = snapshot.Status,
                    projects = snapshot.Projects,
                };
                File.WriteAllText(Path.Combine(work, "snapshot.txt"),
                    JsonSerializer.Serialize(snap, new JsonSerializerOptions { WriteIndented = true }));

                var logsOut = Path.Combine(work, "logs");
                Directory.CreateDirectory(logsOut);
                if (Directory.Exists(logDir))
                    foreach (var f in Directory.GetFiles(logDir))
                        try { File.Copy(f, Path.Combine(logsOut, Path.GetFileName(f)), overwrite: true); } catch { /* skip a locked log */ }

                if (File.Exists(zipPath)) File.Delete(zipPath);
                ZipFile.CreateFromDirectory(work, zipPath);
                return zipPath;
            }
            finally { try { Directory.Delete(work, recursive: true); } catch { } }
        }
    }
}
