using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;
using Volt.Tests.Shared;
using static Volt.Ide.Twincat.Tests.TcUntouchablePouTests;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A READ OP COSTS THE SAME PER PLC PROJECT AT ANY SIZE (openspec <c>twincat-large-solution-refs</c>). A customer's
/// 18-PLC-project solution took 148 s for <c>refs</c> while its 3- and 10-project solutions answered in time, which
/// points at work done once per PLC project PER PLC PROJECT — a hierarchy read per project, a snapshot dropped and read
/// again, a lookup that walks every project. Each counter below is a cross-process COM call (or an IDE read the
/// operation pays), counted over a fake solution of N system projects of one PLC project each — the customer's shape,
/// <c>PLC-SA11/PLC/PLC-SA11/…</c> — and every one must be exactly N times its count at N = 1: a term that grows
/// faster than the PLC project count fails here, offline, at 18.
/// </summary>
public class TcLargeSolutionGrowthTests
{
    private sealed class Solution
    {
        public readonly Xae X = new();
        public int HierarchyReads;
        public readonly BeckhoffDriver Driver;
        public readonly TcObjectModel Model;

        /// <param name="systems">System projects in the solution.</param>
        /// <param name="plcsEach">PLC projects in each — the customer's shape is one each (<c>PLC-SA11/PLC/PLC-SA11</c>);
        /// one system project holding them all is the other shape a large solution takes.</param>
        public Solution(int systems, int plcsEach = 1)
        {
            var hierarchies = new Dictionary<string, ExplorerNode>();
            var projects = new List<TcAttachTests.Project>();
            for (var k = 1; k <= systems; k++)
            {
                var system = $"PLC-SA{k:00}";
                var plcs = new List<NamedPlc>();
                for (var j = 1; j <= plcsEach; j++)
                {
                    var id = $"{k}_{j}";
                    plcs.Add(new NamedPlc($"PLC{id}", new Node(X, $"PLC{id} Project", ItemKind.PlcFolder, false,
                        new Node(X, "POUs", ItemKind.PlcFolder, false,
                            new Node(X, $"Motor{id}", ItemKind.PlcPou),
                            new Node(X, "Axes", ItemKind.PlcFolder, false, new Node(X, $"Pump{id}", ItemKind.PlcPou))),
                        new Node(X, "GVLs", ItemKind.PlcFolder, false, new Node(X, $"G_IO{id}", ItemKind.PlcGvl)),
                        new Node(X, $"MAIN{id}", ItemKind.PlcPouProg))));
                }
                hierarchies[system] = new ExplorerNode(system, "", system, plcs.Select(p => p.Root.Explorer()).ToList());
                projects.Add(new TcAttachTests.Project(system, new SysManager(new ManyPlcs(plcs))));
            }
            var window = new TcAttachTests.Dte(projects.ToArray());
            window.Solution.Name = @"C:\p\Large.sln";
            Model = new TcObjectModel
            {
                BindWindow = _ => window,
                ReadExplorer = (_, system) => { HierarchyReads++; return hierarchies[system]; },
            };
            Driver = new BeckhoffDriver(Model);
            Driver.Connect(xaePid: 1);
        }

        /// <summary>What one operation asked of the IDE.</summary>
        public Dictionary<string, int> Counted(System.Action op)
        {
            Model.ForgetExplorer();   // an operation starts (BeckhoffDriver.MarshalToIdeThread)
            HierarchyReads = 0; X.NestedReads = 0; X.PathReads = 0; X.PlcXmlReads = 0;
            X.TypeReads.Clear(); X.NameReads.Clear(); X.Lookups.Clear();
            op();
            return new Dictionary<string, int>
            {
                ["Solution Explorer reads"] = HierarchyReads,
                ["NestedProject"] = X.NestedReads,
                ["PathName"] = X.PathReads,
                ["ItemType"] = X.TypeReads.Values.Sum(),
                ["Name"] = X.NameReads.Values.Sum(),
                ["LookupChild"] = X.Lookups.Count,
                ["PLC project XML"] = X.PlcXmlReads,
            };
        }
    }

    /// <summary>A PLC project item of its own name (<c>TIPC^&lt;name&gt;</c>) over its project node.</summary>
    public sealed class NamedPlc
    {
        public NamedPlc(string name, Node root) { Name = name; Root = root; }
        public string Name { get; }
        public readonly Node Root;
        public Node NestedProject { get { Root.X.NestedReads++; return Root; } }
        public string ProduceXml(bool recursive)
        {
            Root.X.PlcXmlReads++;
            return "<TreeItem><PlcProjectDef><ProjectPath>" + EmptyProject + "</ProjectPath></PlcProjectDef></TreeItem>";
        }
        private static readonly string EmptyProject = Write();
        private static string Write()
        {
            var path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "volt-tc-tests-growth.plcproj");
            System.IO.File.WriteAllText(path, "<Project xmlns=\"http://schemas.microsoft.com/developer/msbuild/2003\"><ItemGroup /></Project>");
            return path;
        }
    }

    /// <summary><c>TIPC</c> holding several PLC projects, <c>Child[1..n]</c>.</summary>
    public sealed class ManyPlcs
    {
        private readonly List<NamedPlc> _plcs;
        public ManyPlcs(List<NamedPlc> plcs) { _plcs = plcs; Child = new Kids(this); }
        public int ChildCount => _plcs.Count;
        public Kids Child { get; }
        public sealed class Kids { private readonly ManyPlcs _o; public Kids(ManyPlcs o) => _o = o; public object this[int i] => _o._plcs[i - 1]; }
    }

    /// <summary>A system manager resolving <c>TIPC</c>, an empty I/O tree, and nothing by path (no POU here is loaded
    /// broken).</summary>
    public sealed class SysManager
    {
        private readonly ManyPlcs _tipc;
        public SysManager(ManyPlcs tipc) => _tipc = tipc;
        public object LookupTreeItem(string path) => path switch
        {
            "TIPC" => _tipc,
            "TIID" => new Empty(),
            _ => throw TcComTree.NotFound(path),
        };
    }

    public static IEnumerable<object[]> Sizes => new[] { 1, 3, 10, 18 }.Select(n => new object[] { n });

    [Theory]
    [MemberData(nameof(Sizes))]
    public void A_refs_asks_the_IDE_N_times_what_it_asks_of_one_PLC_project(int n)
    {
        var one = new Solution(1);
        var many = new Solution(n);

        var perProject = one.Counted(() => RefsService.Handle(Volt.Engine.Sync.HostLink.Of(one.Driver)));
        var counted = many.Counted(() => RefsService.Handle(Volt.Engine.Sync.HostLink.Of(many.Driver)));

        Assert.Equal(perProject.ToDictionary(kv => kv.Key, kv => kv.Value * n), counted);
    }

    [Theory]
    [MemberData(nameof(Sizes))]
    public void A_fetch_asks_the_IDE_N_times_what_it_asks_of_one_PLC_project(int n)
    {
        var one = new Solution(1);
        var many = new Solution(n);

        var perProject = one.Counted(() => FetchService.Handle(Volt.Engine.Sync.HostLink.Of(one.Driver), new FetchRequest { Init = true }));
        var counted = many.Counted(() => FetchService.Handle(Volt.Engine.Sync.HostLink.Of(many.Driver), new FetchRequest { Init = true }));

        Assert.Equal(perProject.ToDictionary(kv => kv.Key, kv => kv.Value * n), counted);
    }

    [Theory]
    [MemberData(nameof(Sizes))]
    public void A_refs_on_one_system_project_of_N_PLC_projects_asks_N_times_what_one_asks(int n)
    {
        var one = new Solution(1);
        var many = new Solution(1, plcsEach: n);

        var perProject = one.Counted(() => RefsService.Handle(Volt.Engine.Sync.HostLink.Of(one.Driver)));
        var counted = many.Counted(() => RefsService.Handle(Volt.Engine.Sync.HostLink.Of(many.Driver)));

        // One Solution Explorer read covers every PLC project of a system project.
        perProject["Solution Explorer reads"] = 0;
        counted["Solution Explorer reads"] = counted["Solution Explorer reads"] == 1 ? 0 : counted["Solution Explorer reads"];
        Assert.Equal(perProject.ToDictionary(kv => kv.Key, kv => kv.Value * n), counted);
    }

    [Theory]
    [MemberData(nameof(Sizes))]
    public void A_fetch_on_one_system_project_of_N_PLC_projects_asks_N_times_what_one_asks(int n)
    {
        var one = new Solution(1);
        var many = new Solution(1, plcsEach: n);

        var perProject = one.Counted(() => FetchService.Handle(Volt.Engine.Sync.HostLink.Of(one.Driver), new FetchRequest { Init = true }));
        var counted = many.Counted(() => FetchService.Handle(Volt.Engine.Sync.HostLink.Of(many.Driver), new FetchRequest { Init = true }));

        perProject["Solution Explorer reads"] = 0;
        counted["Solution Explorer reads"] = counted["Solution Explorer reads"] == 1 ? 0 : counted["Solution Explorer reads"];
        Assert.Equal(perProject.ToDictionary(kv => kv.Key, kv => kv.Value * n), counted);
    }

    /// <summary>Across every PLC project of every system project, the declarations index taken from the walk is the one
    /// the tree walk lists, item for item and in order (<see cref="TcWalkIndexTests"/>).</summary>
    [Fact]
    public void The_walks_index_lists_every_PLC_projects_items_as_the_tree_walk_does()
    {
        var solution = new Solution(18);
        solution.Driver.WalkItems();

        static IEnumerable<(object, string, int)> Shape(IEnumerable<(Volt.Engine.Item.ItemRef Item, string Name, int Kind)> items) =>
            items.Select(i => (((BeckhoffDriver.TcNode)i.Item.Native).Com, i.Name, i.Kind));
        Assert.Equal(Shape(Volt.Engine.Ide.ItemLookup.All(solution.Driver)), Shape(solution.Driver.WalkIndex()!));
    }

    /// <summary>One walk frame per PLC project, counting to the solution's PLC project count, before any item frame.</summary>
    [Fact]
    public void A_refs_sends_one_walking_frame_per_PLC_project()
    {
        var solution = new Solution(18);
        var frames = new List<ProgressFrame>();

        RefsService.Handle(Volt.Engine.Sync.HostLink.Of(solution.Driver), onProgress: frames.Add);

        var walking = frames.TakeWhile(f => f.Phase == ProgressFrame.WalkingPhase).ToList();
        Assert.Equal(Enumerable.Range(1, 18), walking.Select(f => f.Done));
        Assert.All(walking, f => Assert.Equal(18, f.Total));
        Assert.Equal("reading", frames[18].Phase);
    }
}
