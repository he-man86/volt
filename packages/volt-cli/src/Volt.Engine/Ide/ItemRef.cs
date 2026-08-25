namespace Volt.Engine.Ide;

/// <summary>
/// An opaque handle to one item in a vendor IDE's project tree. Core passes these around by value and
/// never inspects them; only the vendor driver that produced an <see cref="ItemRef"/> unwraps its
/// <see cref="Native"/> payload (a CODESYS scripting object, a TwinCAT COM item, or a synthetic node).
/// This is what keeps <c>dynamic</c> out of Core — the boundary is typed, the vendor object stays hidden.
/// </summary>
public readonly struct ItemRef
{
    /// <summary>Wrap a vendor's native item object. A NULL payload is refused: this struct's whole purpose is
    /// that Core can pass it around without inspecting it, so a null would travel silently until some driver
    /// finally unwrapped it — far from the walk that produced it, with nothing left to say which item it was.
    /// Refusing at construction keeps the failure at the site that has the context.</summary>
    public ItemRef(object native) =>
        Native = native ?? throw new System.ArgumentNullException(
            nameof(native), "an ItemRef must wrap a real vendor item — a null native handle is a driver bug");

    /// <summary>The vendor's native item object. Only the producing driver may cast this.</summary>
    public object Native { get; }
}
