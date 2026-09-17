using System.Globalization;
using System.Linq;
using System.Threading;
using Volt.Contracts;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A MEMBER'S SIGNATURE LINE — the last declaration text Volt reads, and the only one it cannot stop reading.
///
/// <para>The kind comes from the wire name's extension and the decl/impl boundary is stated by
/// <c>ImplementationMarker</c>; both could be taken out of the text because a FILE carries them. A method is
/// not a file — it lives inside its POU's, as a method lives inside its class in every other language — so its
/// name exists in exactly one place. There is no second source for it to disagree with, which is precisely what
/// made taking the KIND from the text dangerous and makes taking the NAME from here safe.</para>
///
/// <para><b>It was two regexes.</b> They were swept against both customer corpora before being replaced —
/// 57,190 signature lines, zero disagreements — so what follows is not a behaviour change on any real file. It
/// is the two hazards a pattern could not spell, plus the shapes those corpora actually ship.</para>
/// </summary>
public class SignatureParseTests
{
    private static Member Only(string signature, string body = "x := 1;") =>
        StReader.Read(
            "FUNCTION_BLOCK FB_S\nVAR\nEND_VAR\n" + ImplementationMarker.Text + "\nEND_FUNCTION_BLOCK\n\n" +
            signature + "\n" + ImplementationMarker.Text + "\n" + body + "\n" + EndOf(signature) + "\n")
        .Members.Single();

    private static string EndOf(string signature) =>
        signature.StartsWith("ACTION") ? "END_ACTION" : "END_METHOD";

    private static BridgeException Refused(string signature, string body = "x := 1;") =>
        Assert.Throws<BridgeException>(() => Only(signature, body));

    /// <summary>HAZARD ONE: <c>\w</c> IS UNICODE IN .NET. `METHOD Ünit` matched, and `Ünit` then became the
    /// name Volt asks <c>CreateChild</c> for — an object CODESYS will not create, so the failure landed in the
    /// middle of a write instead of before it. An IEC identifier is ASCII.</summary>
    [Theory]
    [InlineData("METHOD Ünit")]
    [InlineData("METHOD Привет")]
    [InlineData("METHOD 2Fast")]
    [InlineData("METHOD My-Name")]
    public void A_name_the_vendor_would_refuse_is_refused_here_first(string signature)
    {
        Assert.Contains("not a valid IEC identifier", Refused(signature).Message);
    }

    [Theory]
    [InlineData("METHOD Run")]
    [InlineData("METHOD _leadingUnderscore")]
    [InlineData("METHOD With9Digits")]
    public void An_ordinary_identifier_still_parses(string signature)
    {
        Assert.Equal(signature.Substring("METHOD ".Length), Only(signature).Name);
    }

    /// <summary>HAZARD TWO: <c>RegexOptions.IgnoreCase</c> WITHOUT <c>CultureInvariant</c> folds case against
    /// the CURRENT culture. Turkish maps `I` to `ı`, not `i`, so under tr-TR a lower-case `method` stopped
    /// matching the pattern `METHOD` and the member could not be pushed at all. Every comparison here is
    /// Ordinal, so the culture cannot reach it.</summary>
    [Fact]
    public void A_lower_case_keyword_parses_under_a_Turkish_culture()
    {
        var was = Thread.CurrentThread.CurrentCulture;
        try
        {
            Thread.CurrentThread.CurrentCulture = new CultureInfo("tr-TR");
            Assert.Equal("Run", Only("method public Run : INT").Name);
            Assert.Equal("INT", Only("method public Run : INT").ReturnType);
        }
        finally { Thread.CurrentThread.CurrentCulture = was; }
    }

    /// <summary>A TRAILING SEMICOLON is punctuation, not part of the type — `METHOD PRIVATE CheckValidRefs :
    /// BOOL;` is pro2193, as CODESYS wrote it.</summary>
    [Fact]
    public void A_trailing_semicolon_is_not_part_of_the_type()
    {
        var m = Only("METHOD PRIVATE CheckValidRefs : BOOL;");
        Assert.Equal("CheckValidRefs", m.Name);
        Assert.Equal("BOOL", m.ReturnType);
    }

    /// <summary>The type is taken WHOLE and unexamined. `ARRAY[0..GVL_Constants.MaxRejectReasonsCamera] OF
    /// BOOL` ships in pro2193 twice; splitting or validating it here would only invent a second opinion about
    /// a type the IDE already owns.</summary>
    [Fact]
    public void A_compound_type_arrives_intact()
    {
        Assert.Equal("ARRAY[0..GVL_Constants.MaxRejectReasonsCamera] OF BOOL",
            Only("METHOD Results : ARRAY[0..GVL_Constants.MaxRejectReasonsCamera] OF BOOL;").ReturnType);
    }

    /// <summary>A trailing comment — 207 of pro2193's method signatures carry one, and anchoring at `$` used to
    /// refuse every one of them, so the POU could be pulled and never pushed back.</summary>
    [Fact]
    public void A_documented_signature_still_parses()
    {
        var m = Only("METHOD INTERNAL _mStrConcatA //Concats string to sContent");
        Assert.Equal("_mStrConcatA", m.Name);
        Assert.Null(m.ReturnType);
    }

    /// <summary>AN ACTION HAS NO RETURN TYPE — it is a named body sharing the POU's variables. A `:` here is a
    /// method signature under the wrong keyword; taking the name and dropping the rest would write an action
    /// the IDE cannot then call.</summary>
    [Fact]
    public void An_action_with_a_return_type_is_refused()
    {
        Assert.Contains("an action has no return type", Refused("ACTION Go : INT").Message);
    }

    /// <summary>And a property's type is MANDATORY where a method's is optional — the one real difference
    /// between the two lines.</summary>
    [Fact]
    public void A_property_without_a_type_is_refused()
    {
        var ex = Assert.Throws<BridgeException>(() => StReader.Read(
            "FUNCTION_BLOCK FB_S\nVAR\nEND_VAR\n" + ImplementationMarker.Text + "\nEND_FUNCTION_BLOCK\n\n" +
            "PROPERTY Ready\nGET\n" + ImplementationMarker.Text + "\nReady := TRUE;\nEND_GET\nEND_PROPERTY\n"));
        Assert.Contains("must declare a type", ex.Message);
    }

    /// <summary>A word between the keyword and the name that is not an access modifier is a MALFORMED line,
    /// not a second name to choose from. The old pattern reached the same verdict; this one says why.</summary>
    [Fact]
    public void An_unknown_word_before_the_name_is_refused()
    {
        Assert.Contains("'STATIC' is not an access modifier", Refused("METHOD STATIC Run : INT").Message);
    }

    [Fact]
    public void A_bare_keyword_is_refused()
    {
        Assert.Contains("does not begin with 'METHOD' and a name", Refused("METHOD").Message);
        Assert.Contains("nothing follows the ':'", Refused("METHOD Run :").Message);
    }

    /// <summary>Every modifier CODESYS allows, on the line that used to allow four of them.</summary>
    [Theory]
    [InlineData("PUBLIC")]
    [InlineData("PRIVATE")]
    [InlineData("PROTECTED")]
    [InlineData("INTERNAL")]
    [InlineData("FINAL")]
    [InlineData("ABSTRACT")]
    public void Every_access_modifier_is_accepted_on_a_method(string modifier)
    {
        Assert.Equal("Run", Only($"METHOD {modifier} Run : INT").Name);
    }
}
