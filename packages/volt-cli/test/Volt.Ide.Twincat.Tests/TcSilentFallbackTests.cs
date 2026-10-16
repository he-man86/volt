using System;
using System.Linq;
using System.Runtime.InteropServices;
using Volt.Engine.Item;
using Volt.Ide.Twincat;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THREE TWINCAT READS THAT ANSWERED A WRONG RESULT IN SILENCE (cli-bridges review B3, B4, B7). Each now fails, and a dead
/// XAE fails as one — the RPC fault reaching <c>ShouldMarkDegraded</c>, so the session degrades and recovers.
/// </summary>
public class TcSilentFallbackTests
{
    private const int EFail = unchecked((int)0x80004005);
    private const int RpcServerUnavailable = unchecked((int)0x800706BA);

    public sealed class Plc { public Plc(object nested) => NestedProject = nested; public object NestedProject { get; } }

    /// <summary><c>TIPC</c> with two PLC projects, the first of which faults when it is read.</summary>
    public sealed class TwoPlcTipc
    {
        public TwoPlcTipc(object second) => Child = new PlcList(second);
        public int ChildCount => 2;
        public PlcList Child { get; }
        public sealed class PlcList
        {
            private readonly object _second;
            public PlcList(object second) => _second = second;
            public object this[int i] => i == 1 ? throw new COMException("Unspecified error", EFail) : _second;
        }
    }

    private static (BeckhoffDriver Driver, TcObjectModel Model) Attached(object window, TcWalkUnreadableObjectTests.Node? tree = null)
    {
        var model = new TcObjectModel { BindWindow = _ => window };
        if (tree is not null) model.ReadExplorer = (_, _) => tree.Explorer();
        var driver = new BeckhoffDriver(model);
        driver.Connect(xaePid: 1);
        return (driver, model);
    }

    private static TcAttachTests.Dte Window(object tipc) =>
        new(new TcAttachTests.Project("TwinCAT Project14", new TcComTree.SysManager(tipc)));

    /// <summary>B3: a fault reading the FIRST PLC project bound the second, and every op after it read and wrote a PLC the
    /// engineer did not pick. The fault is the answer.</summary>
    [Fact]
    public void A_PLC_project_that_faults_when_read_is_not_skipped_for_the_next_one()
    {
        var other = new TcWalkUnreadableObjectTests.Node("PLC", ItemKind.PlcFolder, new TcWalkUnreadableObjectTests.Node("OtherDut", ItemKind.PlcDut));
        var (driver, _) = Attached(Window(new TwoPlcTipc(new Plc(other))), other);

        // Before: the second PLC was bound and walked, and this answered its items.
        var ex = Record.Exception(() => driver.WalkItems());

        Assert.NotNull(ex);
        Assert.Contains("Unspecified error", ex!.ToString());
    }

    /// <summary>The library manager, answering <c>ProduceAllLibrarySignatures</c> with nothing.</summary>
    public sealed class SilentLibraryManager
    {
        public string Name => "References";
        public string PathName => "TIPC^PLC^References";
        public int ItemType => ItemKind.PlcLibMan;
        public int ChildCount => 0;
        public string? ProduceAllLibrarySignatures() => null;
    }

    /// <summary>B7: a manager that answers NO document is not a project with no libraries — read as one, the client
    /// deleted every library-signature file it held. A project without a manager still answers empty (that one is
    /// absent, not silent).</summary>
    [Fact]
    public void A_library_manager_that_answers_no_signatures_is_refused_not_read_as_no_libraries()
    {
        var (_, model) = Attached(Window(new TcComTree.Tipc(new Plc(new SilentLibraryManager()))));

        var ex = Record.Exception(() => model.ExtractLibrarySignatures());

        Assert.NotNull(ex);
        Assert.Contains("ProduceAllLibrarySignatures", ex!.Message);
    }

    /// <summary>The solution's build object: its state and its verdict, either of which can be a dead channel.</summary>
    public sealed class SolutionBuild
    {
        public bool StateFaults { get; init; }
        public bool VerdictFaults { get; init; }
        public int BuildState => StateFaults ? throw new COMException("The RPC server is unavailable.", RpcServerUnavailable) : 3;
        public void Build(bool wait) { }
        public int LastBuildInfo => VerdictFaults ? throw new COMException("The RPC server is unavailable.", RpcServerUnavailable) : 0;
    }

    public sealed class BuildSolution
    {
        public BuildSolution(object build, TcAttachTests.Project project) { SolutionBuild = build; Projects.Items.Add(project); }
        public TcAttachTests.Projects Projects { get; } = new();
        public int Count => Projects.Count;
        public bool Saved => true;
        public object SolutionBuild { get; }
    }

    public sealed class BuildDte
    {
        public BuildDte(SolutionBuild build) =>
            Solution = new BuildSolution(build, new TcAttachTests.Project("TwinCAT Project14", new TcComTree.SysManager()));
        public BuildSolution Solution { get; }
        public string Version => "15.0";
    }

    /// <summary>B4: a dead XAE while waiting for the IDE's build to go idle, or while reading the verdict, was reported as
    /// "the build failed" — health stayed green and nothing recovered. The RPC fault propagates to the classifier.</summary>
    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public void A_dead_XAE_during_a_build_is_a_dead_channel_not_a_failed_build(bool stateFaults, bool verdictFaults)
    {
        var (driver, model) = Attached(new BuildDte(new SolutionBuild { StateFaults = stateFaults, VerdictFaults = verdictFaults }));

        var ex = Record.Exception(() => model.Build());

        Assert.NotNull(ex);
        Assert.True(driver.ShouldMarkDegraded(ex!), ex!.ToString());
    }

    /// <summary>…while an unreadable verdict that is NOT a dead channel is still a failed build (the standing rule).</summary>
    [Fact]
    public void A_build_whose_idle_state_answers_is_reported_by_its_verdict()
        => Assert.True(Attached(new BuildDte(new SolutionBuild())).Model.Build());
}
