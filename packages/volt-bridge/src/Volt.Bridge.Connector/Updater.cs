using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading.Tasks;

namespace Volt.Bridge.Connector
{
    /// <summary>
    /// Auto-update for the always-running connector — the one Volt process alive in every configuration (the
    /// Electron GUI may never be opened). Full-Inno model (no Velopack): poll GitHub's "latest release" API and,
    /// when a newer version is published, surface it in the tray. "Restart to update" downloads that release's
    /// Volt-win-Setup.exe and runs it /VERYSILENT — Inno upgrades the install in place — then exits so files
    /// unlock. Same tray UX as before (CurrentVersion / PendingVersion / RestartToApply), simpler mechanism.
    /// No-op on dev/unmanaged runs (no version.txt beside the exe). Never touches opencode.
    /// </summary>
    internal static class Updater
    {
        private const string Owner = "he-man86";
        private const string Repo = "volt";
        private const string LatestApi = "https://api.github.com/repos/" + Owner + "/" + Repo + "/releases/latest";
        private static readonly TimeSpan Every = TimeSpan.FromHours(6);
        private static readonly HttpClient Http = CreateClient();

        // volatile: written on the background check Task, read on the tray's UI thread (PendingVersion).
        private static volatile string? _pending; // a newer version is available to apply, or null

        /// <summary>The installed version, shown in the tray ("(dev)" when not installed via the Setup).</summary>
        public static string CurrentVersion { get; private set; } = "(dev)";

        /// <summary>A newer version available to apply, or null. Polled by the tray (UI thread).</summary>
        public static string? PendingVersion => _pending;

        private static HttpClient CreateClient()
        {
            var c = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
            // GitHub's REST API rejects requests without a User-Agent.
            c.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("VoltConnector", "1.0"));
            return c;
        }

        /// <summary>Fire-and-forget: check now, then on a timer, for the life of the tray.</summary>
        public static void Start()
        {
            // The installer writes the release version next to the connector (version.txt); its absence marks a
            // dev build or a bundled copy run out of the tree — no update surface there.
            try
            {
                var f = Path.Combine(AppContext.BaseDirectory, "version.txt");
                if (File.Exists(f)) CurrentVersion = File.ReadAllText(f).Trim();
            }
            catch (Exception e) { Log.Warn($"updater: version read failed: {e.Message}"); }

            if (!Version.TryParse(CurrentVersion, out _)) return; // "(dev)" / unparseable — no update surface

            _ = Task.Run(async () =>
            {
                while (true)
                {
                    try { await CheckOnce(); }
                    catch (Exception e) { Log.Warn($"updater: check failed: {e.Message}"); }
                    await Task.Delay(Every);
                }
            });
        }

        private static async Task CheckOnce()
        {
            using var doc = JsonDocument.Parse(await Http.GetStringAsync(LatestApi));
            var tag = doc.RootElement.GetProperty("tag_name").GetString();
            if (tag == null) return;
            var latest = tag.TrimStart('v'); // tags are bare X.Y.Z, but tolerate a stray v prefix
            if (Version.TryParse(latest, out var lv) && Version.TryParse(CurrentVersion, out var cv) && lv > cv)
            {
                _pending = latest;
                Log.Info($"updater: {latest} available (current {CurrentVersion})");
            }
        }

        /// <summary>User clicked "Restart to update": download the new Setup.exe and run it silently (Inno upgrades
        /// in place), then exit so the installer can replace our files. The user chose the moment.</summary>
        public static void RestartToApply()
        {
            var v = _pending;
            if (v == null) return;
            _ = Task.Run(async () =>
            {
                try
                {
                    var url = $"https://github.com/{Owner}/{Repo}/releases/download/{v}/Volt-win-Setup.exe";
                    var tmp = Path.Combine(Path.GetTempPath(), $"Volt-{v}-Setup.exe");
                    File.WriteAllBytes(tmp, await Http.GetByteArrayAsync(url));
                    // /VERYSILENT: the user already chose to update — don't re-prompt. CloseApplications (in the
                    // .iss) lets the installer replace this running connector; it relaunches us when done.
                    Process.Start(new ProcessStartInfo(tmp, "/VERYSILENT /NORESTART") { UseShellExecute = true });
                    Environment.Exit(0); // release file locks so the installer can overwrite us
                }
                catch (Exception e) { Log.Warn($"updater: apply failed: {e.Message}"); }
            });
        }
    }
}
