using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A PATH THE CLIENT ADDRESSES FINDS THE IDE ITEM IGNORING CASE; A KEY THE CLIENT HOLDS IS EXACT (openspec
/// <c>one-path-comparer</c>).
///
/// <para>Push resolves a <c>name</c>/<c>to</c> in any case; a directed read (<c>onlyItems</c>) answered nothing for the
/// same path in another case — two answers to "does this path name that item". IDE paths are unique ignoring case (IEC
/// names within a kind, and the kind extension separates kinds), so matching ignoring case is never ambiguous.</para>
///
/// <para><c>knownItems</c> is a different question: a key the client HOLDS is answered back as sent. A case-only rename
/// in the IDE answers the old key in <c>removed</c> and the new path in <c>items</c>, which is exactly what the CLI's
/// case-sensitive git tree needs to end up with ONE entry.</para>
/// </summary>
public class AddressedPathCaseTests
{
    private const string Folder = "Device/Plc Logic/Application";

    private static FakeIde.Item Fb(string name) => FakeIde.Item.TextualPou(name,
        $"FUNCTION_BLOCK {name}\nVAR\nEND_VAR\n", "n := 0;\n", Folder);

    [Fact]
    public void A_directed_read_in_another_case_finds_the_item_and_spells_it_as_the_IDE_does()
    {
        var ide = new FakeIde(Fb("FB_Motor"));

        var res = FetchService.Handle(ide, new FetchRequest
        {
            KnownItems = new Dictionary<string, string>(),
            OnlyItems = new List<string> { "device/plc logic/application/fb_motor.pou" },
        });

        Assert.Equal(new[] { $"{Folder}/FB_Motor.pou" }, res.Changed.Select(c => c.Name).ToArray());
        Assert.Equal(new[] { $"{Folder}/FB_Motor.pou" }, res.Items.Keys.ToArray());
    }

    /// <summary>Pin: a held key is exact. The IDE renames <c>Calc</c> to <c>calc</c> (case only).</summary>
    [Fact]
    public void A_case_only_rename_answers_the_held_key_removed_and_the_new_path_in_items()
    {
        var ide = new FakeIde(Fb("Calc"));
        var known = RefsService.Handle(ide).Items.ToDictionary(x => x.Key, x => x.Value);
        Assert.Equal(new[] { $"{Folder}/Calc.pou" }, known.Keys.ToArray());

        ide.RemoveItem("Calc", Folder);
        ide.AddItem(Fb("calc"));

        var refs = RefsService.Handle(ide, new RefsRequest { KnownItems = known });
        Assert.Equal(new[] { $"{Folder}/Calc.pou" }, refs.Removed);
        Assert.Equal(new[] { $"{Folder}/calc.pou" }, refs.Items.Keys.ToArray());

        var fetch = FetchService.Handle(ide, new FetchRequest { KnownItems = known });
        Assert.Equal(new[] { $"{Folder}/Calc.pou" }, fetch.Removed);
        Assert.Equal(new[] { $"{Folder}/calc.pou" }, fetch.Items.Keys.ToArray());
    }
}
