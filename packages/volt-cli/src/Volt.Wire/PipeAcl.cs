using System;
using System.ComponentModel;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Volt.Wire;

/// <summary>
/// WHO MAY OPEN A BRIDGE PIPE (openspec environment-dependency-audit 2.2): SYSTEM, Administrators and the USER the bridge
/// runs as — by the user's SID, whatever the bridge's elevation — at Medium integrity. Stated explicitly on every instance
/// <see cref="PipeServer"/> creates, never left to the default.
///
/// <para><b>Why not the default.</b> Measured 2026-10-13 on Windows 11 (.NET Framework 4.8 — the runtime of the in-proc
/// CODESYS bridge): a pipe created with no security attributes gets
/// <c>O:&lt;user&gt;D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;&lt;owner&gt;)(A;;FR;;;WD)(A;;FR;;;AN)</c> — full access for the
/// token's OWNER, read for everyone. And the token of an elevated process of the same user (CODESYSControlSysTray and
/// GatewaySysTray, both elevated on the dev machine, read from an unelevated process) has owner
/// <c>S-1-5-32-544</c> (Administrators), not the user, at High integrity. So a CODESYS run "as administrator" hands full
/// access to Administrators only — a group the same user's unelevated token holds deny-only — and read to everyone: the
/// unelevated CLI, connector and desktop open the pipe read-write and are refused (access denied). The user's own SID,
/// read from the token's <c>TokenUser</c>, is the same in both tokens; granting it is what admits the same person at
/// either elevation. Another user stays out (no Everyone/Anonymous read either: nothing reads a bridge pipe but a client
/// that also writes).</para>
///
/// <para><b>The label.</b> <c>S:(ML;;NW;;;ME)</c> — Medium, no-write-up — is the integrity an unelevated client has. It is
/// stated rather than left to what the kernel gives an object a High-integrity process creates without one (not measured:
/// that needs an elevated run), so the admitted client's integrity is never the question.</para>
///
/// <para>Not yet measured live: an ELEVATED CODESYS serving through this ACL to an unelevated `volt` — it needs one run
/// "as administrator" (a UAC consent no unattended step can give). <c>PipeAccessTests</c> holds the mechanism unelevated:
/// this ACL on every instance, and that the elevated default (above, with Administrators as owner) refuses the same user
/// read-write, which the client then names.</para>
/// </summary>
internal static class PipeAcl
{
    /// <summary>The security descriptor every bridge pipe instance carries, for the user SID <paramref name="userSid"/>.</summary>
    private static string Sddl(string userSid) => $"D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;{userSid})S:(ML;;NW;;;ME)";

    /// <summary>One server instance of <paramref name="pipeName"/>, duplex, byte mode, SYNCHRONOUS, unlimited instances, carrying <see cref="Sddl"/> for this process's user. A
    /// failure is the Win32 error, named with the pipe — the bind failure <see cref="PipeServer.Start"/> reports.</summary>
    internal static NamedPipeServerStream CreateServer(string pipeName)
    {
        // The managed constructor's own name rules (`new NamedPipeServerStream(name, …)` refuses an empty name and the
        // reserved "anonymous", the BCL's name for its anonymous pipes, before the OS is asked).
        if (string.IsNullOrEmpty(pipeName)) throw new ArgumentException("a pipe name is required", nameof(pipeName));
        if (string.Equals(pipeName, "anonymous", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentOutOfRangeException(nameof(pipeName), "'anonymous' is reserved for anonymous pipes");
        var sddl = Sddl(CurrentUserSid());
        if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, out var sd, IntPtr.Zero))
            throw new Win32Exception(Marshal.GetLastWin32Error(), $"pipe '{pipeName}': the security descriptor {sddl} was refused");
        try
        {
            var sa = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)), lpSecurityDescriptor = sd, bInheritHandle = 0 };
            var handle = CreateNamedPipeW(@"\\.\pipe\" + pipeName,
                // NOT overlapped: PipeServer serves each connection with blocking calls on its own thread, and a blocking
                // Read/Write on an overlapped handle completes through the I/O port onto a WORKER POOL thread (.NET 7+;
                // the Framework's IOCP pool in the CODESYS host) — so a saturated pool, CODESYS's own in-proc, held every
                // request, `health` included (PipeServeThreadTests, red on CI 2026-10-14).
                PIPE_ACCESS_DUPLEX,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                PIPE_UNLIMITED_INSTANCES, 0, 0, 0, ref sa);
            if (handle.IsInvalid)
            {
                var err = Marshal.GetLastWin32Error();
                handle.Dispose();
                var w32 = new Win32Exception(err);
                // The managed constructor's own types for the two failures a caller acts on: the name is held by a
                // process this one may not join (access denied), or anything else the OS said.
                if (err == ERROR_ACCESS_DENIED) throw new UnauthorizedAccessException($"pipe '{pipeName}': {w32.Message}", w32);
                throw new PipeBindException($"pipe '{pipeName}': {w32.Message}", w32);
            }
            return new NamedPipeServerStream(PipeDirection.InOut, isAsync: false, isConnected: false, safePipeHandle: handle);
        }
        finally { LocalFree(sd); }
    }

    /// <summary>The SID of the user this process runs as (<c>TokenUser</c>) — the same SID in an elevated and an
    /// unelevated token of one person; never the token's OWNER, which elevation changes to Administrators.</summary>
    private static string CurrentUserSid()
    {
        if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, out var token))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "cannot read this process's token for the pipe's user");
        try
        {
            GetTokenInformation(token, TokenUser, IntPtr.Zero, 0, out var size);
            var buf = Marshal.AllocHGlobal(size);
            try
            {
                if (!GetTokenInformation(token, TokenUser, buf, size, out size))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "cannot read this process's user SID for the pipe");
                if (!ConvertSidToStringSidW(Marshal.ReadIntPtr(buf), out var sidStr))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "cannot spell this process's user SID");
                try { return Marshal.PtrToStringUni(sidStr)!; }
                finally { LocalFree(sidStr); }
            }
            finally { Marshal.FreeHGlobal(buf); }
        }
        finally { CloseHandle(token); }
    }

    private const uint PIPE_ACCESS_DUPLEX = 0x3;
    private const uint PIPE_TYPE_BYTE = 0x0, PIPE_READMODE_BYTE = 0x0, PIPE_WAIT = 0x0, PIPE_REJECT_REMOTE_CLIENTS = 0x8;
    private const uint PIPE_UNLIMITED_INSTANCES = 255;
    private const int ERROR_ACCESS_DENIED = 5;
    private const uint TOKEN_QUERY = 0x8;
    private const int TokenUser = 1;

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; public int bInheritHandle; }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafePipeHandle CreateNamedPipeW(string name, uint openMode, uint pipeMode, uint maxInstances,
        uint outBuffer, uint inBuffer, uint defaultTimeout, ref SECURITY_ATTRIBUTES sa);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string sddl, uint revision, out IntPtr sd, IntPtr size);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertSidToStringSidW(IntPtr sid, out IntPtr str);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr token, int cls, IntPtr buf, int len, out int returned);

    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr h);
}

/// <summary>The OS refused to bind a bridge pipe instance — the Win32 error, named with the pipe. It reaches the host that
/// starts the server (<see cref="PipeServer.Start"/>'s caller), or ends the accept loop, which logs it: never a frame. An
/// <see cref="IOException"/>, the type the managed constructor gives the same failure.</summary>
public sealed class PipeBindException : IOException
{
    public PipeBindException(string message, Exception inner) : base(message, inner) { }
}
