using System;
using System.Collections.Generic;
using System.Diagnostics;
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
        private readonly Dictionary<string, BridgeStatus> _status = new();
        private readonly Dictionary<string, List<TcInstanceDto>> _instances = new();
        private readonly Dictionary<string, ToolStripMenuItem> _vendorItems = new();
        private readonly ControlServer _control;
        private volatile BridgeView[] _snapshot = Array.Empty<BridgeView>();

        public TrayContext()
        {
            _providers = ConnectorConfig.DefaultProviders();
            foreach (var p in _providers) _status[p.Id] = BridgeStatus.Unknown;

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

                var prev = _status[p.Id];
                var now = await HealthProbe.ProbeAsync(p.Port);
                _status[p.Id] = now;
                if (now != prev) OnStatusChanged(p, prev, now);

                // Cache the attachable instances so the "Connect to" submenu opens instantly.
                if (p.Archetype == Archetype.ExternalAttach)
                    _instances[p.Id] = await InstanceProbe.FetchAsync(p.Port);
            }
            UpdateIcon();
            RefreshMenuLabels();

            // Publish the immutable snapshot the control plane serves on :8550.
            _snapshot = _providers.Select(p => new BridgeView(
                p.Id, p.DisplayName, p.Port, p.Archetype.ToString(),
                HealthProbe.Describe(_status[p.Id]),
                p.Archetype == Archetype.ExternalAttach && _supervisor.IsWorkerRunning(p.Id),
                p.Installs.Count > 0 ? p.Installs : null,
                _instances.TryGetValue(p.Id, out var insts) ? insts : null,
                p.Target)).ToArray();
        }

        private VendorProvider? Find(string id) => _providers.FirstOrDefault(p => p.Id == id);

        private void OnStatusChanged(VendorProvider p, BridgeStatus prev, BridgeStatus now)
        {
            // Toast only meaningful transitions: a vendor going down, or coming back.
            if (now == BridgeStatus.Connected && prev != BridgeStatus.Connected)
                _icon.ShowBalloonTip(4000, "Volt", $"{p.DisplayName} bridge connected.", ToolTipIcon.Info);
            else if (now is BridgeStatus.Unreachable or BridgeStatus.Unavailable && prev == BridgeStatus.Connected)
                _icon.ShowBalloonTip(6000, "Volt", $"{p.DisplayName} bridge {HealthProbe.Describe(now)}.", ToolTipIcon.Warning);
        }

        // ── icon ──────────────────────────────────────────────────────────
        private void UpdateIcon()
        {
            _icon.Icon = StatusIcons.For(Aggregate());
            _icon.Text = "Volt Bridge Connector — " + string.Join(", ",
                _providers.Select(p => $"{p.DisplayName}: {HealthProbe.Describe(_status[p.Id])}"));
            if (_icon.Text.Length > 63) _icon.Text = _icon.Text.Substring(0, 60) + "…"; // NotifyIcon.Text limit
        }

        /// <summary>The one colour the tray shows: the most *informative alive* state, and never an alarmist
        /// red just because a vendor isn't in use. Connected (something works) wins; then a genuinely degraded
        /// live channel; then "up, waiting for a project". "Nothing running / not launched" (Unreachable /
        /// Unknown) is NOT a fault — it folds to neutral grey. This is what the old per-vendor Enable toggle was
        /// really for; deriving it from state removes the toggle.</summary>
        private BridgeStatus Aggregate()
        {
            var statuses = _providers.Select(p => _status[p.Id]).ToList();
            if (statuses.Contains(BridgeStatus.Connected)) return BridgeStatus.Connected;   // green
            if (statuses.Contains(BridgeStatus.Degraded)) return BridgeStatus.Degraded;     // amber
            if (statuses.Contains(BridgeStatus.Unavailable)) return BridgeStatus.Unavailable; // orange: waiting for a project
            return BridgeStatus.Unknown;                                                    // grey: nothing running / n/a
        }

        // ── menu ──────────────────────────────────────────────────────────
        private ContextMenuStrip BuildMenu()
        {
            var menu = new ContextMenuStrip();
            menu.Items.Add(new ToolStripMenuItem("Volt Bridge Connector") { Enabled = false });
            menu.Items.Add(new ToolStripSeparator());

            foreach (var p in _providers)
            {
                var item = new ToolStripMenuItem(p.DisplayName);
                if (p.Archetype == Archetype.ExternalAttach)
                {
                    var connect = new ToolStripMenuItem("Connect to");
                    connect.DropDownOpening += (_, _) => PopulateInstances(p, connect);
                    item.DropDownItems.Add(connect);
                    item.DropDownItems.Add("Restart bridge", null, (_, _) => { _supervisor.StopWorker(p.Id); _supervisor.EnsureWorker(p); });
                    item.DropDownItems.Add("Stop bridge", null, (_, _) => _supervisor.StopWorker(p.Id));
                }
                else // InIdeLoad — a submenu of discovered installs, repopulated on open
                {
                    var open = new ToolStripMenuItem($"Open {p.DisplayName} (Volt)");
                    open.DropDownOpening += (_, _) => PopulateInstalls(p, open);
                    open.DropDownItems.Add(new ToolStripMenuItem("…") { Enabled = false }); // placeholder so the arrow shows
                    item.DropDownItems.Add(open);
                }

                _vendorItems[p.Id] = item;
                menu.Items.Add(item);
            }

            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Show logs", null, (_, _) => ShowLogs());
            menu.Items.Add("Collect diagnostics", null, async (_, _) => await CollectDiagnostics());
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
            // No "Default (first active)" entry: that was the silent auto-attach — it bound whatever the ROT
            // listed first, so a second open solution could be the wrong project. The user must pick explicitly;
            // until then the worker stays unattached (health = "no project loaded").
            connect.DropDownItems.Clear();

            var list = _instances.TryGetValue(p.Id, out var inst) ? inst : new List<TcInstanceDto>();
            if (list.Count == 0)
            {
                connect.DropDownItems.Add(new ToolStripMenuItem("(no running instances detected)") { Enabled = false });
                return;
            }
            foreach (var i in list)
            {
                foreach (var proj in i.Projects)
                {
                    var plcs = proj.PlcProjects.Count > 0 ? proj.PlcProjects : new List<string> { "" };
                    foreach (var plc in plcs)
                    {
                        var label = $"{i.IdeName ?? "IDE"} — {proj.Project}" + (string.IsNullOrEmpty(plc) ? "" : $" / {plc}");
                        var target = new TcTarget(i.InstanceId, proj.Project, string.IsNullOrEmpty(plc) ? null : plc);
                        var current = p.Target != null && p.Target.Instance == target.Instance
                            && p.Target.Project == target.Project && p.Target.PlcProject == target.PlcProject;
                        connect.DropDownItems.Add(new ToolStripMenuItem(label, null, (_, _) => SelectTarget(p, target)) { Checked = current });
                    }
                }
            }
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

        // ── logs + diagnostics ────────────────────────────────────────────
        private LogWindow? _logWindow;

        private void ShowLogs()
        {
            if (_logWindow == null || _logWindow.IsDisposed) _logWindow = new LogWindow(() => _providers);
            _logWindow.Show();
            _logWindow.WindowState = FormWindowState.Normal;
            _logWindow.BringToFront();
            _logWindow.Activate();
        }

        private async Task CollectDiagnostics()
        {
            var path = await Diagnostics.CollectAsync(_providers);
            _icon.ShowBalloonTip(6000, "Volt",
                path != null ? $"Diagnostics saved to the Desktop ({System.IO.Path.GetFileName(path)}) — send me this file." : "Couldn't collect diagnostics (see logs).",
                path != null ? ToolTipIcon.Info : ToolTipIcon.Warning);
            if (path != null) { try { Process.Start(new ProcessStartInfo { FileName = System.IO.Path.GetDirectoryName(path), UseShellExecute = true }); } catch { } }
        }

        private void RefreshMenuLabels()
        {
            foreach (var p in _providers)
            {
                if (!_vendorItems.TryGetValue(p.Id, out var item)) continue;
                item.Text = $"{p.DisplayName} — {HealthProbe.Describe(_status[p.Id])}";
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
                g.SmoothingMode = SmoothingMode.AntiAlias;
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
