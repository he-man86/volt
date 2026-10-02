using System;

namespace Volt.Engine.Ide;

/// <summary>The IDE REFUSES a child of this kind under this parent, in its own words — thrown by a driver's
/// <see cref="IProjectTree.CreateChild"/> when it recognises the vendor's measured "not accepted" answer, and by nothing
/// else.
///
/// <para>Which members a POU accepts follows its TEXT on both vendors (DIALECT C2k): FUNCTION text refuses a method,
/// and the push reports that by name as a fact about the declaration (<c>PushService.ReconcileMembers</c>). It used to
/// word EVERY failure of a member create that way, so a stale handle ("Unbound tree item") or a transport fault was
/// sent to the engineer as a declaration to fix. Only the driver can tell the vendor's refusal from a fault — it knows
/// the vendor's wording — so it says which one it is by throwing this; anything else stays an unclassified fault.</para>
///
/// <para>A <see cref="NotSupportedException"/>, so a path that does not catch it still answers <c>UNSUPPORTED</c>
/// (<c>PushService.Reject</c>).</para></summary>
public sealed class ChildRefusedException : NotSupportedException
{
    public ChildRefusedException(string vendorMessage, Exception? inner = null) : base(vendorMessage, inner) { }
}
