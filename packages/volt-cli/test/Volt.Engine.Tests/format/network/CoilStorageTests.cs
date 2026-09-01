using System;
using Xunit;
using Volt.Engine.Format.Network;

namespace Volt.Engine.Tests;

/// <summary>
/// THE COIL-STORAGE RULE, pinned at the layer that owns it.
///
/// <para><c>CoilStorage</c> is shared ENGINE code — the one translation between where the vendors keep a coil's
/// SET/RESET (on the assignment TARGET) and where network text spells it (after the VALUE). Both drivers depend
/// on it. It was pinned only inside the CODESYS driver suite, which is the wrong place twice over: a TwinCAT
/// regression in shared code would not have reddened, and the rule reads as a CODESYS quirk rather than a
/// property of the model.</para>
///
/// <para>Its own history is why the halves are asserted separately. CODESYS's assignment read dropped the
/// target's flags entirely, so a SET or negated coil pulled back as a PLAIN coil — invisible in git, downgraded
/// on the next push. Then the write side took <c>a.Value?.Flags</c> as "the storage" and applied the WHOLE flag
/// record to the target, so the NOT in <c>out := NOT a;</c> landed on the coil as well and the IDE ran
/// <c>out := NOT NOT a</c>. Both were silent: the reader lifts only storage back off a target, so the next pull
/// was byte-identical either way.</para>
/// </summary>
public class CoilStorageTests
{
    private static Leaf Leaf(string name, Flags? f = null) =>
        new(new Operand(name), f ?? Flags.None);

    private static Operand Target(string name, Flags? f = null) => new(name, Flags: f);

    // ── the read side: storage moves from the target onto the value ────────────────────────────

    /// <summary>A SET coil's storage lands on the VALUE, which is where the writer looks for it.</summary>
    [Fact]
    public void Storage_on_a_target_moves_onto_the_value()
    {
        var moved = CoilStorage.OntoValue(Leaf("a"), new[] { Target("out", Flags.None with { Set = true }) });

        Assert.True(moved!.Flags.Set);
    }

    /// <summary>AND IT IS OR-ED IN, never assigned over. A negated input feeding a SET coil carries BOTH, and
    /// replacing the value's flags would drop what the engineer wrote on the other side of the assignment.</summary>
    [Fact]
    public void Storage_is_or_ed_into_what_the_value_already_carried()
    {
        var negated = Leaf("a", Flags.None with { Negated = true });

        var moved = CoilStorage.OntoValue(negated, new[] { Target("out", Flags.None with { Set = true }) });

        Assert.True(moved!.Flags.Set);
        Assert.True(moved.Flags.Negated);      // the NOT survived the move
    }

    /// <summary>A TARGET WITH NO STORAGE CHANGES NOTHING — the ordinary coil, which is most of them.</summary>
    [Fact]
    public void A_plain_target_leaves_the_value_untouched()
    {
        var value = Leaf("a", Flags.None with { Negated = true });

        var same = CoilStorage.OntoValue(value, new[] { Target("out") });

        Assert.Same(value, same);
    }

    /// <summary>THE FIRST TARGET CARRYING STORAGE WINS. A network-text statement has ONE trailing modifier for
    /// the whole assignment, so a fan-out whose coils disagree cannot be spelled either way; taking the first is
    /// what both drivers do, and the two ends have to agree on which.</summary>
    [Fact]
    public void The_first_storage_carrying_target_wins()
    {
        var moved = CoilStorage.OntoValue(Leaf("a"), new[]
        {
            Target("plain"),
            Target("first", Flags.None with { Set = true }),
            Target("second", Flags.None with { Reset = true }),
        });

        Assert.True(moved!.Flags.Set);
        Assert.False(moved.Flags.Reset);
    }

    /// <summary>A null value stays null. The vendors emit an assignment with no source (an unwired coil), and a
    /// translation that materialized a node for it would invent a rung.</summary>
    [Fact]
    public void A_null_value_stays_null()
        => Assert.Null(CoilStorage.OntoValue(null, new[] { Target("out", Flags.None with { Set = true }) }));

    // ── the write side: the two halves must partition the flags exactly ────────────────────────

    /// <summary>`Of` RETURNS ONLY STORAGE. This is the method written because a driver used the whole flag
    /// record as "the storage" and latched a negation onto the coil.</summary>
    [Fact]
    public void Of_returns_storage_and_nothing_else()
    {
        var loud = Flags.None with { Set = true, Negated = true, Rising = true };

        var storage = CoilStorage.Of(Leaf("a", loud));

        Assert.True(storage.Set);
        Assert.False(storage.Negated);         // the half that must NOT reach the target
        Assert.False(storage.Rising);
    }

    /// <summary>`WithoutStorage` CLEARS ONLY STORAGE — the exact complement. Everything the engineer genuinely
    /// wrote on the value (a negated input, an edge) has to stay.</summary>
    [Fact]
    public void WithoutStorage_clears_storage_and_nothing_else()
    {
        var loud = Flags.None with { Set = true, Reset = true, Negated = true, Rising = true };

        var stripped = CoilStorage.WithoutStorage(Leaf("a", loud))!;

        Assert.False(stripped.Flags.Set);
        Assert.False(stripped.Flags.Reset);
        Assert.True(stripped.Flags.Negated);
        Assert.True(stripped.Flags.Rising);
    }

    /// <summary>THE PAIR PARTITIONS THE FLAGS, which is the property that actually matters: what
    /// <c>WithoutStorage</c> leaves on the value plus what <c>Of</c> lifts onto the target must reconstruct
    /// exactly what came in — nothing dropped, nothing duplicated. A writer needs both halves and they have to
    /// agree on the line between them.</summary>
    [Theory]
    [InlineData(true, false, true, false)]
    [InlineData(false, true, false, true)]
    [InlineData(true, true, true, true)]
    [InlineData(false, false, true, true)]
    [InlineData(false, false, false, false)]
    public void The_two_halves_partition_a_values_flags(bool set, bool reset, bool neg, bool edge)
    {
        var original = Flags.None with { Set = set, Reset = reset, Negated = neg, Rising = edge };
        var value = Leaf("a", original);

        var kept = CoilStorage.WithoutStorage(value)!.Flags;
        var lifted = CoilStorage.Of(value);

        Assert.Equal(original, kept with { Set = lifted.Set, Reset = lifted.Reset });
    }

    /// <summary>And null in, null out on the write side too.</summary>
    [Fact]
    public void Null_in_null_out()
    {
        Assert.Null(CoilStorage.WithoutStorage(null));
        Assert.Equal(Flags.None, CoilStorage.Of(null));
    }

    /// <summary>A FULL ROUND TRIP: read the storage off a target onto the value, then split it back apart. The
    /// coil gets its SET, the input keeps its NOT, and neither leaks into the other — the two bugs above,
    /// asserted as the single rule they are.</summary>
    [Fact]
    public void A_negated_input_feeding_a_SET_coil_survives_the_round_trip()
    {
        var read = CoilStorage.OntoValue(Leaf("a", Flags.None with { Negated = true }),
                                         new[] { Target("out", Flags.None with { Set = true }) });

        var backOnTheValue = CoilStorage.WithoutStorage(read)!.Flags;
        var backOnTheTarget = CoilStorage.Of(read);

        Assert.True(backOnTheValue.Negated);   // the input is still negated...
        Assert.False(backOnTheValue.Set);      // ...and is NOT also a set
        Assert.True(backOnTheTarget.Set);      // the coil is still a set...
        Assert.False(backOnTheTarget.Negated); // ...and did NOT acquire the input's NOT
    }
}
