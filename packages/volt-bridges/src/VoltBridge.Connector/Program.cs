using System;
using System.Threading;
using System.Windows.Forms;

namespace VoltBridge.Connector
{
    internal static class Program
    {
        // Single-instance guard so two connectors don't both supervise the bridges.
        private static Mutex? _single;

        [STAThread]
        private static void Main(string[] args)
        {
            // --silent: launched by the extension/login rather than a user double-click.
            var silent = Array.IndexOf(args, "--silent") >= 0;

            _single = new Mutex(initiallyOwned: true, "Local\\VoltConnector", out var isNew);
            if (!isNew)
            {
                if (!silent)
                    MessageBox.Show("Volt Connector is already running (see the system tray).",
                        "Volt Connector", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            // Keep the tray running across reboots so the bridges are always supervised.
            LoginItem.EnsureRegistered();

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.SetHighDpiMode(HighDpiMode.SystemAware);
            Application.Run(new TrayContext());

            GC.KeepAlive(_single);
        }
    }
}
