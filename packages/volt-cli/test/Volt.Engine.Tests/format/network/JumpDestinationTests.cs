using System.Linq;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Engine.Tests.Format.Network;

/// <summary>
/// A JUMP'S DESTINATION IS THE TARGET CARRYING THE JUMP BIT — not whichever the archive listed first.
///
/// <para>A rung may drive more than one target, and a coil beside a jump off the same wire is an ordinary
/// ladder shape. The flag lives on the TARGET OPERAND as well as on the item (DIALECT C13, and on CODESYS the
/// operand is the ONLY place it appears for a jump an engineer drew), so "which target is the label" is a
/// question with a real answer — and <c>Goto</c> answered it with <c>Targets[0]</c>.</para>
///
/// <para><b>Found by a body drawn by hand in a live XAE</b>
/// (<c>Volt.Ide.Twincat.Tests/fixtures/tc-pou/drawn-refused-shapes.TcPOU</c>), whose rung drives the jump
/// destination <c>owrods</c> and the coil <c>out</c> from one terminator. Volt cannot CREATE that shape, so no
/// generated fixture had ever held one and nothing in the suite could have produced it. There the jump happens
/// to be first, so the symptom was merely a dropped coil; with the coil first the same code renders
/// <c>JMP out;</c> — a jump to a label that does not exist.</para>
///
/// <para>The dropped coil itself is a FORMAT gap (network text has no spelling for a rung whose targets are a
/// mixture) and is tracked in <c>openspec/changes/graphical-vendor-parity-map</c>, task 1. Naming the right
/// destination is correct on its own.</para>
/// </summary>
public class JumpDestinationTests
{
    /// <summary>A rung driving `first` then `second`, with the jump bit on whichever is named.</summary>
    private static string Render(string first, string second, string jumpOn)
    {
        var targets = new[] { first, second }
            .Select(n => new Operand(n, IsLValue: true,
                                     Flags: n == jumpOn ? new Flags(Jump: true) : Flags.None))
            .ToArray();

        var body = new NetworkBody(BodyLanguage.Ld, new[]
        {
            new Volt.Engine.Format.Network.Network(0, null, null, null, false, new Node[]
            {
                // An UNCONNECTED terminator is how the model spells "nothing drives this", which is what makes
                // the jump unconditional — the shape the archive actually holds.
                new Assign(new Terminator(null, Flags.None), targets, new Flags(Jump: true)),
            }),
        });

        return NetworkTextWriter.Write(body);
    }

    [Theory]
    [InlineData("Onwards", "out", "Onwards")]   // the label first — the drawn body's order
    [InlineData("out", "Onwards", "Onwards")]   // …and the other way round, which is where it went wrong
    public void The_rendered_jump_names_the_flagged_target(string first, string second, string label)
    {
        var text = Render(first, second, label);

        Assert.Contains("JMP " + label, text);
        Assert.DoesNotContain("JMP " + (label == first ? second : first), text);
    }
}
