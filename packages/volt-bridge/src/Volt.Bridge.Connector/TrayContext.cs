using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Volt.Bridge.Connector
{
    /// <summary>
    /// The one tray app. Owns a single NotifyIcon whose colour reflects the aggregate
    /// bridge state, a context menu with per-vendor status + actions, and balloon
    /// toasts on state changes. All vendor differences live in the (headless) workers;
    /// this surface is identical no matter how many vendors are plugged in.
    /// </summary>
    public sealed class TrayContext : ApplicationContext
    {
        private readonly NotifyIcon _icon;
        private readonly System.Windows.Forms.Timer _timer;
        private readonly BridgeSupervisor _supervisor = new();
        private readonly List<VendorProvider> _providers;
        private readonly Dictionary<string, BridgeHealth> _health = new();
        private readonly Dictionary<string, ToolStripMenuItem> _vendorItems = new();
        private readonly ControlServer _control;
        private volatile BridgeView[] _snapshot = Array.Empty<BridgeView>();
        private ToolStripMenuItem _headerItem = null!; // shows the installed version; refreshed each tick
        private ToolStripMenuItem _updateItem = null!; // hidden until the updater has a version downloaded
        private string? _updateShown; // the pending version we've already toasted, so we toast it once

        public TrayContext()
        {
            _providers = ConnectorConfig.DefaultProviders();
            foreach (var p in _providers) _health[p.Id] = new BridgeHealth { Status = BridgeStatus.Unknown };

            _icon = new NotifyIcon
            {
                Visible = true,
                Text = "Volt Bridge Connector",
                Icon = StatusIcons.For(BridgeStatus.Unknown),
                ContextMenuStrip = BuildMenu(),
            };

            // Start the external-attach workers up front.
            foreach (var p in _providers) _supervisor.EnsureWorker(p);

            // Control plane (:8550) — the extension / opencode app see + manage bridges.
            _control = new ControlServer(
                () => _snapshot,
                id => { var p = Find(id); if (p != null && p.Archetype == Archetype.ExternalAttach) { _supervisor.StopWorker(id); _supervisor.EnsureWorker(p); } },
                (id, installId) =>
                {
                    var p = Find(id); if (p == null) return false;
                    if (installId != null)
                    {
                        var inst = p.Installs.FirstOrDefault(x => x.Id == installId);
                        if (inst != null) return _supervisor.LaunchIde(inst.ExePath, p.IdeLaunchArgs);
                    }
                    return _supervisor.LaunchIde(p);
                },
                (id, target) =>
                {
                    var p = Find(id); if (p == null || p.Archetype != Archetype.ExternalAttach) return;
                    p.Target = target; _supervisor.StopWorker(id); _supervisor.EnsureWorker(p);
                });
            _control.Start();
            Log.Info($"connector started; providers: {string.Join(", ", _providers.Select(p => p.Id))}");

            _timer = new System.Windows.Forms.Timer { Interval = 4000 };
            _timer.Tick += async (_, _) => await TickAsync();
            _timer.Start();
            _ = TickAsync(); // first probe immediately
        }

        private async Task TickAsync()
        {
            foreach (var p in _providers)
            {
                if (p.Archetype == Archetype.ExternalAttach) _supervisor.EnsureWorker(p); // respawn if it died

                var prev = _health[p.Id];
                var now = await HealthProbe.ProbeAsync(p.Port);
                _health[p.Id] = now;
                if (now.Status != prev.Status) OnStatusChanged(p, prev, now);
            }
            UpdateIcon();
            RefreshMenuLabels();
            ShowUpdateIfReady();

            // Publish the immutable snapshot the control plane serves on :8550.
            _snapshot = _providers.Select(p => new BridgeView(
                p.Id, p.DisplayName, p.Port, p.Archetype.ToString(),
                HealthProbe.Describe(_health[p.Id]),
                p.Archetype == Archetype.ExternalAttach && _supervisor.IsWorkerRunning(p.Id),
                p.Installs.Count > 0 ? p.Installs : null,
                null,
                p.Target)).ToArray();
        }

        private VendorProvider? Find(string id) => _providers.FirstOrDefault(p => p.Id == id);

        private void OnStatusChanged(VendorProvider p, BridgeHealth prev, BridgeHealth now)
        {
            // Toast only meaningful transitions: a vendor going down, or coming back.
            if (now.Status == BridgeStatus.Connected && prev.Status != BridgeStatus.Connected)
                _icon.ShowBalloonTip(4000, "Volt", $"{p.DisplayName} bridge connected.", ToolTipIcon.Info);
            else if (now.Status is BridgeStatus.Unreachable or BridgeStatus.Unavailable && prev.Status == BridgeStatus.Connected)
                _icon.ShowBalloonTip(6000, "Volt", $"{p.DisplayName} bridge {HealthProbe.Describe(now)}.", ToolTipIcon.Warning);
        }

        // ── icon ──────────────────────────────────────────────────────────
        private void UpdateIcon()
        {
            _icon.Icon = StatusIcons.For(Aggregate());
            _icon.Text = "Volt Bridge Connector — " + string.Join(", ",
                _providers.Select(p => $"{p.DisplayName}: {HealthProbe.Describe(_health[p.Id])}"));
            if (_icon.Text.Length > 63) _icon.Text = _icon.Text.Substring(0, 60) + "…"; // NotifyIcon.Text limit
        }

        /// <summary>The one colour the tray shows: the most *informative alive* state, and never an alarmist
        /// red just because a vendor isn't in use. Connected (something works) wins; then a genuinely degraded
        /// live channel; then "up, waiting for a project". "Nothing running / not launched" (Unreachable /
        /// Unknown) is NOT a fault — it folds to neutral grey. This is what the old per-vendor Enable toggle was
        /// really for; deriving it from state removes the toggle.</summary>
        private BridgeStatus Aggregate()
        {
            var statuses = _providers.Select(p => _health[p.Id].Status).ToList();
            if (statuses.Contains(BridgeStatus.Connected)) return BridgeStatus.Connected;   // green
            if (statuses.Contains(BridgeStatus.Degraded)) return BridgeStatus.Degraded;     // amber
            if (statuses.Contains(BridgeStatus.Unavailable)) return BridgeStatus.Unavailable; // orange: waiting for a project
            return BridgeStatus.Unknown;                                                    // grey: nothing running / n/a
        }

        // ── menu ──────────────────────────────────────────────────────────
        private ContextMenuStrip BuildMenu()
        {
            var menu = new ContextMenuStrip();
            // Header carries the installed version. RefreshMenuLabels re-sets its text each tick, so it self-
            // corrects even if Updater.CurrentVersion wasn't ready when the menu was first built.
            _headerItem = new ToolStripMenuItem($"Volt Bridge Connector  ·  {Updater.CurrentVersion}") { Enabled = false };
            menu.Items.Add(_headerItem);
            menu.Items.Add(new ToolStripSeparator());

            foreach (var p in _providers)
            {
                var item = new ToolStripMenuItem(p.DisplayName);
                if (p.Archetype == Archetype.ExternalAttach)
                {
                    item.DropDownOpening += (_, _) => PopulateInstances(p, item);
                    item.DropDownItems.Add(new ToolStripMenuItem("…") { Enabled = false }); // placeholder so the arrow shows
                }
                else // InIdeLoad — discovered installs, repopulated on open
                {
                    item.DropDownOpening += (_, _) => PopulateInstalls(p, item);
                    item.DropDownItems.Add(new ToolStripMenuItem("…") { Enabled = false }); // placeholder so the arrow shows
                }

                _vendorItems[p.Id] = item;
                menu.Items.Add(item);
            }

            menu.Items.Add(new ToolStripSeparator());
            // Appears (with the version) once the updater has downloaded a newer build; the user picks the moment.
            _updateItem = new ToolStripMenuItem("Restart to update", null, (_, _) => Updater.RestartToApply()) { Visible = false };
            menu.Items.Add(_updateItem);
            menu.Items.Add("Show logs", null, (_, _) => ShowLogs());
            menu.Items.Add("Exit", null, (_, _) => ExitThreadCore());
            return menu;
        }

        // ── CODESYS install picker (versions + forks, re-discovered each open) ──
        private void PopulateInstalls(VendorProvider p, ToolStripMenuItem open)
        {
            open.DropDownItems.Clear();
            if (p.Installs.Count == 0)
                open.DropDownItems.Add(new ToolStripMenuItem("No CODESYS install detected") { Enabled = false });
            foreach (var inst in p.Installs)
            {
                var label = inst.Variant is "CODESYS" or "Manual" ? inst.DisplayName : $"{inst.DisplayName}  [{inst.Variant}]";
                open.DropDownItems.Add(new ToolStripMenuItem(label, null, (_, _) => LaunchInstall(p, inst)));
            }
            open.DropDownItems.Add(new ToolStripSeparator());
            open.DropDownItems.Add(new ToolStripMenuItem("Add install…", null, (_, _) => AddInstall(p)));
        }

        /// <summary>Manual backup: browse to a CODESYS-family launcher and remember it. Covers
        /// any version/fork/path that auto-detection (glob + registry) didn't surface.</summary>
        private void AddInstall(VendorProvider p)
        {
            using var dlg = new OpenFileDialog
            {
                Title = "Select the CODESYS-family launcher (e.g. CODESYS.exe)",
                Filter = "Executable (*.exe)|*.exe",
                CheckFileExists = true,
            };
            if (dlg.ShowDialog() != DialogResult.OK) return;
            CodesysDiscovery.AddManualInstall(dlg.FileName, null);
            p.Installs = CodesysDiscovery.Discover();
            if (string.IsNullOrEmpty(p.IdeExe) && p.Installs.Count > 0) p.IdeExe = p.Installs[0].ExePath;
        }

        private void LaunchInstall(VendorProvider p, IdeInstall inst)
        {
            if (!_supervisor.LaunchIde(inst.ExePath, p.IdeLaunchArgs))
                _icon.ShowBalloonTip(6000, "Volt", $"Couldn't launch {inst.DisplayName}.", ToolTipIcon.Warning);
        }

        // ── TwinCAT instance/project picker ──
        private void PopulateInstances(VendorProvider p, ToolStripMenuItem connect)
        {
            connect.DropDownItems.Clear();
            if (p.Target != null)
                connect.DropDownItems.Add(new ToolStripMenuItem($"{p.Target.Project}{(p.Target.PlcProject != null ? " / " + p.Target.PlcProject : "")}") { Checked = true });
            else
                connect.DropDownItems.Add(new ToolStripMenuItem("(no project selected)") { Enabled = false });
        }

        private void SelectTarget(VendorProvider p, TcTarget? target)
        {
            p.Target = target;
            _supervisor.StopWorker(p.Id);
            _supervisor.EnsureWorker(p);
            _icon.ShowBalloonTip(3000, "Volt", target == null
                ? $"{p.DisplayName}: no project selected — pick one from the tray"
                : $"{p.DisplayName}: attaching to {target.Project}{(target.PlcProject != null ? " / " + target.PlcProject : "")}…",
                ToolTipIcon.Info);
        }

        // ── logs ──
        private LogWindow? _logWindow;

        private void ShowLogs()
        {
            if (_logWindow == null || _logWindow.IsDisposed) _logWindow = new LogWindow();
            _logWindow.Show();
            _logWindow.WindowState = FormWindowState.Normal;
            _logWindow.BringToFront();
            _logWindow.Activate();
        }

        // Normally runs on the UI thread (the WinForms timer tick). The one exception is the first, ctor-fired
        // TickAsync (no sync context yet) — but PendingVersion is null that early (nothing downloaded), so it
        // returns before touching the tray. The updater downloads in the background and just exposes
        // PendingVersion; here we surface it — a one-time toast + the menu action.
        private void ShowUpdateIfReady()
        {
            var pending = Updater.PendingVersion;
            if (pending == null || pending == _updateShown) return;
            _updateShown = pending;
            _updateItem.Text = $"Restart to update to {pending}";
            _updateItem.Visible = true;
            // Be precise about how it applies: the tray action (below) installs it now; otherwise it applies
            // automatically at your next sign-in. Closing/reopening the Volt window does NOT — the connector is
            // a separate always-on process.
            _icon.ShowBalloonTip(8000, "Volt update ready",
                $"Volt {pending} is ready. Pick “Restart to update to {pending}” from the tray to install it now — "
                    + "otherwise it installs automatically the next time you sign in to Windows.",
                ToolTipIcon.Info);
        }

        private void RefreshMenuLabels()
        {
            _headerItem.Text = $"Volt Bridge Connector  ·  {Updater.CurrentVersion}"; // self-corrects if set late
            foreach (var p in _providers)
            {
                if (!_vendorItems.TryGetValue(p.Id, out var item)) continue;
                item.Text = $"{p.DisplayName} — {HealthProbe.Describe(_health[p.Id])}";
            }
        }

        protected override void ExitThreadCore()
        {
            _timer.Stop();
            _control.Dispose();
            _logWindow?.Dispose();
            _icon.Visible = false;
            _supervisor.Dispose();
            _icon.Dispose();
            base.ExitThreadCore();
        }
    }

    /// <summary>Generates the Volt-bolt tray icon once per status (kept for the app lifetime). The mark is
    /// the Volt lightning bolt (same shape as the app logo), tinted by aggregate bridge state.</summary>
    internal static class StatusIcons
    {
        private static readonly Dictionary<BridgeStatus, Icon> Cache = new();

        // Volt lightning bolt, viewBox 0 0 24 24 (matches volt-vscode/icons/volt-activitybar.svg + the app logo).
        private static readonly PointF[] Bolt =
        {
            new(13.5f, 2f), new(4f, 14f), new(10f, 14f), new(8.5f, 22f), new(20f, 9f), new(13f, 9f),
        };

        public static Icon For(BridgeStatus s)
        {
            if (Cache.TryGetValue(s, out var cached)) return cached;
            var color = s switch
            {
                BridgeStatus.Connected => Color.LimeGreen,
                BridgeStatus.Degraded => Color.Gold,
                BridgeStatus.Unavailable => Color.Orange,
                BridgeStatus.Unreachable => Color.Firebrick,
                _ => Color.Gray,
            };
            const int size = 32; // crisp; the tray scales it down to 16
            using var bmp = new Bitmap(size, size);
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.HighQuality;
                g.Clear(Color.Transparent);
                var k = size / 24f;
                var pts = new PointF[Bolt.Length];
                for (var i = 0; i < Bolt.Length; i++) pts[i] = new PointF(Bolt[i].X * k, Bolt[i].Y * k);
                using var brush = new SolidBrush(color);
                g.FillPolygon(brush, pts);
            }
            var icon = Icon.FromHandle(bmp.GetHicon());
            Cache[s] = icon;
            return icon;
        }
    }
}
