namespace Volt.Bridge.Core.Ide;

/// <summary>
/// An opaque handle to one item in a vendor IDE's project tree. Core passes these around by value and
/// never inspects them; only the vendor driver that produced an <see cref="ItemRef"/> unwraps its
/// <see cref="Native"/> payload (a CODESYS scripting object, a TwinCAT COM item, or a synthetic node).
/// This is what keeps <c>dynamic</c> out of Core — the boundary is typed, the vendor object stays hidden.
/// </summary>
public readonly struct ItemRef
{
    public ItemRef(object native) => Native = native;

    /// <summary>The vendor's native item object. Only the producing driver may cast this.</summary>
    public object Native { get; }
}
