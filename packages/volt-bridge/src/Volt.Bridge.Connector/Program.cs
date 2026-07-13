using System;
using System.Threading;
using System.Windows.Forms;
using Velopack;

namespace Volt.Bridge.Connector
{
    internal static class Program
    {
        // Single-instance guard so two connectors don't both supervise the bridges.
        private static Mutex? _single;

        [STAThread]
        private static void Main(string[] args)
        {
            // Velopack MUST run first: it handles the install/update/uninstall hook invocations (Velopack calls
            // the app with special args at those lifecycle points) and process-exits for them. As the always-on
            // process, the connector is the update agent — this is where PATH + OPENCODE_CONFIG_DIR get set,
            // replacing the retired NSIS installer. Inert on non-Velopack (dev / desktop-bundled) runs.
            VelopackApp.Build()
                .SetAutoApplyOnStartup(true) // apply any update the Updater staged, at login before the GUI opens
                .OnAfterInstallFastCallback(_ => VoltEnv.Install())
                .OnAfterUpdateFastCallback(_ => VoltEnv.Install())   // re-assert env after each update (idempotent)
                .OnBeforeUninstallFastCallback(_ => VoltEnv.Uninstall())
                .Run();

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
            Updater.Start(); // always-on auto-update (no-op unless Velopack-installed)
            Application.Run(new TrayContext());

            GC.KeepAlive(_single);
        }
    }
}
