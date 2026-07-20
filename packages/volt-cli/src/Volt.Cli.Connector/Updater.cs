using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// Auto-update for the always-running connector — the one Volt process alive in every configuration (the
    /// Electron GUI may never be opened). Poll GitHub's "latest release" API and, when a newer version is
    /// published, NOTIFY (the tray surfaces it) — nothing downloads or installs until the user acts. On the user's
    /// go-ahead the flow is fully automatic: DownloadPendingAsync fetches that release's Volt-win-Setup.exe, the
    /// tray stops the workers + GUI, then LaunchInstallerAndExit runs it /VERYSILENT (Inno upgrades in place) and
    /// exits so files unlock; the installer relaunches us. The tray surface is CurrentVersion / PendingVersion /
    /// IsApplying.
    /// No-op on dev/unmanaged runs (no version.txt beside the exe). Never touches opencode.
    /// </summary>
    internal static class Updater
    {
        private const string Owner = "he-man86";
        private const string Repo = "volt";
        private const string Asset = "Volt-win-Setup.exe";
        private const string LatestApi = "https://api.github.com/repos/" + Owner + "/" + Repo + "/releases/latest";
        private const string ReleasesApi = "https://api.github.com/repos/" + Owner + "/" + Repo + "/releases?per_page=30";

        // Update channel: "stable" (default) tracks the latest final release; "dev" tracks the newest PRERELEASE
        // (the X.Y.Z.<count> builds published on every dev push). Set VOLT_UPDATE_CHANNEL=dev to test dev builds.
        private static readonly string Channel = (Environment.GetEnvironmentVariable("VOLT_UPDATE_CHANNEL") ?? "stable").Trim().ToLowerInvariant();
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
            // The release to consider depends on the channel: the latest FINAL release (stable) or the newest
            // PRERELEASE (dev). Both are compared to the installed version with System.Version (X.Y.Z[.count]).
            var release = Channel == "dev" ? await NewestPrereleaseAsync() : await LatestStableAsync();
            if (release is not { } r) return;

            var tag = r.GetProperty("tag_name").GetString();
            if (tag == null) return;
            var latest = tag.TrimStart('v'); // tags are bare X.Y.Z[.count], but tolerate a stray v prefix
            if (!(Version.TryParse(latest, out var lv) && Version.TryParse(CurrentVersion, out var cv) && lv > cv))
                return; // up to date

            // Resolve the installer asset's real download URL from the release — don't reconstruct a path, which a
            // renamed asset or a v-prefixed tag would 404 on.
            var url = AssetUrl(r);
            if (url == null) { Log.Warn($"updater: release {latest} has no {Asset} asset — skipping"); return; }

            _setupUrl = url;
            _pending = latest;
            Log.Info($"updater[{Channel}]: {latest} available (current {CurrentVersion})");
        }

        /// <summary>The latest FINAL release (excludes prereleases — GitHub's /releases/latest does this).</summary>
        private static async Task<JsonElement?> LatestStableAsync()
        {
            using var doc = JsonDocument.Parse(await Api.GetStringAsync(LatestApi));
            return doc.RootElement.Clone(); // Clone: detach from the doc we're about to dispose
        }

        /// <summary>The highest-versioned PRERELEASE across recent releases — the dev channel's feed.</summary>
        private static async Task<JsonElement?> NewestPrereleaseAsync()
        {
            using var doc = JsonDocument.Parse(await Api.GetStringAsync(ReleasesApi));
            JsonElement? best = null;
            Version? bestVer = null;
            foreach (var rel in doc.RootElement.EnumerateArray())
            {
                if (!(rel.TryGetProperty("prerelease", out var pre) && pre.GetBoolean())) continue;
                if (rel.TryGetProperty("draft", out var d) && d.GetBoolean()) continue;
                var tag = rel.GetProperty("tag_name").GetString()?.TrimStart('v');
                if (tag == null || !Version.TryParse(tag, out var v)) continue;
                if (bestVer == null || v > bestVer) { bestVer = v; best = rel.Clone(); }
            }
            return best;
        }

        private static string? AssetUrl(JsonElement release)
        {
            if (release.TryGetProperty("assets", out var assets))
                foreach (var a in assets.EnumerateArray())
                    if (a.TryGetProperty("name", out var n) && n.GetString() == Asset &&
                        a.TryGetProperty("browser_download_url", out var u))
                        return u.GetString();
            return null;
        }

        /// <summary>User chose to update: download the pending release's Setup.exe to %TEMP% and return its path
        /// (null on failure / if already in flight). The caller then orderly-stops everything holding {app} files
        /// and calls <see cref="LaunchInstallerAndExit"/> — separating download from apply lets the connector tear
        /// its workers + GUI down BETWEEN the two, so Inno's silent upgrade never fights a locked file. Guarded so
        /// repeated clicks don't stack; on success <c>_applying</c> stays set (we're about to launch).</summary>
        public static async Task<string?> DownloadPendingAsync()
        {
            var url = _setupUrl;
            if (url == null) return null;
            if (Interlocked.Exchange(ref _applying, 1) == 1) return null; // a download/apply is already in flight
            try
            {
                var tmp = Path.Combine(Path.GetTempPath(), $"Volt-{_pending}-Setup.exe");
                File.WriteAllBytes(tmp, await Download.GetByteArrayAsync(url));
                return tmp;
            }
            catch (Exception e)
            {
                Log.Warn($"updater: download failed: {e.Message}");
                Interlocked.Exchange(ref _applying, 0); // failed — let the user retry
                return null;
            }
        }

        /// <summary>Run the downloaded Setup silently (Inno upgrades in place) then exit so the installer can replace
        /// our files. /VERYSILENT: the user already chose to update — don't re-prompt. The .iss relaunches the
        /// connector when done. The caller MUST have stopped the bridge workers + GUI first.</summary>
        public static void LaunchInstallerAndExit(string installerPath)
        {
            try
            {
                Process.Start(new ProcessStartInfo(installerPath, "/VERYSILENT /NORESTART") { UseShellExecute = true });
                Environment.Exit(0); // release file locks so the installer can overwrite us
            }
            catch (Exception e)
            {
                Log.Warn($"updater: launch failed: {e.Message}");
                Interlocked.Exchange(ref _applying, 0); // failed before exit — let the user retry
            }
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
