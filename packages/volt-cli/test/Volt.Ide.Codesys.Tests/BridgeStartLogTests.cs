using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
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
    /// a field log will carry: the platform, the product and its maker, the bridge release, every bound wire assembly
    /// with its BUILD (the file's ProductVersion — every unstamped Volt file is 1.0.0.0, so only that tells two builds
    /// apart), the Volt builds loaded, and the load conflicts. The second-build case runs in its own AppDomain: a second
    /// copy of a Volt assembly cannot be unloaded, and the other tests here count copies.</para>
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

        private static string Describe(Assembly a) => Volt.Contracts.LoadedCopies.Of(a).Describe();

        [Fact]
        public void The_start_log_states_platform_product_maker_release_and_every_bound_copy_with_its_build()
        {
            var (started, log, health) = Run(new object());

            Assert.Contains($"[info] in-proc bridge starting on pipe {Pipe} (CODESYS pid {Process.GetCurrentProcess().Id})", log);
            // The identity, as read — platform (V1), the IDE's own name, the exe's product/version/maker (V4), release.
            Assert.Contains(
                $"[info] CODESYS platform {Platform}; product name as stated: \"Lenze PLC Designer\"; exe product " +
                $"\"PLC Designer\" version \"4.1.0.37740\" vendor \"Lenze Automation GmbH\"; bridge {BridgePipeHost.Release}",
                log);

            // Every wire assembly: version, file version, BUILD (ProductVersion), location — and which copy is bound.
            var wire = typeof(PipeClient).Assembly;
            var contracts = typeof(Volt.Contracts.WireJson).Assembly;
            var json = typeof(System.Text.Json.JsonElement).Assembly;
            Assert.Contains($"[info] bound: Volt.Wire {Describe(wire)} [bound]", log);
            Assert.Contains($"[info] bound: Volt.Contracts {Describe(contracts)} [bound]", log);
            Assert.Contains($"[info] bound: System.Text.Json {Describe(json)} [bound]", log);
            Assert.Contains($"[info] bound: Volt.Wire.PipeClient.Call binds System.Text.Json {Describe(json)}", log);
            Assert.Contains($"[info] bound: Volt.Contracts.WireJson.Write binds System.Text.Json {Describe(json)}", log);
            Assert.Contains("product " + Volt.Contracts.LoadedCopies.Of(wire).ProductVersion, log);

            // One Volt build, named; no conflict.
            var build = Assert.Single(Volt.Contracts.LoadedCopies.Builds(Volt.Contracts.LoadedCopies.Loaded()));
            Assert.Contains($"[info] bound: Volt builds loaded: 1 — {build.Describe()}", log);
            Assert.Contains("[info] bound: load conflicts: none", log);
            Assert.DoesNotContain("LOAD CONFLICT", log);

            Assert.Contains($"[info] CODESYS bridge ready on {Pipe} (no project open)", log);
            Assert.Equal($"Volt bridge started on pipe {Pipe} (no project open, Lenze PLC Designer on CODESYS {Platform})", started);
            Assert.DoesNotContain("loadConflicts", health);
        }

        /// <summary>The capability refusal (the ONLY refusal): the log names the product, the platform and what is
        /// missing; health carries the identity beside the reason; the message window says the bridge serves nothing.</summary>
        [Fact]
        public void A_refused_IDE_leaves_identity_reason_and_bound_copies_in_the_log()
        {
            var (started, log, health) = Run(objectManager: null);

            Assert.Contains($"CODESYS platform {Platform}; product name as stated: \"Lenze PLC Designer\"", log);
            Assert.Contains("[info] bound: Volt.Wire ", log);
            Assert.Contains($"[error] CODESYS bridge on {Pipe} serves nothing — Lenze PLC Designer: CODESYS {Platform} is not supported: it lacks ", log);
            Assert.Contains("ObjectMgr", log);
            Assert.StartsWith($"Volt: Lenze PLC Designer: CODESYS {Platform} is not supported: it lacks ", started);
            Assert.Contains($"\"ideVersion\":\"{Platform}\"", health);
            Assert.Contains("\"productVendor\":\"Lenze Automation GmbH\"", health);
            Assert.Contains("\"unsupported\":", health);
        }

        // ── a second Volt build in the process (3.2) — own AppDomain ──

        [Fact]
        public void A_second_copy_loaded_before_or_after_start_is_a_load_conflict_in_the_log_the_message_window_and_health()
        {
            var domain = AppDomain.CreateDomain("volt-second-build-" + Guid.NewGuid().ToString("N"), null,
                AppDomain.CurrentDomain.SetupInformation);
            try
            {
                var copies = Path.Combine(Path.GetTempPath(), "volt-second-build-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(copies);
                // From the build output (CodeBase): xunit shadow-copies each assembly into a folder of its own.
                var bin = Path.GetDirectoryName(new Uri(typeof(PipeClient).Assembly.CodeBase).LocalPath)!;
                foreach (var name in new[] { "Volt.Wire.dll", "Volt.Contracts.dll" })
                    File.Copy(Path.Combine(bin, name), Path.Combine(copies, name));
                domain.SetData("copies", copies);
                domain.DoCallBack(SecondBuildInChildDomain);

                var started = (string)domain.GetData("started");
                var log = (string)domain.GetData("log");
                var health = (string)domain.GetData("health");
                var wireCopy = Path.Combine(copies, "Volt.Wire.dll");
                var contractsCopy = Path.Combine(copies, "Volt.Contracts.dll");

                // Before start: the bound copy and the other one, both with location and build.
                Assert.Contains("[info] bound: Volt.Wire ", log);
                Assert.Contains($"at {wireCopy} [ALSO LOADED]", log);
                Assert.Contains("[warn] LOAD CONFLICT: Volt.Wire loaded 2 times: ", log);
                // A conflict at START refuses to serve (openspec codesys-single-load-dependencies 3.2): two copies split
                // the wire's types, and every call would fail with a MissingMethodException. The message window
                // (start_volt_codesys.py prints this) names both copies and the remedy.
                Assert.StartsWith("Volt: Volt's own assemblies are loaded more than once in this CODESYS process, so the bridge serves nothing: Volt.Wire loaded 2 times: ", started);
                Assert.Contains($"at {wireCopy}", started);
                Assert.EndsWith($". Restart CODESYS and start the bridge once. The bridge on pipe {Pipe} refuses every call (IDE_UNSUPPORTED).", started);
                Assert.Contains($"[error] CODESYS bridge on {Pipe} serves nothing — Volt's own assemblies are loaded more than once", log);
                // health — what PLCAssist records — names it, and says the bridge serves nothing (JSON escapes the apostrophe).
                Assert.Contains("\"loadConflicts\":[\"Volt.Wire loaded 2 times: ", health);
                Assert.Contains("\"unsupported\":\"Volt", health);
                Assert.Contains("s own assemblies are loaded more than once in this CODESYS process, so the bridge serves nothing: Volt.Wire loaded 2 times: ", health);
                // Every other op is refused with that sentence — coded, instead of INTERNAL_ERROR on every call.
                Assert.Equal(Volt.Contracts.BridgeErrorCodes.IdeUnsupported, (string)domain.GetData("refsCode"));
                var refused = (string)domain.GetData("refsMessage");
                Assert.Contains("Volt.Wire loaded 2 times: ", refused);
                Assert.Contains($"at {wireCopy}", refused);
                Assert.EndsWith("Restart CODESYS and start the bridge once.", refused);

                // After start: a copy loaded later (a second session's _prune, another handler) is logged when it loads.
                Assert.Contains($"[info] loaded after start (pid {Process.GetCurrentProcess().Id}): Volt.Contracts ", log);
                Assert.Contains($"at {contractsCopy}", log);
                Assert.Contains($"[warn] LOAD CONFLICT (after start, pid {Process.GetCurrentProcess().Id}): Volt.Contracts loaded 2 times: ", log);
            }
            finally { AppDomain.Unload(domain); }
        }

        private static void SecondBuildInChildDomain()
        {
            var me = AppDomain.CurrentDomain;
            var copies = (string)me.GetData("copies");
            Assembly.LoadFile(Path.Combine(copies, "Volt.Wire.dll"));   // another build's copy, loaded first
            var (started, log, health) = Run(new object(), afterStart: () =>
            {
                try { new PipeClient(Pipe).Call("refs"); me.SetData("refsCode", "(answered)"); }
                catch (PipeCallException ex) { me.SetData("refsCode", ex.Code); me.SetData("refsMessage", ex.Message); }
                Assembly.LoadFile(Path.Combine(copies, "Volt.Contracts.dll"));
            });
            me.SetData("started", started);
            me.SetData("log", log);
            me.SetData("health", health);
        }
    }
}
