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
            "FUNCTION_BLOCK FB_S\nVAR\nEND_VAR\n" + ImplementationMarker.For(Volt.Engine.Format.Body.Languages.St) + "\nEND_FUNCTION_BLOCK\n\n" +
            signature + "\n" + ImplementationMarker.For(Volt.Engine.Format.Body.Languages.St) + "\n" + body + "\n" + EndOf(signature) + "\n",
            ItemKind.Kinds.Pou)
        .Members.Single();

    private static string EndOf(string signature) =>
        signature.StartsWith("ACTION") ? "END_ACTION" : "END_METHOD";

    private static BridgeException Refused(string signature, string body = "x := 1;") =>
        Assert.Throws<BridgeException>(() => Only(signature, body));

    /// <summary>THE NAME IS READ AS WRITTEN; WHETHER THE IDE TAKES IT IS THE DRIVER'S MEASURED ANSWER (openspec
    /// bridge-refusal-review 3.1). This reader refused a name that was no ASCII identifier ("not a valid IEC
    /// identifier", <c>IsIdentifier</c>) on the belief, never measured, that the vendor would not create it. Measured
    /// since: both vendors refuse every such shape themselves with their name refusal, and CODESYS CREATES a
    /// backtick-quoted name the check refused (<c>scripts/identifier-names.log</c>, <c>tc-refusal-measure-names.log</c>).
    /// The pre-flight asks the driver (<c>ICodeStore.RefusedName</c>), so the batch still stops before its first write.
    /// (The premise of the test this replaces — the reader judges the name — was the unmeasured belief.)</summary>
    [Theory]
    [InlineData("METHOD Ünit", "Ünit")]
    [InlineData("METHOD Привет", "Привет")]
    [InlineData("METHOD 2Fast", "2Fast")]
    [InlineData("METHOD My-Name", "My-Name")]
    [InlineData("METHOD `quoted`", "`quoted`")]
    public void A_name_is_read_as_written_and_left_to_the_vendor(string signature, string name)
    {
        Assert.Equal(name, Only(signature).Name);
    }

    /// <summary>A BACKTICK-QUOTED NAME IS ONE NAME, whatever stands between the backticks (review 3a+3b). CODESYS creates
    /// <c>`a b`</c> for all six kinds and builds it clean (<c>identifier-names.log</c>, "backtick, space inside"); the
    /// reader split the line at the space and refused it, INVALID_ST "'`a' is not an access modifier" — a CODESYS
    /// member that could be pulled and never pushed back. A colon inside the backticks is the name's too, not the start
    /// of the type.</summary>
    [Theory]
    [InlineData("METHOD `a b` : INT", "`a b`", "INT")]
    [InlineData("METHOD PUBLIC `a\tb` : INT", "`a\tb`", "INT")]
    [InlineData("METHOD `a:b` : INT", "`a:b`", "INT")]
    [InlineData("METHOD `a b`", "`a b`", null)]
    [InlineData("METHOD `a`b : BOOL", "`a`b", "BOOL")]
    public void A_backtick_quoted_name_is_one_name(string signature, string name, string? type)
    {
        var m = Only(signature);
        Assert.Equal(name, m.Name);
        Assert.Equal(type, m.ReturnType);
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

    /// <summary>AN ACTION'S LINE IS COMPOSED, NOT STORED (openspec <c>bridge-refusal-review</c> D10): CODESYS writes an
    /// action no declaration and TwinCAT composes <c>ACTION &lt;name&gt;</c>, so anything else on the line — a modifier, a
    /// comment, a semicolon — was dropped without a word (a modifier was accepted and lost). Refused by name; measured on
    /// 0 of 46 corpus action lines.</summary>
    [Theory]
    [InlineData("ACTION PUBLIC Go")]
    [InlineData("ACTION Go // runs the step")]
    [InlineData("ACTION Go (* step *)")]
    [InlineData("ACTION Go;")]
    public void An_action_line_holding_anything_besides_its_name_is_refused(string signature)
    {
        var ex = Refused(signature, "");
        Assert.Equal(BridgeErrorCodes.InvalidSt, ex.ErrorCode);
        Assert.Contains("an action has no declaration the IDE stores — its line is 'ACTION Go'", ex.Message);
    }

    /// <summary>…while the keyword and a name, in any case and spacing, is the line the IDE composes.</summary>
    [Theory]
    [InlineData("ACTION Go")]
    [InlineData("ACTION   Go")]
    [InlineData("ACTION\tGo")]
    public void An_action_line_with_its_name_alone_is_read(string signature) =>
        Assert.Equal("Go", Only(signature, "").Name);

    /// <summary>A POU PROPERTY WITH NO TYPE IS WRITTEN AS SENT (openspec <c>bridge-refusal-review</c> 2.6): its
    /// declaration is written verbatim and the IDE's build reports the missing type. It used to be refused here, "a
    /// property must declare a type" — the build's error, made the push's. (A TwinCAT INTERFACE property takes its type
    /// as the create argument; that driver refuses one with none, by name.)</summary>
    [Fact]
    public void A_property_without_a_type_is_read_with_no_type()
    {
        var m = StReader.Read(
            "FUNCTION_BLOCK FB_S\nVAR\nEND_VAR\n" + ImplementationMarker.For(Volt.Engine.Format.Body.Languages.St) + "\nEND_FUNCTION_BLOCK\n\n" +
            "PROPERTY Ready\nGET\n" + ImplementationMarker.For(Volt.Engine.Format.Body.Languages.St) + "\nReady := TRUE;\nEND_GET\nEND_PROPERTY\n",
            ItemKind.Kinds.Pou).Members.Single();
        Assert.Equal("Ready", m.Name);
        Assert.Null(m.DataType);
        Assert.Equal("PROPERTY Ready", m.Declaration);
    }

    /// <summary>THE NAME IS THE LAST WORD BEFORE THE COLON (openspec <c>bridge-refusal-review</c> D10), and the words
    /// between the keyword and it are not read: Volt holds no modifier vocabulary. A word the IDE does not take there is
    /// its build's to report (<c>sig_unknown_word</c>, recorded on both vendors), and a modifier typo keeps the member's
    /// identity. These rows were refused ("'STATIC' is not an access modifier"); their premise was the vocabulary this
    /// step removed.</summary>
    [Theory]
    [InlineData("METHOD STATIC Run : INT", "Run", "INT")]
    [InlineData("METHOD FOO Run : INT", "Run", "INT")]
    [InlineData("METHOD PUBLIK Run", "Run", null)]
    [InlineData("METHOD PUBLC Run : BOOL", "Run", "BOOL")]
    public void A_word_before_the_name_is_not_read(string signature, string name, string? type)
    {
        var m = Only(signature);
        Assert.Equal(name, m.Name);
        Assert.Equal(type, m.ReturnType);
    }

    /// <summary>A word AFTER the name the member had is its new name: <c>METHOD Run Walk : BOOL</c> is the method
    /// <c>Walk</c> — a member renamed by its header, as every header rename is (the reconciler deletes and creates), and
    /// the stray word is the build's to report.</summary>
    [Fact]
    public void The_last_word_before_the_colon_is_the_name()
    {
        var m = Only("METHOD Run Walk : BOOL");
        Assert.Equal("Walk", m.Name);
        Assert.Equal("BOOL", m.ReturnType);
    }

    /// <summary>NOTHING AFTER THE COLON IS THE BUILD'S DECLARATION ERROR (2.4), so the line is written as sent and the
    /// member carries an empty type. (TwinCAT's interface-member create needs the type as its create argument, so its
    /// driver refuses an interface member with none, by name.)</summary>
    [Fact]
    public void Nothing_after_the_colon_is_read_as_an_empty_type()
    {
        var m = Only("METHOD Run :");
        Assert.Equal("Run", m.Name);
        Assert.Equal("", m.ReturnType);
    }

    /// <summary>A line with no name at all has no identity to create: still refused.</summary>
    [Fact]
    public void A_bare_keyword_is_refused()
    {
        Assert.Contains("does not begin with 'METHOD' and a name", Refused("METHOD").Message);
        Assert.Contains("does not begin with 'METHOD' and a name", Refused("METHOD : INT").Message);
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
