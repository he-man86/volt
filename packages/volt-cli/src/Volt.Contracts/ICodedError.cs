namespace Volt.Contracts
{
    /// <summary>An exception that carries a machine-readable code onto the wire.
    /// <para>It lives in Contracts rather than beside the pipe server that reads it, because the CODE is part of
    /// the wire contract (<see cref="BridgeErrorCodes"/>) and this interface is how a layer that cannot see the
    /// Engine still gets one out of an exception. The pipe server reads a thrown exception through this seam; the
    /// Engine's <c>BridgeException</c> implements it. Anything else stays a generic <c>INTERNAL_ERROR</c>.</para></summary>
    public interface ICodedError
    {
        string ErrorCode { get; }
    }
}
