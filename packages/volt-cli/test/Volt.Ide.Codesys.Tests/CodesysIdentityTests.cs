using System;
using System.Diagnostics;
using Volt.Engine.Host;
using Volt.Wire;
using Xunit;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// THE CODESYS BRIDGE STATES WHICH PRODUCT IT RUNS IN (openspec ide-identity-report 2.1/2.2/2.5, design B1).
    ///
    /// <para>The pre-Volt bridges told OEM IDEs apart (Lenze Engineering, Machine Expert, DIADesigner…); the Volt bridge
    /// sent only <c>CODESYS</c>. Now the name is the IDE's own customization answer
    /// (<c>OEMCustomization.ProductName</c>), the product's version and maker are its exe's version-info (in-proc, so
    /// the current process — DIALECT V4), and <c>ideVersion</c> stays the platform read off the framework (V1). The
    /// platform of these doubles is this test assembly's <c>1.0.0.0</c>, so a copied product version shows.</para>
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // SystemInstances is process-wide
    public class CodesysIdentityTests
    {
        private static string Platform =>
            typeof(_3S.CoDeSys.Core.SystemInstances).Assembly.GetName().Version!.ToString();

        private static T With<T>(string? productName, Func<CodesysPlatform.HostExe>? exe, Func<CodesysDriver, T> read)
        {
            _3S.CoDeSys.Core.SystemInstances.Engine = new CodesysCapabilityTests.Engine(
                productName == null ? null : new CodesysCapabilityTests.Oem(productName));
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new object();
            try { return read(exe == null ? new CodesysDriver(projects: null) : new CodesysDriver(null, exe)); }
            finally
            {
                _3S.CoDeSys.Core.SystemInstances.Engine = null;
                _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null;
            }
        }

        [Fact]
        public void Plain_CODESYS_states_its_name_version_and_maker_beside_the_platform()
        {
            var d = With("CODESYS", () => new CodesysPlatform.HostExe("CODESYS", "3.5.21.40", "CODESYS Development GmbH"), x => x);

            Assert.Equal("CODESYS", d.ProductName);              // the raw name, CODESYS included
            Assert.Equal("3.5.21.40", d.ProductVersion);
            Assert.Equal("CODESYS Development GmbH", d.ProductVendor);
            Assert.Equal(Platform, d.IdeVersion);
        }

        [Fact]
        public void An_OEM_states_its_own_name_number_and_maker_and_the_platform_stays_the_frameworks()
        {
            var d = With("Lenze PLC Designer", () => new CodesysPlatform.HostExe("PLC Designer", "4.1.0.37740", "Lenze Automation GmbH"), x => x);

            Assert.Equal("Lenze PLC Designer", d.ProductName);   // the IDE's customization answer, not the exe's
            Assert.Equal("PLC Designer", d.ExeProductName);      // the exe's is logged beside it (design B2)
            Assert.Equal("4.1.0.37740", d.ProductVersion);
            Assert.Equal("Lenze Automation GmbH", d.ProductVendor);
            Assert.Equal(Platform, d.IdeVersion);
            Assert.NotEqual(d.ProductVersion, d.IdeVersion);
            Assert.Null(d.Unsupported);                          // report only: nothing here refuses
        }

        [Fact]
        public void An_exe_that_states_nothing_reads_null_never_a_name_from_its_file()
        {
            var d = With(null, () => new CodesysPlatform.HostExe("", "  ", null), x => x);

            Assert.Null(d.ProductName);
            Assert.Null(d.ProductVersion);
            Assert.Null(d.ProductVendor);
            Assert.Equal(Platform, d.IdeVersion);
        }

        [Fact]
        public void An_unreadable_exe_leaves_version_and_vendor_null_says_why_and_still_serves()
        {
            var d = With("CODESYS", () => throw new System.ComponentModel.Win32Exception(5, "Access is denied"), x => x);

            Assert.Null(d.ProductVersion);
            Assert.Null(d.ProductVendor);
            Assert.Contains("Access is denied", d.HostExeUnreadable);
            Assert.Equal("CODESYS", d.ProductName);
            Assert.Null(d.Unsupported);
        }

        /// <summary>The production read is the CURRENT process's exe — in CODESYS that is the IDE; here it is the test
        /// host, which pins only that the default reads that one source, verbatim.</summary>
        [Fact]
        public void The_default_read_is_the_current_process_exe()
        {
            using var self = Process.GetCurrentProcess();
            var info = self.MainModule!.FileVersionInfo;

            var d = With("CODESYS", exe: null, x => x);

            Assert.Equal(CodesysPlatform.Stated(info.ProductVersion), d.ProductVersion);
            Assert.Equal(CodesysPlatform.Stated(info.CompanyName), d.ProductVendor);
        }

        [Fact]
        public void Health_through_the_pipe_carries_the_identity()
        {
            _3S.CoDeSys.Core.SystemInstances.Engine = new CodesysCapabilityTests.Engine(new CodesysCapabilityTests.Oem("Lenze PLC Designer"));
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new object();
            try
            {
                var pipe = "volt.test." + Guid.NewGuid().ToString("N");
                using var host = new BridgePipeHost(new CodesysDriver(null,
                    () => new CodesysPlatform.HostExe("PLC Designer", "4.1.0.37740", "Lenze Automation GmbH")), pipe);
                host.Start();
                var h = new PipeClient(pipe).Call("health");

                Assert.Equal("Lenze PLC Designer", h.GetProperty("productName").GetString());
                Assert.Equal("4.1.0.37740", h.GetProperty("productVersion").GetString());
                Assert.Equal("Lenze Automation GmbH", h.GetProperty("productVendor").GetString());
                Assert.Equal(Platform, h.GetProperty("ideVersion").GetString());
                // pinned to the D3 FORM, computed here from the shared host's own file — not to the field the host
                // stamped from (review gate 2: an Equal against BridgePipeHost.Release would pass on any reading)
                Assert.Equal(D3OfHostFile(), h.GetProperty("bridgeVersion").GetString());
                Assert.NotEqual(typeof(BridgePipeHost).Assembly.GetName().Version!.ToString(), h.GetProperty("bridgeVersion").GetString());
            }
            finally
            {
                _3S.CoDeSys.Core.SystemInstances.Engine = null;
                _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null;
            }
        }

        /// <summary>Review gate 2: an OEM's product name is logged VERBATIM — a whitespace answer is evidence, distinct
        /// from a platform with no such member — while the wire carries null for it (empty is not a statement).</summary>
        [Fact]
        public void A_whitespace_product_name_is_null_on_the_wire_and_verbatim_in_the_start_log()
        {
            var d = With("  ", () => new CodesysPlatform.HostExe("CODESYS", "3.5.21.40", "CODESYS Development GmbH"), x => x);

            Assert.Null(d.ProductName);
            Assert.Equal("  ", d.ProductNameAsRead);
            Assert.Equal("  ", d.OemProduct);                     // as before the identity change: the raw answer
            Assert.Contains("product name as stated: \"  \";", d.IdentityLine());

            var none = With(null, () => new CodesysPlatform.HostExe("CODESYS", "3.5.21.40", "CODESYS Development GmbH"), x => x);
            Assert.Contains("product name as stated: (none);", none.IdentityLine());
        }

        /// <summary>Design D3, written out independently of <c>BridgeRelease</c>: the stamped FileVersion of
        /// <c>Volt.Engine.Host.dll</c>, else <c>(dev) &lt;commit&gt;</c> from its ProductVersion.</summary>
        private static string D3OfHostFile()
        {
            var info = FileVersionInfo.GetVersionInfo(typeof(BridgePipeHost).Assembly.Location);
            if (info.FileVersion != null && info.FileVersion != "1.0.0.0" && info.FileVersion != "0.0.0.0") return info.FileVersion;
            var pv = info.ProductVersion ?? "";
            var plus = pv.IndexOf('+');
            return plus < 0 ? "(dev)" : "(dev) " + pv.Substring(plus + 1);
        }
    }
}
