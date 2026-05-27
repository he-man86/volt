using System;
using System.Runtime.InteropServices;

namespace BeckhoffBridge;

/// <summary>
/// COM message filter for STA thread.
/// Required because TwinCAT Automation Interface uses apartment-threaded COM
/// objects, and our HTTP server dispatches calls from background threads.
/// The message filter handles retry logic when COM calls are rejected because
/// the server is busy (e.g. TwinCAT is compiling or updating the UI).
/// </summary>
internal static class ComMessageFilter
{
	[DllImport("ole32.dll")]
	private static extern int CoRegisterMessageFilter(
		IMessageFilter? newFilter,
		out IMessageFilter? oldFilter);

	private static IMessageFilter? _oldFilter;

	/// <summary>Register the message filter on the current STA thread.</summary>
	public static void Register()
	{
		CoRegisterMessageFilter(new MessageFilter(), out _oldFilter);
	}

	/// <summary>Revoke the message filter and restore the previous one.</summary>
	public static void Revoke()
	{
		CoRegisterMessageFilter(_oldFilter, out _);
		_oldFilter = null;
	}

	[ComImport]
	[Guid("00000016-0000-0000-C000-000000000046")]
	[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	private interface IMessageFilter
	{
		[PreserveSig]
		int HandleInComingCall(int dwCallType, IntPtr hTaskCaller, int dwTickCount, IntPtr lpInterfaceInfo);

		[PreserveSig]
		int RetryRejectedCall(IntPtr hTaskCallee, int dwTickCount, int dwRejectType);

		[PreserveSig]
		int MessagePending(IntPtr hTaskCallee, int dwTickCount, int dwPendingType);
	}

	private sealed class MessageFilter : IMessageFilter
	{
		// SERVERCALL_ISHANDLED
		public int HandleInComingCall(int dwCallType, IntPtr hTaskCaller, int dwTickCount, IntPtr lpInterfaceInfo)
			=> 0;

		// Retry rejected calls after a short delay (100ms).
		// Return -1 to cancel, 0-99 to retry after that many ms, 100+ to retry after 100ms.
		public int RetryRejectedCall(IntPtr hTaskCallee, int dwTickCount, int dwRejectType)
		{
			// SERVERCALL_RETRYLATER (2) - retry after 100ms
			if (dwRejectType == 2)
				return 100;

			// SERVERCALL_REJECTED (1) - cancel
			return -1;
		}

		// PENDINGMSG_WAITDEFPROCESS
		public int MessagePending(IntPtr hTaskCallee, int dwTickCount, int dwPendingType)
			=> 2;
	}
}
