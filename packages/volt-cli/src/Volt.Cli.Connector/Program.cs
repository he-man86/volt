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

            // One connector PER CONTROL PORT. The production instance owns the classic name, so double-clicking the
            // tray app still says "already running"; an instance on an overridden VOLT_CONTROL_PORT gets its own
            // name and coexists — otherwise the live-test tier could never run a connector of its own, whatever
            // port it was given.
            var port = ControlServer.ConfiguredPort;
            _single = new Mutex(initiallyOwned: true, port == ControlServer.ControlPort ? "Local\\VoltConnector" : $"Local\\VoltConnector.{port}", out var isNew);
            if (!isNew)
            {
                if (!silent)
                    MessageBox.Show("Volt Connector is already running (see the system tray).",
                        "Volt Connector", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            // Prune superseded version directories now, while nothing holds them (the installer can't — at install
            // time the old version's processes are still running). Best-effort; a locked one waits for a later start.
            Pruner.PruneOldVersions();

            // Self-configure on startup (idempotent, best-effort): create the Start Menu shortcut and register the
            // login item so the tray survives reboots. Runs right after the installer launches us, and every login.
            // (Env — OPENCODE_CONFIG_DIR/PATH — is written by the installer, not here; see VoltEnv.)
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
