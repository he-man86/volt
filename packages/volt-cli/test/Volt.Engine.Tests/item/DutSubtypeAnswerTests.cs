using System.Linq;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// THE DRIVER STATES A DUT'S SUBTYPE; NO ANSWER PUBLISHES <c>name.dut</c> (openspec <c>push-without-header-check</c>
/// 5.B.1, design step 5.B).
///
/// <para>The engine used to read a DUT's text to name it (<c>CodeHelper.DutSubtype</c> inside
/// <c>Materializer</c>), and a text that stated no subtype threw: the item was published <c>unreadable</c> and every
/// op on it needed <c>--force</c>. Now the driver hands up the VENDOR's answer on <see cref="ItemContent.DutSubtype"/>
/// and the engine only spells it. Every test here pins the vendor answer on the fake (<see cref="FakeIde.DutAnswers"/>)
/// — the text is deliberately the same struct in every case, so a test that passes cannot be reading it.</para>
///
/// <para><b>The counted fallback</b> is <c>.dut</c>: a DUT whose vendor states no subtype. It is triggered here (an
/// answer of null), and it is the only default the step introduces.</para>
/// </summary>
public class DutSubtypeAnswerTests
{
    private const string Struct = "TYPE X :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE";

    private static FakeIde DutAnswering(DutSubtype? answer)
    {
        var ide = new FakeIde(new FakeIde.Item("X", ItemKind.PlcDut, "DUTs", true, Struct, null, null, null));
        ide.DutAnswers["X"] = answer;
        return ide;
    }

    /// <summary>NO VENDOR ANSWER → <c>X.dut</c>. Not unreadable, not a guessed subtype: the item is tracked under the
    /// one name that claims nothing about its shape.</summary>
    [Fact]
    public void A_dut_whose_vendor_states_no_subtype_publishes_dot_dut()
    {
        var ide = DutAnswering(null);

        Assert.Equal("X.dut", Materializer.Materialize(ide, "X", ItemKind.Kinds.Dut, new ItemRef("X")).FullName);
        var refs = RefsService.Handle(ide);
        Assert.Equal(new[] { "X.dut" }, refs.Items.Keys.ToArray());
        Assert.Empty(refs.Unreadable);
    }

    /// <summary>EACH ANSWER IS ITS EXTENSION — from the answer, never the text (which is a struct in every row).</summary>
    [Theory]
    [InlineData(DutSubtype.Struct, "X.struct")]
    [InlineData(DutSubtype.Enum, "X.enum")]
    [InlineData(DutSubtype.Union, "X.union")]
    [InlineData(DutSubtype.Alias, "X.alias")]
    public void A_dut_is_named_by_the_subtype_its_vendor_states(DutSubtype answer, string wireName)
    {
        var ide = DutAnswering(answer);

        Assert.Equal(wireName, Materializer.Materialize(ide, "X", ItemKind.Kinds.Dut, new ItemRef("X")).FullName);
        Assert.Equal(new[] { wireName }, RefsService.Handle(ide).Items.Keys.ToArray());
        Assert.Equal(wireName, Assert.Single(FetchService.Handle(ide, new FetchRequest { KnownItems = new() }).Changed).Name);
    }

    /// <summary>ONLY THE EXTENSION FOLLOWS THE ANSWER. The bare name, the folder and the version
    /// (<c>Hasher.ComputeItemVersion(folder, text)</c>, name-free) are identical whatever the vendor answers — which is
    /// what lets an update quoting the <c>.dut</c> version reach the same DUT once it answers <c>.enum</c> (5.B.3).</summary>
    [Fact]
    public void The_bare_name_folder_and_version_are_identical_whatever_the_vendor_answers()
    {
        var none = RefsService.Handle(DutAnswering(null));
        var answered = RefsService.Handle(DutAnswering(DutSubtype.Enum));

        Assert.Equal(none.Items["X.dut"], answered.Items["X.enum"]);
        Assert.Equal(none.Folders["X.dut"], answered.Folders["X.enum"]);
        Assert.Equal(Materializer.Bare("X.dut"), Materializer.Bare("X.enum"));
    }

    /// <summary>A SUBTYPE ON A NON-DUT BREAKS THE DRIVER CONTRACT and is refused naming the item — the engine does not
    /// pick between the kind and the answer. On the wire the item is unreadable, with that reason, rather than named
    /// by either guess.</summary>
    [Fact]
    public void A_subtype_on_a_non_dut_is_refused_naming_the_item()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("FB_A", "FUNCTION_BLOCK FB_A\nVAR\nEND_VAR", "", "POUs"));
        ide.DutAnswers["FB_A"] = DutSubtype.Enum;

        var ex = Assert.Throws<System.InvalidOperationException>(
            () => Materializer.Materialize(ide, "FB_A", ItemKind.Kinds.FunctionBlock, new ItemRef("FB_A")));
        Assert.Contains("'FB_A'", ex.Message);
        Assert.Contains("subtype", ex.Message);
        Assert.Equal(new[] { "FB_A" }, RefsService.Handle(ide).Unreadable.ToArray());
    }

    /// <summary>The extension table spells <c>dut</c> once: a null answer reads it from there, and a DUT wire name under
    /// any of the five extensions is the DUT kind.</summary>
    [Theory]
    [InlineData(null, "dut")]
    [InlineData(DutSubtype.Struct, "struct")]
    [InlineData(DutSubtype.Enum, "enum")]
    [InlineData(DutSubtype.Union, "union")]
    [InlineData(DutSubtype.Alias, "alias")]
    public void DutExtension_reads_each_answer_from_the_one_extension_table(DutSubtype? answer, string ext)
    {
        Assert.Equal(ext, ItemKind.DutExtension(answer));
        Assert.Contains(ItemKind.SourceKindExtensions, x => x.Kind == ItemKind.Kinds.Dut && x.Ext == ext);
        Assert.Equal(ItemKind.Kinds.Dut, ItemKind.KindForWireName($"X.{ext}"));
    }
}
