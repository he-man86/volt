using System;
using Xunit;

// The platform is reached the way the driver reaches it in CODESYS: by FULL type name in the AppDomain.
// `SystemInstances.Engine` is the IEngine the primary-thread dispatcher wraps, and the assembly that DEFINES
// `SystemInstances` carries the platform version (DIALECT V1) — here this test assembly, 1.0.0.0, far below any real
// CODESYS, which is the point of the "older platform" case. The doubles carry the vendor's names because the names
// are the contract, as for `SystemInstances.ObjectMgr`.
namespace _3S.CoDeSys.Core
{
    internal static partial class SystemInstances
    {
        public static object? Engine { get; set; }
    }
}

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// THE CODESYS BRIDGE KNOWS ITS PLATFORM AND REFUSES BY CAPABILITY (openspec <c>codesys-minimum-version</c> 1.2,
    /// 2.2, 2.3).
    ///
    /// <para><c>IdeVersion</c> was the constant <c>"3.5"</c>, so neither the bridge nor a client knew which CODESYS it
    /// was in. And a CODESYS that lacked what the bridge reads at start reported "no IDE engine" and then refused
    /// every op as PLC_DISCONNECTED — "open a project" to a user whose project was open. Now the driver reads the
    /// platform version off the framework, and names what is missing in a fixed English sentence that Core turns
    /// into <c>IDE_UNSUPPORTED</c> on every call.</para>
    ///
    /// <para>No version floor anywhere: the "older platform" case below is served because it lacks nothing — the
    /// OEM IDEs (WAGO, Lenze, Schneider) run older platforms that work.</para>
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // SystemInstances is process-wide
    public class CodesysCapabilityTests
    {
        /// <summary>The IEngine member the dispatcher binds — by name and parameter types, as the vendor's.</summary>
        public sealed class Engine
        {
            public Engine(object? oem = null) => OEMCustomization = oem;
            public object? OEMCustomization { get; }
            public object? InvokeInPrimaryThread(Delegate d, object[]? args, bool bAsync) => d.DynamicInvoke(args);
        }

        public sealed class Oem
        {
            public Oem(string productName) => ProductName = productName;
            public string ProductName { get; }
        }

        private static string Platform =>
            typeof(_3S.CoDeSys.Core.SystemInstances).Assembly.GetName().Version!.ToString();

        private static T With<T>(object? engine, object? objectManager, Func<T> run)
        {
            _3S.CoDeSys.Core.SystemInstances.Engine = engine;
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = objectManager;
            try { return run(); }
            finally
            {
                _3S.CoDeSys.Core.SystemInstances.Engine = null;
                _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null;
            }
        }

        [Fact]
        public void A_platform_without_the_primary_thread_dispatcher_is_refused_naming_version_and_capability()
        {
            var reason = With(engine: null, objectManager: new object(), () => new CodesysDriver(projects: null).Unsupported);

            Assert.NotNull(reason);
            Assert.StartsWith($"CODESYS {Platform} is not supported: it lacks ", reason);
            Assert.Contains("InvokeInPrimaryThread", reason);
            Assert.EndsWith(".", reason);
        }

        [Fact]
        public void A_platform_without_the_object_manager_is_refused_naming_it()
        {
            var reason = With(new Engine(), objectManager: null, () => new CodesysDriver(projects: null).Unsupported);

            Assert.NotNull(reason);
            Assert.StartsWith($"CODESYS {Platform} is not supported: it lacks ", reason);
            Assert.Contains("ObjectMgr", reason);
            Assert.DoesNotContain("InvokeInPrimaryThread", reason);
        }

        [Fact]
        public void An_older_platform_with_every_capability_is_served_and_reports_its_version()
        {
            var (reason, version) = With(new Engine(new Oem("CODESYS")), new object(), () =>
            {
                var d = new CodesysDriver(projects: null);
                return (d.Unsupported, d.IdeVersion);
            });

            Assert.Null(reason);
            Assert.Equal(Platform, version);   // the platform, not "3.5"
        }

        /// <summary>An OEM build (WAGO, Lenze, Schneider) carries its own PRODUCT name, and the version stays a pure
        /// platform version (spec: "reports the underlying platform version, not the OEM product version"). It was
        /// <c>3.5.18.30 (WAGO CODESYS V3.5)</c> — a field a client cannot parse as a version, and one the tray wrapped
        /// in a second pair of parentheses. The product is the driver's own fact, logged at start and printed in the
        /// message window.</summary>
        [Fact]
        public void An_OEM_product_is_named_apart_from_a_pure_platform_version()
        {
            var (version, product) = With(new Engine(new Oem("WAGO CODESYS V3.5")), new object(), () =>
            {
                var d = new CodesysDriver(projects: null);
                return (d.IdeVersion, d.OemProduct);
            });

            Assert.Equal(Platform, version);
            Assert.Equal(System.Version.Parse(Platform), System.Version.Parse(version!));
            Assert.Equal("WAGO CODESYS V3.5", product);
        }

        // ── the product name is a display nicety: reading it must never take the bridge down ─────────────────────

        /// <summary>An engine whose <c>OEMCustomization</c> getter throws — an unmeasured OEM build may.</summary>
        public sealed class ThrowingOemEngine
        {
            public object OEMCustomization => throw new InvalidOperationException("no OEM customization here");
            public object? InvokeInPrimaryThread(Delegate d, object[]? args, bool bAsync) => d.DynamicInvoke(args);
        }

        public class BaseOem
        {
            public object ProductName => "hidden base name";   // a different type: hide-by-name, GetProperty is ambiguous
        }

        /// <summary>A derived class that HIDES the base property — <c>Type.GetProperty(name)</c> is ambiguous on it.</summary>
        public sealed class DerivedOem : BaseOem
        {
            public new string ProductName => "Lenze PLC Designer";
        }

        [Fact]
        public void A_product_name_getter_that_throws_does_not_take_the_driver_down()
        {
            var (reason, version, product, unreadable) = With(new ThrowingOemEngine(), new object(), () =>
            {
                var d = new CodesysDriver(projects: null);
                return (d.Unsupported, d.IdeVersion, d.ProductName, d.ProductNameUnreadable);
            });

            Assert.Null(reason);                 // served: the product name is not a capability
            Assert.Equal(Platform, version);
            Assert.Null(product);
            Assert.NotNull(unreadable);          // ...and the failure is on record, not swallowed
            Assert.Contains("no OEM customization here", unreadable);
        }

        [Fact]
        public void A_product_name_hidden_by_a_derived_class_reads_the_derived_one()
        {
            var (product, unreadable) = With(new Engine(new DerivedOem()), new object(), () =>
            {
                var d = new CodesysDriver(projects: null);
                return (d.ProductName, d.ProductNameUnreadable);
            });

            Assert.Null(unreadable);
            Assert.Equal("Lenze PLC Designer", product);
        }
    }
}
