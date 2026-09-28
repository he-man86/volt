using NetworkTextSwitch = Volt.Engine.Format.Network.NetworkTextSwitch;
using Volt.Engine.Item;
using Xunit;
using static Volt.Ide.Codesys.Tests.CodesysHiddenBodyWriteTests;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>The switch flips a process-wide flag (and this suite's object-manager double is process-wide too), so
    /// no test may run beside one that turns it off.</summary>
    [CollectionDefinition(Name, DisableParallelization = true)]
    public sealed class NetworkTextSwitchCollection
    {
        public const string Name = "network text switch";
    }

    /// <summary>
    /// THE CODESYS READ OBEYS THE PRODUCTION SWITCH (openspec <c>implementation-keyword</c> 3c) — the CODESYS twin of
    /// <c>TcNetworkTextSwitchTests</c>. The bridge runs IN the CODESYS process, so the switch is that process's
    /// environment. With it unset, <see cref="CodesysDriver.ReadContent"/> hands up an LD implementation aspect as
    /// <c>IMPLEMENTATION LD UNSUPPORTED</c> with the switch's reason, asking the engine
    /// (<c>NetworkText.Pulled</c>) before a single network is read — the aspect here has none to read.
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]
    public class CodesysNetworkTextSwitchTests
    {
        [Fact]
        public void Off_an_LD_aspect_is_read_as_its_UNSUPPORTED_line_with_the_switchs_reason()
        {
            var pou = new Node("PRG_Ladder", 1,
                new Pou("PROGRAM PRG_Ladder\nVAR\nEND_VAR", new Nwl.NWLImplementationObject { DefaultViewMode = "Ld" }));
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new ObjectManager(new[] { pou });
            var was = NetworkTextSwitch.Enabled;
            NetworkTextSwitch.Enabled = false;
            try
            {
                var content = new CodesysDriver(projects: null).ReadContent(new ItemRef(pou));

                Assert.Equal("IMPLEMENTATION LD UNSUPPORTED", content.Body);
                Assert.Equal("LD and FBD are not enabled in this build", content.Unsupported);
            }
            finally
            {
                NetworkTextSwitch.Enabled = was;
                _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null;
            }
        }
    }
}
