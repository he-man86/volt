using System;

namespace Volt.Engine.Ide;

/// <summary>A child a driver NAMES but must not open: <see cref="IProjectTree.ChildAt"/> throws this instead of
/// touching it, with no call into the vendor.
///
/// <para>The one case today is TwinCAT's (DIALECT C2i): after a solution load, the first touch of the tree item of a
/// POU whose text the IDE does not read as a POU kills TcXaeShell inside its own process, so there is nothing on
/// Volt's side to guard with a <c>try</c>. The driver learns which children those are without touching them (the
/// Solution Explorer hierarchy) and answers with this. It is not an ordinary read fault: the object is known to
/// exist, by name, and its kind family is known — so a walk names it in <c>unreadable</c> and goes on, and a lookup
/// of any OTHER name skips it.</para></summary>
public sealed class UnreadableItemException : Exception
{
    public UnreadableItemException(string name, string reason, System.Collections.Generic.IReadOnlyList<string> kinds)
        : base(reason)
    {
        Name = name;
        Reason = reason;
        Kinds = kinds;
    }

    /// <summary>The child's name, exactly as the IDE spells it.</summary>
    public string Name { get; }

    /// <summary>Why it is not opened — what <c>refs</c>/<c>fetch</c> log and a refusal names.</summary>
    public string Reason { get; }

    /// <summary>The wire kinds the object can be (<see cref="Item.ItemKind.Kinds"/>), which the vendor states without
    /// the object being read — for a TwinCAT <c>.TcPOU</c>: program, function block or function.</summary>
    public System.Collections.Generic.IReadOnlyList<string> Kinds { get; }
}
