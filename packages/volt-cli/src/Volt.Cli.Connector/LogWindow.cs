using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace Volt.Cli.Connector
{
    /// <summary>The connector's log window — a live tail of the shared Volt log store, filterable by source and
    /// level, searchable. No separate renderer or process: the one tray app owns its own logs surface.
    /// Closing hides it (reopening from the tray is instant); the app disposes it on exit.</summary>
    internal sealed class LogWindow : Form
    {
        private readonly ComboBox _source = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 140 };
        private readonly ComboBox _level = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 100 };
        private readonly TextBox _search = new TextBox { Width = 220, PlaceholderText = "filter…" };
        private readonly ListView _list = new ListView { View = View.Details, FullRowSelect = true, Dock = DockStyle.Fill };
        private readonly System.Windows.Forms.Timer _timer = new System.Windows.Forms.Timer { Interval = 1500 };
        private string _lastRepaintHash = "";

        // [ts][source][level] message   (level optional — worker Raw lines have none)
        private static readonly Regex LineRe = new Regex(
            @"^\[(?<ts>[^\]]+)\]\[(?<src>[^\]]+)\](?:\[(?<lvl>[^\]]+)\])?\s?(?<msg>.*)$", RegexOptions.Compiled);
        private const int MaxLines = 2000;

        public LogWindow()
        {
            Text = "Volt — Logs";
            Width = 1280;
            Height = 780;
            MinimumSize = new Size(760, 420);
            StartPosition = FormStartPosition.CenterScreen;
            try { Icon = StatusIcons.For(BridgeStatus.Connected); } catch { /* icon is cosmetic */ }

            _source.Items.Add("all sources");
            _source.SelectedIndex = 0;
            _level.Items.AddRange(new object[] { "all levels", "error", "warn", "info", "debug" });
            _level.SelectedIndex = 0;

            var openFolder = new Button { Text = "Open folder", AutoSize = true };
            openFolder.Click += (_, _) => TryOpen(Log.Dir);

            var top = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 48, Padding = new Padding(6, 8, 6, 8) };
            top.Controls.AddRange(new Control[] { _source, _level, _search, openFolder });

            _list.Columns.Add("Time", 165);
            _list.Columns.Add("Source", 150);
            _list.Columns.Add("Level", 90);
            _list.Columns.Add("Message", 400); // stretched to fill by FitMessageColumn on resize
            _list.Font = new Font(FontFamily.GenericMonospace, 9.75f);
            // Message is the last column and holds the interesting text — grow it to eat all remaining width.
            _list.Resize += (_, _) => FitMessageColumn();

            _source.SelectedIndexChanged += (_, _) => { _lastRepaintHash = ""; Repaint(); };
            _level.SelectedIndexChanged += (_, _) => { _lastRepaintHash = ""; Repaint(); };
            _search.TextChanged += (_, _) => { _lastRepaintHash = ""; Repaint(); };

            _list.KeyDown += (_, e) =>
            {
                if (e.Control && e.KeyCode == Keys.A)
                {
                    foreach (ListViewItem item in _list.Items) item.Selected = true;
                    e.Handled = true;
                    e.SuppressKeyPress = true;
                }
                else if (e.Control && e.KeyCode == Keys.C)
                {
                    CopySelectedToClipboard();
                    e.Handled = true;
                }
            };

            Controls.Add(_list);
            Controls.Add(top);

            _timer.Tick += (_, _) => Repaint();
            _timer.Start();
            Repaint();
        }

        // Stretch the Message column to fill the width left over by the fixed columns (minus the scrollbar).
        private void FitMessageColumn()
        {
            var used = _list.Columns[0].Width + _list.Columns[1].Width + _list.Columns[2].Width;
            var rest = _list.ClientSize.Width - used - 4;
            if (rest > 200) _list.Columns[3].Width = rest;
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            // Hide on the user's [x] so reopening from the tray is instant; the app truly disposes us on exit.
            if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); return; }
            base.OnFormClosing(e);
        }

        private readonly record struct Row(string Ts, string Src, string Lvl, string Msg);

        private void Repaint()
        {
            var rows = ReadRows();
            SyncSourceDropdown(rows);

            var srcFilter = _source.SelectedItem as string;
            var lvlFilter = _level.SelectedItem as string;
            var q = (_search.Text ?? "").Trim();

            var filtered = rows.Where(r =>
                (srcFilter is null or "all sources" || r.Src == srcFilter) &&
                (lvlFilter is null or "all levels" || string.Equals(r.Lvl, lvlFilter, StringComparison.OrdinalIgnoreCase)) &&
                (q.Length == 0 || r.Msg.IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0
                               || r.Src.IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0)).ToList();

            var hash = filtered.Count == 0 ? "" : $"{filtered.Count}|{filtered[0].Ts}¦{filtered[0].Msg}|{filtered[filtered.Count - 1].Ts}¦{filtered[filtered.Count - 1].Msg}";
            if (hash == _lastRepaintHash) return;
            _lastRepaintHash = hash;

            _list.BeginUpdate();
            _list.Items.Clear();
            foreach (var r in filtered)
            {
                var item = new ListViewItem(new[] { r.Ts, r.Src, r.Lvl, r.Msg })
                {
                    ForeColor = r.Lvl.ToLowerInvariant() switch
                    {
                        "error" => Color.Firebrick,
                        "warn" => Color.DarkGoldenrod,
                        "debug" => Color.Gray,
                        _ => SystemColors.WindowText,
                    },
                };
                _list.Items.Add(item);
            }
            if (_list.Items.Count > 0) _list.Items[_list.Items.Count - 1].EnsureVisible();
            _list.EndUpdate();
        }

        private void SyncSourceDropdown(List<Row> rows)
        {
            var want = new List<object> { "all sources" };
            want.AddRange(rows.Select(r => r.Src).Where(s => s.Length > 0 && s != "?").Distinct().OrderBy(s => s));
            if (_source.Items.Cast<object>().SequenceEqual(want)) return;
            var current = _source.SelectedItem as string ?? "all sources";
            _source.Items.Clear();
            _source.Items.AddRange(want.ToArray());
            var idx = want.IndexOf(current);
            _source.SelectedIndex = idx >= 0 ? idx : 0;
        }

        private void CopySelectedToClipboard()
        {
            var selected = _list.SelectedItems;
            if (selected.Count == 0) return;
            var lines = new List<string>(selected.Count);
            foreach (ListViewItem item in selected)
                lines.Add(string.Join("\t", item.SubItems.Cast<ListViewItem.ListViewSubItem>().Select(s => s.Text)));
            Clipboard.SetText(string.Join(Environment.NewLine, lines));
        }

        private static List<Row> ReadRows()
        {
            var rows = new List<Row>();
            try
            {
                if (!Directory.Exists(Log.Dir)) return rows;
                // The connector writes structured "{source}-{date}.log" files; the installer deliberately
                // mirrors Setup's own (free-form, 400KB+) log into this same folder as install-*.log so the
                // support bundle has it. It doesn't parse into rows and would crowd out the real logs — skip it.
                var files = Directory.GetFiles(Log.Dir, "*.log")
                    .Where(f => !Path.GetFileName(f).StartsWith("install-", StringComparison.OrdinalIgnoreCase))
                    .ToArray();
                // Give each log file a fair share of the total budget so a chatty source
                // (e.g. TwinCAT with thousands of lines) doesn't crowd out quieter ones
                // (e.g. CODESYS) when the combined list is truncated after sorting.
                var perFile = files.Length == 0 ? MaxLines : Math.Max(300, MaxLines / files.Length);
                foreach (var f in files)
                {
                    string[] lines;
                    try { lines = ReadTail(f, perFile); } catch { continue; }
                    foreach (var l in lines)
                    {
                        if (l.Length == 0) continue;
                        var m = LineRe.Match(l);
                        rows.Add(m.Success
                            ? new Row(m.Groups["ts"].Value, m.Groups["src"].Value, m.Groups["lvl"].Value, m.Groups["msg"].Value)
                            : new Row("", "?", "", l));
                    }
                }
            }
            catch { /* best effort tail */ }
            rows.Sort((a, b) => string.CompareOrdinal(a.Ts, b.Ts));
            return rows.Count > MaxLines ? rows.GetRange(rows.Count - MaxLines, MaxLines) : rows;
        }

        private static string[] ReadTail(string path, int maxLines)
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            using var sr = new StreamReader(fs);
            var all = sr.ReadToEnd().Split('\n');
            var start = all.Length > maxLines ? all.Length - maxLines : 0;
            return all.Skip(start).Select(s => s.TrimEnd('\r')).ToArray();
        }

        private static void TryOpen(string path)
        {
            try { Process.Start(new ProcessStartInfo { FileName = path, UseShellExecute = true }); } catch { /* ignore */ }
        }
    }
}
