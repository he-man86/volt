using System;
using System.IO;
using System.Text.RegularExpressions;
using Volt.Cli.Sync;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// <c>volt open</c> FINDS THE DESKTOP THE INSTALLER LAYS DOWN (openspec installer-rebuild, final review).
/// <see cref="DesktopApp.GuiExePath"/> states the flat layout from the CLI's side (<c>{app}\bin\volt.exe</c> →
/// <c>{app}\desktop\VoltDesktop.exe</c>), and nothing else checked it: <c>test:install</c> never runs <c>volt open</c>,
/// so a rename in <c>installer/Volt.iss</c> (the desktop exe was <c>Volt.exe</c> until this change) would have left the
/// verb pointing at nothing. The installer is the source of truth: the CLI's answer must be the Start Menu shortcut's
/// target, from the folder the installer puts on PATH.
/// </summary>
public class DesktopAppTests
{
    private static string VoltIss()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
        {
            var iss = Path.Combine(dir.FullName, "installer", "Volt.iss");
            if (File.Exists(iss)) return File.ReadAllText(iss);
        }
        throw new InvalidOperationException($"installer/Volt.iss not found above {AppContext.BaseDirectory}");
    }

    [Fact]
    public void From_the_PATH_folder_the_desktop_is_the_Start_Menu_shortcut_target()
    {
        var iss = VoltIss();
        var shortcut = Regex.Match(iss, @"^Name: ""\{userprograms\}\\Volt""; Filename: ""\{app\}\\([^""]+)""", RegexOptions.Multiline);
        Assert.True(shortcut.Success, "Volt.iss declares no {userprograms}\\Volt shortcut with an {app}-relative target");
        var pathEntry = Regex.Match(iss, @"AddPathEntry\(AppDir \+ '\\([^']+)'\)");
        Assert.True(pathEntry.Success, "Volt.iss adds no AppDir-relative PATH entry");

        var app = @"C:\Users\someone\AppData\Local\Programs\Volt";
        Assert.Equal(Path.Combine(app, shortcut.Groups[1].Value),
            DesktopApp.GuiExePath(Path.Combine(app, pathEntry.Groups[1].Value)));
    }
}
