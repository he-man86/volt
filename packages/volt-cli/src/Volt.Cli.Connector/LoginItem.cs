using System;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// Start-at-login registration via the per-user Run key. Best-effort and
    /// idempotent — it never throws into startup. The installer can register the
    /// connector too; this lets a portable/standalone copy self-register so the
    /// tray is always there to supervise the bridges after a reboot.
    /// </summary>
    internal static class LoginItem
    {
        private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string ValueName = "VoltConnector";

        public static void EnsureRegistered()
        {
            try
            {
                // CreateSubKey (not OpenSubKey) so registration works on a fresh profile where the Run key doesn't
                // exist yet — OpenSubKey returns null there and we'd silently never register.
                using var key = Registry.CurrentUser.CreateSubKey(RunKey);
                var desired = "\"" + Application.ExecutablePath + "\" --silent";
                var current = key.GetValue(ValueName) as string;
                if (!string.Equals(current, desired, StringComparison.OrdinalIgnoreCase))
                    key.SetValue(ValueName, desired);
            }
            catch { /* registration is best-effort */ }
        }

        public static void Unregister()
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true);
                key?.DeleteValue(ValueName, throwOnMissingValue: false);
            }
            catch { /* best-effort */ }
        }
    }
}
