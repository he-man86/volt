using System;
using System.Threading.Tasks;
using Velopack;
using Velopack.Sources;

namespace Volt.Bridge.Connector
{
    /// <summary>
    /// Auto-update, driven by the always-running connector — the one Volt process alive in every configuration
    /// (the Electron GUI may never be opened). Standard framework (Velopack). Market-normal (VS Code / Electron)
    /// flow: the connector CHECKS + DOWNLOADS in the background (seamless), then the tray shows a toast + a
    /// "Restart to update to <ver>" menu item — the user picks WHEN it applies. It also applies automatically on
    /// the next natural restart (SetAutoApplyOnStartup, Program.cs), so nothing forces a mid-session restart.
    /// No-op unless Velopack-installed (dev + any bundled copy are inert). Never touches opencode.
    /// </summary>
    internal static class Updater
    {
        private const string Feed = "https://github.com/he-man86/volt";
        private static readonly TimeSpan Every = TimeSpan.FromHours(6);

        private static UpdateManager? _mgr;
        // volatile: written on the background check Task, read on the tray's UI thread (PendingVersion).
        private static volatile UpdateInfo? _staged; // downloaded + ready to apply on restart, or null

        /// <summary>The installed version, shown in the tray menu ("(dev)" when not Velopack-managed).</summary>
        public static string CurrentVersion { get; private set; } = "(dev)";

        /// <summary>The version downloaded and waiting to apply on restart, or null. Polled by the tray (UI thread).</summary>
        public static string? PendingVersion => _staged?.TargetFullRelease.Version.ToString();

        /// <summary>Fire-and-forget: check now, then on a timer, for the life of the tray.</summary>
        public static void Start()
        {
            try { _mgr = new UpdateManager(new GithubSource(Feed, accessToken: null, prerelease: false)); }
            catch (Exception e) { Log.Warn($"updater: init failed: {e.Message}"); return; }

            // Version read is its own try so an I/O hiccup here doesn't lose the whole updater (and vice-versa).
            try { if (_mgr.CurrentVersion != null) CurrentVersion = _mgr.CurrentVersion.ToString(); }
            catch (Exception e) { Log.Warn($"updater: version read failed: {e.Message}"); }

            if (!_mgr.IsInstalled) return; // dev build / non-Velopack copy — no update surface

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
            var updates = await _mgr!.CheckForUpdatesAsync();
            if (updates == null) return; // up to date
            var v = updates.TargetFullRelease.Version.ToString();
            if (v == PendingVersion) return; // already downloaded this target; waiting on the user / restart
            Log.Info($"updater: downloading {v}…");
            await _mgr.DownloadUpdatesAsync(updates);
            _staged = updates;
            Log.Info($"updater: {v} ready — applies on restart");
        }

        /// <summary>User clicked "Restart to update": apply the staged update + relaunch onto the new version.
        /// The user chose the moment, so restarting now is fine.</summary>
        public static void RestartToApply()
        {
            var updates = _staged;
            if (_mgr == null || updates == null) return;
            try { _mgr.ApplyUpdatesAndRestart(updates); } // exits + relaunches on the new version
            catch (Exception e) { Log.Warn($"updater: apply failed: {e.Message}"); }
        }
    }
}
