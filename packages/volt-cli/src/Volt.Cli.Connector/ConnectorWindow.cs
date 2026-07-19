using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Windows.Forms;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// The Volt-branded connector surface — the primary window, a thin view over the <see cref="ConnectionManager"/>.
    /// It shows ONE unified list of detected projects (each with its platform badge), the current connection
    /// state, and the guided CODESYS activation affordance. Re-renders whenever the model changes. Styled with
    /// Volt's identity (<see cref="VoltTheme"/>) so it reads as the same product as the console + site.
    /// </summary>
    public sealed class ConnectorWindow : Form
    {
        private readonly ConnectionManager _conn;
        private readonly Action _activate;
        private readonly Action _showLogs;
        private readonly Action _collectDiagnostics;

        private readonly FlowLayoutPanel _list;
        private readonly Label _statusPill;

        public ConnectorWindow(ConnectionManager conn, Action activate, Action showLogs, Action collectDiagnostics)
        {
            _conn = conn;
            _activate = activate;
            _showLogs = showLogs;
            _collectDiagnostics = collectDiagnostics;

            Text = "Volt Connector";
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(468, 560);
            BackColor = VoltTheme.Page;
            Font = VoltTheme.Body();
            try { Icon = Icon.FromHandle(BoltBitmap(VoltTheme.Accent, 32).GetHicon()); } catch { }

            // ── header ──
            var header = new Panel { Dock = DockStyle.Top, Height = 76, BackColor = VoltTheme.Page };
            header.Paint += (_, e) =>
            {
                var g = e.Graphics; g.SmoothingMode = SmoothingMode.HighQuality;
                using var bmp = BoltBitmap(VoltTheme.Accent, 28);
                g.DrawImage(bmp, 22, 24, 28, 28);
                using var b1 = new SolidBrush(VoltTheme.Ink);
                using var b2 = new SolidBrush(VoltTheme.TextSecondary);
                using var f1 = VoltTheme.H1(); using var f2 = VoltTheme.Small();
                g.DrawString("Volt Connector", f1, b1, 60, 20);
                g.DrawString($"v{Updater.CurrentVersion}", f2, b2, 62, 44);
                using var pen = new Pen(VoltTheme.Border); g.DrawLine(pen, 0, header.Height - 1, header.Width, header.Height - 1);
            };
            _statusPill = new Label
            {
                AutoSize = false, Size = new Size(180, 26), Location = new Point(268, 26),
                TextAlign = ContentAlignment.MiddleRight, Font = VoltTheme.BodyBold(), ForeColor = VoltTheme.TextSecondary,
                BackColor = VoltTheme.Page,
            };
            header.Controls.Add(_statusPill);
            Controls.Add(header);

            // ── body ──
            var bodyTitle = new Label
            {
                Dock = DockStyle.Top, Height = 34, Text = "  Connect to a project", ForeColor = VoltTheme.Ink2,
                Font = VoltTheme.BodyBold(), TextAlign = ContentAlignment.MiddleLeft, BackColor = VoltTheme.Page,
                Padding = new Padding(14, 0, 0, 0),
            };
            _list = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false,
                AutoScroll = true, Padding = new Padding(12, 4, 12, 12), BackColor = VoltTheme.Page,
            };

            // ── footer ──
            var footer = new Panel { Dock = DockStyle.Bottom, Height = 52, BackColor = VoltTheme.Page };
            footer.Paint += (_, e) => { using var pen = new Pen(VoltTheme.Border); e.Graphics.DrawLine(pen, 0, 0, footer.Width, 0); };
            var activateBtn = LinkButton("Activate in CODESYS…", VoltTheme.Accent);
            activateBtn.Location = new Point(12, 14); activateBtn.Click += (_, _) => _activate();
            var logs = LinkButton("Logs", VoltTheme.TextSecondary);
            logs.Location = new Point(300, 14); logs.Click += (_, _) => _showLogs();
            var diag = LinkButton("Diagnostics", VoltTheme.TextSecondary);
            diag.Location = new Point(352, 14); diag.Click += (_, _) => _collectDiagnostics();
            footer.Controls.Add(activateBtn); footer.Controls.Add(logs); footer.Controls.Add(diag);

            Controls.Add(_list);
            Controls.Add(bodyTitle);
            Controls.Add(footer);
            // Docking order: Fill added before the Top/Bottom bars so it settles between them.
            Controls.SetChildIndex(header, 0);

            _conn.Changed += OnModelChanged;
            FormClosed += (_, _) => _conn.Changed -= OnModelChanged;
            Render();
        }

        private void OnModelChanged()
        {
            if (IsDisposed) return;
            try { BeginInvoke((Action)Render); } catch { /* window gone */ }
        }

        private void Render()
        {
            var agg = _conn.Aggregate();
            _statusPill.Text = "● " + VoltTheme.StatusWord(agg) + "   ";
            _statusPill.ForeColor = VoltTheme.StatusColor(agg);

            _list.SuspendLayout();
            _list.Controls.Clear();
            var projects = _conn.Projects.OrderBy(p => p.DisplayName, StringComparer.OrdinalIgnoreCase).ToList();
            if (projects.Count == 0)
            {
                _list.Controls.Add(EmptyCard());
            }
            else
            {
                foreach (var p in projects)
                    _list.Controls.Add(ProjectCard(p, connected: _conn.SelectedOf(p.Vendor)?.Id == p.Id));
            }
            _list.ResumeLayout();
        }

        // ── cards ──────────────────────────────────────────────────────────
        private Panel ProjectCard(DetectedProject p, bool connected)
        {
            var card = Card();
            card.Paint += (_, e) =>
            {
                var g = e.Graphics; g.SmoothingMode = SmoothingMode.HighQuality;
                // platform badge
                var badge = _conn.DisplayNameOf(p.Vendor).ToUpperInvariant();
                using var badgeFont = VoltTheme.Small();
                var bw = (int)g.MeasureString(badge, badgeFont).Width + 14;
                var badgeRect = new Rectangle(14, 14, bw, 18);
                using (var bp = new SolidBrush(Color.FromArgb(28, VoltTheme.Ink)))
                using (var path = Rounded(badgeRect, 9)) g.FillPath(bp, path);
                using (var bt = new SolidBrush(VoltTheme.Ink2)) g.DrawString(badge, badgeFont, bt, 21, 15);
                // project name
                using var nameFont = VoltTheme.BodyBold();
                using var nb = new SolidBrush(VoltTheme.Ink);
                g.DrawString(p.DisplayName + (p.Dirty ? "  *" : ""), nameFont, nb, 14, 36);
            };

            var btn = PillButton(connected ? "Connected ✓" : "Connect", connected);
            btn.Location = new Point(card.Width - btn.Width - 14, 24);
            btn.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            if (!connected) btn.Click += async (_, _) =>
            {
                btn.Enabled = false; btn.Text = "Connecting…";
                try { await _conn.ConnectAsync(p); }
                catch (Exception ex) { MessageBox.Show(this, ex.Message, "Volt — connect failed", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
            };
            card.Controls.Add(btn);
            return card;
        }

        private Panel EmptyCard()
        {
            var card = Card(height: 96);
            card.Paint += (_, e) =>
            {
                using var f1 = VoltTheme.BodyBold(); using var f2 = VoltTheme.Small();
                using var b1 = new SolidBrush(VoltTheme.Ink2); using var b2 = new SolidBrush(VoltTheme.TextSecondary);
                e.Graphics.DrawString("No project detected", f1, b1, 16, 16);
                e.Graphics.DrawString("Open a project in TwinCAT, or activate Volt in CODESYS.", f2, b2, 16, 40);
            };
            var btn = PillButton("Activate in CODESYS…", primary: false);
            btn.AutoSize = false; btn.Width = 168;
            btn.Location = new Point(16, 60);
            btn.Click += (_, _) => _activate();
            card.Controls.Add(btn);
            return card;
        }

        // ── styled primitives ────────────────────────────────────────────────
        private Panel Card(int height = 64)
        {
            var card = new Panel { Width = _listCardWidth(), Height = height, Margin = new Padding(0, 0, 0, 8), BackColor = VoltTheme.Surface };
            card.Paint += (_, e) =>
            {
                var g = e.Graphics; g.SmoothingMode = SmoothingMode.HighQuality;
                var r = new Rectangle(0, 0, card.Width - 1, card.Height - 1);
                using var fill = new SolidBrush(VoltTheme.Surface);
                using var pen = new Pen(VoltTheme.Border);
                using var path = Rounded(r, 10);
                g.FillPath(fill, path); g.DrawPath(pen, path);
            };
            return card;
        }

        private int _listCardWidth() => _list.ClientSize.Width - _list.Padding.Horizontal - 4;

        private Button PillButton(string text, bool primary)
        {
            var btn = new Button
            {
                Text = text, AutoSize = false, Size = new Size(112, 30), FlatStyle = FlatStyle.Flat,
                Font = VoltTheme.PillFont(), Cursor = Cursors.Hand,
                ForeColor = primary ? VoltTheme.Success : VoltTheme.OnDark,
                BackColor = primary ? VoltTheme.Surface : VoltTheme.Ink,
            };
            btn.FlatAppearance.BorderSize = primary ? 1 : 0;
            btn.FlatAppearance.BorderColor = VoltTheme.Border;
            btn.Resize += (_, _) => btn.Region = new Region(Rounded(new Rectangle(0, 0, btn.Width, btn.Height), 15));
            btn.Region = new Region(Rounded(new Rectangle(0, 0, btn.Width, btn.Height), 15));
            return btn;
        }

        private static Button LinkButton(string text, Color color)
        {
            var b = new Button
            {
                Text = text, AutoSize = true, FlatStyle = FlatStyle.Flat, ForeColor = color, BackColor = VoltTheme.Page,
                Font = VoltTheme.Small(), Cursor = Cursors.Hand,
            };
            b.FlatAppearance.BorderSize = 0;
            b.FlatAppearance.MouseOverBackColor = VoltTheme.SurfaceHover;
            return b;
        }

        private static GraphicsPath Rounded(Rectangle r, int radius)
        {
            int d = radius * 2;
            var path = new GraphicsPath();
            if (d > r.Width) d = r.Width; if (d > r.Height) d = r.Height;
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        // The Volt lightning bolt (viewBox 0 0 24 24), matching the tray icon + app logo.
        private static Bitmap BoltBitmap(Color color, int size)
        {
            PointF[] bolt = { new(13.5f, 2f), new(4f, 14f), new(10f, 14f), new(8.5f, 22f), new(20f, 9f), new(13f, 9f) };
            var bmp = new Bitmap(size, size);
            using var g = Graphics.FromImage(bmp);
            g.SmoothingMode = SmoothingMode.HighQuality; g.Clear(Color.Transparent);
            var k = size / 24f;
            var pts = bolt.Select(p => new PointF(p.X * k, p.Y * k)).ToArray();
            using var brush = new SolidBrush(color);
            g.FillPolygon(brush, pts);
            return bmp;
        }
    }
}
