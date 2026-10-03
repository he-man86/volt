using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.St;

namespace Volt.Engine.Format.Settings;

/// <summary>A PLC project's compiler settings, as data — what a `.projectsettings` file says.
///
/// <para><b>NULL means "this vendor has no source for the row"</b> and the row is omitted from the file, never
/// defaulted: TwinCAT sources four of the eight (DIALECT D37-D39). An EMPTY id list is a different fact — "none
/// configured" — and renders the same way (no line), because CODESYS and TwinCAT both store "none" as absence.</para>
///
/// <para>Warning ids are the BARE INTEGERS both vendors store (CODESYS <c>GetDisabledWarningIds</c> → 371, TwinCAT
/// <c>DisabledWarningIds</c> → <c>"33,371"</c>). <see cref="MaxCompilerWarnings"/> and <see cref="ProjectDefines"/>
/// are the vendor's own spelling, rendered as given: whether the same value is spelled — and means — the same on both
/// vendors is UNMEASURED (D38).</para></summary>
public sealed record ProjectSettings(
    IReadOnlyCollection<int>? DisabledWarnings,
    IReadOnlyCollection<int>? WarningsAsErrors,
    bool? ReplaceConstants,
    bool? UnicodeIdentifiers,
    bool? Utf8Encoding,
    string? MaxCompilerWarnings,
    bool? BreakpointLogging,
    string? ProjectDefines);

/// <summary>
/// The `Project Settings.projectsettings` FORMAT — one renderer for both drivers, so the rows two vendors share are
/// byte-identical lines (openspec <c>twincat-project-settings</c>; the wire is the parity boundary).
///
/// <para><b>The layout is INHERITED from the CODESYS driver</b>, whose renderer this replaces: auto-width
/// <see cref="Descriptor"/>, these eight labels in this order. The column is the widest DECLARED label ("Max compiler
/// warnings", 21) + 2 whichever rows hold a value, so a vendor that omits a row keeps the column — these bytes are
/// hashed into the item's version, and the corpus files pin them (<c>ProjectSettingsFormatTests</c>).</para>
///
/// <para>Read-only: nothing parses this file back. The LSP reads it (<c>volt-lsp-iec src/analysis/config.ts
/// projectDiagnosticsFrom</c>) by the <c>Disabled warnings:</c> / <c>Warnings as errors:</c> labels.</para>
/// </summary>
public static class ProjectSettingsFormat
{
    /// <summary>The item's bare name — CODESYS's tree node is called this, and TwinCAT's synthesized item takes it,
    /// so both land at <c>Project Settings.projectsettings</c> in the project root.</summary>
    public const string ItemName = "Project Settings";

    public static string Write(ProjectSettings s) =>
        new Descriptor()
            .Add("Disabled warnings", WarningIds(s.DisabledWarnings))
            .Add("Warnings as errors", WarningIds(s.WarningsAsErrors))
            .Add("Replace constants", Flag(s.ReplaceConstants))
            .Add("Unicode identifiers", Flag(s.UnicodeIdentifiers))
            .Add("UTF-8 encoding", Flag(s.Utf8Encoding))
            .Add("Max compiler warnings", s.MaxCompilerWarnings)
            .Add("Breakpoint logging", Flag(s.BreakpointLogging))
            .Add("Project defines", s.ProjectDefines)
            .ToString();

    /// <summary>Warning ids as sorted <c>Cnnnn</c> codes joined by <c>", "</c> — the padded form the LSP's
    /// <c>CONFIGURABLE_CHECKS</c> matches (371 → C0371). Sorted ordinally, because neither vendor's set has an order
    /// and an unsorted render would diff on every pull. None (null or empty) is "", which the descriptor drops.</summary>
    private static string WarningIds(IEnumerable<int>? ids)
    {
        if (ids is null) return "";
        var codes = ids.Select(n => "C" + n.ToString("D4", System.Globalization.CultureInfo.InvariantCulture)).ToList();
        codes.Sort(StringComparer.Ordinal);
        return string.Join(", ", codes);
    }

    /// <summary>A compile option as <c>on</c>/<c>off</c> — never blank when the vendor HAS the option, so an option
    /// that is off is still a line ("absent" reads as "no source"). Null (no source) is null: the row is omitted.</summary>
    private static string? Flag(bool? value) => value is { } b ? (b ? "on" : "off") : null;
}
