using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace Volt.Bridge.Connector
{
    /// <summary>The connector's log window — a live tail of the shared Volt log store, filterable by source and
    /// level, searchable, with the collect-diagnostics action right in the toolbar. No separate renderer or
    /// process: the one tray app owns its own logs surface. Closing hides it (reopening from the tray is
    /// instant); the app disposes it on exit.</summary>
    internal sealed class LogWindow : Form
    {
        private readonly ComboBox _source = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 140 };
        private readonly ComboBox _level = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 100 };
        private readonly TextBox _search = new TextBox { Width = 220, PlaceholderText = "filter…" };
        private readonly ListView _list = new ListView { View = View.Details, FullRowSelect = true, Dock = DockStyle.Fill };
        private readonly System.Windows.Forms.Timer _timer = new System.Windows.Forms.Timer { Interval = 1500 };
        private readonly Func<IReadOnlyList<VendorProvider>> _providers;

        // [ts][source][level] message   (level optional — worker Raw lines have none)
        private static readonly Regex LineRe = new Regex(
            @"^\[(?<ts>[^\]]+)\]\[(?<src>[^\]]+)\](?:\[(?<lvl>[^\]]+)\])?\s?(?<msg>.*)$", RegexOptions.Compiled);
        private const int MaxLines = 2000;

        public LogWindow(Func<IReadOnlyList<VendorProvider>> providers)
        {
            _providers = providers;
            Text = "Volt — Logs";
            Width = 940;
            Height = 520;
            StartPosition = FormStartPosition.CenterScreen;
            try { Icon = StatusIcons.For(BridgeStatus.Connected); } catch { /* icon is cosmetic */ }

            _source.Items.Add("all sources");
            _source.SelectedIndex = 0;
            _level.Items.AddRange(new object[] { "all levels", "error", "warn", "info", "debug" });
            _level.SelectedIndex = 0;

            var openFolder = new Button { Text = "Open folder", AutoSize = true };
            openFolder.Click += (_, _) => TryOpen(Log.Dir);

            var collect = new Button { Text = "Collect diagnostics", AutoSize = true };
            collect.Click += async (_, _) =>
            {
                collect.Enabled = false;
                var path = await Diagnostics.CollectAsync(_providers());
                collect.Enabled = true;
                if (path != null) TryOpen(Path.GetDirectoryName(path)!);
            };

            var top = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 36, Padding = new Padding(6, 5, 6, 5) };
            top.Controls.AddRange(new Control[] { _source, _level, _search, openFolder, collect });

            _list.Columns.Add("Time", 155);
            _list.Columns.Add("Source", 90);
            _list.Columns.Add("Level", 60);
            _list.Columns.Add("Message", 590);
            _list.Font = new Font(FontFamily.GenericMonospace, 8.5f);

            _source.SelectedIndexChanged += (_, _) => Repaint();
            _level.SelectedIndexChanged += (_, _) => Repaint();
            _search.TextChanged += (_, _) => Repaint();

            Controls.Add(_list);
            Controls.Add(top);

            _timer.Tick += (_, _) => Repaint();
            _timer.Start();
            Repaint();
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
                               || r.Src.IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0));

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

        private static List<Row> ReadRows()
        {
            var rows = new List<Row>();
            try
            {
                if (!Directory.Exists(Log.Dir)) return rows;
                foreach (var f in Directory.GetFiles(Log.Dir, "*.log"))
                {
                    string[] lines;
                    try { lines = ReadTail(f, MaxLines); } catch { continue; }
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
            rows.Sort((a, b) => string.CompareOrdinal(a.Ts, b.Ts)); // ISO-ish timestamps → lexical order is chronological
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
