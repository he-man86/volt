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
        private ToolStripSeparator _updateSeparator = null!;
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
            _icon.DoubleClick += (_, _) => _icon.ContextMenuStrip?.Show(Cursor.Position);
            // Clicking the "update available" toast starts the update directly — no hunting for the tray menu.
            _icon.BalloonTipClicked += (_, _) => { if (Updater.PendingVersion != null && !Updater.IsApplying) ApplyUpdate(); };

            // Control plane (:8550) — the extension / desktop app see + drive the connection over the model.
            _control = new ControlServer(FreshSnapshotAsync, ConnectByIdAsync, TrayDisconnectAsync, RestartWorker);
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

            // NOT adopting a serving project on startup, deliberately — see AdoptServingConnection, which is kept
            // (and tested) but intentionally uncalled. It would turn the tray green for a project the user never
            // connected, purely because its bridge is serving: exactly the "green while only DETECTED, not
            // connected" behaviour that was reported as wrong. The tray answers "did you connect something", and
            // after a restart the honest answer is no; the per-workspace status in the editor still reports
            // connected, because that asks the other question. Wire this up only if the tray's meaning changes.
            var agg = _conn.Aggregate();
            var pending = Updater.PendingVersion;
            _icon.Icon = StatusIcons.For(agg);
            // Tooltip surfaces the update too, so it's discoverable on hover even after the toast fades.
            var tip = "Volt Connector — " + StatusText() + (pending != null ? "  ·  update available" : "");
            _icon.Text = Truncate(tip, 63);
            if (agg != _prevAggregate) { OnAggregateChanged(_prevAggregate, agg); _prevAggregate = agg; }

            _headerItem.Text = pending != null
                ? $"Volt Connector  ·  {Updater.CurrentVersion} → {pending}"
                : $"Volt Connector  ·  {Updater.CurrentVersion}";
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

        /// <summary>What GET /status answers: LIVE state, not the tray tick's cache. A client polling every few
        /// seconds would otherwise see a change up to one tick late on top of its own interval — so an IDE closing
        /// (or a bridge being gated from another window) could take ~8s to show. The 1s floor keeps a burst of
        /// clients from re-probing every pipe on each request; a mutating action repaints immediately anyway.</summary>
        private async Task<ConnectorView> FreshSnapshotAsync()
        {
            await _conn.RefreshIfStaleAsync(TimeSpan.FromSeconds(1));
            return Snapshot();
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
                Connected: _conn.SelectedOf(p.Vendor)?.Id == p.Id, p.Pipe, p.IdeVersion, p.Attach.Project,
                Serving: _conn.IsServingProject(p.Id))).ToList());

        // Awaited (not fire-and-forget): the connect ends in a `select` on the bridge, which is also what resumes
        // a disconnected bridge — a client that refreshed right after the response would otherwise still see it
        // disconnected. A connect that throws (the project closed mid-click) is a plain false.
        private async Task<bool> ConnectByIdAsync(string projectId)
        {
            var p = _conn.Projects.FirstOrDefault(x => x.Id == projectId);
            if (p == null) return false;
            try { await _conn.ConnectAsync(p); return true; }
            catch (Exception ex) { Log.Warn($"connect to {p.DisplayName} failed: {ex.Message}"); return false; }
        }

        private void RestartWorker(string id)
        {
            var w = _workers.FirstOrDefault(x => x.Id == id);
            if (w != null) { _supervisor.StopWorker(id); _supervisor.EnsureWorker(w); }
        }

        // ── notifications ──────────────────────────────────────────────────
        // A connect names the PLATFORM, so the toast/tooltip say what it attached to, not just the project name.
        private void OnConnected(DetectedProject p)
        {
            Log.Info($"connected to {p.DisplayName} ({_conn.DisplayNameOf(p.Vendor)})");
            _icon.ShowBalloonTip(4000, "Volt", $"Connected to {p.DisplayName} ({_conn.DisplayNameOf(p.Vendor)}).", ToolTipIcon.Info);
        }

        private void OnAggregateChanged(BridgeStatus prev, BridgeStatus now)
        {
            if (prev == BridgeStatus.Connected && now is BridgeStatus.Unreachable or BridgeStatus.Unavailable or BridgeStatus.Unknown)
            {
                Log.Warn("a bridge disconnected");
                _icon.ShowBalloonTip(5000, "Volt", "A bridge disconnected.", ToolTipIcon.Warning);
            }
        }

        // Disconnect the active connection — its bridge refuses sync until the next connect, but every host stays
        // live (the CODESYS in-proc host stays loaded, the TwinCAT worker keeps its attach), so reconnecting is
        // just another connect. One place for both the tray menu and the control-plane disconnect, so the
        // "disconnected from X" line is logged wherever it's triggered.
        private async Task<bool> TrayDisconnectAsync()
        {
            var active = _conn.ActiveConnection;
            var gated = await _conn.DisconnectAsync();
            if (active == null) return gated;
            var platform = _conn.DisplayNameOf(active.Vendor);
            if (!gated)
            {
                // The bridge didn't take the deselect — it predates the op and KEEPS serving the CLI. Say so
                // rather than toasting a disconnect that didn't happen.
                Log.Warn($"{active.DisplayName} ({platform}) did not accept the disconnect — its bridge is out of date");
                _icon.ShowBalloonTip(6000, "Volt", $"{active.DisplayName} ({platform}) is running an out-of-date bridge, so it stays connected. Restart {platform} (CODESYS: re-run start_volt_codesys.py) to finish updating.", ToolTipIcon.Warning);
                await TickAsync();
                return false;
            }
            Log.Info($"disconnected from {active.DisplayName} ({platform})");
            // Toast it, exactly like OnConnected does. Disconnect can be triggered from ANOTHER window (the VS Code
            // view / the desktop app) via the control plane, so without this the tray silently changed state — the
            // one place the user looks to confirm it said nothing at all.
            _icon.ShowBalloonTip(4000, "Volt", $"Disconnected from {active.DisplayName} ({platform}). The IDE stays open — connect again to resume.", ToolTipIcon.Info);
            // Repaint now instead of waiting up to a full 4s poll: the icon colour + menu are how the user sees
            // that a disconnect driven from another window actually landed.
            await TickAsync();
            return true;
        }

        /// <summary>The menu-click wrapper: never throws (the handler is async void — an escaped exception would
        /// take the tray down with it). The control plane calls TrayDisconnectAsync directly and surfaces errors.</summary>
        private async Task DisconnectFromTray()
        {
            try { await TrayDisconnectAsync(); }
            catch (Exception ex) { Log.Error($"disconnect failed: {ex.Message}"); }
        }

        // ── menu ────────────────────────────────────────────────────────────
        private ContextMenuStrip BuildMenu()
        {
            var menu = new ContextMenuStrip();
            _headerItem = new ToolStripMenuItem($"Volt Connector  ·  {Updater.CurrentVersion}") { Enabled = false };
            menu.Items.Add(_headerItem);
            menu.Items.Add(new ToolStripSeparator());

            // Update lives at the TOP (right under the header) so it's the first thing seen, accent-tinted + bold to
            // stand out. Hidden with its own separator until a newer release is available.
            _updateItem = new ToolStripMenuItem("Restart to update", Glyph(0xE777, VoltAccent), (_, _) => ApplyUpdate()) // UpdateRestore
            {
                Visible = false,
                ForeColor = VoltAccent,
                Font = new Font(SystemFonts.MenuFont ?? new Font("Segoe UI", 9f), FontStyle.Bold),
            };
            _updateSeparator = new ToolStripSeparator { Visible = false };
            menu.Items.Add(_updateItem);
            menu.Items.Add(_updateSeparator);

            _connectItem = new ToolStripMenuItem("Connect to") { Image = Glyph(0xE71B) }; // Link
            _connectItem.DropDownItems.Add(new ToolStripMenuItem("(no project detected)") { Enabled = false });
            menu.Items.Add(_connectItem);
            menu.Items.Add(new ToolStripSeparator());

            menu.Items.Add(new ToolStripMenuItem("Volt Status…", Glyph(0xE946), (_, _) => ShowStatus())); // Info
            menu.Items.Add(new ToolStripMenuItem("Show logs", Glyph(0xE7C3), (_, _) => ShowLogs())); // Page

            // ── Help ──
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(new ToolStripMenuItem("Activate in CODESYS…", Glyph(0xE897, VoltAccent), (_, _) => ShowCodesysActivation())); // Help
            menu.Items.Add(new ToolStripMenuItem("Exit", Glyph(0xE8BB), (_, _) => ExitThreadCore())); // ChromeClose
            return menu;
        }

        // Volt's accent (blue), used to tint the help glyph so it reads as a help affordance.
        private static readonly Color VoltAccent = Color.FromArgb(0x2F, 0x7C, 0xF6);

        /// <summary>Menu icon by Segoe MDL2 codepoint (e.g. 0xE777) — avoids embedding raw glyph chars in source.</summary>
        private static Image Glyph(int codepoint, Color? color = null) => Glyph(char.ConvertFromUtf32(codepoint), color);

        /// <summary>A 16×16 monochrome menu icon from the built-in Segoe MDL2 Assets glyph font (ships on
        /// Win10/11) — a themed icon with no image assets to bundle. Colour defaults to the menu text colour.</summary>
        private static Image Glyph(string ch, Color? color = null)
        {
            var bmp = new Bitmap(16, 16);
            using var g = Graphics.FromImage(bmp);
            g.Clear(Color.Transparent);
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
            using var f = new Font("Segoe MDL2 Assets", 7.5f);
            using var b = new SolidBrush(color ?? SystemColors.MenuText);
            using var fmt = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
            g.DrawString(ch, f, b, new RectangleF(0, 0, 16, 16), fmt);
            return bmp;
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
            // When a vendor has more than one live instance, show the IDE version so same-named projects (e.g. the
            // same project open in two CODESYS versions) are distinguishable.
            var multi = _conn.Projects.GroupBy(x => x.Vendor).Where(g => g.Count() > 1).Select(g => g.Key).ToHashSet();
            foreach (var p in _conn.Projects.OrderBy(x => x.Vendor).ThenBy(x => x.DisplayName, StringComparer.OrdinalIgnoreCase))
            {
                var connected = _conn.SelectedOf(p.Vendor)?.Id == p.Id;
                var ver = multi.Contains(p.Vendor) && !string.IsNullOrEmpty(p.IdeVersion) ? $" ({p.IdeVersion})" : "";
                var label = $"{_conn.DisplayNameOf(p.Vendor)}{ver} · {p.DisplayName}{(p.Dirty ? " *" : "")}";
                var captured = p;
                _connectItem.DropDownItems.Add(new ToolStripMenuItem(label, null, (_, _) => ConnectTo(captured)) { Checked = connected });
            }
            // Disconnect = the bridge stops serving sync (every host stays live). Enabled only when one is connected.
            _connectItem.DropDownItems.Add(new ToolStripSeparator());
            // async void handler — an escaped exception would kill the tray process, so it can never propagate
            // (same guard as ConnectTo).
            _connectItem.DropDownItems.Add(new ToolStripMenuItem("Disconnect", Glyph(0xE7E8), async (_, _) => await DisconnectFromTray()) // PowerButton
            {
                Enabled = _conn.ActiveConnection != null,
            });
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

        // ── logs ──────────────────────────────────────────────
        private LogWindow? _logWindow;

        private void ShowLogs()
        {
            if (_logWindow == null || _logWindow.IsDisposed) _logWindow = new LogWindow();
            _logWindow.Show();
            _logWindow.WindowState = FormWindowState.Normal;
            _logWindow.BringToFront();
            _logWindow.Activate();
        }

        // ── status ────────────────────────────────────────────
        private StatusWindow? _statusWindow;

        private void ShowStatus()
        {
            if (_statusWindow == null || _statusWindow.IsDisposed) _statusWindow = new StatusWindow(ApplyUpdate, ShowLogs);
            _statusWindow.Show();
            _statusWindow.WindowState = FormWindowState.Normal;
            _statusWindow.BringToFront();
            _statusWindow.Activate();
        }

        private void ShowUpdateIfReady()
        {
            var pending = Updater.PendingVersion;
            var show = pending != null;
            _updateItem.Visible = show;
            _updateSeparator.Visible = show;
            if (!show) return;
            // While a download/apply is in flight, ApplyUpdate owns the item's text/enabled state — don't fight it.
            if (!Updater.IsApplying)
            {
                _updateItem.Enabled = true;
                _updateItem.Text = $"Restart to update to {pending}";
            }
            if (pending == _updateShown) return;
            _updateShown = pending;
            _icon.ShowBalloonTip(8000, "Volt update available",
                $"Volt {pending} is available — click here to update, or pick “Restart to update” from the tray.", ToolTipIcon.Info);
        }

        // The one-click update: download the installer, THEN orderly-stop everything holding {app} files so Inno's
        // silent upgrade never fails on a lock the Restart Manager can't clear (a tray/Electron window), then launch
        // it and exit. async void is correct here — it's a UI-thread action and the awaits resume on the UI thread.
        private async void ApplyUpdate()
        {
            if (Updater.IsApplying) return;
            _updateItem.Enabled = false;
            _updateItem.Text = "Downloading update…";
            var installer = await Updater.DownloadPendingAsync();
            if (installer == null) // download failed / already in flight — restore the action (the tick refreshes it)
            {
                _updateItem.Enabled = true;
                _updateItem.Text = $"Restart to update to {Updater.PendingVersion}";
                return;
            }
            _updateItem.Text = "Installing update…";
            // Stop the timer FIRST so it can't respawn a worker we're about to kill, then drop everything under {app}:
            // the bridge-worker child tree (supervisor) and the Electron GUI. Now the installer replaces free files.
            _timer.Stop();
            _supervisor.Dispose();
            CloseDesktopGui();
            Updater.LaunchInstallerAndExit(installer); // Process.Start(Setup) + Environment.Exit(0)
        }

        /// <summary>Close the desktop GUI (the Electron shell, <c>Volt.exe</c>) if it's running, so the in-place
        /// upgrade can replace it — graceful close first, force-kill if it won't go. NOT the connector itself
        /// (VoltConnector) or the workers; the installer relaunches the connector when done.</summary>
        private static void CloseDesktopGui()
        {
            foreach (var p in System.Diagnostics.Process.GetProcessesByName("Volt"))
            {
                try { if (!p.CloseMainWindow() || !p.WaitForExit(3000)) p.Kill(); }
                catch { /* already gone / access denied — best effort */ }
            }
        }

        private static string Truncate(string s, int max) => s.Length <= max ? s : s.Substring(0, max - 1) + "…";

        protected override void ExitThreadCore()
        {
            _timer.Stop();
            _control.Dispose();
            _logWindow?.Dispose();
            _statusWindow?.Dispose();
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
