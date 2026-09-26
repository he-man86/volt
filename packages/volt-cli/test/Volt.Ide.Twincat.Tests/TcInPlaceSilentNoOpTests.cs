using System;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// AN EDIT THE IN-PLACE WRITER CANNOT MAKE IS REFUSED, NEVER SWALLOWED.
///
/// <para>The in-place writer answers null for "nothing to write", and the driver then writes nothing and the push
/// reports success. So a model the text changed must either reach the archive or be refused (a
/// <see cref="NotSupportedException"/>, which sends the network to the IDE to rebuild). A null for a changed model is
/// the worst answer there is: the IDE keeps the old program and the next pull reverts the engineer's file.</para>
///
/// <para>Each case below is a model the text reads differently from the pulled one, over a vendor-written archive.</para>
/// </summary>
public class TcInPlaceSilentNoOpTests
{
    private static string Body(string fixture) =>
        XDocument.Parse(Fixtures.Pou(fixture), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting);

    private static XElement Impl(string body) =>
        XElement.Parse(body, LoadOptions.PreserveWhitespace)
            .DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");

    /// <summary>Pull <paramref name="fixture"/>, apply <paramref name="edit"/> to its text, and read the result back
    /// through the push's gate — asserting the edit really changed the text, so the premise cannot pass vacuously.</summary>
    private static (string Before, NetworkBody Model) Edited(string fixture, BodyLanguage language, string from, string to)
    {
        var before = Body(fixture);
        var pulled = TcNetworkReader.Read(Impl(before), language);
        var text = TcText.Write(pulled);
        Assert.Contains(from, text);
        var model = TcText.Validate(text.Replace(from, to), TcText.ScopeOf(pulled));
        Assert.NotEqual(TextOf(pulled), TextOf(model));
        return (before, model);
    }

    private static string TextOf(NetworkBody b) => TcText.Write(b);

    /// <summary>A multi-output assign turned into an explicit wire is another model — a Demux and two assigns where the
    /// archive holds one assign with two outputs — and v2 spells the two differently. Folding the wire back into the
    /// archive's one assign made the shapes agree, found no value change, and returned null: the Demux never reached
    /// the IDE.</summary>
    [Fact]
    public void A_multi_output_assign_rewritten_as_a_wire_is_not_swallowed()
    {
        var (before, model) = Edited("MultiOutput.derived.TcPOU", BodyLanguage.Ld,
            "  xoutput :=\n  xoutput2 := (xtest OR xtest2);",
            "  VAR_TEMP g1 : BOOL; END_VAR\n  g1 := (xtest OR xtest2);\n  xoutput := g1;\n  xoutput2 := g1;");

        Assert.Throws<NotSupportedException>(() => TcText.Apply(before, model));
    }

    /// <summary>`.ENO` on a consumed call moves its consumer from the main output (Q) to the ENO — a connection and an
    /// ENO fact the text carries (task 3.10). The in-place write compared neither, so it wrote nothing.</summary>
    [Theory]
    [InlineData("execute-box.TcPOU", BodyLanguage.Fbd, "output := t1(IN := TRUE, PT := T#5s);", "output := t1(IN := TRUE, PT := T#5s).ENO;")]
    [InlineData("ladder-demux.TcPOU", BodyLanguage.Ld, "output := t1(IN := in1, PT := e1);", "output := t1(IN := in1, PT := e1).ENO;")]
    public void A_consumer_moved_to_the_ENO_output_is_not_swallowed(string fixture, BodyLanguage language, string from, string to)
    {
        var (before, model) = Edited(fixture, language, from, to);

        // ThrowsAny: the refusal is the named ENO one (TcEnoRefusal, a NotSupportedException), task 4.2.
        Assert.ThrowsAny<NotSupportedException>(() => TcText.Apply(before, model));
    }
}
