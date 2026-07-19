using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// The opencode-integration + PATH wiring. Install() runs on every connector startup (idempotent); Uninstall()
    /// runs from the Inno uninstaller via `VoltConnector.exe --uninstall` (see Program.cs). Sets per-user env vars
    /// so opencode picks up Volt's config and the shell resolves `volt` / `volt-lsp-iec`. Idempotent + best-effort:
    /// never throws. Additive to opencode (an extra merged config dir) — uninstall reverts it.
    /// </summary>
    internal static class VoltEnv
    {
        // Layout inside the install dir: the connector sits at the ROOT, with bin\ (CLI + LSP) and opencode-config\
        // (the agent layer) as sibling subdirs — see installer/Volt.iss. Resolve relative to the connector exe
        // so it survives wherever the user installed us.
        private static string ConnectorDir => AppContext.BaseDirectory;
        private static string BinDir => Path.GetFullPath(Path.Combine(ConnectorDir, "bin"));
        private static string ConfigDir => Path.GetFullPath(Path.Combine(ConnectorDir, "opencode-config"));
        private static string GuiExe => Path.GetFullPath(Path.Combine(ConnectorDir, "desktop", "Volt.exe"));
        private static string GuiShortcut =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Volt.lnk");

        /// <summary>Install/update hook: set OPENCODE_CONFIG_DIR + add bin to PATH + register start-at-login +
        /// a Start Menu "Volt" shortcut to the desktop GUI (the connector itself auto-starts via the login item,
        /// so it needs no shortcut of its own — which is why the .iss lays down no [Icons]).</summary>
        public static void Install()
        {
            try
            {
                SetUserVar("OPENCODE_CONFIG_DIR", ConfigDir, expand: false);
                PathAdd(BinDir);
                Broadcast();
                LoginItem.EnsureRegistered();
                CreateGuiShortcut();
            }
            catch { /* hooks are best-effort — never block install */ }
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
        /// revert every env change (opencode returns to vanilla).</summary>
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

                if (string.Equals(ReadUserVar("OPENCODE_CONFIG_DIR"), ConfigDir, StringComparison.OrdinalIgnoreCase))
                    DeleteUserVar("OPENCODE_CONFIG_DIR");
                PathRemove(BinDir);
                Broadcast();
                LoginItem.Unregister();
                try { File.Delete(GuiShortcut); } catch { }
            }
            catch { /* best-effort */ }
        }

        // ── per-user env via the registry, preserving PATH's REG_EXPAND_SZ ─────────────────────────────────
        // Environment.SetEnvironmentVariable(User) rewrites the value as REG_SZ; doing that to PATH strips its
        // REG_EXPAND_SZ type so any %VAR% entries stop expanding at login. Write PATH as ExpandString instead,
        // and dedup case-insensitively (Windows paths are case-insensitive; add + remove must agree).
        private const string EnvKey = "Environment";

        private static void PathAdd(string dir)
        {
            var raw = ReadUserVar("Path") ?? "";
            foreach (var p in raw.Split(';'))
                if (string.Equals(p, dir, StringComparison.OrdinalIgnoreCase)) return; // already on PATH
            SetUserVar("Path", raw.Length == 0 ? dir : raw + ";" + dir, expand: true);
        }

        private static void PathRemove(string dir)
        {
            var raw = ReadUserVar("Path") ?? "";
            var kept = string.Join(";", Array.FindAll(raw.Split(';'),
                p => p.Length > 0 && !string.Equals(p, dir, StringComparison.OrdinalIgnoreCase)));
            SetUserVar("Path", kept, expand: true);
        }

        private static string? ReadUserVar(string name)
        {
            using var key = Registry.CurrentUser.OpenSubKey(EnvKey);
            // DoNotExpand: read the raw stored value (with any %VAR% intact) so a round-trip preserves it.
            return key?.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames) as string;
        }

        private static void SetUserVar(string name, string value, bool expand)
        {
            using var key = Registry.CurrentUser.CreateSubKey(EnvKey);
            key.SetValue(name, value, expand ? RegistryValueKind.ExpandString : RegistryValueKind.String);
        }

        private static void DeleteUserVar(string name)
        {
            using var key = Registry.CurrentUser.OpenSubKey(EnvKey, writable: true);
            key?.DeleteValue(name, throwOnMissingValue: false);
        }

        // Registry writes don't notify running processes (SetEnvironmentVariable used to); broadcast so new
        // shells + Explorer pick up the change without a logoff.
        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        private static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, string lParam,
            uint fuFlags, uint uTimeout, out IntPtr lpdwResult);

        private static void Broadcast()
        {
            try
            {
                SendMessageTimeout((IntPtr)0xffff /*HWND_BROADCAST*/, 0x1A /*WM_SETTINGCHANGE*/, IntPtr.Zero,
                    "Environment", 0x0002 /*SMTO_ABORTIFHUNG*/, 5000, out _);
            }
            catch { /* notification is best-effort */ }
        }
    }
}
