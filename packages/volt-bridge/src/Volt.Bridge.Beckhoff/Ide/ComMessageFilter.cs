using System.Runtime.InteropServices;

namespace Volt.Bridge.Beckhoff;

/// <summary>
/// Registers a COM <c>IMessageFilter</c> on the bridge's STA thread so out-of-process calls into the
/// TwinCAT XAE automation model (DTE) are RETRIED when the IDE is momentarily busy, instead of failing
/// with "call was rejected by callee" (<c>RPC_E_SERVERCALL_RETRYLATER</c> / <c>RPC_E_CALL_REJECTED</c>).
/// This is the Microsoft-documented pattern for robust DTE automation (KB201600). It is the COM-layer
/// complement to <c>BeckhoffDriver.ShouldMarkDegraded</c>: the filter retries transient rejections so they
/// rarely become exceptions; the HRESULT check is the backstop for when retrying ultimately gives up.
///
/// <para>No CODESYS counterpart — that bridge runs in-process, so there is no cross-apartment RPC to
/// reject. MUST be registered on the same STA thread that makes the COM calls (see <c>Program.cs</c>),
/// because a message filter is scoped to the apartment that registers it.</para>
/// </summary>
internal static class ComMessageFilter
{
    [DllImport("ole32.dll")]
    private static extern int CoRegisterMessageFilter(IMessageFilter? newFilter, out IMessageFilter? oldFilter);

    private static IMessageFilter? _oldFilter;

    public static void Register() => CoRegisterMessageFilter(new MessageFilter(), out _oldFilter);

    /// <summary>The standard OLE <c>IMessageFilter</c> contract. The GUID is its well-known interface id
    /// (<c>IID_IMessageFilter</c>, from <c>objidl.h</c> — one of the original OLE interfaces in the
    /// <c>…-C000-000000000046</c> family). We redeclare it here because .NET ships no interop type for it:
    /// <c>System.Runtime.InteropServices.ComTypes</c> covers the ROT interfaces (see <c>RotInstances</c>)
    /// but not this one.</summary>
    [ComImport]
    [Guid("00000016-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMessageFilter
    {
        [PreserveSig] int HandleInComingCall(int dwCallType, IntPtr hTaskCaller, int dwTickCount, IntPtr lpInterfaceInfo);
        [PreserveSig] int RetryRejectedCall(IntPtr hTaskCallee, int dwTickCount, int dwRejectType);
        [PreserveSig] int MessagePending(IntPtr hTaskCallee, int dwTickCount, int dwPendingType);
    }

    private sealed class MessageFilter : IMessageFilter
    {
        // dwRejectType (SERVERCALL enum): the callee is busy but invites a retry.
        private const int ServerCallRetryLater = 2;

        // RetryRejectedCall return convention: 0..99 = retry immediately, >=100 = retry after that many
        // ms, <0 = cancel the call (surfaces as an exception to the caller).
        private const int RetryAfterMs = 100;
        private const int CancelCall = -1;

        // HandleInComingCall return: accept the inbound call.
        private const int ServerCallIsHandled = 0;

        // MessagePending return: keep waiting for the outbound call to finish, dispatching default
        // messages meanwhile so the STA thread's pump doesn't stall.
        private const int PendingMsgWaitDefProcess = 2;

        public int HandleInComingCall(int dwCallType, IntPtr hTaskCaller, int dwTickCount, IntPtr lpInterfaceInfo)
            => ServerCallIsHandled;

        public int RetryRejectedCall(IntPtr hTaskCallee, int dwTickCount, int dwRejectType)
            => dwRejectType == ServerCallRetryLater ? RetryAfterMs : CancelCall;

        public int MessagePending(IntPtr hTaskCallee, int dwTickCount, int dwPendingType)
            => PendingMsgWaitDefProcess;
    }
}
