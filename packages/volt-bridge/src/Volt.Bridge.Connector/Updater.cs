using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Volt.Bridge.Connector
{
    /// <summary>
    /// Auto-update for the always-running connector — the one Volt process alive in every configuration (the
    /// Electron GUI may never be opened). Poll GitHub's "latest release" API and, when a newer version is
    /// published, surface it in the tray. "Restart to update" downloads that release's Volt-win-Setup.exe and
    /// runs it /VERYSILENT — Inno upgrades the install in place — then exits so files unlock. The tray surface is
    /// CurrentVersion / PendingVersion / RestartToApply.
    /// No-op on dev/unmanaged runs (no version.txt beside the exe). Never touches opencode.
    /// </summary>
    internal static class Updater
    {
        private const string Owner = "he-man86";
        private const string Repo = "volt";
        private const string Asset = "Volt-win-Setup.exe";
        private const string LatestApi = "https://api.github.com/repos/" + Owner + "/" + Repo + "/releases/latest";
        private static readonly TimeSpan Every = TimeSpan.FromHours(6);
        private static readonly HttpClient Api = CreateClient(TimeSpan.FromSeconds(30));
        // The installer is 100MB+; a short timeout aborts the download mid-stream, so this client has none.
        private static readonly HttpClient Download = CreateClient(Timeout.InfiniteTimeSpan);

        // volatile: written on the background check Task, read on the tray's UI thread.
        private static volatile string? _pending; // a newer version available to apply, or null
        private static volatile string? _setupUrl; // that release's Volt-win-Setup.exe download URL
        private static int _applying; // 0/1 guard (Interlocked) so a double-click doesn't download/launch twice

        /// <summary>The installed version, shown in the tray ("(dev)" when not installed via the Setup).</summary>
        public static string CurrentVersion { get; private set; } = "(dev)";

        /// <summary>A newer version available to apply, or null. Polled by the tray (UI thread).</summary>
        public static string? PendingVersion => _pending;

        /// <summary>True while a download/apply is in flight, so the tray can show "Downloading…" and re-enable the
        /// action if it fails. Polled by the tray (UI thread).</summary>
        public static bool IsApplying => Volatile.Read(ref _applying) == 1;

        private static HttpClient CreateClient(TimeSpan timeout)
        {
            var c = new HttpClient { Timeout = timeout };
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

            CleanTempInstallers(); // sweep any Setup.exe a previous update left behind in %TEMP%

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
            using var doc = JsonDocument.Parse(await Api.GetStringAsync(LatestApi));
            var root = doc.RootElement;
            var tag = root.GetProperty("tag_name").GetString();
            if (tag == null) return;
            var latest = tag.TrimStart('v'); // tags are bare X.Y.Z, but tolerate a stray v prefix in the compare
            if (!(Version.TryParse(latest, out var lv) && Version.TryParse(CurrentVersion, out var cv) && lv > cv))
                return; // up to date

            // Resolve the installer asset's real download URL from the release — don't reconstruct a path, which a
            // renamed asset or a v-prefixed tag would 404 on.
            string? url = null;
            if (root.TryGetProperty("assets", out var assets))
                foreach (var a in assets.EnumerateArray())
                    if (a.TryGetProperty("name", out var n) && n.GetString() == Asset &&
                        a.TryGetProperty("browser_download_url", out var u))
                    {
                        url = u.GetString();
                        break;
                    }
            if (url == null) { Log.Warn($"updater: release {latest} has no {Asset} asset — skipping"); return; }

            _setupUrl = url;
            _pending = latest;
            Log.Info($"updater: {latest} available (current {CurrentVersion})");
        }

        /// <summary>User clicked "Restart to update": download the new Setup.exe and run it silently (Inno upgrades
        /// in place), then exit so the installer can replace our files. Guarded so repeated clicks don't stack.</summary>
        public static void RestartToApply()
        {
            var url = _setupUrl;
            if (url == null) return;
            if (Interlocked.Exchange(ref _applying, 1) == 1) return; // a download/apply is already in flight
            _ = Task.Run(async () =>
            {
                try
                {
                    var tmp = Path.Combine(Path.GetTempPath(), $"Volt-{_pending}-Setup.exe");
                    File.WriteAllBytes(tmp, await Download.GetByteArrayAsync(url));
                    // /VERYSILENT: the user already chose to update — don't re-prompt. CloseApplications (in the
                    // .iss) lets the installer replace this running connector; it relaunches us when done.
                    Process.Start(new ProcessStartInfo(tmp, "/VERYSILENT /NORESTART") { UseShellExecute = true });
                    Environment.Exit(0); // release file locks so the installer can overwrite us
                }
                catch (Exception e)
                {
                    Log.Warn($"updater: apply failed: {e.Message}");
                    Interlocked.Exchange(ref _applying, 0); // failed before exit — let the user retry
                }
            });
        }

        private static void CleanTempInstallers()
        {
            try
            {
                foreach (var f in Directory.GetFiles(Path.GetTempPath(), "Volt-*-Setup.exe"))
                    try { File.Delete(f); } catch { /* locked / in use — skip */ }
            }
            catch (Exception e) { Log.Warn($"updater: temp cleanup failed: {e.Message}"); }
        }
    }
}
