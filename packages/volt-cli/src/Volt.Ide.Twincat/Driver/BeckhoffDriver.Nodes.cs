using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Ide;
using Volt.Engine.Item;

namespace Volt.Ide.Twincat;

/// <summary>
/// THE WHOLE SOLUTION IS ONE TREE (openspec <c>multi-application-tree</c>, design §1): every PLC project of every system
/// project, at <c>&lt;system&gt;/PLC/&lt;plc&gt;/…</c>, as CODESYS's tree holds every device. The levels above a PLC
/// project's own tree are no COM nodes — they are the solution's structure — so they are this driver's own handles,
/// and every COM node carries the PLC project it belongs to (<see cref="TcNode"/>): two system projects may hold a PLC
/// project of one name, and a COM path (<c>TIPC^Untitled1^…</c>) is only unique inside its own system manager.
///
/// <para>Before any node is touched its PLC project is ADDRESSED (<see cref="TcObjectModel.Use"/>), so the object
/// model's single-project reads (its root, its Solution Explorer snapshot, its tasks' system manager) answer for the
/// right one.</para>
/// </summary>
public sealed partial class BeckhoffDriver
{
    /// <summary>A COM tree node of the PLC project <see cref="Plc"/> — with its tree <see cref="Kind"/> when the walk that
    /// found it read it, so reading the item asks the IDE no fact the same operation's walk already has.</summary>
    internal sealed class TcNode
    {
        public TcNode(object com, TcPlc plc, int? kind = null) { Com = com; Plc = plc; Kind = kind; }
        public object Com { get; }
        public TcPlc Plc { get; }
        /// <summary>The node's <c>ItemType</c> as the walk read it, or null for a node reached otherwise.</summary>
        public int? Kind { get; }
        public override string ToString() => $"{Plc}: {Com}";
    }

    /// <summary>The solution — the tree root, holding the system projects.</summary>
    internal sealed class SolutionNode
    {
        public static readonly SolutionNode Instance = new();
        private SolutionNode() { }
        public override string ToString() => "<solution>";
    }

    /// <summary>A system project — holding the <c>PLC</c> node (the read-only <c>.device</c> descriptor and the I/O tree
    /// are walked items, never navigated).</summary>
    internal sealed class SystemNode
    {
        public SystemNode(string name) => Name = name;
        public string Name { get; }
        public override string ToString() => Name;
    }

    /// <summary>A system project's <c>PLC</c> node, holding its PLC projects.</summary>
    internal sealed class PlcFolderNode
    {
        public PlcFolderNode(string system) => System = system;
        public string System { get; }
        public override string ToString() => System + "/" + TcPlc.PlcSegment;
    }

    /// <summary>A PLC project item under <c>TIPC</c> — named as the solution names it (<c>Untitled2</c>), holding its
    /// project node (<see cref="PlcProjectNode"/>).</summary>
    internal sealed class PlcItemNode
    {
        public PlcItemNode(TcPlc plc) => Plc = plc;
        public TcPlc Plc { get; }
        public override string ToString() => Plc.System + "/" + TcPlc.PlcSegment + "/" + Plc.Name;
    }

    /// <summary>A PLC project's project node — its NestedProject, named as the tree names it (<c>Untitled2 Project</c>),
    /// the application root its children are the NestedProject's.</summary>
    internal sealed class PlcProjectNode
    {
        public PlcProjectNode(TcPlc plc) => Plc = plc;
        public TcPlc Plc { get; }
        public override string ToString() => Plc.Path;
    }

    /// <summary>A system project's read-only <c>.device</c> descriptor (design §2): the target, described as CODESYS
    /// describes its device.</summary>
    internal sealed class SystemDescriptorNode
    {
        public SystemDescriptorNode(string system) => System = system;
        public string System { get; }
        public override string ToString() => System + ".device";
    }

    /// <summary>A node of a system project's I/O tree (<c>TIID</c>), read-only descriptors only.</summary>
    internal sealed class IoNode
    {
        public IoNode(object com) => Com = com;
        public object Com { get; }
    }

    /// <summary>The COM node <paramref name="item"/> stands for, its PLC project ADDRESSED first. A PLC project stands
    /// for its NestedProject (the tree its children are created in, deleted from and moved into). A structural node above
    /// the PLC projects has no COM node: asking for one is a write Volt never makes there, refused by name.</summary>
    private object Com(ItemRef item)
    {
        switch (item.Native)
        {
            case TcNode node:
                _om.Use(node.Plc);
                return node.Com;
            case PlcProjectNode project:
                _om.Use(project.Plc);
                return _om.PlcRoot();
            case IoNode io:
                return io.Com;
            default:
                throw new BridgeException(BridgeErrorCodes.BadRequest,
                    $"'{item.Native}' is the solution's own structure (a system project, its PLC node), not a node of a PLC " +
                    "project — nothing is created in, deleted from, moved into or read from it");
        }
    }

    /// <summary>A COM node the object model just answered, in the ADDRESSED PLC project.</summary>
    private ItemRef Wrap(object com) => new(new TcNode(com, _om.CurrentPlc));

    /// <summary>The PLC projects of <paramref name="system"/>, in their <c>TIPC</c> order.</summary>
    private List<TcPlc> PlcsOf(string system) =>
        _om.Plcs().Where(p => string.Equals(p.System, system, StringComparison.Ordinal)).ToList();

    /// <summary>The system projects that hold a PLC project, in solution order — what the root holds.</summary>
    private List<string> SystemsWithPlcs() => _om.Plcs().Select(p => p.System).Distinct(StringComparer.Ordinal).ToList();
}
