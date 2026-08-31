using System.Collections.Generic;
using System.Linq;

namespace Volt.Engine.Format.Network;

/// <summary>
/// Where a coil's STORAGE modifier lives, and the one translation between the two places it lives in.
///
/// <para><b>The vendors keep it on the assignment TARGET; network text spells it after the VALUE.</b> Both IDEs
/// put <c>Set</c> on the operand being assigned to — measured on a real ladder, a coil operand reads back
/// <c>Flags=Negation,Set</c> — while the published text format writes <c>out := a SET;</c>, a trailing modifier
/// after the value, and <c>NetworkTextWriter</c> renders modifiers from the VALUE and never from the target. So
/// something has to move it across, on read and back again on write.</para>
///
/// <para><b>It lives here because both drivers need it and only one had it.</b> TwinCAT translated; CODESYS did
/// not, and its assignment read simply dropped the target's flags — so a SET or negated coil pulled from CODESYS
/// rendered as a PLAIN coil, invisible in git and downgraded on the next push. DIALECT D26 asserted the opposite
/// ("CODESYS's reader already puts storage on the value"), which is how the gap survived being written down. A
/// second copy in the CODESYS driver would have been the obvious fix and the wrong one: this is a rule about the
/// MODEL, not about either vendor, and the two copies would drift the moment one was corrected.</para>
/// </summary>
public static class CoilStorage
{
    /// <summary>The storage modifier carried on an assignment's targets, or null when none of them has one.
    ///
    /// <para>The FIRST target that carries one wins. A network text statement has one trailing modifier for the
    /// whole assignment, so a fan-out whose coils disagreed could not be spelled either way; taking the first is
    /// what both drivers already did and keeps the two ends symmetric.</para></summary>
    private static Flags? Of(IEnumerable<Operand> targets) =>
        targets.Select(t => t.Flags).FirstOrDefault(f => f is { Set: true } or { Reset: true });

    /// <summary>The same node, now carrying the storage that was read off the assignment's target.
    ///
    /// <para>OR-ed into whatever the node already had rather than replacing it: the value may legitimately carry
    /// its own modifiers (a negated input feeding a SET coil), and overwriting them would drop what the engineer
    /// wrote on the other side of the assignment.</para></summary>
    private static Node WithStorage(Node node, Flags storage)
    {
        var f = node.Flags with { Set = node.Flags.Set || storage.Set, Reset = node.Flags.Reset || storage.Reset };
        return node switch
        {
            Leaf l => l with { Flags = f },
            Box b => b with { Flags = f },
            Demux d => d with { Flags = f },
            Parallel p => p with { Flags = f },
            Terminator t => t with { Flags = f },
            Assign a => a with { Flags = f },
            _ => node,
        };
    }

    /// <summary>Apply <see cref="Of"/> and <see cref="WithStorage"/> together — the whole read-side rule, so a
    /// driver states it in one line and cannot get half of it right.</summary>
    public static Node? OntoValue(Node? value, IEnumerable<Operand> targets) =>
        value is not null && Of(targets) is { } storage ? WithStorage(value, storage) : value;

    /// <summary>The same node with its storage REMOVED — the write-side inverse of <see cref="WithStorage"/>.
    ///
    /// <para>Load-bearing, not tidying. The storage was moved onto the value on read, so a writer that puts it
    /// back on the target and leaves it on the value latches the SOURCE operand as well: <c>out := a SET;</c>
    /// is a set COIL, and would come back as a set coil fed by a set input. Only <c>Set</c>/<c>Reset</c> are
    /// cleared — everything the engineer genuinely wrote on the value (a negated input, an edge) stays.</para></summary>
    public static Node? WithoutStorage(Node? node)
    {
        if (node is null) return null;
        var f = node.Flags with { Set = false, Reset = false };
        return node switch
        {
            Leaf l => l with { Flags = f },
            Box b => b with { Flags = f },
            Demux d => d with { Flags = f },
            Parallel p => p with { Flags = f },
            Terminator t => t with { Flags = f },
            Assign a => a with { Flags = f },
            _ => node,
        };
    }
}
