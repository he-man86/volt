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
        private static void Main()
        {
            _single = new Mutex(initiallyOwned: true, "Local\\VoltConnector", out var isNew);
            if (!isNew)
            {
                MessageBox.Show("Volt Connector is already running (see the system tray).",
                    "Volt Connector", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.SetHighDpiMode(HighDpiMode.SystemAware);
            Application.Run(new TrayContext());

            GC.KeepAlive(_single);
        }
    }
}
