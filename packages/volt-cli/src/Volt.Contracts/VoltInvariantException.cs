namespace Volt.Contracts
{
    /// <summary>VOLT'S OWN BROKEN INVARIANT — a state Volt's code guarantees cannot happen: a push op with no apply arm,
    /// two hosts registering one name, a body handed to a writer that its reader refuses. The one exception a wire
    /// answers <see cref="BridgeErrorCodes.InternalError"/> with by intent; the message names the invariant.
    ///
    /// <para>Never an IDE state, a request or a vendor limit: those carry their own code at the throw (a
    /// <c>BridgeException</c> with the situation's code). <c>INTERNAL_ERROR</c> then means exactly this, or a foreign
    /// exception (COM, the vendor's .NET API) that reached the wire uncaught — both Volt's bug, both logged whole by
    /// <c>PipeServer</c> (openspec <c>wire-final-shape</c> step 3c).</para></summary>
    public sealed class VoltInvariantException : CodedException
    {
        public VoltInvariantException(string brokenInvariant, System.Exception? inner = null)
            : base(BridgeErrorCodes.InternalError, brokenInvariant, inner) { }
    }
}
