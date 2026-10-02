using System.Collections.Generic;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;
using static Volt.Ide.Codesys.Tests.CodesysObjectManagerOverloadTests;

namespace Volt.Ide.Codesys.Tests
{
    /// <summary>
    /// A CODESYS TEXT-LIST ENUMERATION IS A DUT LIKE ANY OTHER (openspec <c>push-without-header-check</c> 5.P.1). CODESYS
    /// models it as its own object class (<c>ITextListEnumerationObject</c>, not <c>IDUTObject</c>; DIALECT C2g), and
    /// Volt classifies it onto the one DUT kind. Measured what Volt does with it before the pivot — read through its
    /// declaration aspect, written through the same aspect (C2e), published under its DUT name — and kept under
    /// <c>.dut</c>: it is <c>X.dut</c>, read and pushed like every DUT, not read-only.
    /// </summary>
    [Collection(NetworkTextSwitchCollection.Name)]   // the object-manager double is process-wide
    public class CodesysTextListEnumTests
    {
        private const string Decl = "TYPE SER_Mode :\n(\n\tAuto := 0,\n\tManual\n);\nEND_TYPE";

        [Fact]
        public void A_text_list_enumeration_is_published_as_a_dut_and_written_like_one()
        {
            var node = new GuidNode("SER_Mode", new TextListEnum(Decl));
            var mgr = new VendorObjectManager(new[] { node });
            _3S.CoDeSys.Core.SystemInstances.ObjectMgr = mgr;
            try
            {
                var driver = new CodesysDriver(new Projects(new GuidNode("<project>", null, node)));
                var item = new ItemRef(node);

                Assert.Equal(ItemKind.PlcDut, driver.KindCode(item));
                var read = Materializer.Materialize(driver, "SER_Mode", ItemKind.Kinds.Dut, item);
                Assert.Equal("SER_Mode.dut", read.FullName);
                Assert.Equal(Decl + "\n", read.Text.Replace("\r\n", "\n"));

                const string pushed = "TYPE SER_Mode :\n(\n\tAuto := 0,\n\tManual,\n\tService\n);\nEND_TYPE";
                driver.WriteContent(item, new ItemContent(ItemKind.Kinds.Dut, pushed, null, new List<Member>()),
                                    Volt.Engine.Ide.PushedDeclarations.None);
                Assert.Equal(pushed, node.Object!.Interface.TextDocument.Text);
                Assert.Equal(1, mgr.Commits);
            }
            finally { _3S.CoDeSys.Core.SystemInstances.ObjectMgr = null; }
        }
    }
}
