using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// The one tray app, rebuilt over the <see cref="ConnectionManager"/>. A single NotifyIcon whose colour is
    /// the aggregate connection state, and a context menu that is a thin view over the model: ONE unified
    /// "Connect to" list of every detected project across all vendors (each tagged with its platform), a guided
    /// CODESYS activation affordance, and logs/diagnostics/exit. No per-vendor lanes, no IDE launch — the
    /// vendor difference lives entirely behind the wire.
    /// </summary>
    public sealed class TrayContext : ApplicationContext
    {
        private readonly NotifyIcon _icon;
        private readonly System.Windows.Forms.Timer _timer;
        private readonly BridgeSupervisor _supervisor = new();
        private readonly IReadOnlyList<WorkerSpec> _workers = ConnectorSetup.Workers();
        private readonly ConnectionManager _conn = new(ConnectorSetup.Sources());
        private readonly ControlServer _control;

        private ToolStripMenuItem _headerItem = null!;
        private ToolStripMenuItem _connectItem = null!;
        private ToolStripMenuItem _updateItem = null!;
        private ConnectorWindow? _window;
        private string? _updateShown;
        private BridgeStatus _prevAggregate = BridgeStatus.Unknown;

        public TrayContext()
        {
            _conn.Connected += OnConnected;

            // Spawn the ExternalAttach workers (TwinCAT). CODESYS is user-activated in-proc — never launched.
            foreach (var w in _workers) _supervisor.EnsureWorker(w);

            _icon = new NotifyIcon
            {
                Visible = true,
                Text = "Volt Connector",
                Icon = StatusIcons.For(BridgeStatus.Unknown),
                ContextMenuStrip = BuildMenu(),
            };
            _icon.DoubleClick += (_, _) => OpenWindow();   // the branded window is the primary surface

            // Control plane (:8550) — the extension / desktop app see + drive the connection over the model.
            _control = new ControlServer(Snapshot, ConnectById, RestartWorker);
            _control.Start();
            Log.Info("connector started; sources: " + string.Join(", ", _conn.Sources.Select(s => s.Vendor)));

            _timer = new System.Windows.Forms.Timer { Interval = 4000 };
            _timer.Tick += async (_, _) => await TickAsync();
            _timer.Start();
            _ = TickAsync();
        }

        // ── tick: refresh the model, then repaint the views ────────────────
        private async Task TickAsync()
        {
            foreach (var w in _workers) _supervisor.EnsureWorker(w); // respawn a crashed worker
            await _conn.RefreshAsync();

            var agg = _conn.Aggregate();
            _icon.Icon = StatusIcons.For(agg);
            _icon.Text = Truncate("Volt Connector — " + StatusText(), 63);
            if (agg != _prevAggregate) { OnAggregateChanged(_prevAggregate, agg); _prevAggregate = agg; }

            _headerItem.Text = $"Volt Connector  ·  {Updater.CurrentVersion}";
            RebuildConnectMenu();
            ShowUpdateIfReady();
        }

        private string StatusText()
        {
            var connected = _conn.Sources
                .Select(s => _conn.SelectedOf(s.Vendor))
                .Where(p => p != null)
                .Select(p => p!.DisplayName)
                .ToList();
            if (connected.Count > 0) return "connected: " + string.Join(", ", connected);
            var n = _conn.Projects.Count;
            return n > 0 ? $"{n} project(s) detected — pick one" : "no project detected";
        }

        // ── snapshot for the control plane ─────────────────────────────────
        // One shape covering both status use cases: per-vendor bridge health (A) + the unified project list (B).
        private ConnectorView Snapshot() => new(
            _conn.Aggregate().ToString(),
            _conn.Sources.Select(s =>
            {
                var h = _conn.HealthOf(s.Vendor);
                return new BridgeStatusView(s.Vendor, s.DisplayName, h.Status.ToString(), h.ProjectName, h.ProjectDirty, h.ActiveOp);
            }).ToList(),
            _conn.Projects.Select(p => new ProjectView(
                p.Id, p.DisplayName, p.Vendor, p.Dirty,
                Connected: _conn.SelectedOf(p.Vendor)?.Id == p.Id)).ToList());

        private bool ConnectById(string projectId)
        {
            var p = _conn.Projects.FirstOrDefault(x => x.Id == projectId);
            if (p == null) return false;
            _ = _conn.ConnectAsync(p);
            return true;
        }

        private void RestartWorker(string id)
        {
            var w = _workers.FirstOrDefault(x => x.Id == id);
            if (w != null) { _supervisor.StopWorker(id); _supervisor.EnsureWorker(w); }
        }

        // ── notifications ──────────────────────────────────────────────────
        // A connect names the PLATFORM, so the toast/tooltip say what it attached to, not just the project name.
        private void OnConnected(DetectedProject p) =>
            _icon.ShowBalloonTip(4000, "Volt", $"Connected to {p.DisplayName} ({_conn.DisplayNameOf(p.Vendor)}).", ToolTipIcon.Info);

        private void OnAggregateChanged(BridgeStatus prev, BridgeStatus now)
        {
            if (prev == BridgeStatus.Connected && now is BridgeStatus.Unreachable or BridgeStatus.Unavailable or BridgeStatus.Unknown)
                _icon.ShowBalloonTip(5000, "Volt", "A bridge disconnected.", ToolTipIcon.Warning);
        }

        // ── menu ────────────────────────────────────────────────────────────
        private ContextMenuStrip BuildMenu()
        {
            var menu = new ContextMenuStrip();
            _headerItem = new ToolStripMenuItem($"Volt Connector  ·  {Updater.CurrentVersion}") { Enabled = false };
            menu.Items.Add(_headerItem);
            menu.Items.Add(new ToolStripSeparator());

            var open = new ToolStripMenuItem("Open Volt", null, (_, _) => OpenWindow());
            open.Font = new Font(open.Font, FontStyle.Bold);
            menu.Items.Add(open);

            _connectItem = new ToolStripMenuItem("Connect to");
            _connectItem.DropDownItems.Add(new ToolStripMenuItem("(no project detected)") { Enabled = false });
            menu.Items.Add(_connectItem);

            menu.Items.Add(new ToolStripMenuItem("Activate in CODESYS…", null, (_, _) => ShowCodesysActivation()));
            menu.Items.Add(new ToolStripSeparator());

            _updateItem = new ToolStripMenuItem("Restart to update", null, (_, _) =>
            {
                _updateItem.Enabled = false;
                _updateItem.Text = "Downloading update…";
                Updater.RestartToApply();
            }) { Visible = false };
            menu.Items.Add(_updateItem);
            menu.Items.Add("Show logs", null, (_, _) => ShowLogs());
            menu.Items.Add("Collect diagnostics", null, (_, _) => CollectDiagnostics());
            menu.Items.Add("Exit", null, (_, _) => ExitThreadCore());
            return menu;
        }

        /// <summary>Repopulate the ONE unified "Connect to" list — every detected project across all vendors,
        /// each with its platform prefix, the connected one checked. No per-vendor lanes.</summary>
        private void RebuildConnectMenu()
        {
            _connectItem.DropDownItems.Clear();
            if (_conn.Projects.Count == 0)
            {
                _connectItem.DropDownItems.Add(new ToolStripMenuItem("(no project detected)") { Enabled = false });
                _connectItem.DropDownItems.Add(new ToolStripSeparator());
                _connectItem.DropDownItems.Add(new ToolStripMenuItem("Don't see CODESYS? Activate in CODESYS…", null, (_, _) => ShowCodesysActivation()));
                return;
            }
            foreach (var p in _conn.Projects.OrderBy(x => x.DisplayName, StringComparer.OrdinalIgnoreCase))
            {
                var connected = _conn.SelectedOf(p.Vendor)?.Id == p.Id;
                var label = $"{_conn.DisplayNameOf(p.Vendor)} · {p.DisplayName}{(p.Dirty ? " *" : "")}";
                var captured = p;
                _connectItem.DropDownItems.Add(new ToolStripMenuItem(label, null, (_, _) => ConnectTo(captured)) { Checked = connected });
            }
        }

        private async void ConnectTo(DetectedProject p)
        {
            try { await _conn.ConnectAsync(p); }
            catch (Exception ex) { _icon.ShowBalloonTip(5000, "Volt", $"Couldn't connect to {p.DisplayName}: {ex.Message}", ToolTipIcon.Warning); }
        }

        private void ShowCodesysActivation()
        {
            try { Clipboard.SetText(CodesysActivation.ClipboardText()); } catch { /* clipboard busy — the dialog still shows the path */ }
            MessageBox.Show(CodesysActivation.Steps(), "Activate Volt in CODESYS", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private void OpenWindow()
        {
            if (_window == null || _window.IsDisposed)
                _window = new ConnectorWindow(_conn, ShowCodesysActivation, ShowLogs, CollectDiagnostics);
            _window.Show();
            _window.WindowState = FormWindowState.Normal;
            _window.BringToFront();
            _window.Activate();
        }

        // ── logs / diagnostics ──────────────────────────────────────────────
        private LogWindow? _logWindow;

        private void ShowLogs()
        {
            if (_logWindow == null || _logWindow.IsDisposed) _logWindow = new LogWindow();
            _logWindow.Show();
            _logWindow.WindowState = FormWindowState.Normal;
            _logWindow.BringToFront();
            _logWindow.Activate();
        }

        private void CollectDiagnostics()
        {
            try
            {
                var zip = Diagnostics.Collect(_supervisor.LogDir, Snapshot(), Updater.CurrentVersion);
                _icon.ShowBalloonTip(5000, "Volt", $"Diagnostics saved to {zip}", ToolTipIcon.Info);
            }
            catch (Exception ex) { _icon.ShowBalloonTip(5000, "Volt", $"Collect diagnostics failed: {ex.Message}", ToolTipIcon.Warning); }
        }

        private void ShowUpdateIfReady()
        {
            var pending = Updater.PendingVersion;
            if (pending == null) return;
            _updateItem.Visible = true;
            _updateItem.Enabled = !Updater.IsApplying;
            _updateItem.Text = Updater.IsApplying ? "Downloading update…" : $"Restart to update to {pending}";
            if (pending == _updateShown) return;
            _updateShown = pending;
            _icon.ShowBalloonTip(8000, "Volt update available",
                $"Volt {pending} is available. Pick “Restart to update to {pending}” from the tray.", ToolTipIcon.Info);
        }

        private static string Truncate(string s, int max) => s.Length <= max ? s : s.Substring(0, max - 1) + "…";

        protected override void ExitThreadCore()
        {
            _timer.Stop();
            _control.Dispose();
            _window?.Dispose();
            _logWindow?.Dispose();
            _icon.Visible = false;
            _supervisor.Dispose();
            _icon.Dispose();
            base.ExitThreadCore();
        }
    }

    /// <summary>Generates the Volt-bolt tray icon once per status (kept for the app lifetime), tinted by
    /// aggregate connection state.</summary>
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
            const int size = 32;
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
