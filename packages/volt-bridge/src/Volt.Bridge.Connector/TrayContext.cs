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
                Text = "Volt Connector",
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
                },
                (id, on) =>
                {
                    var p = Find(id); if (p == null) return;
                    p.Enabled = on;
                    if (p.Archetype == Archetype.ExternalAttach) { if (on) _supervisor.EnsureWorker(p); else _supervisor.StopWorker(id); }
                });
            _control.Start();

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

                // Cache the attachable instances so the "Connect to" submenu opens instantly.
                if (p.Archetype == Archetype.ExternalAttach)
                    _instances[p.Id] = await InstanceProbe.FetchAsync(p.Port);
            }
            UpdateIcon();
            RefreshMenuLabels();

            // Publish the immutable snapshot the control plane serves on :8550.
            _snapshot = _providers.Select(p => new BridgeView(
                p.Id, p.DisplayName, p.Port, p.Archetype.ToString(),
                p.Enabled,
                p.Enabled ? HealthProbe.Describe(_status[p.Id]) : "disabled",
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
            connect.DropDownItems.Add(new ToolStripMenuItem("Default (first active)", null, (_, _) => SelectTarget(p, null)) { Checked = p.Target == null });

            var list = _instances.TryGetValue(p.Id, out var inst) ? inst : new List<TcInstanceDto>();
            if (list.Count == 0)
            {
                connect.DropDownItems.Add(new ToolStripMenuItem("(no running instances detected)") { Enabled = false });
                return;
            }
            connect.DropDownItems.Add(new ToolStripSeparator());
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
                ? $"{p.DisplayName}: attaching to the first active project…"
                : $"{p.DisplayName}: attaching to {target.Project}{(target.PlcProject != null ? " / " + target.PlcProject : "")}…",
                ToolTipIcon.Info);
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
            _control.Dispose();
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
