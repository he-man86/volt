using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine;
using Volt.Engine.Format.St;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Tests.Shared;
using Xunit;
using static Volt.Ide.Twincat.Tests.TcExclusionTests;
using static Volt.Ide.Twincat.Tests.TcUntouchablePouTests;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// TWINCAT'S BUILD PROPERTIES ARE ITS LIVE <c>LinkAlways</c>, <c>External</c> AND <c>CompilerDefines</c> (DIALECT C40,
/// openspec <c>twincat-large-solution-refs</c> item 3). Every PLC item and member publishes them in its
/// <c>ProduceXml</c>'s <c>&lt;VSProperties&gt;</c>, answered from memory — saved or not — as its own value. They pull as
/// <c>%LINK_ALWAYS</c>, <c>%EXTERNAL</c> and <c>%COMPILER_DEFINES</c>, in the text CODESYS pulls for the same object, and a
/// push writes each one back. The saved <c>.plcproj</c> holds only their copy at the last save: a GVL saved with
/// <c>&lt;LinkAlways&gt;</c> was refused, so the I/O lists every program reads were missing from the pull.
/// </summary>
public class TcBuildPropertiesTests
{
    private const string GvlDeclaration = "VAR_GLOBAL\n\tbStart : BOOL;\nEND_VAR";
    private const string LinkedGvl = GvlDeclaration + "\n%LINK_ALWAYS\n";

    private static Pou Gvl(Saved saved) =>
        new(saved.File, "False") { Name = "G_IO", ItemType = ItemKind.PlcGvl, DeclarationText = GvlDeclaration };

    private static Saved SavedGvl(string entry) => new(SubType + entry, "G_IO.TcGVL", "GVL");

    // ── the pull ─────────────────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The production finding: a GVL whose saved entry holds <c>&lt;LinkAlways&gt;</c> pulls with the line — it
    /// was refused ("a build property TwinCAT has no measured member for").</summary>
    [Fact]
    public void A_GVL_saved_linked_always_pulls_LINK_ALWAYS()
    {
        using var saved = SavedGvl("<LinkAlways>true</LinkAlways>");
        var gvl = Gvl(saved);
        gvl.Live.LinkAlways = "True";
        Assert.Equal(LinkedGvl, StWriter.Write(Read(saved, gvl)));
    }

    /// <summary>Linked always in the IDE and not yet saved — the entry says nothing — it pulls with the line; it pulled
    /// without it.</summary>
    [Fact]
    public void A_GVL_linked_always_in_the_IDE_and_not_yet_saved_pulls_LINK_ALWAYS()
    {
        using var saved = SavedGvl("");
        var gvl = Gvl(saved);
        gvl.Live.LinkAlways = "True";
        Assert.Equal(LinkedGvl, StWriter.Write(Read(saved, gvl)));
    }

    /// <summary>Cleared in the IDE and not yet saved — the entry still says <c>true</c> — it pulls as the IDE builds it.</summary>
    [Fact]
    public void A_link_cleared_in_the_IDE_and_not_yet_saved_pulls_without_the_line()
    {
        using var saved = SavedGvl("<LinkAlways>true</LinkAlways>");
        Assert.Equal(ObjectProperties.None, Read(saved, Gvl(saved)).Properties);
    }

    /// <summary>A cleared <c>External</c> stays in the saved entry as <c>&lt;External&gt;false&lt;/External&gt;</c> (C40): it
    /// pulls as the plain object it is.</summary>
    [Fact]
    public void A_saved_External_false_entry_pulls_as_plain()
    {
        using var saved = SavedGvl("<External>false</External>");
        Assert.Equal(ObjectProperties.None, Read(saved, Gvl(saved)).Properties);
    }

    /// <summary>WIRE PARITY: a function block linked always, external, with compiler defines pulls the text CODESYS pulls
    /// for one (<c>CodesysObjectPropertiesTests</c>).</summary>
    [Fact]
    public void A_linked_external_function_block_with_defines_pulls_the_shared_text()
    {
        using var saved = new Saved(SubType + "<LinkAlways>true</LinkAlways><External>true</External>" +
                                    $"<CompilerDefines>{WireParityCases.BuildPropertiesDefines}</CompilerDefines>");
        var pou = new Pou(saved.File, "False");
        pou.Live.LinkAlways = "True";
        pou.Live.External = "True";
        pou.Live.CompilerDefines = WireParityCases.BuildPropertiesDefines;
        Assert.Equal(WireParityCases.BuildPropertiesFunctionBlock, StWriter.Write(Read(saved, pou)));
    }

    /// <summary>A member's own build properties pull on the member — inside an excluded POU too, where only its exclusion
    /// is the POU's (C40: they are never <c>readonly</c>).</summary>
    [Fact]
    public void A_member_pulls_its_own_build_properties_also_inside_an_excluded_POU()
    {
        using var saved = new Saved(SubType);
        var run = new TcExclusionTests.Member("Run", ItemKind.PlcMethod, "METHOD Run : BOOL", "Inherited");
        run.Live.LinkAlways = "True";
        run.Live.CompilerDefines = "M1";
        var read = Read(saved, new Pou(saved.File, "True", run));

        Assert.Equal(ObjectProperties.None with { LinkAlways = true, CompilerDefines = "M1" }, Assert.Single(read.Members).Properties);
    }

    /// <summary>A POU's <c>AdditionalAllocation</c> has no line (C40): any value but 0 refuses the object by name, saved or
    /// not; at 0 its saved entry is the save's copy and pulls.</summary>
    [Fact]
    public void An_AdditionalAllocation_other_than_0_is_refused_by_name()
    {
        using var saved = new Saved(SubType);
        var pou = new Pou(saved.File, "False");
        pou.Live.AdditionalAllocation = "200";
        var ex = Assert.Throws<BridgeException>(() => Read(saved, pou));
        Assert.Contains("'FB_X'", ex.Message);
        Assert.Contains("AdditionalAllocation", ex.Message);

        using var zero = new Saved(SubType + "<AdditionalAllocation>200</AdditionalAllocation>");
        Assert.Equal(ObjectProperties.None, Read(zero, new Pou(zero.File, "False")).Properties);
    }

    [Theory]
    [InlineData("LinkAlways")]
    [InlineData("External")]
    [InlineData("CompilerDefines")]
    public void An_item_publishing_no_such_property_is_refused_by_name(string name)
    {
        using var saved = new Saved(SubType);
        var pou = new Pou(saved.File, "False");
        pou.Live.Omitted = name;
        var ex = Assert.Throws<BridgeException>(() => Read(saved, pou));
        Assert.Contains($"no {name} property", ex.Message);
    }

    /// <summary>A <c>readonly</c> one is unmeasured — never seen, not under an excluded folder or POU either — and refused by
    /// name rather than read as the object's own value.</summary>
    [Fact]
    public void A_read_only_build_property_is_refused_by_name()
    {
        using var saved = new Saved(SubType);
        var pou = new Pou(saved.File, "False");
        pou.Live.ReadOnly = "LinkAlways";
        var ex = Assert.Throws<BridgeException>(() => Read(saved, pou));
        Assert.Contains("LinkAlways", ex.Message);
        Assert.Contains("read-only", ex.Message);
    }

    // ── the push ─────────────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void The_pre_flight_admits_the_three_lines_on_an_item_and_a_member() =>
        new BeckhoffDriver(new TcObjectModel()).ValidateProperties("'FB_X'",
            ObjectProperties.None with { LinkAlways = true, External = true, CompilerDefines = "SIM" }, create: true);

    /// <summary>A push writes each property that differs through a <c>ConsumeXml</c> of that one property, and reads it
    /// back; an unchanged one is not written; removing the lines clears them.</summary>
    [Fact]
    public void A_push_writes_each_changed_property_and_its_removal_clears_it()
    {
        using var saved = SavedGvl("");
        var gvl = Gvl(saved);
        var driver = BoundDriver(saved.Project);
        var pulled = driver.ReadContent(TcRefs.Ref(gvl));

        driver.WriteContent(TcRefs.Ref(gvl), pulled, Array.Empty<PushedNetworkBody>());
        Assert.Empty(gvl.Consumes);

        var set = ObjectProperties.None with { LinkAlways = true, External = true, CompilerDefines = "SIM, X:=2" };
        driver.WriteContent(TcRefs.Ref(gvl), pulled with { Properties = set }, Array.Empty<PushedNetworkBody>());
        Assert.Equal(("True", "True", "SIM, X:=2"), (gvl.Live.LinkAlways, gvl.Live.External, gvl.Live.CompilerDefines));
        Assert.Equal(new[] { "LinkAlways", "External", "CompilerDefines" }, gvl.Live.Written);
        Assert.Equal(set, driver.ReadContent(TcRefs.Ref(gvl)).Properties);

        driver.WriteContent(TcRefs.Ref(gvl), pulled, Array.Empty<PushedNetworkBody>());
        Assert.Equal(("False", "False", ""), (gvl.Live.LinkAlways, gvl.Live.External, gvl.Live.CompilerDefines));
        Assert.Equal(6, gvl.Consumes.Count);
    }

    /// <summary>A member's property is written on the member's own node, and only there.</summary>
    [Fact]
    public void A_pushed_member_property_is_written_on_the_member()
    {
        using var saved = new Saved(SubType);
        var run = new TcExclusionTests.Member("Run", ItemKind.PlcMethod, "METHOD Run : BOOL", "False");
        var pou = new Pou(saved.File, "False", run);
        var driver = BoundDriver(saved.Project);
        var pulled = driver.ReadContent(TcRefs.Ref(pou));

        driver.WriteContent(TcRefs.Ref(pou), pulled with
        {
            Members = new List<Volt.Engine.Item.Member> { pulled.Members[0] with { Properties = ObjectProperties.None with { LinkAlways = true } } },
        }, Array.Empty<PushedNetworkBody>());

        Assert.Equal("True", run.Live.LinkAlways);
        Assert.Equal(new[] { "LinkAlways" }, run.Live.Written);
        Assert.Empty(pou.Consumes);
    }

    /// <summary>A write the IDE accepts and does not apply is refused by name, never reported as landed.</summary>
    [Fact]
    public void A_write_the_IDE_does_not_apply_is_refused_by_name()
    {
        using var saved = SavedGvl("");
        var gvl = Gvl(saved);
        var driver = BoundDriver(saved.Project);
        var pulled = driver.ReadContent(TcRefs.Ref(gvl));
        gvl.Live.Inert = true;

        var ex = Assert.Throws<BridgeException>(() => driver.WriteContent(TcRefs.Ref(gvl),
            pulled with { Properties = ObjectProperties.None with { LinkAlways = true } }, Array.Empty<PushedNetworkBody>()));
        Assert.Contains("LinkAlways", ex.Message);
        Assert.Contains("did not land", ex.Message);
    }
}
