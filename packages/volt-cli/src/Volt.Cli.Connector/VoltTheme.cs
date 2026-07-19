using System.Drawing;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// Volt's visual identity for the WinForms surface — the same tokens the console + marketing site use
    /// (volt-www <c>tokens/colors.css</c>, the "Cursor look"): warm off-white surfaces, near-black ink, one
    /// restrained orange accent, a dark pill CTA. So the connector reads as the same product, not a stock dialog.
    /// </summary>
    internal static class VoltTheme
    {
        public static readonly Color Page = Hex("#f7f7f4");          // warm page
        public static readonly Color Surface = Hex("#f2f1ed");       // card
        public static readonly Color SurfaceHover = Hex("#ebeae5");
        public static readonly Color Ink = Hex("#171717");           // primary CTA / headings
        public static readonly Color Ink2 = Hex("#262626");          // body text
        public static readonly Color TextSecondary = Hex("#737373");
        public static readonly Color Accent = Hex("#f54e00");        // links / focus / the bolt
        public static readonly Color Success = Hex("#1f8a65");
        public static readonly Color Warning = Hex("#c08532");
        public static readonly Color Danger = Hex("#cf2d56");
        public static readonly Color Border = Hex("#e6e5e0");
        public static readonly Color OnDark = Hex("#f7f7f4");

        public const string Family = "Segoe UI";
        public static Font H1() => new(Family, 13.5f, FontStyle.Bold);
        public static Font Body() => new(Family, 9.75f);
        public static Font BodyBold() => new(Family, 9.75f, FontStyle.Bold);
        public static Font Small() => new(Family, 8.25f);
        public static Font PillFont() => new(Family, 8.75f, FontStyle.Bold);

        /// <summary>The one aggregate status → its dot/pill colour (mirrors the tray icon tint).</summary>
        public static Color StatusColor(BridgeStatus s) => s switch
        {
            BridgeStatus.Connected => Success,
            BridgeStatus.Degraded => Warning,
            BridgeStatus.Unavailable => Accent,
            BridgeStatus.Unreachable => Danger,
            _ => TextSecondary,
        };

        public static string StatusWord(BridgeStatus s) => s switch
        {
            BridgeStatus.Connected => "Connected",
            BridgeStatus.Degraded => "Degraded",
            BridgeStatus.Unavailable => "Waiting for a project",
            BridgeStatus.Unreachable => "No bridge running",
            _ => "Idle",
        };

        private static Color Hex(string h) => ColorTranslator.FromHtml(h);
    }
}
