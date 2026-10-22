using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Engine.Seam;
using Volt.Engine.Sync;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Engine.Tests.Seam;

/// <summary>The step-5 adapter (openspec <c>volt-cli-rework</c>, design "The adapter: old host to new contract"): an
/// old-contract host on the new contract decides what it decided over codes, item by item — so the Engine rewritten over
/// <see cref="NodeClass"/> reads the old hosts exactly as before.</summary>
public class LegacyDriverTests
{
    /// <summary>Every code from the unknown sentinel to the end of the TwinCAT PLC range, each an object in one folder.</summary>
    private static readonly int[] Codes = Enumerable.Range(-2, 803).ToArray();

    private static (LegacyDriver Driver, Catalog Catalog, List<(int Code, NodeClass Class)> Nodes) Classified()
    {
        var ide = new FakeIde(Codes.Select(c => new FakeIde.Item($"I{c + 2}", c, "F", false, null, null, null, null)).ToArray());
        var link = HostLink.Of(ide);
        var driver = (LegacyDriver)link.Driver;
        var folder = driver.Children(driver.Root).Single(c => driver.Name(c) == "F");
        var nodes = driver.Children(folder).Select(c => (ide.KindCode(c), driver.Classify(c))).ToList();
        Assert.Equal(Codes.Length, nodes.Count);
        return (driver, link.Catalog, nodes);
    }

    private static bool IsSourceItem(Catalog catalog, NodeClass c) =>
        c.Role == NodeRole.Item && catalog.Kinds.Require(c.Kind!).Role == KindRole.Source;

    [Fact]
    public void Every_code_is_the_role_each_old_predicate_read()
    {
        var (_, catalog, nodes) = Classified();
        foreach (var (code, cls) in nodes)
        {
            var at = $"code {code} as {cls}";
            Assert.True((cls.Role == NodeRole.Folder) == (code == ItemKind.PlcFolder), at);
            Assert.True(IsSourceItem(catalog, cls) == ItemKind.IsTopLevelCrud(code), at);
            Assert.True((cls.Role == NodeRole.Item && catalog.Kinds.Require(cls.Kind!).Role is KindRole.Source or KindRole.WritableDescriptor)
                        == ItemKind.IsAddressableItem(code), at);
            Assert.True((cls.Role == NodeRole.Folder || cls is { Role: NodeRole.Container, HoldsItems: true })
                        == (code is ItemKind.PlcFolder or ItemKind.Application), at);
            Assert.True((cls.Takes?.Contains(ItemKind.Kinds.Task) == true) == (code == ItemKind.TaskConfig), at);
            if (ItemKind.IsContainerManager(code)) Assert.Equal(NodeRole.Container, cls.Role);
            if (cls.Kind is { } kind)
            {
                Assert.Equal(ItemKind.Map(code), kind);
                Assert.NotNull(catalog.Kinds.Find(kind));
            }
        }
    }

    [Fact]
    public void A_node_that_is_no_folder_is_named_by_the_words_the_old_refusal_used()
    {
        var (_, _, nodes) = Classified();
        string NounOf(int code) => nodes.Single(n => n.Code == code).Class.Noun!;
        Assert.Equal("device node", NounOf(ItemKind.Device));
        Assert.Equal("PLC logic node", NounOf(ItemKind.PlcLogic));
        Assert.Equal("task configuration node", NounOf(ItemKind.TaskConfig));
        Assert.Equal("container node", NounOf(ItemKind.GenericContainer));
        Assert.Equal("pou node", NounOf(ItemKind.PlcPou));
        Assert.Equal("tree node of item type 640", NounOf(640));
    }

    [Fact]
    public void The_walk_drops_an_unmapped_code_and_a_container_manager_and_keeps_every_kind_as_its_word()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("Good", "PROGRAM Good\nVAR\nEND_VAR", "x := 1;"),
            new FakeIde.Item("Library Manager", ItemKind.PlcLibMan, "App", false, "library_manager", null, null, null),
            new FakeIde.Item("Odd", 640, "App", false, null, null, null, null),
            new FakeIde.Item("Dup", ItemKind.PlcTextList, "A", false, "text_list", null, null, null));

        var walk = HostLink.Of(ide).Driver.Walk();

        Assert.Equal(new[] { ("Good", ItemKind.Kinds.Pou), ("Dup", ItemKind.Kinds.TextList) },
                     walk.Items.Select(i => (i.Name, i.Kind)));
    }

    [Fact]
    public void A_read_is_the_old_read_folded_and_written_back_it_is_the_same_record()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;"));
        var driver = HostLink.Of(ide).Driver;
        var item = driver.Walk().Items.Single().Item;

        var content = driver.Read(item);

        Assert.Equal(ItemKind.Kinds.Pou, content.Kind);
        Assert.Equal(BodyText.Shown("ST", "x := 1;"), content.Body);
        Assert.Equal(FamilyContentTests.Describe(ide.ReadContent(item)),
                     FamilyContentTests.Describe(Volt.Engine.Format.St.FamilyContent.ToItemContent(content)));
    }

    [Fact]
    public void A_host_link_holds_its_own_declaration_alone()
    {
        var link = HostLink.Of(new FakeIde());

        Assert.Equal(new[] { "codesys" }, link.Catalog.Vendors.Ids);
        Assert.Equal(new[] { "dut", "gvl", "itf", "pou" }, link.Catalog.Kinds.SourceExtensions);
        Assert.Equal(new[] { "FBD", "LD", "ST" }, link.Catalog.Languages.ShownBy("codesys"));
    }
}
