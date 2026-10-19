using System.Collections.Generic;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Ide.Twincat;
using Xunit;
using Volt.Tests.Shared;
using static Volt.Ide.Twincat.Tests.TcUntouchablePouTests;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A STRUCTURAL WRITE MAKES ONE SYSTEM PROJECT'S HIERARCHY STALE, NOT EVERY ONE (TwinCAT e2e profile, 2026-10-18). A
/// create or delete changes the Solution Explorer hierarchy of the system project it lands in; the snapshot dropped after
/// it was every system project's, so the next access to a PLC project of ANOTHER system project read its whole hierarchy
/// again (~47 ms on MultiProject's `TwinCAT Project14`) for a tree nothing had touched.
/// </summary>
public class TcStructureChangeForgetsItsSystemTests
{
    private sealed class Sys
    {
        public Sys(string name) { Name = name; Root = new Node(X, "Untitled2 Project", ItemKind.PlcFolder, false, Pous); }
        public readonly string Name;
        public readonly Xae X = new();
        public Node Pous => _pous ??= new Node(X, "POUs", ItemKind.PlcFolder, false, new Node(X, "Motor", ItemKind.PlcPou));
        private Node? _pous;
        public readonly Node Root;
        public TcAttachTests.Project Project() => new(Name, new TcUntouchablePouTests.SysManager(new TcComTree.Tipc(new Plc(Root))));
    }

    [Fact]
    public void A_create_in_one_system_project_reads_no_other_system_projects_hierarchy_again()
    {
        var a = new Sys("TwinCAT Project14");
        var b = new Sys("TwinCAT Project1");
        var reads = new Dictionary<string, int>();
        var window = new TcAttachTests.Dte(a.Project(), b.Project());
        window.Solution.Name = @"C:\p\TwinCAT MultiProject.sln";
        var model = new TcObjectModel
        {
            BindWindow = _ => window,
            ReadExplorer = (_, system) =>
            {
                reads[system] = reads.GetValueOrDefault(system) + 1;
                return SystemAround((system == a.Name ? a : b).Root.Explorer());
            },
        };
        var driver = new BeckhoffDriver(model);
        driver.Connect(xaePid: 1);
        var plcs = model.Plcs();
        ItemRef PousOf(Sys s, int plc) => new(new BeckhoffDriver.TcNode(s.Pous, plcs[plc], ItemKind.PlcFolder));

        driver.WalkItems().Gated();
        Assert.Equal(1, reads[a.Name]);
        Assert.Equal(1, reads[b.Name]);

        driver.CreateChild(PousOf(a, 0), "Pump", ItemKind.PlcPou, null, null);
        Assert.Equal(2, driver.ChildCount(PousOf(a, 0)));   // stale since the create: its system project is read again
        Assert.Equal(1, driver.ChildCount(PousOf(b, 1)));

        Assert.Equal(2, reads[a.Name]);
        Assert.Equal(1, reads[b.Name]);
    }
}
