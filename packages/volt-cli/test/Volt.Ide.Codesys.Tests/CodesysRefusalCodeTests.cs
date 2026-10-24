using Volt.Contracts;
using Volt.Engine;
using Xunit;
using static Volt.Ide.Codesys.Tests.CodesysContainerRefusalTests;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// A REQUEST OR AN IDE STATE ANSWERS ITS OWN CODE, NEVER INTERNAL_ERROR (openspec <c>wire-final-shape</c> step 3c). The
    /// driver's refusals that a request reaches were uncoded throws, answered "Volt bug"; each now states its situation's
    /// code at the throw.
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // the object-manager double is process-wide
    public class CodesysRefusalCodeTests
    {
        /// <summary>A build of a project that holds no application (a library project) has nothing to build: the IDE will not
        /// take the request — UNSUPPORTED, a frame, before anything is compiled.</summary>
        [Fact]
        public void A_build_of_a_project_with_no_application_is_refused_UNSUPPORTED()
        {
            var root = new TreeNode("<project>", null, null,
                new TreeNode("T", new Dut("TYPE T :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE"), null));
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new Manager(root);
            try
            {
                var ex = Assert.Throws<BridgeException>(() => new CodesysDriver(new Projects(root)).Build(null));
                Assert.Equal(BridgeErrorCodes.Unsupported, ex.ErrorCode);
                Assert.Contains("no Application", ex.Message);
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }

        /// <summary>No primary project open: no IDE project is served — PLC_DISCONNECTED, the remedy a client acts on (open
        /// one, or connect), never a Volt bug.</summary>
        [Fact]
        public void A_tree_read_with_no_primary_project_is_PLC_DISCONNECTED()
        {
            var ex = Assert.Throws<BridgeException>(() => new CodesysDriver(new Projects(null!)).GetTreeRoot());
            Assert.Equal(BridgeErrorCodes.PlcDisconnected, ex.ErrorCode);
            Assert.Contains("no primary project", ex.Message);
        }
    }
}
