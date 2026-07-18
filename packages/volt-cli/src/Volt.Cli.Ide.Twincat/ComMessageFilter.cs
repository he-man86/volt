using System;
using System.Runtime.InteropServices;

namespace Volt.Cli.Ide.Twincat;

/// <summary>
/// Registers a COM <c>IMessageFilter</c> on the bridge's STA thread so out-of-process calls into the TwinCAT XAE
/// automation model (DTE) are RETRIED when the IDE is momentarily busy, instead of failing with "call was
/// rejected by callee" (RPC_E_SERVERCALL_RETRYLATER / RPC_E_CALL_REJECTED). The Microsoft-documented pattern for
/// robust DTE automation (KB201600). MUST be registered on the same STA thread that makes the COM calls.
/// Copied from the backup's internal Volt.Bridge.Beckhoff.ComMessageFilter (a standard, self-contained helper).
/// </summary>
internal static class ComMessageFilter
{
    [DllImport("ole32.dll")]
    private static extern int CoRegisterMessageFilter(IMessageFilter? newFilter, out IMessageFilter? oldFilter);

    private static IMessageFilter? _oldFilter;

    public static void Register() => CoRegisterMessageFilter(new MessageFilter(), out _oldFilter);

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
        private const int ServerCallRetryLater = 2;   // callee busy, invites a retry
        private const int RetryAfterMs = 100;         // >=100 → retry after that many ms
        private const int CancelCall = -1;            // <0 → cancel (surfaces as an exception)
        private const int ServerCallIsHandled = 0;    // accept the inbound call
        private const int PendingMsgWaitDefProcess = 2; // keep waiting, pumping default messages

        public int HandleInComingCall(int dwCallType, IntPtr hTaskCaller, int dwTickCount, IntPtr lpInterfaceInfo) => ServerCallIsHandled;
        public int RetryRejectedCall(IntPtr hTaskCallee, int dwTickCount, int dwRejectType) => dwRejectType == ServerCallRetryLater ? RetryAfterMs : CancelCall;
        public int MessagePending(IntPtr hTaskCallee, int dwTickCount, int dwPendingType) => PendingMsgWaitDefProcess;
    }
}
