using Volt.Engine.Item;
using Xunit;
using Volt.Tests.Shared;
using static Volt.Ide.Twincat.Tests.TcUntouchablePouTests;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE SOLUTION EXPLORER IS READ ONCE PER OPERATION (TwinCAT MultiProject latency, 2026-10-18: `refs` ≈ 400 ms and a
/// no-op push ≈ 840 ms against a 500 ms budget). Measured live on the MultiProject fixture: each PLC project's hierarchy
/// read walked its whole SYSTEM project's hierarchy (~47 ms, three times for the three PLC projects of `TwinCAT
/// Project14`), and every walk dropped the operation's snapshot, so a push — a pre-apply walk and a receipt walk — read
/// everything twice. The snapshot is dropped at the start of an operation (<c>BeckhoffDriver.MarshalToIdeThread</c>) and
/// after a structural write that makes it stale (<c>TcObjectModel.StructureChanged</c>); a second walk in the same
/// operation reads nothing again.
/// </summary>
public class TcExplorerReadsTests
{
    [Fact]
    public void Two_walks_in_one_operation_read_the_hierarchy_once()
    {
        var reads = 0;
        Node? tree = null;
        var (driver, _, _, root) = Project(x => tree = new Node(x, "Untitled2 Project", ItemKind.PlcFolder, false,
                new Node(x, "POUs", ItemKind.PlcFolder, false, new Node(x, "Motor", ItemKind.PlcPou)),
                new Node(x, "PLC_PRG", ItemKind.PlcPouProg)),
            (_, system) => { reads++; return system == "TwinCAT Project14" ? SystemOf(tree!) : null; });

        driver.WalkItems().Gated();
        driver.WalkItems().Gated();

        Assert.Equal(1, reads);
    }

    /// <summary>The PLC projects of ONE system project share one hierarchy read: the read is of the system project.</summary>
    [Fact]
    public void The_hierarchy_is_read_per_system_project_not_per_PLC_project()
    {
        var reads = new System.Collections.Generic.List<string>();
        Node? tree = null;
        var (driver, _, _, _) = Project(x => tree = new Node(x, "Untitled2 Project", ItemKind.PlcFolder, false,
                new Node(x, "PLC_PRG", ItemKind.PlcPouProg)),
            (_, system) => { reads.Add(system); return system == "TwinCAT Project14" ? SystemOf(tree!) : null; });

        driver.WalkItems().Gated();

        Assert.Equal(new[] { "TwinCAT Project14" }, reads);
    }
}
