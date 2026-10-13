using System;
using System.Runtime.InteropServices;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Item;
using Volt.Ide.Twincat;
using Xunit;
using static Volt.Ide.Twincat.Tests.TcWalkUnreadableObjectTests;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// AN IDE WHOSE HIERARCHY NO READER CAN UNMARSHAL IS UNSUPPORTED, NOT AN UNVERIFIED FOLDER (openspec
/// <c>twincat-x64-solution-explorer-marshaling</c> 1.1).
///
/// <para>The field case: on a plain TwinCAT install the worker's hierarchy read answered
/// <c>QueryService(SVsSolution) failed (0x80040154)</c> on every op, wrapped as <c>ITEM_UNVERIFIED</c> "the Solution
/// Explorer hierarchy is unreadable" — which a client reads as "this folder could not be confirmed", and which sent a
/// customer looking for a missing folder while <c>health</c> said OK. A reader that cannot exist is a fact about the
/// IDE: <c>IDE_UNSUPPORTED</c>, one sentence naming the IDE and what is missing, on every op and on
/// <c>health</c>. A read that DID reach the hierarchy and failed stays <c>ITEM_UNVERIFIED</c>.</para>
/// </summary>
public class TcHierarchyUnreachableTests
{
    private static BeckhoffDriver Attached(Func<object, string, ExplorerNode?> readExplorer)
    {
        var root = new Node("PLC", ItemKind.PlcFolder, new Node("Data", ItemKind.PlcFolder));
        var window = new TcAttachTests.Dte(new TcAttachTests.Project("TwinCAT Project14",
            new SysManager(new Tipc(new Plc(root)))));
        var driver = new BeckhoffDriver(new TcObjectModel { BindWindow = _ => window, ReadExplorer = readExplorer });
        driver.Connect(xaePid: 1);
        return driver;
    }

    [Fact]
    public void A_hierarchy_no_reader_can_unmarshal_makes_the_bridge_unsupported_naming_the_ide_and_what_is_missing()
    {
        var driver = Attached((_, _) => throw new HierarchyUnreachableException("the 32-bit hierarchy reader is missing"));
        Assert.Null(driver.Unsupported);

        var refused = Assert.Throws<BridgeException>(() => driver.WalkItems());

        Assert.Equal(BridgeErrorCodes.IdeUnsupported, refused.ErrorCode);
        Assert.Contains("15.0", refused.Message);                                  // the IDE, by its version
        Assert.Contains("the 32-bit hierarchy reader is missing", refused.Message); // what it lacks
        Assert.Equal(refused.Message, driver.Unsupported);                         // health and every op say it from now on
    }

    [Fact]
    public void A_hierarchy_read_that_failed_stays_item_unverified_and_the_bridge_stays_supported()
    {
        var driver = Attached((_, _) => throw new COMException("IVsSolution.GetProjectEnum failed (0x80004005)", unchecked((int)0x80004005)));

        var refused = Assert.Throws<BridgeException>(() => driver.WalkItems());

        Assert.Equal(ConflictCodes.ItemUnverified, refused.ErrorCode);
        Assert.Null(driver.Unsupported);
    }
}
