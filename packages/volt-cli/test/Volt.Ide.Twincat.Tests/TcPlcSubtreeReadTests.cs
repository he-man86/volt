using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE SOLUTION EXPLORER IS READ FOR THE PLC PROJECTS ONLY (openspec <c>twincat-large-solution-refs</c>). Every caller
/// of the system project's hierarchy finds a PLC project's node and reads below it, and the read walked all of it —
/// SYSTEM, MOTION, the I/O tree with every device, terminal and channel, each PLC project's instance with every mapped
/// symbol — three cross-process calls a node, a cost that grows with the plant, not the code. Below the root only the
/// <c>PLC</c> node (canonical <c>TIPC</c>) is descended, and below a PLC project item only its project node, not its
/// instance (<c>TIPC|x|x Instance</c>). The canonical names are the ones measured on MultiProject (2026-10-21).
/// </summary>
public class TcPlcSubtreeReadTests
{
    private const uint Nil = 0xFFFFFFFF, Root = 0xFFFFFFFE;

    /// <summary>A system project's hierarchy as XAE answers it, counting which nodes were asked for their children.</summary>
    private sealed class SystemHierarchy : TcSolutionExplorer.IVsHierarchy
    {
        private readonly Dictionary<uint, (string Name, string Canonical, uint First, uint Next)> _nodes = new()
        {
            [Root] = ("TwinCAT Project14", "", 1, Nil),
            [1] = ("SYSTEM", "TIRC", 10, 2),
            [10] = ("Tasks", "TIRT", 11, Nil),
            [11] = ("PlcTask", "TIRT|PlcTask", Nil, Nil),
            [2] = ("PLC", "TIPC", 20, 3),
            [20] = ("Untitled2", "TIPC|Untitled2", 21, Nil),
            [21] = ("Untitled2 Project", "", 22, 25),
            [22] = ("POUs", @"C:\p\Untitled2\POUs\", 23, 24),
            [23] = ("MAIN", @"C:\p\Untitled2\POUs\MAIN.TcPOU", Nil, Nil),
            [24] = ("PlcTask", @"C:\p\Untitled2\PlcTask.TcTTO", Nil, Nil),
            [25] = ("Untitled2 Instance", "TIPC|Untitled2|Untitled2 Instance", 26, Nil),
            [26] = ("PlcTask Inputs", "TIPC|Untitled2|Untitled2 Instance|PlcTask Inputs", 27, Nil),
            [27] = ("G_IO.bIn00", "TIPC|Untitled2|Untitled2 Instance|PlcTask Inputs|G_IO.bIn00", Nil, Nil),
            [3] = ("I/O", "TIIC", 30, Nil),
            [30] = ("Devices", "TIID", 31, Nil),
            [31] = ("Device 1 (EtherCAT)", "TIID^Device 1 (EtherCAT)", Nil, Nil),
        };

        public readonly List<string> AskedForChildren = new();

        public int GetProperty(uint itemid, int propid, out object? pvar)
        {
            var n = _nodes[itemid];
            if (propid == -2041) AskedForChildren.Add(n.Name);
            pvar = propid switch
            {
                -2003 or -2012 => n.Name,
                -2041 => unchecked((int)n.First),
                -2042 => unchecked((int)n.Next),
                _ => null,
            };
            return 0;
        }
        public int GetCanonicalName(uint itemid, out string? pbstrName) { pbstrName = _nodes[itemid].Canonical; return 0; }
        public int GetNestedHierarchy(uint itemid, ref Guid iid, out IntPtr nested, out uint nestedId)
        { nested = IntPtr.Zero; nestedId = Nil; return unchecked((int)0x80004001); }
        public int SetSite(IntPtr psp) => 0;
        public int GetSite(out IntPtr ppsp) { ppsp = IntPtr.Zero; return 0; }
        public int QueryClose(out int pfCanClose) { pfCanClose = 1; return 0; }
        public int Close() => 0;
        public int GetGuidProperty(uint itemid, int propid, out Guid pguid) { pguid = Guid.Empty; return 0; }
        public int SetGuidProperty(uint itemid, int propid, ref Guid rguid) => 0;
        public int SetProperty(uint itemid, int propid, object var) => 0;
    }

    private static string Shape(ExplorerNode n) =>
        $"{n.Name}|{n.Canonical}|{n.Caption}|{n.Unread}[{string.Join(",", n.Children.Select(Shape))}]";

    [Fact]
    public void The_PLC_projects_node_reads_as_it_does_from_the_whole_hierarchy()
    {
        var whole = TcSolutionExplorer.Children(new SystemHierarchy(), Root, 0, new List<string>());
        var plc = TcSolutionExplorer.Children(new SystemHierarchy(), Root, 0, new List<string>(), TcSolutionExplorer.PlcSubtree);

        var root = new ExplorerNode("TwinCAT Project14", "", "TwinCAT Project14", whole);
        var pruned = new ExplorerNode("TwinCAT Project14", "", "TwinCAT Project14", plc);
        Assert.Equal(Shape(TcSolutionExplorer.Find(root, "Untitled2 Project")!), Shape(TcSolutionExplorer.Find(pruned, "Untitled2 Project")!));
    }

    [Fact]
    public void Nothing_outside_the_PLC_projects_is_asked_for_its_children()
    {
        var hierarchy = new SystemHierarchy();

        var top = TcSolutionExplorer.Children(hierarchy, Root, 0, new List<string>(), TcSolutionExplorer.PlcSubtree);

        Assert.Equal(new[] { "SYSTEM", "PLC", "I/O" }, top.Select(n => n.Name));   // still listed
        Assert.Empty(top[0].Children);
        Assert.Empty(top[2].Children);
        Assert.DoesNotContain("SYSTEM", hierarchy.AskedForChildren);
        Assert.DoesNotContain("I/O", hierarchy.AskedForChildren);
        Assert.DoesNotContain("Untitled2 Instance", hierarchy.AskedForChildren);
        Assert.Contains("POUs", hierarchy.AskedForChildren);
    }
}
