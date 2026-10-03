using System;

namespace Volt.Engine.Ide;

/// <summary>What the IDE refused a child FOR — the one fact the push words differently (openspec
/// <c>push-keeps-what-landed</c> design D2): a <see cref="Kind"/> refusal is about the parent's declaration (FUNCTION
/// text takes no method, DIALECT C2k), a <see cref="Name"/> refusal about the child's name (CODESYS and TwinCAT both
/// refuse a method named <c>Log</c>, measured 2026-10-03), whatever the declaration says.</summary>
public enum ChildRefusalCause
{
    /// <summary>The parent does not take a child of this KIND (CODESYS "is not accepted by parent object", TwinCAT
    /// "(SubType mismatch)").</summary>
    Kind,

    /// <summary>The IDE does not take this NAME for the child (CODESYS "The name '…' is not valid for this object.",
    /// TwinCAT "(Name mismatch)").</summary>
    Name,
}

/// <summary>The IDE REFUSES a child under this parent, in its own words — thrown by a driver's
/// <see cref="IProjectTree.CreateChild"/> when it recognises one of the vendor's measured refusals, and by nothing
/// else.
///
/// <para>Which members a POU accepts follows its TEXT on both vendors (DIALECT C2k): FUNCTION text refuses a method,
/// and the push reports that by name as a fact about the declaration (<c>PushService.ReconcileMembers</c>). It used to
/// word EVERY failure of a member create that way, so a stale handle ("Unbound tree item") or a transport fault was
/// sent to the engineer as a declaration to fix. Only the driver can tell the vendor's refusal from a fault — it knows
/// the vendor's wording — so it says which one it is by throwing this, and WHY (<see cref="Cause"/>); anything else
/// stays an unclassified fault.</para>
///
/// <para>A <see cref="NotSupportedException"/>, so a path that does not catch it still answers <c>UNSUPPORTED</c>
/// (<c>PushService.ConflictFor</c>).</para></summary>
public sealed class ChildRefusedException : NotSupportedException
{
    public ChildRefusedException(string vendorMessage, ChildRefusalCause cause, Exception? inner = null)
        : base(vendorMessage, inner) => Cause = cause;

    /// <summary>Whether the IDE refused the child's KIND under this parent or its NAME.</summary>
    public ChildRefusalCause Cause { get; }
}
