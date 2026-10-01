using System;
using Volt.Engine.Host;
using Volt.Wire;
using Xunit;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// "REFUSED BY CAPABILITY, NEVER BY NUMBER" — pinned through the pipe with the REAL <see cref="CodesysDriver"/>
    /// (openspec <c>codesys-minimum-version</c> 2.3, review finding).
    ///
    /// <para><c>Volt.Cli.Tests/wire/IdeUnsupportedTests</c> drives <c>BridgePipeHost</c> on a FakeIde whose
    /// <c>Unsupported</c> is injected, so it cannot fail if the CODESYS driver grows a version floor. These run the
    /// driver itself on platform <c>1.0.0.0</c> (this test assembly — below every real CODESYS) behind the shared host:
    /// with every capability it is served; without one, every op is refused <c>IDE_UNSUPPORTED</c>.</para>
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // SystemInstances is process-wide
    public class CodesysUnsupportedHostTests
    {
        private static string Platform =>
            typeof(_3S.CoDeSys.Core.SystemInstances).Assembly.GetName().Version!.ToString();

        private static void With(object? engine, object? objectManager, Action<PipeClient> run)
        {
            _3S.CoDeSys.Core.SystemInstances.Engine = engine;
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = objectManager;
            try
            {
                var pipe = "volt.test." + Guid.NewGuid().ToString("N");
                using var host = new BridgePipeHost(new CodesysDriver(projects: null), pipe);
                host.Start();
                run(new PipeClient(pipe));
            }
            finally
            {
                _3S.CoDeSys.Core.SystemInstances.Engine = null;
                _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null;
            }
        }

        [Fact]
        public void An_old_platform_with_every_capability_is_served_through_the_pipe()
        {
            With(new CodesysCapabilityTests.Engine(), new object(), client =>
            {
                var h = client.Call("health");
                Assert.Equal(Platform, h.GetProperty("ideVersion").GetString());
                Assert.False(h.TryGetProperty("unsupported", out _));

                // No project is open in the double, so `refs` is refused — but for THAT, never as unsupported.
                var ex = Assert.Throws<PipeCallException>(() => client.Call("refs"));
                Assert.NotEqual("IDE_UNSUPPORTED", ex.Code);
            });
        }

        [Fact]
        public void A_platform_missing_a_capability_is_refused_through_the_pipe()
        {
            With(new CodesysCapabilityTests.Engine(), objectManager: null, client =>
            {
                var h = client.Call("health");
                Assert.Equal(Platform, h.GetProperty("ideVersion").GetString());
                Assert.Contains("ObjectMgr", h.GetProperty("unsupported").GetString());

                var ex = Assert.Throws<PipeCallException>(() => client.Call("refs"));
                Assert.Equal("IDE_UNSUPPORTED", ex.Code);
                Assert.StartsWith($"CODESYS {Platform} is not supported: it lacks ", ex.Message);
            });
        }
    }
}
