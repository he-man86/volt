using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Engine.Format.Settings;

namespace Volt.Engine.Tests;

/// <summary>
/// The `.projectsettings` format — the one renderer both drivers hand their vendor's settings to (openspec
/// <c>twincat-project-settings</c> 1.2 / 2.2).
///
/// <para><b>The bodies below are real.</b> <see cref="Pro2193"/> and <see cref="Bakon"/> are the exact files the
/// CODESYS bridge wrote for the corpus projects (<c>test-corpus/pro2193</c>, <c>test-corpus/bakon-nano</c>), padding
/// and all, because these bytes are hashed into the item version: moving the renderer out of the CODESYS driver must
/// not re-flow one byte of them.</para>
/// </summary>
public class ProjectSettingsFormatTests
{
    // test-corpus/pro2193/Project Settings.projectsettings — C0371 disabled (CODESYS SP21).
    private const string Pro2193 =
        "Disabled warnings:     C0371\n" +
        "Replace constants:     on\n" +
        "Unicode identifiers:   off\n" +
        "UTF-8 encoding:        off\n" +
        "Max compiler warnings: 100\n" +
        "Breakpoint logging:    on\n";

    // test-corpus/bakon-nano/Project Settings.projectsettings — nothing disabled (the vendor's list is null).
    private const string Bakon =
        "Replace constants:     on\n" +
        "Unicode identifiers:   off\n" +
        "UTF-8 encoding:        off\n" +
        "Max compiler warnings: 100\n" +
        "Breakpoint logging:    on\n";

    [Fact]
    public void A_codesys_corpus_file_is_reproduced_byte_for_byte()
    {
        Assert.Equal(Pro2193, ProjectSettingsFormat.Write(new ProjectSettings(
            DisabledWarnings: new[] { 371 }, WarningsAsErrors: null,
            ReplaceConstants: true, UnicodeIdentifiers: false, Utf8Encoding: false,
            MaxCompilerWarnings: "100", BreakpointLogging: true, ProjectDefines: "")));
        Assert.Equal(Bakon, ProjectSettingsFormat.Write(new ProjectSettings(
            DisabledWarnings: null, WarningsAsErrors: null,
            ReplaceConstants: true, UnicodeIdentifiers: false, Utf8Encoding: false,
            MaxCompilerWarnings: "100", BreakpointLogging: true, ProjectDefines: null)));
    }

    /// <summary>A row with NO vendor source (null) is omitted — never defaulted — and still holds the column: the
    /// width is the widest DECLARED label ("Max compiler warnings", 21) + 2 whichever rows a vendor fills, so the rows
    /// two vendors share are byte-identical lines (DIALECT D39: TwinCAT sources four of the eight).</summary>
    [Fact]
    public void A_row_without_a_vendor_source_is_omitted_and_keeps_the_column()
    {
        var twincatShaped = ProjectSettingsFormat.Write(new ProjectSettings(
            DisabledWarnings: new[] { 371 }, WarningsAsErrors: null,
            ReplaceConstants: false, UnicodeIdentifiers: null, Utf8Encoding: null,
            MaxCompilerWarnings: "100", BreakpointLogging: null, ProjectDefines: ""));
        Assert.Equal(
            "Disabled warnings:     C0371\n" +
            "Replace constants:     off\n" +
            "Max compiler warnings: 100\n",
            twincatShaped);
    }

    /// <summary>One row's value as <see cref="ProjectSettingsFormat.Write"/> renders it, or null when the row is omitted.
    /// (The row helpers are private to the format since gate 2 of openspec <c>twincat-project-settings</c>: nothing
    /// outside it renders a row on its own.)</summary>
    private static string? Row(string label, ProjectSettings s)
    {
        var line = ProjectSettingsFormat.Write(s).Split('\n')
            .SingleOrDefault(l => l.StartsWith(label + ":", StringComparison.Ordinal));
        return line is null ? null : line.Substring(line.IndexOf(':') + 1).Trim();
    }

    private static ProjectSettings Only(IReadOnlyCollection<int>? disabled = null, bool? replaceConstants = null) =>
        new(disabled, null, replaceConstants, null, null, null, null, null);

    [Fact]
    public void Warning_ids_render_as_sorted_four_digit_codes()
    {
        // Bare integers on both vendors (CODESYS GetDisabledWarningIds, TwinCAT DisabledWarningIds "33,371").
        Assert.Equal("C0033, C0139, C0371", Row("Disabled warnings", Only(disabled: new[] { 371, 33, 139 })));
        Assert.Null(Row("Disabled warnings", Only(disabled: Array.Empty<int>())));
        Assert.Null(Row("Disabled warnings", Only(disabled: null)));
    }

    [Fact]
    public void A_flag_is_on_or_off_and_an_unsourced_flag_is_nothing()
    {
        Assert.Equal("on", Row("Replace constants", Only(replaceConstants: true)));
        Assert.Equal("off", Row("Replace constants", Only(replaceConstants: false)));
        Assert.Null(Row("Replace constants", Only(replaceConstants: null)));
    }

    /// <summary>The LSP reader (<c>volt-lsp-iec src/analysis/config.ts projectDiagnosticsFrom</c>) keys on these two
    /// labels; the file name and labels are the cross-language contract.</summary>
    [Fact]
    public void The_labels_the_lsp_reads_are_the_ones_written()
    {
        Assert.Equal("Project Settings", ProjectSettingsFormat.ItemName);
        var text = ProjectSettingsFormat.Write(new ProjectSettings(
            new[] { 371 }, new[] { 33 }, null, null, null, null, null, null));
        Assert.Contains("Disabled warnings:     C0371\n", text);
        Assert.Contains("Warnings as errors:    C0033\n", text);
    }
}
