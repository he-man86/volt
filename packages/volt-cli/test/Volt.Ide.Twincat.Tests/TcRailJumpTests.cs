using System.IO;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// TWINCAT'S UNCONDITIONAL JUMP AND RETURN hold the EMPTY OPERAND where CODESYS holds the rail (its importer's documents,
/// <c>Vn_jump_uncond</c> / <c>Vn_return_uncond</c>). One fact, two vendor forms, mapped below the seam (openspec
/// network-rail-and-pin-negation): the reader reads it as the rail, so the text is <c>JMP.l := RAIL();</c> on both vendors,
/// and the writer keeps the archive's operand, so a push of that text unchanged changes nothing.
/// </summary>
public class TcRailJumpTests
{
    private static string Nwl(string shape) =>
        File.ReadAllText(Path.Combine(TcNativeCorpusTests.Dir, "import", $"Vn_{shape}.nwl.xml"));

    private static XElement Impl(string nwl) =>
        XElement.Parse(nwl, LoadOptions.PreserveWhitespace).DescendantsAndSelf("o")
            .First(o => (string?)o.Attribute("t") == "NWLImplementationObject");

    [Theory]
    [InlineData("jump_uncond", "JMP.L1 := RAIL();")]
    [InlineData("return_uncond", "RETURN := RAIL();")]
    public void The_empty_operand_of_an_unconditional_jump_is_read_as_the_rail_and_kept_on_push(string shape, string line)
    {
        var nwl = Nwl(shape);
        var pulled = TcNetworkReader.Read(Impl(nwl), BodyLanguage.Fbd);

        var control = pulled.Networks.SelectMany(n => n.Trees).OfType<Assign>().Single(a => a.Flags.Jump || a.Flags.Return);
        Assert.IsType<Terminator>(control.Value);
        var text = TcText.Write(pulled);
        Assert.Contains("\n" + line + "\n", text);
        Assert.Null(TcText.Apply(nwl, TcText.Validate(text, TcText.ScopeOf(pulled))));
    }

    /// <summary>An empty operand under a COIL is no rail: only an item whose every target is a jump or a return maps.</summary>
    [Fact]
    public void Only_a_jump_or_a_return_maps_the_empty_operand()
    {
        var empty = new Leaf(new Operand(""), Flags.None);
        Assert.True(TcNetworkReader.IsRailJump(new[] { new Operand("l", IsLValue: true, Flags: Flags.None with { Jump = true }) }, empty));
        Assert.False(TcNetworkReader.IsRailJump(new[] { new Operand("x", IsLValue: true) }, empty));
        Assert.False(TcNetworkReader.IsRailJump(
            new[] { new Operand("x", IsLValue: true), new Operand("l", IsLValue: true, Flags: Flags.None with { Jump = true }) }, empty));
    }
}
