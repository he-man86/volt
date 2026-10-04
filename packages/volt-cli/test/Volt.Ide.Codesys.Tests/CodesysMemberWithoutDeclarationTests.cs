using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Item;
using Xunit;
using static Volt.Ide.Codesys.Tests.CodesysHiddenBodyWriteTests;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// A MEMBER THE IDE HOLDS NO DECLARATION FOR IS UNREADABLE, NOT A VOLT BUG (openspec <c>bridge-refusal-review</c> V.1)
    /// — the CODESYS twin of <c>TcMemberWithoutDeclarationTests</c>. The IDE holds the item and Volt cannot read it whole:
    /// that is <c>UNREADABLE</c>'s situation (fix it in the IDE, or push with force). It answered <c>INTERNAL_ERROR</c>,
    /// which tells the engineer to report a Volt bug for a broken item in their project.
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // SystemInstances.ObjectMgr is process-wide
    public class CodesysMemberWithoutDeclarationTests
    {
        [Fact]
        public void A_method_whose_declaration_the_IDE_reports_blank_is_UNREADABLE_by_name()
        {
            var body = new _3S.CoDeSys.STObject.STImplementationObject();
            var method = new Node("Step", 2, new Method("", body));
            var pou = new Node("FB_A", 1, new Pou("FUNCTION_BLOCK FB_A\nVAR\nEND_VAR", new _3S.CoDeSys.STObject.STImplementationObject()), method);
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = new ObjectManager(new[] { pou, method });
            try
            {
                var ex = Assert.Throws<BridgeException>(() => new CodesysDriver(projects: null).ReadContent(new ItemRef(pou)));

                Assert.Equal(BridgeErrorCodes.Unreadable, ex.ErrorCode);
                Assert.Contains("'Step'", ex.Message);
                Assert.Contains("no declaration", ex.Message);
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }
    }
}
