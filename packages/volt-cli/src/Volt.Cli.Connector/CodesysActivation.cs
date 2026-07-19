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
        /// <summary>The shipped <c>start_pipe.py</c> the user executes inside CODESYS, or null if it can't be
        /// located beside the connector / dev tree.</summary>
        public static string? ScriptPath()
        {
            var baseDir = AppContext.BaseDirectory;
            foreach (var c in new[]
            {
                Environment.GetEnvironmentVariable("VOLT_CODESYS_SCRIPT"),
                Path.Combine(baseDir, "codesys-scriptcommands", "start_pipe.py"),
                Path.Combine(baseDir, "..", "..", "..", "..", "..", "..", "volt-cli", "scripts", "start_pipe.py"),
            })
            {
                if (string.IsNullOrEmpty(c)) continue;
                var full = Path.GetFullPath(c);
                if (File.Exists(full)) return full;
            }
            return null;
        }

        /// <summary>What to copy to the clipboard: the script path (for CODESYS's Execute-Script-File dialog).</summary>
        public static string ClipboardText() => ScriptPath() ?? "start_pipe.py";

        /// <summary>Human steps shown in the activation dialog / hint.</summary>
        public static string Steps()
        {
            var script = ScriptPath();
            return
                "Activate Volt inside your open CODESYS — Volt never launches CODESYS:\n\n" +
                "  1.  Open your project in CODESYS.\n" +
                "  2.  Tools → Scripting → Execute Script File…\n" +
                $"  3.  Choose:  {script ?? "start_pipe.py  (shipped beside the connector)"}\n\n" +
                "Volt then detects the project here — pick it from “Connect to”.\n" +
                "(“Copy script path” puts the path above on your clipboard for the file dialog.)";
        }
    }
}
