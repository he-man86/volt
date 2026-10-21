using System;
using System.IO;
using System.Linq;
using Volt.Engine.Item;
using Xunit;
using Volt.Tests.Shared;
using static Volt.Ide.Twincat.Tests.TcProjectSettingsTests;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// AN ITEM'S XML IS PRODUCED ONLY WHERE IT IS READ (TwinCAT e2e profile, 2026-10-18: `refs` on MultiProject ≈ 41
/// <c>ProduceXml</c> calls, ~110 ms). <c>ProduceXml</c> is an out-of-process call that serializes the item: the
/// manifest of a kind with no descriptor reader (<c>external_types</c>, <c>tmc</c>) produced it and returned the stub
/// whatever it said, and the PLC project item's XML — where its <c>.plcproj</c> path is — was produced once for the
/// compiler settings and again for the build entries in the same operation. A task's XML is still produced: whether it is
/// empty decides its manifest.
/// </summary>
public class TcProduceXmlReadsTests
{
    [Theory]
    [InlineData(ItemKind.PlcExtDataTypeCont, ItemKind.Kinds.ExternalTypes)]
    [InlineData(ItemKind.PlcTmcDescription, ItemKind.Kinds.TmcFile)]
    public void A_kind_with_no_descriptor_reader_produces_no_xml(int code, string kind)
    {
        using var project = new SettingsProject("untouched.plcproj.xml");
        var node = new Node("Stub", code, "<TreeItem><ItemName>Stub</ItemName></TreeItem>");
        var driver = project.Driver(node);
        var item = driver.WalkItems().Items.Single(i => i.Name == "Stub");

        Assert.Equal(ItemKind.EmptyManifest(kind), driver.ReadManifest(item.Item, kind));
        Assert.Equal(0, node.XmlReads);
    }

    [Fact]
    public void The_plcproj_path_is_asked_of_the_PLC_project_item_once_per_operation()
    {
        var file = Path.Combine(Path.GetTempPath(), "volt-tc-xmlreads-" + Guid.NewGuid().ToString("N") + ".TcPOU");
        File.WriteAllText(file, "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<TcPlcObject Version=\"1.1.0.1\">\n" +
                                "  <POU Name=\"PLC_PRG\" Id=\"{1}\" SpecialFunc=\"None\"><Declaration><![CDATA[]]></Declaration></POU>\n</TcPlcObject>\n");
        try
        {
            using var project = new SettingsProject("untouched.plcproj.xml");
            var pou = new Node("PLC_PRG", ItemKind.PlcPouProg,
                "<TreeItem><ItemName>PLC_PRG</ItemName><VSProperties>" + TcExclusionTests.Advanced("False") +
                "<VSProperty><Name>FullPath</Name>" +
                $"<Value>{file}</Value></VSProperty></VSProperties></TreeItem>") { DeclarationText = "PROGRAM PLC_PRG\nVAR\nEND_VAR" };
            var driver = project.Driver(pou);
            var walk = driver.WalkItems().Gated().Items;

            driver.ReadManifest(walk.Single(i => i.KindCode == ItemKind.PlcProjectSettings).Item, ItemKind.Kinds.ProjectSettings);
            driver.ReadContent(walk.Single(i => i.Name == "PLC_PRG").Item);

            Assert.Equal(1, project.Item!.XmlReads);
        }
        finally { File.Delete(file); }
    }
}
