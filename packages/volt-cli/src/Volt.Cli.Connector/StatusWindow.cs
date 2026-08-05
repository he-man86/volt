using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// The "Volt — Status" window: the installed version + update channel/action, and a live view of EVERY installed
    /// part's version so you can confirm they're all in sync (a ✓/⚠ per Volt component vs the expected version — a
    /// drifted LSP or a stale sideloaded extension lights up). Opened from the tray. Replaces the old
    /// collect-diagnostics zip with a live view; closing hides it (reopening is instant).
    /// </summary>
    internal sealed class StatusWindow : Form
    {
        private readonly Action _applyUpdate;
        private readonly Action _showLogs;

        private readonly Label _statusLabel = new();
        private readonly Button _updateBtn = new() { Text = "Restart to update", AutoSize = true, Visible = false };
        private readonly Button _checkBtn = new() { Text = "Check now", AutoSize = true };
        private readonly RadioButton _stable = new() { Text = "Stable — released builds", AutoSize = true };
        private readonly RadioButton _dev = new() { Text = "Dev — latest fixes, pre-release (may be rough)", AutoSize = true };
        private readonly Label _channelHint = new() { AutoSize = true, ForeColor = SystemColors.GrayText, Font = new Font(FontFamily.GenericSansSerif, 8f) };
        private readonly ListView _components = new() { View = View.Details, FullRowSelect = true, Dock = DockStyle.Fill, HeaderStyle = ColumnHeaderStyle.Nonclickable };
        private readonly System.Windows.Forms.Timer _poll = new() { Interval = 2000 };

        private static string InstallDir => AppContext.BaseDirectory; // the connector sits at the install root
        private static string Expected => BuildId(Updater.CurrentVersion); // the build every component should match

        public StatusWindow(Action applyUpdate, Action showLogs)
        {
            _applyUpdate = applyUpdate;
            _showLogs = showLogs;

            Text = "Volt — Status";
            FormBorderStyle = FormBorderStyle.Sizable;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 9.75f);
            ClientSize = new Size(560, 520);
            MinimumSize = new Size(500, 460);
            try { Icon = StatusIcons.For(BridgeStatus.Connected); } catch { /* icon is cosmetic */ }

            var root = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, Padding = new Padding(20), RowCount = 6 };
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize)); // header
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize)); // update row
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize)); // channel
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize)); // components label
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); // components list
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize)); // footer

            var header = new Label
            {
                // A dev build says so plainly (and in a warning colour) rather than showing a version-shaped string
                // that reads like a real release — the confusion an unstamped 1.0.0.0 caused. The second line
                // explains it; kept inside this one label so the fixed-index row layout below is undisturbed.
                Text = Updater.IsDev
                    ? "Volt Connector — development build\nUnstamped local build — run the published Volt Setup to install a real release and turn on updates."
                    : $"Volt Connector    v{Updater.CurrentVersion}",
                AutoSize = true, Font = new Font("Segoe UI Semibold", 13.5f), Margin = new Padding(0, 0, 0, 14),
                ForeColor = Updater.IsDev ? Color.FromArgb(0xB0, 0x6A, 0x00) : SystemColors.ControlText,
            };
            root.Controls.Add(header, 0, 0);

            // ── update row ──
            var updateRow = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = new Padding(0, 0, 0, 12) };
            _statusLabel.AutoSize = true;
            _statusLabel.Anchor = AnchorStyles.Left;
            _statusLabel.Margin = new Padding(0, 7, 16, 0);
            _checkBtn.Click += (_, _) => { Updater.CheckNow(); _checkBtn.Text = "Checking…"; _checkBtn.Enabled = false; };
            _updateBtn.Click += (_, _) => _applyUpdate();
            _updateBtn.ForeColor = Color.FromArgb(0x2F, 0x7C, 0xF6);
            _checkBtn.AutoSize = true; _checkBtn.Padding = new Padding(8, 3, 8, 3); _checkBtn.Margin = new Padding(0, 3, 6, 0);
            _updateBtn.Padding = new Padding(8, 3, 8, 3); _updateBtn.Margin = new Padding(0, 3, 6, 0);
            updateRow.Controls.Add(_statusLabel);
            updateRow.Controls.Add(_updateBtn);
            updateRow.Controls.Add(_checkBtn);
            root.Controls.Add(updateRow, 0, 1);

            // ── channel ──
            var channelBox = new GroupBox { Text = "Update channel", AutoSize = true, Dock = DockStyle.Top, Padding = new Padding(10, 6, 10, 10), Margin = new Padding(0, 0, 0, 6) };
            var channelFlow = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, Dock = DockStyle.Top };
            _stable.Checked = Updater.Channel != "dev";
            _dev.Checked = Updater.Channel == "dev";
            _stable.CheckedChanged += (_, _) => { if (_stable.Checked) OnChannel("stable"); };
            _dev.CheckedChanged += (_, _) => { if (_dev.Checked) OnChannel("dev"); };
            if (Updater.ChannelPinnedByEnv)
            {
                _stable.Enabled = _dev.Enabled = false;
                _channelHint.Text = "Pinned by the VOLT_UPDATE_CHANNEL environment variable.";
            }
            channelFlow.Controls.Add(_stable);
            channelFlow.Controls.Add(_dev);
            channelFlow.Controls.Add(_channelHint);
            channelBox.Controls.Add(channelFlow);
            root.Controls.Add(channelBox, 0, 2);

            var compLabel = new Label { Text = "Installed components", AutoSize = true, Font = new Font(Font, FontStyle.Bold), Margin = new Padding(0, 10, 0, 4) };
            root.Controls.Add(compLabel, 0, 3);

            _components.Columns.Add("Component", 210);
            _components.Columns.Add("Version", 190);
            _components.Columns.Add("In sync", 110);
            _components.BorderStyle = BorderStyle.FixedSingle;
            _components.SizeChanged += (_, _) => FitColumns();
            root.Controls.Add(_components, 0, 4);

            var footer = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Bottom, FlowDirection = FlowDirection.RightToLeft, Margin = new Padding(0, 8, 0, 0) };
            var logsBtn = new Button { Text = "Open logs", AutoSize = true };
            logsBtn.Click += (_, _) => _showLogs();
            footer.Controls.Add(logsBtn);
            root.Controls.Add(footer, 0, 5);

            Controls.Add(root);

            _poll.Tick += (_, _) => RefreshUpdateStatus();
        }

        // Refresh on every show — the window is hidden (not disposed) on close, so OnShown fires only the FIRST
        // time; re-read on each open so a version change since last time (e.g. an editor extension update) shows up.
        // Also gate the poll on visibility so it isn't ticking while hidden.
        protected override void OnVisibleChanged(EventArgs e)
        {
            base.OnVisibleChanged(e);
            if (Visible)
            {
                _poll.Start();
                RefreshUpdateStatus();
                _ = LoadComponentsAsync();
            }
            else
            {
                _poll.Stop();
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); return; }
            base.OnFormClosing(e);
        }

        private void OnChannel(string channel)
        {
            if (Updater.ChannelPinnedByEnv) return;
            Updater.SetChannel(channel);
            _checkBtn.Text = "Checking…"; _checkBtn.Enabled = false;
        }

        private void RefreshUpdateStatus()
        {
            var pending = Updater.PendingVersion;
            _updateBtn.Visible = pending != null;
            _updateBtn.Text = Updater.IsApplying ? "Downloading…" : $"Restart to update to {pending}";
            _updateBtn.Enabled = !Updater.IsApplying;
            _statusLabel.Text = pending != null ? "● Update available:" : "● Up to date";
            _statusLabel.ForeColor = pending != null ? Color.FromArgb(0x2F, 0x7C, 0xF6) : Color.FromArgb(0x2E, 0x7D, 0x32);
            if (_checkBtn.Text == "Checking…" && _checkBtn.Enabled == false)
            {
                // Re-enable a couple ticks after a check was fired.
                _checkBtn.Text = "Check now"; _checkBtn.Enabled = true;
            }
        }

        // ── component versions (shelled out; a Volt part is ✓ when its X.Y.Z matches the connector's) ──
        private async Task LoadComponentsAsync()
        {
            _components.Items.Clear();
            _components.Items.Add(new ListViewItem(new[] { "loading…", "", "" }));

            var rows = await Task.Run(() =>
            {
                var list = new List<(string name, string version, bool? inSync)>();

                var cli = Exe(Path.Combine(InstallDir, "bin", "volt.exe"), "--version");
                list.Add(("volt (CLI)", cli, Sync(cli)));

                var lspRaw = Exe(Path.Combine(InstallDir, "bin", "volt-lsp-iec.exe"), "--version");
                var lsp = lspRaw.StartsWith("volt-lsp-iec ") ? lspRaw.Substring("volt-lsp-iec ".Length).Trim() : lspRaw;
                list.Add(("volt-lsp-iec (LSP)", lsp, Sync(lsp)));

                foreach (var (editor, label) in new[] { ("code", "VS Code"), ("windsurf", "Windsurf"), ("cursor", "Cursor") })
                {
                    var v = ExtensionVersion(editor);
                    if (v.Length > 0) list.Add(($"VS Code ext ({label})", v, Sync(v)));
                }

                return list;
            });

            if (IsDisposed) return;
            _components.BeginUpdate();
            _components.Items.Clear();
            foreach (var (name, version, inSync) in rows)
            {
                var mark = inSync switch { true => "✓ in sync", false => "⚠ drift", _ => "" };
                var item = new ListViewItem(new[] { name, version.Length > 0 ? version : "—", mark })
                {
                    ForeColor = inSync == false ? Color.Firebrick : SystemColors.WindowText,
                };
                _components.Items.Add(item);
            }
            _components.EndUpdate();
            FitColumns();
        }

        // Stretch the Version column to fill the width the fixed columns leave (minus the scrollbar).
        private void FitColumns()
        {
            if (_components.Columns.Count < 3) return;
            var rest = _components.ClientSize.Width - _components.Columns[0].Width - _components.Columns[2].Width - 4;
            if (rest > 120) _components.Columns[1].Width = rest;
        }

        /// <summary>A Volt component is in sync when its build matches the connector's. See <see cref="BuildId"/>.</summary>
        private static bool? Sync(string version)
        {
            if (string.IsNullOrWhiteSpace(version) || Expected == "(dev)") return null;
            return BuildId(version) == Expected;
        }

        /// <summary>
        /// The drift discriminator. On dev/prerelease builds it's the git build number (the large monotonic commit
        /// count) — the connector/CLI/LSP carry it as the 4th segment (<c>0.0.1.842</c>), the extension as its patch
        /// (<c>0.0.842</c>, since a vsix can't be 4-part). On tagged stable builds there is no build segment, so we
        /// fall back to the X.Y.Z base. Comparing THIS, not the base, is what lets a stale sideloaded extension light
        /// up: every component shares base 0.0.1, so only the build number actually differs when one drifts.
        /// (Heuristic ceiling: a trailing segment ≥ 1000 is treated as a build count, never a human patch number.)
        /// </summary>
        private static string BuildId(string v)
        {
            var parts = (v ?? "").Trim().Split('.');
            if (parts.Length >= 3 && int.TryParse(parts[^1], out var last) && last >= 1000) return last.ToString();
            return Base(v);
        }

        private static string Base(string v)
        {
            var parts = (v ?? "").Trim().Split('.');
            return parts.Length >= 3 ? $"{parts[0]}.{parts[1]}.{parts[2]}" : (v ?? "").Trim();
        }

        // Run a known .exe directly (volt/lsp — real paths, no shell needed).
        private static string Exe(string path, string args)
        {
            if (!File.Exists(path)) return "";
            return Capture(new ProcessStartInfo(path, args));
        }

        // Run a PATH command / shim (the editor launchers are .cmd on PATH) via cmd.exe.
        private static string Shim(string commandline) =>
            Capture(new ProcessStartInfo("cmd.exe", "/c " + commandline));

        private static string ExtensionVersion(string editor)
        {
            var outp = Shim($"{editor} --list-extensions --show-versions");
            foreach (var line in outp.Split('\n'))
                if (line.Contains("volt-vscode", StringComparison.OrdinalIgnoreCase))
                {
                    var at = line.LastIndexOf('@');
                    return at >= 0 ? line.Substring(at + 1).Trim() : line.Trim();
                }
            return "";
        }

        private static string Capture(ProcessStartInfo psi)
        {
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            try
            {
                using var p = Process.Start(psi);
                if (p == null) return "";
                var outp = p.StandardOutput.ReadToEnd();
                if (!p.WaitForExit(4000)) { try { p.Kill(); } catch { } return ""; }
                return outp.Trim();
            }
            catch { return ""; }
        }
    }
}
