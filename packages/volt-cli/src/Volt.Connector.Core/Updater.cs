using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Volt.Contracts;

namespace Volt.Connector
{
    /// <summary>
    /// Auto-update for the always-running connector — the one Volt process alive in every configuration (the
    /// Electron GUI may never be opened). Poll GitHub's "latest release" API and, when a newer version is
    /// published, NOTIFY (the tray surfaces it) — nothing downloads or installs until the user acts. On the user's
    /// go-ahead the flow is fully automatic: DownloadPendingAsync fetches that release's Volt-win-Setup.exe, the
    /// tray stops the workers + GUI, then LaunchInstallerAndExit runs it /VERYSILENT (Inno upgrades in place) and
    /// exits so files unlock; the installer relaunches us. The tray surface is CurrentVersion / PendingVersion /
    /// IsApplying.
    ///
    /// <para><b>Only a verified download is ever handed to the launcher.</b> GitHub computes a SHA-256 for every
    /// release asset server-side and publishes it as the asset's <c>digest</c> (<c>sha256:&lt;hex&gt;</c>) in the same
    /// releases API this already reads; the download is hashed in memory and written to %TEMP% only when it equals
    /// that digest. A release without one, or bytes that do not match it, are refused by name (openspec
    /// installer-rebuild, "Verified update") — a silent /VERYSILENT run of unverified bytes is what this replaced.</para>
    /// No-op on an unstamped build (FileVersion 1.0.0.0 → "(dev)"). Updates Volt's own payload only.
    /// </summary>
    internal static class Updater
    {
        private const string Owner = "he-man86";
        private const string Repo = "volt";
        private const string Asset = "Volt-win-Setup.exe";
        /// <summary>The release feed the tray polls — GitHub's REST API for this repo. A PARAMETER of
        /// <see cref="CheckOnce"/> (never an env var or a hidden verb) so Volt.Connector.Tests can serve a localhost
        /// release, e.g. one whose asset digest does not match its bytes.</summary>
        internal const string GitHubFeed = "https://api.github.com/repos/" + Owner + "/" + Repo;

        // Update channel: "stable" (default, latest final release) or "dev" (newest PRERELEASE — the X.Y.Z.<count>
        // builds). Source of truth is the persisted choice, togglable from the Status window; VOLT_UPDATE_CHANNEL
        // overrides it (power-user / CI). Read on each check so a toggle takes effect live, no restart.
        private static string ChannelFile =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Volt", "update-channel.txt");
        private static string Norm(string s) => s.Trim().ToLowerInvariant() == "dev" ? "dev" : "stable";

        public static string Channel
        {
            get
            {
                var env = Environment.GetEnvironmentVariable("VOLT_UPDATE_CHANNEL");
                if (!string.IsNullOrWhiteSpace(env)) return Norm(env);
                try { if (File.Exists(ChannelFile)) return Norm(File.ReadAllText(ChannelFile)); } catch { }
                return "stable";
            }
        }

        /// <summary>The channel is pinned by VOLT_UPDATE_CHANNEL (the UI toggle can't override it).</summary>
        public static bool ChannelPinnedByEnv => !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("VOLT_UPDATE_CHANNEL"));

        /// <summary>Persist the channel choice + re-check immediately (the Status window's toggle).</summary>
        public static void SetChannel(string channel)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(ChannelFile)!);
                File.WriteAllText(ChannelFile, Norm(channel));
            }
            catch (Exception e) { VoltLog.Warn($"updater: channel write failed: {e.Message}"); }
            _pending = null; _setupUrl = null; _setupDigest = null; // a channel switch re-evaluates from scratch
            CheckNow();
        }

        /// <summary>Fire an off-cycle update check (after a channel toggle or a manual "Check now").</summary>
        public static void CheckNow() => _ = Task.Run(async () =>
        {
            try { await CheckOnce(GitHubFeed, CurrentVersion); } catch (Exception e) { VoltLog.Warn($"updater: check failed: {e.Message}"); }
        });
        private static readonly TimeSpan Every = TimeSpan.FromHours(6);
        private static readonly HttpClient Api = CreateClient(TimeSpan.FromSeconds(30));
        // The installer is 100MB+; a short timeout aborts the download mid-stream, so this client has none.
        private static readonly HttpClient Download = CreateClient(Timeout.InfiniteTimeSpan);

        // volatile: written on the background check Task, read on the tray's UI thread.
        private static volatile string? _pending; // a newer version available to apply, or null
        private static volatile string? _setupUrl; // that release's Volt-win-Setup.exe download URL
        private static volatile string? _setupDigest; // that asset's published digest ("sha256:<hex>"), or null if none
        private static int _applying; // 0/1 guard (Interlocked) so a double-click doesn't download/launch twice

        /// <summary>The installed version, shown in the tray ("(dev)" when not installed via the Setup).
        ///
        /// <para>READ ON DEMAND, not assigned by <see cref="Start"/>: a property that is only correct after some
        /// other method has run is an ordering bug waiting to happen (one shipped — a caller read
        /// <see cref="IsDev"/> before `Start()` and got TRUE on every build).</para></summary>
        public static string CurrentVersion => _stamped.Value;

        private static readonly Lazy<string> _stamped = new(() =>
        {
            // An unstamped local dev publish is .NET's default 1.0.0.0 → "(dev)", no update surface.
            try
            {
                var v = FileVersionInfo.GetVersionInfo(Environment.ProcessPath ?? "").FileVersion?.Trim();
                if (!string.IsNullOrEmpty(v) && v != "1.0.0.0" && Version.TryParse(v, out _)) return v!;
            }
            catch (Exception e) { VoltLog.Warn($"updater: version read failed: {e.Message}"); }
            return "(dev)";
        });

        /// <summary>True when this is a dev/unstamped build — the version isn't a real X.Y.Z.count (it's "(dev)", or a
        /// binary built without VOLT_VERSION whose FileVersion is .NET's default 1.0.0.0). The UI says "development
        /// build" plainly instead of a version-shaped string that looks like a release.</summary>
        public static bool IsDev => !Version.TryParse(CurrentVersion, out _);

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
            // MEASURE the running binary's own stamped version — the single source of truth. A binary cannot lie
            // about its own version: if THIS exe is old, the update genuinely did not apply to it. (There is no
            // version.txt any more — it reported what the install MEANT to be, so when a locked file made Inno roll
            // back mid-install it kept claiming the new version while the binaries stayed old, and the tray repeated
            // the claim.) An unstamped local dev publish is 1.0.0.0 → "(dev)", no update surface.
            if (!Version.TryParse(CurrentVersion, out _)) return; // "(dev)" / unparseable — no update surface

            CleanTempInstallers(); // sweep any Setup.exe a previous update left behind in %TEMP%

            _ = Task.Run(async () =>
            {
                while (true)
                {
                    try { await CheckOnce(GitHubFeed, CurrentVersion); }
                    catch (Exception e) { VoltLog.Warn($"updater: check failed: {e.Message}"); }
                    await Task.Delay(Every);
                }
            });
        }

        /// <summary>One check against <paramref name="feed"/> (a GitHub-shaped <c>/releases</c> API root) for a release
        /// newer than <paramref name="installed"/>; on one, it becomes <see cref="PendingVersion"/>.</summary>
        internal static async Task CheckOnce(string feed, string installed)
        {
            // The release to consider depends on the channel: the latest FINAL release (stable) or the newest
            // PRERELEASE (dev). Both are compared to the installed version with System.Version (X.Y.Z[.count]).
            var release = Channel == "dev" ? await NewestPrereleaseAsync(feed) : await LatestStableAsync(feed);
            if (release is not { } r) return;

            var tag = r.GetProperty("tag_name").GetString();
            if (tag == null) return;
            var latest = tag.TrimStart('v'); // tags are bare X.Y.Z[.count], but tolerate a stray v prefix
            if (!(Version.TryParse(latest, out var lv) && Version.TryParse(installed, out var cv) && lv > cv))
                return; // up to date

            // Resolve the installer asset's real download URL from the release — don't reconstruct a path, which a
            // renamed asset or a v-prefixed tag would 404 on.
            if (FindAsset(r) is not { } asset) { VoltLog.Warn($"updater: release {latest} has no {Asset} asset — skipping"); return; }
            var url = asset.TryGetProperty("browser_download_url", out var u) ? u.GetString() : null;
            if (url == null) { VoltLog.Warn($"updater: release {latest}'s {Asset} has no download URL — skipping"); return; }

            // The digest travels with the URL; it is CHECKED at download (DownloadPendingAsync), where a missing one is
            // refused by name — the update is still surfaced, so the refusal is visible rather than a silent no-update.
            _setupDigest = asset.TryGetProperty("digest", out var d) && d.ValueKind == JsonValueKind.String ? d.GetString() : null;
            _setupUrl = url;
            _pending = latest;
            VoltLog.Info($"updater[{Channel}]: {latest} available (current {installed})");
        }

        /// <summary>The latest FINAL release (excludes prereleases — GitHub's /releases/latest does this).</summary>
        private static async Task<JsonElement?> LatestStableAsync(string feed)
        {
            using var doc = JsonDocument.Parse(await Api.GetStringAsync(feed + "/releases/latest"));
            return doc.RootElement.Clone(); // Clone: detach from the doc we're about to dispose
        }

        /// <summary>The highest-versioned PRERELEASE across recent releases — the dev channel's feed.</summary>
        private static async Task<JsonElement?> NewestPrereleaseAsync(string feed)
        {
            using var doc = JsonDocument.Parse(await Api.GetStringAsync(feed + "/releases?per_page=30"));
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

        private static JsonElement? FindAsset(JsonElement release)
        {
            if (release.TryGetProperty("assets", out var assets))
                foreach (var a in assets.EnumerateArray())
                    if (a.TryGetProperty("name", out var n) && n.GetString() == Asset)
                        return a.Clone();
            return null;
        }

        /// <summary>The expected SHA-256 (lowercase hex) from a GitHub asset digest, or null when there is none or it
        /// is not a SHA-256 — both refused by the caller, by name.</summary>
        private static string? ExpectedSha256(string? digest)
        {
            const string prefix = "sha256:";
            if (digest == null || !digest.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return null;
            var hex = digest.Substring(prefix.Length).Trim().ToLowerInvariant();
            return hex.Length == 64 && hex.All(Uri.IsHexDigit) ? hex : null;
        }

        /// <summary>User chose to update: download the pending release's Setup.exe to %TEMP% and return its path
        /// (null on failure / if already in flight). The caller then orderly-stops everything holding {app} files
        /// and calls <see cref="LaunchInstallerAndExit"/> — separating download from apply lets the connector tear
        /// its workers + GUI down BETWEEN the two, so Inno's silent upgrade never fights a locked file. Guarded so
        /// repeated clicks don't stack; on success <c>_applying</c> stays set (we're about to launch).</summary>
        public static async Task<string?> DownloadPendingAsync()
        {
            var url = _setupUrl;
            var version = _pending;
            var digest = _setupDigest;
            if (url == null) return null;
            if (Interlocked.Exchange(ref _applying, 1) == 1) return null; // a download/apply is already in flight
            try
            {
                var expected = ExpectedSha256(digest);
                if (expected == null)
                {
                    VoltLog.Warn($"updater: refused {version} — its {Asset} carries no SHA-256 digest ({digest ?? "none"}); an unverified installer is never run");
                    Interlocked.Exchange(ref _applying, 0);
                    return null;
                }
                // Hashed IN MEMORY, written only on a match: refused bytes never reach %TEMP%, so nothing can launch them.
                var bytes = await Download.GetByteArrayAsync(url);
                var actual = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
                if (actual != expected)
                {
                    VoltLog.Warn($"updater: refused {version} — the downloaded {Asset} has SHA-256 {actual}, the release digest says {expected}");
                    Interlocked.Exchange(ref _applying, 0);
                    return null;
                }
                var tmp = Path.Combine(Path.GetTempPath(), $"Volt-{version}-Setup.exe");
                File.WriteAllBytes(tmp, bytes);
                VoltLog.Info($"updater: {version} downloaded, SHA-256 matches the release digest");
                return tmp;
            }
            catch (Exception e)
            {
                VoltLog.Warn($"updater: download failed: {e.Message}");
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
                VoltLog.Warn($"updater: launch failed: {e.Message}");
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
            catch (Exception e) { VoltLog.Warn($"updater: temp cleanup failed: {e.Message}"); }
        }
    }
}
