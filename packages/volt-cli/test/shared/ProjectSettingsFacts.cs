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
/// <para><b>The rows</b> asserted are the four BOTH vendors source, and each line is one a LIVE bridge of each vendor
/// served for the same setting (task 3.4, 2026-10-03, D38): Disabled warnings (also the pro2193 / lenze-mid corpus
/// line), Replace constants <c>off</c> (CODESYS SP21 with <c>ReplaceConstants=false</c>, TcXaeShell answering
/// <c>false</c>), Max compiler warnings <c>100</c> — and the number MEANS the same on both: N warnings are shown and
/// the rest dropped, 0 showing none (CODESYS adds a "More than N warnings occured" line; TwinCAT's page names 0
/// "&lt;no limit&gt;", but its build showed no warning at 0) — and <see cref="DefinesRow"/>, the defines as the engineer
/// typed them (both vendors store the string raw: <c>A,B</c> and <c>A, B</c> each came back as typed on both).
/// <see cref="CodesysOnlyRows"/> have no TwinCAT source at all (D39) and are omitted there, so whole files of the two
/// vendors are never identical.</para>
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
        "Replace constants:     off",     // live, both vendors (task 3.4)
        "Max compiler warnings: 100",     // live, both vendors; every CODESYS corpus
    };

    /// <summary>Two defines as typed, with a space — the TwinCAT fixture <c>nested-project-defines.xml</c> (measured:
    /// <c>CompilerDefines</c> = <c>A, B</c>) and the CODESYS <c>ProjectDefines</c> string, as both bridges served it.</summary>
    public const string Defines = "A, B";
    public const string DefinesRow = "Project defines:       A, B";

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
