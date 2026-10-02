using System.Linq;
using System.Runtime.InteropServices;
using Volt.Engine.Item;
using Volt.Ide.Twincat;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// ONE OBJECT WHOSE KIND CANNOT BE READ IS NAMED — the TwinCAT half of openspec <c>codesys-refs-guid-int32</c>
/// (task 3.3; the parity boundary is the wire).
///
/// <para>TwinCAT cannot fail the CODESYS way: it reads a node's kind as the COM <c>ItemType</c> property, with no
/// overloaded vendor method to bind. But its walk already survived a node whose kind faulted — by marking the FOLDER
/// unwalked and saying nothing of which object it was. CODESYS now names that object in <c>unreadable</c>; so must
/// TwinCAT, or the same project state answers two different wires.</para>
///
/// <para>The doubles are plain C# objects reached through <c>dynamic</c>, as the driver reaches the COM ones
/// (<see cref="TcAttachTests"/>).</para>
/// </summary>
public class TcWalkUnreadableObjectTests
{
    public sealed class Children
    {
        private readonly Node[] _nodes;
        public Children(Node[] nodes) => _nodes = nodes;
        public Node this[int i] => _nodes[i - 1];
    }

    public sealed class Node
    {
        private readonly int? _type;
        private readonly Node[] _children;
        private Node? _owner;
        public Node(string name, int? type, params Node[] children)
        {
            Name = name; _type = type; Child = new Children(children); ChildCount = children.Length; _children = children;
            foreach (var c in children) c._owner = this;
        }
        public string Name { get; }
        public string PathName => _owner is null ? "TIPC^PLC^" + Name : _owner.PathName + "^" + Name;
        /// <summary>The Solution Explorer's view of this subtree, listing every node — so the C2i guard flags nothing and
        /// vouches for every folder (TcUntouchablePouTests owns that guard).</summary>
        internal ExplorerNode Explorer() => new(Name, "", Name, _children.Select(c => c.Explorer()).ToList());
        /// <summary>Null: the COM read of the kind faults, as a broken node's does.</summary>
        public int ItemType => _type ?? throw new COMException("ItemType unreadable", unchecked((int)0x80004005));
        public int ChildCount { get; }
        public Children Child { get; }
    }

    public sealed class Plc { public Plc(Node nested) => NestedProject = nested; public Node NestedProject { get; } }

    public sealed class Tipc
    {
        public Tipc(Plc plc) => Child = new PlcList(plc);
        public int ChildCount => 1;
        public PlcList Child { get; }
        public sealed class PlcList { private readonly Plc _p; public PlcList(Plc p) => _p = p; public Plc this[int _] => _p; }
    }

    public sealed class SysManager
    {
        private readonly Tipc _tipc;
        public SysManager(Tipc tipc) => _tipc = tipc;
        public object LookupTreeItem(string path) => path == "TIPC"
            ? _tipc
            : throw new COMException($"Item '{path}' not found", unchecked((int)0x98510001));
    }

    [Fact]
    public void A_node_whose_kind_faults_is_named_with_its_folder_and_the_walk_goes_on()
    {
        var root = new Node("PLC", ItemKind.PlcFolder,
            new Node("Data", ItemKind.PlcFolder,
                new Node("SER_OperationModeType", null),
                new Node("PlcDataType", ItemKind.PlcDut)));
        var window = new TcAttachTests.Dte(new TcAttachTests.Project("TwinCAT Project14",
            new SysManager(new Tipc(new Plc(root)))));
        var driver = new BeckhoffDriver(new TcObjectModel { BindWindow = _ => window, ReadExplorer = (_, _) => root.Explorer() });
        driver.Connect(xaePid: 1);

        var walk = driver.WalkItems();

        Assert.Equal(new[] { "PlcDataType" }, walk.Items.Select(i => i.Name));
        var lost = Assert.Single(walk.UnreadableObjects);
        Assert.Equal(("SER_OperationModeType", "Data"), (lost.Name, lost.Folder));
        Assert.Contains("Data", walk.UnwalkedFolders);
    }

    /// <summary>A node at the PLC ROOT whose kind faults marks its own subtree as not walked, under the one root
    /// spelling (<c>""</c>, the folder path every root-level item has) — it used to record <c>"&lt;root&gt;"</c>,
    /// which no known folder is ever under, so nothing beneath the node was protected from reading as deleted.</summary>
    [Fact]
    public void A_root_node_whose_kind_faults_marks_its_own_subtree_not_walked()
    {
        var root = new Node("PLC", ItemKind.PlcFolder,
            new Node("Machine", null, new Node("Main", ItemKind.PlcPou)),
            new Node("Data", ItemKind.PlcFolder, new Node("PlcDataType", ItemKind.PlcDut)));
        var window = new TcAttachTests.Dte(new TcAttachTests.Project("TwinCAT Project14",
            new SysManager(new Tipc(new Plc(root)))));
        var driver = new BeckhoffDriver(new TcObjectModel { BindWindow = _ => window, ReadExplorer = (_, _) => root.Explorer() });
        driver.Connect(xaePid: 1);

        var walk = driver.WalkItems();

        var lost = Assert.Single(walk.UnreadableObjects);
        Assert.Equal(("Machine", ""), (lost.Name, lost.Folder));
        Assert.Contains("", walk.UnwalkedFolders);
        Assert.Contains("Machine", walk.UnwalkedFolders);
        Assert.DoesNotContain("<root>", walk.UnwalkedFolders);   // (the double has no I/O tree: that is unwalked too)
    }
}
