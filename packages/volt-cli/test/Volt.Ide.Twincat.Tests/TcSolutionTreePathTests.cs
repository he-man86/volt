using System.Linq;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Xunit;
using static Volt.Ide.Twincat.Tests.TcUntouchablePouTests;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A TwinCAT item's path is its place in the solution tree, every node a segment (openspec <c>multi-application-tree</c>
/// 3.5): the PLC project's inner node (<c>Untitled2 Project</c>) is one, and the I/O devices sit under the tree's own
/// <c>I/O</c> → <c>Devices</c> nodes.
/// </summary>
public class TcSolutionTreePathTests
{
    private static Node Plc(Xae x) =>
        new(x, "Untitled2 Project", ItemKind.PlcFolder, false,
            new Node(x, "POUs", ItemKind.PlcFolder, false, new Node(x, "MAIN", ItemKind.PlcPouProg)),
            new Node(x, "PlcTask", ItemKind.PlcTask));

    [Fact]
    public void The_PLC_projects_inner_node_is_a_path_segment_and_the_application_root()
    {
        var (driver, _, _, _) = Project(Plc);

        var walk = driver.WalkItems();

        const string root = "TwinCAT Project14/PLC/Untitled2/Untitled2 Project";
        Assert.Equal(new[] { root }, walk.Applications);
        var main = walk.Items.Single(i => i.Name == "MAIN");
        Assert.Equal(root + "/POUs", main.Folder);
        Assert.Equal(root, walk.Items.Single(i => i.Name == "PlcTask").Folder);
        Assert.Equal(root, walk.Items.Single(i => i.KindCode == ItemKind.PlcProjectSettings).Folder);
        // A push descends the same segments.
        Assert.NotNull(ItemLookup.Find(driver, root + "/POUs/MAIN.pou"));
        Assert.Null(ItemLookup.Find(driver, "TwinCAT Project14/PLC/Untitled2/POUs/MAIN.pou"));
    }

    [Fact]
    public void The_IO_devices_sit_under_the_trees_own_IO_and_Devices_nodes()
    {
        var (driver, _, _, _) = Project(Plc, tiid: x => new Node(x, "Devices", 0, false, new Node(x, "Device 1 (EtherCAT)", 0)));

        var walk = driver.WalkItems();

        var device = walk.Items.Single(i => i.Name == "Device 1 (EtherCAT)");
        Assert.Equal((ItemKind.PlcDevice, FolderPath.Append(FolderPath.Append("TwinCAT Project14", "I/O"), "Devices")),
                     (device.KindCode, device.Folder));
        Assert.True(walk.Complete, string.Join(",", walk.UnwalkedFolders));
    }
}
