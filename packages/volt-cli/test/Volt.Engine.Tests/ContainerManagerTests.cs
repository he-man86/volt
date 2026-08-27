using System.Linq;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Sync;
using Volt.Engine.Vocabulary;
using Volt.Engine.Item;

namespace Volt.Cli.Tests;

/// <summary>A container-manager (library / recipe / visualization manager) is a FOLDER, not a file: it only
/// groups its children, so it is never emitted as a tracked item — no `<Manager>.<kind>` stub beside the folder.
/// The driver walks avoid emitting it; these tests pin the Core backstop that makes the invariant vendor-agnostic,
/// plus the `changed`/`Items` consistency that keeps a legitimately-repeated opaque name from orphaning a file.</summary>
public class ContainerManagerTests
{
    [Theory]
    [InlineData(ItemKind.PlcLibMan)]
    [InlineData(ItemKind.PlcRecipeMan)]
    [InlineData(ItemKind.PlcRecipes)]
    [InlineData(ItemKind.PlcVisMan)]
    public void Manager_kinds_are_container_managers(int code) => Assert.True(ItemKind.IsContainerManager(code));

    [Theory]
    [InlineData(ItemKind.PlcPouFb)]     // source
    [InlineData(ItemKind.PlcLibRef)]    // a library reference (the manager's CHILD) IS emitted
    [InlineData(ItemKind.PlcDevice)]    // a real descriptor
    [InlineData(ItemKind.PlcTextList)]  // a leaf, not a container
    public void Non_managers_are_not_container_managers(int code) => Assert.False(ItemKind.IsContainerManager(code));

    [Fact]
    public void A_container_manager_is_not_emitted_by_fetch_but_real_items_are()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("Good", "PROGRAM Good\nVAR\nEND_VAR", "x := 1;"),
            new FakeIde.Item("Library Manager", ItemKind.PlcLibMan, "App", false, "library_manager", null, null, null));

        var fetch = FetchService.Handle(ide, new FetchRequest { KnownItems = new() });

        Assert.DoesNotContain(fetch.Items.Keys, k => k.Contains("library_manager"));
        Assert.DoesNotContain(fetch.Changed, c => c.Name.Contains("library_manager"));
        Assert.Contains(fetch.Items.Keys, k => k.StartsWith("Good")); // the real item still comes through
    }

    [Fact]
    public void A_container_manager_is_not_emitted_by_refs()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("Good", "PROGRAM Good\nVAR\nEND_VAR", "x := 1;"),
            new FakeIde.Item("RecipeManager", ItemKind.PlcRecipeMan, "App", false, "recipe_manager", null, null, null));

        var refs = RefsService.Handle(ide);

        Assert.DoesNotContain(refs.Items.Keys, k => k.Contains("recipe_manager"));
        Assert.Contains(refs.Items.Keys, k => k.StartsWith("Good"));
    }

    [Fact]
    public void Changed_collapses_a_repeated_opaque_name_to_match_the_name_keyed_items()
    {
        // Two DISTINCT opaque objects legitimately share the bare name "Dup" at different folders (the real case
        // was two "Library Manager" objects). The name-keyed Items map collapses them; `changed` must agree, or
        // one of the two files is orphaned relative to the baseline.
        var ide = new FakeIde(
            new FakeIde.Item("Dup", ItemKind.PlcTextList, "A", false, "text_list", null, null, null),
            new FakeIde.Item("Dup", ItemKind.PlcTextList, "B", false, "text_list", null, null, null));

        var fetch = FetchService.Handle(ide, new FetchRequest { KnownItems = new() });

        Assert.Single(fetch.Items);                                    // name-keyed → one entry
        Assert.Single(fetch.Changed, c => c.Name == "Dup.text_list");  // changed agrees → one file
    }
}
