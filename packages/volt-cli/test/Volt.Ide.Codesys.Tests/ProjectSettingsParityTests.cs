using System.Collections.Generic;
using Volt.Engine.Format.Settings;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// The CODESYS half of the cross-driver `.projectsettings` parity (openspec <c>twincat-project-settings</c> 2.3): the
/// same settings the TwinCAT suite reads off its measured fixture give the same rows here
/// (<see cref="ProjectSettingsFacts"/>, linked into both suites).
///
/// <para>The double stands in for the language model's <c>WarningConfiguration</c> / <c>CompileOptions</c> — the two
/// objects <c>ProjectSettingsDescriptor</c> reaches through <c>APEnvironment.LMServiceProvider</c>, which only a live
/// IDE has. What runs is the driver's own read of those two objects and the shared renderer.</para>
/// </summary>
public class ProjectSettingsParityTests
{
    /// <summary>The members <c>ProjectSettingsDescriptor</c> asks the warning configuration for — bare integers, and
    /// <c>null</c> (not empty) when nothing is configured, as CODESYS answers.</summary>
    public sealed class FakeWarnings
    {
        private readonly List<int>? _disabled;
        public FakeWarnings(List<int>? disabled) => _disabled = disabled;
        public object? GetDisabledWarningIds() => _disabled;
        public object? GetWarningAsErrorIds() => null;
    }

    /// <summary>The compile options CODESYS's descriptor reads, with the values the corpora carry except where the
    /// facts fix them.</summary>
    public sealed class FakeOptions
    {
        public bool ReplaceConstants { get; set; }
        public bool UnicodeIdentifiers => false;
        public bool UTF8Encoding => false;
        public int MaxCompilerWarnings => 100;
        public bool EnableBreakpointLogging => true;
        public string ProjectDefines => "";
    }

    [Fact]
    public void The_shared_rows_match_the_cross_driver_facts()
    {
        var settings = CodesysObjectModel.ReadProjectSettings(
            new FakeWarnings(new List<int> { ProjectSettingsFacts.DisabledWarning }),
            new FakeOptions());
        var text = ProjectSettingsFormat.Write(settings);

        Assert.Equal(ProjectSettingsFacts.SharedRows, ProjectSettingsFacts.SharedRowsOf(text));
    }

    /// <summary>The whole file, against the pro2193 corpus bytes the CODESYS bridge wrote live on SP21: moving the
    /// renderer into the engine re-flows nothing.</summary>
    [Fact]
    public void The_pro2193_corpus_file_is_reproduced()
    {
        var settings = CodesysObjectModel.ReadProjectSettings(
            new FakeWarnings(new List<int> { 371 }), new FakeOptions { ReplaceConstants = true });
        Assert.Equal(
            "Disabled warnings:     C0371\n" +
            "Replace constants:     on\n" +
            "Unicode identifiers:   off\n" +
            "UTF-8 encoding:        off\n" +
            "Max compiler warnings: 100\n" +
            "Breakpoint logging:    on\n",
            ProjectSettingsFormat.Write(settings));
    }
}
