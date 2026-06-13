using System.Runtime.InteropServices;

namespace VoltBridge.Beckhoff;

internal static class ComMessageFilter
{
    [DllImport("ole32.dll")]
    private static extern int CoRegisterMessageFilter(IMessageFilter? newFilter, out IMessageFilter? oldFilter);

    private static IMessageFilter? _oldFilter;

    public static void Register()
    {
        CoRegisterMessageFilter(new MessageFilter(), out _oldFilter);
    }

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
        public int HandleInComingCall(int dwCallType, IntPtr hTaskCaller, int dwTickCount, IntPtr lpInterfaceInfo) => 0;
        public int RetryRejectedCall(IntPtr hTaskCallee, int dwTickCount, int dwRejectType) => dwRejectType == 2 ? 100 : -1;
        public int MessagePending(IntPtr hTaskCallee, int dwTickCount, int dwPendingType) => 2;
    }
}
