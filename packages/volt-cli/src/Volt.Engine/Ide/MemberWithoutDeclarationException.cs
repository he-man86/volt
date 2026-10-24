using Volt.Contracts;

namespace Volt.Engine.Ide;

/// <summary>A member the IDE holds and reports NO declaration for — a broken item, not a transport gap
/// (<see cref="MemberSites.Declaration"/>). Coded <c>UNREADABLE</c> like every read the IDE answers with nothing, and a
/// type of its own for the one thing that differs: an item holding such a member cannot be updated in place, forced or
/// not (the update reads it whole first), so the push's refusal names the way that works — delete, then create
/// (<c>PushService.ReadLive</c>). No other UNREADABLE carries that advice: a delete and re-create drops what the text
/// does not carry, and a read answered with nothing may be transient (gate 3c review, finding 2).</summary>
public sealed class MemberWithoutDeclarationException : BridgeException
{
    public MemberWithoutDeclarationException(string member)
        : base(BridgeErrorCodes.Unreadable,
               $"'{member}': the IDE reports no declaration for this member — that is a broken item, not a transport gap") { }
}
