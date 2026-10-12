using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace Volt.Connector
{
    /// <summary>Finds a running Volt CLI before the tray stops anything for an update: the TwinCAT worker it would stop
    /// is the far end of the pipe a running <c>volt push</c> writes a live PLC project through.
    ///
    /// <para>Processes are identified by <c>QueryFullProcessImageName</c>, which needs only
    /// PROCESS_QUERY_LIMITED_INFORMATION. <c>Process.MainModule</c> — what this used before — reads nothing for an
    /// ELEVATED process of the same user (a <c>volt.exe</c> started from an admin terminal: measured empty, as WMI's
    /// <c>ExecutablePath</c> is null), so the update stopped the worker under exactly that push. A <c>volt.exe</c>
    /// whose path cannot be read even so counts as the CLI (fail closed): waiting on a stranger costs an update,
    /// stopping the worker under a push costs a PLC project. installer/Volt.iss's <c>FindCli</c> is the same rule.</para></summary>
    public static class CliProcess
    {
        /// <summary>The pid of a process named <c>volt</c> that runs from <paramref name="cliExe"/> or whose path cannot
        /// be read; null when none does.</summary>
        public static int? Find(string cliExe)
        {
            foreach (var p in Process.GetProcessesByName("volt"))
            {
                using (p)
                {
                    var path = ImagePath(p.Id);
                    if (path == null || string.Equals(path, cliExe, StringComparison.OrdinalIgnoreCase)) return p.Id;
                }
            }
            return null;
        }

        /// <summary>The executable path of <paramref name="pid"/>, or null when the process refuses even
        /// PROCESS_QUERY_LIMITED_INFORMATION (or is gone).</summary>
        private static string? ImagePath(int pid)
        {
            var h = OpenProcess(ProcessQueryLimitedInformation, false, pid);
            if (h == IntPtr.Zero) return null;
            try
            {
                var buf = new StringBuilder(1024);
                var size = buf.Capacity;
                return QueryFullProcessImageName(h, 0, buf, ref size) ? buf.ToString(0, size) : null;
            }
            finally { CloseHandle(h); }
        }

        private const uint ProcessQueryLimitedInformation = 0x1000;
        [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "QueryFullProcessImageNameW")]
        private static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int size);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr h);
    }
}
