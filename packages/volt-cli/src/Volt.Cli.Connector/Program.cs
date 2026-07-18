using System;
using System.Threading;
using System.Windows.Forms;

namespace Volt.Cli.Connector
{
    internal static class Program
    {
        // Single-instance guard so two connectors don't both supervise the bridges.
        private static Mutex? _single;

        [STAThread]
        private static void Main(string[] args)
        {
            // Uninstall hook: the Inno uninstaller runs `VoltConnector.exe --uninstall` BEFORE deleting files, so
            // we revert env (OPENCODE_CONFIG_DIR + PATH) and stop the running tray/workers here, then exit.
            if (Array.IndexOf(args, "--uninstall") >= 0)
            {
                VoltEnv.Uninstall();
                return;
            }

            // --silent: launched by the installer/login/extension rather than a user double-click.
            var silent = Array.IndexOf(args, "--silent") >= 0;

            _single = new Mutex(initiallyOwned: true, "Local\\VoltConnector", out var isNew);
            if (!isNew)
            {
                if (!silent)
                    MessageBox.Show("Volt Connector is already running (see the system tray).",
                        "Volt Connector", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            // Self-configure on startup (idempotent, best-effort): set OPENCODE_CONFIG_DIR + PATH, create the
            // Start Menu shortcut, and register the login item so the tray survives reboots. Runs right after the
            // installer launches us, and every login — which is why the .iss itself sets no env and no [Icons].
            VoltEnv.Install();

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.SetHighDpiMode(HighDpiMode.SystemAware);
            Updater.Start(); // always-on auto-update (no-op on dev builds without a version.txt)
            Application.Run(new TrayContext());

            GC.KeepAlive(_single);
        }
    }
}
