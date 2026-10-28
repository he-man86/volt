using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Item;
using Volt.Ide.Twincat;
using Xunit;
using static Volt.Ide.Twincat.Tests.TcComTree;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE WALK NAMES THE COM CALL AN RPC FAILURE MET, AND THE LAST ONE THAT RETURNED (openspec
/// <c>twincat-crash-and-redial-identity</c> 1.3). A field XAE died under <c>refs</c> (access violation in
/// <c>TwinCAT System Manager.dll</c>) and the worker's log said only which call came back <c>0x800706BE</c> — not what
/// Volt had asked of XAE just before, which is the candidate trigger when the crash is asynchronous to the call that
/// saw it. One line, at the first RPC failure of a walk: the call in flight and the last call that returned, each
/// with the wire path of the item it touched.
/// </summary>
[Collection(VoltLogTee.Name)]
public class TcWalkRpcTrailTests
{
    private const int RpcCallFailed = unchecked((int)0x800706BE);
    private const int RpcServerUnavailable = unchecked((int)0x800706BA);

    /// <summary>A tree item whose children are produced per index — one may be a dead channel.</summary>
    public sealed class Node
    {
        private readonly Func<int, Node>[] _children;
        private Node? _owner;
        public Node(string name, int type, params Func<int, Node>[] children)
        {
            Name = name; ItemType = type; _children = children; ChildCount = children.Length;
            Child = new Children(this);
        }
        public string Name { get; }
        public int ItemType { get; }
        public int ChildCount { get; }
        public Children Child { get; }
        public string PathName => _owner is null ? "TIPC^Untitled2^" + Name : _owner.PathName + "^" + Name;
        public string ProduceXml(bool recursive) => TcItemXml.Built(Name);
        /// <summary>The Solution Explorer lists every child by name, so the C2i guard flags nothing.</summary>
        internal ExplorerNode Explorer(params string[] names) =>
            new(Name, "", Name, names.Select(n => new ExplorerNode(n, "", n, new List<ExplorerNode>())).ToList());
        public sealed class Children
        {
            private readonly Node _of;
            public Children(Node of) => _of = of;
            public Node this[int i] { get { var c = _of._children[i - 1](i); c._owner = _of; return c; } }
        }
    }

    public sealed class Plc { public Plc(Node nested) => NestedProject = nested; public Node NestedProject { get; } public string Name => "Untitled2"; }

    private static Func<int, Node> Item(Node node) => _ => node;
    private static Func<int, Node> Dead(int hresult, string message) => _ => throw new COMException(message, hresult);

    /// <summary>A system manager whose I/O tree (<c>TIID</c>) is a dead channel.</summary>
    public sealed class DeadIoSysManager
    {
        private readonly object _tipc;
        public DeadIoSysManager(object tipc) => _tipc = tipc;
        public readonly List<string> Asked = new();
        public object LookupTreeItem(string path)
        {
            if (path == "TIPC") return _tipc;
            if (path != "TIID") throw NotFound(path);
            Asked.Add(path);
            throw new COMException("The RPC server is unavailable.", RpcServerUnavailable);
        }
    }

    /// <summary>The walk of <paramref name="root"/>, which must not throw.</summary>
    internal static Volt.Engine.Item.WalkResult WalkResultOf(Node root, ExplorerNode explorer)
    {
        var window = new TcAttachTests.Dte(new TcAttachTests.Project("TwinCAT Project14", new SysManager(new Tipc(new Plc(root)))));
        var driver = new BeckhoffDriver(new TcObjectModel
        {
            BindWindow = _ => window,
            ReadExplorer = (_, _) => new ExplorerNode("TwinCAT Project14", "", "TwinCAT Project14", new List<ExplorerNode> { explorer }),
        });
        driver.Connect(xaePid: 1);
        return driver.WalkItems();
    }

    private static (string Log, Exception? Thrown, BeckhoffDriver Driver) Walk(Node root, ExplorerNode explorer, object? sysManager = null)
    {
        var window = new TcAttachTests.Dte(new TcAttachTests.Project("TwinCAT Project14",
            sysManager ?? new SysManager(new Tipc(new Plc(root)))));
        var driver = new BeckhoffDriver(new TcObjectModel
        {
            BindWindow = _ => window,
            ReadExplorer = (_, _) => new ExplorerNode("TwinCAT Project14", "", "TwinCAT Project14", new List<ExplorerNode> { explorer }),
        });
        driver.Connect(xaePid: 1);
        var log = new StringWriter();
        VoltLog.TeeTo(log);
        Exception? thrown = null;
        try { driver.WalkItems(); }
        catch (Exception ex) { thrown = ex; }
        finally { VoltLog.TeeTo(null); }
        return (log.ToString(), thrown, driver);
    }

    [Fact]
    public void The_first_RPC_failure_of_a_walk_names_the_call_in_flight_and_the_last_call_that_returned()
    {
        var duts = new Node("DUTs", ItemKind.PlcFolder,
            Item(new Node("E_Mode", ItemKind.PlcDutEnum)),
            Dead(RpcCallFailed, "The remote procedure call failed."),
            Dead(RpcServerUnavailable, "The RPC server is unavailable."));
        var root = new Node("Untitled2 Project", ItemKind.PlcFolder, Item(duts));
        var explorer = new ExplorerNode(root.Name, "", root.Name, new List<ExplorerNode>
        {
            duts.Explorer("E_Mode", "X", "Y"),
        });

        var lines = Walk(root, explorer).Log.Split('\n').Where(l => l.Contains("RPC failure")).ToList();

        var line = Assert.Single(lines);   // the first failure only: the calls after it meet a dead XAE, and say nothing new
        Assert.Contains("0x800706BE", line);
        Assert.Contains($"ChildAt(2) at '{TcUntouchablePouTests.App}/DUTs'", line);
        Assert.Contains($"the last COM call that returned: ChildCount at '{TcUntouchablePouTests.App}/DUTs/E_Mode'", line);
    }

    [Fact]
    public void A_walk_with_no_RPC_failure_logs_no_trail()
    {
        var root = new Node("Untitled2 Project", ItemKind.PlcFolder,
            Item(new Node("DUTs", ItemKind.PlcFolder, Item(new Node("E_Mode", ItemKind.PlcDutEnum)))));
        var explorer = new ExplorerNode(root.Name, "", root.Name, new List<ExplorerNode>
        {
            new("DUTs", "", "DUTs", new List<ExplorerNode> { new("E_Mode", "", "E_Mode", new List<ExplorerNode>()) }),
        });

        var (log, thrown, _) = Walk(root, explorer);
        Assert.DoesNotContain("RPC failure", log);
        Assert.Null(thrown);
    }

    /// <summary>A DEAD XAE STOPS THE WALK (openspec <c>twincat-crash-and-redial-identity</c>). The field log showed
    /// <c>ChildAt(2..11)</c> each failing after <c>ChildAt(1)</c> met <c>0x800706BE</c>: the walk's per-node catches took the
    /// RPC failure for one unreadable child and kept calling into a process that was gone. At the first RPC failure the walk
    /// asks XAE nothing more and the op fails by name — <c>PLC_DISCONNECTED</c>, saying the IDE stopped answering — with the
    /// COM fault kept as the inner exception, so the pipe host's <c>ShouldMarkDegraded</c> still sees a dead channel and
    /// <c>RunRead</c> recovers (re-attaches by pid) and retries once, as it does for any RPC fault.</summary>
    [Fact]
    public void The_walk_stops_at_the_first_RPC_failure_and_fails_by_name_as_the_IDE_no_longer_answering()
    {
        var after = 0;
        Func<int, Node> counted = _ => { after++; throw new COMException("The RPC server is unavailable.", RpcServerUnavailable); };
        var duts = new Node("DUTs", ItemKind.PlcFolder,
            Item(new Node("E_Mode", ItemKind.PlcDutEnum)),
            Dead(RpcCallFailed, "The remote procedure call failed."),
            counted, counted);
        var later = new Node("POUs", ItemKind.PlcFolder, counted);
        var root = new Node("Untitled2 Project", ItemKind.PlcFolder, Item(duts), Item(later));
        var explorer = new ExplorerNode(root.Name, "", root.Name, new List<ExplorerNode>
        {
            duts.Explorer("E_Mode", "X", "Y", "Z"),
            later.Explorer("A"),
        });

        var (_, thrown, driver) = Walk(root, explorer);

        var refused = Assert.IsType<BridgeException>(thrown);
        Assert.Equal(BridgeErrorCodes.PlcDisconnected, refused.ErrorCode);
        Assert.Contains("stopped answering", refused.Message);
        Assert.Contains("0x800706BE", refused.Message);
        Assert.Contains($"ChildAt(2) at '{TcUntouchablePouTests.App}/DUTs'", refused.Message);
        Assert.Equal(0, after);                                   // nothing more was asked of the dead XAE
        Assert.True(driver.ShouldMarkDegraded(refused));          // the pipe host still degrades and recovers
    }

    /// <summary>The I/O tree's reads are the walk's too: a dead channel there fails the op by name, never an I/O tree
    /// "omitted from this walk" while XAE is gone.</summary>
    [Fact]
    public void An_RPC_failure_reading_the_IO_tree_fails_the_walk_by_name()
    {
        var root = new Node("Untitled2 Project", ItemKind.PlcFolder);
        var sys = new DeadIoSysManager(new Tipc(new Plc(root)));

        var (_, thrown, _) = Walk(root, new ExplorerNode(root.Name, "", root.Name, new List<ExplorerNode>()), sys);

        var refused = Assert.IsType<BridgeException>(thrown);
        Assert.Equal(BridgeErrorCodes.PlcDisconnected, refused.ErrorCode);
        Assert.Contains("LookupTreeItem(TIID)", refused.Message);
        Assert.Equal(new[] { "TIID" }, sys.Asked);
    }
}
