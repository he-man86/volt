using System;
using Volt.Engine.Item;
using Xunit;
using static Volt.Engine.Tests.OneToOne.OneToOneSteps;

namespace Volt.Engine.Tests.OneToOne;

/// <summary>
/// FINDING 8 — GUESSES AND FALLBACKS, the ENGINE's (openspec <c>bridge-one-to-one</c> proposal 8, design §1.1 "Refused
/// by name, collected", §2.2). The drivers' fallbacks (a missing aspect read as <c>""</c>, <c>Guid.Empty</c>, GET/SET
/// by name, a whitespace body read as none, the library and task defaults) are pinned in the drivers' suites
/// (<c>CodesysFallbackRefusalTests</c>, <c>TcFallbackRefusalTests</c>).
///
/// <para>Red until 3.5 (every fallback deleted — refused or spelled).</para>
/// </summary>
public class FallbackRefusalTests
{
    private const string Task = "3.5";

    /// <summary>The END line is not guessed: a POU whose declaration opens with none of PROGRAM / FUNCTION_BLOCK /
    /// FUNCTION (an empty or prose text) pulled with an invented <c>END_FUNCTION_BLOCK</c>
    /// (<c>StWriter.FallbackPouHeader</c>). The design deletes the fallback: the pull refuses the item by name, naming
    /// the missing header — it never writes a line the IDE does not hold.</summary>
    [Theory]
    [InlineData("")]
    [InlineData("// a POU whose text declares nothing\n")]
    public void A_pou_with_no_header_is_refused_by_name_never_given_an_invented_end_line(string decl)
    {
        var ide = new FakeIde(new FakeIde.Item("P_NoHeader", ItemKind.PlcPou, "", true, decl, "x := 1;", null, null));
        var ex = Assert.ThrowsAny<Exception>(() => Read(ide, "P_NoHeader", ItemKind.Kinds.Pou));
        Assert.Contains("P_NoHeader", ex.Message);
    }

    /// <summary><c>AbstractMemberFold</c> NARROWED (§1.1 classes, gate 1): a whitespace-only body stored in an abstract
    /// method's ST slot is stored characters, spelled verbatim under <c>IMPLEMENTATION ST</c> — never folded to
    /// <c>IMPLEMENTATION NONE</c>, which erases them. (A null or EMPTY body stays NONE: the measured equivalence.)</summary>
    [Fact]
    public void An_abstract_methods_whitespace_body_is_spelled_not_folded_to_none()
    {
        var ide = new FakeIde(
            new FakeIde.Item("FB_Base", ItemKind.PlcPou, "", true, "FUNCTION_BLOCK ABSTRACT FB_Base\nVAR\nEND_VAR", ";", null, null,
                             Children: new[] { "Run" }),
            new FakeIde.Item("Run", ItemKind.PlcMethod, "", false, "METHOD ABSTRACT Run : BOOL", "\n\n", null, null));
        var text = Pulled(ide, "FB_Base.pou");
        var block = text.Substring(text.IndexOf("METHOD ABSTRACT Run", StringComparison.Ordinal));
        Assert.Equal("IMPLEMENTATION ST", After(block, "METHOD ABSTRACT Run : BOOL", 1)[0]);
    }

    /// <summary>GREEN today, and it must stay green: the measured equivalence (<c>abstract-member-equivalence</c>) — an
    /// abstract method with an EMPTY body pulls <c>IMPLEMENTATION NONE</c>, whichever class holds it.</summary>
    [Fact]
    public void An_abstract_methods_empty_body_still_pulls_as_none()
    {
        var ide = new FakeIde(
            new FakeIde.Item("FB_Base", ItemKind.PlcPou, "", true, "FUNCTION_BLOCK ABSTRACT FB_Base\nVAR\nEND_VAR", ";", null, null,
                             Children: new[] { "Run" }),
            new FakeIde.Item("Run", ItemKind.PlcMethod, "", false, "METHOD ABSTRACT Run : BOOL", "", null, null));
        var text = Pulled(ide, "FB_Base.pou");
        var block = text.Substring(text.IndexOf("METHOD ABSTRACT Run", StringComparison.Ordinal));
        Assert.Equal("IMPLEMENTATION NONE", After(block, "METHOD ABSTRACT Run : BOOL", 1)[0]);
    }
}
