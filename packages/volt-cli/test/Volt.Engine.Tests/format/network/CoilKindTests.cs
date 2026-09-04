using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Engine.Tests.Format.Network;

/// <summary>
/// A COIL'S KIND, and the two vendor bits that spell it.
///
/// <para><b>What this replaces.</b> These used to be <c>CoilStorageTests</c>, gating a translation layer that
/// moved a coil's storage off the TARGET and onto the VALUE on read, and back again on write — because the text
/// format spelled it as a trailing word after the value (<c>out := a SET;</c>). The format now spells it as the
/// assignment operator, where the vendors already keep it (<c>out S= a;</c>), so the translation has nothing to
/// do and is deleted. What is left to gate is the part that was never a translation at all: DECODING two bits
/// into a coil kind.</para>
///
/// <para><b>The mapping is measured, not reasoned.</b> CODESYS's own PLCopen export names coil storage
/// outright, so exporting every POU in a real project with a non-plain coil and pairing the two views settles
/// it. 17 POUs, exact counts on both sides, no residue —
/// <c>scripts/probe-nwl-coils.py</c> / <c>scripts/nwl-coils.log</c>.</para>
/// </summary>
public class CoilKindTests
{
    /// <summary>THE MEASUREMENT, as a table. <c>IFlags</c> has <c>Negation</c> and <c>Set</c> and no
    /// <c>Reset</c> — not because a reset coil is unrepresentable, but because the two bits are ONE enum.
    ///
    /// <para>Reading them as two independent modifiers is what made a RESET coil read as a negated SET coil,
    /// and — since the text writer renders no modifier on a target — materialize as a plain <c>SET</c>. 128 of
    /// them in `Lenze_MID-S100`, every one inverted.</para></summary>
    [Theory]
    // negation  set     expected kind          the vendor's own word, from its PLCopen export
    [InlineData(false, false, false, false, false)]   // storage="none"
    [InlineData(false, true, false, true, false)]     // storage="set"    — TrayFiller x27, ServoControl x7
    [InlineData(true, true, false, false, true)]      // storage="reset"  — TrayFiller x54, ServoControl x19
    [InlineData(true, false, true, false, false)]     // never observed on a coil; carried, not invented
    public void The_two_vendor_bits_decode_to_one_coil_kind(
        bool negation, bool set, bool expectNegated, bool expectSet, bool expectReset)
    {
        var kind = Flags.CoilFromVendor(negation, set);

        Assert.Equal(expectNegated, kind.Negated);
        Assert.Equal(expectSet, kind.Set);
        Assert.Equal(expectReset, kind.Reset);
    }

    /// <summary>The pair must round-trip, or a pull would rewrite coils a push then wrote back differently.
    /// Named in <see cref="Flags.VendorCoilBits"/>'s own summary as the gate that holds it.</summary>
    [Theory]
    [InlineData(false, false)]
    [InlineData(false, true)]
    [InlineData(true, true)]
    [InlineData(true, false)]
    public void CoilBitsRoundTrip(bool negation, bool set)
    {
        var (backNegation, backSet) = Flags.CoilFromVendor(negation, set).VendorCoilBits();

        Assert.Equal(negation, backNegation);
        Assert.Equal(set, backSet);
    }

    /// <summary>A reset coil is not a set coil, which is the whole point. Pinned as its own case because the
    /// two differ by one bit and the bug that motivated all of this was exactly this confusion.</summary>
    [Fact]
    public void A_reset_coil_is_not_read_as_a_set_coil()
    {
        var reset = Flags.CoilFromVendor(negation: true, set: true);

        Assert.True(reset.Reset);
        Assert.False(reset.Set);
        Assert.False(reset.Negated);   // the Negation bit is HALF THE KIND, not a modifier on the coil
    }
}
