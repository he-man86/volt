using System;
using System.Diagnostics;
using System.IO;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// The per-user integration the connector owns: the login item, the Start Menu shortcut, and the visible copy
    /// of the CODESYS activation scripts. Install() runs on every connector startup (idempotent); Uninstall() runs
    /// from the Inno uninstaller via `VoltConnector.exe --uninstall` (see Program.cs). Best-effort: never throws.
    ///
    /// ENV VARS ARE NOT SET HERE. PATH and VOLT_BRIDGE_DLL are published by the INSTALLER
    /// (PublishEnv in Volt.iss) and reverted by the uninstaller. They had two owners, and that is precisely what
    /// broke: the connector computes its paths from where its own exe sits, so when the installer launched it
    /// before {app}\current existed it published VERSION-SCOPED values — violating the one invariant the versioned
    /// layout rests on. Only the installer knows the final layout at the moment it is complete, so only the
    /// installer writes these. One fact, one owner.
    /// </summary>
    internal static class VoltEnv
    {
        // Layout inside the install dir: the connector sits at the ROOT, with bin\ (CLI + LSP) and desktop\ as
        // sibling subdirs — see installer/Volt.iss. Resolve relative to the connector exe so it survives wherever
        // the user installed us.
        // Every path published OUTSIDE {app} — PATH, the Start Menu shortcut, the login
        // item — MUST resolve through {app}\current, never through this version directory. That is the invariant
        // the versioned-install layout rests on: a published value naming a version would force every update to
        // rewrite HKCU (trading a file-lock race for a registry one) and would dangle between the install and the
        // new connector's first run. Falls back to the exe's own directory when no `current` sits beside it — a
        // flat install (the pre-migration layout) or a dev run out of the build output; both must keep working.
        private static string ConnectorDir
        {
            get
            {
                var self = AppContext.BaseDirectory;
                var parent = Directory.GetParent(self.TrimEnd(Path.DirectorySeparatorChar))?.FullName;
                if (parent != null)
                {
                    var current = Path.Combine(parent, "current");
                    if (Directory.Exists(current)) return current;
                }
                return self;
            }
        }
        private static string GuiExe => Path.GetFullPath(Path.Combine(ConnectorDir, "desktop", "Volt.exe"));
        private static string GuiShortcut =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Volt.lnk");

        // The CODESYS activation script ships inside the (hidden) install dir; publish a copy to a VISIBLE
        // Documents\Volt folder so the user can reach it in CODESYS's "Execute Script File" dialog without
        // un-hiding AppData. The install-dir copy stays as a backup; both find the DLLs via %LOCALAPPDATA%.
        private static string CodesysDir => Path.GetFullPath(Path.Combine(ConnectorDir, "codesys-scriptcommands"));
        private static readonly string[] ScriptNames = { "start_volt_codesys.py", "stop_volt_codesys.py" };
        private static string ShippedScript => Path.Combine(CodesysDir, "start_volt_codesys.py");
        internal static string VisibleScriptDir =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Volt");
        internal static string VisibleScript => Path.Combine(VisibleScriptDir, "start_volt_codesys.py");

        /// <summary>Install/update hook: register start-at-login + a Start Menu "Volt" shortcut to the desktop GUI
        /// (the connector itself auto-starts via the login item, so it needs no shortcut of its own — which is why
        /// the .iss lays down no [Icons]).</summary>
        public static void Install()
        {
            try
            {
                LoginItem.EnsureRegistered();
                CreateGuiShortcut();
                PublishCodesysScript();
            }
            catch { /* hooks are best-effort — never block install */ }
        }

        // Copy the shipped start/stop scripts into the visible Documents\Volt folder (idempotent — overwrite so a
        // version bump refreshes them). Best-effort: the install-dir copies still work if this fails.
        private static void PublishCodesysScript()
        {
            try
            {
                if (!Directory.Exists(CodesysDir)) return;
                Directory.CreateDirectory(VisibleScriptDir);
                foreach (var name in ScriptNames)
                {
                    var src = Path.Combine(CodesysDir, name);
                    if (File.Exists(src)) File.Copy(src, Path.Combine(VisibleScriptDir, name), overwrite: true);
                }
            }
            catch { /* best-effort — CODESYS activation falls back to the install-dir scripts */ }
        }

        private static void CreateGuiShortcut()
        {
            try
            {
                var t = Type.GetTypeFromProgID("WScript.Shell");
                if (t == null) return;
                dynamic shell = Activator.CreateInstance(t)!;
                dynamic lnk = shell.CreateShortcut(GuiShortcut);
                lnk.TargetPath = GuiExe;
                lnk.WorkingDirectory = Path.GetDirectoryName(GuiExe);
                lnk.Description = "Volt";
                lnk.Save();
            }
            catch { /* best-effort — the app still runs from the tray/CLI without a shortcut */ }
        }

        /// <summary>Uninstall hook: stop the running processes so the uninstaller can delete their files, then
        /// drop the login item, the shortcut and the published CODESYS scripts.</summary>
        public static void Uninstall()
        {
            try
            {
                // Stop the running tray connector (a SEPARATE long-lived process from this uninstall-hook
                // invocation) + the bridge workers it spawned — otherwise they hold the install dir file-locked
                // and Inno can't remove it. Exclude our own PID: killing ourselves aborts the hook.
                var self = Process.GetCurrentProcess().Id;
                foreach (var name in new[] { "VoltConnector", "Volt.Cli.Beckhoff" })
                    foreach (var p in Process.GetProcessesByName(name))
                        if (p.Id != self)
                            try { p.Kill(); p.WaitForExit(3000); } catch { }

                LoginItem.Unregister();
                try { File.Delete(GuiShortcut); } catch { }
                // Remove the published scripts + their folder (only if we left it empty).
                foreach (var name in ScriptNames)
                    try { File.Delete(Path.Combine(VisibleScriptDir, name)); } catch { }
                try { if (Directory.Exists(VisibleScriptDir) && Directory.GetFileSystemEntries(VisibleScriptDir).Length == 0) Directory.Delete(VisibleScriptDir); } catch { }
            }
            catch { /* best-effort */ }
        }

    }
}
