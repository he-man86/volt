using System.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Engine.Tests.Format.Network;

/// <summary>
/// A JUMP'S DESTINATION IS THE TARGET CARRYING THE JUMP BIT — and a rung that drives a jump beside a coil has no
/// spelling at all, so it goes to the marker by name rather than lose either.
///
/// <para>A rung may drive more than one target, and a coil beside a jump off the same wire is an ordinary ladder
/// shape. The flag lives on the TARGET OPERAND as well as on the item (DIALECT C13, and on CODESYS the operand is
/// the ONLY place it appears for a jump an engineer drew), so "which target is the label" is a question with a
/// real answer — and v1 answered it with <c>Targets[0]</c>, rendering <c>JMP out;</c>, a jump to a label that
/// does not exist, when the coil came first.</para>
///
/// <para><b>Found by a body drawn by hand in a live XAE</b>
/// (<c>Volt.Ide.Twincat.Tests/fixtures/tc-pou/drawn-refused-shapes.TcPOU</c>), whose rung drives the jump
/// destination <c>owrods</c> and the coil <c>out</c> from one terminator. Network text v2 keeps it on the marker
/// (spec, "marker-only shapes stay on the existing marker": <c>JMP</c> as an assign target is not ST, and no corpus
/// holds the shape), in either order — the writer's own refusal, which is the pull's marker route (task 3.1).</para>
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
    public void A_rung_driving_a_jump_and_a_coil_goes_to_the_marker_by_name(bool jumpFirst)
    {
        var body = jumpFirst ? Rung(("Onwards", true), ("out", false)) : Rung(("out", false), ("Onwards", true));

        var ex = Assert.Throws<NetworkUnrepresentableException>(() => NetworkTextWriter.Write(body, NetworkScope.Empty));

        Assert.Equal("a rung driving a coil and a jump together", ex.Marker);
        Assert.IsAssignableFrom<UnrepresentableBodyException>(ex);   // the one exception a pull turns into the marker
    }

    [Fact]
    public void A_lone_jump_names_its_flagged_target()
    {
        var text = NetworkTextWriter.Write(Rung(("Onwards", true)), NetworkScope.Empty);

        Assert.Contains("  JMP Onwards;\n", text);
    }
}
