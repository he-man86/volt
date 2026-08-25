using System;
using System.Windows.Forms;
using Microsoft.Win32;
using Volt.Wire;
using Volt.Contracts;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// Start-at-login registration via the per-user Run key. Best-effort and
    /// idempotent — it never throws into startup. This class is the ONLY writer of
    /// the Run value; the installer only REMOVES it on uninstall (a fallback for a
    /// failed connector hook). A portable/standalone copy therefore self-registers
    /// too, so the tray is always there to supervise the bridges after a reboot.
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
            // Best-effort — never block startup — but never silent either: a missing login item is why the tray
            // is gone after a reboot, and that needs a line to read.
            catch (Exception e) { VoltLog.Warn($"login-item registration failed: {e.Message}"); }
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
