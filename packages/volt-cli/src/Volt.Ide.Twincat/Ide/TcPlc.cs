using Volt.Engine.Item;

namespace Volt.Ide.Twincat;

/// <summary>
/// One PLC project of one system project of the bound solution — what every tree read and write addresses
/// (<see cref="TcObjectModel.Use"/>), and the APPLICATION its items belong to (openspec <c>multi-application-tree</c>).
///
/// <para>Its items sit at <see cref="Path"/>, <c>&lt;system project&gt;/PLC/&lt;PLC project&gt;/&lt;its project node&gt;</c>
/// (<c>TwinCAT Project14/PLC/Untitled2/Untitled2 Project</c>): every node of the solution tree is a segment, the PLC
/// project's inner node (its <c>NestedProject</c>, named as the tree names it) too (design §1).</para>
///
/// <para>It carries the per-PLC state one operation reads: its Solution Explorer snapshot and its root's tree path,
/// so addressing another PLC project and back reads neither twice.</para>
/// </summary>
internal sealed class TcPlc
{
    /// <summary>The segment the solution tree puts between a system project and its PLC projects.</summary>
    public const string PlcSegment = "PLC";

    public TcPlc(string system, object manager, object node, string name, string projectName)
    {
        System = system;
        Manager = manager;
        Node = node;
        Name = name;
        ProjectName = projectName;
        Path = FolderPath.Append(FolderPath.Append(FolderPath.Append(FolderPath.Encode(system), PlcSegment), name), projectName);
    }

    /// <summary>The system project's name (the solution project, <c>TwinCAT Project14</c>).</summary>
    public string System { get; }

    /// <summary>The system project's system manager — <c>LookupTreeItem</c> for <c>TIRT</c>, <c>TIID</c> and paths.</summary>
    public object Manager { get; }

    /// <summary>The PLC project item under <c>TIPC</c> (<c>TIPC^Untitled2</c>); its <c>NestedProject</c> is the tree.</summary>
    public object Node { get; }

    /// <summary>The PLC project's name (<c>Untitled2</c>).</summary>
    public string Name { get; }

    /// <summary>Its inner project node's name, as the tree names it (<c>Untitled2 Project</c>, the <c>NestedProject</c>):
    /// the node its items, its task and its settings sit under.</summary>
    public string ProjectName { get; }

    /// <summary>The application root: <c>&lt;system&gt;/PLC/&lt;plc&gt;/&lt;project&gt;</c>, encoded as the walk encodes folders.</summary>
    public string Path { get; }

    /// <summary>This operation's Solution Explorer snapshot of the PLC project, or null before the first child access.</summary>
    public ExplorerSnapshot? Explorer { get; set; }

    /// <summary>The PLC project root's tree path (<c>PathName</c>), read once per operation.</summary>
    public string? RootPath { get; set; }

    /// <summary>A clean snapshot read before a structural write in this operation (<c>TcObjectModel.RequireListed</c>).</summary>
    public bool StaleSinceWrite { get; set; }

    public override string ToString() => Path;
}
