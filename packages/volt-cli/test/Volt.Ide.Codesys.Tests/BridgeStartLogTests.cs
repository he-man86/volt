using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using Volt.Engine.Host;
using Volt.Wire;
using Xunit;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// THE CODESYS START LOG ALONE ANSWERS 3.1 AND 3.2 (openspec ide-identity-report, parked 2026-10-03 until PLCAssist
    /// has field logs).
    ///
    /// <para>Drives the REAL <see cref="PipeHost"/> start — the entry point <c>start_volt_codesys.py</c> calls — over a
    /// <see cref="CodesysDriver"/> on doubles (an OEM-shaped product), into a log folder of its own, and asserts the lines
    /// a field log will carry: the platform, the product and its maker, the bridge release, and the file the bridge was
    /// loaded from.</para>
    /// <para>It also asserted which copy of every wire assembly was bound, the Volt builds loaded and the load conflicts,
    /// with a case that loaded a second copy and saw the bridge refuse to serve. The shipped bridge is now ONE assembly
    /// with those merged in (openspec codesys-bridge-single-assembly): there is no second copy to bind, count or refuse
    /// over, and that code is deleted.</para>
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // SystemInstances is process-wide; one pipe per pid
    public class BridgeStartLogTests
    {
        private static string Platform =>
            typeof(_3S.CoDeSys.Core.SystemInstances).Assembly.GetName().Version!.ToString();

        private static string Pipe => PipeNames.CodesysInstance(Process.GetCurrentProcess().Id);

        private static CodesysDriver Lenze(object? projects) =>
            new CodesysDriver(projects, () => new CodesysPlatform.HostExe("PLC Designer", "4.1.0.37740", "Lenze Automation GmbH"));

        /// <summary>Start, call health, stop — in THIS AppDomain. Returns (start message, log text, health json).</summary>
        private static (string Started, string Log, string Health) Run(object? objectManager, Action? afterStart = null)
        {
            var dir = Path.Combine(Path.GetTempPath(), "volt-start-log-" + Guid.NewGuid().ToString("N"));
            _3S.CoDeSys.Core.SystemInstances.Engine =
                new CodesysCapabilityTests.Engine(new CodesysCapabilityTests.Oem("Lenze PLC Designer"));
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = objectManager;
            try
            {
                var started = PipeHost.Start(null, Lenze, dir);
                string health;
                try
                {
                    health = new PipeClient(Pipe).Call("health").GetRawText();
                    afterStart?.Invoke();
                }
                finally { PipeHost.Stop(); }
                var log = string.Concat(Directory.GetFiles(dir, "codesys-*.log").Select(File.ReadAllText));
                return (started, log, health);
            }
            finally
            {
                _3S.CoDeSys.Core.SystemInstances.Engine = null;
                _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null;
                try { Directory.Delete(dir, true); } catch { }
            }
        }

        [Fact]
        public void The_start_log_states_platform_product_maker_release_and_where_the_bridge_was_loaded_from()
        {
            var (started, log, _) = Run(new object());

            Assert.Contains($"[info] in-proc bridge starting on pipe {Pipe} (CODESYS pid {Process.GetCurrentProcess().Id}) " +
                            $"from {typeof(PipeHost).Assembly.Location}", log);
            // The identity, as read — platform (V1), the IDE's own name, the exe's product/version/maker (V4), release.
            Assert.Contains(
                $"[info] CODESYS platform {Platform}; product name as stated: \"Lenze PLC Designer\"; exe product " +
                $"\"PLC Designer\" version \"4.1.0.37740\" vendor \"Lenze Automation GmbH\"; bridge {BridgePipeHost.Release}",
                log);

            Assert.Contains($"[info] CODESYS bridge ready on {Pipe} (no project open)", log);
            Assert.Equal($"Volt bridge started on pipe {Pipe} (no project open, Lenze PLC Designer on CODESYS {Platform})", started);
        }

        /// <summary>The capability refusal (the ONLY refusal): the log names the product, the platform and what is
        /// missing; health carries the identity beside the reason; the message window says the bridge serves nothing.</summary>
        [Fact]
        public void A_refused_IDE_leaves_identity_and_reason_in_the_log()
        {
            var (started, log, health) = Run(objectManager: null);

            Assert.Contains($"CODESYS platform {Platform}; product name as stated: \"Lenze PLC Designer\"", log);
            Assert.Contains($"[error] CODESYS bridge on {Pipe} serves nothing — Lenze PLC Designer: CODESYS {Platform} is not supported: it lacks ", log);
            Assert.Contains("ObjectMgr", log);
            Assert.StartsWith($"Volt: Lenze PLC Designer: CODESYS {Platform} is not supported: it lacks ", started);
            Assert.Contains($"\"ideVersion\":\"{Platform}\"", health);
            Assert.Contains("\"productVendor\":\"Lenze Automation GmbH\"", health);
            Assert.Contains("\"unsupported\":", health);
        }
    }
}
