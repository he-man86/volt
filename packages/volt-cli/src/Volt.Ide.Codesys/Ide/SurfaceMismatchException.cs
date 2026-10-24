using Volt.Contracts;
using Volt.Engine;

namespace Volt.Ide.Codesys;

/// <summary>THE BRIDGE DISAGREEING WITH THE IDE'S SURFACE — a binder failure: no overload of a vendor method takes the
/// arguments Volt passes, or the method is not there by the name and arity Volt calls (<see cref="Reflection.Overload"/>,
/// <c>InvokeMethod</c>, the scripting overload searches, <c>move</c>). Coded <c>IDE_UNSUPPORTED</c> like every API this
/// IDE lacks, and a type of its own for the one thing that differs: such a call would fail on EVERY object, so a walk does
/// not name one object unreadable for it — it fails the op (<see cref="Reflection.SurfaceMismatch"/>). A member ONE node
/// lacks (a library manager without <c>GetAllLibraries</c>, a node without a facet) is that node's, and the walk goes on
/// (gate 3c review, finding 4).</summary>
public sealed class SurfaceMismatchException : BridgeException
{
    public SurfaceMismatchException(string message) : base(BridgeErrorCodes.IdeUnsupported, message) { }
}
