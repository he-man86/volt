using System;
using System.IO;

namespace Volt.Cli.Connector
{
    /// <summary>
    /// Guided CODESYS activation. CODESYS has no external attach API, so its bridge must load INSIDE a running
    /// CODESYS — but the connector guides, it never drives: it does not launch CODESYS. This provides the exact
    /// steps + the script the user runs (Tools → Scripting), plus the path to put on the clipboard. Once the user
    /// runs it, the in-proc host serves the pipe and the connector detects the project like any other.
    /// </summary>
    public static class CodesysActivation
    {
        /// <summary>The install-dir (hidden, AppData) copy of <c>start_volt_codesys.py</c> — the backup, shipped beside the
        /// connector; also covers the dev tree.</summary>
        private static string? BackupScriptPath()
        {
            var baseDir = AppContext.BaseDirectory;
            foreach (var c in new[]
            {
                Path.Combine(baseDir, "codesys-scriptcommands", "start_volt_codesys.py"),
                Path.Combine(baseDir, "..", "..", "..", "..", "..", "..", "volt-cli", "scripts", "start_volt_codesys.py"),
            })
            {
                var full = Path.GetFullPath(c);
                if (File.Exists(full)) return full;
            }
            return null;
        }

        /// <summary>The <c>start_volt_codesys.py</c> the user executes inside CODESYS: the VISIBLE Documents\Volt copy
        /// first (published on connector startup), then the install-dir backup / dev tree. Null if none exist.</summary>
        public static string? ScriptPath()
        {
            var env = Environment.GetEnvironmentVariable("VOLT_CODESYS_SCRIPT");
            if (!string.IsNullOrEmpty(env) && File.Exists(Path.GetFullPath(env))) return Path.GetFullPath(env);
            if (File.Exists(VoltEnv.VisibleScript)) return VoltEnv.VisibleScript;
            return BackupScriptPath();
        }

        /// <summary>What to copy to the clipboard: the primary script path (for CODESYS's Execute-Script-File dialog).</summary>
        public static string ClipboardText() => ScriptPath() ?? "start_volt_codesys.py";

        /// <summary>Human steps shown in the activation dialog / hint. Shows BOTH the visible Documents copy (the
        /// one to run) and the install-dir backup, so the user can find it either way.</summary>
        public static string Steps()
        {
            var primary = ScriptPath();
            var backup = BackupScriptPath();
            var backupLine = backup != null && !string.Equals(backup, primary, StringComparison.OrdinalIgnoreCase)
                ? $"\nBackup copy (if you can’t find the above):\n  {backup}\n"
                : "";
            return
                "Activate Volt inside your open CODESYS — Volt never launches CODESYS:\n\n" +
                "  1.  Open your project in CODESYS.\n" +
                "  2.  Tools → Scripting → Execute Script File…\n" +
                $"  3.  Choose:  {primary ?? "start_volt_codesys.py  (shipped beside the connector)"}\n" +
                backupLine +
                "\nVolt then detects the project — connect to it from the Volt app or VS Code.\n" +
                "To disconnect later: do it there, or run stop_volt_codesys.py the same way.\n" +
                "(The tray only pauses a project that is already serving, via its row.)\n" +
                "(“Copy script path” puts the primary path on your clipboard for the file dialog.)";
        }
    }
}
