using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Volt.Tests.Shared;
using Xunit;
using static Volt.Ide.Twincat.Tests.TcBuildDiagnosticNamingTests;
using static Volt.Ide.Twincat.Tests.TcUntouchablePouTests;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A BUILD THAT NAMES A PLC PROJECT BUILDS THAT ONE (openspec <c>build-selects-application</c> 2.1, DIALECT D46): XAE's
/// <c>SolutionBuild.BuildProject</c> with the active configuration and the PLC project's <c>UniqueName</c> — its
/// <c>.plcproj</c> relative to the solution's directory — never the whole solution's <c>Build</c>. The Build pane holds the
/// LAST build only, so its diagnostics are the ones read right after it.
/// </summary>
public class TcBuildSelectsApplicationTests
{
    /// <summary>The Output window as XAE has it: one pane, whose text the last build wrote.</summary>
    public sealed class LivePane
    {
        public string Text = "";
        public TextDocument TextDocument => new(Text);
    }
    public sealed class LivePanes
    {
        private readonly LivePane _pane;
        public LivePanes(LivePane pane) => _pane = pane;
        public int Count => 1;
        public LivePane Item(int i) => _pane;
    }
    public sealed class LiveOutput { public LiveOutput(LivePanes p) => OutputWindowPanes = p; public LivePanes OutputWindowPanes { get; } }
    public sealed class LiveWindow { public LiveWindow(LiveOutput o) => Object = o; public LiveOutput Object { get; } }
    public sealed class LiveWindows { private readonly LiveWindow _w; public LiveWindows(LiveWindow w) => _w = w; public LiveWindow Item(string guid) => _w; }

    public sealed class Configuration { public string Name => "Release"; public string PlatformName => "TwinCAT RT (x64)"; }

    /// <summary>The solution's build object, recording what it was asked to build; each build writes its own output.</summary>
    public sealed class RecordingSolutionBuild
    {
        private readonly LivePane _pane;
        private readonly string _output;
        public RecordingSolutionBuild(LivePane pane, string output) { _pane = pane; _output = output; }
        public List<string> Calls { get; } = new();
        public Configuration ActiveConfiguration { get; } = new();
        public int BuildState => 3;
        public int LastBuildInfo { get; private set; }
        public void Build(bool wait) { Calls.Add("Build"); _pane.Text = ""; }
        public void BuildProject(string configuration, string uniqueName, bool wait)
        {
            Calls.Add($"BuildProject({configuration}, {uniqueName})");
            _pane.Text = _output;
            LastBuildInfo = 1;
        }
    }

    private const string PlcProject = @"C:\p\TwinCAT Project14\Untitled2\Untitled2.plcproj";

    /// <summary>A solution saved on disk — <c>TwinCAT Project14.sln</c> beside the PLC project's <c>.plcproj</c> — for a
    /// build whose diagnostic names an item: naming it materializes the item, which reads its project's build entries.</summary>
    private static readonly string Saved = WriteSaved();
    private static string WriteSaved()
    {
        var root = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "volt-tc-build-selects");
        var plcproj = System.IO.Path.Combine(root, "TwinCAT Project14", "Untitled2", "Untitled2.plcproj");
        System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(plcproj)!);
        System.IO.File.WriteAllText(plcproj, "<Project xmlns=\"http://schemas.microsoft.com/developer/msbuild/2003\"><ItemGroup /></Project>");
        return root;
    }

    [Fact]
    public void A_build_naming_a_plc_project_builds_it_by_BuildProject_and_reports_that_builds_diagnostics()
    {
        var (driver, _, _, _) = Project(x => new Node(x, "Untitled2 Project", ItemKind.PlcFolder, false,
                new Node(x, "MAIN", ItemKind.PlcPouProg) { DeclarationText = "PROGRAM MAIN\nVAR\nEND_VAR\n" }),
            plcproj: System.IO.Path.Combine(Saved, "TwinCAT Project14", "Untitled2", "Untitled2.plcproj"));
        LastWindow!.Solution.Name = System.IO.Path.Combine(Saved, "TwinCAT Project14.sln");
        var pane = new LivePane();
        LastWindow.Windows = new LiveWindows(new LiveWindow(new LiveOutput(new LivePanes(pane))));
        var build = new RecordingSolutionBuild(pane,
            $@"1>{Saved}\TwinCAT Project14\Untitled2\MAIN.TcPOU(3,1) : error : Identifier 'b' not defined" + "\r\n");
        LastWindow.Solution.SolutionBuild = build;

        var r = BoundWrite.Build(Volt.Engine.Sync.HostLink.Of(driver), new BuildRequest { Applications = new() { App } });

        Assert.Equal(new[] { @"BuildProject(Release|TwinCAT RT (x64), TwinCAT Project14\Untitled2\Untitled2.plcproj)" }, build.Calls);
        Assert.False(r.Success);
        var d = Assert.Single(r.Diagnostics);
        Assert.Equal("Identifier 'b' not defined", d.Message);
        Assert.Equal(App + "/MAIN.pou", d.Name);
    }

    /// <summary>The diagnostics are the ones the build wrote, read right after it: the pane holds one build only, so a later
    /// build of another PLC project would leave the earlier one's lines nowhere to read.</summary>
    [Fact]
    public void The_named_builds_diagnostics_are_read_right_after_it_not_from_whatever_the_pane_holds_later()
    {
        var (driver, _, _, _) = Project(x => new Node(x, "Untitled2 Project", ItemKind.PlcFolder), plcproj: PlcProject);
        var pane = new LivePane();
        LastWindow!.Windows = new LiveWindows(new LiveWindow(new LiveOutput(new LivePanes(pane))));
        LastWindow.Solution.SolutionBuild = new RecordingSolutionBuild(pane,
            "1>Untitled2 : error : the named build's own line\r\n");

        Assert.False(driver.Build(new[] { App }));
        pane.Text = "1>Untitled1 : error : a line of another build\r\n";

        Assert.Equal(new[] { "the named build's own line" },
            driver.GetBuildDiagnostics(() => driver.Walk()).Select(x => x.Message));
    }

    /// <summary>Absent, every application is built, as before: the whole solution's <c>Build</c> (2.3).</summary>
    [Fact]
    public void A_build_naming_no_application_builds_the_whole_solution()
    {
        var (driver, _, _, _) = Project(x => new Node(x, "Untitled2 Project", ItemKind.PlcFolder), plcproj: PlcProject);
        var pane = new LivePane();
        LastWindow!.Windows = new LiveWindows(new LiveWindow(new LiveOutput(new LivePanes(pane))));
        var build = new RecordingSolutionBuild(pane, "");
        LastWindow.Solution.SolutionBuild = build;

        BoundWrite.Build(Volt.Engine.Sync.HostLink.Of(driver), new BuildRequest());

        Assert.Equal(new[] { "Build" }, build.Calls);
    }
}
