using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;
using Volt.Contracts;

namespace Volt.Connector
{
    /// <summary>
    /// The one tray app, rebuilt over the <see cref="ConnectionManager"/>. A single NotifyIcon whose colour is
    /// the aggregate connection state, and a context menu that is a thin STATUS view over the model: the update
    /// item, the detected projects across all vendors listed at the ROOT (each tagged with its platform, the
    /// serving one marked), "Resume all Volt sync", then Volt Status…, Show logs, Activate in CODESYS…, Exit.
    /// <para>Connecting is driven from the UI (desktop / VS Code) over the control plane — the tray no longer offers
    /// a "Connect to" action. It is the supervisor ESCAPE HATCH: a serving row is clickable to force-off that
    /// project, a paused row to resume it, and "Resume all Volt sync" clears every force-off at once.
    /// No per-vendor lanes, no IDE launch — the vendor difference lives entirely behind the wire.</para>
    /// </summary>
    public sealed class TrayContext : ApplicationContext
    {
        private readonly NotifyIcon _icon;
        private readonly System.Windows.Forms.Timer _timer;
        private readonly TwincatFleet _fleet = new(); // probe → reconcile → spawn/reap, all of it in Connector.Core
        private readonly string? _twincatExe = ConnectorSetup.TwincatExe();
        private int _reconcileTick; // throttles the (subprocess) XAE probe to ~every 3rd tick
        private readonly ConnectionManager _conn = new(ConnectorSetup.Sources());
        private readonly ControlServer _control;

        private ToolStripMenuItem _headerItem = null!;
        private ToolStripMenuItem _resumeAllItem = null!;
        private ToolStripMenuItem _updateItem = null!;
        private ToolStripSeparator _updateSeparator = null!;
        // The detected-project rows live at the ROOT and are rebuilt each tick; tracked so they can be removed and
        // re-inserted (just above the resume-all item) without rebuilding the whole menu.
        private readonly List<ToolStripItem> _projectItems = new();
        private string? _updateShown;
        private BridgeStatus _prevAggregate = BridgeStatus.Unknown;

        /// <summary>The tray's UI SynchronizationContext, captured while the constructor is still ON that thread.
        /// <para>`OnUiThread` used to marshal via <c>menu.InvokeRequired</c>, and a WinForms control reports
        /// <c>InvokeRequired == false</c> until its HANDLE exists. A ContextMenuStrip creates its handle when it
        /// is first SHOWN — so until the user opened the tray menu, every "marshal to the UI thread" call ran the
        /// action inline on whichever background thread it came from. That is precisely the window the marshal
        /// exists to protect: the 4s timer and the control-plane handlers both mutate the ToolStrip and the icon,
        /// and the collision they cause (a ToolStrip cleared mid-rebuild, a torn icon cache) is worst at startup,
        /// before anyone has opened the menu.</para></summary>
        private readonly System.Threading.SynchronizationContext? _ui;

        public TrayContext()
        {
            // Captured FIRST: everything below may hand a callback to a background thread.
            _ui = System.Threading.SynchronizationContext.Current;

            // TwinCAT workers are spawned per-XAE by the first TickAsync (via ReconcileTwincatWorkers) — no fixed
            // startup spawn. CODESYS is user-activated in-proc, never launched.

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

            // Control plane (:8550) — the extension / desktop app declare their interests over the session API; the
            // connector reconciles the bridges to match. GET /status is the ambient read for the connect picker.
            // ControlServer.ConfiguredPort honours VOLT_CONTROL_PORT — see there; Program.cs scopes the
            // single-instance mutex by the same number so the two instances can't collide.
            var port = ControlServer.ConfiguredPort;
            _control = new ControlServer(
                FreshSnapshotAsync, RestartWorker,
                openSession: () => _conn.OpenSessionAsync(),
                sync: SessionSyncAsync,
                closeSession: id => _conn.CloseSessionAsync(id),
                port: port);
            _control.Start();
            VoltLog.Info($"connector started on :{port}; sources: " + string.Join(", ", _conn.Sources.Select(s => s.Vendor)));

            _timer = new System.Windows.Forms.Timer { Interval = 4000 };
            _timer.Tick += async (_, _) => await TickAsync();
            _timer.Start();
            _ = TickAsync();
        }

        // ── tick: refresh the model, then repaint the views ────────────────
        private async Task TickAsync()
        {
            await ReconcileTwincatWorkers(); // spawn/reap one TwinCAT worker per XAE (and respawn a crashed one)
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

            _headerItem.Text = Updater.IsDev
                ? "Volt Connector  ·  development build (not installed via Setup)"
                : pending != null
                    ? $"Volt Connector  ·  {Updater.CurrentVersion} → {pending}"
                    : $"Volt Connector  ·  {Updater.CurrentVersion}";
            RebuildProjectItems();
            ShowUpdateIfReady();
        }

        private string StatusText()
        {
            // The frontends' sessions drive connections now, so "connected" is the set of SERVING projects (not a tray
            // highlight, which no longer exists).
            var connected = _conn.Projects.Where(p => _conn.IsServingProject(p.Id)).Select(p => p.DisplayName).ToList();
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
        // Nothing but the unified, self-describing project list — both status use cases read it (the connect surface
        // is the list; a bound workspace's status is its own row). The tray's colour is derived internally, not here.
        private ConnectorView Snapshot() => new(
            _conn.Projects.Select(p => new ProjectView(
                p.Id, p.DisplayName, p.Vendor, p.Dirty,
                p.Status, // serving derives from status (!= "idle") on the client
                p.Attach.Project, p.Pipe, p.IdeVersion)).ToList());

        // A session declares its FULL interest set; the manager reconciles the bridges and re-scans, so the snapshot
        // we return already reflects what those bridges now serve — the client reads its own row from it in one call.
        private async Task<ConnectorView> SessionSyncAsync(string sessionId, IReadOnlyCollection<Interest> interests)
        {
            await _conn.SyncAsync(sessionId, interests);
            await OnUiThread(() => _ = TickAsync()); // repaint the tray now, not up to a poll later
            return Snapshot();
        }

        // The tray owns the CLOCK for the TwinCAT fleet and nothing else — which workers exist is TwincatFleet.Tick,
        // in Connector.Core where it is testable. The exe guard below is a DUPLICATE of the fleet's own first line and
        // changes nothing observable (without an exe the fleet returns immediately); it is kept only so a no-op pass
        // doesn't advance the cadence counter.
        private async Task ReconcileTwincatWorkers()
        {
            if (string.IsNullOrEmpty(_twincatExe)) return;                 // no worker binary (dev without a build)
            if (_reconcileTick++ % 3 != 0) return;                         // ~every 3rd tick: XAE churn isn't sub-10s-sensitive
            await _fleet.Tick(_twincatExe, TimeSpan.FromSeconds(6));
        }

        private void RestartWorker(string id)
        {
            // Kill it; the next reconcile respawns it. StopWorker drops the worker entry and TwincatFleet.Tick
            // calls EnsureWorker for EVERY live XAE pid, so a still-present XAE gets a fresh worker on the next tick.
            // (TwincatSupervisor.Forget was called here to force that respawn; it couldn't — its only effect was on the
            // spawn list, which this tray discards. Deleted rather than left looking load-bearing.)
            _fleet.StopWorker(id);
        }

        // ── notifications ──────────────────────────────────────────────────
        private void OnAggregateChanged(BridgeStatus prev, BridgeStatus now)
        {
            if (prev != BridgeStatus.Connected || now is not (BridgeStatus.Unreachable or BridgeStatus.Unavailable or BridgeStatus.Unknown))
                return;

            // Only an UNEXPECTED loss is worth interrupting for. `Connected` means "serving ∧ wanted", so it also
            // drops the moment the last client stops WANTING a project — closing the app, leaving a project, a
            // Disconnect click. Those are the user's own doing and were toasting "A bridge disconnected." at them
            // every time (a live-test run popped one per declare/drop cycle). If nothing is wanted any more, this is
            // a deliberate disconnect: log it, don't interrupt. Something still wanted but no longer served IS the
            // incident — the IDE closed, the bridge died — and still toasts.
            var stillWanted = _conn.Projects.Any(p => _conn.IsWantedProject(p.Id));
            if (!stillWanted)
            {
                VoltLog.Info("bridge disconnected on request (nothing is wanted any more)");
                return;
            }
            VoltLog.Warn("a bridge disconnected unexpectedly — still wanted, no longer served");
            _icon.ShowBalloonTip(5000, "Volt", "A bridge disconnected.", ToolTipIcon.Warning);
        }

        /// <summary>Run on the WinForms UI thread. The session-sync + force-off handlers touch UI state (the balloon
        /// tip, the NotifyIcon, RebuildProjectItems' ToolStrip collection) the 4s timer is also mutating; without this
        /// marshal the two collide (a ToolStrip cleared mid-rebuild, a torn icon cache) and the tray corrupts its menu.</summary>
        private Task OnUiThread(Action action)
        {
            // Posted to the captured context, NOT gated on a control handle — see `_ui`. Already on the UI
            // thread? Run inline; posting would defer work the caller expects to have happened.
            if (_ui is null || _ui == System.Threading.SynchronizationContext.Current)
            {
                action();
                return Task.CompletedTask;
            }
            var tcs = new TaskCompletionSource<bool>();
            _ui.Post(_ =>
            {
                try { action(); tcs.TrySetResult(true); }
                catch (Exception ex) { tcs.TrySetException(ex); }
            }, null);
            return tcs.Task;
        }

        /// <summary>Toggle the supervisor force-off for one project (a clickable row). Force-off keeps the project's
        /// bridge unbound regardless of any session's interest until cleared — the escape hatch for a stuck bridge.
        /// Never throws — it is awaited from an <c>async void</c> ToolStrip click handler, where an escaped exception
        /// would take the tray down.</summary>
        private async Task ToggleForceOff(string projectId, bool forceOff)
        {
            try
            {
                await _conn.SetForceOffAsync(projectId, forceOff);
                await OnUiThread(() => _ = TickAsync()); // repaint the row's paused/connected state now
            }
            catch (Exception ex) { VoltLog.Error($"force-off toggle failed: {ex.Message}"); }
        }

        /// <summary>"Resume all Volt sync" — clear every supervisor force-off at once, so the frontends' sessions take
        /// over serving again. Never throws — it is awaited from an <c>async void</c> ToolStrip click handler, where an
        /// escaped exception would take the tray down.</summary>
        private async Task ResumeAllFromTray()
        {
            try
            {
                await _conn.SetForceOffAsync(_conn.ForceOffIds.ToList(), false);
                await OnUiThread(() => _ = TickAsync());
            }
            catch (Exception ex) { VoltLog.Error($"resume-all failed: {ex.Message}"); }
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
                Font = BoldMenuFont,
            };
            _updateSeparator = new ToolStripSeparator { Visible = false };
            menu.Items.Add(_updateItem);
            menu.Items.Add(_updateSeparator);

            // Detected projects are shown at the ROOT (status only — connecting is done from the UI). The rows are
            // inserted just above the resume-all item on each tick by RebuildProjectItems, which also drives its
            // text/visibility from there on — it is shown only while something is force-off'd.
            _resumeAllItem = new ToolStripMenuItem("Resume all Volt sync", Glyph(0xE7E8), async (_, _) => await ResumeAllFromTray()) // PowerButton
            {
                Visible = false,
            };
            menu.Items.Add(_resumeAllItem);
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

        // Built ONCE and kept for the app lifetime (like StatusIcons' cache). SystemFonts.MenuFont hands back a FRESH
        // Font the caller owns, so building this per tick leaked two GDI+ handles per serving row — ~21600 tick
        // generations a day in an always-on tray.
        private static readonly Font BoldMenuFont = BuildBoldMenuFont();

        private static Font BuildBoldMenuFont()
        {
            using var menuFont = SystemFonts.MenuFont ?? new Font("Segoe UI", 9f);
            return new Font(menuFont, FontStyle.Bold);
        }

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
        /// and set the resume-all item's state. Rows are inserted just above <see cref="_resumeAllItem"/>,
        /// the connected one marked with a check. Removes (and DISPOSES) the previous rows first so a tick can't
        /// accumulate them or their GDI+ handles.</summary>
        private void RebuildProjectItems()
        {
            var menu = _icon.ContextMenuStrip!;

            foreach (var it in _projectItems) { menu.Items.Remove(it); it.Dispose(); }
            _projectItems.Clear();

            int at = menu.Items.IndexOf(_resumeAllItem);   // insert rows directly above the resume-all item

            void AddRow(ToolStripItem item) { menu.Items.Insert(at++, item); _projectItems.Add(item); }

            if (_conn.Projects.Count == 0)
            {
                AddRow(new ToolStripMenuItem("No project detected") { Enabled = false });
            }
            else
            {
                // When a vendor has more than one live IDE, show which version each project is open in. (It can't
                // disambiguate two same-NAMED projects — identity is vendor+name, so those collapse into one row
                // upstream in ConnectionManager; see the name-identity limit in ARCHITECTURE.md.)
                var multi = _conn.Projects.GroupBy(x => x.Vendor).Where(g => g.Count() > 1).Select(g => g.Key).ToHashSet();
                foreach (var p in _conn.Projects.OrderBy(x => x.Vendor).ThenBy(x => x.DisplayName, StringComparer.OrdinalIgnoreCase))
                {
                    var serving = _conn.IsServingProject(p.Id);
                    var paused = _conn.ForceOffIds.Contains(p.Id);
                    var ver = multi.Contains(p.Vendor) && !string.IsNullOrEmpty(p.IdeVersion) ? $" ({p.IdeVersion})" : "";
                    // The frontends drive per-project connect/disconnect via their sessions; the TRAY is the supervisor
                    // escape hatch. A serving row can be force-off'd (paused regardless of interest) and a paused row
                    // resumed — those rows are clickable to toggle it. A merely-detected row is status-only (greyed).
                    var tag = paused ? "   ⏸ paused" : serving ? "   ● connected" : "";
                    var label = $"{_conn.DisplayNameOf(p.Vendor)}{ver} · {p.DisplayName}{(p.Dirty ? " *" : "")}{tag}";
                    var actionable = serving || paused;
                    var id = p.Id;
                    var row = new ToolStripMenuItem(label, null, actionable ? async (_, _) => await ToggleForceOff(id, !paused) : null)
                    {
                        Enabled = actionable,
                        Checked = serving && !paused,
                    };
                    if (serving && !paused) row.Font = BoldMenuFont;
                    AddRow(row);
                }
            }

            // The supervisor "resume everything" shortcut — shown only while some project is force-off'd (per-project
            // pause/resume happens on the rows above).
            _resumeAllItem.Visible = _conn.ForceOffIds.Count > 0;
            _resumeAllItem.Enabled = _conn.ForceOffIds.Count > 0;
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
            _fleet.Dispose();
            CloseDesktopGui();
            Updater.LaunchInstallerAndExit(installer); // Process.Start(Setup) + Environment.Exit(0)
        }

        /// <summary>Close the desktop GUI (the Electron shell, <c>Volt.exe</c>) if it's running, so the in-place
        /// upgrade can replace it — graceful close first, force-kill if it won't go. NOT the connector itself
        /// (VoltConnector) or the workers; the installer relaunches the connector when done.</summary>
        private static void CloseDesktopGui()
        {
            // Identify the GUI by its full PATH, never by friendly name. GetProcessesByName matches
            // ordinal-ignore-case, so "Volt" ALSO matches the installed CLI at <app>\bin\volt.exe — and a
            // console process has no MainWindowHandle, so CloseMainWindow() returns false and the very next
            // expression Kill()s it. That killed an in-flight `volt push` MID-WRITE to the live PLC and to the
            // git repo, from an auto-update the user never connected to that push.
            var gui = VoltEnv.GuiExe;
            foreach (var p in System.Diagnostics.Process.GetProcessesByName("Volt"))
            {
                try
                {
                    // A process we cannot identify is left alone (MainModule throws for another user's or a
                    // 32/64-bit-mismatched process). Failing to close the GUI costs an update; killing the
                    // wrong process costs someone's work.
                    if (!string.Equals(p.MainModule?.FileName, gui, StringComparison.OrdinalIgnoreCase)) continue;
                    if (!p.CloseMainWindow() || !p.WaitForExit(3000)) p.Kill();
                }
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
            _fleet.Dispose();
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
