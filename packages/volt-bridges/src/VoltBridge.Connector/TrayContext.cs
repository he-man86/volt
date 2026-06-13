using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace VoltBridge.Connector
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
        private readonly Dictionary<string, ToolStripMenuItem> _vendorItems = new();

        public TrayContext()
        {
            _providers = ConnectorConfig.DefaultProviders();
            foreach (var p in _providers) _status[p.Id] = BridgeStatus.Unknown;

            _icon = new NotifyIcon
            {
                Visible = true,
                Text = "Volt Connector",
                Icon = StatusIcons.For(BridgeStatus.Unknown),
                ContextMenuStrip = BuildMenu(),
            };

            // Start the external-attach workers up front.
            foreach (var p in _providers) _supervisor.EnsureWorker(p);

            _timer = new System.Windows.Forms.Timer { Interval = 4000 };
            _timer.Tick += async (_, _) => await TickAsync();
            _timer.Start();
            _ = TickAsync(); // first probe immediately
        }

        private async Task TickAsync()
        {
            foreach (var p in _providers)
            {
                if (!p.Enabled) { _status[p.Id] = BridgeStatus.Unknown; continue; }
                if (p.Archetype == Archetype.ExternalAttach) _supervisor.EnsureWorker(p); // respawn if it died

                var prev = _status[p.Id];
                var now = await HealthProbe.ProbeAsync(p.Port);
                _status[p.Id] = now;
                if (now != prev) OnStatusChanged(p, prev, now);
            }
            UpdateIcon();
            RefreshMenuLabels();
        }

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
            var enabled = _providers.Where(p => p.Enabled).Select(p => _status[p.Id]).ToList();
            var agg = enabled.Count == 0 ? BridgeStatus.Unknown : enabled.OrderByDescending(Severity).First();
            _icon.Icon = StatusIcons.For(agg);
            _icon.Text = "Volt Connector — " + string.Join(", ",
                _providers.Where(p => p.Enabled).Select(p => $"{p.DisplayName}: {HealthProbe.Describe(_status[p.Id])}"));
            if (_icon.Text.Length > 63) _icon.Text = _icon.Text.Substring(0, 60) + "…"; // NotifyIcon.Text limit
        }

        private static int Severity(BridgeStatus s) => s switch
        {
            BridgeStatus.Connected => 0,
            BridgeStatus.Unknown => 1,
            BridgeStatus.Degraded => 2,
            BridgeStatus.Unavailable => 3,
            BridgeStatus.Unreachable => 4,
            _ => 1,
        };

        // ── menu ──────────────────────────────────────────────────────────
        private ContextMenuStrip BuildMenu()
        {
            var menu = new ContextMenuStrip();
            menu.Items.Add(new ToolStripMenuItem("Volt Connector") { Enabled = false });
            menu.Items.Add(new ToolStripSeparator());

            foreach (var p in _providers)
            {
                var item = new ToolStripMenuItem(p.DisplayName);
                if (p.Archetype == Archetype.ExternalAttach)
                {
                    item.DropDownItems.Add("Restart bridge", null, (_, _) => { _supervisor.StopWorker(p.Id); _supervisor.EnsureWorker(p); });
                    item.DropDownItems.Add("Stop bridge", null, (_, _) => _supervisor.StopWorker(p.Id));
                }
                else // InIdeLoad
                {
                    var launch = new ToolStripMenuItem($"Open {p.DisplayName} (Volt)", null, (_, _) =>
                    {
                        if (!_supervisor.LaunchIde(p))
                            _icon.ShowBalloonTip(6000, "Volt",
                                $"Couldn't launch {p.DisplayName} — set its install path (VOLT_CODESYS_EXE) and the bridge script.", ToolTipIcon.Warning);
                    })
                    { Enabled = p.CanLaunchIde };
                    item.DropDownItems.Add(launch);
                }
                var toggle = new ToolStripMenuItem("Enabled") { Checked = p.Enabled, CheckOnClick = true };
                toggle.CheckedChanged += (_, _) =>
                {
                    p.Enabled = toggle.Checked;
                    if (!p.Enabled && p.Archetype == Archetype.ExternalAttach) _supervisor.StopWorker(p.Id);
                };
                item.DropDownItems.Add(new ToolStripSeparator());
                item.DropDownItems.Add(toggle);

                _vendorItems[p.Id] = item;
                menu.Items.Add(item);
            }

            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Open logs folder", null, (_, _) =>
            {
                try { Process.Start(new ProcessStartInfo { FileName = _supervisor.LogDir, UseShellExecute = true }); } catch { }
            });
            menu.Items.Add("Exit", null, (_, _) => ExitThreadCore());
            return menu;
        }

        private void RefreshMenuLabels()
        {
            foreach (var p in _providers)
            {
                if (!_vendorItems.TryGetValue(p.Id, out var item)) continue;
                var state = p.Enabled ? HealthProbe.Describe(_status[p.Id]) : "disabled";
                item.Text = $"{p.DisplayName} — {state}";
            }
        }

        protected override void ExitThreadCore()
        {
            _timer.Stop();
            _icon.Visible = false;
            _supervisor.Dispose();
            _icon.Dispose();
            base.ExitThreadCore();
        }
    }

    /// <summary>Generates the tray dots once per status (kept for the app lifetime).</summary>
    internal static class StatusIcons
    {
        private static readonly Dictionary<BridgeStatus, Icon> Cache = new();

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
            using var bmp = new Bitmap(16, 16);
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);
                using var brush = new SolidBrush(color);
                g.FillEllipse(brush, 2, 2, 12, 12);
            }
            var icon = Icon.FromHandle(bmp.GetHicon());
            Cache[s] = icon;
            return icon;
        }
    }
}
