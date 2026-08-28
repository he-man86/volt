using System.IO;
using Xunit;
using Volt.Engine.Item;
using Volt.Engine.PlcOpen;
using Volt.Engine.Library;
using Volt.Engine.Format.Body;

namespace Volt.Cli.Tests;

/// <summary>
/// The DECLARATION-ONLY kinds — DUT (struct / enum / alias / union) and GVL. They take the same single-document
/// write as a POU, with two fields of the parsed record simply empty: no body, no members.
/// <para><b>Four root element names, not one</b>, and the split is the TC6 schema's rather than a vendor whim.
/// A struct, an enum and an alias are all a <c>baseType</c>, so all three are <c>&lt;dataType&gt;</c> under
/// <c>types/dataTypes</c>. A UNION has no TC6 equivalent, so CODESYS emits it in its own <c>addData</c> block as
/// <c>&lt;union&gt;</c> — the same treatment CFC gets, for the same reason. A GVL likewise.</para>
/// <para>Every fixture here is a LIVE CODESYS 3.5.21.40 export. The union one exists because "a union is a DUT
/// so it is a dataType" was inferred and was wrong: a union push failed with "document has no &lt;pou&gt;,
/// &lt;Interface&gt;, &lt;dataType&gt; or &lt;globalVars&gt;" on the live gate, having passed every offline test.</para>
/// </summary>
public class DeclarationOnlyDocumentTests
{
    private static string Fixture(string file) =>
        File.ReadAllText(Path.Combine(System.AppContext.BaseDirectory, "fixtures", "codesys-decl", file));

    /// <summary>`selfNaming` is a real difference, not test bookkeeping: a DUT's source NAMES itself
    /// (<c>TYPE X :</c>), so a rename has to rewrite the text — whereas a GVL's is just
    /// <c>VAR_GLOBAL … END_VAR</c> and its name lives only on the object.</summary>
    [Theory]
    [InlineData("DUT.plcopen.xml", "DUT", true)]                    // struct → <dataType>
    [InlineData("eenum.plcopen.xml", "eenum", true)]                // enum   → <dataType>
    [InlineData("VltProbeAlias.plcopen.xml", "VltProbeAlias", true)]// alias  → <dataType>
    [InlineData("VltProbeUnion.plcopen.xml", "VltProbeUnion", true)]// union  → <union>, its OWN addData block
    [InlineData("GVL.plcopen.xml", "GVL", false)]                   // gvl    → <globalVars>, its own addData block
    public void A_every_declaration_only_shape_parses_with_no_body_and_no_members(string file, string name, bool selfNaming)
    {
        var parsed = PouReader.Parse(Fixture(file));

        Assert.Null(parsed.BodyElement);
        Assert.Empty(parsed.Children);
        Assert.Empty(parsed.Properties);
        Assert.NotNull(parsed.Declaration);
        if (selfNaming) Assert.Contains(name, parsed.Declaration);
        else Assert.Contains("VAR_GLOBAL", parsed.Declaration);
    }

    // B asserted that a declaration edit travels the DOCUMENT for each of these shapes. These kinds joined the
    // document FOR that write — it replaced a WriteText — and the stated value was that "there is no longer a
    // second transport to keep in step with this one".
    //
    // That goal is intact; the transport it settled on was wrong. The document's declaration carrier is an
    // OPTIONAL vendor addData block, and TwinCAT stopped emitting it — so the single transport is now the
    // declaration aspect, uniformly, for these kinds AND for POUs. Still one transport, on the side a
    // conforming processor may not drop. Asserted in PushDeclarationTransportTests.

    /// <summary>Pushing CODE to a kind that has nowhere to put it FAILS, rather than being dropped. The empty
    /// case is the ordinary one and writes nothing — the two are different requests, and only one of them is
    /// unsatisfiable, so only one of them throws.</summary>
    [Fact]
    public void C_code_pushed_to_a_bodiless_kind_is_refused_not_discarded()
    {
        var ex = Assert.Throws<System.InvalidOperationException>(() =>
            PouSplice.SetBody(Fixture("DUT.plcopen.xml"), "DUT", "n := 1;", null, establishing: false));

        Assert.Contains("no <body>", ex.Message);
        Assert.Equal(Fixture("DUT.plcopen.xml"), PouSplice.SetBody(Fixture("DUT.plcopen.xml"), "DUT", "", null, establishing: false));
    }
}
