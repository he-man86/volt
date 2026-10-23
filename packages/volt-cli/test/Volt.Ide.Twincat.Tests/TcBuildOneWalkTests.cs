using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Volt.Tests.Shared;
using Xunit;
using static Volt.Ide.Twincat.Tests.TcBuildDiagnosticNamingTests;
using static Volt.Ide.Twincat.Tests.TcUntouchablePouTests;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A BUILD NAMES ITS DIAGNOSTICS FROM ONE WALK (TwinCAT e2e profile, 2026-10-18). The driver named each diagnostic by the
/// item its compiler file lies in through a walk of the whole tree, and the engine then promoted those names to wire paths
/// through a second whole-tree walk of the same operation — the same items, read twice, on every build that reported a
/// named diagnostic.
/// </summary>
public class TcBuildOneWalkTests
{
    [Fact]
    public void A_build_with_a_named_diagnostic_walks_the_tree_once_and_names_it_by_its_path()
    {
        var (driver, _, xae, _) = Project(x => new Node(x, "Untitled2 Project", ItemKind.PlcFolder, false,
            new Node(x, "MAIN", ItemKind.PlcPouProg) { DeclarationText = "PROGRAM MAIN\nVAR\n\ta : INT;\nEND_VAR\n" }));
        var directory = System.IO.Path.GetTempPath().TrimEnd(System.IO.Path.DirectorySeparatorChar);
        LastWindow!.Windows = new Windows(new Window(new Output(new Panes(new Pane(
            $"1>{directory}\\MAIN.TcPOU(3,1) : error : Identifier 'b' not defined\r\n")))));
        LastWindow.Solution.SolutionBuild = new TcSilentFallbackTests.SolutionBuild();
        xae.TypeReads.Clear();

        var build = BoundWrite.Build(Volt.Engine.Sync.HostLink.Of(driver), new BuildRequest());

        Assert.Equal(App + "/MAIN.pou", Assert.Single(build.Diagnostics).Name);
        Assert.Equal(1, xae.TypeReads["MAIN"]);   // one walk classifies it once
    }
}
