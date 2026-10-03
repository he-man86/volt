using System;
using System.Linq;

namespace Volt.Tests.Shared;

/// <summary>
/// THE CROSS-DRIVER PARITY ORACLE for `Project Settings.projectsettings` (openspec <c>twincat-project-settings</c> 2.3).
///
/// <para>The two drivers cannot meet in one test process — <c>Volt.Ide.Codesys</c> is net48, <c>Volt.Ide.Twincat</c>
/// net10.0-windows — so the parity is stated ONCE, here, and each driver's suite (this file is linked into both)
/// asserts its own double against it: the same settings, the same rows, byte for byte. The wire is the parity
/// boundary, and this is that boundary's text.</para>
///
/// <para><b>The setting</b> is the one the TwinCAT fixture <c>fixtures/tc-project-settings/c0371.plcproj.xml</c> holds,
/// MEASURED (TcXaeShell 15.0 / 4024.74, Project14 copy, C0371 unchecked on the Compiler Warnings page and saved). The
/// CODESYS double is given the same disabled id.</para>
///
/// <para><b>The row</b> asserted is the one BOTH vendors source whose identity is measured: Disabled warnings (D37). Its
/// line is the one the CODESYS bridge wrote for the pro2193 and lenze-mid corpora — CODESYS-recorded ground truth, not
/// a composed string.</para>
///
/// <para><b>Not asserted, and named:</b> <see cref="UnmeasuredRows"/> — both vendors source them, but byte identity is
/// UNMEASURED (D38, task 3.4): whether TwinCAT <c>MaxWarnings=0</c> means CODESYS's integer, how the defines are
/// separated, and Replace constants, whose two measurements do not meet — every CODESYS corpus records <c>on</c>, the
/// measured TwinCAT project answers <c>false</c>, and no CODESYS recording of <c>off</c> exists (both drivers render the
/// flag through the shared <c>ProjectSettingsFormat.Flag</c>, so asserting <c>off</c> here would only prove each double
/// hands it <c>false</c>). <see cref="CodesysOnlyRows"/> have no TwinCAT source at all (D39) and are omitted there, so
/// whole files of the two vendors are never identical.</para>
/// </summary>
public static class ProjectSettingsFacts
{
    /// <summary>The disabled warning, as the bare integer both vendors store (CODESYS <c>GetDisabledWarningIds</c>,
    /// TwinCAT <c>DisabledWarningIds</c>).</summary>
    public const int DisabledWarning = 371;

    /// <summary>The lines each driver writes for that setting, in file order.</summary>
    public static readonly string[] SharedRows =
    {
        "Disabled warnings:     C0371",   // test-corpus/pro2193, test-corpus/lenze-mid (CODESYS SP21)
    };

    /// <summary>Rows both vendors source whose byte identity is UNMEASURED (D38, task 3.4).</summary>
    public static readonly string[] UnmeasuredRows = { "Replace constants", "Max compiler warnings", "Project defines" };

    /// <summary>Rows with no TwinCAT source (D39): CODESYS writes them, TwinCAT omits them.</summary>
    public static readonly string[] CodesysOnlyRows =
        { "Warnings as errors", "Unicode identifiers", "UTF-8 encoding", "Breakpoint logging" };

    /// <summary>The lines of <paramref name="descriptor"/> whose label is one of <see cref="SharedRows"/>' labels — what
    /// each driver's output is compared on.</summary>
    public static string[] SharedRowsOf(string descriptor)
    {
        var labels = SharedRows.Select(r => r.Substring(0, r.IndexOf(':') + 1)).ToArray();
        return descriptor.Split('\n')
            .Where(line => labels.Any(l => line.StartsWith(l, StringComparison.Ordinal)))
            .ToArray();
    }
}
