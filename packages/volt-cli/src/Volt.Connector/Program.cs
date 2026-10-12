using System;
using System.Threading;
using System.Windows.Forms;
using Volt.Contracts;

namespace Volt.Connector
{
    internal static class Program
    {
        // Single-instance guard so two connectors don't both supervise the bridges.
        private static Mutex? _single;

        [STAThread]
        private static void Main(string[] args)
        {
            // FIRST statement, deliberately: VoltLog is a no-op until Init, so anything logged above this line
            // would be silently dropped rather than merely unnoticed.
            VoltLog.Init("connector");

            // --silent: launched by the installer, the login item, or a test harness rather than a user double-click.
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

            // The one thing the connector publishes: the visible Documents\Volt copy of the CODESYS scripts. Nothing
            // else — the shortcut, the login item and PATH are the installer's (installer/Volt.iss), so a dev build
            // running out of bin\ can no longer claim the machine.
            VoltEnv.PublishCodesysScripts();

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.SetHighDpiMode(HighDpiMode.SystemAware);
            Updater.Start(); // always-on auto-update (no-op on an unstamped build — FileVersion 1.0.0.0 → "(dev)")
            Application.Run(new TrayContext());

            GC.KeepAlive(_single);
        }
    }
}
