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

    /// <summary>The one coded exception. <c>Volt.Engine</c>'s <c>BridgeException</c> IS one of these (it adds the
    /// named factories); layers BELOW the Engine — the pipe server itself — throw this directly.
    ///
    /// <para>It lives here for the same reason <see cref="ICodedError"/> does: a malformed request frame is
    /// refused by <c>PipeServer</c>, which cannot see the Engine, and without a coded exception of its own it had
    /// to let a <c>JsonException</c> fall through to the catch-all — telling a client that mis-spelled its own
    /// frame that the BRIDGE had failed.</para></summary>
    public class CodedException : System.Exception, ICodedError
    {
        public CodedException(string errorCode, string message, System.Exception? inner = null)
            : base(message, inner) => ErrorCode = errorCode;

        public string ErrorCode { get; }
    }
}
