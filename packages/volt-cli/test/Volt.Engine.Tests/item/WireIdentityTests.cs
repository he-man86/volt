using Xunit;
using Volt.Engine.Item;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// THE WIRE NAME AND ITS INVERSE — the seam that cost a real customer project a push.
///
/// <para>The protocol is keyed by the item NAME, and two spellings of that name exist with an exact boundary
/// between them: BELOW the vendor seam the name is BARE (the IDE's own lookup key, which has no extension), and
/// ON THE WIRE it is FULL — <c>name.kind</c>, e.g. <c>CM_Carrier.fb</c>. <c>Materializer.FullWireName</c>
/// derives one; <c>Materializer.Bare</c> inverts it. Nothing tested either.</para>
///
/// <para><b>The bug this pins is not hypothetical.</b> The wire's maps were once keyed by the BARE name, on the
/// reasoning that IEC guarantees unique names. It does not — it guarantees them WITHIN A KIND. A control module
/// and the visualization that draws it are <c>CM_Carrier.fb</c> and <c>CM_Carrier.visualization</c>, and the
/// V71_PackML_Hauzer project ships two such pairs. Collapsed onto one bare slot the walk order picked a winner,
/// so the FB's version was invisible to the aggregate hash (<c>volt pull</c> reported "nothing to pull" over a
/// real edit) and the push's <c>ifVersion</c> gate answered with the VISUALIZATION's hash — the FB could be
/// pulled and never pushed back.</para>
///
/// <para>So these assert the property that made the fix work: the full name SEPARATES two items that share a
/// bare name, and <c>Bare</c> takes each of them back to the key the IDE actually uses.</para>
/// </summary>
public class WireIdentityTests
{
    /// <summary>THE PAIR THAT BROKE IT. Same bare name, different kinds, and they must not collide.</summary>
    [Fact]
    public void Two_kinds_sharing_a_bare_name_get_different_wire_names()
    {
        var fb = Materialize("CM_Carrier", ItemKind.Kinds.FunctionBlock);
        var vis = Materialize("CM_Carrier", ItemKind.Kinds.Visualization);

        Assert.NotEqual(fb, vis);
        Assert.StartsWith("CM_Carrier.", fb);
        Assert.StartsWith("CM_Carrier.", vis);
    }

    /// <summary>AND BOTH INVERT TO THE ONE KEY THE IDE KNOWS. Below the vendor seam there is no extension —
    /// a driver looking up <c>CM_Carrier.fb</c> finds nothing at all.</summary>
    [Fact]
    public void Both_wire_names_invert_to_the_same_bare_name()
    {
        Assert.Equal("CM_Carrier", Materializer.Bare(Materialize("CM_Carrier", ItemKind.Kinds.FunctionBlock)));
        Assert.Equal("CM_Carrier", Materializer.Bare(Materialize("CM_Carrier", ItemKind.Kinds.Visualization)));
    }

    /// <summary>A NAME THAT ALREADY ENDS IN ITS OWN EXTENSION IS NOT DOUBLED. Library refs arrive from the
    /// vendor already spelled <c>Foo.library</c>; appending again gives <c>Foo.library.library</c>, a name no
    /// lookup on either side of the seam resolves.</summary>
    [Fact]
    public void A_name_that_already_carries_its_extension_is_left_alone()
    {
        var once = Materialize("Standard.library", ItemKind.Kinds.Library);

        Assert.Equal("Standard.library", once);
        Assert.DoesNotContain("library.library", once);
    }

    /// <summary>AND THAT CASE STILL INVERTS. `Bare` strips the LAST dot segment, so a verbatim name inverts to
    /// the stem the IDE holds — the round trip is not identity here, and it is not supposed to be.</summary>
    [Fact]
    public void A_verbatim_name_inverts_to_its_stem()
        => Assert.Equal("Standard", Materializer.Bare("Standard.library"));

    /// <summary>A DOTTED NAME KEEPS ITS DOTS. IEC identifiers do not contain dots, but a namespaced library
    /// reference does — and `Bare` must take only the last segment, not split on the first.</summary>
    [Fact]
    public void Only_the_last_segment_is_stripped()
        => Assert.Equal("Tc2_Standard.Blocks", Materializer.Bare("Tc2_Standard.Blocks.fb"));

    /// <summary>A NAME WITH NO EXTENSION SURVIVES INTACT rather than losing its head. `LastIndexOf` returning
    /// -1 must mean "nothing to strip", not "strip everything".</summary>
    [Fact]
    public void A_name_with_no_extension_is_returned_unchanged()
        => Assert.Equal("PLC_PRG", Materializer.Bare("PLC_PRG"));

    /// <summary>AND A LEADING DOT IS NOT AN EXTENSION BOUNDARY. `dot > 0`, not `dot >= 0` — a name beginning
    /// with a dot must not invert to the empty string, which no lookup can use and no error would name.</summary>
    [Fact]
    public void A_leading_dot_does_not_produce_an_empty_key()
        => Assert.Equal(".hidden", Materializer.Bare(".hidden"));

    /// <summary>The full name a wire map is keyed by, taken from a REAL materialization.
    ///
    /// <para>Through <c>Materializer.Materialize</c> — the public path every item actually travels — rather than
    /// the private helper underneath it. Two earlier drafts got this wrong in opposite directions: the first
    /// restated the derivation here, which asserts the copy; the second made the helper public to reach it,
    /// which `NoTestOnlyCodeInSrcTests` correctly rejected as shipped code only a test calls. Going through the
    /// front door is both the honest test and the one that needs no change to src.</para></summary>
    private static string Materialize(string bareName, string kind)
    {
        var ide = new FakeIde(new FakeIde.Item(bareName, Code(kind), "", true,
                                               Declaration(bareName, kind), "", null, null));
        return Materializer.Materialize(ide, bareName, kind, new ItemRef(bareName)).FullName;
    }

    private static int Code(string kind) => kind switch
    {
        ItemKind.Kinds.FunctionBlock => ItemKind.PlcPouFb,
        ItemKind.Kinds.Program => ItemKind.PlcPouProg,
        ItemKind.Kinds.Visualization => ItemKind.PlcVisObj,
        _ => ItemKind.PlcLibRef,
    };

    /// <summary>A declaration the ST writer will accept for this kind — source kinds are assembled from text,
    /// reference kinds carry a manifest instead.</summary>
    private static string Declaration(string name, string kind) => kind switch
    {
        ItemKind.Kinds.FunctionBlock => $"FUNCTION_BLOCK {name}\nVAR\nEND_VAR",
        ItemKind.Kinds.Program => $"PROGRAM {name}\nVAR\nEND_VAR",
        _ => $"LIBRARY {name}\nNAMESPACE {name}\n",
    };
}
