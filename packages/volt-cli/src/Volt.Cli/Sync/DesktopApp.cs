using System.Diagnostics;
using System.IO;

namespace Volt.Cli.Sync;

/// <summary>
/// Where the desktop app is, and how to launch it — the PURE half of <c>volt open</c>.
///
/// <para>Split from the spawn for the reason this repo already applies twice: <c>TwincatXaeProbe.Decide</c> is
/// split from its process and <c>BridgeResolver.ChooseBridgePipe</c> from its live pipe list, because the RULE
/// is what is worth testing and a spawn cannot be. Everything here is a path and a
/// <see cref="ProcessStartInfo"/>; nothing starts.</para>
/// </summary>
internal static class DesktopApp
{
    /// <summary>The desktop exe, from the directory <c>volt.exe</c> runs in.
    ///
    /// <para><c>volt.exe</c> lives in <c>{app}\current\bin</c> — PATH is set to exactly that — and <c>bin\</c>
    /// and <c>desktop\</c> are siblings in the staged payload. So the app is one level up and across. The
    /// connector states the same fact from its own position (<c>VoltEnv.GuiExe</c>) and the desktop states it in
    /// the other direction; the offsets differ because the connector sits at the install root and
    /// <c>volt.exe</c> one deeper. Three statements of one layout is one too many, but a shared helper for two
    /// callers with different offsets is a parameterized path rule — centralize at the third.</para>
    ///
    /// <para><b><see cref="Path.GetFullPath"/>, never a link resolve.</b> This is lexical: it normalizes
    /// <c>..</c> without following the <c>current</c> junction. Resolving the reparse point would yield
    /// <c>app-&lt;version&gt;</c>, and an update repoints that junction underneath a running process — so a
    /// version-resolved path can launch a build the Pruner is about to delete. Normalizing also makes the
    /// launched process's <c>MainModule.FileName</c> match what the auto-update compares the GUI against.</para></summary>
    public static string GuiExePath(string cliDir) =>
        Path.GetFullPath(Path.Combine(cliDir, "..", "desktop", "Volt.exe"));

    /// <summary>How to start it: on this workspace, from its own directory, with the parent's token.
    ///
    /// <para><c>UseShellExecute = false</c> so the child inherits this console's token. That matters in one
    /// direction only: <c>volt open</c> from an ELEVATED terminal then yields an elevated window, which will not
    /// merge with the non-elevated taskbar button and refuses Explorer drag-and-drop. Volt installs per-user and
    /// nothing here needs elevation, so the honest fix is not to elevate the terminal.</para>
    ///
    /// <para>The workspace goes in ARGV rather than the environment because argv is the only channel Electron
    /// delivers to an app that is ALREADY running (<c>second-instance</c>). An environment variable is read once
    /// at start, so a second <c>volt open &lt;otherDir&gt;</c> would carry nothing and the directory the engineer
    /// named would be silently ignored — a wrong answer, where a duplicate window is merely a nuisance.</para></summary>
    public static ProcessStartInfo LaunchInfo(string guiExe, string workspace)
    {
        var psi = new ProcessStartInfo(guiExe)
        {
            UseShellExecute = false,
            WorkingDirectory = Path.GetDirectoryName(guiExe) ?? ".",
        };
        psi.ArgumentList.Add("--workspace");
        psi.ArgumentList.Add(workspace);
        return psi;
    }
}
