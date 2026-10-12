using System;
using System.IO;
using Volt.Contracts;

namespace Volt.Connector
{
    /// <summary>
    /// Where the connector finds its siblings in the installed layout, and the one thing it publishes at runtime:
    /// the visible copy of the CODESYS activation scripts.
    ///
    /// <para>The layout is flat (openspec installer-rebuild): <c>{app}\connector\</c> (this exe), <c>{app}\desktop\</c>,
    /// <c>{app}\codesys\</c>, <c>{app}\bin\</c>. <b>The connector writes nothing at install time</b> — the Start Menu
    /// shortcut, the login item (Run <c>VoltConnector</c>) and the PATH entry are declared by <c>installer/Volt.iss</c>
    /// and removed by its uninstaller, and no environment variable is Volt's but PATH. They used to be written here at
    /// every startup (the Velopack-era self-configuration), which made them depend on the order a process started in
    /// and let a dev build repoint the user's login item at itself. There is no <c>--uninstall</c> verb either: the
    /// two Documents files it removed are the uninstaller's <c>[UninstallDelete]</c>.</para>
    /// </summary>
    internal static class VoltEnv
    {
        /// <summary>The install root: the parent of the connector's own directory.</summary>
        private static string AppDir => Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, ".."));

        /// <summary>The desktop GUI's full path. The auto-update identifies the GUI process by this path (see
        /// TrayContext.CloseDesktopGui).</summary>
        internal static string GuiExe => Path.Combine(AppDir, "desktop", "VoltDesktop.exe");

        /// <summary>The CLI and the LSP the installer puts on PATH (<c>{app}\bin\</c>) — the status window reads their
        /// versions, the auto-update waits for a running CLI.</summary>
        internal static string CliExe => Path.Combine(AppDir, "bin", "volt.exe");
        internal static string LspExe => Path.Combine(AppDir, "bin", "volt-lsp-iec.exe");

        /// <summary>The shipped CODESYS activation scripts + bridge DLL.</summary>
        internal static string CodesysDir => Path.Combine(AppDir, "codesys");
        private static readonly string[] ScriptNames = { "start_volt_codesys.py", "stop_volt_codesys.py" };

        // The CODESYS activation script ships inside the (hidden) install dir; a copy goes to a VISIBLE Documents\Volt
        // folder so the user can reach it in CODESYS's "Execute Script File" dialog without un-hiding AppData. That
        // copy finds the DLL through the fixed install path (`_INSTALL_SUBDIR` in the script).
        internal static string VisibleScriptDir =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Volt");
        internal static string VisibleScript => Path.Combine(VisibleScriptDir, "start_volt_codesys.py");

        /// <summary>Copy the shipped start/stop scripts into Documents\Volt (overwrite, so an update refreshes them).
        /// Runs at every startup, from a dev tray too: a dev tray that skipped it would leave the user activating
        /// whatever script an older build published (<c>CodesysActivation</c> prefers that path when it exists).</summary>
        public static void PublishCodesysScripts()
        {
            if (!Directory.Exists(CodesysDir))
            {
                VoltLog.Info($"no CODESYS scripts at {CodesysDir} — nothing published to {VisibleScriptDir}");
                return;
            }
            try
            {
                Directory.CreateDirectory(VisibleScriptDir);
                foreach (var name in ScriptNames)
                {
                    var src = Path.Combine(CodesysDir, name);
                    if (File.Exists(src)) File.Copy(src, Path.Combine(VisibleScriptDir, name), overwrite: true);
                    else VoltLog.Warn($"the shipped CODESYS script {src} is missing — not published");
                }
            }
            // Best-effort — CODESYS activation still works from the install-dir scripts — but never silent.
            catch (Exception e) { VoltLog.Warn($"could not publish the CODESYS scripts to {VisibleScriptDir}: {e.Message}"); }
        }
    }
}
