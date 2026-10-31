using System.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Engine.Tests.Format.Network;

/// <summary>
/// A JUMP'S DESTINATION IS THE TARGET CARRYING THE JUMP BIT — and a rung that drives a jump beside a coil is spelled
/// with each coil where it stands, the jump a coil like any other (openspec ld-fbd-coverage 2R.5, awkward-sweep #9: the
/// shape stores, builds and runs on CODESYS SP21).
///
/// <para>A rung may drive more than one target, and a coil beside a jump off the same wire is an ordinary ladder
/// shape. The flag lives on the TARGET OPERAND as well as on the item (DIALECT C13, and on CODESYS the operand is
/// the ONLY place it appears for a jump an engineer drew), so "which target is the label" is a question with a
/// real answer — and v1 answered it with <c>Targets[0]</c>, rendering <c>JMP out;</c>, a jump to a label that
/// does not exist, when the coil came first.</para>
///
/// <para><b>Found by a body drawn by hand in a live XAE</b>
/// (<c>Volt.Ide.Twincat.Tests/fixtures/tc-pou/drawn-refused-shapes.TcPOU</c>), whose rung drives the jump
/// destination <c>owrods</c> and the coil <c>out</c> from one terminator. It was kept on the marker until 2R.5 (no corpus
/// holds the shape); "zero in the corpora is no reason to refuse" (owner, 2026-10-16), so it is written in either order,
/// the label on the target that carries the bit.</para>
/// </summary>
public class JumpDestinationTests
{
    private static NetworkBody Rung(params (string Name, bool Jump)[] targets) =>
        new(BodyLanguage.Ld, new[]
        {
            new Volt.Engine.Format.Network.Network(0, null, null, null, false, new Node[]
            {
                // An UNCONNECTED terminator is how the model spells "nothing drives this", which is what makes
                // the jump unconditional — the shape the archive actually holds.
                new Assign(new Terminator(Flags.None),
                    targets.Select(t => new Operand(t.Name, IsLValue: true,
                                                    Flags: t.Jump ? new Flags(Jump: true) : Flags.None)).ToArray(),
                    new Flags(Jump: true)),
            }),
        });

    [Theory]
    [InlineData(true)]    // the label first — the drawn body's order
    [InlineData(false)]   // …and the other way round, which is where v1 went wrong
    public void A_rung_driving_a_jump_and_a_coil_names_the_label_on_the_flagged_target(bool jumpFirst)
    {
        var body = jumpFirst ? Rung(("Onwards", true), ("out", false)) : Rung(("out", false), ("Onwards", true));

        var text = StNetworkWriter.Write(body, NetworkScope.Empty);

        // one item, its targets in stored order, the jump a target like the coil (network-rail-and-pin-negation), on the rail
        Assert.Contains(jumpFirst ? "\nJMP.Onwards := out := RAIL();\n" : "\nout := JMP.Onwards := RAIL();\n", text);
        var read = StNetworkReader.Read(text, NetworkScope.Empty);
        var item = Assert.IsType<Assign>(Assert.Single(read.Networks[0].Trees));
        Assert.IsType<Terminator>(item.Value);
        Assert.Equal(jumpFirst ? new[] { "Onwards", "out" } : new[] { "out", "Onwards" }, item.Targets.Select(t => t.Text));
        Assert.Equal(new[] { "Onwards" }, item.Targets.Where(t => t.Flags?.Jump == true).Select(t => t.Text));
    }

    [Fact]
    public void A_lone_jump_names_its_flagged_target()
    {
        var text = StNetworkWriter.Write(Rung(("Onwards", true)), NetworkScope.Empty);

        Assert.Contains("\nJMP.Onwards := RAIL();\n", text);
    }
}
