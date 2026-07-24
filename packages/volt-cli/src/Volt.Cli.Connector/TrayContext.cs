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
    /// the aggregate connection state, and a context menu that is a thin STATUS view over the model: the detected
    /// projects across all vendors listed at the ROOT (each tagged with its platform, the connected one marked), a
    /// force-<b>Disconnect</b>, a guided CODESYS activation affordance, and logs/diagnostics/exit.
    /// <para>Connecting is driven from the UI (desktop / VS Code) over the control plane — the tray no longer offers
    /// a "Connect to" action. It still shows what's detected and lets the user force a Disconnect when the UI can't.
    /// No per-vendor lanes, no IDE launch — the vendor difference lives entirely behind the wire.</para>
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
        private ToolStripMenuItem _disconnectItem = null!;
        private ToolStripMenuItem _updateItem = null!;
        private ToolStripSeparator _updateSeparator = null!;
        // The detected-project rows live at the ROOT and are rebuilt each tick; tracked so they can be removed and
        // re-inserted (just above the Disconnect item) without rebuilding the whole menu.
        private readonly List<ToolStripItem> _projectItems = new();
        private ToolStripSeparator _projectsSeparator = null!;
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

            // Deliberately NOT adopting an already-serving project as the active connection here. It would turn
            // the tray green for a project the user never connected, purely because its bridge is serving —
            // exactly the "green while only DETECTED, not connected" behaviour that was reported as wrong. The
            // tray answers "did you connect something"; after a restart the honest answer is no, while the
            // per-workspace status in the editor still reports connected because it asks the other question.
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
            RebuildProjectItems();
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
            return n > 0 ? $"{n} project(s) detected — connect from the app" : "no project detected";
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
                return new BridgeStatusView(s.Vendor, s.DisplayName, h.Status.ToString(), h.ProjectName, h.ProjectDirty);
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
        /// <summary>Run on the WinForms UI thread. The control plane calls TrayDisconnectAsync from a threadpool
        /// thread, and everything it touches afterwards — the balloon tip, the NotifyIcon, RebuildProjectItems'
        /// ToolStrip collection — is UI state the 4s timer is also mutating. Without this marshal the two collide
        /// (a ToolStrip cleared mid-rebuild, a torn icon cache) and the tray throws or corrupts its menu.</summary>
        private Task OnUiThread(Action action)
        {
            if (_icon.ContextMenuStrip is not { } menu || !menu.InvokeRequired) { action(); return Task.CompletedTask; }
            var tcs = new TaskCompletionSource<bool>();
            menu.BeginInvoke(new Action(() =>
            {
                try { action(); tcs.TrySetResult(true); }
                catch (Exception ex) { tcs.TrySetException(ex); }
            }));
            return tcs.Task;
        }

        private async Task<UnbindResult> TrayDisconnectAsync(string? projectId)
        {
            var active = projectId is null ? _conn.ActiveConnection : _conn.Projects.FirstOrDefault(p => p.Id == projectId);
            var result = await _conn.DisconnectAsync(projectId);
            if (active == null) return result;
            var platform = _conn.DisplayNameOf(active.Vendor);
            if (result == UnbindResult.Unsupported)
            {
                // The bridge didn't take the deselect — it predates the op and KEEPS serving the CLI. Say so
                // rather than toasting a disconnect that didn't happen.
                Log.Warn($"{active.DisplayName} ({platform}) did not accept the disconnect — its bridge is out of date");
                await OnUiThread(() => _icon.ShowBalloonTip(6000, "Volt", $"{active.DisplayName} ({platform}) is running an out-of-date bridge, so it stays connected. Restart {platform} (CODESYS: re-run start_volt_codesys.py) to finish updating.", ToolTipIcon.Warning));
                await OnUiThread(() => _ = TickAsync());
                return result;
            }
            if (result == UnbindResult.Unreachable)
            {
                // The IDE closed before the click landed. Already disconnected — no scary warning, just say so.
                Log.Info($"{active.DisplayName} ({platform}) was already gone");
                await OnUiThread(() => _ = TickAsync());
                return result;
            }
            Log.Info($"disconnected from {active.DisplayName} ({platform})");
            // Toast it, exactly like OnConnected does. Disconnect can be triggered from ANOTHER window (the VS Code
            // view / the desktop app) via the control plane, so without this the tray silently changed state — the
            // one place the user looks to confirm it said nothing at all.
            await OnUiThread(() => _icon.ShowBalloonTip(4000, "Volt", $"Disconnected from {active.DisplayName} ({platform}). The IDE stays open — connect again to resume.", ToolTipIcon.Info));
            // Repaint now instead of waiting up to a full 4s poll: the icon colour + menu are how the user sees
            // that a disconnect driven from another window actually landed.
            await OnUiThread(() => _ = TickAsync());
            return result;
        }

        /// <summary>The menu-click wrapper: never throws (the handler is async void — an escaped exception would
        /// take the tray down with it). The control plane calls TrayDisconnectAsync directly and surfaces errors.</summary>
        private async Task DisconnectFromTray()
        {
            try { await TrayDisconnectAsync(null); }
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

            // Detected projects are shown at the ROOT (status only — connecting is done from the UI). The rows are
            // inserted just above the Disconnect item on each tick by RebuildProjectItems.
            _disconnectItem = new ToolStripMenuItem("Disconnect", Glyph(0xE7E8), async (_, _) => await DisconnectFromTray()) // PowerButton
            {
                Enabled = false, // no active connection until the UI connects one
            };
            menu.Items.Add(_disconnectItem);
            _projectsSeparator = new ToolStripSeparator();
            menu.Items.Add(_projectsSeparator);

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

        /// <summary>Repopulate the ROOT-level detected-project rows (status only — connecting is done from the UI)
        /// and set the Disconnect item's enabled state. Rows are inserted just above <see cref="_disconnectItem"/>,
        /// the connected one marked with a check. Removes the previous rows first so a tick can't accumulate them.</summary>
        private void RebuildProjectItems()
        {
            var menu = _disconnectItem.Owner as ContextMenuStrip;
            if (menu == null) return;

            foreach (var it in _projectItems) menu.Items.Remove(it);
            _projectItems.Clear();

            int at = menu.Items.IndexOf(_disconnectItem);   // insert rows directly above Disconnect

            void AddRow(ToolStripItem item) { menu.Items.Insert(at++, item); _projectItems.Add(item); }

            if (_conn.Projects.Count == 0)
            {
                AddRow(new ToolStripMenuItem("No project detected") { Enabled = false });
            }
            else
            {
                // When a vendor has more than one live instance, show the IDE version so same-named projects (e.g.
                // the same project open in two CODESYS versions) are distinguishable.
                var multi = _conn.Projects.GroupBy(x => x.Vendor).Where(g => g.Count() > 1).Select(g => g.Key).ToHashSet();
                foreach (var p in _conn.Projects.OrderBy(x => x.Vendor).ThenBy(x => x.DisplayName, StringComparer.OrdinalIgnoreCase))
                {
                    var connected = _conn.SelectedOf(p.Vendor)?.Id == p.Id;
                    var ver = multi.Contains(p.Vendor) && !string.IsNullOrEmpty(p.IdeVersion) ? $" ({p.IdeVersion})" : "";
                    // Status rows: not clickable (the UI connects). Mark the connected one THREE ways so it's obvious
                    // even greyed as a disabled row — a "● connected" text tag (readable at any colour), the native
                    // checkmark, and bold. A plain detected project is greyed with no tag.
                    var tag = connected ? "   ● connected" : "";
                    var label = $"{_conn.DisplayNameOf(p.Vendor)}{ver} · {p.DisplayName}{(p.Dirty ? " *" : "")}{tag}";
                    var row = new ToolStripMenuItem(label) { Enabled = false, Checked = connected };
                    if (connected) row.Font = new Font(SystemFonts.MenuFont ?? new Font("Segoe UI", 9f), FontStyle.Bold);
                    AddRow(row);
                }
            }

            _disconnectItem.Enabled = _conn.ActiveConnection != null;
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
