using System;
using System.Windows.Forms;
using Microsoft.Win32;

namespace VoltBridge.Connector
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
                using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true);
                if (key == null) return;
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

        public static bool IsRegistered()
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: false);
                return key?.GetValue(ValueName) is string;
            }
            catch { return false; }
        }
    }
}
