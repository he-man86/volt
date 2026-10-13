using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Volt.Repo.Gates;

/// <summary>
/// THE INSTALLER RUNS WHERE WMI DOES NOT (openspec <c>environment-dependency-audit</c> 2.7). Setup found Volt's running
/// processes through WbemScripting (<c>Win32_Process</c>); with the Windows Management Instrumentation service disabled
/// or broken, <c>ConnectServer</c> raised and every install, update and uninstall ended on a Pascal runtime error. The
/// processes now come from kernel32's own snapshot (<c>installer/Processes.iss</c>), which no service can switch off —
/// and nothing in the installer may reach WMI again.
/// </summary>
public class InstallerNeedsNoWmiTests
{
    private static string Installer => Path.Combine(NoCodeCheckLeftTests.RepoRoot(), "installer");

    [Fact]
    public void No_installer_script_reaches_WMI()
    {
        var hits = Directory.GetFiles(Installer, "*.iss")
            .SelectMany(f => File.ReadAllLines(f).Select((l, i) => (File: Path.GetFileName(f), Line: i + 1, Text: l)))
            .Where(x => Regex.IsMatch(x.Text, @"WbemScripting|SWbem|Win32_Process|winmgmts|ExecQuery", RegexOptions.CultureInvariant))
            .Select(x => $"{x.File}:{x.Line}: {x.Text.Trim()}")
            .ToList();
        Assert.True(hits.Count == 0, "the installer reaches WMI (use Processes.iss's snapshot):\n" + string.Join("\n", hits));
    }

    [Fact]
    public void Volt_iss_takes_its_processes_from_the_snapshot()
    {
        var iss = File.ReadAllText(Path.Combine(Installer, "Volt.iss"));
        Assert.Contains("#include \"Processes.iss\"", iss);
        var processes = File.ReadAllText(Path.Combine(Installer, "Processes.iss"));
        Assert.Contains("CreateToolhelp32Snapshot@kernel32.dll", processes);
        // the 32-bit Setup's PROCESSENTRY32W: a wrong size makes Process32FirstW fail, which RunningProcesses raises on
        Assert.Contains("E.dwSize := 556;", processes);
    }

    /// <summary>
    /// AN ELEVATED VOLT PROCESS IS NAMED AT ONCE, not waited on for 30 s (gate 2c+3 review). WMI read no path for an
    /// elevated process, so the old stop never saw an elevated connector or worker and went on — into a locked file. The
    /// snapshot DOES read its path, and a per-user (non-elevated) setup is denied PROCESS_TERMINATE on it: StopOwn must
    /// stop on that refusal and say what it is (elevated: close it, or run setup as administrator), and the setup's
    /// message must carry it — never "could not stop … see the setup log" after spinning out the clock.
    /// </summary>
    [Fact]
    public void An_elevated_Volt_process_is_refused_by_name_at_once()
    {
        var processes = File.ReadAllText(Path.Combine(Installer, "Processes.iss"));
        Assert.Matches(@"function TerminatePid\(Pid: DWord\): DWord;", processes);   // the Windows error, not a bare False
        var iss = File.ReadAllText(Path.Combine(Installer, "Volt.iss"));
        var stopOwn = iss.Substring(iss.IndexOf("function StopOwn(", System.StringComparison.Ordinal));
        stopOwn = stopOwn.Substring(0, stopOwn.IndexOf("\nend;", System.StringComparison.Ordinal));
        Assert.Contains("ERROR_ACCESS_DENIED", stopOwn);
        Assert.Contains("StopRefusal :=", stopOwn);
        Assert.Contains("StopRefusal", iss.Substring(iss.IndexOf("function PrepareToInstall(", System.StringComparison.Ordinal)));
    }
}
